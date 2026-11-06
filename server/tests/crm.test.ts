import { before, after, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config = () => ({ parsed: {} });
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
let origin = "http://localhost:5173";
const password = "Fixture-" + randomBytes(20).toString("hex");
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
  siteServer = await new Promise<any>((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  origin = "http://127.0.0.1:" + siteServer.address().port;
  const config = (await import("../src/config")).config;
  config.origin = origin;
  config.smtpHost = "";
  await startMockCrm();
  config.crmAllowedOrigins = crmBaseUrl;
  config.crmAllowLocal = true;
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
  await new Promise<void>((r) => siteServer?.close(() => r()));
  await new Promise<void>((r) => mockServer?.close(() => r()));
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

import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
let siteServer: any,
  mockServer: Server,
  crmBaseUrl = "",
  mockFailure: unknown;
const crmSpec = yaml.load(
  readFileSync(
    path.resolve(__dirname, "fixtures/crm-integration-v1.openapi.yaml"),
    "utf8",
  ),
) as any;
const crmAjv = new Ajv({ strict: false, allErrors: true });
addFormats(crmAjv);
const projectId = new mongoose.Types.ObjectId().toString(),
  remoteProductId = new mongoose.Types.ObjectId().toString(),
  remoteCompanyId = new mongoose.Types.ObjectId().toString(),
  remotePlaybookId = new mongoose.Types.ObjectId().toString(),
  remoteKnowledgeId = new mongoose.Types.ObjectId().toString(),
  remoteImageId = new mongoose.Types.ObjectId().toString();
const serviceToken = "gci_" + randomBytes(24).toString("hex");
let remoteName = "Fixture Pump",
  remoteStatus = "active",
  minimalHealth = false,
  invalidCursor = false,
  remoteTime = new Date().toISOString(),
  unavailable = false,
  loseNextResponse = false,
  malformed = false,
  scopeList = [
    "products:read",
    "company:read",
    "playbook:read",
    "knowledge:read",
    "inquiries:write",
    "outcomes:read",
  ];
let imageBytes: Buffer,
  received: any[] = [],
  feedQueries: { resource: string; query: string }[] = [],
  outcomeItems: any[] = [];
const remoteInquiries = new Map<string, any>(),
  remoteCustomers = new Map<string, string>();
function contractBody(
  method: string,
  route: string,
  status: number,
  body: unknown,
) {
  let response = crmSpec.paths[route]?.[method]?.responses[status];
  if (response?.$ref) {
    let target = crmSpec;
    for (const part of response.$ref.slice(2).split("/")) target = target[part];
    response = target;
  }
  const s = response?.content?.["application/json"]?.schema;
  assert(s, "Missing CRM response schema " + route + " " + status);
  const v = crmAjv.compile({ ...s, components: crmSpec.components });
  assert(v(body), crmAjv.errorsText(v.errors));
}
function remoteProduct() {
  return {
    id: remoteProductId,
    sku: "FIXTURE-PUMP",
    name: remoteName,
    category: "Pumps",
    description: "A fictional product for isolated tests.",
    material: "Steel",
    application: "Industrial transfer",
    certifications: [],
    moq: null,
    leadTime: null,
    specs: [],
    status: remoteStatus,
    images: [
      {
        id: remoteImageId,
        url:
          crmBaseUrl +
          "/api/integrations/v1/products/" +
          remoteProductId +
          "/images/" +
          remoteImageId +
          "?expires=" +
          Math.floor((Date.now() + 300000) / 1000) +
          "&signature=" +
          "a".repeat(64),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        mime: "image/png",
        bytes: imageBytes.length,
        sha256: createHash("sha256").update(imageBytes).digest("hex"),
      },
    ],
    updatedAt: remoteTime,
  };
}
async function startMockCrm() {
  imageBytes = await (
    await import("sharp")
  )
    .default({
      create: { width: 16, height: 16, channels: 3, background: "#37775a" },
    })
    .png()
    .toBuffer();
  mockServer = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url!, crmBaseUrl),
        p = url.pathname.replace("/api/integrations/v1", ""),
        method = req.method!.toLowerCase();
      const route = p.startsWith("/products/")
        ? p.includes("/images/")
          ? "/products/{id}/images/{imageId}"
          : "/products/{id}"
        : p;
      const send = (status: number, body: any) => {
        contractBody(method, route, status, body);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const fail = (status: number, code: string) =>
        send(status, {
          success: false,
          error: { code, message: "Fictional CRM rejection" },
        });
      if (req.headers.authorization !== "Bearer " + serviceToken) {
        fail(401, "UNAUTHORIZED");
        return;
      }
      if (req.headers["x-project-id"] !== projectId) {
        fail(404, "PROJECT_MISMATCH");
        return;
      }
      if (unavailable) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: { code: "INTERNAL_ERROR", message: "Fictional outage" },
          }),
        );
        return;
      }
      if (p === "/health") {
        send(200, {
          success: true,
          data: {
            ok: true,
            contractVersion: "1.0",
            serverTime: new Date().toISOString(),
            projectId,
            ...(!minimalHealth ? { projectName: "Fictional CRM" } : {}),
            scopes: scopeList,
            ...(!minimalHealth
              ? { credentialId: new mongoose.Types.ObjectId().toString() }
              : {}),
          },
        });
        return;
      }
      if (p.includes("/images/")) {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(imageBytes);
        return;
      }
      if (p.startsWith("/products/")) {
        send(200, { success: true, data: remoteProduct() });
        return;
      }
      if (method === "post" && p === "/inquiries") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const payload = JSON.parse(raw);
        const schema =
            crmSpec.paths["/inquiries"].post.requestBody.content[
              "application/json"
            ].schema,
          v = crmAjv.compile({ ...schema, components: crmSpec.components });
        assert(v(payload), crmAjv.errorsText(v.errors));
        const key = String(req.headers["idempotency-key"] ?? "");
        assert(key.length > 0);
        received.push({ key, payload });
        let result = remoteInquiries.get(key);
        if (!result) {
          let customerId = remoteCustomers.get(payload.contact.email);
          const created = !customerId;
          if (!customerId) {
            customerId = new mongoose.Types.ObjectId().toString();
            remoteCustomers.set(payload.contact.email, customerId);
          }
          result = {
            inquiryId: new mongoose.Types.ObjectId().toString(),
            customerId,
            prospectId: null,
            customerUrl: "/customers/" + customerId,
            projectId,
            action: created ? "created" : "linked",
            attachmentStatus: payload.attachments.length ? "pending" : "none",
            sourceSystem: "globalsite",
          };
          remoteInquiries.set(key, result);
        }
        if (loseNextResponse) {
          loseNextResponse = false;
          req.socket.destroy();
          return;
        }
        send(201, { success: true, data: result });
        return;
      }
      if (p === "/outcomes") {
        send(200, {
          success: true,
          data: {
            items: outcomeItems,
            nextCursor: outcomeItems.at(-1)?.cursor ?? null,
            hasMore: false,
          },
        });
        return;
      }
      const names: Record<string, string> = {
          "/products": "products",
          "/company-profile": "company",
          "/playbook": "playbook",
          "/knowledge/summaries": "knowledge",
        },
        resource = names[p];
      assert(resource, "Unknown fixture endpoint");
      feedQueries.push({ resource, query: url.search });
      if (invalidCursor && url.searchParams.has("cursor")) {
        send(422, {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Fictional invalid cursor",
            details: [
              { field: "query.cursor", message: "Fictional expired cursor" },
            ],
          },
        });
        invalidCursor = false;
        return;
      }
      let items: any[] = [];
      if (resource === "products") items = [remoteProduct()];
      if (resource === "company")
        items = [
          {
            id: remoteCompanyId,
            name: "Fictional Manufacturer",
            website: null,
            industry: null,
            address: null,
            phone: null,
            email: null,
            foundedYear: null,
            capacity: null,
            certifications: [],
            updatedAt: remoteTime,
          },
        ];
      if (resource === "playbook")
        items = [
          {
            id: remotePlaybookId,
            brandPositioning: "Industrial supply partner",
            sellingPoints: ["Reviewed product information"],
            targetMarkets: ["Germany"],
            updatedAt: remoteTime,
          },
        ];
      if (resource === "knowledge")
        items = [
          {
            id: remoteKnowledgeId,
            title: "Fictional Public Summary",
            summary: "Public information for isolated purchasing tests.",
            updatedAt: remoteTime,
            deleted: false,
          },
        ];
      if (malformed) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ success: true, data: { items: [{ bad: true }] } }),
        );
        return;
      }
      send(200, {
        success: true,
        data: {
          items,
          nextCursor: null,
          hasMore: false,
          syncUntil: new Date().toISOString(),
        },
      });
    })().catch((e) => {
      mockFailure = e;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Fixture validation failed",
          },
        }),
      );
    });
  });
  await new Promise<void>((r) => mockServer.listen(0, "127.0.0.1", () => r()));
  crmBaseUrl = "http://127.0.0.1:" + (mockServer.address() as any).port;
}
beforeEach(async () => {
  await ctx.runIdentity(() =>
    m.Organization.updateOne(
      { _id: a.me.organizationId },
      { $set: { plan: "growth" } },
    ),
  );
  unavailable = false;
  malformed = false;
  loseNextResponse = false;
  remoteName = "Fixture Pump";
  remoteStatus = "active";
  minimalHealth = false;
  invalidCursor = false;
  scopeList = [
    "products:read",
    "company:read",
    "playbook:read",
    "knowledge:read",
    "inquiries:write",
    "outcomes:read",
  ];
  remoteTime = new Date().toISOString();
  received = [];
  feedQueries = [];
  outcomeItems = [];
  remoteInquiries.clear();
  remoteCustomers.clear();
  mockFailure = undefined;
  await tenant(async () => {
    for (const model of [
      m.CrmConnection,
      m.CrmSyncState,
      m.OutboundDelivery,
      m.CrmImportedResource,
      m.CrmOutcome,
    ])
      await model.deleteMany({});
    await m.Product.deleteMany({});
    await m.FactSheet.deleteMany({});
    await m.Task.deleteMany({ kind: /^crm\./ });
  });
});
async function connect() {
  const r = await a.client.request("POST", "/crm/connection", {
    baseUrl: crmBaseUrl,
    projectId,
    credential: serviceToken,
    revision: 0,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}
async function processCrm(kind: string, id: string) {
  const task = await tenant(() =>
    m.Task.findOneAndUpdate(
      { kind, "payload.runId": id },
      {
        $set: {
          status: "running",
          owner: "fixture",
          leaseUntil: new Date(Date.now() + 60000),
        },
        $inc: { attempts: 1, fencingToken: 1 },
      },
      { new: true, sort: { _id: -1 } },
    ),
  );
  assert(task);
  const result = await tenant(async () =>
    (await import("../src/services/crm-worker.service")).processCrmTask(task),
  );
  await tenant(async () =>
    (await import("../src/background/runtime")).finishTask(
      task,
      result.status,
      result.error,
      result.delayMs,
    ),
  );
  return result;
}
async function syncAll() {
  const queued = await a.client.request("POST", "/crm/connection/sync", {
    full: false,
  });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  const states = await tenant(() => m.CrmSyncState.find({ status: "queued" }));
  for (const state of states) {
    const result = await processCrm("crm.sync", String(state._id));
    assert.equal(result.status, "done", JSON.stringify(result));
  }
  assert.equal(mockFailure, undefined);
}
async function submitConnected(extra: any = {}) {
  const f = await readySite(),
    data = inquiry(f, extra),
    r = await publicPost(f, data);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const row = await rowFor(r.body.data.receiptId);
  await processing(String(row._id));
  return { f, data, row };
}
test("contract source is pinned; connection credentials are encrypted and never returned; roles and tenants isolate configuration", async () => {
  const bytes = readFileSync(
    path.resolve(__dirname, "fixtures/crm-integration-v1.openapi.yaml"),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "f07bda17a0a976197d77cf6ed844175a930d2860bc2734d212de4ca839973342",
  );
  assert.equal(
    (await a.client.request("GET", "/crm/connection")).body.data.connection,
    null,
  );
  const c = await connect();
  assert.equal(c.status, "connected");
  assert(!JSON.stringify(c).includes(serviceToken));
  const stored = await tenant(() =>
    m.CrmConnection.findById(c.id).select("+secret +credentialFingerprint"),
  );
  assert(!JSON.stringify(stored).includes(serviceToken));
  assert.equal(
    (await b.client.request("GET", "/crm/connection")).body.data.connection,
    null,
  );
  await role("viewer");
  assert.equal((await a.client.request("GET", "/crm/connection")).status, 403);
  await role("editor");
  assert.equal(
    (await a.client.request("POST", "/crm/connection/test", {})).status,
    403,
  );
});
test("manual sync imports C1 images and candidate facts; remote edits preserve local products and confirmed facts until reviewed", async () => {
  const c = await connect();
  await syncAll();
  let product = await tenant(() =>
    m.Product.findOne({ "externalRef.connectionId": c.id }),
  );
  assert(product);
  assert.equal(product.source, "globalcrm");
  assert.equal(product.assetIds.length, 1);
  const fact = await tenant(() =>
    m.FactSheet.findOne({ subjectId: product._id, type: "product.name" }),
  );
  assert.equal(fact.status, "candidate");
  assert.equal(
    (
      await a.client.request("POST", "/facts/" + fact._id + "/confirm", {
        revision: fact.revision,
      })
    ).status,
    200,
  );
  const edited = await a.client.request("PATCH", "/products/" + product._id, {
    revision: product.revision,
    data: {
      name: "Local maintained pump",
      status: "active",
      assetIds: product.assetIds.map(String),
    },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  remoteName = "Updated remote pump";
  remoteTime = new Date(Date.now() + 1000).toISOString();
  await syncAll();
  product = await tenant(() => m.Product.findById(product._id));
  assert.equal(product.name, "Local maintained pump");
  assert.equal(product.syncCandidate.remoteName, remoteName);
  assert.equal(
    (await tenant(() => m.FactSheet.findById(fact._id))).status,
    "confirmed",
  );
  const candidates = await a.client.request("GET", "/crm/sync-candidates");
  assert(
    candidates.body.data.items.some((p: any) => p.id === String(product._id)),
  );
  const accepted = await a.client.request(
    "POST",
    "/crm/sync-candidates/" + product._id + "/review",
    {
      revision: product.revision,
      candidateHash: product.syncCandidate.hash,
      decision: "accept",
    },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(
    (await tenant(() => m.Product.findById(product._id))).name,
    remoteName,
  );
  assert(
    feedQueries.some(
      (q) => q.resource === "products" && q.query.includes("updatedSince="),
    ),
  );
  const companyFacts = await tenant(() =>
    m.FactSheet.find({
      subjectType: "organization",
      "source.kind": "globalcrm",
    }),
  );
  assert(companyFacts.some((f) => f.type === "company.name"));
  assert(companyFacts.every((f) => f.status === "candidate"));
  const resource = await a.client.request(
    "GET",
    "/crm/resources/" + fact.source.refId,
  );
  assert.equal(resource.status, 200);
  assert(!JSON.stringify(resource.body).includes("signature="));
});
test("CRM outages retain inquiries and retry with the same business key after recovery", async () => {
  await connect();
  const { row } = await submitConnected(),
    delivery = await tenant(() =>
      m.OutboundDelivery.findOne({ inquiryId: row._id }),
    );
  assert(delivery);
  unavailable = true;
  const failed = await processCrm("crm.deliver", String(delivery._id));
  assert.equal(failed.status, "pending");
  assert(failed.delayMs! >= 30000);
  assert(await tenant(() => m.SiteInquiry.findById(row._id)));
  unavailable = false;
  await tenant(() =>
    m.Task.updateOne(
      { operationId: "crm.deliver:" + delivery._id },
      { $set: { nextAttemptAt: new Date(0) } },
    ),
  );
  await (await import("../src/background/runtime")).tick();
  assert.equal(
    (await tenant(() => m.OutboundDelivery.findById(delivery._id))).status,
    "sent",
  );
  assert.equal(received.length, 1);
  const detail = (await a.client.request("GET", "/inquiries/" + row._id)).body
    .data;
  assert.equal(detail.crm.status, "sent");
  assert(detail.crm.customerUrl.startsWith(crmBaseUrl + "/customers/"));
  assert.equal(remoteCustomers.size, 1);
});
test("uncertain responses replay one delivery; outcomes poll once per event and preserve cursor on empty page", async () => {
  await connect();
  const { row } = await submitConnected(),
    delivery = await tenant(() =>
      m.OutboundDelivery.findOne({ inquiryId: row._id }),
    );
  loseNextResponse = true;
  assert.equal(
    (await processCrm("crm.deliver", String(delivery._id))).status,
    "pending",
  );
  assert.equal(
    (await processCrm("crm.deliver", String(delivery._id))).status,
    "done",
  );
  assert.equal(remoteCustomers.size, 1);
  assert.equal(remoteInquiries.size, 1);
  assert.equal(received[0].key, received[1].key);
  const result = received[1],
    remote = remoteInquiries.get(result.key);
  outcomeItems = [
    {
      eventId: "fixture-event",
      cursor: "fixture-cursor",
      customerId: remote.customerId,
      externalId: null,
      fromStatus: "negotiating",
      toStatus: "won",
      occurredAt: new Date().toISOString(),
    },
  ];
  await syncAll();
  assert.equal(
    (await a.client.request("GET", "/inquiries/" + row._id)).body.data.crm
      .outcome.toStatus,
    "won",
  );
  outcomeItems = [];
  await syncAll();
  const state = await tenant(() =>
    m.CrmSyncState.findOne({ resource: "outcomes" }),
  );
  assert.equal(state.cursor, "fixture-cursor");
  assert.equal(
    await tenant(() =>
      m.CrmOutcome.countDocuments({ eventId: "fixture-event" }),
    ),
    1,
  );
});
test("incorrect credentials pause clearly without disclosure; disconnect stops queued delivery and invalidates signed attachments", async () => {
  const wrong = "gci_" + randomBytes(24).toString("hex"),
    bad = await a.client.request("POST", "/crm/connection", {
      baseUrl: crmBaseUrl,
      projectId,
      credential: wrong,
      revision: 0,
    });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "CRM_UNAUTHORIZED");
  assert(!JSON.stringify(bad.body).includes(wrong));
  const old = (await a.client.request("GET", "/crm/connection")).body.data
    .connection;
  const good = await a.client.request("POST", "/crm/connection", {
    baseUrl: crmBaseUrl,
    projectId,
    credential: serviceToken,
    revision: old.revision,
  });
  assert.equal(good.status, 201);
  const f = await readySite(),
    pdf = Buffer.from("%PDF-1.7\nFictional attachment\n%%EOF");
  const saved = await supertest(app)
    .post(f.base + "/inquiries")
    .set("Origin", siteOrigin)
    .field("payload", JSON.stringify(inquiry(f)))
    .attach("attachments", pdf, {
      filename: "fixture.pdf",
      contentType: "application/pdf",
    });
  assert.equal(saved.status, 202);
  const row = await rowFor(saved.body.data.receiptId);
  await processing(String(row._id));
  const d = await tenant(() =>
    m.OutboundDelivery.findOne({ inquiryId: row._id }),
  );
  assert.equal((await processCrm("crm.deliver", String(d._id))).status, "done");
  const attachmentUrl = received[0].payload.attachments[0].downloadUrl,
    download = await fetch(attachmentUrl);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  const pending = await submitConnected(),
    queued = await tenant(() =>
      m.OutboundDelivery.findOne({ inquiryId: pending.row._id }),
    ),
    before = received.length;
  const disconnected = await a.client.request(
    "POST",
    "/crm/connection/disconnect",
    { revision: good.body.data.revision },
  );
  assert.equal(disconnected.status, 200);
  assert.equal(disconnected.body.data.status, "disconnected");
  assert.equal((await fetch(attachmentUrl)).status, 403);
  assert.equal(
    (await processCrm("crm.deliver", String(queued._id))).status,
    "dead",
  );
  assert.equal(received.length, before);
  const after = await submitConnected();
  assert.equal(
    await tenant(() =>
      m.OutboundDelivery.countDocuments({ inquiryId: after.row._id }),
    ),
    0,
  );
});
test("malformed CRM responses pause instead of guessing; untrusted targets are rejected", async () => {
  const config = (await import("../src/config")).config,
    saved = config.crmAllowedOrigins;
  config.crmAllowedOrigins = "";
  const denied = await a.client.request("POST", "/crm/connection", {
    baseUrl: crmBaseUrl,
    projectId,
    credential: serviceToken,
    revision: 0,
  });
  assert.equal(denied.status, 400);
  assert.equal(denied.body.error.code, "CRM_TARGET_UNCONFIGURED");
  config.crmAllowedOrigins = saved;
  await connect();
  malformed = true;
  await a.client.request("POST", "/crm/connection/sync", { full: false });
  const state = await tenant(() =>
    m.CrmSyncState.findOne({ resource: "products" }),
  );
  assert.equal(
    (await processCrm("crm.sync", String(state._id))).status,
    "dead",
  );
  assert.equal(
    (await a.client.request("GET", "/crm/connection")).body.data.connection
      .status,
    "contract_error",
  );
  assert.equal(await tenant(() => m.Product.countDocuments({})), 0);
});

test("optional health labels may be absent; absent optional scopes are reported instead of queried", async () => {
  minimalHealth = true;
  scopeList = ["products:read", "inquiries:write"];
  const c = await connect();
  assert.equal(c.projectName, null);
  await syncAll();
  const state = (await a.client.request("GET", "/crm/connection")).body.data;
  assert.equal(
    state.syncStates.find((s: any) => s.resource === "company").status,
    "unsupported",
  );
  assert(feedQueries.every((q) => q.resource === "products"));
});
test("delivery retries stop at the limit; manual retry retains its key and an old privacy notice never transfers", async () => {
  await connect();
  const { row } = await submitConnected(),
    d = await tenant(() => m.OutboundDelivery.findOne({ inquiryId: row._id }));
  unavailable = true;
  for (let i = 0; i < 8; i++) await processCrm("crm.deliver", String(d._id));
  const failed = await tenant(() => m.OutboundDelivery.findById(d._id));
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 8);
  unavailable = false;
  const retried = await a.client.request(
    "POST",
    "/crm/deliveries/" + d._id + "/retry",
    {},
  );
  assert.equal(retried.status, 202);
  assert.equal((await processCrm("crm.deliver", String(d._id))).status, "done");
  assert.equal(received[0].key, d.idempotencyKey);
  const f = await readySite();
  await tenant(() =>
    m.SiteVersion.updateOne(
      { _id: f.version._id },
      { $unset: { "snapshot.inquiry.crmDisclosureVersion": 1 } },
    ),
  );
  const response = await publicPost(f, inquiry(f)),
    old = await rowFor(response.body.data.receiptId);
  await processing(String(old._id));
  assert.equal(
    await tenant(() =>
      m.OutboundDelivery.countDocuments({ inquiryId: old._id }),
    ),
    0,
  );
  const detail = (await a.client.request("GET", "/inquiries/" + old._id)).body
    .data;
  assert.equal(detail.crm.status, "blocked");
  assert.equal(detail.crm.lastErrorCode, "CRM_PRIVACY_REBUILD_REQUIRED");
  assert.equal(
    (await a.client.request("POST", "/inquiries/" + old._id + "/crm/retry", {}))
      .status,
    409,
  );
});
test("an explicitly invalid cursor restarts reconciliation; source archival blocks subsequent site publication", async () => {
  await connect();
  await syncAll();
  const state = await tenant(() =>
    m.CrmSyncState.findOne({ resource: "products" }),
  );
  await a.client.request("POST", "/crm/connection/sync", { full: false });
  await tenant(() =>
    m.CrmSyncState.updateOne(
      { _id: state._id },
      { $set: { cursor: "fictional-expired-cursor", full: false } },
    ),
  );
  invalidCursor = true;
  const first = await processCrm("crm.sync", String(state._id));
  assert.equal(first.status, "pending");
  assert.equal(first.error, "CRM_CURSOR_INVALID");
  const reset = await tenant(() => m.CrmSyncState.findById(state._id));
  assert.equal(reset.cursor, null);
  assert.equal(reset.full, true);
  assert.equal(
    (await processCrm("crm.sync", String(state._id))).status,
    "done",
  );
  const product = await tenant(() =>
    m.Product.findOne({ source: "globalcrm" }),
  );
  const site = await a.client.request("POST", "/sites", {
    name: "Fictional Imported Site",
    templateId: "machinery",
    targetMarkets: ["Germany"],
    language: "en",
    brandColor: "#126a54",
    logoId: null,
    productIds: [String(product._id)],
  });
  assert.equal(site.status, 201);
  remoteStatus = "archived";
  remoteTime = new Date().toISOString();
  await syncAll();
  assert.equal(
    (await tenant(() => m.Product.findById(product._id))).crmSourceStatus,
    "archived",
  );
  const readiness = await a.client.request(
    "GET",
    "/sites/" + site.body.data.id + "/readiness",
  );
  assert.equal(readiness.status, 200);
  assert(
    readiness.body.data.issues.some(
      (i: any) => i.code === "CRM_SOURCE_WITHDRAWN",
    ),
  );
});
