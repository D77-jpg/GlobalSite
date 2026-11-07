import { before, after, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import supertest from "supertest";
import sharp from "sharp";
import * as XLSX from "xlsx";
import { zipSync } from "fflate";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
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
      { new: true },
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
async function product(name = "Fixture Pump") {
  const r = await a.client.request("POST", "/products", {
    name,
    sku: "SKU-" + randomBytes(5).toString("hex"),
    specs: [{ code: "POWER", name: "Power", value: "10", unit: "kW" }],
    specTable: { columns: ["Model", "Weight"], rows: [["A", "10 kg"]] },
    material: "Steel",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}
const manual = () => ({
  subjectType: "organization",
  type: "company.founded",
  value: "1998",
  source: {
    kind: "manual",
    quote: "Company founded in 1998",
    label: "Fixture evidence",
  },
});
test("HTTP product CRUD is tenant scoped, strict, revision guarded and role protected", async () => {
  const p = await product();
  assert.equal(p.source, "local");
  assert.equal(p.category, null);
  assert.deepEqual(p.specTable.rows, [["A", "10 kg"]]);
  assert.equal(
    (await b.client.request("GET", "/products/" + p.id)).status,
    404,
  );
  assert(
    !(await b.client.request("GET", "/products")).body.data.items.some(
      (r: any) => r.id === p.id,
    ),
  );
  assert.equal(
    (
      await a.client.request("POST", "/products", {
        name: "Unsafe",
        organizationId: b.me.organizationId,
      })
    ).status,
    400,
  );
  const data = { name: "Updated", sku: p.sku, status: "active" };
  assert.equal(
    (
      await a.client.request("PATCH", "/products/" + p.id, {
        revision: 1,
        data,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await a.client.request("PATCH", "/products/" + p.id, {
        revision: 1,
        data,
      })
    ).status,
    409,
  );
  await role("viewer");
  assert.equal(
    (await a.client.request("POST", "/products", { name: "Denied" })).status,
    403,
  );
  assert.equal(
    (await a.client.request("GET", "/products/" + p.id)).status,
    200,
  );
  await assert.rejects(() => m.Product.find(), /TENANT_REQUIRED/);
});
test("facts require admin review; edits return to candidate and retain revision evidence", async () => {
  const r = await a.client.request("POST", "/facts", manual());
  assert.equal(r.status, 201);
  let f = r.body.data;
  assert.equal(
    (
      await b.client.request("POST", "/facts/" + f.id + "/confirm", {
        revision: 1,
      })
    ).status,
    404,
  );
  await role("editor");
  assert.equal(
    (
      await a.client.request("POST", "/facts/" + f.id + "/confirm", {
        revision: 1,
      })
    ).status,
    403,
  );
  await role("admin");
  f = (
    await a.client.request("POST", "/facts/" + f.id + "/confirm", {
      revision: 1,
    })
  ).body.data;
  assert.equal(f.status, "confirmed");
  f = (
    await a.client.request("PATCH", "/facts/" + f.id, {
      revision: f.revision,
      data: {
        ...manual(),
        value: "1999",
        source: { kind: "manual", quote: "Corrected year 1999" },
      },
    })
  ).body.data;
  assert.equal(f.status, "candidate");
  assert.equal(f.reviewedBy, null);
  f = (
    await a.client.request("POST", "/facts/" + f.id + "/reject", {
      revision: f.revision,
      reason: "Needs original certificate",
    })
  ).body.data;
  assert.equal(f.status, "rejected");
  const history = (await a.client.request("GET", "/facts/" + f.id + "/history"))
    .body.data.items;
  assert.equal(history.length, 4);
  assert(history.some((r: any) => r.before?.status === "confirmed"));
  assert.equal(
    (
      await a.client.request("POST", "/facts", {
        ...manual(),
        source: { kind: "manual", quote: "x", url: "javascript:alert(1)" },
      })
    ).status,
    400,
  );
  const logs = await tenant(() => m.AuditLog.find({ targetId: f.id }).lean());
  assert(logs.length >= 4);
  assert(!JSON.stringify(logs).includes("1999"));
});
test("product edits invalidate confirmed facts and cross-tenant subjects/sources cannot be referenced", async () => {
  const p = await product();
  const data = {
    subjectType: "product",
    subjectId: p.id,
    type: "product.material",
    value: "Steel",
    source: {
      kind: "product",
      refId: p.id,
      revision: p.revision,
      quote: "Steel",
    },
  };
  const f = (await a.client.request("POST", "/facts", data)).body.data;
  assert.equal(
    (
      await a.client.request("POST", "/facts/" + f.id + "/confirm", {
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal((await b.client.request("POST", "/facts", data)).status, 404);
  await a.client.request("PATCH", "/products/" + p.id, {
    revision: 1,
    data: { name: p.name, sku: p.sku, material: "Aluminum" },
  });
  const current = await tenant(() => m.FactSheet.findById(f.id));
  assert.equal(current.status, "candidate");
  assert.equal(current.reviewedBy, undefined);
  assert.equal(
    (
      await a.client.request("POST", "/facts/" + f.id + "/confirm", {
        revision: current.revision,
      })
    ).status,
    409,
  );
});
test("images are sanitized, have private WebP derivatives and storage accounting includes every variant", async () => {
  const png = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#126a54" },
  })
    .png()
    .toBuffer();
  const r = await a.client.upload("/assets", png, "fixture.png", "image/png");
  assert.equal(r.status, 201);
  const rows = (await a.client.request("GET", "/assets?kind=image")).body.data
      .items,
    file = rows.find((x: any) => x.id === r.body.data.id);
  assert(file.thumbnailUrl && file.webpUrl);
  assert.equal(file.width, 640);
  assert(file.totalBytes > file.bytes);
  assert(!JSON.stringify(file).includes("key"));
  const thumb = await a.client.request(
    "GET",
    file.thumbnailUrl.replace("/api/v1", ""),
  );
  assert.equal(thumb.status, 200);
  assert.match(thumb.headers["content-type"], /image\/webp/);
  assert.equal(thumb.headers["cache-control"], "private, no-store");
  const meta = await sharp(thumb.body).metadata();
  assert(meta.width! <= 320);
  assert.equal(meta.exif, undefined);
  assert.equal(
    (await b.client.request("GET", "/assets/" + file.id)).status,
    404,
  );
  assert.equal(
    (
      await a.client.upload(
        "/assets",
        Buffer.from("<script>"),
        "bad.png",
        "image/png",
      )
    ).status,
    400,
  );
  const foreign = await b.client.request("POST", "/products", {
    name: "Foreign",
    assetIds: [file.id],
  });
  assert.equal(foreign.status, 404);
  const p = (
    await a.client.request("POST", "/products", {
      name: "With image",
      assetIds: [file.id],
    })
  ).body.data;
  assert.equal(
    (await a.client.request("DELETE", "/assets/" + file.id)).status,
    409,
  );
  await a.client.request("PATCH", "/products/" + p.id, {
    revision: 1,
    data: { name: p.name, sku: p.sku, assetIds: [] },
  });
  const usage = await tenant(() =>
    m.UsageBucket.findOne({ metric: "storage_bytes" }),
  );
  assert.equal(usage!.consumed, file.totalBytes);
  assert.equal(
    (await a.client.request("DELETE", "/assets/" + file.id)).status,
    200,
  );
  assert.equal(
    (await tenant(() => m.UsageBucket.findOne({ metric: "storage_bytes" })))!
      .consumed,
    0,
  );
});
test("PDF/certificate uploads download as attachments and references prevent deletion", async () => {
  const r = await a.client.upload(
    "/assets",
    Buffer.from("%PDF-1.4\nFixture private document"),
    "certificate.pdf",
    "application/pdf",
    "certificate",
  );
  assert.equal(r.status, 201);
  const id = r.body.data.id,
    download = await a.client.request("GET", "/assets/" + id + "/download");
  assert.equal(download.status, 200);
  assert.match(download.headers["content-disposition"], /attachment/);
  const f = await a.client.request("POST", "/facts", {
    ...manual(),
    source: { kind: "asset", refId: id, quote: "Fixture certificate" },
  });
  assert.equal(f.status, 201);
  assert(f.body.data.source.sha256);
  assert.equal((await a.client.request("DELETE", "/assets/" + id)).status, 409);
  assert.equal(
    (
      await b.client.request("POST", "/facts", {
        ...manual(),
        source: { kind: "asset", refId: id, quote: "Foreign" },
      })
    ).status,
    404,
  );
});
function workbook(rows: any[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Catalog");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
test("Excel custom mapping reports physical rows, formulas, missing values and duplicates", async () => {
  const { readWorkbook } = await import(
    "../src/services/product-import.service"
  );
  const bytes = workbook([
    ["Title", "Code", "Metal"],
    ["Pump A", "MAP-A", "Steel"],
    [],
    ["", "MAP-B", "Steel"],
    ["Pump duplicate", "MAP-A", "Steel"],
  ]);
  const upload = await a.client.upload(
    "/products/imports",
    bytes,
    "fixture.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(upload.status, 201);
  let batch = upload.body.data;
  assert.equal(batch.report.valid, 0);
  batch = (
    await a.client.request("PATCH", "/products/imports/" + batch.id, {
      revision: 1,
      mapping: { name: "Title", sku: "Code", material: "Metal" },
    })
  ).body.data;
  assert.equal(batch.report.valid, 1);
  assert.deepEqual(
    batch.report.items.map((r: any) => r.row),
    [2, 4, 5],
  );
  assert(
    batch.report.items
      .find((r: any) => r.row === 4)
      .errors.some((e: any) => e.field === "name"),
  );
  assert(
    batch.report.items
      .find((r: any) => r.row === 5)
      .errors.some((e: any) => e.code === "DUPLICATE_SKU"),
  );
  assert.equal(
    (await b.client.request("GET", "/products/imports/" + batch.id)).status,
    404,
  );
  const report = await a.client.request(
    "GET",
    "/products/imports/" + batch.id + "/report.csv",
  );
  assert.match(report.text, /INVALID_FIELD/);
  assert.equal(
    (
      await a.client.upload(
        "/products/imports",
        Buffer.from("PK corrupt"),
        "corrupt.xlsx",
        "application/octet-stream",
      )
    ).status,
    400,
  );
  const parsed = readWorkbook(
    Buffer.from("name,sku\n=SUM(A1),FORM-A\nSafe,FORM-B"),
    "formula.csv",
  );
  assert.deepEqual(parsed.rows[0].invalid, ["name"]);
  const malicious = zipSync({
    "xl/workbook.xml": Buffer.from("x"),
    "xl/vbaProject.bin": Buffer.from("bad"),
  });
  assert.throws(
    () => readWorkbook(Buffer.from(malicious), "unsafe.xlsx"),
    /IMPORT_UNSAFE_WORKBOOK/,
  );
  assert.throws(
    () =>
      readWorkbook(
        workbook([
          ["name", "name"],
          ["a", "b"],
        ]),
        "duplicates.xlsx",
      ),
    /IMPORT_HEADERS_INVALID/,
  );
  const huge = zipSync({
    "xl/workbook.xml": Buffer.from("x"),
    "xl/padding": new Uint8Array(11 * 1024 * 1024),
  });
  assert.throws(
    () => readWorkbook(Buffer.from(huge), "large.xlsx"),
    /IMPORT_ZIP_LIMIT/,
  );
});
test("confirmed imports resume idempotently; fences stop stale workers and existing SKUs are never overwritten", async () => {
  const svc = await import("../src/services/product-import.service");
  const data = await a.client.upload(
    "/products/imports",
    workbook([
      ["name", "sku"],
      ["Resume A", "RESUME-A"],
      ["Resume B", "RESUME-B"],
    ]),
    "resume.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  const id = data.body.data.id;
  assert.equal(
    (
      await a.client.request("POST", "/products/imports/" + id + "/confirm", {
        revision: 1,
      })
    ).status,
    202,
  );
  assert.equal(
    (
      await a.client.request("POST", "/products/imports/" + id + "/confirm", {
        revision: 1,
      })
    ).status,
    202,
  );
  const task = await liveTask(id, "catalog.import");
  assert(task);
  await tenant(() => svc.processImport(task));
  await tenant(() => svc.processImport(task));
  assert.equal(
    await tenant(() =>
      m.Product.countDocuments({ importKey: new RegExp("^" + id + ":") }),
    ),
    2,
  );
  assert.equal(
    await tenant(() => m.Task.countDocuments({ operationId: "import:" + id })),
    1,
  );
  const batch = await tenant(() => m.ProductImport.findById(id));
  assert.equal(batch.status, "complete");
  assert.equal(batch.results.length, 2);
  await tenant(() =>
    m.Task.updateOne({ _id: task._id }, { $inc: { fencingToken: 1 } }),
  );
  await assert.rejects(
    () => tenant(() => svc.processImport(task)),
    /LEASE_LOST/,
  );
  const again = await a.client.upload(
    "/products/imports",
    workbook([
      ["name", "sku"],
      ["Changed", "RESUME-A"],
    ]),
    "existing.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(again.body.data.report.valid, 0);
  assert.equal(again.body.data.report.items[0].errors[0].code, "SKU_EXISTS");
});
test("worker authorizes current membership before processing queued jobs", async () => {
  const svc = await import("../src/services/product-import.service");
  const batch = await a.client.upload(
    "/products/imports",
    workbook([["name"], ["Blocked job"]]),
    "revoked.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  const id = batch.body.data.id;
  await a.client.request("POST", "/products/imports/" + id + "/confirm", {
    revision: 1,
  });
  const task = await liveTask(id, "catalog.import");
  await role("viewer");
  await assert.rejects(
    () => tenant(() => svc.processImport(task)),
    /ACTOR_REVOKED/,
  );
  assert.equal(
    await tenant(() =>
      m.Product.countDocuments({ importKey: new RegExp("^" + id + ":") }),
    ),
    0,
  );
});
test("AI extraction uses configured model, filters ungrounded values, meters usage and never confirms candidates", async () => {
  const { encrypt } = await import("../src/services/credential-crypto"),
    { extractEvidence } = await import("../src/services/fact-ai.service");
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
  let requestBody: any;
  mock.method(globalThis, "fetch", async (_url: any, options: any) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        usage: { total_tokens: 37 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                facts: [
                  { type: "product.material", value: "Steel", quote: "Steel" },
                  {
                    type: "company.certified",
                    value: "ISO 9001",
                    quote: "Invented",
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  });
  const p = await product(),
    { queueExtraction, processExtraction } = await import(
      "../src/services/catalog-run.service"
    );
  const run = await tenant(() =>
      queueExtraction("product", p.id, a.me.user.id),
    ),
    task = await liveTask(run.id, "catalog.extract");
  await tenant(() => processExtraction(task));
  assert.equal(requestBody.model, "configured-fixture-model");
  const result = await a.client.request("GET", "/facts/extractions/" + run.id);
  assert.equal(result.body.data.status, "complete");
  assert.equal(result.body.data.rejectedCount, 1);
  assert.equal(result.body.data.tokens, 37);
  const fact = await tenant(() =>
    m.FactSheet.findById(result.body.data.resultIds[0]),
  );
  assert.equal(fact.status, "candidate");
  assert.equal(fact.source.textVerified, true);
  const record = await tenant(() =>
    m.UsageRecord.findOne({ operationId: "extract:" + run.id }),
  );
  assert.equal(record!.actual, 37);
  assert.equal(record!.state, "settled");
  // An ambiguous provider response holds reservation and cannot silently repeat a paid request.
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
  );
  const op = "ambiguous:" + randomUUID();
  await assert.rejects(
    () => tenant(() => extractEvidence("Steel", undefined, op, async () => {})),
    /AI_USAGE_UNKNOWN/,
  );
  assert.equal(
    (await tenant(() => m.UsageRecord.findOne({ operationId: op })))!.state,
    "reserved",
  );
  await assert.rejects(
    () => tenant(() => extractEvidence("Steel", undefined, op, async () => {})),
    /AI_USAGE_UNKNOWN/,
  );
});
test("AI durable result resumes without another provider call; stale sources reject writes", async () => {
  const { queueExtraction, processExtraction } = await import(
      "../src/services/catalog-run.service"
    ),
    { reserve } = await import("../src/services/usage.service");
  const p = await product(),
    run = await tenant(() => queueExtraction("product", p.id, a.me.user.id)),
    task = await liveTask(run.id, "catalog.extract");
  await tenant(async () => {
    await reserve("ai_tokens", 100, "extract:" + run.id);
    await m.AgentRun.updateOne(
      { _id: run.id },
      {
        $set: {
          pendingResult: {
            items: [
              { type: "product.material", value: "Steel", quote: "Steel" },
            ],
            tokens: 17,
            rejectedCount: 0,
          },
        },
      },
    );
  });
  await tenant(() =>
    processExtraction(task, async () => {
      assert.fail("Must reuse durable result");
    }),
  );
  assert.equal(
    (await a.client.request("GET", "/facts/extractions/" + run.id)).body.data
      .tokens,
    17,
  );
  const next = await tenant(() =>
      queueExtraction("product", p.id, a.me.user.id),
    ),
    staleTask = await liveTask(next.id, "catalog.extract");
  await a.client.request("PATCH", "/products/" + p.id, {
    revision: 1,
    data: { name: p.name, sku: p.sku, material: "Changed" },
  });
  await assert.rejects(
    () =>
      tenant(() =>
        processExtraction(staleTask, async () => {
          assert.fail("Changed source must not call AI");
        }),
      ),
    /SOURCE_CHANGED/,
  );
});
test("SSRF defenses reject private literals and every DNS answer; allow only pinned public IPv4", async () => {
  const { websiteUrl, publicTarget, publicIpv4, robotsAllows } = await import(
    "../src/services/website/public-web"
  );
  for (const url of [
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "http://localhost",
    "http://service.internal",
    "https://user:pass@company.com",
    "http://company.com:8080",
  ])
    assert.throws(() => websiteUrl(url));
  for (const ip of [
    "10.1.1.1",
    "100.64.0.1",
    "192.168.1.1",
    "172.20.0.1",
    "168.63.129.16",
    "198.18.0.1",
    "127.0.0.1",
    "::ffff:8.8.8.8",
  ])
    assert.equal(publicIpv4(ip), false);
  await assert.rejects(
    () =>
      publicTarget("https://company.com", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    /受限地址/,
  );
  assert.equal(
    (
      await publicTarget("https://company.com", async () => [
        { address: "8.8.8.8", family: 4 },
      ])
    ).address,
    "8.8.8.8",
  );
  assert.equal(
    robotsAllows(
      "/private/page",
      "User-agent: *\nDisallow: /private\nAllow: /private/public",
    ),
    false,
  );
  assert.equal(
    robotsAllows(
      "/private/public",
      "User-agent: *\nDisallow: /private\nAllow: /private/public",
    ),
    true,
  );
  assert.equal(
    (
      await a.client.request("POST", "/website-reads", {
        url: "http://127.0.0.1",
      })
    ).status,
    400,
  );
});
test("native website fetch pins DNS and rechecks redirects before a second connection", async () => {
  const { fetchWebsite } = await import("../src/services/website/public-web");
  let dnsCalls = 0,
    connections = 0;
  mock.method(dns, "lookup", async () => [
    { address: ++dnsCalls === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 },
  ]);
  mock.method(https, "request", (_url: any, options: any, cb: any) => {
    connections++;
    assert.equal(options.agent, false);
    options.lookup("company.com", {}, (_e: any, address: any) =>
      assert.equal(address, "8.8.8.8"),
    );
    assert.equal(options.headers["User-Agent"], "GlobalSite-Reader/1.0");
    const req = new EventEmitter() as any;
    req.end = () =>
      queueMicrotask(() => {
        const res = new PassThrough() as any;
        res.statusCode = 302;
        res.headers = { location: "/redirected" };
        cb(res);
        req.emit("close");
      });
    req.destroy = (e: any) => {
      if (e) req.emit("error", e);
      req.emit("close");
    };
    return req;
  });
  await assert.rejects(() => fetchWebsite("https://company.com"), /受限地址/);
  assert.equal(connections, 1);
  assert.equal(dnsCalls, 2);
});
test("website reader respects robots and snapshots structure into candidate facts and product drafts", async () => {
  const { processWebsite } = await import(
      "../src/services/website-read.service"
    ),
    calls: string[] = [];
  const html =
    '<title>Fixture Factory</title><h1>Factory</h1><a href="/products/pump">Pump</a><a href="/private">Private</a><a href="https://other.com">External</a><script type="application/ld+json">{"@type":"Organization","name":"Fixture Factory","foundingDate":"1998"}</script>';
  const fetcher = async (url: string, kind?: string) => {
    calls.push(url);
    return {
      url,
      status: 200,
      text:
        kind === "robots"
          ? "User-agent: *\nDisallow: /private"
          : url.endsWith("/products/pump")
            ? '<h1>Fixture Pump</h1><script type="application/ld+json">{"@type":"Product","name":"Fixture Pump","description":"Pump description"}</script>'
            : html,
    };
  };
  const r = await a.client.request("POST", "/website-reads", {
    url: "https://company.com",
    maxPages: 5,
  });
  assert.equal(r.status, 202);
  const id = r.body.data.id,
    task = await liveTask(id, "catalog.website");
  await tenant(() => processWebsite(task, fetcher));
  assert(!calls.some((url) => url.endsWith("/private")));
  const read = (await a.client.request("GET", "/website-reads/" + id)).body
    .data;
  assert.equal(read.status, "complete");
  assert(read.pages.some((p: any) => p.status === "robots_disallowed"));
  assert.equal(read.resultIds.length, 1);
  const p = await tenant(() => m.Product.findById(read.resultIds[0]));
  assert.equal(p.status, "draft");
  assert.equal(p.provenance.kind, "website");
  const f = await tenant(() => m.FactSheet.findById(read.factIds[0]));
  assert.equal(f.status, "candidate");
  assert.equal(
    (
      await a.client.request("POST", "/facts/" + f._id + "/confirm", {
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (await b.client.request("GET", "/website-reads/" + id)).status,
    404,
  );
  assert.match(
    (await a.client.request("GET", "/website-reads/" + id + "/migration.csv"))
      .text,
    /products\/pump/,
  );
});
test("CRM C1 mapping preserves nullable fields, stable remote references and excludes expiring URLs from product storage", async () => {
  const { mapCrmProduct } = await import("../src/services/crm-product-mapping");
  const dto = {
    id: "a".repeat(24),
    sku: "C1-1",
    name: "CRM fixture",
    category: null,
    description: null,
    status: "active",
    specs: [{ code: "M", name: "Material", value: "Steel", unit: null }],
    material: null,
    application: null,
    certifications: [],
    moq: null,
    leadTime: null,
    images: [
      {
        id: "remote-img",
        url: "https://company.com/image?expires=1",
        expiresAt: "2026-12-01T00:00:00.000Z",
        mime: "image/jpeg",
        bytes: 200,
        sha256: "a".repeat(64),
      },
    ],
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
  const result = mapCrmProduct(dto, "connection-fixture");
  assert.equal(result.source, "globalcrm");
  assert.equal(result.externalRef.remoteId, dto.id);
  assert.equal(result.material, null);
  assert.deepEqual(result.assetIds, []);
  assert.equal(result.remoteImages.length, 1);
  assert.throws(() =>
    mapCrmProduct({ ...dto, name: undefined }, "connection-fixture"),
  );
  assert.throws(() =>
    mapCrmProduct({ ...dto, material: undefined }, "connection-fixture"),
  );
});

function fixturePdf(text: string) {
  const stream = text ? "BT /F1 12 Tf 50 700 Td (" + text + ") Tj ET" : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      Buffer.byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  for (const [obj, i] of objects.map((s, i) => [s, i] as const)) {
    offsets.push(Buffer.byteLength(result));
    result += i + 1 + " 0 obj\n" + obj + "\nendobj\n";
  }
  const start = Buffer.byteLength(result);
  result +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    start +
    "\n%%EOF";
  return Buffer.from(result);
}
test("PDF extraction reads literal text; scanned/empty documents do not spend AI allowance", async () => {
  const { queueExtraction, processExtraction } = await import(
    "../src/services/catalog-run.service"
  );
  const upload = await a.client.upload(
    "/assets",
    fixturePdf("Fixture founded 1998"),
    "readable.pdf",
    "application/pdf",
  );
  const run = await tenant(() =>
      queueExtraction("asset", upload.body.data.id, a.me.user.id),
    ),
    task = await liveTask(run.id, "catalog.extract");
  let called = false;
  await tenant(() =>
    processExtraction(task, async (text, image, _op, save) => {
      called = true;
      assert(text.includes("Fixture founded 1998"));
      assert.equal(image, undefined);
      const result = {
        items: [
          {
            type: "company.founded",
            value: "1998",
            quote: "Fixture founded 1998",
          },
        ],
        tokens: 23,
        rejectedCount: 0,
      };
      await save(result);
      return result;
    }),
  );
  assert(called);
  const f = await tenant(() =>
    m.FactSheet.findOne({ originKey: "extract:" + run.id + ":0" }),
  );
  assert.equal(f.source.textVerified, true);
  assert.equal(f.status, "candidate");
  const empty = await a.client.upload(
      "/assets",
      fixturePdf(""),
      "scanned.pdf",
      "application/pdf",
    ),
    emptyRun = await tenant(() =>
      queueExtraction("asset", empty.body.data.id, a.me.user.id),
    ),
    emptyTask = await liveTask(emptyRun.id, "catalog.extract");
  await assert.rejects(
    () =>
      tenant(() =>
        processExtraction(emptyTask, async () => {
          assert.fail("Empty PDFs must not call AI");
        }),
      ),
    /DOCUMENT_NO_TEXT/,
  );
});
test("image transcription is visibly unverified and quota rejection happens before the provider request", async () => {
  const { queueExtraction, processExtraction } = await import(
      "../src/services/catalog-run.service"
    ),
    { extractEvidence } = await import("../src/services/fact-ai.service");
  const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#126a54" },
    })
      .png()
      .toBuffer(),
    upload = await a.client.upload(
      "/assets",
      png,
      "candidate.png",
      "image/png",
    );
  const run = await tenant(() =>
      queueExtraction("asset", upload.body.data.id, a.me.user.id),
    ),
    task = await liveTask(run.id, "catalog.extract");
  await tenant(() =>
    processExtraction(task, async (_text, image, _op, save) => {
      assert.match(image!, /^data:image\/webp;base64,/);
      const result = {
        items: [
          {
            type: "company.certificate",
            value: "Machine reading",
            quote: "Machine reading",
          },
        ],
        tokens: 29,
        rejectedCount: 0,
      };
      await save(result);
      return result;
    }),
  );
  const f = await tenant(() =>
    m.FactSheet.findOne({ originKey: "extract:" + run.id + ":0" }),
  );
  assert.equal(f.source.textVerified, false);
  assert.equal(f.status, "candidate");
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  mock.method(globalThis, "fetch", async () => {
    assert.fail("Quota must reject before outbound request");
  });
  await assert.rejects(
    () =>
      tenant(() =>
        extractEvidence(
          "x".repeat(210000),
          undefined,
          "quota:" + randomUUID(),
          async () => {},
        ),
      ),
    /QUOTA_EXCEEDED/,
  );
});

test("expired task heartbeats cannot resurrect an expired lease or renew another holder's fence", async () => {
  const { renewTask } = await import("../src/background/runtime"),
    runId = new mongoose.Types.ObjectId().toString();
  await tenant(() =>
    m.Task.create({
      kind: "catalog.import",
      payload: { runId } as any,
      operationId: "heartbeat:" + runId,
    }),
  );
  const task = await liveTask(runId, "catalog.import");
  assert.equal((await tenant(() => renewTask(task))).matchedCount, 1);
  await tenant(() =>
    m.Task.updateOne(
      { _id: task._id },
      { $set: { leaseUntil: new Date(Date.now() - 1) } },
    ),
  );
  assert.equal((await tenant(() => renewTask(task))).matchedCount, 0);
  await tenant(() =>
    m.Task.updateOne(
      { _id: task._id },
      {
        $set: { leaseUntil: new Date(Date.now() + 60000) },
        $inc: { fencingToken: 1 },
      },
    ),
  );
  assert.equal((await tenant(() => renewTask(task))).matchedCount, 0);
});

test("organization image provider generates once and stores an illustration in its own library", async () => {
  const config = "/assets/image-provider",
    path = "/assets/generate-image";
  const credential = randomBytes(32).toString("hex");
  const result = await a.client.request("PUT", config, { apiKey: credential });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.configured, true);
  assert.equal(
    (await b.client.request("GET", config)).body.data.configured,
    false,
  );
  const png = await sharp({
    create: { width: 24, height: 16, channels: 3, background: "#142d59" },
  })
    .png()
    .toBuffer();
  let calls = 0;
  mock.method(globalThis, "fetch", async (url: any, init: any) => {
    assert.equal(url, "https://www.codex789.com/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer " + credential);
    calls++;
    return Response.json({
      choices: [
        {
          message: {
            content: "data:image/png;base64," + png.toString("base64"),
          },
        },
      ],
    });
  });
  const key = randomUUID(),
    brief = { subject: "Cerulean studio still life", composition: "campaign" };
  const send = () =>
    a.client.make("POST", path).set("Idempotency-Key", key).send(brief);
  await role("viewer");
  assert.equal((await send()).status, 403);
  await role("editor");
  assert.equal(
    (await a.client.make("PUT", config).send({ apiKey: "" })).status,
    403,
  );
  const created = await send();
  assert.equal(created.status, 201);
  a.client.check(created, "POST", path);
  assert.equal((await send()).status, 409);
  assert.equal(calls, 1);
  const id = created.body.data.id;
  assert.equal((await b.client.make("GET", "/assets/" + id)).status, 404);
  const extraction = await a.client
    .make("POST", "/facts/extractions")
    .send({ kind: "asset", id, consent: true });
  assert.equal(extraction.body.error.code, "CONCEPT_NOT_EVIDENCE");
  await role("admin");
  assert.equal(
    (await a.client.request("PUT", config, { apiKey: "" })).body.data
      .configured,
    false,
  );
});
