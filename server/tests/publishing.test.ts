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

async function newSite(productIds: string[] = []) {
  const r = await a.client.request("POST", "/sites", {
    name: "Fixture Export",
    templateId: "machinery",
    targetMarkets: ["United States"],
    language: "en",
    brandColor: "#126a54",
    logoId: null,
    productIds,
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

beforeEach(async () => {
  await tenant(() => m.Site.updateMany({}, { $set: { status: "archived" } }));
});
const text =
  "Our team helps buyers explore product options and prepare a clear purchasing brief. Share your application, preferred materials, packaging requirements and intended market with our team. We will discuss the details with you before preparing a proposal. Browse the information below to learn about our approach and find the right contact for your project. Product details are reviewed by our team before publication.";
async function prepared(buyer = false, productIds: string[] = []) {
  let initial = await newSite(productIds);
  if (buyer)
    initial = (
      await a.client.request("PATCH", "/sites/" + initial.id, {
        revision: initial.revision,
        data: {
          name: initial.name,
          templateId: initial.templateId,
          targetMarkets: initial.targetMarkets,
          language: "en",
          brandColor: initial.brandColor,
          logoId: null,
          productIds,
          buyerProfile: {
            businessModel: "wholesale",
            audiences: ["Retail buyers"],
            buyerNeeds: [],
            primaryAction: "quote",
            referenceUrls: [],
          },
        },
      })
    ).body.data;
  const s = await planSite(initial);
  const page = await a.client.request("POST", "/sites/" + s.id + "/pages", {
    nodeKey: "home",
  });
  assert.equal(page.status, 201);
  let p = page.body.data;
  p = (
    await a.client.request("PATCH", "/pages/" + p.id, {
      revision: p.revision,
      data: draft(text),
    })
  ).body.data;
  assert.equal(
    (
      await a.client.request("POST", "/pages/" + p.id + "/approve", {
        revision: p.revision,
      })
    ).status,
    200,
  );
  const r = await a.client.request(
    "PUT",
    "/sites/" + s.id + "/publishing-settings",
    {
      revision: 0,
      canonicalBaseUrl: "https://fixture.example.invalid",
      accountId: null,
      projectName: null,
      productionBranch: "main",
      domain: null,
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return s;
}
async function build(s: any, key = randomUUID()) {
  const url = "/sites/" + s.id + "/builds",
    r = await a.client.make("POST", url).set("Idempotency-Key", key).send({});
  a.client.check(r, "POST", url);
  if (r.status === 202) assertRequest("POST", url, {});
  return r;
}
async function processRun(v: any, kind = "site.build") {
  const task = await liveTask(v.id, kind);
  assert(task);
  return tenant(async () => {
    const p = await import("../src/services/publishing.service");
    return p.processPublishing(task);
  });
}
test("preflight, real Astro build, immutable zip, private noindex preview, tenant and RBAC gates", async () => {
  const s = await prepared();
  assert.equal(
    (await a.client.request("GET", "/sites/" + s.id + "/preflight")).body.data
      .ready,
    true,
  );
  const queued = await build(s);
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  const v = queued.body.data;
  assert.deepEqual(await processRun(v), { status: "done" });
  const result = await a.client.request("GET", "/site-versions/" + v.id);
  assert.equal(result.body.data.status, "ready");
  assert(result.body.data.artifactHash);
  const zip = await a.client.make("GET", "/site-versions/" + v.id + "/export");
  assert.equal(zip.status, 200);
  const { unpack, outputChecks } = await import(
    "../src/services/static-builder.service"
  );
  const bytes = await tenant(async () => {
    const raw = await m.SiteVersion.findById(v.id);
    return (await import("../src/services/storage.service")).readArtifact(
      raw.artifactKey,
    );
  });
  const files = unpack(bytes);
  assert.deepEqual(outputChecks(files), []);
  const html = Buffer.from(files["index.html"]).toString();
  assert(html.includes(text));
  assert(!html.includes("noindex"));
  assert(html.includes('rel="canonical"'));
  assert(html.includes("application/ld+json"));
  assert(!html.includes('type="module"'));
  for (const name of [
    "sitemap.xml",
    "robots.txt",
    "llms.txt",
    "globalsite-manifest.json",
  ])
    assert(files[name]);
  assert(Buffer.from(files["robots.txt"]).toString().includes("OAI-SearchBot"));
  const preview = await a.client.make(
    "GET",
    "/site-versions/" + v.id + "/preview/",
  );
  assert.equal(preview.status, 200);
  assert(preview.text.includes("noindex,nofollow"));
  assert.equal(preview.headers["x-robots-tag"], "noindex, nofollow");
  assert(preview.text.includes("/preview/assets/site.css"));
  assert.equal(
    (await supertest(app).get("/api/v1/site-versions/" + v.id + "/preview/"))
      .status,
    401,
  );
  assert.equal(
    (await b.client.request("GET", "/site-versions/" + v.id)).status,
    404,
  );
  assert.equal(
    (await b.client.request("GET", "/sites/" + s.id + "/versions")).status,
    404,
  );
  await role("viewer");
  assert.equal((await build(s)).status, 403);
  assert.equal(
    (await a.client.request("POST", "/sites/" + s.id + "/preflight/repair", {}))
      .status,
    403,
  );
  await role("editor");
  assert.equal(
    (
      await a.client.request(
        "PUT",
        "/sites/" + s.id + "/publishing-settings",
        {},
      )
    ).status,
    403,
  );
  await assert.rejects(() => m.SiteVersion.find(), /TENANT_REQUIRED/);
  await assert.rejects(() => m.SiteDeployment.find(), /TENANT_REQUIRED/);
  const { HtmlValidate } = await import("html-validate");
  const validation = await new HtmlValidate({
    extends: ["html-validate:recommended"],
    rules: {
      "no-inline-style": "off",
      "heading-level": "off",
      "wcag/h32": "off",
    },
  }).validateString(html);
  assert.equal(
    validation.valid,
    true,
    JSON.stringify(validation.results.flatMap((r) => r.messages)),
  );
});
test("build idempotency, concurrent active lock, quota settlement once, stale fencing and unsafe facts block", async () => {
  const s = await prepared(),
    key = randomUUID();
  const [x, y] = await Promise.all([build(s, key), build(s, key)]);
  assert.equal(x.status, 202);
  assert.equal(y.status, 202);
  assert.equal(x.body.data.id, y.body.data.id);
  assert.equal((await build(s)).status, 409);
  const v = x.body.data;
  await processRun(v);
  await processRun(v);
  const count = await tenant(() =>
    m.UsageRecord.find({ metric: "builds", operationId: "build:" + key }),
  );
  assert.equal(count.length, 1);
  assert.equal(count[0].actual, 1);
  const next = await build(s);
  const task = await liveTask(next.body.data.id, "site.build");
  await tenant(() =>
    m.Task.updateOne({ _id: task._id }, { $inc: { fencingToken: 1 } }),
  );
  await assert.rejects(() =>
    tenant(async () =>
      (await import("../src/services/publishing.service")).processPublishing(
        task,
      ),
    ),
  );
  assert.equal(
    (await a.client.request("GET", "/site-versions/" + next.body.data.id)).body
      .data.status,
    "queued",
  );
  const pages = (await a.client.request("GET", "/sites/" + s.id + "/pages"))
    .body.data.items;
  await a.client.request("PATCH", "/pages/" + pages[0].id, {
    revision: pages[0].revision,
    data: draft("Founded in 1998. " + text),
  });
  const r = await a.client.request("GET", "/sites/" + s.id + "/preflight");
  assert.equal(r.body.data.ready, false);
  assert(
    r.body.data.issues.some(
      (i: any) => i.code === "UNSOURCED_NUMBER" || i.code === "UNSOURCED_YEAR",
    ),
  );
  assert.equal((await build(s)).status, 409);
});
test("repair derives existing text only and clears approval; private URLs and unconfigured cloud degrade safely", async () => {
  const s = await prepared(),
    pages = (await a.client.request("GET", "/sites/" + s.id + "/pages")).body
      .data.items,
    p = pages[0];
  const data = { ...draft(text), metaDescription: "" };
  assert.equal(
    (
      await a.client.request("PATCH", "/pages/" + p.id, {
        revision: p.revision,
        data,
      })
    ).status,
    200,
  );
  const repaired = await a.client.request(
    "POST",
    "/sites/" + s.id + "/preflight/repair",
    {},
  );
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.data.repaired, 1);
  const p2 = (await a.client.request("GET", "/pages/" + p.id)).body.data;
  assert.equal(p2.metaDescription, text.slice(0, 160));
  assert.notEqual(p2.status, "approved");
  const cfg = (
    await a.client.request("GET", "/sites/" + s.id + "/publishing-settings")
  ).body.data;
  assert.equal(
    (
      await a.client.request("PUT", "/sites/" + s.id + "/publishing-settings", {
        ...{
          revision: cfg.revision,
          canonicalBaseUrl: "https://localhost/",
          accountId: null,
          projectName: null,
          productionBranch: "main",
          domain: null,
        },
      })
    ).status,
    400,
  );
  await a.client.request("POST", "/pages/" + p.id + "/approve", {
    revision: p2.revision,
  });
  const v = (await build(s)).body.data;
  await processRun(v);
  const url = "/sites/" + s.id + "/deployments",
    r = await a.client
      .make("POST", url)
      .set("Idempotency-Key", randomUUID())
      .send({ versionId: v.id });
  a.client.check(r, "POST", url);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "CLOUDFLARE_UNCONFIGURED");
});
test("publication and rollback reuse exact artifact, encrypted config audited, uncertain remote POST is not duplicated", async () => {
  const s = await prepared(),
    secret = randomBytes(32).toString("hex");
  const cfg = await a.client.request(
    "PUT",
    "/sites/" + s.id + "/publishing-settings",
    {
      revision: 1,
      canonicalBaseUrl: "https://fixture-pages.pages.dev",
      accountId: "a".repeat(32),
      projectName: "fixture-pages",
      productionBranch: "main",
      domain: null,
      token: secret,
    },
  );
  assert.equal(cfg.status, 200);
  assert(!JSON.stringify(cfg.body).includes(secret));
  await tenant(async () => {
    const raw = await m.PublishingSettings.findOne({ siteId: s.id }).select(
      "+secret",
    );
    assert(raw.secret.ciphertext);
    assert(!JSON.stringify(raw).includes(secret));
    assert(
      !(await m.AuditLog.find({ targetId: s.id })).some((v) =>
        JSON.stringify(v).includes(secret),
      ),
    );
  });
  const cf = await import("../src/services/cloudflare-pages.service");
  let posted = 0;
  const uploads: Record<string, Uint8Array>[] = [];
  mock.method(
    cf.pagesClient,
    "uploadFiles",
    async (_cfg: any, _token: any, files: any) => {
      uploads.push(files);
      return {};
    },
  );
  mock.method(cf.pagesClient, "submitDeployment", async () => ({
    id: "b".repeat(8) + "-" + randomUUID().slice(9),
    url: "https://deployment.fixture-pages.pages.dev",
    n: ++posted,
  }));
  mock.method(cf.pagesClient, "verifyDeployment", async () => true);
  async function deploy(v: any, kind = "deployments") {
    const url = "/sites/" + s.id + "/" + kind,
      r = await a.client
        .make("POST", url)
        .set("Idempotency-Key", randomUUID())
        .send({ versionId: v.id });
    a.client.check(r, "POST", url);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const d = r.body.data;
    assert.deepEqual(await processRun(d, "site.deploy"), { status: "done" });
    return d;
  }
  const v1 = (await build(s)).body.data;
  await processRun(v1);
  await deploy(v1);
  const pages = (await a.client.request("GET", "/sites/" + s.id + "/pages"))
      .body.data.items,
    p = pages[0];
  const next = (
    await a.client.request("PATCH", "/pages/" + p.id, {
      revision: p.revision,
      data: draft(
        text + " Please contact the purchasing support team for assistance.",
      ),
    })
  ).body.data;
  await a.client.request("POST", "/pages/" + p.id + "/approve", {
    revision: next.revision,
  });
  const v2 = (await build(s)).body.data;
  await processRun(v2);
  await deploy(v2);
  const rollback = await deploy(v1, "rollback");
  assert.notDeepEqual(uploads[0]["index.html"], uploads[1]["index.html"]);
  assert.deepEqual(uploads[0], uploads[2]);
  assert.equal(posted, 3);
  assert.equal(
    String((await tenant(() => m.Site.findById(s.id))).currentDeploymentId),
    rollback.id,
  );
  // An ambiguous create response remains locked and is reconciled, never auto submitted twice.
  (cf.pagesClient.submitDeployment as any).mock.mockImplementation(async () => {
    posted++;
    throw Error("synthetic transport failure");
  });
  mock.method(cf.pagesClient, "request", async () => []);
  const url = "/sites/" + s.id + "/deployments",
    r = await a.client
      .make("POST", url)
      .set("Idempotency-Key", randomUUID())
      .send({ versionId: v2.id });
  assert.equal(r.status, 202);
  assert.equal(
    (await processRun(r.body.data, "site.deploy")).status,
    "pending",
  );
  assert.equal(
    (await processRun(r.body.data, "site.deploy")).status,
    "pending",
  );
  assert.equal(posted, 4);
  const currentPage = (await a.client.request("GET", "/pages/" + p.id)).body
    .data;
  assert.equal(
    (
      await a.client.request("PATCH", "/pages/" + p.id, {
        revision: currentPage.revision,
        data: draft(text),
      })
    ).body.error.code,
    "PUBLICATION_IN_PROGRESS",
  );
  const currentCfg = (
    await a.client.request("GET", "/sites/" + s.id + "/publishing-settings")
  ).body.data;
  const { canonicalBaseUrl, accountId, projectName, productionBranch, domain } =
    currentCfg;
  assert.equal(
    (
      await a.client.request("PUT", "/sites/" + s.id + "/publishing-settings", {
        revision: currentCfg.revision,
        canonicalBaseUrl,
        accountId,
        projectName,
        productionBranch,
        domain,
        token: randomBytes(32).toString("hex"),
      })
    ).status,
    200,
  );
  await tenant(() =>
    m.Task.updateOne(
      { kind: "site.deploy", "payload.runId": r.body.data.id },
      { $set: { status: "dead" } },
    ),
  );
  const reconcile = await a.client.request(
    "POST",
    "/site-deployments/" + r.body.data.id + "/reconcile",
    {},
  );
  assert.equal(reconcile.status, 200);
  (cf.pagesClient.request as any).mock.mockImplementation(async () => [
    {
      id: randomUUID(),
      deployment_trigger: {
        metadata: { commit_message: "GlobalSite " + r.body.data.id },
      },
    },
  ]);
  assert.equal((await processRun(r.body.data, "site.deploy")).status, "done");
  assert.equal(posted, 4);
});
test("Cloudflare adapter uses signed upload JWT, manifest hashes and fixed API origin", async () => {
  const cf = await import("../src/services/cloudflare-pages.service"),
    calls: any[] = [];
  mock.method(globalThis, "fetch", async (url: any, init: any) => {
    calls.push({ url, init });
    let result: any = {};
    if (url.endsWith("/upload-token"))
      result = { jwt: "synthetic-upload-authorization" };
    else if (url.endsWith("/check-missing"))
      result = JSON.parse(init.body).hashes;
    else if (url.endsWith("/deployments"))
      result = {
        id: "11111111-1111-4111-8111-111111111111",
        url: "https://synthetic.fixture-pages.pages.dev",
      };
    else if (url.endsWith("/fixture-pages"))
      result = { production_branch: "main", source: null };
    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
    });
  });
  const cfg = {
      accountId: "a".repeat(32),
      projectName: "fixture-pages",
      productionBranch: "main",
    },
    files = {
      "index.html": Buffer.from("<!doctype html>fixture"),
      "assets/a.webp": Buffer.from("synthetic"),
    },
    manifest = await cf.uploadFiles(
      cfg,
      "synthetic-service-authorization",
      files,
    );
  assert.equal(
    manifest["/index.html"],
    cf.assetHash("index.html", files["index.html"]),
  );
  await cf.submitDeployment(
    cfg,
    "synthetic-service-authorization",
    manifest,
    "operation",
  );
  assert(
    calls.every((c) =>
      c.url.startsWith("https://api.cloudflare.com/client/v4/"),
    ),
  );
  const upload = calls.find((c) => c.url.endsWith("/pages/assets/upload"));
  assert.equal(
    upload.init.headers.Authorization,
    "Bearer synthetic-upload-authorization",
  );
  assert(JSON.parse(upload.init.body).every((v: any) => v.base64 === true));
});

test("build source changes invalidate queued work; build and publication quota caps reject before queuing", async () => {
  const s = await prepared(),
    v = (await build(s)).body.data,
    p = (await a.client.request("GET", "/sites/" + s.id + "/pages")).body.data
      .items[0];
  await a.client.request("PATCH", "/pages/" + p.id, {
    revision: p.revision,
    data: draft(text + " Contact our team for purchasing assistance."),
  });
  const outcome = await processRun(v);
  assert.equal(outcome.status, "dead");
  const failed = (await a.client.request("GET", "/site-versions/" + v.id)).body
    .data;
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "VERSION_SOURCE_CHANGED");
  const next = (await a.client.request("GET", "/pages/" + p.id)).body.data;
  await a.client.request("POST", "/pages/" + p.id + "/approve", {
    revision: next.revision,
  });
  await tenant(() =>
    m.UsageBucket.updateOne(
      { metric: "builds", period: new Date().toISOString().slice(0, 7) },
      { $set: { consumed: 20, reserved: 0 } },
      { upsert: true },
    ),
  );
  assert.equal((await build(s)).body.error.code, "QUOTA_EXCEEDED");
  await tenant(() =>
    m.UsageBucket.updateOne(
      { metric: "builds" },
      { $set: { consumed: 0, reserved: 0 } },
    ),
  );
});
test("withdrawn confirmed facts invalidate immutable exports and publication; snapshots never include unreferenced company facts", async () => {
  const s = await prepared(),
    fact = await tenant(() =>
      m.FactSheet.create({
        subjectType: "organization",
        type: "company.founded",
        value: "1998",
        status: "confirmed",
        revision: 1,
        source: { kind: "manual", quote: "Synthetic fixture" },
      }),
    );
  const privateFact = await tenant(() =>
    m.FactSheet.create({
      subjectType: "organization",
      type: "company.address",
      value: "Synthetic unpublished address",
      status: "confirmed",
      revision: 1,
      source: { kind: "manual", quote: "Synthetic fixture" },
    }),
  );
  const p = (await a.client.request("GET", "/sites/" + s.id + "/pages")).body
      .data.items[0],
    data = draft(text + " Our company was founded in 1998.");
  data.blocks[0].refs = [{ factId: String(fact._id), revision: 1 }] as any;
  const updated = (
    await a.client.request("PATCH", "/pages/" + p.id, {
      revision: p.revision,
      data,
    })
  ).body.data;
  assert.equal(
    (
      await a.client.request("POST", "/pages/" + p.id + "/approve", {
        revision: updated.revision,
      })
    ).status,
    200,
  );
  const v = (await build(s)).body.data;
  await processRun(v);
  const row = await tenant(() => m.SiteVersion.findById(v.id));
  assert(!JSON.stringify(row.snapshot).includes(String(privateFact._id)));
  assert(!JSON.stringify(row.snapshot).includes(privateFact.value));
  const active = await tenant(() =>
    m.SiteDeployment.create({
      siteId: s.id,
      versionId: v.id,
      actorId: a.me.user.id,
      createdBy: a.me.user.id,
      operationId: randomUUID(),
      requestHash: "fixture",
      kind: "publish",
      artifactHash: row.artifactHash,
      active: true,
    }),
  );
  await assert.rejects(
    () =>
      tenant(() =>
        import("../src/services/catalog.service").then((c) =>
          c.transitionFact(String(fact._id), 1, "rejected", a.me.user.id),
        ),
      ),
    /PUBLICATION_IN_PROGRESS/,
  );
  await tenant(() => m.SiteDeployment.deleteOne({ _id: active._id }));
  await tenant(() =>
    m.FactSheet.updateOne(
      { _id: fact._id },
      { $set: { status: "candidate" }, $inc: { revision: 1 } },
    ),
  );
  const response = await a.client.make(
    "GET",
    "/site-versions/" + v.id + "/export",
  );
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "VERSION_FACTS_CHANGED");
});
test("logo palette uses own sanitized image and never changes approval automatically", async () => {
  const sharp = (await import("sharp")).default,
    bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#2c865d" },
    })
      .png()
      .toBuffer();
  const upload = await a.client.upload(
    "/assets",
    bytes,
    "synthetic-logo.png",
    "image/png",
  );
  assert.equal(upload.status, 201);
  const s = await newSite(),
    current = (await a.client.request("GET", "/sites/" + s.id)).body.data;
  const { name, templateId, targetMarkets, language, productIds, status } =
    current;
  assert.equal(
    (
      await a.client.request("PATCH", "/sites/" + s.id, {
        revision: current.revision,
        data: {
          name,
          templateId,
          targetMarkets,
          language,
          productIds,
          status,
          brandColor: "#16634a",
          logoId: upload.body.data.id,
        },
      })
    ).status,
    200,
  );
  const palette = await a.client.request(
    "POST",
    "/sites/" + s.id + "/brand-palette",
    {},
  );
  assert.equal(palette.status, 200);
  assert(palette.body.data.colors.length > 0);
  assert(
    palette.body.data.colors.every((c: string) => /^#[a-f0-9]{6}$/.test(c)),
  );
  assert.equal(
    (await b.client.request("POST", "/sites/" + s.id + "/brand-palette", {}))
      .status,
    404,
  );
});

test("Cloudflare verification checks production pointer, TLS content hashes and custom-domain content", async () => {
  const cf = await import("../src/services/cloudflare-pages.service"),
    files = {
      "index.html": Buffer.from("<!DOCTYPE html><html>synthetic</html>"),
      "globalsite-manifest.json": Buffer.from('{"files":{}}'),
    },
    id = randomUUID(),
    reads: any[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (url: any) =>
      new Response(
        JSON.stringify({
          success: true,
          result: url.includes("/deployments/")
            ? { latest_stage: { status: "success" } }
            : { canonical_deployment: { id } },
        }),
        { status: 200 },
      ),
  );
  mock.method(cf.websiteReader, "fetch", async (url: string, kind: string) => {
    reads.push({ url, kind });
    return {
      status: 200,
      url,
      text: Buffer.from(
        url.endsWith("index.html")
          ? files["index.html"]
          : files["globalsite-manifest.json"],
      ).toString(),
    };
  });
  assert.equal(
    await cf.verifyDeployment(
      {
        accountId: "a".repeat(32),
        projectName: "fixture-pages",
        domain: "fixture.example.invalid",
      },
      "synthetic-service-authorization",
      id,
      files,
    ),
    true,
  );
  assert.equal(reads.length, 4);
  assert(
    reads
      .filter((v) => v.url.endsWith("index.html"))
      .every((v) => v.kind === "html"),
  );
  (cf.websiteReader.fetch as any).mock.mockImplementation(
    async (url: string) => ({
      status: 200,
      url,
      text: "modified synthetic content",
    }),
  );
  await assert.rejects(
    () =>
      cf.verifyDeployment(
        { accountId: "a".repeat(32), projectName: "fixture-pages" },
        "synthetic-service-authorization",
        id,
        files,
      ),
    /DEPLOYMENT_MISMATCH/,
  );
});

test("B2B missing procurement data allows private builds and rich editor preview but blocks commercial publish", async () => {
  const s = await prepared(true);
  const queued = await build(s);
  assert.equal(queued.status, 202);
  assert.deepEqual(await processRun(queued.body.data), { status: "done" });
  const v = await tenant(() => m.SiteVersion.findById(queued.body.data.id));
  await tenant(async () => {
    const { validVersion } = await import("../src/services/publishing.service");
    await validVersion(v, true);
    await assert.rejects(
      () => validVersion(v, true, undefined, true),
      (e: any) => e.code === "PROCUREMENT_INCOMPLETE",
    );
  });
  const page = await tenant(() => m.SitePage.findOne({ siteId: s.id }));
  const preview = await a.client.request(
    "GET",
    "/pages/" + page._id + "/preview",
  );
  assert.equal(preview.status, 200);
  assert(preview.body.data.html.includes("b2b-site"));
  assert(preview.body.data.html.includes("noindex,nofollow"));
  assert(!preview.body.data.html.includes("<script"));
});

test("complete B2B procurement data still requires current administrator-accepted quality review", async () => {
  const sharp = (await import("sharp")).default;
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#aec9b8" },
  })
    .png()
    .toBuffer();
  const uploaded = await a.client.upload(
    "/assets",
    image,
    "fixture.png",
    "image/png",
  );
  const product = (
    await a.client.request("POST", "/products", {
      name: "Fixture product",
      status: "active",
      assetIds: [uploaded.body.data.id],
    })
  ).body.data;
  await tenant(async () => {
    for (const [type, value] of [
      ["company.name", "Fixture Export"],
      ["company.email", "contact@example.invalid"],
    ])
      await m.FactSheet.create({
        subjectType: "organization",
        type,
        value,
        status: "confirmed",
        source: { kind: "manual", label: "Fictional fixture" },
      });
    for (const [type, value] of [
      ["product.material", "Fixture material"],
      ["product.moq", "By agreement"],
      ["product.leadTime", "By agreement"],
      ["product.specifications", "Fixture option"],
    ])
      await m.FactSheet.create({
        subjectType: "product",
        subjectId: product.id,
        type,
        value,
        status: "confirmed",
        source: { kind: "manual", label: "Fictional fixture" },
      });
  });
  const site = await prepared(true, [product.id]);
  const queued = await build(site);
  assert.deepEqual(await processRun(queued.body.data), { status: "done" });
  const version = await tenant(() =>
    m.SiteVersion.findById(queued.body.data.id),
  );
  const { validVersion } = await import("../src/services/publishing.service");
  await tenant(() =>
    assert.rejects(
      () => validVersion(version, true, undefined, true),
      (e: any) => e.code === "QUALITY_REVIEW_REQUIRED",
    ),
  );
  const run = await a.client
    .make("POST", "/sites/" + site.id + "/agent-runs")
    .set("Idempotency-Key", randomUUID())
    .send({ step: "review", consent: true });
  assert.equal(run.status, 202);
  const task = await liveTask(run.body.data.id, "site.agent");
  const { processSiteAgent } = await import(
    "../src/services/site-agents.service"
  );
  await tenant(() =>
    processSiteAgent(
      task,
      async (_s, _i, _o, save) => {
        const result = {
          output: { summary: "Fictional review fixture", findings: [] },
          tokens: 10,
        };
        await save(result);
        return result;
      },
      async () => ({
        artifactKey: randomUUID(),
        metrics: [375, 768, 1440].map((width) => ({
          width,
          overflow: false,
          height: 1000,
          words: 80,
          headings: ["Fixture"],
          brokenImages: 0,
          blankSections: 0,
        })),
      }),
    ),
  );
  const accepted = await a.client.request(
    "POST",
    "/agent-runs/" + run.body.data.id + "/accept-review",
    {},
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  await tenant(() => validVersion(version, true, undefined, true));
  const page = await tenant(() => m.SitePage.findOne({ siteId: site.id }));
  await a.client.request("PATCH", "/pages/" + page._id, {
    revision: page.revision,
    data: draft(text + " Contact our team about your market."),
  });
  await tenant(() =>
    assert.rejects(() => validVersion(version, true, undefined, true)),
  );
});
