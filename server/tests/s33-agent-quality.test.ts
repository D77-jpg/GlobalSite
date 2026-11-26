import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.CREDENTIAL_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.MONGOMS_VERSION ??= "7.0.14";

import { config } from "../src/config";
import { createApp } from "../src/app";
import { assertResponse } from "./contract";
import { runWithTenant } from "../src/models/tenant-context";
import { UsageRecord } from "../src/models";
import { parseAgentJsonDetailed } from "../src/services/agent-json.service";
import {
  estimateHomepageHeightPx,
  extractFailedBlockKeys,
  outputSchemas,
  toStrictOpenAiJsonSchema,
} from "../src/services/agents/validation";
import {
  callSiteAgent,
  resolveModelForTask,
} from "../src/services/site-agent-provider.service";
import { compositionIssues } from "../src/services/site-composition.service";
import { siteSkillProfile } from "../src/services/site-skill-profile";

function assertStrictSchemaTree(node: unknown, path = "$") {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const obj = node as Record<string, unknown>;
  for (const forbidden of [
    "$schema",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
  ]) {
    assert.equal(
      forbidden in obj,
      false,
      `Strict schema must not contain ${forbidden} at ${path}`,
    );
  }
  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    assert.equal(
      obj.additionalProperties,
      false,
      `additionalProperties must be false at ${path}`,
    );
    const props = Object.keys(obj.properties as Record<string, unknown>);
    const req = Array.isArray(obj.required) ? obj.required.map(String) : [];
    for (const k of props) {
      assert.ok(req.includes(k), `Property ${k} must be in required at ${path}`);
      assertStrictSchemaTree(
        (obj.properties as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
    }
  }
  if (obj.items) assertStrictSchemaTree(obj.items, `${path}[]`);
  if (Array.isArray(obj.anyOf)) {
    obj.anyOf.forEach((child, i) =>
      assertStrictSchemaTree(child, `${path}.anyOf[${i}]`),
    );
  }
}

test("toStrictOpenAiJsonSchema converts all agent output schemas into strict OpenAI subset", () => {
  for (const [name, raw] of Object.entries(outputSchemas)) {
    const strict = toStrictOpenAiJsonSchema(raw);
    assertStrictSchemaTree(strict, name);
  }
});

test("parseAgentJsonDetailed distinguishes direct, extracted, and repaired JSON without altering numbers", () => {
  const direct = parseAgentJsonDetailed('{"ok":true,"count":42}');
  assert.equal(direct.repaired, false);
  assert.equal(direct.mode, "direct");

  const extracted = parseAgentJsonDetailed('Result:\n{"ok":true,"count":42}\nDone.');
  assert.equal(extracted.repaired, false);
  assert.equal(extracted.mode, "extracted");

  const repaired = parseAgentJsonDetailed('{"ok":true,"count":42,}');
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.mode, "repaired");
  assert.deepEqual(repaired.value, { ok: true, count: 42 });
});

test("resolveModelForTask routes per step, honors vision models, and falls back to modelName", () => {
  const provider = {
    modelName: "main-model",
    visionModelName: "vision-fallback",
    supportsVision: true,
    taskModels: {
      research: "fast-cheap",
      design: "flagship-design",
      review: "review-vision",
    },
  };
  assert.equal(resolveModelForTask(provider, "research", false), "fast-cheap");
  assert.equal(resolveModelForTask(provider, "design", false), "flagship-design");
  assert.equal(resolveModelForTask(provider, "content", false), "main-model");
  assert.equal(resolveModelForTask(provider, "refine", false), "main-model");
  assert.equal(resolveModelForTask(provider, "review", true), "review-vision");
  assert.equal(resolveModelForTask(provider, "design", true), "vision-fallback");
  assert.equal(
    resolveModelForTask({ ...provider, taskModels: {} }, "review", true),
    "vision-fallback",
  );
  assert.equal(
    resolveModelForTask(
      { ...provider, supportsVision: false, taskModels: {} },
      "review",
      true,
    ),
    "main-model",
  );
});

test("S33 homepage block budget, height estimate, localized block extraction, and S32 skill profile", () => {
  const skill = siteSkillProfile();
  assert.equal(skill.version, "brand-site-v4");
  assert.ok(Buffer.byteLength(skill.guidance) <= 17000);
  assert.ok(skill.guidance.includes("obsidian"));
  assert.ok(skill.guidance.includes("fit=cover"));

  const mkBlock = (key: string, type: any, body: string) => ({
    key,
    type,
    heading: key,
    body,
    table: null,
    faq: [],
    items: [],
    assetId: null,
    alt: "",
    refs: [],
  });
  const longText = Array(35).fill("industrial precision component").join(" ");
  const bloatedPage: any = {
    title: "Home",
    metaDescription: "Meta",
    presentation: {
      navigationLabel: "Home",
      headline: "Precision Equipment",
      summary: "Built for commercial buyers.",
      primaryActionLabel: "Request quote",
      visualStyle: "industrial",
      heroLayout: "panorama",
      designNotes: "Private note",
      composition: {
        version: "v1",
        typography: "technical",
        palette: "graphite",
        navigation: "catalogue",
        productLayout: "cards",
      },
    },
    refs: [],
    blocks: [
      mkBlock("b1", "product-grid", ""),
      mkBlock("b2", "features", longText + " one"),
      mkBlock("b3", "process", longText + " two"),
      mkBlock("b4", "text", longText + " three"),
      mkBlock("b5", "text", longText + " four"),
      mkBlock("b6", "text", longText + " five"),
      mkBlock("b7", "text", longText + " six"),
      mkBlock("b8", "text", longText + " seven"),
      mkBlock("b9", "text", longText + " eight"),
      mkBlock("b10", "cta", longText + " nine"),
    ],
  };
  const issues = compositionIssues(bloatedPage, "home");
  assert.ok(issues.some((i) => i.code === "CONTENT_HOME_TOO_LONG"));
  assert.ok(estimateHomepageHeightPx(bloatedPage) > 4000);
  assert.deepEqual(
    extractFailedBlockKeys([
      { field: "blocks.buying-faq.faq.0.answer" },
      { field: "blocks.specs.table" },
      { field: "blocks.buying-faq.body" },
    ]),
    ["buying-faq", "specs"],
  );
});

test("AI provider contract supports outputMode, taskModels, temperatureByTask, and json_schema 400 fallback without double-billing", async () => {
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const prevAllowed = process.env.AI_LOCAL_BASE_URL;
  const requests: any[] = [];
  let failSchemaOnce = true;

  const mockAi = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(parsed);
      if (
        failSchemaOnce &&
        parsed.response_format?.type === "json_schema"
      ) {
        failSchemaOnce = false;
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "json_schema unsupported" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: '{"summary":"Checked","findings":[]}' },
            },
          ],
          usage: { total_tokens: 120 },
        }),
      );
    });
  });

  await new Promise<void>((r) => mockAi.listen(0, "127.0.0.1", r));
  const aiUrl = `http://127.0.0.1:${(mockAi.address() as AddressInfo).port}/v1`;
  process.env.AI_LOCAL_BASE_URL = aiUrl;
  config.allowLocalAi = true;

  try {
    await mongoose.connect(repl.getUri());
    const app = createApp();
    const agent = request.agent(app);

    const email = `s33-owner-${randomBytes(5).toString("hex")}@example.invalid`;
    const password = "Password123!Fixture";
    const reg = await agent
      .post("/api/v1/auth/register")
      .set("Origin", config.origin)
      .send({
        email,
        password,
        name: "Owner",
        organizationName: "S33 Test Org",
        locale: "en",
      });
    assert.equal(reg.status, 202);
    const mail = await agent
      .get("/api/v1/dev/mail/" + reg.body.data.devReceipt)
      .set("Origin", config.origin);
    const verifyToken = new URL(mail.body.data.text).searchParams.get("token");
    const verified = await agent
      .post("/api/v1/auth/verify-email")
      .set("Origin", config.origin)
      .send({ token: verifyToken });
    assert.equal(verified.status, 200);
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", config.origin)
      .send({ email, password });
    assert.equal(login.status, 200);
    const cookies = (login.headers["set-cookie"] ?? []) as unknown as string[];
    const csrfCookie = cookies
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("gs_csrf="));
    const csrf = csrfCookie ? csrfCookie.split("=")[1] : "";
    const me = await agent.get("/api/v1/auth/me").set("Origin", config.origin);
    assert.equal(me.status, 200);
    const orgId =
      me.body.data.organization?.id ?? me.body.data.organizationId;

    // 1. Save provider with S33 outputMode + taskModels + temperatureByTask
    const put = await agent
      .put("/api/v1/ai/provider")
      .set("Origin", config.origin)
      .set("x-csrf-token", csrf)
      .send({
        modelName: "primary-model",
        visionModelName: "vision-model",
        supportsVision: true,
        outputMode: "json_schema",
        taskModels: {
          research: "cheap-research",
          review: "review-model",
        },
        temperatureByTask: {
          review: 0.2,
        },
        baseUrl: aiUrl,
        enabled: true,
        apiKey: "sk-test-key-123456",
      });
    assert.equal(put.status, 200);
    assertResponse(
      "put",
      "/ai/provider",
      200,
      put.body,
      String(put.headers["content-type"] ?? ""),
    );
    assert.equal(put.body.data.outputMode, "json_schema");
    assert.equal(put.body.data.taskModels.research, "cheap-research");
    assert.equal(put.body.data.temperatureByTask.review, 0.2);

    const get = await agent.get("/api/v1/ai/provider");
    assert.equal(get.status, 200);
    assertResponse(
      "get",
      "/ai/provider",
      200,
      get.body,
      String(get.headers["content-type"] ?? ""),
    );
    assert.equal(get.body.data.outputMode, "json_schema");

    // 2. Call site agent with review task: sends json_schema + temperature 0.2 + review-model,
    // gets HTTP 400, falls back once to json_object within the same operationId!
    const op1 = "s33-op-fallback-1";
    const r1 = await runWithTenant(orgId, () =>
      callSiteAgent(
        "System",
        { task: "review", outputSchema: outputSchemas.review },
        op1,
        async () => undefined,
      ),
    );
    assert.equal(r1.tokens, 120);
    assert.equal(r1.modelName, "review-model");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, "review-model");
    assert.equal(requests[0].temperature, 0.2);
    assert.equal(requests[0].response_format.type, "json_schema");
    assert.equal(requests[0].response_format.json_schema.strict, true);
    assert.equal(requests[1].response_format.type, "json_object");

    // Verify single UsageRecord settled once for 120 tokens (no double billing!)
    const usageCount = await runWithTenant(orgId, () =>
      UsageRecord.countDocuments({ metric: "ai_tokens", operationId: op1 }),
    );
    assert.equal(usageCount, 1);

    // 3. Call site agent with research task (no temperature configured): must NOT include temperature!
    const op2 = "s33-op-notemp-2";
    const r2 = await runWithTenant(orgId, () =>
      callSiteAgent(
        "System",
        { task: "research" },
        op2,
        async () => undefined,
      ),
    );
    assert.equal(r2.modelName, "cheap-research");
    const lastReq = requests.at(-1);
    assert.equal("temperature" in lastReq, false);
    assert.equal(lastReq.model, "cheap-research");
  } finally {
    if (prevAllowed === undefined) delete process.env.AI_LOCAL_BASE_URL;
    else process.env.AI_LOCAL_BASE_URL = prevAllowed;
    mockAi.close();
    await mongoose.disconnect();
    await repl.stop();
  }
});
