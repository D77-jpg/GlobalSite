import { test } from "node:test";
import assert from "node:assert/strict";
import {
  repairUnsourcedClaims,
  SAFE_PLACEHOLDER,
} from "../src/services/agents/claim-repair";
import { validatePage } from "../src/services/page-validation.service";

const product = { type: "product", productId: null, productIds: [], language: "en", requiredProductSections: [] };
const home = { type: "home", productIds: [], language: "en" };
const block = (o: Record<string, unknown>) => ({
  type: "text",
  heading: "Section",
  body: "",
  table: null,
  faq: [],
  assetId: null,
  alt: "",
  refs: [],
  ...o,
});
const item = (title: string, body: string) => ({ title, body, assetId: null, alt: "", href: null, refs: [] });
const page = (blocks: unknown[], presentation?: unknown) => ({
  title: "Flagship machine",
  metaDescription: "",
  refs: [],
  blocks,
  ...(presentation ? { presentation } : {}),
});

test("required product sections without facts fall back to the safe placeholder", () => {
  const p = page([block({ key: "material", body: "Brushed 304 stainless steel with walnut trim." })]);
  const out = repairUnsourcedClaims(p as any, [], product as any);
  assert.equal(out.blocks[0].body, SAFE_PLACEHOLDER);
  assert.equal(validatePage(out, [], product as any).length, 0);
});

test("only the sentence carrying an unsourced number is removed", () => {
  const p = page([block({ key: "overview", body: "Built for busy bars. Repairs take 45 minutes." })]);
  const out = repairUnsourcedClaims(p as any, [], home as any);
  assert.equal(out.blocks[0].body, "Built for busy bars.");
});

test("unsupported items and spec rows are dropped, supported ones kept", () => {
  const p = page([
    block({ key: "use", type: "features", items: [item("Cafes", "Serves 360 cups per hour."), item("Hotels", "Quiet steam for breakfast service.")] }),
  ]);
  const out = repairUnsourcedClaims(p as any, [], home as any);
  assert.deepEqual(out.blocks[0].items?.map((i) => i.title), ["Hotels"]);
  const specs = page([
    block({ key: "specs", type: "specs", table: { columns: ["Specification", "Detail"], rows: [["Groupheads", "Triple"], ["Boiler", "Dual 11 L"]] } }),
  ]);
  const fixed = repairUnsourcedClaims(specs as any, [], product as any);
  assert.deepEqual(fixed.blocks[0].table?.rows, []);
  assert.equal(fixed.blocks[0].body, SAFE_PLACEHOLDER);
});

test("safe placeholders pass the buyer-copy wording check; audit wording still fails", () => {
  const presentation = {
    navigationLabel: "Home",
    headline: "Built for service",
    summary: "Commercial espresso equipment.",
    primaryActionLabel: "Request a quote",
    inquiryHeading: "Plan your bar",
    visualStyle: "industrial",
    heroLayout: "split",
    designNotes: "",
  };
  const ok = page([block({ key: "material", body: SAFE_PLACEHOLDER })], presentation);
  assert.ok(!validatePage(ok as any, [], product as any).some((i) => i.code === "COPY_AUDIT_LANGUAGE"));
  const bad = page([block({ key: "overview", body: "Ask our team to confirm the boiler." })], presentation);
  assert.ok(validatePage(bad as any, [], home as any).some((i) => i.code === "COPY_AUDIT_LANGUAGE"));
});
