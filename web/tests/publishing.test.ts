import { test } from "node:test";
import assert from "node:assert/strict";
import { publishingMessages } from "../src/publishing-i18n";
test("publishing controls, status and errors have both Chinese and English text", () => {
  for (const [key, values] of Object.entries(publishingMessages)) {
    assert.equal(values.length, 2, key);
    assert(
      values.every((v) => typeof v === "string" && v.length > 0),
      key,
    );
  }
});
