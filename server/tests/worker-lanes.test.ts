import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import mongoose from "mongoose";
import supertest from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.MONGOMS_VERSION ??= "7.0.14";

let mongo: MongoMemoryReplSet,
  app: any,
  storage: string,
  m: typeof import("../src/models"),
  ctx: typeof import("../src/models/tenant-context"),
  runtime: typeof import("../src/background/runtime");

const origin = "http://localhost:5173",
  password = "Fixture-" + randomBytes(20).toString("hex");

class Client {
  jar = new Map<string, string>();
  cookieHeader() {
    return [...this.jar].map(([k, v]) => k + "=" + v).join("; ");
  }
  make(method: string, url: string) {
    const agent = supertest(app) as any;
    return agent[method.toLowerCase()]("/api/v1" + url)
      .set("Origin", origin)
      .set("Cookie", this.cookieHeader())
      .set("X-CSRF-Token", this.jar.get("gs_csrf") ?? "");
  }
  async request(method: string, url: string, data?: unknown) {
    let r = this.make(method, url);
    if (data !== undefined) r = r.send(data);
    const result = await r;
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
    organizationName: tag + " Co",
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
  const me = (await client.request("GET", "/auth/me")).body.data;
  return { client, me };
}

before(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "gs-lanes-"));
  process.env.STORAGE_ROOT = storage;
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  process.env.MONGODB_URI = mongo.getUri("globalsite");
  const db = await import("../src/db");
  await db.connectDatabase();
  m = await import("../src/models");
  ctx = await import("../src/models/tenant-context");
  runtime = await import("../src/background/runtime");
  app = (await import("../src/app")).createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  await fs.rm(storage, { recursive: true, force: true });
});

test("worker fast lane and heavy lane isolate mail/inquiry/crm from site.agent/build tasks", async () => {
  const orgId = new mongoose.Types.ObjectId();
  const baseTime = new Date(Date.now() - 5000);
  await ctx.runWithTenant(String(orgId), async () => {
    await m.Task.create([
      {
        kind: "site.agent",
        operationId: "heavy-agent-" + randomUUID(),
        payload: { runId: String(new mongoose.Types.ObjectId()) },
        nextAttemptAt: new Date(baseTime.getTime() - 2000),
      },
      {
        kind: "mail",
        operationId: "fast-mail-" + randomUUID(),
        payload: {},
        nextAttemptAt: baseTime,
      },
      {
        kind: "inquiry.process",
        operationId: "fast-inq-" + randomUUID(),
        payload: {},
        nextAttemptAt: new Date(baseTime.getTime() + 500),
      },
      {
        kind: "site.build",
        operationId: "heavy-build-" + randomUUID(),
        payload: {},
        nextAttemptAt: new Date(baseTime.getTime() + 1000),
      },
    ]);
  });

  // Fast lane skips older site.agent task and claims mail immediately.
  const firstFast = await runtime.claimTask(new Date(), "fast");
  assert.equal(firstFast?.kind, "mail");
  const secondFast = await runtime.claimTask(new Date(), "fast");
  assert.equal(secondFast?.kind, "inquiry.process");
  const thirdFast = await runtime.claimTask(new Date(), "fast");
  assert.equal(thirdFast, null);

  // Heavy lane independently claims site.agent then site.build.
  const firstHeavy = await runtime.claimTask(new Date(), "heavy");
  assert.equal(firstHeavy?.kind, "site.agent");
  const secondHeavy = await runtime.claimTask(new Date(), "heavy");
  assert.equal(secondHeavy?.kind, "site.build");
  const thirdHeavy = await runtime.claimTask(new Date(), "heavy");
  assert.equal(thirdHeavy, null);
});

test("SSE agent-runs stream enforces authentication, tenant isolation, and pushes live runs event", async () => {
  const a = await account("sse-a");
  const b = await account("sse-b");
  const created = await a.client.request("POST", "/sites", {
    name: "Stream Co",
    templateId: "adaptive",
    targetMarkets: ["United States"],
    language: "en",
    brandColor: "#142d59",
    logoId: null,
    productIds: [],
    businessBrief: "Precision CNC components for automation OEMs.",
  });
  assert.equal(created.status, 201);
  const siteId = created.body.data.id;

  // Unauthenticated and cross-tenant requests rejected.
  const unauth = await supertest(app).get(`/api/v1/sites/${siteId}/agent-runs/stream`);
  assert.equal(unauth.status, 401);
  const crossOrg = await b.client.request("GET", `/sites/${siteId}/agent-runs/stream`);
  assert.equal(crossOrg.status, 404);

  // Real HTTP SSE stream receives initial event: runs JSON payload and closes cleanly.
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as any).port;
    const chunk = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        {
          hostname: "127.0.0.1",
          port,
          path: `/api/v1/sites/${siteId}/agent-runs/stream`,
          headers: {
            Cookie: a.client.cookieHeader(),
            Accept: "text/event-stream",
          },
        },
        (res) => {
          assert.equal(res.statusCode, 200);
          assert.ok(String(res.headers["content-type"]).includes("text/event-stream"));
          let buffer = "";
          res.setEncoding("utf8");
          res.on("data", (part) => {
            buffer += part;
            if (buffer.includes("\n\n")) {
              req.destroy();
              resolve(buffer);
            }
          });
          res.on("error", () => {
            if (buffer.includes("\n\n")) resolve(buffer);
          });
        },
      );
      req.on("error", (err) => {
        if ((err as any).code !== "ECONNRESET") reject(err);
      });
    });
    assert.ok(chunk.includes("event: runs"));
    const dataLine = chunk
      .split("\n")
      .find((line) => line.startsWith("data: "));
    assert.ok(dataLine);
    const parsed = JSON.parse(dataLine!.slice(6));
    assert.deepEqual(parsed.items, []);
    assert.equal(parsed.hasMore, false);
    assert.equal(parsed.nextCursor, null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
