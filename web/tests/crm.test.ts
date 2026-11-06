import { test } from "node:test";
import assert from "node:assert/strict";
import { crmMessages } from "../src/crm-i18n";
import { safeReturnTo } from "../src/navigation";
test("CRM labels and actionable failures are bilingual; connection return stays inside workspace", () => {
  for (const [key, labels] of Object.entries(crmMessages)) {
    assert.equal(labels.length, 2, key);
    assert(
      labels.every((s) => s.trim().length > 0),
      key,
    );
  }
  assert.equal(safeReturnTo("/crm", "https://fixture.invalid"), "/crm");
  assert.equal(
    safeReturnTo("https://attacker.invalid/crm", "https://fixture.invalid"),
    "/",
  );
  for (const key of [
    "CRM_UNAUTHORIZED",
    "CRM_CONTRACT_MISMATCH",
    "CRM_PRIVACY_REBUILD_REQUIRED",
  ])
    assert(key in crmMessages);
});
