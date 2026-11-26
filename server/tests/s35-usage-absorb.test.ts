// S35 acceptance fix: unknown AI outcomes are absorbed by the platform.
// The organization's reservation is released (not charged), the UsageRecord is
// marked for reconciliation, the step retries under a new operation ID, and
// above AI_UNKNOWN_ABSORB_LIMIT the run pauses until a user retry.
import { before, after, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import supertest from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { assertResponse, assertRequest } from "./contract";
process.env.NODE_ENV = "test";
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.MONGOMS_VERSION ??= "7.0.14";
let mongo: MongoMemoryReplSet,
  app: any,
  storage: string,
  m: typeof import("../src/models"),
  ctx: typeof import("../src/models/tenant-context");
let a: Awaited<ReturnType<typeof account>>,
  b: Awaited<ReturnType<typeof account>>;
const origin = "http://localhost:5173",
  password = "Fixture-" + randomBytes(20).toString("hex");
class Client {
  jar = new Map<string, string>();
  make(method: string, url: string) {
    const agent = supertest(app) as any;
    return agent[method.toLowerCase()]("/api/v1" + url)
      .set("Origin", origin)
      .set("Cookie", [...this.jar].map(([k, v]) => k + "=" + v).join("; "))
      .set("X-CSRF-Token", this.jar.get("gs_csrf") ?? "");
  }
  check(r: any, method: string, url: string) {
    assertResponse(method, url, r.status, r.body, r.headers["content-type"] ?? "");
    for (const item of r.headers["set-cookie"] ?? []) {
      const [k, v] = item.split(";")[0].split("=");
      this.jar.set(k, v);
    }
    return r;
  }
  async request(method: string, url: string, data?: unknown) {
    let r = this.make(method, url);
    if (data !== undefined) r = r.send(data);
    const result = await r;
    if (result.status < 300 && data !== undefined)
      assertRequest(method, url, data);
    return this.check(result, method, url);
  }
}
async function account() {
  const client = new Client(),
    email = randomUUID() + "@example.invalid";
  const reg = await client.request("POST", "/auth/register", {
    name: "Usage Fixture",
    email,
    password,
    organizationName: "Usage Fixture",
    locale: "en",
  });
  assert.equal(reg.status, 202);
  const mail = await client.request("GET", "/dev/mail/" + reg.body.data.devReceipt),
    token = new URL(mail.body.data.text).searchParams.get("token");
  assert.equal(
    (await client.request("POST", "/auth/verify-email", { token })).status,
    200,
  );
  assert.equal(
    (await client.request("POST", "/auth/login", { email, password })).status,
    200,
  );
  return { client, me: (await client.request("GET", "/auth/me")).body.data };
}
type Account = Awaited<ReturnType<typeof account>>;
const tenantOf =
  (x: Account) =>
  <T>(fn: () => Promise<T>) =>
    ctx.runWithTenant(x.me.organizationId, fn);
before(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "globalsite-usage-"));
  process.env.STORAGE_ROOT = storage;
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: process.env.MONGOMS_VERSION },
  });
  await (await import("../src/db")).connectDatabase(mongo.getUri("globalsite"));
  m = await import("../src/models");
  ctx = await import("../src/models/tenant-context");
  app = (await import("../src/app")).createApp();
  a = await account();
  b = await account();
});
beforeEach(async () => {
  mock.restoreAll();
  delete process.env.AI_UNKNOWN_ABSORB_LIMIT;
  await ctx.runIdentity(() => m.RateLimit.deleteMany({}));
  for (const x of [a, b]) {
    const tenant = tenantOf(x);
    await tenant(() => m.Site.updateMany({}, { $set: { status: "archived" } }));
    await tenant(() =>
      m.AgentRun.updateMany({ kind: "site.agent" }, { $set: { active: false } }),
    );
  }
});
after(async () => {
  mock.restoreAll();
  delete process.env.AI_UNKNOWN_ABSORB_LIMIT;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (storage) {
    assert.equal(path.dirname(storage), path.resolve(os.tmpdir()));
    assert(path.basename(storage).startsWith("globalsite-usage-"));
    await fs.rm(storage, { recursive: true, force: true });
  }
});
const home = {
  key: "home",
  path: "/",
  title: "Home",
  type: "home",
  parentKey: null,
  productId: null,
  keywords: ["industrial sourcing"],
  intent: "source",
};
const draft = () => ({
  title: "Industrial solutions",
  metaDescription: "Explore our products and discuss your project with our team.",
  refs: [],
  blocks: [
    {
      key: "overview",
      type: "text",
      heading: "About our company",
      body: "Contact our team to discuss your requirements.",
      table: null,
      faq: [],
      assetId: null,
      alt: "",
      refs: [],
    },
  ],
});
async function queuedRun(x: Account) {
  let r = await x.client.request("POST", "/sites", {
    name: "Usage Export",
    templateId: "machinery",
    targetMarkets: ["United States"],
    language: "en",
    brandColor: "#126a54",
    logoId: null,
    productIds: [],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const site = r.body.data;
  r = await x.client.request("PUT", "/sites/" + site.id + "/plan", {
    revision: site.planRevision,
    nodes: [home],
    keywords: [],
    clusters: [],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await x.client.request("POST", "/sites/" + site.id + "/plan/confirm", {
    revision: r.body.data.planRevision,
  });
  assert.equal(r.status, 200);
  const url = "/sites/" + site.id + "/agent-runs",
    data = { step: "content", consent: true };
  const q = await x.client
    .make("POST", url)
    .set("Idempotency-Key", randomUUID())
    .send(data);
  x.client.check(q, "POST", url);
  assert.equal(q.status, 202, JSON.stringify(q.body));
  return q.body.data.id as string;
}
async function liveTask(x: Account, runId: string) {
  return tenantOf(x)(() =>
    m.Task.findOneAndUpdate(
      { "payload.runId": runId, kind: "site.agent" },
      {
        $set: {
          status: "running",
          owner: "fixture",
          leaseUntil: new Date(Date.now() + 60000),
        },
        $inc: { fencingToken: 1, attempts: 1 },
      },
      { new: true, sort: { _id: -1 } },
    ),
  );
}
async function services() {
  const agents = await import("../src/services/site-agents.service"),
    usage = await import("../src/services/usage.service"),
    unknown = await import("../src/services/ai-usage-unknown");
  return { ...agents, ...usage, ...unknown };
}
// Reserves like the real provider, then loses the outcome.
async function lostCall(reason: "timeout" | "network" | "usage_missing") {
  const { reserve, AiUsageUnknownError } = await services();
  const ops: string[] = [];
  const provider = async (_s: any, _i: any, operationId: string) => {
    ops.push(operationId);
    await reserve("ai_tokens", 500, operationId);
    throw new AiUsageUnknownError(reason);
  };
  return { ops, provider };
}
async function bucket(x: Account) {
  return tenantOf(x)(() => m.UsageBucket.findOne({ metric: "ai_tokens" }));
}

test("an unknown outcome is absorbed, recorded for reconciliation and retried under a new operation ID", async () => {
  const { processSiteAgent } = await services();
  const tenant = tenantOf(a);
  const id = await queuedRun(a);
  const before = (await bucket(a))?.consumed ?? 0;
  const lost = await lostCall("timeout");
  const outcome = await tenant(async () =>
    processSiteAgent((await liveTask(a, id))!, lost.provider),
  );
  assert.equal(outcome.status, "pending");
  assert.equal(outcome.error, "AI_USAGE_UNKNOWN");
  const record = await tenant(() =>
    m.UsageRecord.findOne({ operationId: lost.ops[0] }),
  );
  assert.equal(record!.state, "released");
  assert.equal(record!.actual, 0);
  assert.equal(record!.absorbed, true);
  assert.equal(record!.unknownReason, "timeout");
  assert.equal(record!.absorbedBy, "auto");
  const usage = await bucket(a);
  assert.equal(usage!.reserved, 0);
  assert.equal(usage!.consumed, before);
  let run = (await a.client.request("GET", "/agent-runs/" + id)).body.data;
  assert.equal(run.status, "queued");
  assert.equal(run.active, true);
  assert.equal(run.steps[0].status, "pending");
  assert.equal(run.steps[0].usageUnknownReason, "timeout");

  const ops: string[] = [];
  await tenant(async () =>
    processSiteAgent(
      (await liveTask(a, id))!,
      async (_s: any, _i: any, operationId: string, save: any) => {
        ops.push(operationId);
        const result = { output: { page: draft() }, tokens: 21 };
        await save(result);
        return result;
      },
    ),
  );
  assert.equal(ops.length, 1);
  assert.notEqual(ops[0], lost.ops[0]);
  assert.match(ops[0], /:2$/);
  run = (await a.client.request("GET", "/agent-runs/" + id)).body.data;
  assert.equal(run.status, "succeeded");
  assert.equal(run.steps[0].usageUnknownReason, undefined);
});

test("an open reservation from an interrupted attempt is absorbed instead of blocking the run", async () => {
  const { processSiteAgent, reserve } = await services();
  const tenant = tenantOf(a);
  const id = await queuedRun(a);
  const op = "lost:" + id;
  await tenant(async () => {
    await reserve("ai_tokens", 100, op);
    const run = await m.AgentRun.findById(id);
    run.steps[0] = { ...run.steps[0], status: "running", operationId: op, attempts: 1 };
    run.markModified("steps");
    await run.save();
  });
  await tenant(async () =>
    processSiteAgent((await liveTask(a, id))!, async () => {
      assert.fail("The interrupted attempt is not repeated under its old operation");
    }),
  );
  const record = await tenant(() => m.UsageRecord.findOne({ operationId: op }));
  assert.equal(record!.state, "released");
  assert.equal(record!.unknownReason, "interrupted");
  const run = (await a.client.request("GET", "/agent-runs/" + id)).body.data;
  assert.equal(run.status, "queued");
  assert.equal(run.steps[0].usageUnknownReason, "interrupted");
});

test("above the monthly absorption limit the run pauses; a user retry releases without charging", async () => {
  const { processSiteAgent } = await services();
  const tenant = tenantOf(a);
  // Organization a already absorbed outcomes in the tests above.
  process.env.AI_UNKNOWN_ABSORB_LIMIT = "1";
  const id = await queuedRun(a);
  const before = (await bucket(a))!.consumed;
  const lost = await lostCall("network");
  const outcome = await tenant(async () =>
    processSiteAgent((await liveTask(a, id))!, lost.provider),
  );
  assert.equal(outcome.status, "dead");
  let record = await tenant(() =>
    m.UsageRecord.findOne({ operationId: lost.ops[0] }),
  );
  assert.equal(record!.state, "reserved");
  let run = (await a.client.request("GET", "/agent-runs/" + id)).body.data;
  assert.equal(run.status, "paused");
  assert.equal(run.errorCode, "AI_USAGE_UNKNOWN");
  assert.equal(run.steps[0].usageUnknownReason, "network");

  // Another organization cannot retry it.
  assert.equal(
    (await b.client.request("POST", "/agent-runs/" + id + "/retry")).status,
    404,
  );
  await tenant(() =>
    m.Task.updateMany({ "payload.runId": id }, { $set: { status: "dead" } }),
  );
  const retried = await a.client.request("POST", "/agent-runs/" + id + "/retry");
  assert.equal(retried.status, 202, JSON.stringify(retried.body));
  record = await tenant(() => m.UsageRecord.findOne({ operationId: lost.ops[0] }));
  assert.equal(record!.state, "released");
  assert.equal(record!.absorbed, true);
  assert.equal(record!.absorbedBy, "retry");
  const usage = await bucket(a);
  assert.equal(usage!.consumed, before);
  assert.equal(usage!.reserved, 0);
  const ops: string[] = [];
  await tenant(async () =>
    processSiteAgent(
      (await liveTask(a, id))!,
      async (_s: any, _i: any, operationId: string, save: any) => {
        ops.push(operationId);
        const result = { output: { page: draft() }, tokens: 21 };
        await save(result);
        return result;
      },
    ),
  );
  assert.equal(ops.length, 1);
  assert.notEqual(ops[0], lost.ops[0]);
  run = (await a.client.request("GET", "/agent-runs/" + id)).body.data;
  assert.equal(run.status, "succeeded");
});

test("the absorption allowance is counted per organization", async () => {
  const { processSiteAgent } = await services();
  process.env.AI_UNKNOWN_ABSORB_LIMIT = "1";
  const tenant = tenantOf(b);
  const id = await queuedRun(b);
  const lost = await lostCall("usage_missing");
  await tenant(async () =>
    processSiteAgent((await liveTask(b, id))!, lost.provider),
  );
  const record = await tenant(() =>
    m.UsageRecord.findOne({ operationId: lost.ops[0] }),
  );
  assert.equal(record!.absorbed, true);
  assert.equal(record!.unknownReason, "usage_missing");
  assert.equal(
    (await b.client.request("GET", "/agent-runs/" + id)).body.data.status,
    "queued",
  );
  // Organization a cannot see b's records.
  assert.equal(
    await tenantOf(a)(() =>
      m.UsageRecord.countDocuments({ operationId: lost.ops[0] }),
    ),
    0,
  );
  assert.equal(
    (await a.client.request("GET", "/agent-runs/" + id)).status,
    404,
  );
});
