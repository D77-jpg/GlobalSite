import { test } from "node:test";
import assert from "node:assert/strict";
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
test("local AI transport never follows redirects", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
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
    const r = await aiFetch(
      process.env.AI_LOCAL_BASE_URL + "/chat/completions",
      { method: "POST", body: "{}" },
    );
    assert.equal(r.status, 302);
    await r.text();
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    if (old === undefined) delete process.env.AI_LOCAL_BASE_URL;
    else process.env.AI_LOCAL_BASE_URL = old;
    await new Promise<void>((r) => server.close(() => r()));
  }
});
