import { before, after, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import supertest from "supertest";

import dns from "node:dns/promises";

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
    assertResponse(
      method,
      url,
      r.status,
      r.body,
      r.headers["content-type"] ?? "",
    );
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
  async upload(
    url: string,
    bytes: Buffer,
    fileName: string,
    mime: string,
    kind?: string,
  ) {
    let r = this.make("POST", url);
    if (kind) r = r.field("kind", kind);
    return this.check(
      await r.attach("file", bytes, { filename: fileName, contentType: mime }),
      "POST",
      url,
    );
  }
}
async function account() {
  const client = new Client(),
    email = randomUUID() + "@example.invalid";
  const reg = await client.request("POST", "/auth/register", {
    name: "Catalog Fixture",
    email,
    password,
    organizationName: "Catalog Fixture",
    locale: "en",
  });
  assert.equal(reg.status, 202);
  const mail = await client.request(
      "GET",
      "/dev/mail/" + reg.body.data.devReceipt,
    ),
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
const tenant = <T>(fn: () => Promise<T>) =>
  ctx.runWithTenant(a.me.organizationId, fn);
async function liveTask(runId: string, kind: string) {
  return tenant(() =>
    m.Task.findOneAndUpdate(
      { "payload.runId": runId, kind },
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
async function role(value: string) {
  return tenant(() =>
    m.Membership.updateOne({ userId: a.me.user.id }, { $set: { role: value } }),
  );
}
before(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "globalsite-catalog-"));
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
  await ctx.runIdentity(() => m.RateLimit.deleteMany({}));
  await role("admin");
});
after(async () => {
  mock.restoreAll();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (storage) {
    assert.equal(path.dirname(storage), path.resolve(os.tmpdir()));
    assert(path.basename(storage).startsWith("globalsite-catalog-"));
    await fs.rm(storage, { recursive: true, force: true });
  }
});

async function newSite() {
  const r = await a.client.request("POST", "/sites", {
    name: "Fixture Export",
    templateId: "machinery",
    targetMarkets: ["United States"],
    language: "en",
    brandColor: "#126a54",
    logoId: null,
    productIds: [],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}
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
async function planSite(site: any, nodes: any[] = [home]) {
  let r = await a.client.request("PUT", "/sites/" + site.id + "/plan", {
    revision: site.planRevision,
    nodes,
    keywords: [],
    clusters: [],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await a.client.request("POST", "/sites/" + site.id + "/plan/confirm", {
    revision: r.body.data.planRevision,
  });
  assert.equal(r.status, 200);
  return r.body.data;
}
const block = (body = "Contact our team to discuss your requirements.") => ({
  key: "overview",
  type: "text",
  heading: "About our company",
  body,
  table: null,
  faq: [],
  assetId: null,
  alt: "",
  refs: [],
});
const draft = (body?: string) => ({
  title: "Industrial solutions",
  metaDescription:
    "Explore our products and discuss your project with our team.",
  refs: [],
  blocks: [block(body)],
});
async function queue(
  site: any,
  step = "content",
  key = randomUUID(),
  extra: any = {},
) {
  const path = "/sites/" + site.id + "/agent-runs",
    data = { step, consent: true, ...extra };
  const r = await a.client
    .make("POST", path)
    .set("Idempotency-Key", key)
    .send(data);
  a.client.check(r, "POST", path);
  if (r.status < 300) assertRequest("POST", path, data);
  return r;
}
async function taskFor(id: string) {
  return liveTask(id, "site.agent");
}
async function providerFor(output: any, unitTokens = 21) {
  return async (_sys: any, _input: any, _operation: any, save: any) => {
    const result = { output, tokens: unitTokens };
    await save(result);
    return result;
  };
}
beforeEach(async () => {
  await tenant(() => m.Site.updateMany({}, { $set: { status: "archived" } }));
  await tenant(() =>
    m.AgentRun.updateMany({ kind: "site.agent" }, { $set: { active: false } }),
  );
});
test("sites isolate organizations, enforce role/plan limits and validate logo/product foreign keys", async () => {
  const site = await newSite();
  assert.equal(
    (await b.client.request("GET", "/sites/" + site.id)).status,
    404,
  );
  assert.equal(
    (
      await a.client.request("POST", "/sites", {
        name: "Second",
        templateId: "machinery",
        targetMarkets: ["UK"],
        language: "en",
        brandColor: "#123456",
        logoId: null,
        productIds: [],
      })
    ).status,
    409,
  );
  await role("viewer");
  assert.equal(
    (
      await a.client.request("PATCH", "/sites/" + site.id, {
        revision: 1,
        data: {},
      })
    ).status,
    403,
  );
  await role("admin");
  assert.equal(
    (await a.client.request("GET", "/site-templates")).body.data.length,
    3,
  );
  await assert.rejects(() => m.Site.find(), /TENANT_REQUIRED/);
  await assert.rejects(() => m.SitePage.find(), /TENANT_REQUIRED/);
  await assert.rejects(() => m.SiteBlock.find(), /TENANT_REQUIRED/);
});
test("sitemap validates paths, parent cycles and selected product scope; only admin confirms", async () => {
  const site = await newSite();
  const bad = { ...home, path: "/../admin" };
  assert.equal(
    (
      await a.client.request("PUT", "/sites/" + site.id + "/plan", {
        revision: 1,
        nodes: [bad],
        keywords: [],
        clusters: [],
      })
    ).status,
    400,
  );
  const nodes = [
    home,
    {
      ...home,
      key: "about",
      path: "/about",
      type: "about",
      parentKey: "about",
    },
  ];
  assert.equal(
    (
      await a.client.request("PUT", "/sites/" + site.id + "/plan", {
        revision: 1,
        nodes,
        keywords: [],
        clusters: [],
      })
    ).status,
    400,
  );
  const p = await a.client.request("PUT", "/sites/" + site.id + "/plan", {
    revision: 1,
    nodes: [home],
    keywords: [],
    clusters: [],
  });
  assert.equal(p.status, 200);
  await role("editor");
  assert.equal(
    (
      await a.client.request("POST", "/sites/" + site.id + "/plan/confirm", {
        revision: 2,
      })
    ).status,
    403,
  );
});
test("unsupported numbers, certifications and capacity block approval/publication; matching confirmed facts permit review", async () => {
  const site = await planSite(await newSite());
  let p = (
    await a.client.request("POST", "/sites/" + site.id + "/pages", {
      nodeKey: "home",
    })
  ).body.data;
  let data = draft(
    "Founded in 1998. Our annual capacity is 100 units. ISO 9001 certified.",
  );
  p = (
    await a.client.request("PATCH", "/pages/" + p.id, {
      revision: p.revision,
      data,
    })
  ).body.data;
  assert.equal(p.status, "blocked");
  assert(p.issues.some((i: any) => i.code === "UNSOURCED_NUMBER"));
  assert(p.issues.some((i: any) => i.code === "UNSOURCED_CERTIFICATION"));
  assert.equal(
    (
      await a.client.request("POST", "/pages/" + p.id + "/approve", {
        revision: p.revision,
      })
    ).status,
    409,
  );
  assert.equal(
    (await a.client.request("POST", "/sites/" + site.id + "/publication-check"))
      .status,
    409,
  );
  const refs: any[] = [];
  for (const [type, value, unit] of [
    ["company.founded", "1998", null],
    ["company.capacity", "100", "units"],
    ["company.certifications", "ISO 9001", null],
  ]) {
    const f = (
      await a.client.request("POST", "/facts", {
        subjectType: "organization",
        type,
        value,
        unit,
        source: { kind: "manual", quote: "Fixture " + value },
      })
    ).body.data;
    const confirmed = (
      await a.client.request("POST", "/facts/" + f.id + "/confirm", {
        revision: f.revision,
      })
    ).body.data;
    refs.push({ factId: f.id, revision: confirmed.revision });
  }
  data = { ...data, blocks: [{ ...data.blocks[0], refs }] };
  p = (
    await a.client.request("PATCH", "/pages/" + p.id, {
      revision: p.revision,
      data,
    })
  ).body.data;
  assert.equal(p.issues.length, 0);
  p = (
    await a.client.request("POST", "/pages/" + p.id + "/approve", {
      revision: p.revision,
    })
  ).body.data;
  assert.equal(p.status, "approved");
  assert.equal(
    (await a.client.request("POST", "/sites/" + site.id + "/publication-check"))
      .status,
    200,
  );
  await a.client.request("POST", "/facts/" + refs[0].factId + "/reject", {
    revision: refs[0].revision,
  });
  const changed = (await a.client.request("GET", "/pages/" + p.id)).body.data;
  assert.equal(changed.status, "blocked");
  assert.equal(
    (await a.client.request("POST", "/sites/" + site.id + "/publication-check"))
      .status,
    409,
  );
});
test("unrelated fact references cannot launder a certification; edits clear approvals and HTML preview escapes input", async () => {
  const { validatePage, renderPage } = await import(
    "../src/services/page-validation.service"
  );
  const fake = {
    id: "a".repeat(24),
    status: "confirmed",
    revision: 1,
    type: "company.founded",
    value: "9001",
    subjectType: "organization",
  };
  const data = {
    ...draft("ISO 9001 certified"),
    blocks: [
      {
        ...block("ISO 9001 certified"),
        refs: [{ factId: fake.id, revision: 1 }],
      },
    ],
  };
  assert(
    validatePage(data, [fake], { productIds: [], type: "home" }).some(
      (i) => i.code === "UNSOURCED_CERTIFICATION",
    ),
  );
  const html = renderPage(
    { ...draft("<script>alert('bad')</script>") },
    { name: '<img onerror="bad">', brandColor: "#126a54" },
  );
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;"));
  assert(html.includes("&lt;img"));
  const site = await planSite(await newSite()),
    p = (
      await a.client.request("POST", "/sites/" + site.id + "/pages", {
        nodeKey: "home",
      })
    ).body.data;
  const approved = (
    await a.client.request("POST", "/pages/" + p.id + "/approve", {
      revision: p.revision,
    })
  ).body.data;
  const edited = (
    await a.client.request("PATCH", "/pages/" + p.id, {
      revision: approved.revision,
      data: draft(),
    })
  ).body.data;
  assert.equal(edited.status, "draft");
  assert.equal(
    (await b.client.request("GET", "/pages/" + p.id + "/preview")).status,
    404,
  );
});
test("concurrent same-step triggers enqueue one run/task, and a completed replay never duplicates pages", async () => {
  const site = await planSite(await newSite());
  const responses = await Promise.all([queue(site), queue(site), queue(site)]);
  assert(
    responses.every((r) => r.status === 202),
    JSON.stringify(responses.map((r) => r.body)),
  );
  const id = responses[0].body.data.id;
  assert(responses.every((r) => r.body.data.id === id));
  assert.equal(
    await tenant(() => m.Task.countDocuments({ "payload.runId": id })),
    1,
  );
  const { processSiteAgent } = await import(
      "../src/services/site-agents.service"
    ),
    task = await taskFor(id);
  let calls = 0;
  const provider = async (_a: any, _b: any, _c: any, save: any) => {
    calls++;
    const r = { output: { page: draft() }, tokens: 20 };
    await save(r);
    return r;
  };
  assert.equal(
    (await tenant(async () => processSiteAgent(task, provider))).status,
    "done",
  );
  await tenant(async () => processSiteAgent(task, provider));
  assert.equal(calls, 1);
  assert.equal(
    await tenant(() => m.SitePage.countDocuments({ siteId: site.id })),
    1,
  );
  assert.equal(
    (await a.client.request("GET", "/agent-runs/" + id)).body.data.status,
    "succeeded",
  );
});
test("durable step result resumes without repeating AI or data writes; transient failures retry once per attempt", async () => {
  const site = await planSite(await newSite()),
    r = await queue(site),
    id = r.body.data.id,
    task = await taskFor(id),
    { processSiteAgent } = await import("../src/services/site-agents.service"),
    { reserve } = await import("../src/services/usage.service");
  const op = "durable:" + id;
  await tenant(async () => {
    await reserve("ai_tokens", 100, op);
    const run = await m.AgentRun.findById(id);
    run.steps[0] = {
      ...run.steps[0],
      operationId: op,
      pendingResult: { output: { page: draft() }, tokens: 19 },
      attempts: 1,
    };
    run.markModified("steps");
    await run.save();
  });
  await tenant(async () =>
    processSiteAgent(task, async () => {
      assert.fail("Durable result must not call AI");
    }),
  );
  assert.equal(
    (await tenant(() => m.UsageRecord.findOne({ operationId: op })))!.actual,
    19,
  );
  assert.equal(
    await tenant(() => m.SitePage.countDocuments({ siteId: site.id })),
    1,
  );
});
test("quota pauses the job and resumes with its frozen input; unknown paid outcomes are never automatically repeated", async () => {
  const site = await planSite(await newSite()),
    r = await queue(site),
    id = r.body.data.id,
    task = await taskFor(id),
    { processSiteAgent, retryAgent } = await import(
      "../src/services/site-agents.service"
    ),
    { AppError } = await import("../src/errors");
  const outcome = await tenant(async () =>
    processSiteAgent(task, async () => {
      throw new AppError(409, "QUOTA_EXCEEDED");
    }),
  );
  assert.equal(outcome.status, "dead");
  let run = (await a.client.request("GET", "/agent-runs/" + id)).body.data;
  assert.equal(run.status, "paused");
  assert.equal(run.errorCode, "QUOTA_EXCEEDED");
  await tenant(() =>
    m.Task.updateOne({ _id: task._id }, { $set: { status: "dead" } }),
  );
  await tenant(() => retryAgent(id, a.me.user.id));
  const next = await taskFor(id);
  await tenant(async () =>
    processSiteAgent(next, await providerFor({ page: draft() })),
  );
  run = (await a.client.request("GET", "/agent-runs/" + id)).body.data;
  assert.equal(run.status, "succeeded");
  const r2 = await queue(site),
    unknownTask = await taskFor(r2.body.data.id),
    { reserve } = await import("../src/services/usage.service");
  await tenant(async () => {
    const run = await m.AgentRun.findById(r2.body.data.id);
    const op = "lost:" + run._id;
    await reserve("ai_tokens", 100, op);
    run.steps[0] = {
      ...run.steps[0],
      status: "running",
      operationId: op,
      attempts: 1,
    };
    run.markModified("steps");
    await run.save();
  });
  await tenant(async () =>
    processSiteAgent(unknownTask, async () => {
      assert.fail("Unknown outcome must never repeat");
    }),
  );
  assert.equal(
    (await a.client.request("GET", "/agent-runs/" + r2.body.data.id)).body.data
      .errorCode,
    "AI_USAGE_UNKNOWN",
  );
  assert.equal(
    (
      await a.client.request(
        "POST",
        "/agent-runs/" + r2.body.data.id + "/retry",
      )
    ).status,
    409,
  );
});
test("cancellation during a paid request records result but writes no pages; revoked actor cannot execute", async () => {
  const site = await planSite(await newSite()),
    r = await queue(site),
    id = r.body.data.id,
    task = await taskFor(id),
    { processSiteAgent, cancelAgent } = await import(
      "../src/services/site-agents.service"
    );
  await tenant(async () =>
    processSiteAgent(task, async (_a: any, _b: any, _c: any, save: any) => {
      await cancelAgent(id, a.me.user.id);
      const result = { output: { page: draft() }, tokens: 20 };
      await save(result);
      return result;
    }),
  );
  assert.equal(
    (await a.client.request("GET", "/agent-runs/" + id)).body.data.status,
    "cancelled",
  );
  assert.equal(
    await tenant(() => m.SitePage.countDocuments({ siteId: site.id })),
    0,
  );
  const next = await queue(site),
    nextTask = await taskFor(next.body.data.id);
  await role("viewer");
  await tenant(async () =>
    processSiteAgent(nextTask, async () => {
      assert.fail("Revoked actor cannot invoke AI");
    }),
  );
  assert.equal(
    (await a.client.request("GET", "/agent-runs/" + next.body.data.id)).body
      .data.status,
    "failed",
  );
});
test("interview answers become candidate facts exactly once; research suggestions require human confirmation", async () => {
  const site = await newSite(),
    r = await queue(site, "interview"),
    id = r.body.data.id,
    task = await taskFor(id),
    { processSiteAgent } = await import("../src/services/site-agents.service");
  await tenant(async () =>
    processSiteAgent(
      task,
      await providerFor({
        questions: [
          {
            id: "year",
            type: "company.founded",
            question: "When was the company founded?",
            subjectId: null,
          },
        ],
      }),
    ),
  );
  const body = { runId: id, answers: [{ questionId: "year", answer: "1998" }] },
    url = "/sites/" + site.id + "/interview/answers",
    first = await a.client.request("POST", url, body),
    second = await a.client.request("POST", url, body);
  assert.equal(first.status, 201);
  assert.deepEqual(first.body.data.factIds, second.body.data.factIds);
  assert.equal(
    (await tenant(() => m.FactSheet.findById(first.body.data.factIds[0])))!
      .status,
    "candidate",
  );
  const research = await queue(site, "research"),
    researchTask = await taskFor(research.body.data.id);
  await tenant(async () =>
    processSiteAgent(
      researchTask,
      await providerFor({
        nodes: [home],
        keywords: [
          {
            term: "industrial sourcing",
            intent: "source",
            cluster: "industrial",
          },
        ],
        clusters: [
          {
            key: "industrial",
            label: "Industrial sourcing",
            intent: "source",
            keywords: ["industrial sourcing"],
          },
        ],
      }),
    ),
  );
  const updated = (await a.client.request("GET", "/sites/" + site.id)).body
    .data;
  assert.equal(updated.planConfirmed, false);
  assert.equal((await queue(updated)).status, 409);
});
test("FAQ lead length, product section tables, source changes and stale fences are enforced", async () => {
  const { validatePage } = await import(
    "../src/services/page-validation.service"
  );
  const data = {
    ...draft(),
    blocks: [
      {
        ...block(),
        type: "faq" as const,
        faq: [{ question: "Can you help?", answer: "Yes.", detail: "" }],
      },
    ],
  };
  const issues = validatePage(data, [], { type: "product", productIds: [] });
  assert(issues.some((i) => i.code === "FAQ_DIRECT_ANSWER_REQUIRED"));
  assert(issues.some((i) => i.code === "PRODUCT_SECTION_REQUIRED"));
  const site = await planSite(await newSite()),
    r = await queue(site),
    task = await taskFor(r.body.data.id),
    { processSiteAgent } = await import("../src/services/site-agents.service");
  await tenant(() =>
    m.Task.updateOne({ _id: task._id }, { $inc: { fencingToken: 1 } }),
  );
  await tenant(async () =>
    processSiteAgent(task, async () => {
      assert.fail("Stale worker must not call provider");
    }),
  );
  assert.equal(
    await tenant(() => m.SitePage.countDocuments({ siteId: site.id })),
    0,
  );
});
test("provider uses configured model and meters output; no provider is a paused/manual-capable state", async () => {
  const { encrypt } = await import("../src/services/credential-crypto"),
    { callSiteAgent } = await import(
      "../src/services/site-agent-provider.service"
    );
  await tenant(() =>
    m.AgentAiProvider.create({
      name: "default",
      enabled: true,
      baseUrl: "https://api.openai.com/v1",
      modelName: "configured-fixture-model",
      secret: encrypt(
        "fixture-" + randomBytes(20).toString("hex"),
        "ai:" + a.me.organizationId,
      ),
    }),
  );
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  let model = "";
  mock.method(globalThis, "fetch", async (_url: any, options: any) => {
    model = JSON.parse(options.body).model;
    return new Response(
      JSON.stringify({
        usage: { total_tokens: 45 },
        choices: [{ message: { content: JSON.stringify({ page: draft() }) } }],
      }),
    );
  });
  const result = await tenant(() =>
    callSiteAgent("Return JSON", {}, randomUUID(), async () => {}),
  );
  assert.equal(result.tokens, 45);
  assert.equal(model, "configured-fixture-model");
});

test("multi-page transient retry resumes only the failed page and stale dispatch cannot affect the new attempt", async () => {
  const site = await planSite(await newSite(), [
      home,
      {
        ...home,
        key: "about",
        path: "/about",
        type: "about",
        parentKey: "home",
      },
    ]),
    r = await queue(site),
    id = r.body.data.id,
    task = await taskFor(id),
    { processSiteAgent, retryAgent } = await import(
      "../src/services/site-agents.service"
    ),
    { AppError } = await import("../src/errors");
  let calls = 0;
  const provider = async (_a: any, input: any, _c: any, save: any) => {
    calls++;
    if (input.node.key === "about" && calls === 2)
      throw new AppError(502, "AI_TRANSIENT");
    const result = { output: { page: draft() }, tokens: 20 };
    await save(result);
    return result;
  };
  assert.equal(
    (await tenant(() => processSiteAgent(task, provider))).status,
    "pending",
  );
  assert.equal(
    await tenant(() => m.SitePage.countDocuments({ siteId: site.id })),
    1,
  );
  assert.equal(
    (await tenant(() => processSiteAgent(task, provider))).status,
    "done",
  );
  assert.equal(calls, 3);
  assert.equal(
    await tenant(() => m.SitePage.countDocuments({ siteId: site.id })),
    2,
  );
  const next = await queue(site, "content", randomUUID(), { pageKey: "home" }),
    oldTask = await taskFor(next.body.data.id);
  await tenant(() =>
    processSiteAgent(oldTask, async () => {
      throw new AppError(409, "QUOTA_EXCEEDED");
    }),
  );
  await tenant(() => retryAgent(next.body.data.id, a.me.user.id));
  await tenant(() =>
    processSiteAgent(oldTask, async () => {
      assert.fail("Old dispatch must not call AI");
    }),
  );
  assert.equal(
    (await a.client.request("GET", "/agent-runs/" + next.body.data.id)).body
      .data.status,
    "queued",
  );
});
test("section rewrite changes only its target; current page revisions protect concurrent manual edits", async () => {
  const site = await planSite(await newSite()),
    created = (
      await a.client.request("POST", "/sites/" + site.id + "/pages", {
        nodeKey: "home",
      })
    ).body.data;
  const page = (
    await a.client.request("PATCH", "/pages/" + created.id, {
      revision: created.revision,
      data: {
        ...draft(),
        blocks: [
          block("First paragraph."),
          { ...block("Keep this paragraph."), key: "other" },
        ],
      },
    })
  ).body.data;
  const r = await queue(site, "rewrite", randomUUID(), {
      pageId: page.id,
      blockKey: "overview",
      instructions: "Make this clearer.",
    }),
    task = await taskFor(r.body.data.id),
    { processSiteAgent } = await import("../src/services/site-agents.service");
  await tenant(async () =>
    processSiteAgent(
      task,
      await providerFor({ block: block("Rewritten paragraph.") }),
    ),
  );
  let updated = (await a.client.request("GET", "/pages/" + page.id)).body.data;
  assert.equal(updated.blocks[0].body, "Rewritten paragraph.");
  assert.equal(updated.blocks[1].body, "Keep this paragraph.");
  const next = await queue(site, "rewrite", randomUUID(), {
      pageId: page.id,
      blockKey: "overview",
    }),
    nextTask = await taskFor(next.body.data.id);
  await a.client.request("PATCH", "/pages/" + page.id, {
    revision: updated.revision,
    data: {
      ...draft(),
      blocks: [
        block("Manual edit stays."),
        { ...block("Keep this paragraph."), key: "other" },
      ],
    },
  });
  await tenant(async () =>
    processSiteAgent(
      nextTask,
      await providerFor({ block: block("Must not overwrite.") }),
    ),
  );
  updated = (await a.client.request("GET", "/pages/" + page.id)).body.data;
  assert.equal(updated.blocks[0].body, "Manual edit stays.");
  assert.equal(
    (await a.client.request("GET", "/agent-runs/" + next.body.data.id)).body
      .data.errorCode,
    "SOURCE_CHANGED",
  );
});
test("real provider quota refusal pauses before HTTP", async () => {
  const { processSiteAgent } = await import(
    "../src/services/site-agents.service"
  );
  const site = await planSite(await newSite()),
    r = await queue(site),
    task = await taskFor(r.body.data.id);
  const prior = await tenant(() =>
    m.UsageBucket.findOne({ metric: "ai_tokens" }),
  );
  await tenant(() =>
    m.UsageBucket.updateOne(
      { metric: "ai_tokens" },
      { $set: { consumed: 200000, reserved: 0 } },
    ),
  );
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  mock.method(globalThis, "fetch", async () => {
    assert.fail("No call after quota refusal");
  });
  await tenant(() => processSiteAgent(task));
  assert.equal(
    (await a.client.request("GET", "/agent-runs/" + r.body.data.id)).body.data
      .status,
    "paused",
  );
  await tenant(() =>
    m.UsageBucket.updateOne(
      { metric: "ai_tokens" },
      { $set: { consumed: prior!.consumed, reserved: prior!.reserved } },
    ),
  );
});

test("site logo and product references are tenant-bound; referenced assets cannot be removed", async () => {
  const sharp = (await import("sharp")).default,
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#126a54" },
    })
      .png()
      .toBuffer(),
    asset = await a.client.upload("/assets", png, "logo.png", "image/png"),
    logoId = asset.body.data.id;
  const product = (
    await a.client.request("POST", "/products", {
      name: "Logo fixture pump",
      sku: "LOGO-" + randomBytes(4).toString("hex"),
    })
  ).body.data;
  const input = {
    name: "Logo Site",
    templateId: "machinery",
    targetMarkets: ["United States"],
    language: "en",
    brandColor: "#126a54",
    logoId,
    productIds: [product.id],
  };
  assert.equal((await b.client.request("POST", "/sites", input)).status, 404);
  assert.equal((await a.client.request("POST", "/sites", input)).status, 201);
  assert.equal(
    (await a.client.request("DELETE", "/assets/" + logoId)).status,
    409,
  );
});
test("full-width numbers and spelled-out founding claims do not bypass the fact gate", async () => {
  const { validatePage } = await import(
    "../src/services/page-validation.service"
  );
  assert(
    validatePage(draft("Founded in nineteen ninety eight."), [], {
      type: "home",
      productIds: [],
    }).some((i) => i.code === "UNSOURCED_YEAR"),
  );
  assert(
    validatePage(draft("Founded in １９９８."), [], {
      type: "home",
      productIds: [],
    }).some((i) => i.code === "UNSOURCED_NUMBER"),
  );
  assert(
    !validatePage(draft("Reach our team to discuss your project."), [], {
      type: "home",
      productIds: [],
    }).some((i) => i.code === "UNSOURCED_CERTIFICATION"),
  );
});

test("confirmed sitemap path swaps retire old routes, preserve drafts and require a new review", async () => {
  let site = await planSite(await newSite(), [
    home,
    { ...home, key: "about", path: "/about", type: "about", parentKey: "home" },
    {
      ...home,
      key: "contact",
      path: "/contact",
      type: "contact",
      parentKey: "home",
    },
  ]);
  const pages: any[] = [];
  for (const nodeKey of ["about", "contact"])
    pages.push(
      (
        await a.client.request("POST", "/sites/" + site.id + "/pages", {
          nodeKey,
        })
      ).body.data,
    );
  const nodes = site.plan.nodes.map((n: any) =>
    n.key === "about"
      ? { ...n, path: "/contact" }
      : n.key === "contact"
        ? { ...n, path: "/about" }
        : n,
  );
  site = (
    await a.client.request("PUT", "/sites/" + site.id + "/plan", {
      revision: site.planRevision,
      nodes,
      keywords: [],
      clusters: [],
    })
  ).body.data;
  site = (
    await a.client.request("POST", "/sites/" + site.id + "/plan/confirm", {
      revision: site.planRevision,
    })
  ).body.data;
  for (const page of pages) {
    const current = (await a.client.request("GET", "/pages/" + page.id)).body
      .data;
    assert.equal(current.status, "blocked");
    assert(!current.path.includes("__drafts"));
    assert.equal(
      (
        await a.client.request("PATCH", "/pages/" + page.id, {
          revision: current.revision,
          data: draft(),
        })
      ).status,
      200,
    );
  }
  const current = (
    await a.client.request("GET", "/sites/" + site.id + "/pages")
  ).body.data.items;
  assert.deepEqual(current.map((p: any) => p.path).sort(), [
    "/about",
    "/contact",
  ]);
});

test("product material and nonnumeric specification rows need matching confirmed details", async () => {
  const { placeholder } = await import("../src/services/sites.service"),
    { validatePage } = await import("../src/services/page-validation.service"),
    productId = "b".repeat(24);
  const data = placeholder({ type: "product", title: "Product details" });
  data.blocks.find((b) => b.key === "material")!.body = "Steel";
  assert(
    validatePage(data, [], {
      type: "product",
      productIds: [productId],
      productId,
    }).some((i) => i.code === "UNSOURCED_DETAIL"),
  );
  const fact = {
      id: "a".repeat(24),
      revision: 2,
      status: "confirmed",
      type: "product.material",
      value: "Steel",
      subjectType: "product",
      subjectId: productId,
    },
    ref = { factId: fact.id, revision: 2 };
  data.blocks.find((b) => b.key === "material")!.refs = [ref];
  const specs = data.blocks.find((b) => b.key === "specs")!;
  specs.table!.rows = [["Material", "Steel"]];
  specs.refs = [ref];
  assert.equal(
    validatePage(data, [fact], {
      type: "product",
      productIds: [productId],
      productId,
    }).length,
    0,
  );
});

test("real provider retries metered invalid output with fresh operations and commits planning once", async () => {
  await tenant(() => m.AgentAiProvider.deleteMany({ name: "default" }));
  const { encrypt } = await import("../src/services/credential-crypto");
  const { processSiteAgent } = await import(
    "../src/services/site-agents.service"
  );
  await tenant(() =>
    m.AgentAiProvider.create({
      name: "default",
      enabled: true,
      baseUrl: "https://api.openai.com/v1",
      modelName: "fixture-local-compatible",
      secret: encrypt(
        "fixture-" + randomBytes(20).toString("hex"),
        "ai:" + a.me.organizationId,
      ),
    }),
  );
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  const plan = { nodes: [home], keywords: [], clusters: [] };
  const outputs = [
    "Please clarify the website planning task.",
    JSON.stringify({ ...plan, nodes: [{ ...home, type: "unsupported" }] }),
    JSON.stringify(plan),
  ];
  let calls = 0;
  mock.method(globalThis, "fetch", async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages[1].content, /^Execute the website task now/);
    assert(body.messages[1].content.includes(body.messages[0].content));
    assert.match(
      body.messages[0].content,
      /Allowed node.type values: home,category,product/,
    );
    assert.match(
      body.messages[0].content,
      /Allowed intent values: learn,compare,specify,source,buy/,
    );
    assert.equal(body.model, "fixture-local-compatible");
    return new Response(
      JSON.stringify({
        usage: { total_tokens: 23 },
        choices: [{ message: { content: outputs[calls++] } }],
      }),
    );
  });
  const site = await newSite();
  const queued = await queue(site, "research");
  const task = await taskFor(queued.body.data.id);
  for (const expected of ["pending", "pending", "done"]) {
    const result = await tenant(() => processSiteAgent(task));
    assert.equal(result.status, expected);
  }
  const run = await tenant(() => m.AgentRun.findById(queued.body.data.id));
  assert.equal(run!.status, "succeeded");
  assert.equal(run!.steps[0].attempts, 3);
  assert.equal(run!.tokens, 69);
  const records = await tenant(() =>
    m.UsageRecord.find({
      operationId: { $regex: "^site:" + run!._id + ":" },
    }),
  );
  assert.equal(records.length, 3);
  assert(records.every((r) => r.state === "settled" && r.actual === 23));
  const updated = await tenant(() => m.Site.findById(site.id));
  assert.equal(updated!.planRevision, site.planRevision + 1);
  assert.equal((await tenant(() => processSiteAgent(task))).status, "done");
  assert.equal(calls, 3);
});
