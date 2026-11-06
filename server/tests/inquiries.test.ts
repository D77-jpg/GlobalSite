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

import yaml from "js-yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
const publicSpec = yaml.load(
  readFileSync(
    path.resolve(__dirname, "../../docs/api/inquiry-gateway.openapi.yaml"),
    "utf8",
  ),
) as any;
const publicAjv = new Ajv({ strict: false, allErrors: true });
addFormats(publicAjv);
function checkPublic(r: any, method: string, path: string) {
  const schema =
    publicSpec.paths[path][method].responses[r.status]?.content?.[
      "application/json"
    ]?.schema;
  assert(schema, "Undocumented public status " + r.status);
  const validate = publicAjv.compile({
    ...schema,
    components: publicSpec.components,
  });
  assert(validate(r.body), publicAjv.errorsText(validate.errors));
}
beforeEach(async () => {
  await tenant(() => m.InquiryRateBucket.deleteMany({}));
  await tenant(() => m.Site.updateMany({}, { $set: { status: "archived" } }));
});
const text =
  "Our team helps buyers explore product options and prepare a clear purchasing brief. Share your application, preferred materials, packaging requirements and intended market with our team. We will discuss the details with you before preparing a proposal. Browse the information below to learn about our approach and find the right contact for your project. Product details are reviewed by our team before publication.";
const siteOrigin = "https://inquiry.example.invalid";
async function readySite(realBuild = false, extra: any = {}) {
  const s = await planSite(await newSite()),
    page = (
      await a.client.request("POST", "/sites/" + s.id + "/pages", {
        nodeKey: "home",
      })
    ).body.data;
  const updated = (
    await a.client.request("PATCH", "/pages/" + page.id, {
      revision: page.revision,
      data: draft(text),
    })
  ).body.data;
  assert.equal(
    (
      await a.client.request("POST", "/pages/" + page.id + "/approve", {
        revision: updated.revision,
      })
    ).status,
    200,
  );
  const cfg = await a.client.request(
    "PUT",
    "/sites/" + s.id + "/inquiry-settings",
    {
      revision: 0,
      enabled: true,
      privacyReviewed: true,
      aiSpamEnabled: false,
      notificationUserIds: [],
      turnstileSiteKey: null,
      ...extra,
    },
  );
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
  let v: any;
  if (realBuild) {
    assert.equal(
      (
        await a.client.request(
          "PUT",
          "/sites/" + s.id + "/publishing-settings",
          {
            revision: 0,
            canonicalBaseUrl: siteOrigin,
            accountId: null,
            projectName: null,
            productionBranch: "main",
            domain: null,
          },
        )
      ).status,
      200,
    );
    const path = "/sites/" + s.id + "/builds",
      r = await a.client
        .make("POST", path)
        .set("Idempotency-Key", randomUUID())
        .send({});
    a.client.check(r, "POST", path);
    assert.equal(r.status, 202);
    const task = await liveTask(r.body.data.id, "site.build");
    assert.deepEqual(
      await tenant(async () =>
        (await import("../src/services/publishing.service")).processPublishing(
          task,
        ),
      ),
      { status: "done" },
    );
    v = await tenant(() => m.SiteVersion.findById(r.body.data.id));
  } else {
    const pages = (await a.client.request("GET", "/sites/" + s.id + "/pages"))
      .body.data.items;
    v = await tenant(() =>
      mongoose.connection.transaction(async (session) => {
        const site = await m.Site.findById(s.id).session(session),
          data = await (
            await import("../src/services/inquiry-settings.service")
          ).inquiryBuildConfig(site, session);
        const [v] = await m.SiteVersion.create(
          [
            {
              siteId: s.id,
              number: 1,
              actorId: a.me.user.id,
              operationId: randomUUID(),
              requestHash: "fixture",
              status: "ready",
              snapshotHash: "f".repeat(64),
              artifactHash: "f".repeat(64),
              snapshot: {
                site: s,
                pages,
                facts: [],
                inquiry: data.inquiry,
                assets: {},
                settings: { canonicalBaseUrl: siteOrigin },
              },
            },
          ],
          { session },
        );
        return v;
      }),
    );
  }
  await tenant(async () => {
    const d = await m.SiteDeployment.create({
      siteId: s.id,
      versionId: v._id,
      actorId: a.me.user.id,
      createdBy: a.me.user.id,
      operationId: randomUUID(),
      requestHash: "fixture",
      kind: "publish",
      status: "live",
      url: siteOrigin,
      origins: [siteOrigin],
      providerUrl: "https://preview.inquiry.example.invalid",
      artifactHash: v.artifactHash,
    });
    await m.Site.updateOne(
      { _id: s.id },
      { $set: { currentDeploymentId: d._id } },
    );
  });
  return {
    site: s,
    version: v,
    config: cfg.body.data,
    publicId: cfg.body.data.publicId,
    base: "/api/inquiry-gateway/v1/sites/" + cfg.body.data.publicId,
  };
}
function inquiry(f: any, extra: any = {}) {
  return {
    submissionId: randomUUID(),
    name: "Synthetic Buyer",
    company: "Synthetic Company",
    email: "buyer-" + randomUUID() + "@example.invalid",
    country: "Germany",
    phone: "+000000000",
    productIds: [],
    quantity: 12,
    message:
      "Please send details about your products for our purchasing project.",
    website: "",
    privacyConsent: true,
    privacyVersion: f.version.snapshot.inquiry.privacyVersion,
    pageUrl: siteOrigin + "/",
    referrer: "https://search.example.invalid/results?private=value",
    utm: {
      source: "fixture",
      medium: null,
      campaign: null,
      term: null,
      content: null,
    },
    firstVisitAt: new Date().toISOString(),
    turnstileToken: "",
    ...extra,
  };
}
async function publicPost(f: any, payload: any, origin = siteOrigin) {
  const r = await supertest(app)
    .post(f.base + "/inquiries")
    .set("Origin", origin)
    .send(payload);
  checkPublic(r, "post", "/sites/{publicId}/inquiries");
  return r;
}
async function processing(id: string, kind = "inquiry.process") {
  const task = await liveTask(id, kind);
  assert(task);
  const outcome = await tenant(async () =>
    (await import("../src/services/inquiry-worker.service")).processInquiryTask(
      task,
    ),
  );
  await tenant(async () =>
    (await import("../src/background/runtime")).finishTask(
      task,
      outcome.status,
      outcome.error,
    ),
  );
  return outcome;
}
async function rowFor(receipt: string) {
  return tenant(() =>
    m.SiteInquiry.findOne({ receiptId: receipt }).select("+secret"),
  );
}

test("public origins and preflight are strict; encrypted inquiries are archived before asynchronous processing", async () => {
  const f = await readySite(),
    data = inquiry(f);
  assert.equal(
    (await publicPost(f, data, "https://attacker.example.invalid")).status,
    403,
  );
  assert.equal(
    (
      await supertest(app)
        .post(f.base + "/inquiries")
        .send(data)
    ).status,
    403,
  );
  assert.equal(
    (
      await supertest(app)
        .options(f.base + "/inquiries")
        .set("Origin", siteOrigin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type")
    ).status,
    204,
  );
  const r = await publicPost(f, data);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.headers["access-control-allow-origin"], siteOrigin);
  assert(!r.headers["access-control-allow-credentials"]);
  assert(!JSON.stringify(r.body).includes(data.email));
  const row = await rowFor(r.body.data.receiptId);
  assert(row);
  assert(!JSON.stringify(row).includes(data.message));
  assert(!JSON.stringify(row).includes(data.email));
  assert.equal(row.classification, "pending");
  assert.equal(
    await tenant(() =>
      m.InquiryDelivery.countDocuments({ inquiryId: row._id }),
    ),
    0,
  );
  const detail = (await a.client.request("GET", "/inquiries/" + row._id)).body
    .data;
  assert.equal(detail.contact.email, data.email);
  assert.equal(
    detail.source.referrer,
    "https://search.example.invalid/results",
  );
  assert.equal(detail.source.utm.source, "fixture");
});
test("IP and site limits ignore untrusted forwarded IPs; inquiry counters never reject due to plan", async () => {
  const f = await readySite();
  await tenant(() =>
    m.UsageBucket.updateOne(
      { metric: "inquiries", period: new Date().toISOString().slice(0, 7) },
      { $set: { consumed: 1000000000, reserved: 0 } },
      { upsert: true },
    ),
  );
  for (let i = 0; i < 5; i++) {
    const r = await supertest(app)
      .post(f.base + "/inquiries")
      .set("Origin", siteOrigin)
      .set("X-Forwarded-For", "8.8.8." + i)
      .send(inquiry(f));
    assert.equal(r.status, 202, JSON.stringify(r.body));
  }
  const denied = await publicPost(f, inquiry(f));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers["retry-after"], "60");
  assert.equal(
    await tenant(() => m.SiteInquiry.countDocuments({ siteId: f.site.id })),
    5,
  );
  await tenant(() => m.InquiryRateBucket.deleteMany({}));
  await tenant(() =>
    m.InquiryRateBucket.create({
      siteId: f.site.id,
      key: "post-site",
      minute: Math.floor(Date.now() / 60000),
      count: 60,
      expiresAt: new Date(Date.now() + 60000),
    }),
  );
  assert.equal((await publicPost(f, inquiry(f))).status, 429);
});
test("submission replay is idempotent and asynchronous dedupe groups messages without losing either", async () => {
  const f = await readySite(),
    p = inquiry(f),
    first = await publicPost(f, p),
    replay = await publicPost(f, p);
  assert.equal(first.status, 202);
  assert.deepEqual(first.body, replay.body);
  assert.equal((await publicPost(f, { ...p, message: "Changed" })).status, 409);
  const next = await publicPost(f, {
      ...p,
      submissionId: randomUUID(),
      message: "Please include packaging information as well.",
    }),
    one = await rowFor(first.body.data.receiptId),
    two = await rowFor(next.body.data.receiptId);
  await processing(String(one._id));
  await processing(String(two._id));
  await processing(String(one._id));
  assert.equal(
    (await a.client.request("GET", "/inquiries?siteId=" + f.site.id)).body.data
      .items.length,
    1,
  );
  assert.equal(
    (
      await a.client.request(
        "GET",
        "/inquiries?siteId=" + f.site.id + "&includeDuplicates=true",
      )
    ).body.data.items.length,
    2,
  );
  const detail = (await a.client.request("GET", "/inquiries/" + one._id)).body
    .data;
  assert.equal(
    detail.duplicates[0].message,
    "Please include packaging information as well.",
  );
  assert.equal(
    await tenant(() =>
      m.InquiryDelivery.countDocuments({
        inquiryId: { $in: [one._id, two._id] },
      }),
    ),
    1,
  );
});
test("honeypot and AI spam are marked and kept; AI receives redacted text and durable output prevents another call", async () => {
  const f = await readySite(false, { aiSpamEnabled: true }),
    worker = await import("../src/services/inquiry-worker.service");
  let calls = 0;
  mock.method(
    worker.inquiryAi,
    "call",
    async (_system: any, input: any, _operation: any, save: any) => {
      calls++;
      assert(!input.message.includes("person@example.invalid"));
      const result = {
        output: { spamScore: 94, reasons: ["PROMOTIONAL"] },
        tokens: 7,
      };
      await save(result);
      return result;
    },
  );
  const first = await publicPost(f, inquiry(f, { website: "bot" })),
    one = await rowFor(first.body.data.receiptId);
  await processing(String(one._id));
  assert.equal(
    (await a.client.request("GET", "/inquiries/" + one._id)).body.data.status,
    "spam",
  );
  const r = await publicPost(
      f,
      inquiry(f, {
        message:
          "Please send details. Contact person@example.invalid for our purchasing brief.",
      }),
    ),
    row = await rowFor(r.body.data.receiptId);
  await processing(String(row._id));
  await processing(String(row._id));
  const detail = (await a.client.request("GET", "/inquiries/" + row._id)).body
    .data;
  assert.equal(detail.spamScore, 94);
  assert.equal(detail.classification, "ai");
  assert.equal(calls, 2);
  assert.equal(
    await tenant(() => m.SiteInquiry.countDocuments({ siteId: f.site.id })),
    2,
  );
});
test("SMTP failure leaves archive intact and known failure can be retried separately", async () => {
  const f = await readySite(),
    r = await publicPost(f, inquiry(f)),
    row = await rowFor(r.body.data.receiptId);
  await processing(String(row._id));
  const { config } = await import("../src/config"),
    worker = await import("../src/services/inquiry-worker.service"),
    saved = config.smtpHost;
  config.smtpHost = "smtp.fixture.invalid";
  let sent = 0;
  try {
    mock.method(worker.inquiryMail, "send", async () => {
      sent++;
      throw Object.assign(Error("synthetic rejection"), { code: "EAUTH" });
    });
    const delivery = await tenant(() =>
      m.InquiryDelivery.findOne({ inquiryId: row._id }),
    );
    assert.equal(
      (await processing(String(delivery._id), "inquiry.notify")).status,
      "pending",
    );
    assert.equal(
      (await a.client.request("GET", "/inquiries/" + row._id)).body.data
        .notificationStatus,
      "failed",
    );
    assert(await rowFor(r.body.data.receiptId));
    assert.equal(
      (
        await a.client.request(
          "POST",
          "/inquiries/" + row._id + "/notifications/retry",
          {},
        )
      ).status,
      202,
    );
    (worker.inquiryMail.send as any).mock.mockImplementation(async () => {
      sent++;
    });
    assert.equal(
      (await processing(String(delivery._id), "inquiry.notify")).status,
      "done",
    );
    assert.equal(sent, 2);
  } finally {
    config.smtpHost = saved;
  }
});
test("attachments are bounded, encrypted and tenant protected; notes and CSV remain private", async () => {
  const f = await readySite(),
    sharp = (await import("sharp")).default,
    bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#37775a" },
    })
      .png()
      .toBuffer(),
    r = await supertest(app)
      .post(f.base + "/inquiries")
      .set("Origin", siteOrigin)
      .field("payload", JSON.stringify(inquiry(f, { name: "=SYNTHETIC" })))
      .attach("attachments", bytes, {
        filename: "fixture.png",
        contentType: "image/png",
      });
  checkPublic(r, "post", "/sites/{publicId}/inquiries");
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const row = await rowFor(r.body.data.receiptId),
    detail = (await a.client.request("GET", "/inquiries/" + row._id)).body.data,
    attachment = detail.attachments[0];
  assert(attachment);
  assert.equal(
    (await a.client.make("GET", attachment.url.replace("/api/v1", ""))).status,
    200,
  );
  assert.equal(
    (await b.client.make("GET", attachment.url.replace("/api/v1", ""))).status,
    404,
  );
  const stored = await tenant(() =>
      m.InquiryAttachment.findById(attachment.id),
    ),
    raw = await tenant(async () =>
      (await import("../src/services/storage.service")).readArtifact(
        stored.key,
      ),
    );
  assert(!raw.includes(bytes));
  assert(raw.toString().includes("ciphertext"));
  const note = await a.client.request(
    "POST",
    "/inquiries/" + row._id + "/notes",
    { revision: detail.revision, text: "Synthetic internal note" },
  );
  assert.equal(note.status, 201);
  assert.equal(note.body.data.notes.length, 1);
  const db = await tenant(() =>
    m.SiteInquiry.findById(row._id).select("+notesSecret"),
  );
  assert(!JSON.stringify(db).includes("Synthetic internal note"));
  const csv = await a.client.make(
    "GET",
    "/inquiries/export?siteId=" + f.site.id,
  );
  assert.equal(csv.status, 200);
  assert(csv.text.includes("'=SYNTHETIC"));
  assert.equal(
    (
      await supertest(app)
        .post(f.base + "/inquiries")
        .set("Origin", siteOrigin)
        .field("payload", JSON.stringify(inquiry(f)))
        .attach("attachments", Buffer.from("<script>bad</script>"), {
          filename: "unsafe.pdf",
          contentType: "application/pdf",
        })
    ).status,
    400,
  );
  assert.equal(
    (
      await supertest(app)
        .post(f.base + "/inquiries")
        .set("Origin", siteOrigin)
        .field("payload", JSON.stringify(inquiry(f)))
        .attach("attachments", Buffer.alloc(2097153), {
          filename: "large.pdf",
          contentType: "application/pdf",
        })
    ).status,
    413,
  );
});
test("preview grants and Turnstile bind site, hostname and action; rejected verification never archives", async () => {
  const f = await readySite(),
    settings = await import("../src/services/inquiry-settings.service"),
    grant = await tenant(() => settings.previewGrant(f.version));
  assert.equal(
    (
      await supertest(app)
        .get(f.base + "/config")
        .set("Origin", origin)
    ).status,
    403,
  );
  const cfg = await supertest(app)
    .get(f.base + "/config")
    .set("Origin", origin)
    .set("X-Preview-Token", grant);
  checkPublic(cfg, "get", "/sites/{publicId}/config");
  assert.equal(cfg.status, 200);
  const accepted = await supertest(app)
    .post(f.base + "/inquiries")
    .set("X-Preview-Token", grant)
    .send(
      inquiry(f, {
        pageUrl:
          origin + "/api/v1/site-versions/" + f.version._id + "/preview/",
      }),
    );
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  assert.equal(
    (
      await a.client.request(
        "PUT",
        "/sites/" + f.site.id + "/inquiry-settings",
        {
          revision: 1,
          enabled: true,
          privacyReviewed: true,
          aiSpamEnabled: false,
          notificationUserIds: [],
          turnstileSiteKey: "synthetic-site-key",
          turnstileSecret: randomBytes(32).toString("hex"),
        },
      )
    ).status,
    200,
  );
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          hostname: "attacker.example.invalid",
          action: "inquiry",
          cdata: f.publicId,
        }),
        { status: 200 },
      ),
  );
  assert.equal(
    (await publicPost(f, inquiry(f, { turnstileToken: "synthetic-response" })))
      .status,
    400,
  );
  (globalThis.fetch as any).mock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          hostname: new URL(siteOrigin).hostname,
          action: "inquiry",
          cdata: f.publicId,
        }),
        { status: 200 },
      ),
  );
  assert.equal(
    (await publicPost(f, inquiry(f, { turnstileToken: "synthetic-response" })))
      .status,
    202,
  );
});
test("private roles, organization isolation, counting and public lookup fail closed", async () => {
  const f = await readySite(),
    r = await publicPost(f, inquiry(f)),
    row = await rowFor(r.body.data.receiptId);
  assert.equal(
    (await b.client.request("GET", "/inquiries/" + row._id)).status,
    404,
  );
  assert.equal(
    (await b.client.request("GET", "/inquiries?siteId=" + f.site.id)).body.data
      .items.length,
    0,
  );
  await role("viewer");
  assert.equal(
    (
      await a.client.request("PATCH", "/inquiries/" + row._id, {
        revision: 1,
        status: "resolved",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await a.client.request("POST", "/inquiries/" + row._id + "/notes", {
        revision: 1,
        text: "fixture",
      })
    ).status,
    403,
  );
  await role("editor");
  assert.equal(
    (
      await a.client.request(
        "PUT",
        "/sites/" + f.site.id + "/inquiry-settings",
        {},
      )
    ).status,
    403,
  );
  await assert.rejects(() => m.SiteInquiry.find(), /TENANT_REQUIRED/);
  await assert.rejects(
    () =>
      ctx.runPublicLookup(f.publicId, () => m.Site.findOne({ _id: f.site.id })),
    /TENANT_REQUIRED/,
  );
  await assert.rejects(
    () =>
      ctx.runPublicLookup(f.publicId, () =>
        m.InquiryGatewayRoute.findOne({ publicId: f.publicId }),
      ),
    /RESTRICTED_PUBLIC_LOOKUP/,
  );
  const usage = (await a.client.request("GET", "/usage")).body.data;
  assert.equal(usage.limits.inquiries, null);
  assert(usage.items.some((i: any) => i.metric === "inquiries"));
});
test("real builds include privacy, form and consent script; login preview retains noindex", async () => {
  const f = await readySite(true),
    storageModule = await import("../src/services/storage.service"),
    builder = await import("../src/services/static-builder.service"),
    zip = await tenant(() => storageModule.readArtifact(f.version.artifactKey)),
    files = builder.unpack(zip),
    policy = f.version.snapshot.inquiry.privacyPath.slice(1) + "/index.html";
  assert(files[policy]);
  assert(files["assets/inquiry.js"]);
  const html = Buffer.from(files["index.html"]).toString();
  assert(html.includes("privacyConsent"));
  assert(html.includes("Phone / WhatsApp"));
  assert(html.includes("data-cookie-panel"));
  assert(!html.includes("data-preview-token"));
  const preview = await a.client.make(
    "GET",
    "/site-versions/" + f.version._id + "/preview/",
  );
  assert.equal(preview.status, 200);
  assert(preview.text.includes("data-preview-token"));
  assert(preview.headers["x-robots-tag"].includes("noindex"));
  const { HtmlValidate } = await import("html-validate"),
    v = new HtmlValidate({
      extends: ["html-validate:recommended"],
      rules: {
        "no-inline-style": "off",
        "heading-level": "off",
        "wcag/h32": "off",
      },
    });
  for (const [name, bytes] of Object.entries(files))
    if (name.endsWith(".html")) {
      const result = await v.validateString(Buffer.from(bytes).toString());
      assert(
        result.valid,
        JSON.stringify(result.results.flatMap((r) => r.messages)),
      );
    }
});

test("concurrent identical submissions create one inquiry, task and counter", async () => {
  const f = await readySite(),
    payload = inquiry(f);
  const replies = await Promise.all([
    publicPost(f, payload),
    publicPost(f, payload),
  ]);
  assert(
    replies.every((r) => r.status === 202),
    JSON.stringify(replies.map((r) => r.body)),
  );
  assert.deepEqual(replies[0].body, replies[1].body);
  const rows = await tenant(() => m.SiteInquiry.find({ siteId: f.site.id }));
  assert.equal(rows.length, 1);
  assert.equal(
    await tenant(() =>
      m.Task.countDocuments({
        kind: "inquiry.process",
        "payload.runId": String(rows[0]._id),
      }),
    ),
    1,
  );
  assert.equal(
    await tenant(() =>
      m.UsageRecord.countDocuments({
        metric: "inquiries",
        operationId: "inquiry:" + rows[0]._id,
      }),
    ),
    1,
  );
});
test("exactly three attachments fit; excess attachments and oversized JSON never archive", async () => {
  const f = await readySite(),
    pdf = Buffer.from("%PDF-1.7\nSynthetic fixture only\n%%EOF");
  let request = supertest(app)
    .post(f.base + "/inquiries")
    .set("Origin", siteOrigin)
    .field("payload", JSON.stringify(inquiry(f)));
  for (let i = 0; i < 3; i++)
    request = request.attach("attachments", pdf, {
      filename: "fixture-" + i + ".pdf",
      contentType: "application/pdf",
    });
  const accepted = await request;
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  assert.equal(
    (
      await a.client.request(
        "GET",
        "/inquiries/" + (await rowFor(accepted.body.data.receiptId))._id,
      )
    ).body.data.attachments.length,
    3,
  );
  request = supertest(app)
    .post(f.base + "/inquiries")
    .set("Origin", siteOrigin)
    .field("payload", JSON.stringify(inquiry(f)));
  for (let i = 0; i < 4; i++)
    request = request.attach("attachments", pdf, {
      filename: "fixture-" + i + ".pdf",
      contentType: "application/pdf",
    });
  assert.equal((await request).status, 413);
  assert.equal(
    (await publicPost(f, inquiry(f, { message: "a".repeat(25000) }))).status,
    413,
  );
  assert.equal(
    await tenant(() => m.SiteInquiry.countDocuments({ siteId: f.site.id })),
    1,
  );
});
test("AI quota fallback preserves archive and notifications; publishing enabled forms requires a public HTTPS gateway", async () => {
  const f = await readySite(false, { aiSpamEnabled: true }),
    worker = await import("../src/services/inquiry-worker.service"),
    { AppError } = await import("../src/errors");
  mock.method(worker.inquiryAi, "call", async () => {
    throw new AppError(409, "QUOTA_EXCEEDED");
  });
  const r = await publicPost(f, inquiry(f)),
    row = await rowFor(r.body.data.receiptId);
  await processing(String(row._id));
  const d = (await a.client.request("GET", "/inquiries/" + row._id)).body.data;
  assert.equal(d.classification, "quota_paused");
  assert.equal(d.status, "new");
  assert.equal(d.notificationStatus, "pending");
  assert.equal(
    await tenant(() =>
      m.InquiryDelivery.countDocuments({ inquiryId: row._id }),
    ),
    1,
  );
  const service = await import("../src/services/inquiry-settings.service");
  await assert.rejects(
    () => service.validateInquiryGateway(f.version),
    /INQUIRY_GATEWAY_UNSAFE/,
  );
  await service.validateInquiryGateway({
    snapshot: { inquiry: { enabled: false } },
  });
});

test("uncertain SMTP outcomes never resend or unlock automatically; invalid JSON is rejected safely", async () => {
  const f = await readySite();
  const malformed = await supertest(app)
    .post(f.base + "/inquiries")
    .set("Origin", siteOrigin)
    .set("Content-Type", "application/json")
    .send("{");
  assert.equal(malformed.status, 400);
  checkPublic(malformed, "post", "/sites/{publicId}/inquiries");
  const r = await publicPost(f, inquiry(f)),
    row = await rowFor(r.body.data.receiptId);
  await processing(String(row._id));
  const { config } = await import("../src/config"),
    worker = await import("../src/services/inquiry-worker.service"),
    saved = config.smtpHost;
  config.smtpHost = "smtp.fixture.invalid";
  let calls = 0;
  try {
    mock.method(worker.inquiryMail, "send", async () => {
      calls++;
      throw Object.assign(Error("Synthetic unknown response"), {
        code: "ETIMEDOUT",
      });
    });
    const d = await tenant(() =>
      m.InquiryDelivery.findOne({ inquiryId: row._id }),
    );
    assert.equal(
      (await processing(String(d._id), "inquiry.notify")).status,
      "dead",
    );
    assert.equal(
      (await processing(String(d._id), "inquiry.notify")).status,
      "dead",
    );
    assert.equal(calls, 1);
    assert.equal(
      (await a.client.request("GET", "/inquiries/" + row._id)).body.data
        .notificationStatus,
      "unknown",
    );
    assert.equal(
      (
        await a.client.request(
          "POST",
          "/inquiries/" + row._id + "/notifications/retry",
          {},
        )
      ).status,
      409,
    );
    assert(await rowFor(r.body.data.receiptId));
  } finally {
    config.smtpHost = saved;
  }
});
