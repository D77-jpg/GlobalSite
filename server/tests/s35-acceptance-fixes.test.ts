// S35 Verona acceptance fixes (no database): cut-out figures in card copy,
// card spec values, rendered-image availability in review, a closing CTA
// duplicating the inquiry section, the AI logo safe margin, buying-note
// columns in spec tables and unknown AI outcome classification.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { PageInput } from "../src/validators/sites.validator";
import {
  hasBrokenFragment,
  intactSentences,
} from "../src/services/copy-integrity";
import {
  cardSpecs,
  cardSummary,
  catalogueHtml,
  instructionNote,
  productCards,
  publicTable,
  renderB2BBlock,
  specNote,
} from "../src/services/b2b-template.service";
import {
  AiUsageUnknownError,
  classifyUsageUnknown,
  parseProviderJson,
  providerTokens,
  readCappedBody,
  usageUnknown,
} from "../src/services/ai-usage-unknown";
import { fullPageTimeoutMs } from "../src/services/site-agent-provider.service";
import { unknownAbsorbLimit } from "../src/services/usage.service";
import {
  renderStaticPage,
  type Snapshot,
} from "../src/services/static-template.service";
import {
  SAFE_PLACEHOLDER,
  repairBrokenFragments,
} from "../src/services/agents/claim-repair";
import {
  imageAvailability,
  reconcileImageFindings,
  structuralBaseline,
} from "../src/services/agents/quality-baseline";
import {
  LOGO_SAFE_MARGIN,
  logoVariants,
} from "../src/services/site-media.service";

const BROKEN =
  "Specify the VG- for commercial espresso grinding: mm flat burrs in titanium alloy, a matte-black housing, 10-unit MOQ and -day lead time.";
const INTACT =
  "Request a specification quote with your burr and pairing requirements.";
const PRODUCT_ID = "a".repeat(24);

const block = (o: Record<string, unknown>) => ({
  heading: "Section",
  body: "",
  table: null,
  faq: [],
  assetId: null,
  alt: "",
  refs: [],
  ...o,
});
const item = (title: string, body: string, href: string | null = null) => ({
  title,
  body,
  assetId: null,
  alt: "",
  href,
  refs: [],
});
const specs = (rows: string[][]) =>
  block({
    key: "specs",
    type: "specs",
    heading: "Specifications",
    table: {
      columns: ["Specification", "Confirmed details", "Buying note"],
      rows,
    },
  });
const product = (o: Record<string, unknown>) => ({
  id: "vg-83",
  nodeKey: "vg-83",
  type: "product",
  productId: PRODUCT_ID,
  path: "/espresso/vg-83",
  title: "VG-83 Precision Flat-Burr Commercial Grinder | Verona Brewtech",
  metaDescription: "Commercial flat-burr grinder for espresso bars.",
  refs: [],
  blocks: [],
  ...o,
});
function snapshot(pages: any[], options: { pack?: boolean; home?: any[] } = {}) {
  const composition = {
    version: "v1",
    typography: "technical",
    palette: "obsidian",
    navigation: "catalogue",
    productLayout: "cards",
    ...(options.pack ? { pack: "precision" } : {}),
  };
  return {
    site: {
      id: "site",
      name: "Verona Brewtech",
      templateId: "adaptive",
      language: "en",
      brandColor: "#14110f",
      productIds: [PRODUCT_ID],
      buyerProfile: { audiences: ["Café groups"], primaryAction: "quote" },
      designDirection: { composition },
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
          headline: "Choose the right espresso setup",
          summary: "Compare machines and grinders, then request a quote.",
          primaryActionLabel: "Request a quote",
          primaryActionTarget: "inquiry",
          visualStyle: "industrial",
          heroLayout: "split",
          designNotes: "",
          composition,
        },
        blocks: options.home ?? [],
      },
      ...pages,
    ],
    products: [],
    facts: [],
    assets: {},
    settings: { canonicalBaseUrl: "https://fixture.invalid" },
    createdAt: "fixture",
    inquiry: { enabled: false },
  } as Snapshot;
}

test("cut-out figures are detected and only whole intact sentences remain", () => {
  for (const t of [
    BROKEN,
    "Specify the VG- for cafés.",
    "Burrs: mm flat burrs.",
    "Ships with a -day lead time.",
    "Pressure up to bar.",
  ])
    assert.equal(hasBrokenFragment(t), true, t);
  for (const t of [
    INTACT,
    "VG-83 grinder with 83 mm flat burrs.",
    "A 14-day lead time and 10-unit MOQ.",
    "Sizes are listed in mm.",
    "Burr size (mm)",
    "EU- and US-made parts.",
    "Dual-boiler machine with a matte-black housing.",
    "10% faster warm-up.",
  ])
    assert.equal(hasBrokenFragment(t), false, t);
  assert.equal(intactSentences(BROKEN + " " + INTACT), INTACT);
  assert.equal(intactSentences(BROKEN), "");
  const clean = "Commercial grinder.\nMatte housing.";
  assert.equal(intactSentences(clean), clean);
});

test("product cards drop broken sentences and fall back without half-words", () => {
  const render = (presentation: Record<string, unknown>, meta?: string) => {
    const s = snapshot([
      product({
        presentation: { navigationLabel: "VG-83 Grinder", ...presentation },
        ...(meta !== undefined ? { metaDescription: meta } : {}),
      }),
    ]);
    return productCards(s, s.pages[0]);
  };
  const mixed = render({ summary: BROKEN + " " + INTACT });
  assert.match(mixed, new RegExp("</h3><p>" + INTACT + "</p>"));
  assert.doesNotMatch(mixed, /VG- for|-day lead| mm flat burrs/);
  const fallback = render({ summary: BROKEN });
  assert.match(fallback, /<p>Commercial flat-burr grinder for espresso bars\.<\/p>/);
  const none = render({ summary: BROKEN }, "Pair the VG- with your machine.");
  assert.doesNotMatch(none, /<\/h3><p>/);
  assert.doesNotMatch(none, /VG- /);
  // Intact summaries and pages without a summary are unchanged.
  assert.equal(cardSummary({ presentation: { summary: INTACT } }), INTACT);
  assert.equal(cardSummary({ metaDescription: INTACT }), "");
  // The product page hero lead uses the same rule.
  const s = snapshot([
    product({
      presentation: {
        navigationLabel: "VG-83 Grinder",
        headline: "VG-83 grinder",
        summary: BROKEN + " " + INTACT,
        primaryActionLabel: "Request a quote",
      },
    }),
  ]);
  const page = renderStaticPage(s, s.pages[1]);
  assert.match(page, new RegExp('<p class="hero-lead">' + INTACT + "</p>"));
  assert.doesNotMatch(page, /VG- for/);
});

test("card specs skip notes, placeholders and rows repeating the title", () => {
  const vb3g = product({
    id: "vb-3g",
    path: "/espresso/vb-3g",
    title: "VB-3G Flagship Multi-Boiler Espresso Machine",
    presentation: {
      navigationLabel: "VB-3G Flagship",
      summary: "Multi-boiler espresso machine for high-volume cafés.",
    },
    blocks: [
      specs([
        [
          "Model",
          "VB-3G Flagship Multi-Boiler Espresso Machine",
          "Confirm exact model code and configuration on the quote.",
        ],
        [
          "Boiler architecture",
          "Multi-boiler",
          "Review against your required grouphead and service pattern.",
        ],
        ["Groupheads", "3 groupheads", ""],
      ]),
    ],
  });
  const plainSnapshot = snapshot([vb3g]);
  const plain = productCards(plainSnapshot, plainSnapshot.pages[0]);
  assert.doesNotMatch(plain, /Confirm exact model code|Review against your/);
  assert.doesNotMatch(plain, /<dt>Model<\/dt>/);
  assert.match(plain, /<dt>Boiler architecture<\/dt><dd>Multi-boiler<\/dd>/);
  assert.match(plain, /<dt>Groupheads<\/dt><dd>3 groupheads<\/dd>/);
  assert.ok(plain.indexOf("<dt>Boiler") < plain.indexOf("<dt>Groupheads"));
  // Rendering-pack pages show rows with figures first.
  const packSnapshot = snapshot([vb3g], { pack: true });
  const pack = productCards(packSnapshot, packSnapshot.pages[0]);
  assert.ok(pack.indexOf("<dt>Groupheads") < pack.indexOf("<dt>Boiler"));
  assert.equal(cardSpecs(vb3g, ["VB-3G Flagship"]).length, 2);

  const onlyNotes = product({
    presentation: { navigationLabel: "VG-83 Grinder", summary: INTACT },
    blocks: [
      specs([
        ["Material", SAFE_PLACEHOLDER],
        ["Model", "VG-83 Precision Grinder"],
        ["Lead time", "Confirm on the quote."],
      ]),
    ],
  });
  const empty = snapshot([onlyNotes]);
  assert.doesNotMatch(productCards(empty, empty.pages[0]), /card-specs/);
  assert.equal(specNote("83 mm"), false);
  assert.equal(specNote("Confirmed"), false);
  assert.equal(specNote(SAFE_PLACEHOLDER), true);
  assert.equal(specNote("Specify on the quote"), true);
});

test("draft repair removes cut-out sentences only and keeps the original otherwise", () => {
  const page = {
    title: "Grinder for espresso bars",
    metaDescription: "Commercial grinder.",
    refs: [],
    presentation: {
      navigationLabel: "Grinder",
      headline: "Grind for every shift",
      summary: BROKEN + " " + INTACT,
      primaryActionLabel: "Request a quote",
      visualStyle: "industrial",
      heroLayout: "split",
      designNotes: "",
    },
    blocks: [
      block({
        key: "overview",
        type: "text",
        heading: "Overview",
        body: INTACT + " Specify the VG- for cafés.",
      }),
    ],
  } as PageInput;
  const context = { type: "home", productIds: [], language: "en" };
  const out = repairBrokenFragments(page, [], context);
  assert.equal(out.presentation!.summary, INTACT);
  assert.equal(out.blocks[0].body, INTACT);
  assert.equal(page.presentation!.summary, BROKEN + " " + INTACT);
  const clean = structuredClone(out);
  assert.equal(repairBrokenFragments(clean, [], context), clean);

  const detail = {
    ...structuredClone(page),
    blocks: [
      block({
        key: "material",
        type: "text",
        heading: "Material",
        body: "Burrs: mm titanium alloy.",
      }),
    ],
  } as PageInput;
  const repaired = repairBrokenFragments(detail, [], {
    type: "product",
    productId: PRODUCT_ID,
    productIds: [PRODUCT_ID],
    language: "en",
    requiredProductSections: ["material"],
  });
  assert.equal(repaired.blocks[0].body, SAFE_PLACEHOLDER);
});

test("review counts rendered images, including labelled illustrations", () => {
  const metrics = [
    { width: 375, brokenImages: 0, images: 8, conceptImages: 3 },
    {
      width: 1440,
      brokenImages: 0,
      images: 8,
      conceptImages: 3,
      sections: [{ id: "", images: 1, broken: 0, concepts: 0, words: 30, height: 700 }],
    },
  ];
  assert.deepEqual(imageAvailability(metrics), {
    rendered: 8,
    broken: 0,
    illustrative: 3,
  });
  assert.equal(imageAvailability([{ width: 1440, brokenImages: 0 }]), null);
  const findings = [
    {
      blockKey: "selection",
      code: "imagery",
      severity: "error",
      recommendation:
        "Three selection images are not in the product asset list and appear unavailable.",
    },
    {
      blockKey: null,
      code: "imagery",
      severity: "warning",
      recommendation: "Use a tighter crop on the pairing photograph.",
    },
    {
      blockKey: null,
      code: "layout",
      severity: "warning",
      recommendation: "Reduce the tall gallery on mobile.",
    },
  ];
  assert.deepEqual(
    reconcileImageFindings(findings, metrics).map((f) => f.recommendation),
    [findings[1].recommendation, findings[2].recommendation],
  );
  // A real loading failure, or an older capture, keeps every finding.
  assert.equal(
    reconcileImageFindings(findings, [{ ...metrics[1], brokenImages: 1 }]).length,
    3,
  );
  assert.equal(
    reconcileImageFindings(findings, [{ width: 1440, brokenImages: 0 }]).length,
    3,
  );
  const page = {
    title: "Espresso equipment",
    metaDescription: "Commercial espresso machines",
    presentation: {
      navigationLabel: "Home",
      headline: "Every shot. Every shift.",
      summary: "Commercial espresso machines for busy cafés.",
      primaryActionLabel: "Request a quote",
      visualStyle: "industrial",
      heroLayout: "panorama",
      designNotes: "",
    },
    refs: [],
    blocks: [block({ key: "range", type: "product-grid" })],
  } as PageInput;
  const base = structuralBaseline(page, metrics, "home");
  assert.equal(base.signals.heroImage, true);
  assert.equal(base.signals.heroIllustrative, false);
  assert.deepEqual(base.signals.images, { rendered: 8, broken: 0, illustrative: 3 });
  const concept = structuralBaseline(
    page,
    [{ ...metrics[1], sections: [{ images: 1, broken: 0, concepts: 1 }] }],
    "home",
  );
  assert.equal(concept.signals.heroImage, true);
  assert.equal(concept.signals.heroIllustrative, true);
  const broken = structuralBaseline(
    page,
    [{ ...metrics[1], brokenImages: 1, sections: [{ images: 1, broken: 1 }] }],
    "home",
  );
  assert.equal(broken.signals.heroImage, false);
  const reviewer = fs.readFileSync(
    path.resolve(__dirname, "../builder/review.mjs"),
    "utf8",
  );
  assert.match(reviewer, /conceptImages: document\.querySelectorAll\("\.concept-note"\)/);
});

test("a closing CTA to the inquiry section is not rendered twice", () => {
  const features = block({
    key: "selection",
    type: "features",
    heading: "What decides the shortlist",
    items: [item("Service pattern", "Match groupheads to the service peak.")],
  });
  const cta = (href: string | null) =>
    block({
      key: "next",
      type: "cta",
      heading: "Request a specification quote",
      body: "Send the models you are comparing.",
      items: [item("Discuss your requirements", "", href)],
    });
  const render = (blocks: any[]) => {
    const s = snapshot([], { home: blocks });
    return renderStaticPage(s, s.pages[0]);
  };
  const deduped = render([features, cta("#inquiry")]);
  assert.doesNotMatch(deduped, /class="cta-band"/);
  assert.doesNotMatch(deduped, /Request a specification quote/);
  assert.match(deduped, /id="inquiry"/);
  assert.match(deduped, /id="block-selection"/);
  assert.doesNotMatch(render([features, cta(null)]), /class="cta-band"/);
  assert.doesNotMatch(render([features, cta("/#inquiry")]), /class="cta-band"/);
  // Other destinations, or a CTA that is not the closing section, stay.
  assert.match(render([features, cta("/espresso")]), /class="cta-band"/);
  assert.match(render([cta("#inquiry"), features]), /class="cta-band"/);
  const guidance = fs.readFileSync(
    path.resolve(__dirname, "../agent-skills/brand-site.md"),
    "utf8",
  );
  assert.match(
    guidance,
    /never put a cta block with the same quote\/inquiry purpose directly before it/,
  );
  assert.ok(Buffer.byteLength(guidance) <= 15000);
});

async function opaqueBox(png: Buffer) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width,
    minY = info.height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * info.channels + 3] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  return { minX, minY, maxX, maxY, width: info.width, height: info.height };
}

test("AI logo variants keep a transparent safe margin on every side", async () => {
  // Lettering that runs into the right edge of the generated image.
  const src = await sharp({
    create: { width: 400, height: 160, channels: 3, background: "#ffffff" },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 360, height: 60, channels: 3, background: "#14110f" },
        })
          .png()
          .toBuffer(),
        left: 40,
        top: 50,
      },
    ])
    .png()
    .toBuffer();
  const { square, wide } = await logoVariants(src);
  assert.ok(LOGO_SAFE_MARGIN >= 0.08 && LOGO_SAFE_MARGIN <= 0.12);
  for (const [buf, w, h] of [
    [square, 512, 512],
    [wide, 960, 320],
  ] as const) {
    const box = await opaqueBox(buf);
    assert.equal(box.width, w);
    assert.equal(box.height, h);
    const mx = Math.floor(w * 0.08),
      my = Math.floor(h * 0.08);
    assert.ok(box.maxX >= 0, "logo content is present");
    assert.ok(box.minX >= mx && w - 1 - box.maxX >= mx, "horizontal margin");
    assert.ok(box.minY >= my && h - 1 - box.maxY >= my, "vertical margin");
  }
  // The trimmed mark still fills the inner width of the wide variant.
  const wideBox = await opaqueBox(wide);
  assert.ok(wideBox.maxX - wideBox.minX + 1 >= 700);
});

const vb3gTable = (rows: string[][]) =>
  block({
    key: "specs",
    type: "specs",
    heading: "Specifications",
    table: { columns: ["Specification", "Details", "Buyer notes"], rows },
  });
const vb3g = (rows: string[][]) =>
  product({
    id: "vb-3g",
    path: "/espresso/vb-3g",
    title: "VB-3G Flagship Multi-Boiler Espresso Machine | Verona Brewtech",
    presentation: {
      navigationLabel: "VB-3G Flagship",
      headline: "VB-3G Flagship",
      summary: "Multi-boiler espresso machine for high-volume cafés.",
      primaryActionLabel: "Request a quote",
    },
    blocks: [vb3gTable(rows)],
  });
const VB3G_ROWS = [
  [
    "Model",
    "VB-3G Flagship Multi-Boiler Espresso Machine",
    "Confirm exact model code and configuration on the quote.",
  ],
  [
    "Groupheads",
    "3 independent groupheads",
    "Map the three-grouphead layout to your service peak.",
  ],
  ["Boiler architecture", "Multi-boiler", "Match boiler capacity to your menu."],
  ["Finish", "Matte black", ""],
];

test("cards show only the spec value column; detail tables drop buying notes and the repeated model row", () => {
  const s = snapshot([vb3g(VB3G_ROWS)]);
  const cards = productCards(s, s.pages[0]);
  assert.match(cards, /<dt>Groupheads<\/dt><dd>3 independent groupheads<\/dd>/);
  assert.doesNotMatch(cards, /Map the three-grouphead|Match boiler| · /);
  assert.doesNotMatch(cards, /<dt>Model<\/dt>/);

  const detail = renderStaticPage(s, s.pages[1]);
  const table = detail.slice(detail.indexOf("<table"), detail.indexOf("</table>"));
  assert.match(table, /<th scope="col">Specification<\/th><th scope="col">Details<\/th><\/tr>/);
  assert.doesNotMatch(table, /Buyer notes|Confirm exact model code|Map the three|Match boiler/);
  assert.doesNotMatch(table, /<td>Model<\/td>/);
  assert.match(table, /<tr><td>Groupheads<\/td><td>3 independent groupheads<\/td><\/tr>/);
  assert.match(table, /<tr><td>Finish<\/td><td>Matte black<\/td><\/tr>/);
  assert.doesNotMatch(detail, /Confirm exact model code and configuration on the quote/);
  assert.match(detail, /href="#block-specs"/);

  // The catalogue applies the same public table.
  const catalogue = catalogueHtml(s);
  assert.doesNotMatch(catalogue, /Confirm exact model code|Map the three|<td>Model<\/td>/);
  assert.match(catalogue, /<td>Groupheads<\/td><td>3 independent groupheads<\/td>/);

  // A single note cell in a value column renders empty, not as text.
  const mixed = publicTable({
    columns: ["Specification", "Details"],
    rows: [
      ["Groupheads", "3 groupheads"],
      ["Lead time", "Confirm lead time on the quote."],
      ["Boiler", "Multi-boiler"],
    ],
  });
  assert.deepEqual(mixed.rows, [
    ["Groupheads", "3 groupheads"],
    ["Boiler", "Multi-boiler"],
  ]);
  const blanked = publicTable({
    columns: ["Specification", "EU", "US"],
    rows: [
      ["Voltage", "230 V", "Confirm the US voltage on the quote."],
      ["Boiler", "Multi-boiler", "Multi-boiler"],
    ],
  });
  assert.deepEqual(blanked.rows[0], ["Voltage", "230 V", ""]);
});

test("comparison tables drop note columns and never render empty", () => {
  const s = snapshot([vb3g(VB3G_ROWS)]);
  const comparison = (table: unknown) =>
    renderB2BBlock(
      s,
      s.pages[0],
      block({ key: "compare", type: "comparison", heading: "Compare models", table }),
    );
  const html = comparison({
    columns: ["Model", "Groupheads", "Planning notes"],
    rows: [
      ["VB-2G", "2", "Plan two barista stations per shift."],
      ["VB-3G", "3", "Plan three barista stations per shift."],
    ],
  })!;
  assert.doesNotMatch(html, /Planning notes|Plan two barista/);
  assert.match(html, /<tr><td>VB-3G<\/td><td>3<\/td><\/tr>/);
  assert.equal(
    comparison({
      columns: ["Model", "Buyer guidance"],
      rows: [["VB-3G", "Share your service peak with the quote request."]],
    }),
    "",
  );
});

test("a spec table with only notes or placeholders falls back to the information-request summary", () => {
  const rows = [
    ["Model", "VB-3G Flagship Multi-Boiler Espresso Machine", ""],
    ["Lead time", "Confirm lead time and freight on the quote.", ""],
    ["Material", SAFE_PLACEHOLDER, "Specify the finish you need for your cafe."],
  ];
  const s = snapshot([vb3g(rows)]);
  const html = renderStaticPage(s, s.pages[1]);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /class="section information-request"/);
  assert.match(html, /<li id="block-specs">Specifications<\/li>/);
  assert.doesNotMatch(html, /href="#block-specs"/);
  assert.doesNotMatch(html, /Confirm lead time|Specify the finish/);
  assert.doesNotMatch(productCards(s, s.pages[0]), /card-specs/);
  assert.deepEqual(
    publicTable(
      { columns: ["Specification", "Details", "Buyer notes"], rows },
      ["VB-3G Flagship"],
    ).rows,
    [],
  );
});

test("ordinary spec values are not mistaken for buying notes", () => {
  for (const value of [
    "Matte black",
    "Plan view 600 mm",
    "Use with 220 V supply",
    "Selectable pre-infusion",
    "Confirmed",
    "Map light",
    "83 mm",
  ]) {
    assert.equal(specNote(value), false, value);
    assert.equal(instructionNote(value), false, value);
  }
  for (const value of [
    "Map the three-grouphead layout to your service peak.",
    "Plan the water line before installation.",
    "Choose the voltage for your market.",
    "Include your expected daily cups in the request.",
  ])
    assert.equal(instructionNote(value), true, value);
  const kept = publicTable({
    columns: ["Specification", "Details"],
    rows: [
      ["Finish", "Matte black"],
      ["Footprint", "Plan view 600 mm"],
    ],
  });
  assert.equal(kept.rows.length, 2);
  // A heading alone never removes the only value column.
  assert.equal(
    publicTable({ columns: ["Spec", "Buyer requirement"], rows: [["Finish", "Matte black"]] })
      .rows.length,
    1,
  );
  // Cards keep reading the first value column of legacy two-column tables.
  assert.deepEqual(
    cardSpecs(
      { blocks: [block({ type: "specs", table: { columns: ["Spec", "Value"], rows: [["Finish", "Matte black"]] } })] },
      [],
    ),
    [{ label: "Finish", value: "Matte black" }],
  );
});

test("unknown AI outcomes carry a fixed reason code and never model text", async () => {
  const named = (name: string, cause?: unknown) =>
    Object.assign(new Error("fixture"), { name, ...(cause ? { cause } : {}) });
  assert.equal(classifyUsageUnknown(named("TimeoutError")), "timeout");
  assert.equal(
    classifyUsageUnknown(named("AbortError", named("TimeoutError"))),
    "timeout",
  );
  assert.equal(classifyUsageUnknown(new TypeError("fetch failed")), "network");
  assert.equal(classifyUsageUnknown(new SyntaxError("Unexpected end")), "parse");
  assert.equal(classifyUsageUnknown(new Error("write conflict"), "persist"), "persist");
  assert.equal(
    classifyUsageUnknown(new AiUsageUnknownError("usage_over_budget"), "persist"),
    "usage_over_budget",
  );
  const error = usageUnknown(new TypeError("socket hang up"));
  assert.equal(error.code, "AI_USAGE_UNKNOWN");
  assert.equal(error.status, 502);
  assert.equal(error.reason, "network");
  assert.equal(error.message, "AI_USAGE_UNKNOWN");
  await assert.rejects(
    () => readCappedBody(new Response("x".repeat(64)).body!, 16),
    (e: unknown) => e instanceof AiUsageUnknownError && e.reason === "body_too_large",
  );
  assert.equal(
    (await readCappedBody(new Response("{}").body!, 16)).toString("utf8"),
    "{}",
  );
  assert.throws(
    () => parseProviderJson(Buffer.from('{"choices":[')),
    (e: unknown) => e instanceof AiUsageUnknownError && e.reason === "parse",
  );
  assert.throws(
    () => providerTokens({ choices: [] }, 100),
    (e: unknown) => e instanceof AiUsageUnknownError && e.reason === "usage_missing",
  );
  assert.throws(
    () => providerTokens({ usage: { total_tokens: 101 } }, 100),
    (e: unknown) =>
      e instanceof AiUsageUnknownError && e.reason === "usage_over_budget",
  );
  assert.equal(providerTokens({ usage: { total_tokens: 42 } }, 100), 42);
});

test("full-page timeout and the monthly absorption limit are bounded settings", (t) => {
  // Defaults must not depend on a developer's local .env (dotenv-loaded).
  const saved = {
    timeout: process.env.AI_FULL_PAGE_TIMEOUT_MS,
    absorb: process.env.AI_UNKNOWN_ABSORB_LIMIT,
  };
  delete process.env.AI_FULL_PAGE_TIMEOUT_MS;
  delete process.env.AI_UNKNOWN_ABSORB_LIMIT;
  t.after(() => {
    if (saved.timeout !== undefined) process.env.AI_FULL_PAGE_TIMEOUT_MS = saved.timeout;
    if (saved.absorb !== undefined) process.env.AI_UNKNOWN_ABSORB_LIMIT = saved.absorb;
  });
  assert.equal(fullPageTimeoutMs(undefined), 240000);
  assert.equal(fullPageTimeoutMs(""), 240000);
  assert.equal(fullPageTimeoutMs("abc"), 240000);
  assert.equal(fullPageTimeoutMs("360000"), 360000);
  assert.equal(fullPageTimeoutMs("900000"), 600000);
  assert.equal(fullPageTimeoutMs("1000"), 120000);
  assert.equal(unknownAbsorbLimit(undefined), 5);
  assert.equal(unknownAbsorbLimit("0"), 0);
  assert.equal(unknownAbsorbLimit("-2"), 0);
  assert.equal(unknownAbsorbLimit("x"), 5);
  for (const file of [".env.example", "production.env.example", "compose.yaml"]) {
    const text = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    assert.match(text, /AI_FULL_PAGE_TIMEOUT_MS/, file);
    assert.match(text, /AI_UNKNOWN_ABSORB_LIMIT/, file);
  }
});
