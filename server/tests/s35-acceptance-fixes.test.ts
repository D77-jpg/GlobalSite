// S35 Verona acceptance fixes (no database): cut-out figures in card copy,
// card spec values, rendered-image availability in review, a closing CTA
// duplicating the inquiry section and the AI logo safe margin.
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
  productCards,
  specNote,
} from "../src/services/b2b-template.service";
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
