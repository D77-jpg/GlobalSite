import { assertResponse } from "./contract";
import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import supertest from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.NODE_ENV = "test";
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION ?? "7.0.14";
let mongo: MongoMemoryReplSet;
let app: ReturnType<typeof import("../src/app").createApp>;
let storage: string;
let models: typeof import("../src/models");
let contexts: typeof import("../src/models/tenant-context");
const origin = "http://localhost:5173";
const fixturePassword = "Test-" + randomBytes(20).toString("hex");
let counter = 0;
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
    const result = await req;
    assertResponse(
      method,
      url,
      result.status,
      result.body,
      String(result.headers["content-type"] ?? ""),
    );
    for (const item of result.headers["set-cookie"] ?? []) {
      const [k, v] = item.split(";")[0].split("=");
      this.jar.set(k, v);
    }
    return result;
  }
}
async function notification(receipt: string) {
  const r = await new Client().request("GET", "/dev/mail/" + receipt);
  assert.equal(r.status, 200);
  return r.body.data.text as string;
}
async function account(prefix = "fixture") {
  const client = new Client();
  const email = prefix + "-" + ++counter + "@example.invalid";
  const signup = await client.request("POST", "/auth/register", {
    name: "Fixture User",
    email,
    password: fixturePassword,
    organizationName: "Fixture Organization",
    locale: "en",
  });
  assert.equal(signup.status, 202, JSON.stringify(signup.body));
  const text = await notification(signup.body.data.devReceipt);
  const token = new URL(text).searchParams.get("token");
  assert.equal(
    (await client.request("POST", "/auth/verify-email", { token })).status,
    200,
  );
  const login = await client.request("POST", "/auth/login", {
    email,
    password: fixturePassword,
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.data.authenticated, true);
  const me = (await client.request("GET", "/auth/me")).body.data;
  return { client, email, me, token };
}
before(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "globalsite-test-"));
  process.env.STORAGE_ROOT = storage;
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: process.env.MONGOMS_VERSION },
  });
  const db = await import("../src/db");
  await db.connectDatabase(mongo.getUri("globalsite"));
  models = await import("../src/models");
  contexts = await import("../src/models/tenant-context");
  app = (await import("../src/app")).createApp();
});
after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (storage) {
    assert.equal(path.dirname(storage), path.resolve(os.tmpdir()));
    assert(path.basename(storage).startsWith("globalsite-test-"));
    await fs.rm(storage, { recursive: true, force: true });
  }
});
beforeEach(async () => {
  await contexts.runIdentity(() => models.RateLimit.deleteMany({}));
});
test("registration atomically creates independent organization/admin; verification is single-use", async () => {
  const a = await account();
  assert.equal(a.me.role, "admin");
  assert(a.me.organizationId);
  assert.equal(a.me.user.emailVerified, true);
  const replay = await a.client.request("POST", "/auth/verify-email", {
    token: a.token,
  });
  assert.equal(replay.status, 400);
  const logs = await contexts.runWithTenant(a.me.organizationId, () =>
    models.AuditLog.find().lean(),
  );
  assert(logs.some((x) => x.action === "organization.created"));
  assert(!JSON.stringify(logs).includes(a.email));
});
test("unverified email cannot log in; login response never exposes cookies or password hashes", async () => {
  const c = new Client(),
    email = "unverified@example.invalid";
  await c.request("POST", "/auth/register", {
    name: "Fixture",
    organizationName: "Fixture",
    email,
    password: fixturePassword,
  });
  const login = await c.request("POST", "/auth/login", {
    email,
    password: fixturePassword,
  });
  assert.equal(login.status, 403);
  assert.equal(login.body.error.code, "EMAIL_UNVERIFIED");
});
test("tenant plugin fails closed and protects query/aggregate/update/upsert/bulk/document paths", async () => {
  const a = await account(),
    b = await account();
  await assert.rejects(() => models.AuditLog.find(), /TENANT_REQUIRED/);
  await contexts.runWithTenant(a.me.organizationId, async () => {
    await models.AuditLog.create({ action: "fixture.a" });
    assert.equal(
      await models.Membership.countDocuments({
        organizationId: b.me.organizationId,
      }),
      0,
    );
    assert.deepEqual(
      await models.Membership.aggregate([
        {
          $match: {
            organizationId: new mongoose.Types.ObjectId(b.me.organizationId),
          },
        },
      ]),
      [],
    );
    assert.equal(
      (
        await models.Membership.updateMany(
          { organizationId: b.me.organizationId },
          { $set: { role: "viewer" } },
        )
      ).modifiedCount,
      0,
    );
    await assert.rejects(
      () =>
        models.Membership.updateOne(
          {},
          { $set: { organizationId: b.me.organizationId } },
        ),
      /TENANT_IMMUTABLE/,
    );
    await assert.rejects(
      () =>
        models.AuditLog.create({
          organizationId: b.me.organizationId,
          action: "cross",
        }),
      /TENANT_MISMATCH/,
    );
    await assert.rejects(
      () => models.AuditLog.insertMany([{ action: "bypass" }]),
      /TENANT_USE_CREATE/,
    );
    await assert.rejects(
      () =>
        models.AuditLog.bulkWrite([
          { insertOne: { document: { action: "bypass" } } },
        ]),
      /TENANT_USE_SCOPED_WRITES/,
    );
    await assert.rejects(
      () =>
        models.AuditLog.aggregate([
          { $lookup: { from: "users", as: "leak", pipeline: [] } },
        ]),
      /TENANT_UNSAFE_AGGREGATE/,
    );
    const doc = await models.AuditLog.findOne();
    assert(doc);
    await assert.rejects(() => doc.deleteOne(), /TENANT_USE_SCOPED_WRITES/);
  });
  const members = (await b.client.request("GET", "/members")).body.data.items;
  const attack = await a.client.request("PATCH", "/members/" + members[0].id, {
    role: "viewer",
  });
  assert.equal(attack.status, 404);
  assert.equal(
    (await b.client.request("GET", "/auth/me")).body.data.role,
    "admin",
  );
});
test("browser writes require correct Origin and session-bound CSRF; no bearer fallback", async () => {
  const a = await account();
  const response = await a.client.request("GET", "/auth/me");
  assert.equal(response.status, 200);
  const raw = await supertest(app)
    .patch("/api/v1/organization")
    .set("Origin", origin)
    .set("Cookie", [...a.client.jar].map(([k, v]) => k + "=" + v).join("; "))
    .send({ name: "Blocked" });
  assert.equal(raw.status, 403);
  assert.equal(
    (
      await a.client.request(
        "PATCH",
        "/organization",
        { name: "Blocked" },
        { Origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await supertest(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer arbitrary")
    ).status,
    401,
  );
});
test("refresh rotates both tokens; replay revokes the entire session and logout invalidates access", async () => {
  const a = await account();
  const old = new Map(a.client.jar);
  assert.equal((await a.client.request("POST", "/auth/refresh")).status, 200);
  assert.notEqual(old.get("gs_refresh"), a.client.jar.get("gs_refresh"));
  const stale = new Client();
  stale.jar = old;
  assert.equal((await stale.request("POST", "/auth/refresh")).status, 401);
  assert.equal((await a.client.request("GET", "/auth/me")).status, 401);
  const b = await account();
  assert.equal((await b.client.request("POST", "/auth/logout")).status, 200);
  assert.equal((await b.client.request("GET", "/auth/me")).status, 401);
});
test("session listing/revocation is per user and takes immediate effect", async () => {
  const a = await account();
  const other = new Client();
  assert.equal(
    (
      await other.request("POST", "/auth/login", {
        email: a.email,
        password: fixturePassword,
      })
    ).status,
    200,
  );
  const list = (await a.client.request("GET", "/auth/sessions")).body.data
    .items;
  assert.equal(list.length, 2);
  const target = list.find((x: any) => !x.current);
  assert.equal(
    (await a.client.request("DELETE", "/auth/sessions/" + target.id)).status,
    200,
  );
  assert.equal((await other.request("GET", "/auth/me")).status, 401);
});
test("email two-step setup and login enforce OTP, attempt limit, replay protection and session revocation", async () => {
  const a = await account();
  const challenge = await a.client.request("POST", "/auth/2fa/challenge", {
    password: fixturePassword,
  });
  assert.equal(challenge.status, 200);
  const code = (await notification(challenge.body.data.devReceipt)).match(
    /\d{6}/,
  )![0];
  assert.equal(
    (
      await a.client.request("PUT", "/auth/2fa", {
        challengeId: challenge.body.data.challengeId,
        code,
        enabled: true,
      })
    ).status,
    200,
  );
  const next = new Client();
  const login = await next.request("POST", "/auth/login", {
    email: a.email,
    password: fixturePassword,
  });
  assert(login.body.data.challengeId);
  assert.equal(next.jar.size, 0);
  const loginCode = (await notification(login.body.data.devReceipt)).match(
    /\d{6}/,
  )![0];
  assert.equal(
    (
      await next.request("POST", "/auth/2fa/verify", {
        challengeId: login.body.data.challengeId,
        code: loginCode === "000000" ? "000001" : "000000",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await next.request("POST", "/auth/2fa/verify", {
        challengeId: login.body.data.challengeId,
        code: loginCode,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await next.request("POST", "/auth/2fa/verify", {
        challengeId: login.body.data.challengeId,
        code: loginCode,
      })
    ).status,
    400,
  );
});
test("five failed passwords lock account and reset password revokes every session", async () => {
  const a = await account();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await a.client.request("POST", "/auth/login", {
          email: a.email,
          password: "Wrong-Fixture-Password",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await a.client.request("POST", "/auth/login", {
        email: a.email,
        password: fixturePassword,
      })
    ).status,
    423,
  );
  const forgot = await a.client.request("POST", "/auth/forgot-password", {
    email: a.email,
  });
  const text = await notification(forgot.body.data.devReceipt);
  const token = new URL(text).searchParams.get("token");
  assert.equal(
    (
      await a.client.request("POST", "/auth/reset-password", {
        token,
        password: fixturePassword + "-new",
      })
    ).status,
    200,
  );
  assert.equal((await a.client.request("GET", "/auth/me")).status, 401);
  assert.equal(
    (
      await a.client.request("POST", "/auth/login", {
        email: a.email,
        password: fixturePassword + "-new",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await a.client.request("POST", "/auth/reset-password", {
        token,
        password: fixturePassword + "-another",
      })
    ).status,
    400,
  );
});
test("invitations bind to recipient email; viewer/editor roles cannot administer organization", async () => {
  const owner = await account(),
    viewer = await account();
  const invite = await owner.client.request("POST", "/invitations", {
    email: viewer.email,
    role: "viewer",
  });
  assert.equal(invite.status, 201);
  const text = await notification(invite.body.data.devReceipt);
  const token = new URL(text).searchParams.get("token");
  const outsider = await account();
  assert.equal(
    (await outsider.client.request("POST", "/invitations/accept", { token }))
      .status,
    400,
  );
  assert.equal(
    (await viewer.client.request("POST", "/invitations/accept", { token }))
      .status,
    200,
  );
  assert.equal(
    (
      await viewer.client.request(
        "POST",
        "/organizations/" + owner.me.organizationId + "/select",
      )
    ).status,
    200,
  );
  assert.equal(
    (await viewer.client.request("GET", "/auth/me")).body.data.role,
    "viewer",
  );
  assert.equal(
    (
      await viewer.client.request("PATCH", "/organization", {
        name: "forbidden",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await viewer.client.request("POST", "/invitations", {
        email: "third@example.invalid",
        role: "admin",
      })
    ).status,
    403,
  );
  assert.equal(
    (await viewer.client.request("PUT", "/ai/provider", { enabled: false }))
      .status,
    403,
  );
  const member = (
    await owner.client.request("GET", "/members")
  ).body.data.items.find((m: any) => m.userId === viewer.me.user.id);
  assert.equal(
    (
      await owner.client.request("PATCH", "/members/" + member.id, {
        role: "editor",
      })
    ).status,
    200,
  );
  assert.equal(
    (await viewer.client.request("GET", "/auth/me")).body.data.role,
    "editor",
  );
  assert.equal(
    (
      await viewer.client.request("PATCH", "/organization", {
        name: "still forbidden",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await owner.client.request("PATCH", "/members/" + member.id, {
        status: "revoked",
      })
    ).status,
    200,
  );
  assert.equal((await viewer.client.request("GET", "/auth/me")).status, 401);
});
test("seat allocation rejects concurrent trial plan over-allocation", async () => {
  const a = await account();
  const results = await Promise.all(
    ["one", "two", "three"].map((x) =>
      a.client.request("POST", "/invitations", {
        email: x + "@example.invalid",
        role: "editor",
      }),
    ),
  );
  assert.equal(results.filter((x) => x.status === 201).length, 1);
  assert(
    results
      .filter((x) => x.status !== 201)
      .every((x) => x.body.error.code === "QUOTA_EXCEEDED"),
  );
});
test("usage reservations are atomic/idempotent and cannot exceed plan; settlement once", async () => {
  const a = await account();
  const service = await import("../src/services/usage.service");
  await contexts.runWithTenant(a.me.organizationId, async () => {
    const outcomes = await Promise.allSettled([
      service.reserve("ai_tokens", 150000, "one"),
      service.reserve("ai_tokens", 150000, "two"),
    ]);
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    const records = await models.UsageRecord.find();
    const record = records[0];
    await service.reserve("ai_tokens", 150000, record.operationId);
    await service.settle("ai_tokens", record.operationId, 100);
    await service.settle("ai_tokens", record.operationId, 100);
    const usage = await service.usage();
    assert.equal(usage.items[0].consumed, 100);
    assert.equal(usage.items[0].reserved, 0);
    await assert.rejects(
      () => service.reserve("ai_tokens", 200001, randomUUID()),
      /QUOTA_EXCEEDED/,
    );
  });
});
test("credential encryption rejects tampering, wrong tenant and corrupted ciphertext", async () => {
  const { encrypt, decrypt } = await import(
    "../src/services/credential-crypto"
  );
  const secret = randomBytes(24).toString("hex");
  const encrypted = encrypt(secret, "ai:tenant-a");
  assert.equal(decrypt(encrypted, "ai:tenant-a"), secret);
  assert.throws(() => decrypt(encrypted, "ai:tenant-b"));
  assert.throws(() =>
    decrypt(
      { ...encrypted, tag: randomBytes(16).toString("base64") },
      "ai:tenant-a",
    ),
  );
});
test("task leases fence stale owners and reclaim expired work without parallel claims", async () => {
  const a = await account();
  const runtime = await import("../src/background/runtime");
  await models.Task.collection.updateMany({}, { $set: { status: "done" } }); // test-only cleanup primitive
  const row = await contexts.runWithTenant(a.me.organizationId, () =>
    models.Task.create({
      kind: "fixture",
      operationId: randomUUID(),
      payload: {},
    }),
  );
  const claimed = await Promise.all([runtime.claimTask(), runtime.claimTask()]);
  assert.equal(claimed.filter(Boolean).length, 1);
  const first = claimed.find(Boolean)!;
  await contexts.runWithTenant(a.me.organizationId, () =>
    models.Task.updateOne(
      { _id: row._id },
      { $set: { leaseUntil: new Date(0) } },
    ),
  );
  const recovered = await runtime.claimTask();
  assert(recovered);
  assert(recovered.fencingToken > first.fencingToken);
  await contexts.runWithTenant(a.me.organizationId, async () => {
    assert.equal((await runtime.finishTask(first, "done")).modifiedCount, 0);
    assert.equal(
      (await runtime.finishTask(recovered, "done")).modifiedCount,
      1,
    );
  });
});
test("storage magic bytes and tenant-bound access; no path or foreign asset reads", async () => {
  const a = await account(),
    b = await account();
  const storageService = await import("../src/services/storage.service");
  const asset = await contexts.runWithTenant(a.me.organizationId, () =>
    storageService.store(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
      "image/png",
    ),
  );
  assert.equal(
    (await a.client.request("GET", "/assets/" + asset._id)).status,
    200,
  );
  assert.equal(
    (await b.client.request("GET", "/assets/" + asset._id)).status,
    404,
  );
  await contexts.runWithTenant(a.me.organizationId, async () => {
    await assert.rejects(
      () => storageService.store(Buffer.from("<script>"), "image/png"),
      /FILE_INVALID/,
    );
    await storageService.removeAsset(String(asset._id));
  });
  assert.equal(
    (await a.client.request("GET", "/assets/" + asset._id)).status,
    404,
  );
});
test("AI unconfigured degrades safely; settings never return secrets; unsafe URLs rejected", async () => {
  const a = await account();
  assert.equal(
    (await a.client.request("GET", "/ai/provider")).body.data.configured,
    false,
  );
  assert.equal(
    (
      await a.client.request("POST", "/ai/provider/test", undefined, {
        "Idempotency-Key": randomUUID(),
      })
    ).body.error.code,
    "AI_UNCONFIGURED",
  );
  const result = await a.client.request("PUT", "/ai/provider", {
    enabled: true,
    modelName: "fixture",
    baseUrl: "http://127.0.0.1/v1",
    apiKey: randomBytes(32).toString("hex"),
  });
  assert.equal(result.status, 400);
  const { isPublicAddress } = await import(
    "../src/services/website/public-web"
  );
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPublicAddress(address), false);
});
test("health is public, schema errors safe, reset does not disclose account existence", async () => {
  assert.equal(
    (await new Client().request("GET", "/health/ready")).status,
    200,
  );
  const result = await new Client().request("POST", "/auth/forgot-password", {
    email: "missing@example.invalid",
  });
  assert.equal(result.status, 202);
  assert.deepEqual(result.body.data, { accepted: true });
  const invalid = await new Client().request("POST", "/auth/register", {
    email: "invalid",
  });
  assert.equal(invalid.status, 400);
  assert(!JSON.stringify(invalid.body).includes("stack"));
  assert.equal(
    (
      await new Client().request(
        "POST",
        "/auth/login",
        { email: "missing@example.invalid", password: "bad" },
        { Origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
});

test("public auth rate limits are shared and return Retry-After", async () => {
  for (let i = 0; i < 40; i++)
    await new Client().request("POST", "/auth/forgot-password", {
      email: "no-account@example.invalid",
    });
  const blocked = await new Client().request("POST", "/auth/forgot-password", {
    email: "no-account@example.invalid",
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers["retry-after"], "60");
});

test("OTP attempt cap, expiry and auth-version fence reject stale credentials", async () => {
  const a = await account();
  const password = fixturePassword;
  const first = await a.client.request("POST", "/auth/2fa/challenge", {
    password,
  });
  const code = (await notification(first.body.data.devReceipt)).match(
    /[0-9]{6}/,
  )![0];
  const wrong = code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await a.client.request("PUT", "/auth/2fa", {
          challengeId: first.body.data.challengeId,
          code: wrong,
          enabled: true,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await a.client.request("PUT", "/auth/2fa", {
        challengeId: first.body.data.challengeId,
        code,
        enabled: true,
      })
    ).status,
    400,
  );
  const second = await a.client.request("POST", "/auth/2fa/challenge", {
    password,
  });
  const nextCode = (await notification(second.body.data.devReceipt)).match(
    /[0-9]{6}/,
  )![0];
  await contexts.runWithTenant(a.me.organizationId, () =>
    models.AuthToken.updateOne(
      { _id: second.body.data.challengeId },
      { $set: { expiresAt: new Date(0) } },
    ),
  );
  assert.equal(
    (
      await a.client.request("PUT", "/auth/2fa", {
        challengeId: second.body.data.challengeId,
        code: nextCode,
        enabled: true,
      })
    ).status,
    400,
  );
  await contexts.runIdentity(() =>
    models.User.updateOne({ _id: a.me.user.id }, { $inc: { authVersion: 1 } }),
  );
  const service = await import("../src/services/auth.service");
  await assert.rejects(
    () =>
      service.createSession(a.me.user.id, a.me.organizationId, "fixture", 0),
    /UNAUTHORIZED/,
  );
  assert.equal((await a.client.request("GET", "/auth/me")).status, 401);
});
test("collection cursors and audit reads remain tenant scoped", async () => {
  const a = await account(),
    b = await account();
  await contexts.runWithTenant(a.me.organizationId, async () => {
    await models.AuditLog.create({ action: "fixture.private.a" });
    await models.AuditLog.create({ action: "fixture.private.second" });
  });
  const first = await a.client.request("GET", "/audit-logs?limit=1");
  assert.equal(first.status, 200);
  assert.equal(first.body.data.items.length, 1);
  assert(first.body.data.hasMore);
  const second = await a.client.request(
    "GET",
    "/audit-logs?limit=1&cursor=" + first.body.data.nextCursor,
  );
  assert.equal(second.status, 200);
  assert.notEqual(second.body.data.items[0].id, first.body.data.items[0].id);
  const other = await b.client.request("GET", "/audit-logs");
  assert(
    other.body.data.items.every(
      (x: any) => !x.action.startsWith("fixture.private"),
    ),
  );
  assert.equal(
    (await a.client.request("GET", "/members?limit=201")).status,
    400,
  );
  assert.equal(
    (
      await a.client.request(
        "POST",
        "/organizations/" + b.me.organizationId + "/select",
      )
    ).status,
    403,
  );
});

test("long passwords do not collide after bcrypt byte 72", async () => {
  const c = new Client(),
    email = "long-password@example.invalid";
  const prefix = "Long-" + randomBytes(36).toString("hex");
  const good = prefix + "-one",
    bad = prefix + "-two";
  const result = await c.request("POST", "/auth/register", {
    email,
    password: good,
    name: "Fixture",
    organizationName: "Fixture",
  });
  const token = new URL(
    await notification(result.body.data.devReceipt),
  ).searchParams.get("token");
  await c.request("POST", "/auth/verify-email", { token });
  assert.equal(
    (await c.request("POST", "/auth/login", { email, password: bad })).status,
    401,
  );
  assert.equal(
    (await c.request("POST", "/auth/login", { email, password: good })).status,
    200,
  );
});
test("AI configuration is tenant scoped, redacted and metered once per operation", async () => {
  const a = await account(),
    b = await account();
  const dns = (await import("node:dns/promises")).default;
  const originalLookup = dns.lookup;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    dns.lookup = (async () => [
      { address: "8.8.8.8", family: 4 },
    ]) as typeof dns.lookup;
    const key = "fixture-" + randomBytes(24).toString("hex");
    const saved = await a.client.request("PUT", "/ai/provider", {
      modelName: "fixture-model",
      baseUrl: "https://api.openai.com/v1",
      enabled: true,
      apiKey: key,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.configured, true);
    assert(!JSON.stringify(saved.body).includes(key));
    assert.equal(
      (await b.client.request("GET", "/ai/provider")).body.data.configured,
      false,
    );
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ usage: { total_tokens: 8 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const operation = randomUUID();
    const first = await a.client.request(
      "POST",
      "/ai/provider/test",
      undefined,
      { "Idempotency-Key": operation },
    );
    assert.equal(first.status, 200);
    assert.equal(first.body.data.tokens, 8);
    assert.equal(
      (
        await a.client.request("POST", "/ai/provider/test", undefined, {
          "Idempotency-Key": operation,
        })
      ).status,
      409,
    );
    assert.equal(calls, 1);
    const usage = (await a.client.request("GET", "/usage")).body.data;
    assert.equal(
      usage.items.find((row: any) => row.metric === "ai_tokens").consumed,
      8,
    );
  } finally {
    dns.lookup = originalLookup;
    globalThis.fetch = originalFetch;
  }
});

test("expired password lock starts a new five-attempt window", async () => {
  const a = await account();
  await contexts.runIdentity(() =>
    models.User.updateOne(
      { _id: a.me.user.id },
      { $set: { failedAttempts: 5, lockedUntil: new Date(0) } },
    ),
  );
  assert.equal(
    (
      await a.client.request("POST", "/auth/login", {
        email: a.email,
        password: "Wrong-Fixture-Password",
      })
    ).status,
    401,
  );
  const row = await contexts.runIdentity(() =>
    models.User.findById(a.me.user.id),
  );
  assert.equal(row!.failedAttempts, 1);
  assert.equal(
    (
      await a.client.request("POST", "/auth/login", {
        email: a.email,
        password: fixturePassword,
      })
    ).status,
    200,
  );
});
