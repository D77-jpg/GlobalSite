import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogMessages, catalogText } from "../src/catalog-i18n.ts";
import { safeReturnTo } from "../src/navigation.ts";
test("catalog labels and errors are bilingual; nested product login return remains same-origin", () => {
  for (const pair of Object.values(catalogMessages)) {
    assert.equal(pair.length, 2);
    assert(pair.every((x) => x.trim().length));
  }
  assert.equal(catalogText("en")("products"), "Products");
  assert.equal(
    safeReturnTo("/products/" + "a".repeat(24), "https://site.example.invalid"),
    "/products/" + "a".repeat(24),
  );
  assert.equal(
    safeReturnTo("/products/../../login", "https://site.example.invalid"),
    "/",
  );
});
