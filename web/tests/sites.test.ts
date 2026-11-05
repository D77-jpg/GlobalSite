import { test } from "node:test";
import assert from "node:assert/strict";
import { siteMessages } from "../src/sites-i18n.ts";
import { orderedNodes, moveNode } from "../src/site-plan.ts";
import { safeReturnTo } from "../src/navigation.ts";
test("site labels are bilingual and deep links cannot leave the workspace", () => {
  for (const p of Object.values(siteMessages)) {
    assert.equal(p.length, 2);
    assert(p.every((s) => s.trim()));
  }
  assert.equal(
    safeReturnTo("/sites/" + "a".repeat(24), "https://site.example.invalid"),
    "/sites/" + "a".repeat(24),
  );
  assert.equal(
    safeReturnTo("/pages/../../evil", "https://site.example.invalid"),
    "/",
  );
});
test("sitemap moves preserve hierarchy and reject cycles, including keyboard-equivalent moves", () => {
  const nodes = [
    { key: "home", type: "home", parentKey: null },
    { key: "a", parentKey: "home" },
    { key: "b", parentKey: "home" },
    { key: "c", parentKey: "a" },
  ];
  assert.deepEqual(
    orderedNodes(nodes).map((n) => n.key),
    ["home", "a", "c", "b"],
  );
  assert.deepEqual(
    orderedNodes(moveNode(nodes, "b", "a")).map((n) => n.key),
    ["home", "b", "a", "c"],
  );
  assert.deepEqual(moveNode(nodes, "a", "c"), nodes);
  assert.deepEqual(moveNode(nodes, "home", "a"), nodes);
});
