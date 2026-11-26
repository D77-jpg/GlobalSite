// S37 P0 fixes (§1.1–§1.5, §4.7-4): demo mode manual candidates, required
// product section key normalization & verbatim fact fill, empty FAQ removal &
// render skip, multi-clause numberGroup validation, page-type-aware credibility
// baseline and structural blockKey-aware image finding reconciliation.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageInput } from "../src/validators/sites.validator";
import {
  isDemoFact,
  validatePage,
  validationIdentifiers,
} from "../src/services/page-validation.service";
import { procurementCoverage } from "../src/services/b2b-planning.service";
import {
  SAFE_PLACEHOLDER,
  normalizeRequiredProductSections,
} from "../src/services/agents/claim-repair";
import { repairFaq } from "../src/services/agents/faq-repair";
import {
  reconcileImageFindings,
  reviewSampleThreshold,
  selectFullReviewKeys,
  structuralBaseline,
} from "../src/services/agents/quality-baseline";
import {
  readSseChatStream,
  streamLongTasksEnabled,
} from "../src/services/site-agent-provider.service";
import { autoImageConcurrency } from "../src/services/agents/auto-images";
import {
  mergeGeneratedBlocks,
  pageOutlineSchema,
  runBounded,
} from "../src/services/agents/outline";
import {
  renderStaticPage,
  type Snapshot,
} from "../src/services/static-template.service";
import { standaloneWordmarkSvg, wordmarkTextWidth } from "../src/services/brand-mark.service";
import { renderPrivacy } from "../src/services/inquiry-template.service";
import {
  packSkillGuidance,
  siteSkillProfile,
} from "../src/services/site-skill-profile";
import { productGuide } from "../src/services/b2b-template.service";

const P1 = "a".repeat(24);
const ID = (n: number) => String(n).padStart(24, "d");
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
    title: "Verona Brewtech",
    metaDescription: "",
    refs: [],
    blocks,
    ...extra,
  }) as PageInput;
const fact = (n: number, o: Record<string, unknown>) => ({
  _id: ID(n),
  status: "confirmed",
  revision: 1,
  subjectType: "product",
  subjectId: P1,
  type: "product.material",
  value: "",
  ...o,
});

test("§1.1: demoMode treats manual candidates as usable in readiness/preview but keeps canPublish false", () => {
  const manualName = fact(1, {
    subjectType: "organization",
    subjectId: null,
    type: "company.name",
    value: "Verona Brewtech",
    status: "candidate",
    source: { kind: "manual" },
  });
  const manualEmail = fact(2, {
    subjectType: "organization",
    subjectId: null,
    type: "company.email",
    value: "quotes@verona-brewtech.example",
    status: "candidate",
    source: { kind: "manual" },
  });
  const manualAddress = fact(3, {
    subjectType: "organization",
    subjectId: null,
    type: "company.address",
    value: "18 Brassline Way",
    status: "candidate",
    source: { kind: "manual" },
  });
  assert.ok(isDemoFact(manualName));
  const site = {
    buyerProfile: { audiences: ["Cafes"], primaryAction: "quote" },
    demoMode: true,
    plan: { strategy: { productSections: ["specs"] }, nodes: [] },
  };
  const prod = { _id: P1, assetIds: [ID(99)] };
  const specFact = fact(4, {
    type: "product.specifications",
    value: "Dual boiler",
    status: "confirmed",
  });
  const demoCov = procurementCoverage(
    site,
    [prod],
    [manualName, manualEmail, manualAddress, specFact],
    { allowDemoFacts: true },
  );
  assert.deepEqual(demoCov.gaps, []);
  // Commercial publication still requires confirmed facts!
  assert.equal(demoCov.canPublish, false);

  const strictCov = procurementCoverage(
    site,
    [prod],
    [manualName, manualEmail, manualAddress, specFact],
    { allowDemoFacts: false },
  );
  assert.ok(strictCov.gaps.some((g) => g.type === "company.name"));
  assert.ok(strictCov.gaps.some((g) => g.type === "company.email"));
  assert.equal(strictCov.canPublish, false);
});

test("§1.2: required product sections normalize alias keys, merge safely, and fill verbatim from facts", () => {
  const material = fact(10, {
    type: "product.material",
    value: "Matte-black housing and titanium-alloy burrs",
  });
  const moq = fact(11, {
    type: "product.moq",
    value: "5 units",
  });
  const lead = fact(12, {
    type: "product.leadTime",
    value: "25 days",
  });
  const app = fact(13, {
    type: "product.application",
    value: "Specialty cafes and hotel coffee bars",
  });
  const specsFact = fact(14, {
    type: "product.spec.burrs",
    value: "83 mm",
  });
  const ctx = {
    type: "product",
    productId: P1,
    productIds: [P1],
    language: "en",
    requiredProductSections: ["specs", "material", "application", "moq", "samples"],
  };
  const draft = page([
    block({
      key: "vb-3g-specs",
      type: "specs",
      heading: "Specs",
      table: { columns: ["Specification", "Details"], rows: [["Burrs", "83 mm"]] },
      refs: [{ factId: ID(14), revision: 1 }],
    }),
    block({
      key: "material",
      type: "text",
      heading: "Material",
      body: SAFE_PLACEHOLDER,
    }),
    block({
      key: "order-terms",
      type: "text",
      heading: "MOQ and lead time",
      body: "Minimum order quantity is 5 units. Production lead time is 25 days.",
      refs: [
        { factId: ID(11), revision: 1 },
        { factId: ID(12), revision: 1 },
      ],
    }),
    block({
      key: "sample-terms",
      type: "text",
      heading: "Samples",
      body: "Sample availability and terms should be agreed separately from production lead time.",
    }),
  ]);
  const out = normalizeRequiredProductSections(
    draft,
    [material, moq, lead, app, specsFact],
    ctx,
  );
  const keys = out.blocks.map((b) => b.key);
  assert.ok(keys.includes("specs"));
  assert.ok(keys.includes("moq"));
  assert.ok(keys.includes("samples"));
  assert.ok(keys.includes("material"));
  assert.ok(keys.includes("application"));
  assert.equal(new Set(keys).size, keys.length);
  const matBlock = out.blocks.find((b) => b.key === "material")!;
  assert.equal(matBlock.body, "Matte-black housing and titanium-alloy burrs.");
  assert.deepEqual(matBlock.refs, [{ factId: ID(10), revision: 1 }]);
  const appBlock = out.blocks.find((b) => b.key === "application")!;
  assert.equal(appBlock.body, "Specialty cafes and hotel coffee bars.");
  const samplesBlock = out.blocks.find((b) => b.key === "samples")!;
  assert.equal(samplesBlock.body, SAFE_PLACEHOLDER);
  assert.deepEqual(
    validatePage(out, [material, moq, lead, app, specsFact], ctx),
    [],
  );
});

test("§1.3: empty FAQ blocks are dropped by faq-repair and skipped by renderer & productGuide", () => {
  const ctx = { type: "product", productId: P1, productIds: [P1], language: "en", requiredProductSections: [] };
  const draft = page([
    block({ key: "overview", type: "text", body: "Built for coffee bars." }),
    block({
      key: "vb-3g-faq",
      type: "faq",
      heading: "Buying questions",
      body: "Direct answers on configuration.",
      faq: [{ question: "Lead time?", answer: "Ships in 99 days.", detail: "" }],
    }),
  ]);
  const repaired = repairFaq(draft, [], ctx);
  assert.ok(!repaired.blocks.some((b) => b.key === "vb-3g-faq"));

  // Renderer skips empty FAQ blocks even if saved earlier with intro body.
  const emptyFaqPage = {
    id: "p1",
    nodeKey: "vb-3g",
    type: "product",
    productId: P1,
    path: "/vb-3g",
    title: "VB-3G",
    metaDescription: "Commercial espresso machine.",
    refs: [],
    blocks: [
      block({
        key: "vb-3g-faq",
        type: "faq",
        heading: "VB-3G buying questions",
        body: "Direct answers.",
        faq: [],
      }),
    ],
  };
  const snap: Snapshot = {
    site: {
      id: "s1",
      name: "Verona Brewtech",
      templateId: "adaptive",
      language: "en",
      brandColor: "#14110f",
      productIds: [P1],
      buyerProfile: { audiences: ["Cafes"], primaryAction: "quote" },
    },
    pages: [emptyFaqPage],
    products: [{ id: P1, name: "VB-3G", category: null, assetIds: [] }],
    facts: [],
    settings: { canonicalBaseUrl: "https://example.invalid" },
    assets: {},
    createdAt: new Date().toISOString(),
  };
  const html = renderStaticPage(snap, emptyFaqPage);
  assert.ok(!html.includes("VB-3G buying questions"));
  assert.ok(!productGuide(snap, emptyFaqPage).includes("block-vb-3g-faq"));
});

test("§1.4: multi-clause sentences with MOQ + lead time + dimensions validate each number in its own clause", () => {
  const burrs = fact(20, { type: "product.spec.burrs", value: "83 mm" });
  const moq = fact(21, { type: "product.moq", value: "10 units" });
  const lead = fact(22, { type: "product.leadTime", value: "18 days" });
  const groups = fact(23, { type: "product.spec.groupheads", value: "2 groupheads" });
  const refs = [20, 21, 22, 23].map((n) => ({ factId: ID(n), revision: 1 }));
  const draft = page([], {
    metaDescription:
      "VG-83 commercial grinder: 83 mm flat titanium-alloy burrs, 10-unit MOQ and 18-day lead time; compare with VB-2G Pro 2-group espresso machine.",
    refs,
  });
  const issues = validatePage(draft, [burrs, moq, lead, groups], {
    type: "category",
    productIds: [P1],
    language: "en",
    identifiers: validationIdentifiers("Verona Brewtech", [
      { name: "VG-83 Precision Flat-Burr Grinder" },
      { name: "VB-2G Pro Dual-Boiler Espresso Machine" },
    ]),
  });
  assert.deepEqual(issues, []);
});

test("§1.5 & §4.7-4: page-type credibility scoring and structural blockKey image reconciliation", () => {
  const ref = { factId: ID(30), revision: 1 };
  const productPage = page([
    block({
      key: "specs",
      type: "specs",
      table: { columns: ["Spec", "Value"], rows: [["Burrs", "83 mm"]] },
      refs: [ref],
    }),
    block({ key: "moq", type: "text", body: "10 units.", refs: [ref] }),
    block({
      key: "oem",
      type: "customization",
      items: [{ title: "Finish", body: "Custom colors", assetId: null, alt: "", href: null, refs: [ref] }],
    }),
  ]);
  const prodScore = structuralBaseline(productPage, [], "product");
  assert.equal(prodScore.scores.credibility, 5);

  const faqPage = page([
    block({
      key: "faq",
      type: "faq",
      faq: [{ question: "MOQ?", answer: "Minimum order is 10 units.", detail: "" }],
      refs: [ref],
    }),
  ]);
  const faqScore = structuralBaseline(faqPage, [], "faq");
  assert.ok(faqScore.scores.credibility >= 4);

  const contactPage = page(
    [block({ key: "checklist", type: "text", body: "Share your target market." })],
    {
      presentation: {
        navigationLabel: "Contact",
        headline: "Plan your quote",
        summary: "Send model and quantity details.",
        primaryActionLabel: "Request a quote",
        inquiryHeading: "Start your equipment quote",
        visualStyle: "industrial",
        heroLayout: "split",
        designNotes: "",
      },
    },
  );
  const contactScore = structuralBaseline(contactPage, [], "contact");
  assert.ok(contactScore.scores.credibility >= 4);

  // Structural reconcileImageFindings keeps findings on sections with 0 images or broken images.
  const metrics = [
    {
      width: 1440,
      images: 3,
      brokenImages: 0,
      sections: [
        { id: "block-hero", images: 1, broken: 0 },
        { id: "block-empty-split", images: 0, broken: 0 },
      ],
    },
  ];
  const findings = [
    { blockKey: "hero", code: "imagery", recommendation: "Hero image is unavailable." },
    { blockKey: "empty-split", code: "imagery", recommendation: "Image is unavailable in this split." },
    { blockKey: "hero", code: "imagery", recommendation: "Crop the espresso machine tighter." },
  ];
  const reconciled = reconcileImageFindings(findings, metrics);
  assert.deepEqual(
    reconciled.map((f) => [f.blockKey, f.recommendation]),
    [
      ["empty-split", "Image is unavailable in this split."],
      ["hero", "Crop the espresso machine tighter."],
    ],
  );
});

test("§4.1 & §2.2: brand-site.md stays well below 15000 bytes via modular packs; privacy page discloses platform AI processor", () => {
  const base = siteSkillProfile();
  assert.ok(
    Buffer.byteLength(base.guidance) <= 14500,
    "expected headroom below 15000, got " + Buffer.byteLength(base.guidance),
  );
  const prec = packSkillGuidance("precision");
  assert.match(prec, /composition\.pack = "precision"/);
  assert.equal(packSkillGuidance("../etc/passwd"), "");
  const withPack = siteSkillProfile("precision");
  assert.notEqual(withPack.hash, base.hash);
  assert.match(withPack.guidance, /Precision rendering pack/);

  const snap: Snapshot = {
    site: {
      id: "s1",
      name: "Verona Brewtech",
      templateId: "adaptive",
      language: "en",
      brandColor: "#14110f",
      productIds: [],
    },
    pages: [],
    facts: [],
    settings: { canonicalBaseUrl: "https://example.invalid" },
    assets: {},
    inquiry: { privacyVersion: "j1-s7-v1", policyFacts: [] },
    createdAt: new Date().toISOString(),
  };
  const html = renderPrivacy(snap);
  assert.match(html, /platform-managed AI sub-processor/i);
  assert.match(html, /data controller/i);
});

test("§3.1 & §4.6-1 & §4.7-2: SSE stream parsing, review sampling, bounded concurrency and outline merge", async (t) => {
  const prevStream = process.env.AI_STREAM_LONG_TASKS;
  const prevSample = process.env.REVIEW_SAMPLE_THRESHOLD;
  const prevConc = process.env.AUTO_IMAGE_CONCURRENCY;
  t.after(() => {
    if (prevStream === undefined) delete process.env.AI_STREAM_LONG_TASKS;
    else process.env.AI_STREAM_LONG_TASKS = prevStream;
    if (prevSample === undefined) delete process.env.REVIEW_SAMPLE_THRESHOLD;
    else process.env.REVIEW_SAMPLE_THRESHOLD = prevSample;
    if (prevConc === undefined) delete process.env.AUTO_IMAGE_CONCURRENCY;
    else process.env.AUTO_IMAGE_CONCURRENCY = prevConc;
  });
  delete process.env.AI_STREAM_LONG_TASKS;
  delete process.env.REVIEW_SAMPLE_THRESHOLD;
  delete process.env.AUTO_IMAGE_CONCURRENCY;
  assert.equal(streamLongTasksEnabled(), true);
  assert.equal(streamLongTasksEnabled("false"), false);
  assert.equal(reviewSampleThreshold(), 4);
  assert.equal(reviewSampleThreshold("0"), 0);
  assert.equal(autoImageConcurrency(), 2);
  assert.equal(autoImageConcurrency("9"), 4);

  // SSE stream parsing collects deltas, finish_reason and final usage chunk.
  const chunks = [
    'data: {"choices":[{"delta":{"content":"{\\"summary\\":\\"OK\\""}}]}\n\n',
    'data: {"choices":[{"delta":{"content":",\\"findings\\":[]}"},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"total_tokens":321}}\n\n',
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(Buffer.from(c, "utf8"));
      controller.close();
    },
  });
  const parsed = await readSseChatStream(stream);
  assert.equal(parsed.choices[0].message.content, '{"summary":"OK","findings":[]}');
  assert.equal(parsed.choices[0].finish_reason, "stop");
  assert.equal(parsed.usage?.total_tokens, 321);

  // Review sampling keeps home + first representative of each page type when > threshold.
  const veronaUnits = [
    { key: "home", node: { type: "home" } },
    { key: "espresso-machines", node: { type: "category" } },
    { key: "commercial-grinders", node: { type: "category" } },
    { key: "vb-2g", node: { type: "product" } },
    { key: "vb-3g", node: { type: "product" } },
    { key: "vg-83", node: { type: "product" } },
    { key: "customization", node: { type: "customization" } },
    { key: "faq", node: { type: "faq" } },
    { key: "contact", node: { type: "contact" } },
  ];
  const sampled = selectFullReviewKeys(veronaUnits, 4);
  assert.deepEqual([...sampled], [
    "home",
    "espresso-machines",
    "vb-2g",
    "customization",
    "faq",
    "contact",
  ]);
  assert.equal(selectFullReviewKeys(veronaUnits.slice(0, 2), 4).size, 2);
  assert.equal(selectFullReviewKeys(veronaUnits, 0).size, veronaUnits.length);

  // Bounded concurrency never exceeds limit and preserves output order.
  let active = 0;
  let peak = 0;
  const out = await runBounded([1, 2, 3, 4, 5], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return n * 10;
  });
  assert.ok(peak <= 2);
  assert.deepEqual(out, [10, 20, 30, 40, 50]);

  // Outline merge builds a valid PageInput preserving order and unique keys.
  const outline = pageOutlineSchema.parse({
    title: "Commercial Espresso Range",
    metaDescription: "Commercial espresso machines.",
    presentation: {
      navigationLabel: "Home",
      headline: "Built for every shift",
      summary: "Commercial espresso equipment.",
      primaryActionLabel: "Request a quote",
      visualStyle: "industrial",
      heroLayout: "split",
      designNotes: "",
    },
    refs: [],
    blocks: [
      { key: "overview", type: "text", heading: "Overview", purpose: "Intro" },
      { key: "faq", type: "faq", heading: "FAQ", purpose: "Questions" },
    ],
  });
  const merged = mergeGeneratedBlocks(outline, [
    block({ key: "overview", type: "text", body: "Built for specialty bars." }),
    block({ key: "faq", type: "faq", faq: [] }),
  ]);
  assert.deepEqual(
    merged.blocks.map((b) => b.key),
    ["overview", "faq"],
  );
});

test("§3.2 & §4.9-1: atelier and monolith packs, pack skills, RTL & non-Latin wordmarks work cleanly", () => {
  assert.match(packSkillGuidance("atelier"), /composition\.pack = "atelier"/);
  assert.match(packSkillGuidance("monolith"), /composition\.pack = "monolith"/);
  const makeSnap = (pack: "atelier" | "monolith" | "precision", language = "en"): Snapshot => ({
    site: {
      id: "s1",
      name: language === "ar" ? "شركة فيرونا" : "Studio Craft",
      templateId: "adaptive",
      language,
      brandColor: "#14110f",
      productIds: [],
      designDirection: {
        composition: {
          version: "v1",
          typography: pack === "atelier" ? "editorial" : "technical",
          palette: pack === "atelier" ? "ivory" : "graphite",
          navigation: "catalogue",
          productLayout: "cards",
          pack,
        },
      },
    },
    pages: [
      {
        id: "h",
        nodeKey: "home",
        type: "home",
        path: "/",
        title: "Home",
        metaDescription: "Summary.",
        refs: [],
        blocks: [block({ key: "intro", type: "text", body: "Welcome." })],
      },
    ],
    facts: [],
    settings: { canonicalBaseUrl: "https://example.invalid" },
    assets: {},
    createdAt: new Date().toISOString(),
  });
  const atelierHtml = renderStaticPage(makeSnap("atelier"), makeSnap("atelier").pages[0]);
  assert.match(atelierHtml, /pack-atelier/);
  assert.match(atelierHtml, /plus-jakarta-sans-700\.woff2/);
  const monolithHtml = renderStaticPage(makeSnap("monolith"), makeSnap("monolith").pages[0]);
  assert.match(monolithHtml, /pack-monolith/);
  assert.match(monolithHtml, /space-grotesk-700\.woff2/);
  const arHtml = renderStaticPage(makeSnap("precision", "ar"), makeSnap("precision", "ar").pages[0]);
  assert.match(arHtml, /lang="ar" dir="rtl"/);
  assert.match(arHtml, /pack-precision/);
  // Non-Latin wordmark includes CJK/Arabic fallback fonts and wider advance widths.
  const svg = standaloneWordmarkSvg("维罗纳咖啡设备");
  assert.match(svg, /Noto Sans SC/);
  assert.match(svg, /Noto Sans Arabic/);
  assert.ok(wordmarkTextWidth("فيرونا") > 0);
});
