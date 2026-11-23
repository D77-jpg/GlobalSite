import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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

let mongo: MongoMemoryReplSet, app: any, storage: string;
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
  async request(method: string, url: string, data?: unknown) {
    let r = this.make(method, url);
    if (data !== undefined) r = r.send(data);
    const result = await r;
    if (result.status < 300 && data !== undefined)
      assertRequest(method, url, data);
    assertResponse(
      method,
      url,
      result.status,
      result.body,
      result.headers["content-type"] ?? "",
    );
    for (const item of result.headers["set-cookie"] ?? []) {
      const [k, v] = item.split(";")[0].split("=");
      this.jar.set(k, v);
    }
    return result;
  }
}

async function account(tag: string) {
  const client = new Client(),
    email = `${tag}-${randomBytes(6).toString("hex")}@example.invalid`;
  const reg = await client.request("POST", "/auth/register", {
    email,
    password,
    name: tag,
    organizationName: tag + " Studio",
    locale: "en",
  });
  assert.equal(reg.status, 202);
  const mail = await client.request("GET", "/dev/mail/" + reg.body.data.devReceipt);
  const token = new URL(mail.body.data.text).searchParams.get("token");
  assert.equal(
    (await client.request("POST", "/auth/verify-email", { token })).status,
    200,
  );
  assert.equal(
    (await client.request("POST", "/auth/login", { email, password })).status,
    200,
  );
  return { client };
}

before(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "gs-s26-"));
  process.env.STORAGE_ROOT = storage;
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  process.env.MONGODB_URI = mongo.getUri("globalsite");
  const db = await import("../src/db");
  await db.connectDatabase();
  app = (await import("../src/app")).createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  await fs.rm(storage, { recursive: true, force: true });
});

test("live draft preview renders unsaved edits with real-time validation without mutating saved page state", async () => {
  const a = await account("live-a");
  const b = await account("live-b");
  const site = (
    await a.client.request("POST", "/sites", {
      name: "Atelier Craft",
      templateId: "adaptive",
      targetMarkets: ["Germany"],
      language: "en",
      brandColor: "#142d59",
      logoId: null,
      productIds: [],
      buyerProfile: {
        businessModel: "manufacturer",
        audiences: ["Architectural buyers"],
        buyerNeeds: ["Custom fabrication"],
        primaryAction: "quote",
        referenceUrls: [],
      },
    })
  ).body.data;

  const planned = (
    await a.client.request("PUT", `/sites/${site.id}/plan`, {
      revision: site.planRevision,
      nodes: [
        {
          key: "home",
          path: "/",
          title: "Atelier Craft",
          type: "home",
          parentKey: null,
          productId: null,
          keywords: ["custom metalwork"],
          intent: "source",
        },
        {
          key: "about",
          path: "/about",
          title: "About Atelier Craft",
          type: "about",
          parentKey: "home",
          productId: null,
          keywords: ["craftsmanship"],
          intent: "learn",
        },
      ],
      keywords: [],
      clusters: [],
    })
  ).body.data;
  assert.equal(
    (
      await a.client.request("POST", `/sites/${site.id}/plan/confirm`, {
        revision: planned.planRevision,
      })
    ).status,
    200,
  );

  // Non-structural brandChannels update preserves planConfirmed.
  const currentSite = (await a.client.request("GET", `/sites/${site.id}`)).body.data;
  const channelUpdated = (
    await a.client.request("PATCH", `/sites/${site.id}`, {
      revision: currentSite.revision,
      data: {
        name: currentSite.name,
        templateId: currentSite.templateId,
        targetMarkets: currentSite.targetMarkets,
        language: currentSite.language,
        brandColor: "#0f5d73",
        logoId: null,
        productIds: [],
        buyerProfile: currentSite.buyerProfile,
        brandChannels: { whatsapp: "+4915123456789" },
        status: "draft",
      },
    })
  ).body.data;
  assert.equal(channelUpdated.planConfirmed, true);
  assert.equal(channelUpdated.brandChannels.whatsapp, "+4915123456789");

  // Structural targetMarkets update still invalidates planConfirmed.
  const marketUpdated = (
    await a.client.request("PATCH", `/sites/${site.id}`, {
      revision: channelUpdated.revision,
      data: {
        name: channelUpdated.name,
        templateId: channelUpdated.templateId,
        targetMarkets: ["Germany", "France"],
        language: channelUpdated.language,
        brandColor: "#0f5d73",
        logoId: null,
        productIds: [],
        buyerProfile: channelUpdated.buyerProfile,
        brandChannels: channelUpdated.brandChannels,
        status: "draft",
      },
    })
  ).body.data;
  assert.equal(marketUpdated.planConfirmed, false);

  const page = (
    await a.client.request("POST", `/sites/${site.id}/pages`, { nodeKey: "about" })
  ).body.data;

  // Live preview unsaved valid draft + unsourced numeric claim detection.
  const draftPayload = {
    title: "About Atelier Craft",
    metaDescription: "Architectural metalwork partner for global commercial buyers.",
    refs: [],
    blocks: [
      {
        key: "intro",
        type: "text",
        heading: "Unsaved Live Heading",
        body: "We deliver tailored metalwork solutions with 25 years of experience.",
        table: null,
        faq: [],
        assetId: null,
        alt: "",
        refs: [],
      },
    ],
  };
  const live = await a.client.request(
    "POST",
    `/pages/${page.id}/preview-draft`,
    draftPayload,
  );
  assert.equal(live.status, 200);
  assert.ok(live.body.data.html.includes("Unsaved Live Heading"));
  assert.ok(live.body.data.html.includes("https://wa.me/4915123456789"));
  assert.ok(
    live.body.data.issues.some((i: any) => i.code === "UNSOURCED_NUMBER"),
  );

  // DB page revision & content remain untouched.
  const reloaded = (await a.client.request("GET", `/pages/${page.id}`)).body.data;
  assert.equal(reloaded.revision, page.revision);
  assert.ok(!JSON.stringify(reloaded.blocks).includes("Unsaved Live Heading"));

  // Cross-tenant isolation.
  assert.equal(
    (await b.client.request("POST", `/pages/${page.id}/preview-draft`, draftPayload))
      .status,
    404,
  );
});

test("batch fact confirmation and batch page approval respect revision guards, fact gates, and tenant isolation", async () => {
  const a = await account("batch-a");
  const b = await account("batch-b");

  const f1 = (
    await a.client.request("POST", "/facts", {
      subjectType: "organization",
      type: "company.name",
      value: "Nordic Precision GmbH",
      source: { kind: "manual", quote: "Company registry", label: "Manual" },
    })
  ).body.data;
  const f2 = (
    await a.client.request("POST", "/facts", {
      subjectType: "organization",
      type: "company.email",
      value: "hello@example.com",
      source: { kind: "manual", quote: "Contact sheet", label: "Manual" },
    })
  ).body.data;
  const foreignFact = (
    await b.client.request("POST", "/facts", {
      subjectType: "organization",
      type: "company.name",
      value: "Other Corp",
      source: { kind: "manual", quote: "Other", label: "Manual" },
    })
  ).body.data;

  const batchFacts = await a.client.request("POST", "/facts/batch-confirm", {
    items: [
      { id: f1.id, revision: f1.revision },
      { id: f2.id, revision: f2.revision + 5 }, // stale revision -> skipped
      { id: foreignFact.id, revision: foreignFact.revision }, // cross-org -> skipped
    ],
    reason: "Batch verified",
  });
  assert.equal(batchFacts.status, 200);
  assert.deepEqual(batchFacts.body.data.confirmed, [f1.id]);
  assert.equal(batchFacts.body.data.skipped.length, 2);
  assert.equal(
    batchFacts.body.data.skipped.find((s: any) => s.id === f2.id)?.code,
    "REVISION_CONFLICT",
  );
  assert.equal(
    batchFacts.body.data.skipped.find((s: any) => s.id === foreignFact.id)?.code,
    "NOT_FOUND",
  );

  // Batch page approval: valid page approved, page with unsourced claim skipped.
  const site = (
    await a.client.request("POST", "/sites", {
      name: "Nordic Precision",
      templateId: "machinery",
      targetMarkets: ["Germany"],
      language: "en",
      brandColor: "#142d59",
      logoId: null,
      productIds: [],
    })
  ).body.data;
  const planned = (
    await a.client.request("PUT", `/sites/${site.id}/plan`, {
      revision: site.planRevision,
      nodes: [
        {
          key: "home",
          path: "/",
          title: "Nordic Precision",
          type: "home",
          parentKey: null,
          productId: null,
          keywords: ["machinery"],
          intent: "source",
        },
        {
          key: "about",
          path: "/about",
          title: "About Nordic Precision",
          type: "about",
          parentKey: "home",
          productId: null,
          keywords: ["company"],
          intent: "learn",
        },
      ],
      keywords: [],
      clusters: [],
    })
  ).body.data;
  assert.equal(
    (
      await a.client.request("POST", `/sites/${site.id}/plan/confirm`, {
        revision: planned.planRevision,
      })
    ).status,
    200,
  );
  const okPage = (
    await a.client.request("POST", `/sites/${site.id}/pages`, { nodeKey: "home" })
  ).body.data;
  const badPage = (
    await a.client.request("POST", `/sites/${site.id}/pages`, { nodeKey: "about" })
  ).body.data;

  const savedOk = (
    await a.client.request("PATCH", `/pages/${okPage.id}`, {
      revision: okPage.revision,
      data: {
        title: "Nordic Precision",
        metaDescription: "Industrial equipment for global buyers.",
        refs: [],
        blocks: [
          {
            key: "overview",
            type: "text",
            heading: "Overview",
            body: "Explore our industrial equipment range and request project details.",
            table: null,
            faq: [],
            assetId: null,
            alt: "",
            refs: [],
          },
        ],
      },
    })
  ).body.data;
  const savedBad = (
    await a.client.request("PATCH", `/pages/${badPage.id}`, {
      revision: badPage.revision,
      data: {
        title: "About Nordic Precision",
        metaDescription: "Unsourced certification claim.",
        refs: [],
        blocks: [
          {
            key: "overview",
            type: "text",
            heading: "About",
            body: "We are ISO 9001 certified with 999 machines.",
            table: null,
            faq: [],
            assetId: null,
            alt: "",
            refs: [],
          },
        ],
      },
    })
  ).body.data;

  const batchPages = await a.client.request(
    "POST",
    `/sites/${site.id}/pages/batch-approve`,
    {
      items: [
        { id: savedOk.id, revision: savedOk.revision },
        { id: savedBad.id, revision: savedBad.revision },
      ],
    },
  );
  assert.equal(batchPages.status, 200);
  assert.deepEqual(batchPages.body.data.approved, [savedOk.id]);
  assert.equal(batchPages.body.data.skipped.length, 1);
  assert.equal(batchPages.body.data.skipped[0].id, savedBad.id);
  assert.equal(
    (await a.client.request("GET", `/pages/${savedOk.id}`)).body.data.status,
    "approved",
  );
  assert.equal(
    (await a.client.request("GET", `/pages/${savedBad.id}`)).body.data.status,
    "blocked",
  );
});
