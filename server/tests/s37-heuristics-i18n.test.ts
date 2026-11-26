// S37 §4.3, §4.6-2, §4.6-3: 4-industry heuristic regression fixtures, expanded
// interview fact types & enrichment gaps, and non-English validation gates.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageInput } from "../src/validators/sites.validator";
import { validatePage } from "../src/services/page-validation.service";
import { hasBrokenFragment, intactSentences } from "../src/services/copy-integrity";
import { instructionNote, publicTable, specNote } from "../src/services/b2b-template.service";
import { completeFactRefs } from "../src/services/agents/ref-completion";
import { allowedInterview } from "../src/services/agents/validation";
import { procurementCoverage } from "../src/services/b2b-planning.service";
import {
  metrics,
  recordAiMetric,
  recordTaskMetric,
} from "../src/services/metrics.service";

const P1 = "a".repeat(24),
  P2 = "b".repeat(24);
const ID = (n: number) => String(n).padStart(24, "e");
const block = (o: Record<string, unknown>) => ({
  key: "overview",
  type: "text" as const,
  heading: "Section",
  body: "",
  table: null,
  faq: [],
  assetId: null,
  alt: "",
  refs: [] as { factId: string; revision: number }[],
  ...o,
});
const page = (blocks: unknown[], extra: Record<string, unknown> = {}) =>
  ({
    title: "Benchmark",
    metaDescription: "",
    refs: [],
    blocks,
    ...extra,
  }) as PageInput;

test("§4.6-2: expanded interview fact types and enrichmentGaps checklist", () => {
  for (const t of [
    "company.exportCountries",
    "company.warranty",
    "company.customers",
    "company.caseStudy",
    "company.factoryArea",
    "company.employees",
    "product.warranty",
    "product.capacity",
  ]) {
    assert.ok(allowedInterview.test(t), "expected interview to allow " + t);
  }
  assert.ok(!allowedInterview.test("company.secretKey"));
  const cov = procurementCoverage(
    { buyerProfile: { audiences: ["Buyers"], primaryAction: "quote" } },
    [{ _id: P1, assetIds: [ID(9)] }],
    [
      { status: "confirmed", subjectType: "organization", type: "company.name", value: "Acme" },
      { status: "confirmed", subjectType: "organization", type: "company.email", value: "a@acme.invalid" },
      { status: "confirmed", subjectType: "product", subjectId: P1, type: "product.material", value: "Steel" },
      { status: "confirmed", subjectType: "product", subjectId: P1, type: "product.moq", value: "5" },
      { status: "confirmed", subjectType: "product", subjectId: P1, type: "product.leadTime", value: "20 days" },
      { status: "confirmed", subjectType: "product", subjectId: P1, type: "product.specifications", value: "220V" },
    ],
  );
  assert.equal(cov.canPublish, true);
  assert.ok(cov.enrichmentGaps.some((g) => g.type === "company.exportCountries"));
  assert.ok(cov.enrichmentGaps.some((g) => g.type === "company.warranty"));
  assert.ok(cov.enrichmentGaps.some((g) => g.type === "product.warranty" && g.subjectId === P1));
});

test("§4.6-3: non-English sites enforce localized audit wording and FAQ length gates", () => {
  const presentation = {
    navigationLabel: "首页",
    headline: "商用设备方案",
    summary: "专为餐饮采购设计。",
    primaryActionLabel: "获取报价",
    visualStyle: "industrial" as const,
    heroLayout: "split" as const,
    composition: {
      version: "v1" as const,
      typography: "technical" as const,
      palette: "graphite" as const,
      navigation: "catalogue" as const,
      productLayout: "cards" as const,
    },
    designNotes: "",
  };
  const zhBad = page(
    [
      block({
        key: "intro",
        body: "根据我们的记录，已确认事实显示所有设备均支持出口。",
      }),
      block({
        key: "faq",
        type: "faq",
        faq: [{ question: "交期多久？", answer: "请咨询。", detail: "" }],
      }),
    ],
    { presentation },
  );
  const zhIssues = validatePage(zhBad, [], {
    type: "home",
    productIds: [],
    language: "zh",
  });
  assert.ok(zhIssues.some((i) => i.code === "COPY_AUDIT_LANGUAGE"));
  assert.ok(zhIssues.some((i) => i.code === "FAQ_DIRECT_ANSWER_REQUIRED"));

  const deBad = page(
    [
      block({
        key: "intro",
        body: "Laut unseren Unterlagen gelten diese Angaben für den Großhandel.",
      }),
      block({
        key: "faq",
        type: "faq",
        faq: [{ question: "Lieferzeit?", answer: "Bitte anfragen.", detail: "" }],
      }),
    ],
    { presentation },
  );
  const deIssues = validatePage(deBad, [], {
    type: "home",
    productIds: [],
    language: "de",
  });
  assert.ok(deIssues.some((i) => i.code === "COPY_AUDIT_LANGUAGE"));
  assert.ok(deIssues.some((i) => i.code === "FAQ_DIRECT_ANSWER_REQUIRED"));
});

test("§4.3: 4-industry heuristic regressions (spec notes, truncated model codes, shared-page ref disambiguation)", () => {
  // 1. Real technical spec values across 4 industries are NOT dropped as notes.
  for (const realSpec of [
    "83 mm flat titanium-alloy burrs",
    "±0.01 mm CNC 6061-T6 aluminum tolerance",
    "350 gsm FSC kraft board with matte lamination",
    "20 mm honed travertine slab, R10 slip rating",
    "Plan view 600 mm",
    "Matte black",
  ]) {
    assert.equal(specNote(realSpec), false, "real spec misclassified: " + realSpec);
    assert.equal(instructionNote(realSpec), false);
  }
  // Imperative buyer-guidance sentences ARE filtered from public tables.
  const filtered = publicTable({
    columns: ["Parameter", "Value", "Buyer Guidance"],
    rows: [
      ["Tolerance", "±0.01 mm", "Confirm your critical datum before machining."],
      ["Surface", "Anodized 6061-T6", "Share drawing revision with the quote request."],
    ],
  });
  assert.deepEqual(filtered.columns, ["Parameter", "Value"]);
  assert.equal(filtered.rows.length, 2);

  // 2. Truncated model codes ("VG-83" -> "VG") and localized dangling modifiers.
  const ids = ["VG-83 Precision Flat-Burr Grinder", "VB-2G Pro Dual-Boiler"];
  assert.equal(
    hasBrokenFragment("Specify the VG for commercial espresso bars.", ids),
    true,
  );
  assert.equal(
    hasBrokenFragment("Specify the VG-83 for commercial espresso bars.", ids),
    false,
  );
  assert.equal(
    intactSentences(
      "Specify the VG for espresso bars. Pair it with our dual-boiler range.",
      ids,
    ),
    "Pair it with our dual-boiler range.",
  );
  assert.equal(hasBrokenFragment("标准交期为 -天 交付。"), true);

  // 3. Shared-page citation disambiguation when two models share the same numeric value.
  const f1 = {
    _id: ID(1),
    status: "confirmed",
    revision: 1,
    subjectType: "product",
    subjectId: P1,
    type: "product.leadTime",
    value: "25 days",
  };
  const f2 = {
    _id: ID(2),
    status: "confirmed",
    revision: 1,
    subjectType: "product",
    subjectId: P2,
    type: "product.leadTime",
    value: "25 days",
  };
  const products = [
    { id: P1, name: "AX-100 CNC Spindle" },
    { id: P2, name: "BX-200 Hydraulic Press" },
  ];
  const shared = page([
    block({ body: "The BX-200 Hydraulic Press ships in 25 days." }),
  ]);
  const cited = completeFactRefs(
    shared,
    [f1, f2],
    { type: "home", productIds: [P1, P2], language: "en" },
    products,
  );
  assert.deepEqual(cited.blocks[0].refs, [{ factId: ID(2), revision: 1 }]);
});

test("§4.10: metrics service records bounded worker task and AI outcome counters", () => {
  recordTaskMetric("site.agent", "done", 1250);
  recordAiMetric("review", "ok");
  const out = metrics();
  assert.match(out, /globalsite_worker_tasks_total\{kind="site\.agent",status="done"\}/);
  assert.match(out, /globalsite_worker_task_duration_ms_sum\{kind="site\.agent"\}/);
  assert.match(out, /globalsite_ai_calls_total\{task="review",outcome="ok"\}/);
});
