// S36: platform-managed AI settings and plan allowance copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { messages, errors } from "../src/i18n.ts";
import { catalogMessages } from "../src/catalog-i18n.ts";
import {
  formatResetDate,
  isPlatformManaged,
  nearPlanLimit,
  safeUpgradeUrl,
  usagePercent,
} from "../src/ai-service-status.ts";

test("managed status, 80% reminder, upgrade links and reset dates", () => {
  assert.equal(isPlatformManaged({ managed: true, enabled: true }), true);
  assert.equal(isPlatformManaged({ configured: true, modelName: "x" }), false);
  assert.equal(isPlatformManaged(undefined), false);
  const usage = (ai: number, images: number) => ({
    limits: { ai_tokens: 1000, images: 10, inquiries: null },
    items: [
      { metric: "ai_tokens", consumed: ai, reserved: 0 },
      { metric: "images", consumed: images, reserved: 0 },
    ],
  });
  assert.equal(usagePercent(usage(850, 0), "ai_tokens"), 85);
  assert.equal(usagePercent(usage(0, 0), "inquiries"), null);
  assert.equal(nearPlanLimit(usage(850, 0)), true);
  assert.equal(nearPlanLimit(usage(500, 8)), true);
  assert.equal(nearPlanLimit(usage(500, 7)), false);
  assert.equal(safeUpgradeUrl("javascript:alert(1)"), null);
  assert.equal(safeUpgradeUrl(null), null);
  assert.equal(safeUpgradeUrl("https://example.com/plans"), "https://example.com/plans");
  assert.equal(safeUpgradeUrl("mailto:sales@example.com"), "mailto:sales@example.com");
  assert.match(formatResetDate("2026-12-01T00:00:00.000Z", "en"), /December.*2026/);
  assert.match(formatResetDate("2026-12-01T00:00:00.000Z", "zh"), /2026.*12/);
  assert.equal(formatResetDate("not a date", "en"), "");
});

test("managed AI copy is read-only and never names models, providers or keys", () => {
  const managed = [
    messages.zh.aiManagedNotice,
    messages.en.aiManagedNotice,
    messages.zh.aiManagedSub,
    messages.en.aiManagedSub,
    messages.zh.aiManagedUnavailable,
    messages.en.aiManagedUnavailable,
    ...catalogMessages.imageManaged,
    ...catalogMessages.imageManagedUnavailable,
    ...errors.PLATFORM_MANAGED,
  ];
  for (const text of managed)
    assert.doesNotMatch(text, /token|openai|deepseek|gemini|model|模型|密钥|api key|synapsea/i, text);
  assert.match(messages.zh.aiManagedNotice, /平台提供.*套餐额度/);
  assert.match(messages.en.aiManagedNotice, /provided by the platform.*plan allowance/);
  assert.match(messages.zh.imagesUsedOf, /\{used\}.*\{limit\}/);
  assert.match(messages.en.imagesUsedOf, /\{used\}.*\{limit\}/);
  assert.match(messages.zh.usageResetsOn, /\{date\}/);
  assert.match(messages.en.usageResetsOn, /\{date\}/);
  assert.match(messages.zh.upgradePlan, /升级套餐/);

  // The AI settings page renders the managed notice instead of the provider form.
  const main = fs.readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const page = main.slice(main.indexOf("function AiPage()"), main.indexOf("function AcceptInvite()"));
  const managedBranch = page.indexOf(": isPlatformManaged(data) ? (");
  assert.ok(managedBranch > 0);
  assert.ok(managedBranch < page.indexOf('key: "apiKey"'));
  assert.ok(page.indexOf('t(data.enabled ? "aiManagedNotice"') > managedBranch);
  // The asset library hides image service settings while managed.
  const catalog = fs.readFileSync(new URL("../src/catalog.tsx", import.meta.url), "utf8");
  assert.match(catalog, /role === "admin" && !status\.data\?\.managed/);
});
