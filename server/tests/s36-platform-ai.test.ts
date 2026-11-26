// S36 platform AI service and plan allowance: provider priority, managed
// settings endpoints, platform keys at the call sites (billing stays on the
// organization), the usage page fields and the ops reconciliation report.
// Every key below is a random fixture; no real provider is contacted.
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
const PLATFORM_VARS = [
  "PLATFORM_AI_BASE_URL",
  "PLATFORM_AI_API_KEY",
  "PLATFORM_AI_MODEL",
  "PLATFORM_AI_VISION_MODEL",
  "PLATFORM_AI_OUTPUT_MODE",
  "PLATFORM_IMAGE_BASE_URL",
  "PLATFORM_IMAGE_API_KEY",
  "PLATFORM_IMAGE_MODEL",
  "PLATFORM_IMAGE_MODE",
  "ALLOW_ORG_AI_KEYS",
  "PLATFORM_UPGRADE_URL",
];
const TEXT_BASE = "https://ai.platform.example.com/v1",
  IMAGE_BASE = "https://images.platform.example.com/v1",
  TEXT_MODEL = "platform-text-fixture",
  IMAGE_MODEL = "platform-image-fixture";
function clearPlatform() {
  for (const name of PLATFORM_VARS) delete process.env[name];
}
function setPlatform() {
  const keys = {
    text: "fixture-text-" + randomBytes(16).toString("hex"),
    image: "fixture-image-" + randomBytes(16).toString("hex"),
  };
  process.env.PLATFORM_AI_BASE_URL = TEXT_BASE;
  process.env.PLATFORM_AI_API_KEY = keys.text;
  process.env.PLATFORM_AI_MODEL = TEXT_MODEL;
  process.env.PLATFORM_IMAGE_BASE_URL = IMAGE_BASE;
  process.env.PLATFORM_IMAGE_API_KEY = keys.image;
  process.env.PLATFORM_IMAGE_MODEL = IMAGE_MODEL;
  process.env.PLATFORM_IMAGE_MODE = "images";
  return keys;
}
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
  async request(
    method: string,
    url: string,
    data?: unknown,
    extra: Record<string, string> = {},
  ) {
    const agent = supertest(app) as any;
    let req = agent[method.toLowerCase()]("/api/v1" + url)
      .set("Origin", origin)
      .set("Cookie", [...this.jar].map(([k, v]) => k + "=" + v).join("; "))
      .set("X-CSRF-Token", this.jar.get("gs_csrf") ?? "");
    for (const [k, v] of Object.entries(extra)) req = req.set(k, v);
    if (data !== undefined) req = req.send(data);
    const r = await req;
    if (r.status < 300 && data !== undefined) assertRequest(method, url, data);
    assertResponse(method, url, r.status, r.body, r.headers["content-type"] ?? "");
    for (const item of r.headers["set-cookie"] ?? []) {
      const [k, v] = item.split(";")[0].split("=");
      this.jar.set(k, v);
    }
    return r;
  }
}
async function account() {
  const client = new Client(),
    email = randomUUID() + "@example.invalid";
  const reg = await client.request("POST", "/auth/register", {
    name: "S36 Fixture",
    email,
    password,
    organizationName: "S36 Fixture",
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
const tenant = <T>(fn: () => Promise<T>) =>
  ctx.runWithTenant(a.me.organizationId, fn);
const png = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#f4efe6" } })
    .png()
    .toBuffer();
async function orgProvider(key: string) {
  const { encrypt } = await import("../src/services/credential-crypto");
  await tenant(() =>
    m.AgentAiProvider.create({
      name: "default",
      enabled: true,
      baseUrl: "https://org-ai.example.com/v1",
      modelName: "org-model-fixture",
      secret: encrypt(key, "ai:" + a.me.organizationId),
    }),
  );
}
before(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "globalsite-s36-"));
  process.env.STORAGE_ROOT = storage;
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: process.env.MONGOMS_VERSION },
  });
  await (await import("../src/db")).connectDatabase(mongo.getUri("globalsite"));
  m = await import("../src/models");
  ctx = await import("../src/models/tenant-context");
  app = (await import("../src/app")).createApp();
  // A developer .env may contain PLATFORM_* values; this file controls them.
  clearPlatform();
  a = await account();
  b = await account();
});
beforeEach(async () => {
  mock.restoreAll();
  clearPlatform();
  await ctx.runIdentity(() => m.RateLimit.deleteMany({}));
  await tenant(() => m.AgentAiProvider.deleteMany({}));
});
after(async () => {
  mock.restoreAll();
  clearPlatform();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (storage) {
    assert.equal(path.dirname(storage), path.resolve(os.tmpdir()));
    assert(path.basename(storage).startsWith("globalsite-s36-"));
    await fs.rm(storage, { recursive: true, force: true });
  }
});

test("S36 priority: platform first, non-production falls back to the organization, production needs ALLOW_ORG_AI_KEYS", async () => {
  const r = await import("../src/services/ai-provider-resolve");
  const { platformAiConfig } = await import("../src/config");
  const key = "fixture-" + randomBytes(16).toString("hex");
  const full = {
    PLATFORM_AI_BASE_URL: TEXT_BASE,
    PLATFORM_AI_API_KEY: key,
    PLATFORM_AI_MODEL: TEXT_MODEL,
  };
  assert.equal(r.providerSource("text", { NODE_ENV: "production", ...full }), "platform");
  assert.equal(r.providerSource("text", { NODE_ENV: "development", ...full }), "platform");
  assert.equal(r.providerSource("text", { NODE_ENV: "test" }), "organization");
  assert.equal(r.providerSource("text", { NODE_ENV: "production" }), "none");
  assert.equal(
    r.providerSource("text", { NODE_ENV: "production", ALLOW_ORG_AI_KEYS: "true" }),
    "organization",
  );
  // Text and image services are resolved independently.
  assert.equal(r.providerSource("image", { NODE_ENV: "production", ...full }), "none");
  assert.equal(r.settingsManaged("text", { NODE_ENV: "production" }), true);
  assert.equal(r.settingsManaged("text", { NODE_ENV: "test" }), false);
  assert.equal(r.settingsManaged("text", { NODE_ENV: "test", ...full }), true);
  // Incomplete or invalid platform values are ignored and reported by name only.
  const partial = platformAiConfig({
    NODE_ENV: "production",
    PLATFORM_AI_BASE_URL: TEXT_BASE,
    PLATFORM_AI_API_KEY: key,
  });
  assert.equal(partial.text, null);
  assert.ok(partial.issues.includes("PLATFORM_AI_INCOMPLETE"));
  assert.ok(!JSON.stringify(partial.issues).includes(key));
  const bad = platformAiConfig({
    PLATFORM_AI_OUTPUT_MODE: "yaml",
    PLATFORM_IMAGE_MODE: "magic",
    PLATFORM_UPGRADE_URL: "javascript:alert(1)",
  });
  for (const name of ["PLATFORM_AI_OUTPUT_MODE", "PLATFORM_IMAGE_MODE", "PLATFORM_UPGRADE_URL"])
    assert.ok(bad.issues.includes(name), name);
  assert.equal(bad.upgradeUrl, "");

  const orgKey = "fixture-org-" + randomBytes(16).toString("hex");
  await orgProvider(orgKey);
  const dev = await tenant(() => r.resolveTextProvider({ NODE_ENV: "test" }));
  assert.equal(dev?.managed, false);
  assert.equal(dev?.modelName, "org-model-fixture");
  assert.equal(dev?.apiKey(), orgKey);
  assert.equal(await tenant(() => r.resolveTextProvider({ NODE_ENV: "production" })), null);
  await assert.rejects(
    tenant(() => r.requireTextProvider({ NODE_ENV: "production" })),
    (e: any) => e.code === "AI_UNCONFIGURED",
  );
  const allowed = await tenant(() =>
    r.resolveTextProvider({ NODE_ENV: "production", ALLOW_ORG_AI_KEYS: "true" }),
  );
  assert.equal(allowed?.apiKey(), orgKey);
  const platform = await tenant(() =>
    r.resolveTextProvider({ NODE_ENV: "production", ...full }),
  );
  assert.equal(platform?.managed, true);
  assert.equal(platform?.modelName, TEXT_MODEL);
  assert.equal(platform?.supportsVision, false);
  assert.equal(platform?.apiKey(), key);
  const vision = await tenant(() =>
    r.resolveTextProvider({ ...full, PLATFORM_AI_VISION_MODEL: "platform-vision-fixture" }),
  );
  assert.equal(vision?.supportsVision, true);
  assert.equal(await tenant(() => r.resolveImageProvider({ NODE_ENV: "production" })), null);
  assert.equal(await tenant(() => r.imageProviderAvailable(undefined, { NODE_ENV: "production" })), false);
});

test("S36 managed settings never disclose model or URL; saving and testing return 409 PLATFORM_MANAGED", async () => {
  const keys = setPlatform();
  const ai = await a.client.request("GET", "/ai/provider");
  assert.equal(ai.status, 200);
  assert.deepEqual(ai.body.data, { managed: true, enabled: true, configured: true });
  const images = await a.client.request("GET", "/assets/image-provider");
  assert.equal(images.status, 200);
  assert.deepEqual(images.body.data, { managed: true, enabled: true, configured: true });
  const shown = JSON.stringify([ai.body, images.body]);
  for (const hidden of [keys.text, keys.image, TEXT_MODEL, IMAGE_MODEL, "platform.example.com"])
    assert.ok(!shown.includes(hidden), hidden);
  const saved = await a.client.request("PUT", "/ai/provider", {
    modelName: "org-model-fixture",
    baseUrl: "https://org-ai.example.com/v1",
    enabled: true,
    apiKey: "fixture-" + randomBytes(16).toString("hex"),
  });
  assert.equal(saved.status, 409);
  assert.equal(saved.body.error.code, "PLATFORM_MANAGED");
  const tested = await a.client.request("POST", "/ai/provider/test", undefined, {
    "Idempotency-Key": randomUUID(),
  });
  assert.equal(tested.status, 409);
  assert.equal(tested.body.error.code, "PLATFORM_MANAGED");
  const imageSaved = await a.client.request("PUT", "/assets/image-provider", {
    apiKey: "fixture-" + randomBytes(16).toString("hex"),
    baseUrl: "https://org-images.example.com/v1",
    model: "org-image-fixture",
  });
  assert.equal(imageSaved.status, 409);
  assert.equal(imageSaved.body.error.code, "PLATFORM_MANAGED");
  assert.equal(await tenant(() => m.AgentAiProvider.countDocuments({})), 0);
  assert.equal(await tenant(() => m.UsageRecord.countDocuments({ metric: "ai_tokens" })), 0);

  // Production without platform keys and without ALLOW_ORG_AI_KEYS: read-only, unavailable.
  clearPlatform();
  const { getProvider } = await import("../src/services/ai.service");
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.deepEqual(await tenant(() => getProvider()), {
      managed: true,
      enabled: false,
      configured: false,
    });
  } finally {
    process.env.NODE_ENV = previous;
  }

  // Not managed: organization settings behave exactly as before S36.
  const plain = await a.client.request("GET", "/ai/provider");
  assert.equal(plain.status, 200);
  assert.equal(plain.body.data.managed, undefined);
  assert.equal(plain.body.data.configured, false);
  assert.equal(typeof plain.body.data.baseUrl, "string");
  const plainImages = await a.client.request("GET", "/assets/image-provider");
  assert.equal(plainImages.body.data.configured, false);
  assert.equal(typeof plainImages.body.data.model, "string");
});

test("S36 call sites send the platform key, bill the current organization and never store the platform model", async () => {
  const keys = setPlatform();
  // An organization's own key must be ignored while the platform is configured.
  const orgKey = "fixture-org-" + randomBytes(16).toString("hex");
  await orgProvider(orgKey);
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  const bytes = await png();
  const seen: Array<{ url: string; auth: string; body: any }> = [];
  mock.method(globalThis, "fetch", async (url: any, init: any) => {
    seen.push({
      url: String(url),
      auth: new Headers(init?.headers).get("authorization") ?? "",
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    if (String(url).endsWith("/images/generations"))
      return Response.json({ data: [{ b64_json: bytes.toString("base64") }] });
    return Response.json({
      usage: { total_tokens: 21 },
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify({ ok: true }) } },
      ],
    });
  });
  const { callSiteAgent } = await import("../src/services/site-agent-provider.service");
  const op = randomUUID();
  const result = await tenant(() =>
    callSiteAgent("Return JSON", { task: "rewrite" }, op, async () => {}),
  );
  assert.equal(seen[0].url, TEXT_BASE + "/chat/completions");
  assert.equal(seen[0].auth, "Bearer " + keys.text);
  assert.equal(seen[0].body.model, TEXT_MODEL);
  assert.equal(result.tokens, 21);
  assert.equal(result.modelName, undefined);
  const record = await tenant(() =>
    m.UsageRecord.findOne({ metric: "ai_tokens", operationId: op }),
  );
  assert.equal(record?.state, "settled");
  assert.equal(record?.actual, 21);
  assert.equal(
    await ctx.runWithTenant(b.me.organizationId, () =>
      m.UsageRecord.countDocuments({ operationId: op }),
    ),
    0,
  );

  const { extractEvidence } = await import("../src/services/fact-ai.service");
  await tenant(() => extractEvidence("Founded in 2001.", undefined, randomUUID(), async () => {}));
  assert.equal(seen[1].auth, "Bearer " + keys.text);
  assert.equal(seen[1].body.model, TEXT_MODEL);

  const { generateImage } = await import("../src/services/image-studio.service");
  const imageKey = randomUUID();
  const out = await tenant(() =>
    generateImage({ subject: "Espresso bar scene", composition: "campaign" }, imageKey),
  );
  assert.ok(out.id);
  const imageCall = seen.find((s) => s.url.endsWith("/images/generations"));
  assert.equal(imageCall?.url, IMAGE_BASE + "/images/generations");
  assert.equal(imageCall?.auth, "Bearer " + keys.image);
  assert.equal(imageCall?.body.model, IMAGE_MODEL);
  const imageUsage = await tenant(() =>
    m.UsageRecord.findOne({ metric: "images", operationId: "image:" + imageKey }),
  );
  assert.equal(imageUsage?.state, "settled");
  assert.equal(imageUsage?.actual, 1);
  assert.ok(seen.every((s) => !s.auth.includes(orgKey)));
  const stored = JSON.stringify(await tenant(() => m.UsageRecord.find({}).lean()));
  assert.ok(!stored.includes(keys.text) && !stored.includes(keys.image));

  // Without platform values the organization's own provider is used again (non-production).
  clearPlatform();
  await tenant(() =>
    callSiteAgent("Return JSON", { task: "rewrite" }, randomUUID(), async () => {}),
  );
  const last = seen[seen.length - 1];
  assert.equal(last.auth, "Bearer " + orgKey);
  assert.equal(last.body.model, "org-model-fixture");
});

test("S36 usage returns the reset date and an optional upgrade link", async () => {
  const usage = (await a.client.request("GET", "/usage")).body.data;
  const now = new Date();
  assert.equal(
    usage.resetsAt,
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  );
  assert.equal(usage.upgradeUrl, null);
  process.env.PLATFORM_UPGRADE_URL = "https://upgrade.example.com/plans";
  assert.equal(
    (await a.client.request("GET", "/usage")).body.data.upgradeUrl,
    "https://upgrade.example.com/plans",
  );
  process.env.PLATFORM_UPGRADE_URL = "javascript:alert(1)";
  assert.equal((await a.client.request("GET", "/usage")).body.data.upgradeUrl, null);
  const { periodResetsAt } = await import("../src/services/usage.service");
  assert.equal(
    periodResetsAt(new Date("2026-12-31T23:59:59Z")).toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
});

test("S36 ops usage report aggregates organizations and sites, flags 80% usage and cost alerts", async () => {
  const r = await import("../src/services/ops-usage-report");
  const { parseArgs } = await import("../src/scripts/ops-usage");
  assert.equal(r.parsePeriod(undefined, new Date("2026-11-26T10:00:00Z")), "2026-11");
  assert.throws(() => r.parsePeriod("2026-13"), /PERIOD_INVALID/);
  assert.deepEqual(parseArgs(["--period", "2026-10", "--json"]), { period: "2026-10", json: true });
  assert.deepEqual(parseArgs(["--period=2026-09"]), { period: "2026-09", json: false });
  assert.throws(() => parseArgs(["--org", "x"]), /ARGUMENT_INVALID/);
  const run = "a".repeat(24),
    logoRun = "b".repeat(24),
    suggestRun = "c".repeat(24),
    site = "d".repeat(24);
  assert.deepEqual(r.operationRef("ai_tokens", "site:" + run + ":0:0:1"), { source: "site-agent", runId: run });
  assert.deepEqual(r.operationRef("images", "image:logo:" + logoRun + ":1"), { source: "logo", runId: logoRun });
  assert.deepEqual(r.operationRef("images", "image:" + randomUUID()), { source: "other", runId: null });
  const pricing = r.opsPricing({
    PLATFORM_AI_PRICE_PER_MILLION: "2",
    PLATFORM_IMAGE_PRICE: "0.05",
    PLATFORM_COST_ALERT: "0.1",
  });
  const busy = {
    id: "e".repeat(24),
    name: "Busy",
    plan: "trial",
    buckets: [
      { metric: "ai_tokens", consumed: 170000, reserved: 0 },
      { metric: "images", consumed: 3, reserved: 0 },
    ],
    records: [
      { metric: "ai_tokens", operationId: "site:" + run + ":0:0:1", state: "settled", amount: 120000, actual: 100000 },
      { metric: "ai_tokens", operationId: "suggest:" + suggestRun, state: "settled", amount: 70000, actual: 60000 },
      { metric: "ai_tokens", operationId: "extract:" + "f".repeat(24), state: "settled", amount: 20000, actual: 10000 },
      { metric: "ai_tokens", operationId: "site:" + run + ":1:0:1", state: "released", amount: 40000, actual: 0, absorbed: true, unknownReason: "timeout" },
      { metric: "images", operationId: "image:auto:" + run + ":abc", state: "settled", amount: 1, actual: 1 },
      { metric: "images", operationId: "image:logo:" + logoRun + ":0", state: "settled", amount: 1, actual: 1 },
      { metric: "images", operationId: "image:logo:" + logoRun + ":1", state: "settled", amount: 1, actual: 1 },
    ],
    runs: [
      { id: run, kind: "site.agent", siteId: site, createdAt: "2026-11-03T00:00:00Z" },
      { id: logoRun, kind: "site.logo", siteId: site, createdAt: "2026-11-04T00:00:00Z" },
      { id: suggestRun, kind: "facts.suggest", siteId: site, createdAt: "2026-11-02T00:00:00Z" },
      { id: "9".repeat(24), kind: "site.agent", siteId: site, createdAt: "2026-10-30T00:00:00Z" },
    ],
    sites: [{ id: site, name: "Verona" }],
  };
  const quiet = { id: "1".repeat(24), name: "Quiet", plan: "growth", buckets: [], records: [], runs: [], sites: [] };
  const report = r.buildReport("2026-11", [quiet, busy], pricing, new Date("2026-11-26T00:00:00Z"));
  const org = report.organizations[0];
  assert.equal(org.name, "Busy");
  assert.equal(org.aiPercent, 85);
  assert.equal(org.imagesPercent, 30);
  assert.equal(org.nearLimit, true);
  assert.equal(org.absorbed, 1);
  assert.deepEqual(org.absorbedReasons, { timeout: 1 });
  const verona = org.sites[0];
  assert.equal(verona.name, "Verona");
  assert.equal(verona.aiUnits, 160000);
  assert.equal(verona.images, 3);
  assert.equal(verona.logoImages, 2);
  assert.equal(verona.logoRuns, 1);
  assert.equal(verona.agentRuns, 1);
  assert.equal(verona.absorbed, 1);
  assert.deepEqual(org.unattributed, { aiUnits: 10000, images: 0 });
  assert.equal(org.costKnown, 0.49);
  assert.equal(org.costAbsorbedMax, 0.08);
  assert.equal(report.totals.costEstimate, 0.57);
  assert.equal(report.costAlert, true);
  assert.deepEqual(report.nearLimitOrganizations, [busy.id]);
  assert.equal(report.organizations[1].nearLimit, false);
  const text = r.formatReport(report);
  assert.match(text, /\[!\]/);
  assert.match(text, /COST ALERT/);
  assert.match(text, /Verona/);
  assert.match(text, /timeout=1/);
  const unpriced = r.buildReport("2026-11", [busy], r.opsPricing({}));
  assert.equal(unpriced.totals.costEstimate, null);
  assert.equal(unpriced.costAlert, false);
  assert.match(r.formatReport(unpriced), /PLATFORM_AI_PRICE_PER_MILLION/);
});
