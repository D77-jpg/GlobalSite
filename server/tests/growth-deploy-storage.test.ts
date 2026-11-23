import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import supertest from "supertest";
import sharp from "sharp";
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
    organizationName: tag + " Export Co",
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
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "gs-s28-"));
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

test("SEO verification meta, custom OG image, redirects, consent-gated analytics, domain diagnostics and signed deploy webhook work end-to-end", async () => {
  const { client } = await account("s28-seo");
  const png = await sharp({
    create: {
      width: 600,
      height: 315,
      channels: 3,
      background: { r: 24, g: 52, b: 80 },
    },
  })
    .png()
    .toBuffer();
  const assetRes = await client
    .make("POST", "/assets")
    .field("kind", "image")
    .attach("file", png, { filename: "og-banner.png", contentType: "image/png" });
  assert.equal(assetRes.status, 201);
  const ogAssetId = assetRes.body.data.id;

  const siteRes = await client.request("POST", "/sites", {
    name: "Nordic Valves",
    templateId: "machinery",
    targetMarkets: ["Germany"],
    language: "en",
    brandColor: "#1b4332",
    logoId: null,
    productIds: [],
    businessBrief: "Industrial ball valves and actuators for chemical plants.",
  });
  assert.equal(siteRes.status, 201);
  const siteId = siteRes.body.data.id;

  const planned = await client.request("PUT", `/sites/${siteId}/plan`, {
    revision: siteRes.body.data.planRevision,
    nodes: [
      {
        key: "home",
        type: "home",
        path: "/",
        title: "Nordic Valves",
        parentKey: null,
        productId: null,
        keywords: ["industrial valves"],
        intent: "source",
      },
    ],
    keywords: [],
    clusters: [],
  });
  assert.equal(planned.status, 200);
  assert.equal(
    (
      await client.request("POST", `/sites/${siteId}/plan/confirm`, {
        revision: planned.body.data.planRevision,
      })
    ).status,
    200,
  );
  const home = (
    await client.request("POST", `/sites/${siteId}/pages`, { nodeKey: "home" })
  ).body.data;
  const saveHome = await client.request("PATCH", `/pages/${home.id}`, {
    revision: home.revision,
    data: {
      title: "Nordic Valves Industrial Flow Control",
      metaDescription:
        "Precision industrial valve supplier offering stainless steel and carbon steel flow control assemblies for global engineering buyers.",
      blocks: [
        {
          key: "overview",
          type: "text",
          heading: "Industrial Valve Supply",
          body: "Nordic Valves manufactures durable ball valves, butterfly valves, and pneumatic actuators for global chemical processing, water treatment, and energy infrastructure teams. Every assembly undergoes pressure testing, material traceability review, and export packing tailored to project delivery schedules across Europe and North America. Engineering teams can request technical drawings, material documentation, dimensional inspection sheets, and sample shipments before bulk manufacturing begins for ongoing plant maintenance or new industrial installation projects.",
          assetId: null,
          alt: "",
          table: null,
          faq: [],
          refs: [],
        },
      ],
      refs: [],
    },
  });
  assert.equal(saveHome.status, 200);
  assert.equal(
    (
      await client.request("POST", `/pages/${home.id}/approve`, {
        revision: saveHome.body.data.revision,
      })
    ).status,
    200,
  );

  // Configure SEO analytics, redirects, custom OG image, and signed deploy webhook.
  const hookSecret = "super-secret-webhook-signing-key";
  const saveCfg = await client.request(
    "PUT",
    `/sites/${siteId}/publishing-settings`,
    {
      revision: 0,
      canonicalBaseUrl: "https://valves.example.com",
      accountId: null,
      projectName: null,
      productionBranch: "main",
      domain: "valves.example.com",
      deployWebhookUrl: "https://hooks.example.com/deploy",
      webhookSecret: hookSecret,
      seoAnalytics: {
        ga4MeasurementId: "G-AB12CD34EF",
        gtmContainerId: "GTM-XYZ9876",
        metaPixelId: "1234567890123",
        googleSiteVerification: "gsc-verify-token-001",
        bingSiteVerification: "0123456789abcdef0123456789abcdef",
        ogImageAssetId: ogAssetId,
        redirects: [
          { from: "/legacy-valves", to: "/", status: 301 },
          { from: "/old-catalog", to: "/catalogue.html", status: 302 },
        ],
      },
    },
  );
  assert.equal(saveCfg.status, 200);
  assert.equal(saveCfg.body.data.webhookConfigured, true);
  assert.equal(saveCfg.body.data.seoAnalytics.ga4MeasurementId, "G-AB12CD34EF");
  assert.equal(saveCfg.body.data.seoAnalytics.ogImageAssetId, ogAssetId);

  // In-use OG image asset cannot be deleted.
  const delAsset = await client.request("DELETE", `/assets/${ogAssetId}`);
  assert.equal(delAsset.status, 409);
  assert.equal(delAsset.body.error.code, "ASSET_IN_USE");

  // Domain check returns structured diagnostics.
  const diagRes = await client.request("POST", `/sites/${siteId}/domain-check`, {});
  assert.equal(diagRes.status, 200);
  assert.ok(Array.isArray(diagRes.body.data.diagnostics));

  // Build static version via worker tick.
  const buildReq = await client
    .make("POST", `/sites/${siteId}/builds`)
    .set("Idempotency-Key", "s28-build-" + randomBytes(6).toString("hex"))
    .send({});
  assert.equal(buildReq.status, 202);
  const versionId = buildReq.body.data.id;

  const { tick } = await import("../src/background/runtime");
  for (let i = 0; i < 6; i++) {
    const ran = await tick("heavy");
    if (!ran) break;
  }
  const versionRes = await client.request("GET", `/site-versions/${versionId}`);
  assert.equal(versionRes.status, 200);
  assert.equal(versionRes.body.data.status, "ready");

  // Inspect built zip: verification meta, custom OG image, consent data attrs (no inline gtag script), and _redirects!
  const exportRes = await client
    .make("GET", `/site-versions/${versionId}/export`)
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(exportRes.status, 200);
  const { unpack } = await import("../src/services/static-builder.service");
  const files = unpack(exportRes.body);
  const html = Buffer.from(files["index.html"]).toString("utf8");
  assert.match(
    html,
    /<meta name="google-site-verification" content="gsc-verify-token-001">/,
  );
  assert.match(
    html,
    /<meta name="msvalidate\.01" content="0123456789abcdef0123456789abcdef">/,
  );
  assert.match(html, /property="og:image" content="https:\/\/valves\.example\.com\/assets\/[a-f0-9]+\.webp"/);
  assert.match(html, /data-ga4-id="G-AB12CD34EF"/);
  assert.match(html, /data-gtm-id="GTM-XYZ9876"/);
  assert.match(html, /data-meta-pixel-id="1234567890123"/);
  assert.ok(
    !html.includes("googletagmanager.com"),
    "Analytics script must not be statically embedded before consent",
  );
  const redirectsFile = Buffer.from(files["_redirects"]).toString("utf8");
  assert.equal(
    redirectsFile,
    "/legacy-valves / 301\n/old-catalog /catalogue.html 302\n",
  );

  // Trigger signed deploy webhook with mocked transport.
  const pub = await import("../src/services/publishing.service");
  const origPost = pub.webhookClient.post;
  let captured: { url: string; body: string; headers: Record<string, string> } | null = null;
  pub.webhookClient.post = async (url, body, headers) => {
    captured = { url, body, headers };
    return { ok: true, status: 202 };
  };
  try {
    const whRes = await client.request(
      "POST",
      `/site-versions/${versionId}/webhook`,
      {},
    );
    assert.equal(whRes.status, 200);
    assert.equal(whRes.body.data.delivered, true);
    assert.equal(whRes.body.data.statusCode, 202);
    assert.ok(captured);
    assert.equal(captured!.url, "https://hooks.example.com/deploy");
    assert.equal(captured!.headers["X-GlobalSite-Event"], "site.version.ready");
    const expectedSig =
      "sha256=" +
      createHmac("sha256", hookSecret).update(captured!.body).digest("hex");
    assert.equal(captured!.headers["X-GlobalSite-Signature"], expectedSig);
  } finally {
    pub.webhookClient.post = origPost;
  }
});

test("inquiry summary funnel and visitor auto-reply enforce privacy, tenant isolation and anti-reflection", async () => {
  const { client } = await account("s28-inq");
  const other = await account("s28-inq-other");
  const siteRes = await client.request("POST", "/sites", {
    name: "Apex Optics",
    templateId: "adaptive",
    targetMarkets: ["USA"],
    language: "en",
    brandColor: "#1d3557",
    logoId: null,
    productIds: [],
    businessBrief: "Precision optical lenses for laboratory instruments.",
  });
  const siteId = siteRes.body.data.id;

  // Enable inquiries + auto-reply.
  const saveInq = await client.request("PUT", `/sites/${siteId}/inquiry-settings`, {
    revision: 0,
    enabled: true,
    privacyReviewed: true,
    aiSpamEnabled: false,
    notificationUserIds: [],
    turnstileSiteKey: null,
    autoReplyEnabled: true,
    autoReplySubject: "Apex Optics: We received your RFQ",
    autoReplyBody: "Thank you for reaching out. Our engineers will reply within one business day.",
  });
  assert.equal(saveInq.status, 200);
  assert.equal(saveInq.body.data.autoReplyEnabled, true);
  assert.equal(saveInq.body.data.autoReplySubject, "Apex Optics: We received your RFQ");

  // Seed two inquiries inside org context to verify worker auto-reply + summary endpoint.
  const me = await client.request("GET", "/auth/me");
  const orgId = me.body.data.organizationId;
  const { SiteInquiry, Task } = await import("../src/models");
  const { runWithTenant } = await import("../src/models/tenant-context");
  const { encrypt } = await import("../src/services/credential-crypto");

  const inqId1 = new mongoose.Types.ObjectId();
  const inqId2 = new mongoose.Types.ObjectId();
  await runWithTenant(orgId, async () => {
    const mkSecret = (id: string, email: string, msg: string, utmSource: string | null) =>
      encrypt(
        JSON.stringify({
          contact: {
            name: "Buyer",
            company: "Lab Corp",
            email,
            country: "USA",
            phone: "",
          },
          message: msg,
          productIds: [],
          products: [],
          quantity: 50,
          attachments: [],
          source: {
            pageUrl: "https://optics.example.com/",
            referrer: "https://www.google.com/search?q=lenses",
            utm: {
              source: utmSource,
              medium: null,
              campaign: null,
              term: null,
              content: null,
            },
            device: "desktop",
            firstVisitAt: new Date().toISOString(),
            preview: false,
          },
        }),
        `inquiry:${orgId}:${id}`,
      );
    await SiteInquiry.create([
      {
        _id: inqId1,
        siteId,
        versionId: new mongoose.Types.ObjectId(),
        submissionId: randomUUID(),
        receiptId: "INQ-AUTO-001",
        requestHash: "h1",
        emailHash: "eh1",
        secret: mkSecret(String(inqId1), "buyer@labcorp.example", "SECRET_VISITOR_TEXT_DO_NOT_ECHO", "linkedin"),
        status: "new",
        reasons: [],
      },
      {
        _id: inqId2,
        siteId,
        versionId: new mongoose.Types.ObjectId(),
        submissionId: randomUUID(),
        receiptId: "INQ-RESOLVED-002",
        requestHash: "h2",
        emailHash: "eh2",
        secret: mkSecret(String(inqId2), "ops@labcorp.example", "Quote request", null),
        status: "resolved",
        processedAt: new Date(),
        reasons: [],
      },
    ]);
    await Task.create({
      kind: "inquiry.process",
      operationId: "inquiry.process:" + inqId1,
      payload: { runId: String(inqId1) },
      status: "pending",
      nextAttemptAt: new Date(),
    });
  });

  // Run worker fast lane with mocked SMTP to verify auto-reply sends without echoing visitor text.
  const { config } = await import("../src/config");
  const worker = await import("../src/services/inquiry-worker.service");
  const { tick } = await import("../src/background/runtime");
  const origHost = config.smtpHost;
  const origSend = worker.inquiryMail.send;
  const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
  config.smtpHost = "smtp.example.invalid";
  worker.inquiryMail.send = async (m) => {
    sentEmails.push({ to: m.to, subject: m.subject, text: m.text });
  };
  try {
    for (let i = 0; i < 6; i++) {
      const ran = await tick("fast");
      if (!ran) break;
    }
  } finally {
    config.smtpHost = origHost;
    worker.inquiryMail.send = origSend;
  }

  const autoReply = sentEmails.find((e) => e.to === "buyer@labcorp.example");
  assert.ok(autoReply, "Visitor auto-reply should be sent");
  assert.equal(autoReply!.subject, "Apex Optics: We received your RFQ");
  assert.ok(autoReply!.text.includes("INQ-AUTO-001"));
  assert.ok(
    !autoReply!.text.includes("SECRET_VISITOR_TEXT_DO_NOT_ECHO"),
    "Auto-reply must never echo untrusted visitor message text",
  );

  // Check summary endpoint & tenant isolation.
  const sumRes = await client.request("GET", `/inquiries/summary?siteId=${siteId}`);
  assert.equal(sumRes.status, 200);
  assert.equal(sumRes.body.data.nonDuplicate, 2);
  assert.equal(sumRes.body.data.byStatus.new, 1);
  assert.equal(sumRes.body.data.byStatus.resolved, 1);
  assert.equal(sumRes.body.data.responseRate, 50);
  assert.ok(
    sumRes.body.data.topSources.some((s: any) => s.source === "linkedin" && s.count === 1),
  );
  assert.ok(
    sumRes.body.data.topSources.some((s: any) => s.source === "www.google.com" && s.count === 1),
  );

  const otherSum = await other.client.request("GET", "/inquiries/summary");
  assert.equal(otherSum.status, 200);
  assert.equal(otherSum.body.data.nonDuplicate, 0);
});

test("S3/R2 object storage adapter signs AWS SigV4 requests and executes tenant-scoped PUT/GET/DELETE", async () => {
  const s3 = await import("../src/services/object-storage.service");
  const { config } = await import("../src/config");
  const orgId = "507f1f77bcf86cd799439011";
  const key = randomUUID();
  const cfg = {
    endpoint: "https://acct.r2.cloudflarestorage.com",
    bucket: "globalsite-assets",
    region: "auto",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret-key-example",
    prefix: "prod",
  };
  const signed = s3.signS3Request({
    method: "PUT",
    key: s3.objectKey(orgId, key, cfg.prefix),
    body: Buffer.from("hello-s3"),
    contentType: "text/plain",
    cfg,
    now: new Date("2026-05-01T12:00:00.000Z"),
  });
  assert.equal(
    signed.url,
    `https://acct.r2.cloudflarestorage.com/globalsite-assets/prod/${orgId}/${key}`,
  );
  assert.match(
    signed.headers.Authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260501\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/,
  );

  // Mock S3 HTTP transport and test full PUT -> GET -> DELETE lifecycle.
  const store = new Map<string, Buffer>();
  const orig = {
    endpoint: config.s3Endpoint,
    bucket: config.s3Bucket,
    region: config.s3Region,
    ak: config.s3AccessKeyId,
    sk: config.s3SecretAccessKey,
    prefix: config.s3Prefix,
    fetch: s3.s3Transport.fetch,
  };
  config.s3Endpoint = cfg.endpoint;
  config.s3Bucket = cfg.bucket;
  config.s3Region = cfg.region;
  config.s3AccessKeyId = cfg.accessKeyId;
  config.s3SecretAccessKey = cfg.secretAccessKey;
  config.s3Prefix = cfg.prefix;
  s3.s3Transport.fetch = async (url, init) => {
    const method = init.method ?? "GET";
    if (method === "PUT") {
      store.set(url, Buffer.from(init.body as Uint8Array));
      return new Response("", { status: 200 });
    }
    if (method === "GET") {
      const b = store.get(url);
      return b
        ? new Response(new Uint8Array(b), { status: 200 })
        : new Response("", { status: 404 });
    }
    if (method === "DELETE") {
      store.delete(url);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 405 });
  };
  try {
    await s3.s3Put(orgId, key, Buffer.from("binary-payload"), "image/webp");
    const fetched = await s3.s3Get(orgId, key, 1024);
    assert.equal(fetched.toString("utf8"), "binary-payload");
    await s3.s3Delete(orgId, key);
    await assert.rejects(() => s3.s3Get(orgId, key, 1024), /NOT_FOUND/);
  } finally {
    config.s3Endpoint = orig.endpoint;
    config.s3Bucket = orig.bucket;
    config.s3Region = orig.region;
    config.s3AccessKeyId = orig.ak;
    config.s3SecretAccessKey = orig.sk;
    config.s3Prefix = orig.prefix;
    s3.s3Transport.fetch = orig.fetch;
  }
});
