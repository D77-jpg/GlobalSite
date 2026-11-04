import { test } from "node:test";
import assert from "node:assert/strict";
import { messages, errors } from "../src/i18n.ts";
test("all visible labels and error mappings have complete Chinese and English translations", () => {
  assert.deepEqual(
    Object.keys(messages.zh).sort(),
    Object.keys(messages.en).sort(),
  );
  for (const locale of Object.values(messages))
    for (const value of Object.values(locale)) assert(value.trim().length > 0);
  for (const values of Object.values(errors))
    assert(values.every((x) => x.length > 0));
});

import { safeReturnTo } from "../src/navigation.ts";
test("login return targets cannot escape the workspace origin", () => {
  for (const target of [
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "/%5cevil.invalid",
    "javascript:alert(1)",
    "/unknown",
  ])
    assert.equal(safeReturnTo(target, "https://site.example.invalid"), "/");
  assert.equal(
    safeReturnTo(
      "/accept-invitation?token=fixture",
      "https://site.example.invalid",
    ),
    "/accept-invitation?token=fixture",
  );
});
