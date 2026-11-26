// S36 Verona site-review fixes (no database): model codes as identifiers,
// citation completion, item evidence overlap and appended-value cleanup,
// duplicate FAQ answers and the 30–80 word window, audit wording, sample
// terms, precision-pack rendering, hero fallback order and review navigation.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { PageInput } from "../src/validators/sites.validator";
import {
  FAQ_MAX_WORDS,
  FAQ_MIN_WORDS,
  validatePage,
  validationIdentifiers,
} from "../src/services/page-validation.service";
import { completeFactRefs } from "../src/services/agents/ref-completion";
import {
  SAFE_PLACEHOLDER,
  repairSamplesSection,
  stripAppendedFactValues,
  stripAppendedValue,
} from "../src/services/agents/claim-repair";
import { repairFaq } from "../src/services/agents/faq-repair";
import {
  packHeroAvailable,
  planImageSlots,
} from "../src/services/agents/auto-images";
import {
  reviewBrowserMetrics,
  uniqueNavigation,
} from "../src/services/agents/quality-baseline";
import {
  renderStaticPage,
  type Snapshot,
} from "../src/services/static-template.service";

const P1 = "a".repeat(24),
  P2 = "b".repeat(24);
const ID = (n: number) => String(n).padStart(24, "c");
const block = (o: Record<string, unknown>) => ({
  key: "overview",
  type: "text",
  heading: "Section",
  body: "",
  table: null,
  faq: [],
  assetId: null,
  alt: "",
  refs: [] as { factId: string; revision: number }[],
  ...o,
});
const item = (title: string, body: string, href: string | null = null) => ({
  title,
  body,
  assetId: null,
  alt: "",
  href,
  refs: [] as { factId: string; revision: number }[],
});
const page = (blocks: unknown[], presentation?: unknown) =>
  ({
    title: "Commercial espresso equipment",
    metaDescription: "",
    refs: [],
    blocks,
    ...(presentation ? { presentation } : {}),
  }) as PageInput;
const fact = (n: number, o: Record<string, unknown>) => ({
  _id: ID(n),
  status: "confirmed",
  revision: 1,
  subjectType: "organization",
  subjectId: null,
  type: "company.name",
  value: "",
  ...o,
});
const codes = (issues: Array<{ code: string }>, code: string) =>
  issues.filter((i) => i.code === code);

test("model codes in product names and plan titles are identifiers, plain figures stay gated", () => {
  const identifiers = validationIdentifiers(
    "Verona Brewtech",
    [
      { name: "VB-2G Pro Dual-Boiler Espresso Machine" },
      { name: "VB-3G Flagship Multi-Boiler Espresso Machine" },
    ],
    [{ title: "VG-83 Precision Flat-Burr Commercial Grinder" }],
  );
  assert.ok(identifiers.includes("Verona Brewtech"));
  const unsourced = (body: string, ids?: string[]) =>
    codes(
      validatePage(page([block({ body })]), [], {
        type: "home",
        productIds: [],
        language: "en",
        ...(ids ? { identifiers: ids } : {}),
      }),
      "UNSOURCED_NUMBER",
    ).map((i) => i.token);
  assert.deepEqual(
    unsourced(
      "Compare the VB-2G Pro, the VG-83 and the VB-3G for your counter.",
      identifiers,
    ),
    [],
  );
  assert.deepEqual(unsourced("Pair the VB2G with a VG-83.", identifiers), []);
  // Without identifiers the former behaviour is unchanged.
  assert.deepEqual(unsourced("Compare the VB-2G Pro."), ["2"]);
  // Figures with units and unknown codes still need confirmed facts.
  assert.deepEqual(unsourced("The VG-83 uses 83 mm burrs.", identifiers), [
    "83",
  ]);
  assert.deepEqual(unsourced("Lead time is 25 days.", identifiers), ["25"]);
  for (const text of ["25-days", "83mm"])
    assert.equal(unsourced(text, [...identifiers, text]).length, 1);
  assert.deepEqual(unsourced("The X-500 press.", identifiers), ["500"]);
});

test("citation completion adds refs only for quoted, citable facts of the right product", () => {
  const lead = fact(1, {
    subjectType: "product",
    subjectId: P1,
    type: "product.leadTime",
    value: "25 days",
  });
  const moq = fact(2, {
    subjectType: "product",
    subjectId: P1,
    type: "product.moq",
    value: "5",
    unit: "units",
  });
  const otherLead = fact(3, {
    subjectType: "product",
    subjectId: P2,
    type: "product.leadTime",
    value: "30 days",
  });
  const productCtx = {
    type: "product",
    productId: P1,
    productIds: [P1, P2],
    language: "en",
    requiredProductSections: [],
  };
  const draft = page([
    block({
      body: "Lead time is 25 days. The MOQ is 5 units. Others take 30 days.",
    }),
  ]);
  const out = completeFactRefs(draft, [lead, moq, otherLead], productCtx);
  assert.deepEqual(out.blocks[0].refs, [
    { factId: ID(1), revision: 1 },
    { factId: ID(2), revision: 1 },
  ]);
  assert.deepEqual(draft.blocks[0].refs, []);
  assert.deepEqual(
    codes(
      validatePage(out, [lead, moq, otherLead], productCtx),
      "UNSOURCED_NUMBER",
    ).map((i) => i.token),
    ["30"],
  );
  // A figure written with its unit ("25-day") or beside its group keyword.
  const split = fact(4, {
    subjectType: "product",
    subjectId: P1,
    type: "product.leadTime",
    value: "25",
    unit: "days",
  });
  assert.equal(
    completeFactRefs(
      page([block({ body: "Plan a 25-day lead time." })]),
      [split],
      productCtx,
    ).blocks[0].refs.length,
    1,
  );
  // Partial figures and unrelated text are never cited; unchanged pages are returned as-is.
  const partial = page([block({ body: "Lead time is 125 days." })]);
  assert.equal(completeFactRefs(partial, [lead], productCtx), partial);
  // Candidates count only in demo mode and only when AI-suggested.
  const demo = {
    ...lead,
    status: "candidate",
    source: { kind: "ai-suggested" },
  };
  const quoted = page([block({ body: "Lead time is 25 days." })]);
  assert.equal(completeFactRefs(quoted, [demo], productCtx), quoted);
  assert.equal(
    completeFactRefs(quoted, [demo], { ...productCtx, allowDemoFacts: true })
      .blocks[0].refs.length,
    1,
  );
  // Non-numeric values need the full literal value.
  const material = fact(5, {
    subjectType: "product",
    subjectId: P1,
    type: "product.material",
    value: "Titanium alloy",
  });
  const items = page([
    block({
      key: "craft",
      type: "features",
      items: [
        item("Burrs", "Flat burrs in titanium alloy."),
        item("Housing", "Matte black."),
      ],
    }),
  ]);
  const cited = completeFactRefs(items, [material], productCtx);
  assert.deepEqual(cited.blocks[0].items![0].refs, [
    { factId: ID(5), revision: 1 },
  ]);
  assert.deepEqual(cited.blocks[0].items![1].refs, []);
  // On shared pages a sentence naming one model cites only that model's facts.
  const products = [
    { id: P1, name: "VB-2G Pro Dual-Boiler" },
    { id: P2, name: "VB-3G Flagship" },
  ];
  const homeCtx = { type: "home", productIds: [P1, P2], language: "en" };
  assert.deepEqual(
    completeFactRefs(
      page([block({ body: "The VB-3G ships in 25 days." })]),
      [lead],
      homeCtx,
      products,
    ).blocks[0].refs,
    [],
  );
  assert.equal(
    completeFactRefs(
      page([block({ body: "The VB-2G Pro ships in 25 days." })]),
      [lead],
      homeCtx,
      products,
    ).blocks[0].refs.length,
    1,
  );
});

test("customization items are supported by word overlap; appended fact values are removed", () => {
  const oem = fact(6, {
    type: "company.oem",
    value: "Custom powder-coat colors, wood trim and branded panels",
  });
  const material = fact(7, {
    subjectType: "product",
    subjectId: P1,
    type: "product.material",
    value: "Titanium alloy",
  });
  const ctx = { type: "customization", productIds: [P1], language: "en" };
  const options = (bodies: string[]) =>
    page([
      block({
        key: "finishes",
        type: "customization",
        heading: "Finish options",
        refs: [{ factId: ID(6), revision: 1 }],
        items: [
          item("Powder-coat colors", bodies[0]),
          item("Wood trim", bodies[1]),
          item("Bar layout", bodies[2]),
        ],
      }),
    ]);
  const detail = (p: PageInput) =>
    codes(validatePage(p, [oem, material], ctx), "UNSOURCED_DETAIL").map(
      (i) => i.field,
    );
  assert.deepEqual(
    detail(
      options([
        "Match your café palette with a custom powder-coat finish.",
        "Walnut wood trim warms the counter.",
        "Plan the bar before ordering.",
      ]),
    ),
    ["blocks.finishes.items.2"],
  );

  assert.equal(
    stripAppendedValue(
      "Match your café palette with custom powder-coat colors. Titanium alloy",
      "Powder-coat colors",
      ["Titanium alloy"],
    ),
    "Match your café palette with custom powder-coat colors.",
  );
  assert.equal(
    stripAppendedValue(
      "Supply artwork for panel approval 3 independent groupheads",
      "Branded panels",
      ["3 independent groupheads"],
    ),
    "Supply artwork for panel approval.",
  );
  // Values that finish a real phrase, or that the title is about, stay.
  assert.equal(
    stripAppendedValue("Choose a finish in matte black", "Finishes", [
      "Matte black",
    ]),
    "Choose a finish in matte black",
  );
  assert.equal(
    stripAppendedValue(
      "Hardened flat burrs. Titanium alloy",
      "Titanium alloy burrs",
      ["Titanium alloy"],
    ),
    "Hardened flat burrs. Titanium alloy",
  );
  const appended = options([
    "Match your café palette with custom powder-coat colors. Titanium alloy",
    "Walnut wood trim warms the counter. Titanium alloy",
    "Plan the bar before ordering.",
  ]);
  const cleaned = stripAppendedFactValues(appended, [oem, material], ctx);
  assert.equal(
    cleaned.blocks[0].items![0].body,
    "Match your café palette with custom powder-coat colors.",
  );
  assert.equal(
    cleaned.blocks[0].items![1].body,
    "Walnut wood trim warms the counter.",
  );
  assert.ok(
    validatePage(cleaned, [oem, material], ctx).length <=
      validatePage(appended, [oem, material], ctx).length,
  );
});

test("duplicate FAQ answers remain visible to retries; the direct answer window is 30–80 words", () => {
  // Letter-only words: digits would trip the number gate.
  const letter = (i: number) => String.fromCharCode(97 + i);
  const distinct = (prefix: string, n: number) =>
    Array.from(
      { length: n },
      (_, i) => prefix + "x" + letter(i % 26) + letter(Math.floor(i / 26)),
    ).join(" ") + ".";
  const a = distinct("a", 35),
    nearA = distinct("a", 33).replace(/\.$/, "") + " extra other.",
    b = distinct("b", 35);
  const faq = (answers: string[]) =>
    page([
      block({
        key: "buying-faq",
        type: "faq",
        heading: "Buying questions",
        faq: answers.map((answer, i) => ({
          question: "Question " + "ABCDEFGH"[i] + "?",
          answer,
          detail: "",
        })),
      }),
    ]);
  const ctx = { type: "faq", productIds: [], language: "en" };
  const dup = codes(
    validatePage(faq([a, nearA, b, a]), [], ctx),
    "FAQ_DUPLICATE_ANSWER",
  );
  assert.deepEqual(
    dup.map((i) => [i.field, i.token]),
    [
      ["blocks.buying-faq.faq.1", "0"],
      ["blocks.buying-faq.faq.3", "0"],
    ],
  );
  const repaired = repairFaq(faq([a, a, b]), [], ctx);
  assert.deepEqual(
    repaired.blocks[0].faq.map((f) => f.answer),
    [a, a, b],
  );
  assert.equal(
    codes(validatePage(repaired, [], ctx), "FAQ_DUPLICATE_ANSWER").length,
    1,
  );
  assert.deepEqual(
    validatePage(faq([distinct("c", 45), distinct("c", 45)]), [], {
      ...ctx,
      legacyCopyRules: true,
    }),
    [],
  );
  assert.equal(FAQ_MIN_WORDS, 30);
  assert.equal(FAQ_MAX_WORDS, 80);
  const length = (n: number) =>
    codes(
      validatePage(faq([distinct("c", n)]), [], ctx),
      "FAQ_DIRECT_ANSWER_REQUIRED",
    ).length;
  assert.equal(length(29), 1);
  assert.equal(length(30), 0);
  assert.equal(length(80), 0);
  assert.equal(length(81), 1);
});

test("internal audit wording is rejected on designed pages; older pages keep their rules", () => {
  const composition = {
    version: "v1",
    typography: "technical",
    palette: "obsidian",
    navigation: "catalogue",
    productLayout: "cards",
  };
  const presentation = (withComposition: boolean) => ({
    navigationLabel: "Customization",
    headline: "Finish it your way",
    summary: "Powder coat, wood trim and branded panels.",
    primaryActionLabel: "Request a quote",
    visualStyle: "industrial",
    heroLayout: "split",
    designNotes: "",
    ...(withComposition ? { composition } : {}),
  });
  const audit = (body: string, withComposition = true) =>
    codes(
      validatePage(page([block({ body })], presentation(withComposition)), [], {
        type: "customization",
        productIds: [],
        language: "en",
      }),
      "COPY_AUDIT_LANGUAGE",
    ).length;
  for (const body of [
    "No OEM fact is supplied for this model.",
    "The facts confirm a dual boiler.",
    "Finishes are listed in the supplied facts.",
    "Answers use the confirmed product facts.",
    "Check the fact library before ordering.",
  ]) {
    assert.equal(audit(body), 1, body);
    assert.equal(audit(body, false), 0, body);
  }
  assert.equal(audit("Choose powder-coat colours for your café."), 0);
});

test("the samples section needs a sample fact; a lead time no longer stands in", () => {
  const lead = fact(8, {
    subjectType: "product",
    subjectId: P1,
    type: "product.leadTime",
    value: "25 days",
  });
  const sample = fact(9, {
    subjectType: "product",
    subjectId: P1,
    type: "product.samples",
    value: "Paid samples in 10 days",
  });
  const ctx = {
    type: "product",
    productId: P1,
    productIds: [P1],
    language: "en",
    requiredProductSections: ["samples"],
  };
  const samples = (body: string, factId: string, heading = "Lead time") =>
    page([
      block({ key: "samples", heading, body, refs: [{ factId, revision: 1 }] }),
    ]);
  const wrong = samples("Ready in 25 days.", ID(8));
  const issues = validatePage(wrong, [lead, sample], ctx);
  assert.equal(codes(issues, "UNSOURCED_DETAIL").length, 1);
  assert.equal(codes(issues, "UNSOURCED_NUMBER").length, 1);
  assert.deepEqual(
    validatePage(wrong, [lead, sample], { ...ctx, legacyCopyRules: true }),
    [],
  );
  assert.ok(
    codes(
      validatePage(wrong, [{ ...lead, status: "expired" }], {
        ...ctx,
        legacyCopyRules: true,
      }),
      "FACT_REFERENCE_STALE",
    ).length,
  );
  const fixed = repairSamplesSection(wrong, [lead, sample], ctx);
  assert.equal(fixed.blocks[0].body, SAFE_PLACEHOLDER);
  assert.equal(fixed.blocks[0].heading, "Samples");
  assert.deepEqual(validatePage(fixed, [lead, sample], ctx), []);
  const right = samples("Paid samples in 10 days.", ID(9), "Samples");
  assert.deepEqual(validatePage(right, [lead, sample], ctx), []);
  assert.equal(repairSamplesSection(right, [lead, sample], ctx), right);
});

const composition = (pack: boolean) => ({
  version: "v1",
  typography: "technical",
  palette: "obsidian",
  navigation: "catalogue",
  productLayout: "cards",
  ...(pack ? { pack: "precision" } : {}),
});
function snapshot(pack: boolean, pages: any[], extra: Partial<Snapshot> = {}) {
  return {
    site: {
      id: "site",
      name: "Verona Brewtech",
      templateId: "adaptive",
      language: "en",
      brandColor: "#14110f",
      productIds: [P1, P2],
      buyerProfile: { audiences: ["Café groups"], primaryAction: "quote" },
      designDirection: { composition: composition(pack) },
    },
    pages: [
      {
        id: "home",
        nodeKey: "home",
        type: "home",
        path: "/",
        productId: null,
        title: "Commercial espresso equipment",
        metaDescription: "Espresso machines and grinders for cafés.",
        refs: [],
        presentation: {
          navigationLabel: "Home",
          headline: "Every shot. Every shift.",
          summary: "Compare machines and grinders, then request a quote.",
          primaryActionLabel: "Request a quote",
          primaryActionTarget: "inquiry",
          visualStyle: "industrial",
          heroLayout: "split",
          designNotes: "",
          composition: composition(pack),
        },
        blocks: [],
      },
      ...pages,
    ],
    products: [],
    facts: [],
    assets: {},
    settings: { canonicalBaseUrl: "https://fixture.invalid" },
    createdAt: "fixture",
    inquiry: { enabled: false },
    ...extra,
  } as Snapshot;
}

test("precision pack merges short purchasing sections and drops repeated CTA and spec blocks", () => {
  const vb3g = {
    id: "vb-3g",
    nodeKey: "vb-3g",
    type: "product",
    productId: P2,
    path: "/espresso-machines/vb-3g",
    title: "VB-3G Flagship Multi-Boiler Espresso Machine",
    metaDescription: "Multi-boiler espresso machine for high-volume cafés.",
    refs: [],
    presentation: {
      navigationLabel: "VB-3G Flagship",
      headline: "VB-3G Flagship Multi-Boiler Espresso Machine for Busy Cafés",
      summary: "Three groupheads for high-volume service.",
      primaryActionLabel: "Request a quote",
      primaryActionTarget: "inquiry",
      inquiryHeading: "Request a VB-3G specification quote",
    },
    blocks: [
      block({
        key: "specs",
        type: "specs",
        heading: "Specifications",
        table: {
          columns: ["Specification", "Details"],
          rows: [
            ["Groupheads", "3 independent groupheads"],
            ["Boiler", "Multi-boiler"],
            ["Lead time", "30 days"],
          ],
        },
      }),
      block({
        key: "quote",
        type: "cta",
        heading: "Request a VB-3G specification quote",
        body: "Send your venue and volume.",
        items: [item("Request a quote", "", "#inquiry")],
      }),
      block({
        key: "material",
        heading: "Material",
        body: "Brushed stainless steel with walnut trim.",
      }),
      block({
        key: "application",
        heading: "Application",
        body: "Cafés, hotel coffee bars and chains.",
      }),
      block({
        key: "moq",
        heading: "Minimum order",
        body: "Minimum order of 3 units.",
      }),
      block({
        key: "specs-summary",
        type: "specs",
        heading: "Specifications",
        table: {
          columns: ["Specification", "Details"],
          rows: [
            ["Specification", "3 independent groupheads"],
            ["Specification", "30 days"],
          ],
        },
      }),
      block({
        key: "service",
        heading: "Service",
        body: "Share your venue and daily cup volume.",
      }),
    ],
  };
  const pack = renderStaticPage(snapshot(true, [vb3g]), vb3g);
  const plain = renderStaticPage(snapshot(false, [vb3g]), vb3g);

  assert.match(
    pack,
    /<section class="section section-terms" id="purchasing-terms"><h2>Purchasing terms<\/h2><dl class="terms-list">/,
  );
  for (const key of ["material", "application", "moq"]) {
    assert.match(pack, new RegExp('<div id="block-' + key + '"><dt>'));
    assert.doesNotMatch(pack, new RegExp("section-" + key + "\\b"));
    assert.match(plain, new RegExp('class="section section-' + key));
  }
  assert.ok(
    pack.indexOf('id="purchasing-terms"') < pack.indexOf('id="inquiry"'),
  );
  // The CTA repeating the inquiry heading is dropped even though it is not last.
  assert.doesNotMatch(pack, /id="block-quote"/);
  assert.match(plain, /id="block-quote"/);
  // The second spec table is covered by the first one.
  assert.doesNotMatch(pack, /id="block-specs-summary"/);
  assert.doesNotMatch(pack, /href="#block-specs-summary"/);
  assert.match(pack, /id="block-specs"/);
  assert.match(plain, /id="block-specs-summary"/);
  // Low-word sections and long inner-page titles.
  assert.match(pack, /<section class="section-compact section section-service/);
  assert.doesNotMatch(plain, /section-compact|section-terms|hero-long/);
  assert.match(pack, /<section class="hero composition-hero-[a-z]+ hero-long/);
});

test("inner-page hero fallback prefers page, product and category images over the home photo", () => {
  const assets = {
    [ID(1)]: { path: "/assets/home.webp", width: 1600, height: 800 },
    [ID(2)]: { path: "/assets/vb-2g.webp", width: 1600, height: 900 },
    [ID(3)]: { path: "/assets/vg-83.webp", width: 900, height: 1000 },
    [ID(4)]: { path: "/assets/split.webp", width: 1200, height: 900 },
  };
  const inner = (o: Record<string, unknown>) => ({
    refs: [],
    metaDescription: "Commercial espresso equipment.",
    presentation: {
      navigationLabel: "Page",
      headline: "Inner page",
      summary: "Buyer guidance.",
      primaryActionLabel: "Request a quote",
    },
    blocks: [block({ body: "Buyer guidance for this page." })],
    productId: null,
    ...o,
  });
  const pages = [
    inner({
      id: "machines",
      type: "category",
      path: "/espresso-machines",
      title: "Espresso machines",
    }),
    inner({
      id: "vb-2g",
      type: "product",
      productId: P1,
      path: "/espresso-machines/vb-2g",
      title: "VB-2G Pro",
    }),
    inner({
      id: "vg-83",
      type: "product",
      productId: P2,
      path: "/grinders/vg-83",
      title: "VG-83",
    }),
    inner({
      id: "custom",
      type: "customization",
      path: "/customization",
      title: "OEM customization",
    }),
    inner({
      id: "faq",
      type: "faq",
      path: "/faq",
      title: "Buying FAQ",
      blocks: [
        block({
          key: "pair",
          type: "split",
          heading: "Pairing",
          body: "Pair a grinder.",
          assetId: ID(4),
          alt: "Pairing",
        }),
      ],
    }),
  ];
  const s = snapshot(true, pages, {
    products: [
      {
        id: P1,
        name: "VB-2G Pro",
        category: "Espresso machines",
        assetIds: [ID(2)],
      },
      { id: P2, name: "VG-83", category: "Grinders", assetIds: [ID(3)] },
    ],
    assets,
  });
  s.pages[0].blocks = [
    block({ key: "hero", type: "image", assetId: ID(1), alt: "Café counter" }),
  ];
  const hero = (p: any) =>
    /<figure class="hero-visual"><img src="([^"]+)"/.exec(
      renderStaticPage(s, p),
    )?.[1] ?? null;
  assert.equal(hero(s.pages[0]), "/assets/home.webp");
  assert.equal(hero(s.pages[1]), "/assets/vb-2g.webp");
  assert.equal(hero(s.pages[3]), "/assets/vg-83.webp");
  assert.ok(
    ["/assets/vb-2g.webp", "/assets/vg-83.webp"].includes(hero(s.pages[4])!),
  );
  assert.equal(hero(s.pages[5]), "/assets/split.webp");
  // Pages without a pack keep no fallback hero.
  const plain = snapshot(false, pages, { products: s.products, assets });
  assert.equal(
    /<figure class="hero-visual">/.test(
      renderStaticPage(plain, plain.pages[1]),
    ),
    false,
  );
});

test("AI hero illustrations skip pack pages that already have a real image source", () => {
  const textOnly = page([block({ body: "Buyer guidance." })]);
  assert.equal(
    planImageSlots(textOnly, { siteName: "Verona", max: 6 })[0]?.key,
    "hero",
  );
  assert.ok(
    !planImageSlots(textOnly, {
      siteName: "Verona",
      max: 6,
      skipHero: true,
    }).some((s) => s.key === "hero"),
  );
  const nodes = [
    {
      key: "machines",
      path: "/espresso-machines",
      type: "category",
      productId: null,
      parentKey: "home",
    },
    {
      key: "vb-2g",
      path: "/espresso-machines/vb-2g",
      type: "product",
      productId: P1,
      parentKey: "machines",
    },
    {
      key: "custom",
      path: "/customization",
      type: "customization",
      productId: null,
      parentKey: "home",
    },
  ];
  const run = (pack: boolean) =>
    ({
      inputSnapshot: {
        site: {
          designDirection: { composition: composition(pack) },
          plan: { nodes },
        },
        products: [{ id: P1, name: "VB-2G Pro", assetIds: [ID(2)] }],
      },
    }) as any;
  const unit = (key: string) =>
    ({ node: nodes.find((n) => n.key === key) }) as any;
  assert.equal(packHeroAvailable(run(true), unit("machines"), textOnly), true);
  assert.equal(packHeroAvailable(run(true), unit("vb-2g"), textOnly), true);
  assert.equal(packHeroAvailable(run(true), unit("custom"), textOnly), false);
  assert.equal(
    packHeroAvailable(run(false), unit("machines"), textOnly),
    false,
  );
});

test("review navigation lists each visible link once", () => {
  const links = [
    { label: "Espresso machines", href: "/espresso-machines" },
    { label: "Contact", href: "/contact" },
    { label: "Espresso machines", href: "/espresso-machines" },
    { label: "Contact", href: "/contact" },
  ];
  assert.deepEqual(uniqueNavigation(links), links.slice(0, 2));
  assert.deepEqual(uniqueNavigation(null), []);
  const metrics = reviewBrowserMetrics([
    { width: 375, navigation: links },
    { width: 1440, brokenImages: 0 },
  ]);
  assert.equal((metrics[0] as { navigation: unknown[] }).navigation.length, 2);
  assert.deepEqual(metrics[1], { width: 1440, brokenImages: 0 });
  const reviewer = fs.readFileSync(
    path.resolve(__dirname, "../builder/review.mjs"),
    "utf8",
  );
  assert.match(reviewer, /getClientRects\(\)\.length > 0/);
  assert.match(reviewer, /seen\.has\(key\)/);
});

test("guidance, prompts and pack styles carry the review fixes", () => {
  const guidance = fs.readFileSync(
    path.resolve(__dirname, "../agent-skills/brand-site.md"),
    "utf8",
  );
  assert.match(guidance, /Model names are identifiers/);
  assert.match(guidance, /30–80 word direct answer to its own question/);
  assert.ok(Buffer.byteLength(guidance) <= 15000);
  const css = fs.readFileSync(
    path.resolve(__dirname, "../builder/pack-precision.css"),
    "utf8",
  );
  const s36 = css.slice(css.lastIndexOf("/*", css.indexOf("S36 review fixes")));
  assert.match(
    s36,
    /align-self: start;\s*min-height: 0;\s*aspect-ratio: 4 \/ 3;/,
  );
  assert.match(s36, /\.section-terms \.terms-list/);
  assert.match(s36, /\.hero-long/);
  assert.match(s36, /\.section-compact/);
  // Every new rule stays scoped to the pack.
  for (const selector of s36
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((x) => x.split("{")[0].trim())
    .filter(Boolean))
    for (const part of selector.split(","))
      assert.match(part, /\.pack-precision/, part);
});
