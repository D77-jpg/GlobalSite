import { test } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http from "node:http";
import { aiBase, aiFetch, localAiBase } from "../src/services/ai-target";

test("local AI requires exact opt-in and is disabled in production", async () => {
  const mode = process.env.NODE_ENV,
    old = process.env.AI_LOCAL_BASE_URL;
  try {
    process.env.NODE_ENV = "test";
    delete process.env.AI_LOCAL_BASE_URL;
    await assert.rejects(() => aiBase("http://127.0.0.1:7863/v1"));
    process.env.AI_LOCAL_BASE_URL = "http://127.0.0.1:7863/v1";
    assert.equal((await aiBase(process.env.AI_LOCAL_BASE_URL)).port, "7863");
    for (const url of [
      "http://127.0.0.1:7864/v1",
      "http://10.0.0.1:7863/v1",
      "http://127.0.0.1:7863/v1?x=1",
      "http://u:p@127.0.0.1:7863/v1",
    ])
      await assert.rejects(() => aiBase(url));
    process.env.NODE_ENV = "production";
    assert.equal(localAiBase(), undefined);
    await assert.rejects(() => aiBase(process.env.AI_LOCAL_BASE_URL!));
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    if (old === undefined) delete process.env.AI_LOCAL_BASE_URL;
    else process.env.AI_LOCAL_BASE_URL = old;
  }
});

test("public HTTPS OpenAI-compatible endpoints are validated with SSRF and optional allowlist", async () => {
  const originalLookup = dns.lookup;
  const oldAllowed = process.env.AI_ALLOWED_HOSTS;
  try {
    delete process.env.AI_ALLOWED_HOSTS;
    dns.lookup = (async () => [
      { address: "93.184.216.34", family: 4 },
    ]) as typeof dns.lookup;
    for (const valid of [
      "https://api.openai.com/v1",
      "https://api.deepseek.com/v1/",
      "https://openrouter.ai/api/v1",
      "https://generativelanguage.googleapis.com/v1beta/openai",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ]) {
      const parsed = await aiBase(valid);
      assert.equal(parsed.protocol, "https:");
      assert.ok(!parsed.pathname.endsWith("/"));
    }
    for (const invalid of [
      "https://1.1.1.1/v1",
      "https://api.openai.com/v1?x=1",
      "https://api.openai.com/v1/../admin",
      "https://service.internal/v1",
      "https://api.openai.com/",
      "http://api.openai.com/v1",
    ]) {
      await assert.rejects(() => aiBase(invalid));
    }
    process.env.AI_ALLOWED_HOSTS = "api.openai.com,openrouter.ai";
    assert.equal(
      (await aiBase("https://openrouter.ai/api/v1")).hostname,
      "openrouter.ai",
    );
    await assert.rejects(
      () => aiBase("https://api.deepseek.com/v1"),
      /PROVIDER_URL_UNSUPPORTED/,
    );
    dns.lookup = (async () => [
      { address: "169.254.169.254", family: 4 },
    ]) as typeof dns.lookup;
    await assert.rejects(
      () => aiBase("https://api.openai.com/v1"),
      /URL_UNSAFE/,
    );
  } finally {
    dns.lookup = originalLookup;
    if (oldAllowed === undefined) delete process.env.AI_ALLOWED_HOSTS;
    else process.env.AI_ALLOWED_HOSTS = oldAllowed;
  }
});

test("local AI transport supports chat and images endpoints and never follows redirects", async () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url ?? "");
    res.writeHead(302, { Location: "http://127.0.0.1:1/private" });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const mode = process.env.NODE_ENV,
    old = process.env.AI_LOCAL_BASE_URL;
  try {
    process.env.NODE_ENV = "test";
    process.env.AI_LOCAL_BASE_URL =
      "http://127.0.0.1:" + (server.address() as any).port + "/v1";
    for (const suffix of ["/chat/completions", "/images/generations"]) {
      const r = await aiFetch(process.env.AI_LOCAL_BASE_URL + suffix, {
        method: "POST",
        body: "{}",
      });
      assert.equal(r.status, 302);
      await r.text();
    }
    assert.deepEqual(seen, ["/v1/chat/completions", "/v1/images/generations"]);
    await assert.rejects(
      () =>
        aiFetch(process.env.AI_LOCAL_BASE_URL + "/models", {
          method: "POST",
          body: "{}",
        }),
      /PROVIDER_URL_UNSUPPORTED/,
    );
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    if (old === undefined) delete process.env.AI_LOCAL_BASE_URL;
    else process.env.AI_LOCAL_BASE_URL = old;
    await new Promise<void>((r) => server.close(() => r()));
  }
});
