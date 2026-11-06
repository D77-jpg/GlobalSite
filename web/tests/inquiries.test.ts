import { test } from "node:test";
import assert from "node:assert/strict";
import { inquiryMessages } from "../src/inquiry-i18n";
import { safeReturnTo } from "../src/navigation";
test("inquiry labels and safe login links are bilingual and organization-neutral", () => {
  for (const [key, values] of Object.entries(inquiryMessages)) {
    assert.equal(values.length, 2, key);
    assert(
      values.every((v) => v.trim().length > 0),
      key,
    );
  }
  const id = "a".repeat(24);
  assert.equal(
    safeReturnTo("/inquiries/" + id, "https://fixture.invalid"),
    "/inquiries/" + id,
  );
  assert.equal(
    safeReturnTo(
      "https://attacker.invalid/inquiries/" + id,
      "https://fixture.invalid",
    ),
    "/",
  );
});
