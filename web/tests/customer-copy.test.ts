// S35: customers never see raw model units ("Token") or provider usage review.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { messages, errors } from "../src/i18n.ts";
import { siteMessages } from "../src/sites-i18n.ts";
import { catalogMessages } from "../src/catalog-i18n.ts";
import { crmMessages } from "../src/crm-i18n.ts";
import { inquiryMessages } from "../src/inquiry-i18n.ts";
import { publishingMessages } from "../src/publishing-i18n.ts";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>).flatMap(strings);
  return [];
}

test("user-facing copy never mentions tokens or usage reconciliation", () => {
  const copy = strings([
    messages,
    errors,
    siteMessages,
    catalogMessages,
    crmMessages,
    inquiryMessages,
    publishingMessages,
  ]);
  assert.ok(copy.length > 100);
  for (const text of copy) assert.doesNotMatch(text, /token/i, text);
  for (const text of strings([errors.AI_USAGE_UNKNOWN, siteMessages.AI_USAGE_UNKNOWN]))
    assert.doesNotMatch(text, /管理员|核查|核对|administrator|reconcil/i, text);
  assert.match(siteMessages.AI_USAGE_UNKNOWN[0], /生成服务暂时不稳定/);
  assert.match(siteMessages.QUOTA_EXCEEDED[0], /本月 AI 额度不足/);
  assert.match(messages.zh.aiUsedPercent, /\{used\}%.*\{left\}%/);
  assert.match(messages.en.aiUsedPercent, /\{used\}%.*\{left\}%/);
  // Task diagnostics no longer render token counts.
  const tasks = fs.readFileSync(
    new URL("../src/agent-tasks.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(tasks, /token/i);
});
