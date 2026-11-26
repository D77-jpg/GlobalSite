// S35 stage B/C and B2 integration tests: demo mode, AI fact suggestions,
// illustration fill, logo candidates and the image-service compatibility path.
import { before, after, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dns from "node:dns/promises";
import mongoose from "mongoose";
import supertest from "supertest";
import sharp from "sharp";
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
  async upload(url: string, bytes: Buffer, fileName: string, mime: string) {
    return this.check(
      await this.make("POST", url)
        .field("kind", "image")
        .attach("file", bytes, { filename: fileName, contentType: mime }),
      "POST",
      url,
    );
  }
}
async function account() {
  const client = new Client(),
    email = randomUUID() + "@example.invalid";
  const reg = await client.request("POST", "/auth/register", {
    name: "S35 Fixture",
    email,
    password,
    organizationName: "S35 Fixture",
    locale: "en",
  });
  assert.equal(reg.status, 202);
  const mail = await client.request("GET", "/dev/mail/" + reg.body.data.devReceipt),
    token = new URL(mail.body.data.text).searchParams.get("token");
  assert.equal((await client.request("POST", "/auth/verify-email", { token })).status, 200);
  assert.equal((await client.request("POST", "/auth/login", { email, password })).status, 200);
  return { client, me: (await client.request("GET", "/auth/me")).body.data };
}
const tenant = <T>(fn: () => Promise<T>) => ctx.runWithTenant(a.me.organizationId, fn);
async function liveTask(runId: string, kind: string) {
  return tenant(() =>
    m.Task.findOneAndUpdate(
      { "payload.runId": runId, kind },
      {
        $set: { status: "running", owner: "fixture", leaseUntil: new Date(Date.now() + 60000) },
        $inc: { fencingToken: 1, attempts: 1 },
      },
      { new: true, sort: { _id: -1 } },
    ),
  );
}
async function role(value: string) {
  return tenant(() => m.Membership.updateOne({ userId: a.me.user.id }, { $set: { role: value } }));
}
before(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "globalsite-s35-"));
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
  await tenant(() => m.Site.updateMany({}, { $set: { status: "archived" } }));
  await tenant(() => m.AgentRun.updateMany({}, { $set: { active: false } }));
  await tenant(() => m.AgentAiProvider.deleteMany({ name: "images" }));
});
after(async () => {
  mock.restoreAll();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (storage) {
    assert.equal(path.dirname(storage), path.resolve(os.tmpdir()));
    assert(path.basename(storage).startsWith("globalsite-s35-"));
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
  keywords: ["espresso equipment"],
  intent: "source",
};
async function newPlannedSite() {
  let r = await a.client.request("POST", "/sites", {
    name: "Verona Fixture",
    templateId: "machinery",
    targetMarkets: ["United States"],
    language: "en",
    brandColor: "#126a54",
    logoId: null,
    productIds: [],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const site = r.body.data;
  r = await a.client.request("PUT", "/sites/" + site.id + "/plan", {
    revision: site.planRevision,
    nodes: [home],
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
async function demoFact(value = "12000") {
  return tenant(() =>
    m.FactSheet.create({
      subjectType: "organization",
      type: "company.capacity",
      value,
      unit: "units",
      status: "candidate",
      originKey: "fixture:" + randomUUID(),
      source: {
        kind: "ai-suggested",
        runId: new mongoose.Types.ObjectId().toString(),
        quote: "AI-suggested demonstration value",
        capturedAt: new Date().toISOString(),
      },
    }),
  );
}
const png = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#f4efe6" } })
    .png()
    .toBuffer();

test("demo mode: candidate AI facts are citable in preview only; approval and versions stay blocked", async () => {
  const site = await newPlannedSite();
  const fact = await demoFact();
  let page = (await a.client.request("POST", "/sites/" + site.id + "/pages", { nodeKey: "home" })).body.data;
  const data = {
    title: "Espresso equipment",
    metaDescription: "Commercial espresso machines for busy cafes.",
    refs: [],
    blocks: [
      {
        key: "output",
        type: "text",
        heading: "Built for volume",
        body: "Annual output reaches 12000 units.",
        table: null,
        faq: [],
        assetId: null,
        alt: "",
        refs: [{ factId: String(fact._id), revision: 1 }],
      },
    ],
  };
  let r = await a.client.request("PATCH", "/pages/" + page.id, { revision: page.revision, data });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  page = r.body.data;
  const codes = (p: any) => p.issues.map((i: any) => i.code);
  assert.ok(codes(page).includes("FACT_REFERENCE_STALE"));

  // Only admins switch demo mode; other organizations cannot see the site.
  await role("editor");
  r = await a.client.request("PATCH", "/sites/" + site.id + "/options", { revision: site.revision, demoMode: true });
  assert.equal(r.status, 403);
  await role("admin");
  r = await b.client.request("PATCH", "/sites/" + site.id + "/options", { revision: site.revision, demoMode: true });
  assert.equal(r.status, 404);
  r = await a.client.request("PATCH", "/sites/" + site.id + "/options", { revision: site.revision, demoMode: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.demoMode, true);
  assert.equal(r.body.data.revision, site.revision);

  page = (await a.client.request("GET", "/pages/" + page.id)).body.data;
  assert.ok(!codes(page).includes("FACT_REFERENCE_STALE"));
  assert.ok(!codes(page).includes("UNSOURCED_NUMBER"));
  assert.ok(codes(page).includes("DEMO_FACTS_UNCONFIRMED"));
  r = await a.client.request("POST", "/pages/" + page.id + "/approve", { revision: page.revision });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "DEMO_FACTS_UNCONFIRMED");
  const preview = await a.client.request("GET", "/pages/" + page.id + "/preview");
  assert.match(preview.body.data.html, /Demo content, not confirmed by the company/);
  const ready = (await a.client.request("GET", "/sites/" + site.id + "/readiness")).body.data;
  assert.equal(ready.ready, false);
  assert.ok(ready.pages[0].issues.some((i: any) => i.code === "DEMO_FACTS_UNCONFIRMED"));

  // A frozen Agent snapshot keeps the candidate with its real status.
  const queued = await a.client
    .make("POST", "/sites/" + site.id + "/agent-runs")
    .set("Idempotency-Key", randomUUID())
    .send({ step: "content", consent: true });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  const run = await tenant(() => m.AgentRun.findById(queued.body.data.id));
  const frozen = run!.inputSnapshot.facts.find((f: any) => f.id === String(fact._id));
  assert.equal(frozen?.status, "candidate");
  assert.equal(frozen?.source?.kind, "ai-suggested");
  assert.equal(run!.inputSnapshot.site.demoMode, true);
  r = await a.client.request("PATCH", "/sites/" + site.id + "/options", { revision: site.revision, demoMode: false });
  assert.equal(r.status, 409);
  await tenant(() => m.AgentRun.updateOne({ _id: run!._id }, { $set: { active: false } }));
  r = await a.client.request("PATCH", "/sites/" + site.id + "/options", { revision: site.revision, demoMode: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.demoMode, undefined);
  page = (await a.client.request("GET", "/pages/" + page.id)).body.data;
  assert.ok(codes(page).includes("FACT_REFERENCE_STALE"));
  const { assertSnapshot } = await import("../src/services/agents/runtime");
  await assert.rejects(tenant(() => assertSnapshot(run as any)), /SOURCE_CHANGED/);

  // A version that references a candidate fact is refused by the existing gate.
  const { validVersion } = await import("../src/services/publishing.service");
  await assert.rejects(
    tenant(() =>
      validVersion({
        siteId: site.id,
        snapshot: {
          site: { productIds: [], name: site.name },
          facts: [{ id: String(fact._id), revision: 1 }],
          pages: [],
        },
      }),
    ),
    /VERSION_FACTS_CHANGED/,
  );
});

test("AI fact suggestions are billed once, deduplicated, isolated and reviewable", async () => {
  // In-memory test database only: start from an empty fact library.
  await tenant(() => m.FactSheet.deleteMany({}));
  const site = await newPlannedSite();
  const { processFactSuggestions } = await import("../src/services/fact-suggest.service");
  const { reserve } = await import("../src/services/usage.service");
  let r = await a.client.request("POST", "/sites/" + site.id + "/fact-suggestions", { consent: true });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const first = r.body.data.id;
  assert.equal((await b.client.request("GET", "/fact-suggestions/" + first)).status, 404);
  let calls = 0;
  const fake = async (input: any, _op: string, save: any) => {
    // Only the first run sees capacity as missing; later runs must not re-ask
    // for a slot that already holds a candidate suggestion.
    assert.equal(
      input.missing.some((x: any) => x.type === "company.capacity"),
      calls++ === 0,
    );
    const result = {
      items: [
        { type: "company.capacity", subjectId: null, value: "12000", unit: "units per year", rationale: "Typical" },
        { type: "company.certifications", subjectId: null, value: "ISO 9001" },
      ],
      tokens: 42,
      rejectedCount: 0,
    };
    await save(result);
    return result;
  };
  await tenant(async () => processFactSuggestions((await liveTask(first, "catalog.suggest")) as any, fake as any));
  r = await a.client.request("GET", "/fact-suggestions/" + first);
  assert.equal(r.body.data.status, "complete");
  assert.equal(r.body.data.resultIds.length, 1);
  const listed = await a.client.request("GET", "/facts?source=ai-suggested");
  assert.equal(listed.status, 200);
  const capacity = listed.body.data.items.find((f: any) => f.type === "company.capacity");
  assert.equal(capacity.status, "candidate");
  assert.equal(capacity.source.kind, "ai-suggested");
  assert.equal(capacity.source.runId, first);
  assert.ok(!listed.body.data.items.some((f: any) => f.type === "company.certifications"));

  // A second run does not duplicate an existing suggestion.
  r = await a.client.request("POST", "/sites/" + site.id + "/fact-suggestions", { consent: true });
  const second = r.body.data.id;
  await tenant(async () => processFactSuggestions((await liveTask(second, "catalog.suggest")) as any, fake as any));
  assert.equal((await a.client.request("GET", "/fact-suggestions/" + second)).body.data.resultIds.length, 0);

  // A saved, already-received result is settled once and never re-requested.
  r = await a.client.request("POST", "/sites/" + site.id + "/fact-suggestions", { consent: true });
  const third = r.body.data.id;
  await tenant(() => reserve("ai_tokens", 500, "suggest:" + third));
  await tenant(() =>
    m.AgentRun.updateOne(
      { _id: third },
      { $set: { pendingResult: { items: [{ type: "company.founded", subjectId: null, value: "2009" }], tokens: 120, rejectedCount: 0 } } },
    ),
  );
  await tenant(async () =>
    processFactSuggestions((await liveTask(third, "catalog.suggest")) as any, (async () => {
      throw new Error("must not call the model again");
    }) as any),
  );
  const usage = await tenant(() => m.UsageRecord.findOne({ metric: "ai_tokens", operationId: "suggest:" + third }));
  assert.equal(usage!.state, "settled");
  assert.equal(usage!.actual, 120);

  // Human review: edit keeps the AI origin and resets to candidate; confirm works.
  r = await a.client.request("PATCH", "/facts/" + capacity.id, {
    revision: capacity.revision,
    data: {
      subjectType: "organization",
      type: "company.capacity",
      value: "12500",
      unit: "units per year",
      source: { kind: "ai-suggested", quote: "Edited by the operator", runId: first, refId: first, label: "AI suggestion" },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "candidate");
  assert.equal(r.body.data.source.kind, "ai-suggested");
  r = await a.client.request("POST", "/facts/" + capacity.id + "/confirm", { revision: r.body.data.revision });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "confirmed");
  r = await a.client.request("POST", "/facts", {
    subjectType: "organization",
    type: "company.capacity",
    value: "1",
    source: { kind: "ai-suggested", quote: "forged" },
  });
  assert.equal(r.status, 400);
});

test("illustration fill: skipped when unconfigured, capped, reused and never overwrites", async () => {
  const site = await newPlannedSite();
  const asset = await a.client.upload("/assets", await png(), "existing.png", "image/png");
  assert.equal(asset.status, 201);
  const existing = asset.body.data.id;
  await tenant(() => m.Site.updateOne({ _id: site.id }, { $set: { autoImages: true } }));
  const queued = await a.client
    .make("POST", "/sites/" + site.id + "/agent-runs")
    .set("Idempotency-Key", randomUUID())
    .send({ step: "content", consent: true });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  const runId = queued.body.data.id;
  const task = await liveTask(runId, "site.agent");
  const { fillUnitImages } = await import("../src/services/agents/auto-images");
  const { ownRun } = await import("../src/services/agents/runtime");
  const item = (title: string, assetId: string | null) => ({
    title, body: "Useful buyer guidance.", assetId, alt: assetId ? "Existing" : "", href: null, refs: [],
  });
  const output = {
    page: {
      title: "Espresso equipment",
      metaDescription: "Commercial espresso machines.",
      refs: [],
      blocks: [
        { key: "hero", type: "image", heading: "", body: "", table: null, faq: [], assetId: existing, alt: "Hero", refs: [] },
        { key: "pair", type: "split", heading: "Recommended set", body: "Grinder and machine pairing.", table: null, faq: [], assetId: null, alt: "", refs: [], items: [] },
        { key: "uses", type: "features", heading: "Where it works", body: "Busy venues.", table: null, faq: [], assetId: null, alt: "", refs: [], items: [item("Cafe", existing), item("Hotel", null), item("Office", null)] },
      ],
    },
  };
  const result = { output, tokens: 10 };
  let calls = 0;
  const generate = (async () => {
    calls++;
    return { id: existing };
  }) as any;
  const withFlag = async () => {
    const run = await tenant(() => ownRun(runId));
    run.inputSnapshot.site.autoImages = true;
    return run;
  };
  // No images provider configured: unchanged result, nothing billed.
  let out = await tenant(async () => fillUnitImages(await withFlag(), 0, result, task as any, generate));
  assert.equal(out, result);
  assert.equal(calls, 0);
  await tenant(() => m.AgentAiProvider.create({ name: "images", enabled: true, secret: { fixture: true } }));
  process.env.AUTO_IMAGE_HOME_MAX = "2";
  try {
    out = await tenant(async () => fillUnitImages(await withFlag(), 0, result, task as any, generate));
    assert.equal(calls, 2);
    const blocks = (out.output as any).page.blocks;
    assert.equal(blocks[0].assetId, existing);
    assert.equal(blocks[1].assetId, existing);
    assert.equal(blocks[2].items[0].alt, "Existing");
    assert.equal(blocks[2].items[1].assetId, existing);
    assert.equal(blocks[2].items[2].assetId, null);
    // Resume: persisted slot ids are reused without a second paid request.
    out = await tenant(async () => fillUnitImages(await withFlag(), 0, result, task as any, generate));
    assert.equal(calls, 2);
    const stored = await tenant(() => ownRun(runId));
    assert.equal(Object.keys(stored.steps[0].generatedImages ?? {}).length, 2);
  } finally {
    delete process.env.AUTO_IMAGE_HOME_MAX;
  }
});

test("logo studio: needs an image service, stores checked candidates and selects a logo", async () => {
  const site = await newPlannedSite();
  let r = await a.client.request("POST", "/sites/" + site.id + "/logo/generate", { consent: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "IMAGE_PROVIDER_MISSING");
  assert.equal((await b.client.request("GET", "/sites/" + site.id + "/logo")).status, 404);
  await tenant(() => m.AgentAiProvider.create({ name: "images", enabled: true, secret: { fixture: true } }));
  r = await a.client.request("POST", "/sites/" + site.id + "/logo/generate", { consent: true });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const runId = r.body.data.runId;
  const upload = await a.client.upload("/assets", await png(), "logo-source.png", "image/png");
  const { processLogo } = await import("../src/services/site-media.service");
  let calls = 0;
  await tenant(async () =>
    processLogo((await liveTask(runId, "catalog.logo")) as any, (async (brief: any) => {
      calls++;
      assert.equal(brief.composition, "logo");
      assert.match(brief.subject, /Verona Fixture/);
      return { id: upload.body.data.id };
    }) as any),
  );
  assert.equal(calls, 2);
  const view = (await a.client.request("GET", "/sites/" + site.id + "/logo")).body.data;
  const candidates = view.runs[0].candidates;
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((c: any) => c.spellingCheckRequired === true));
  const square = await tenant(() => m.Asset.findById(candidates[0].squareAssetId));
  assert.equal(square!.generatedConcept, true);
  const svg = await a.client.make("GET", "/sites/" + site.id + "/logo/wordmark.svg");
  assert.equal(svg.status, 200);
  assert.match(String(svg.text ?? svg.body), /Verona Fixture/);
  r = await a.client.request("PUT", "/sites/" + site.id + "/logo", { revision: view.revision, assetId: candidates[0].wideAssetId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.logoId, candidates[0].wideAssetId);
  assert.equal(r.body.data.revision, view.revision + 1);
  r = await a.client.request("PUT", "/sites/" + site.id + "/logo", { revision: r.body.data.revision, assetId: null });
  assert.equal(r.body.data.logoId, null);
});

test("image service compatibility: one downgraded retry, URL responses, billed once", async () => {
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  const r = await a.client.request("PUT", "/assets/image-provider", {
    apiKey: "fixture-not-a-real-key",
    baseUrl: "https://images.example.com/v1",
    model: "gpt-image-2.6-flare",
    mode: "images",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const bytes = await png();
  const bodies: any[] = [];
  mock.method(globalThis, "fetch", async (url: any, init: any) => {
    if (String(url).startsWith("https://cdn.images.example.com/"))
      return new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1)
      return new Response(JSON.stringify({ error: { message: "unsupported size" } }), { status: 400 });
    return Response.json({ data: [{ url: "https://cdn.images.example.com/out.png" }] });
  });
  const key = randomUUID();
  const { generateImage } = await import("../src/services/image-studio.service");
  const out = await tenant(() => generateImage({ subject: "Espresso bar scene", composition: "campaign" }, key));
  assert.ok(out.id);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].size, "1536x1024");
  assert.equal(bodies[1].size, undefined);
  assert.equal(bodies[1].model, "gpt-image-2.6-flare");
  const usage = await tenant(() => m.UsageRecord.find({ metric: "images", operationId: "image:" + key }));
  assert.equal(usage.length, 1);
  assert.equal(usage[0].state, "settled");
  assert.equal(usage[0].actual, 1);
  const asset = await tenant(() => m.Asset.findById(out.id));
  assert.equal(asset!.generatedConcept, true);
});
