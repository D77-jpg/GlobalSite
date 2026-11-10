import { test } from "node:test";
import assert from "node:assert/strict";
import { strategy, sectionDesign } from "../src/validators/sites.validator";
import { validatePage } from "../src/services/page-validation.service";
import { compositionPage } from "./fixtures/composition";
import { renderStaticPage } from "../src/services/static-template.service";
import { measuredFindings } from "../src/services/site-review.service";
import { procurementCoverage } from "../src/services/b2b-planning.service";
const cases = [
  {
    offering: "Oil paintings",
    buyingJourney: "visual-selection",
    productSections: ["specs"],
    nav: "Collections",
    type: "editorial",
    frame: "gallery",
  },
  {
    offering: "Industrial equipment",
    buyingJourney: "technical-selection",
    productSections: ["specs", "material", "application"],
    nav: "Engineering",
    type: "technical",
    frame: "index",
  },
  {
    offering: "Bag collections",
    buyingJourney: "configured-sourcing",
    productSections: ["specs", "material", "oem", "moq", "samples"],
    nav: "Materials & Options",
    type: "sans",
    frame: "story",
  },
];
test("art, engineering and bags retain distinct business navigation, layout and applicable facts", () => {
  const html = [];
  for (const c of cases) {
    const { nav: _nav, type: _type, frame: _frame, ...business } = c;
    const policy = strategy.parse({
      ...business,
      version: "v1",
      decisionFactors: ["Selection", "Project fit"],
      navigation: [{ label: c.nav, nodeKeys: ["range"] }],
      visualPriorities: ["Relevant photography", "Clear hierarchy"],
      questions: [],
    });
    const page = compositionPage(0);
    page.presentation!.composition!.typography = c.type as any;
    page.blocks[0].type = "category-grid";
    page.blocks[0].design = sectionDesign.parse({
      purpose: "discovery",
      frame: c.frame,
      ratio: "natural",
      fit: "contain",
      focus: "center",
      density: "compact",
    });
    const range = {
      ...page,
      type: "category",
      path: "/range",
      presentation: { ...page.presentation, navigationLabel: "Range" },
    };
    const snapshot = {
      site: {
        name: "Fixture",
        templateId: "adaptive",
        buyerProfile: {},
        plan: { strategy: policy, nodes: [{ key: "range", path: "/range" }] },
      },
      pages: [
        { ...page, type: "home", path: "/" },
        range,
        { ...range, type: "product", productId: "p", path: "/range/item" },
      ],
      products: [],
      facts: [],
      assets: {},
      settings: { canonicalBaseUrl: "https://fixture.invalid" },
      createdAt: "fixture",
    };
    const result = renderStaticPage(snapshot, snapshot.pages[0]);
    assert.match(result, new RegExp(c.nav.replace("&", "&amp;")));
    assert.match(result, new RegExp("frame-" + c.frame));
    // Agent discovery exists; renderer must not append a duplicate catalogue.
    assert.equal((result.match(/id="collection"/g) || []).length, 0);
    html.push(result);
    const coverage = procurementCoverage(
      snapshot.site,
      [{ id: "p", assetIds: ["image"] }],
      [],
    );
    assert.equal(
      coverage.gaps.some((g) => g.type === "product.moq"),
      c.productSections.includes("moq"),
    );
  }
  assert.equal(new Set(html).size, 3);
});
test("applicable sections do not relax factual claims or old product requirements", () => {
  const page = compositionPage(0);
  page.blocks = [
    {
      ...page.blocks[1],
      key: "specs",
      type: "specs",
      table: { columns: ["Specification", "Details"], rows: [] },
      body: "Contact our team for confirmed details.",
    },
  ];
  assert(
    !validatePage(page, [], {
      type: "product",
      productIds: [],
      requiredProductSections: ["specs"],
    }).some((i) => i.code === "PRODUCT_SECTION_REQUIRED"),
  );
  assert(
    validatePage(page, [], { type: "product", productIds: [] }).some(
      (i) => i.code === "PRODUCT_SECTION_REQUIRED",
    ),
  );
  page.blocks[0].body = "Ships in 5 days";
  assert(
    validatePage(page, [], {
      type: "product",
      productIds: [],
      requiredProductSections: ["specs"],
    }).some((i) => i.code === "UNSOURCED_NUMBER"),
  );
  assert(
    !sectionDesign.safeParse({
      purpose: "selection",
      frame: 'gallery" onclick="bad',
      ratio: "natural",
      fit: "contain",
      focus: "center",
      density: "compact",
    }).success,
  );
});
test("measured critique flags repetition and excessive empty scale without claiming image understanding", () => {
  const findings = measuredFindings([
    {
      width: 1440,
      discoverySections: 2,
      repeatedHeadings: ["Range"],
      sections: [{ id: "block-visual", height: 2500, words: 15 }],
    },
  ]);
  assert(findings.some((f) => f.code === "repetition"));
  assert(findings.some((f) => f.blockKey === "visual" && f.code === "layout"));
  assert.deepEqual(measuredFindings([{ width: 375, sections: [] }]), []);
});

test("curated discovery respects the Agent's selected destinations and order", () => {
  const page = compositionPage(0);
  const item = (href: string) => ({
    title: "Selected view",
    body: "View the collection",
    assetId: null,
    alt: "",
    href,
    refs: [],
  });
  page.blocks = [
    {
      ...page.blocks[0],
      type: "category-grid",
      items: [item("/b"), item("/a")],
      design: {
        purpose: "discovery",
        frame: "gallery",
        ratio: "natural",
        fit: "contain",
        focus: "center",
        density: "compact",
      },
    },
  ];
  const child = (path: string) => ({
    ...page,
    type: "category",
    path,
    presentation: { ...page.presentation, navigationLabel: path },
  });
  const snapshot = {
    site: { name: "Fixture", buyerProfile: {} },
    pages: [
      { ...page, type: "home", path: "/" },
      child("/a"),
      child("/b"),
      child("/c"),
    ],
    products: [],
    facts: [],
    assets: {},
    settings: { canonicalBaseUrl: "https://fixture.invalid" },
    createdAt: "fixture",
  };
  const html = renderStaticPage(snapshot, snapshot.pages[0]);
  const grid = html.slice(
    html.indexOf('class="category-grid"'),
    html.indexOf("</section>", html.indexOf('class="category-grid"')),
  );
  assert(grid.indexOf('href="/b"') < grid.indexOf('href="/a"'));
  assert(!grid.includes('href="/c"'));
});

test("Agent component resolution consolidates only explicit unknown placeholders and never erases claims", async () => {
  const { resolveAgentPage } = await import(
    "../src/services/section-design.service"
  );
  const page = compositionPage(0);
  page.blocks = [
    {
      ...page.blocks[0],
      key: "specs",
      type: "specs",
      body: "Details need confirmation.",
      table: {
        columns: ["Specification", "Detail"],
        rows: [
          ["Dimensions", "Contact our team for confirmed details."],
          ["Medium", "Information to be confirmed."],
        ],
      },
    },
  ];
  const normalized = resolveAgentPage(page);
  assert.deepEqual(normalized.blocks[0].table!.rows, []);
  assert.equal(page.blocks[0].table!.rows.length, 2);
  page.blocks[0].table!.rows = [["Width", "80 cm"]];
  const unchanged = resolveAgentPage(page);
  assert.deepEqual(unchanged.blocks[0].table!.rows, [["Width", "80 cm"]]);
  assert(
    validatePage(unchanged, [], {
      type: "product",
      productIds: [],
      requiredProductSections: ["specs"],
    }).some((i) => i.code === "UNSOURCED_DETAIL"),
  );
});
