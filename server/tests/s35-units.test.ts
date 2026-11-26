// S35 stage B/C/D and B2 unit tests (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import * as v from "../src/validators/sites.validator";
import {
  normalizeNullableAxes,
  reviewOutput,
} from "../src/services/agents/validation";
import {
  applyImageSlots,
  autoImageCaps,
  fillUnitImages,
  planImageSlots,
} from "../src/services/agents/auto-images";
import {
  baselineReport,
  baselineThreshold,
  structuralBaseline,
} from "../src/services/agents/quality-baseline";
import { validatePage, isDemoFact } from "../src/services/page-validation.service";
import {
  decodeGeneratedImage,
  imageBrief,
} from "../src/services/image-studio.service";
import {
  acceptSuggestions,
  missingFactTypes,
  suggestionOriginKey,
} from "../src/services/fact-suggest.service";
import { logoVariants, logoSubject, defaultLogoDesign } from "../src/services/site-media.service";
import { wordmarkSvg, faviconSvg } from "../src/services/brand-mark.service";
import { renderStaticPage } from "../src/services/static-template.service";

const ID = (n: number) => String(n).padStart(24, "a");
const item = (title: string, assetId: string | null = null) => ({
  title,
  body: "Useful buyer guidance for this application.",
  assetId,
  alt: assetId ? "Existing photo" : "",
  href: null,
  refs: [],
});
const block = (o: Record<string, unknown>) => ({
  heading: "Section",
  body: "Plain buyer guidance.",
  table: null,
  faq: [],
  assetId: null,
  alt: "",
  refs: [],
  ...o,
});
const page = (blocks: unknown[]) =>
  ({
    title: "Espresso equipment",
    metaDescription: "Commercial espresso machines",
    presentation: {
      navigationLabel: "Home",
      headline: "Every shot. Every shift.",
      summary: "Commercial espresso machines for busy cafes.",
      primaryActionLabel: "Request a quote",
      visualStyle: "industrial",
      heroLayout: "panorama",
      designNotes: "",
    },
    refs: [],
    blocks,
  }) as v.PageInput;

test("null optional composition axes are normalized before zod parsing", () => {
  const raw = {
    label: "Primary",
    rationale: "Fits equipment buyers",
    page: {
      ...page([block({ key: "intro", type: "text" })]),
      presentation: {
        ...page([]).presentation,
        inquiryHeading: null,
        composition: {
          version: "v1",
          typography: "technical",
          palette: "obsidian",
          navigation: "catalogue",
          productLayout: "cards",
          pack: null,
          surface: null,
          headerStyle: null,
          radius: null,
        },
      },
    },
  };
  assert.equal(v.designPageOutput.safeParse(raw).success, false);
  const parsed = v.designPageOutput.parse(normalizeNullableAxes(raw));
  assert.equal(parsed.page.presentation?.composition?.pack, undefined);
  assert.ok(!("pack" in (parsed.page.presentation!.composition as object)));
  // A real value is kept.
  const kept = normalizeNullableAxes({
    page: { presentation: { composition: { pack: "precision" } } },
  }) as { page: { presentation: { composition: { pack: string } } } };
  assert.equal(kept.page.presentation.composition.pack, "precision");
  // Review scores may be null in strict json_schema mode.
  assert.ok(reviewOutput.safeParse({ summary: "s", findings: [], scores: null }).success);
});

test("illustration slots only target missing images, follow priority and caps", () => {
  const p = page([
    block({ key: "hero", type: "image", assetId: ID(1), alt: "Hero" }),
    block({ key: "pairing", type: "split", heading: "Recommended set" }),
    block({
      key: "scenes",
      type: "features",
      items: [item("Cafe", ID(2)), item("Hotel"), item("Office")],
    }),
    block({ key: "craft", type: "gallery", items: [item("Brazed boiler")] }),
  ]);
  const slots = planImageSlots(p, { siteName: "Verona", max: 3 });
  assert.deepEqual(
    slots.map((s) => s.key),
    ["split:pairing", "gallery:craft:0", "features:scenes:1"],
  );
  for (const s of slots) {
    assert.match(s.subject, /No people/);
    assert.match(s.subject, /no readable text/);
  }
  const filled = applyImageSlots(p, slots, {
    "split:pairing": ID(7),
    "gallery:craft:0": ID(8),
    "features:scenes:1": ID(9),
  });
  assert.equal(filled.blocks[0].assetId, ID(1));
  assert.equal(filled.blocks[1].assetId, ID(7));
  assert.equal(filled.blocks[2].items![0].assetId, ID(2));
  assert.equal(filled.blocks[2].items![0].alt, "Existing photo");
  assert.equal(filled.blocks[2].items![1].assetId, ID(9));
  assert.equal(filled.blocks[2].items![2].assetId, null);
  assert.equal(filled.blocks[3].items![0].assetId, ID(8));
  // Original page object is untouched.
  assert.equal(p.blocks[1].assetId, null);

  const noHero = page([block({ key: "intro", type: "text" })]);
  const heroSlots = planImageSlots(noHero, { siteName: "Verona", max: 6 });
  assert.equal(heroSlots[0].key, "hero");
  assert.equal(heroSlots[0].insertHero, true);
  const withHero = applyImageSlots(noHero, heroSlots, { hero: ID(5) });
  assert.equal(withHero.blocks[0].type, "image");
  assert.equal(withHero.blocks[0].assetId, ID(5));
  assert.equal(planImageSlots(noHero, { siteName: "V", max: 0 }).length, 0);

  const previous = process.env.AUTO_IMAGE_HOME_MAX;
  process.env.AUTO_IMAGE_HOME_MAX = "99";
  assert.equal(autoImageCaps().home, 12);
  delete process.env.AUTO_IMAGE_HOME_MAX;
  assert.deepEqual(autoImageCaps(), { home: 6, detail: 3 });
  if (previous !== undefined) process.env.AUTO_IMAGE_HOME_MAX = previous;
});

test("illustration fill is skipped without opt-in and never spends", async () => {
  let calls = 0;
  const generate = (async () => {
    calls++;
    return { id: ID(3) };
  }) as never;
  const result = { output: { page: page([block({ key: "s", type: "split" })]) }, tokens: 5 };
  const run = {
    _id: ID(4),
    step: "content",
    steps: [{ key: "home", node: { key: "home", path: "/", type: "home" } }],
    inputSnapshot: {
      site: { id: ID(5), name: "Verona", productIds: [], autoImages: false },
      facts: [],
      products: [],
    },
  } as never;
  const out = await fillUnitImages(run, 0, result, {} as never, generate);
  assert.equal(out, result);
  assert.equal(calls, 0);
});

test("quality baseline uses deterministic structural rules", () => {
  const thin = page([
    block({ key: "a", type: "features", items: [item("One")] }),
    block({ key: "b", type: "features", items: [item("Two")] }),
    block({ key: "c", type: "features", items: [item("Three")] }),
  ]);
  const metrics = [
    {
      width: 1440,
      words: 120,
      sections: [{ id: "hero", images: 0, words: 10, height: 600 }],
    },
  ];
  const weak = structuralBaseline(thin, metrics, "home");
  assert.equal(weak.signals.heroImage, false);
  assert.equal(weak.signals.repeatedNeighbours, 2);
  assert.equal(weak.signals.metricsBlock, false);
  assert.ok(weak.scores.rhythm <= 2);
  assert.equal(weak.scores.credibility, 1);
  const ref = [{ factId: ID(9), revision: 1 }];
  const strong = page([
    block({ key: "hero", type: "image", assetId: ID(1), alt: "Hero", tone: "dark" }),
    block({ key: "numbers", type: "metrics", refs: ref, items: [item("12000")], tone: "light" }),
    block({ key: "range", type: "product-grid", tone: "dark" }),
    block({ key: "story", type: "case-study", refs: ref, items: [item("Cafe group")], tone: "light" }),
    block({ key: "craft", type: "gallery", items: [item("Boiler", ID(2))], tone: "dark" }),
    block({ key: "next", type: "cta", tone: "light" }),
  ]);
  strong.presentation!.primaryActionTarget = "inquiry";
  const good = structuralBaseline(
    strong,
    [
      {
        width: 1440,
        words: 520,
        h1Height: 120,
        h1LineHeight: 60,
        sections: [{ id: "hero", images: 1, words: 40, height: 700 }],
      },
    ],
    "home",
  );
  assert.equal(good.signals.h1Lines, 2);
  assert.equal(good.scores.firstImpression, 5);
  assert.equal(good.scores.credibility, 5);
  assert.equal(good.scores.conversion, 5);
  assert.equal(good.scores.rhythm, 5);

  // Model scores are ignored unless screenshots were actually sent.
  const scores = { firstImpression: 5, rhythm: 5, density: 5, credibility: 5, conversion: 5 };
  const structural = baselineReport(thin, metrics, "home", {
    visualInput: false,
    modelScores: scores,
    threshold: 3.5,
  });
  assert.equal(structural.method, "structural");
  assert.equal(structural.visual, null);
  assert.equal(structural.belowThreshold, true);
  assert.ok(structural.improvements.some((i) => i.code === "BASELINE_CREDIBILITY"));
  const visual = baselineReport(thin, metrics, "home", {
    visualInput: true,
    modelScores: scores,
    threshold: 3.5,
  });
  assert.equal(visual.method, "structural+visual");
  assert.ok(visual.total > structural.total);
  assert.equal(baselineThreshold("9"), 3.5);
  assert.equal(baselineThreshold("4"), 4);
});

test("demo facts are citable only in demo mode and keep their candidate status", () => {
  const fact = {
    id: ID(6),
    subjectType: "organization",
    type: "company.capacity",
    value: "12000",
    unit: "units",
    status: "candidate",
    revision: 1,
    source: { kind: "ai-suggested", runId: ID(7) },
  };
  const p = page([
    block({
      key: "output",
      type: "text",
      body: "Annual output reaches 12000 units.",
      refs: [{ factId: ID(6), revision: 1 }],
    }),
  ]);
  const ctx = { type: "home", productIds: [], language: "en" };
  assert.ok(isDemoFact(fact));
  assert.ok(
    validatePage(p, [fact], ctx).some((i) => i.code === "FACT_REFERENCE_STALE"),
  );
  assert.deepEqual(validatePage(p, [fact], { ...ctx, allowDemoFacts: true }), []);
  assert.equal(fact.status, "candidate");
  // Other gates still apply in demo mode.
  const unsupported = page([
    block({ key: "x", type: "text", body: "ISO 9001 certified since 1998." }),
  ]);
  const issues = validatePage(unsupported, [fact], { ...ctx, allowDemoFacts: true });
  assert.ok(issues.some((i) => i.code === "UNSOURCED_CERTIFICATION"));
  // S37 §1.1: manual candidates are also citable in demo mode (still blocked
  // from approval and publishing), and rejected once demo mode is off.
  const manual = { ...fact, source: { kind: "manual" } };
  assert.deepEqual(
    validatePage(p, [manual], { ...ctx, allowDemoFacts: true }),
    [],
  );
  assert.ok(
    validatePage(p, [manual], ctx).some(
      (i) => i.code === "FACT_REFERENCE_STALE",
    ),
  );
  const rejected = { ...fact, status: "rejected" };
  assert.ok(
    validatePage(p, [rejected], { ...ctx, allowDemoFacts: true }).some(
      (i) => i.code === "FACT_REFERENCE_STALE",
    ),
  );
});

test("image responses: b64, guarded HTTPS URLs only, logo composition accepted", async () => {
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  let fetched = "";
  const fetcher = async (url: string) => {
    fetched = url;
    return png;
  };
  const viaUrl = await decodeGeneratedImage(
    Response.json({ data: [{ url: "https://cdn.images.example.com/a.png" }] }),
    fetcher,
  );
  assert.equal(viaUrl.mime, "image/png");
  assert.equal(fetched, "https://cdn.images.example.com/a.png");
  const viaChat = await decodeGeneratedImage(
    Response.json({
      choices: [{ message: { content: "![x](https://cdn.images.example.com/b.png)" } }],
    }),
    fetcher,
  );
  assert.deepEqual(viaChat.bytes, png);
  await assert.rejects(
    decodeGeneratedImage(
      Response.json({ data: [{ url: "https://cdn.images.example.com/a.png" }] }),
    ),
    /IMAGE_RESPONSE_INVALID/,
  );
  const { downloadGeneratedImage } = await import(
    "../src/services/image-studio.service"
  );
  await assert.rejects(
    downloadGeneratedImage("http://cdn.images.example.com/a.png"),
    /IMAGE_RESPONSE_INVALID/,
  );
  assert.ok(imageBrief.safeParse({ subject: "Logo for Verona", composition: "logo" }).success);
});

test("AI fact suggestions keep only requested missing slots and dedupe", () => {
  const product = ID(1);
  const missing = missingFactTypes([product], [
    { type: "company.capacity", subjectId: null, status: "confirmed" },
    { type: "product.warranty", subjectId: product, status: "candidate" },
    { type: "company.founded", subjectId: null, status: "rejected" },
  ]);
  assert.ok(!missing.some((m) => m.type === "company.capacity"));
  assert.ok(!missing.some((m) => m.type === "product.warranty"));
  assert.ok(missing.some((m) => m.type === "company.founded"));
  const accepted = acceptSuggestions(
    [
      { type: "company.founded", subjectId: null, value: "2009" },
      { type: "company.founded", subjectId: null, value: "2011" },
      { type: "company.capacity", subjectId: null, value: "9000" },
      { type: "company.certifications", subjectId: null, value: "ISO 9001" },
      { type: "company.customers", subjectId: null, value: "see https://x.example.com" },
      { type: "product.moq", subjectId: product, value: "20", unit: "units" },
    ],
    missing,
  );
  assert.deepEqual(
    accepted.map((a) => a.type + ":" + a.value),
    ["company.founded:2009", "product.moq:20"],
  );
  const a = suggestionOriginKey(ID(2), accepted[0]);
  assert.equal(a, suggestionOriginKey(ID(2), { ...accepted[0] }));
  assert.notEqual(a, suggestionOriginKey(ID(2), { ...accepted[0], value: "2010" }));
});

test("logo variants, brief and deterministic wordmark", async () => {
  const src = await sharp({
    create: { width: 300, height: 120, channels: 3, background: "#ffffff" },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 100, height: 40, channels: 3, background: "#14110f" },
        })
          .png()
          .toBuffer(),
        left: 100,
        top: 40,
      },
    ])
    .png()
    .toBuffer();
  const { square, wide } = await logoVariants(src);
  const sq = await sharp(square).metadata();
  const wd = await sharp(wide).metadata();
  assert.equal(sq.width, 512);
  assert.equal(sq.height, 512);
  assert.equal(wd.width, 960);
  assert.equal(wd.height, 320);
  const design = defaultLogoDesign({
    name: "Verona Coffee",
    designDirection: { composition: { palette: "obsidian", pack: "precision" } },
  });
  assert.equal(design.name, "Verona Coffee");
  assert.ok(v.logoDesign.safeParse(design).success);
  assert.match(logoSubject(design, 0), /Exact spelling: V e r o n a/);
  assert.match(logoSubject(design, 0), /no photorealistic people/);
  const svg = wordmarkSvg('Verona <script>"x"');
  assert.match(svg, /aria-label="Verona &lt;script&gt;&quot;x&quot;"/);
  assert.ok(!svg.includes("<script>"));
  assert.match(faviconSvg("#123456"), /fill="#123456"/);
  assert.match(faviconSvg('red"/><script>'), /fill="#49694c"/);
});

test("header uses the wordmark, a selected logo, favicon and the illustrative label", () => {
  const base = page([block({ key: "intro", type: "text" })]);
  const snapshot = (extra: Record<string, unknown> = {}) => ({
    site: { name: "Verona", templateId: "machinery", language: "en", ...extra },
    pages: [{ ...base, type: "home", path: "/" }],
    products: [],
    facts: [],
    assets: {
      [ID(1)]: { path: "/assets/logo.webp", width: 200, height: 60 },
      [ID(2)]: { path: "/assets/hero.webp", width: 1600, height: 900, concept: true },
    },
    settings: { canonicalBaseUrl: "https://fixture.invalid" },
    createdAt: "fixture",
  });
  const plain = renderStaticPage(snapshot(), snapshot().pages[0]);
  assert.match(plain, /class="brand-wordmark"[^>]*aria-label="Verona"/);
  assert.doesNotMatch(plain, /brand-mark/);
  assert.match(plain, /rel="icon" href="\/favicon.svg"/);
  const logo = renderStaticPage(snapshot({ logoId: ID(1) }), snapshot().pages[0]);
  assert.match(logo, /src="\/assets\/logo.webp"/);
  assert.match(logo, /rel="icon" href="\/assets\/logo.webp"/);
  const hero = { ...base, blocks: [block({ key: "h", type: "image", assetId: ID(2), alt: "Cafe" }), ...base.blocks] };
  const s = snapshot();
  const withConcept = renderStaticPage({ ...s, pages: [{ ...hero, type: "home", path: "/" }] }, { ...hero, type: "home", path: "/" });
  assert.match(withConcept, /class="concept-note">Illustrative</);
});

test("hero fallback uses snapshot assets only for pack pages and keeps existing heroes", () => {
  const composition = {
    version: "v1" as const,
    typography: "technical" as const,
    palette: "obsidian" as const,
    navigation: "catalogue" as const,
    productLayout: "cards" as const,
  };
  const make = (pack?: "precision", heroAsset?: string) => {
    const p = page([
      ...(heroAsset ? [block({ key: "hero", type: "image", assetId: heroAsset, alt: "Hero" })] : []),
      block({ key: "pair", type: "split", assetId: ID(3), alt: "Pairing" }),
    ]);
    p.presentation!.composition = { ...composition, ...(pack ? { pack } : {}) };
    const home = { ...p, type: "home", path: "/" };
    return renderStaticPage(
      {
        site: { name: "Verona", templateId: "adaptive", buyerProfile: {} },
        pages: [home],
        products: [],
        facts: [],
        assets: {
          [ID(3)]: { path: "/assets/pair.webp", width: 800, height: 600 },
          [ID(4)]: { path: "/assets/hero.webp", width: 800, height: 600 },
        },
        settings: { canonicalBaseUrl: "https://fixture.invalid" },
        createdAt: "fixture",
      },
      home,
    );
  };
  const hero = (html: string) =>
    /<figure class="hero-visual"><img src="([^"]+)"/.exec(html)?.[1] ?? null;
  assert.equal(hero(make()), null);
  assert.equal(hero(make("precision")), "/assets/pair.webp");
  assert.equal(hero(make("precision", ID(4))), "/assets/hero.webp");
  assert.equal(hero(make(undefined, ID(4))), "/assets/hero.webp");
});

test("AI fact suggestions tolerate real model envelopes without inventing values", async () => {
  const { parseSuggestionContent } = await import("../src/services/fact-suggest.service");
  const think =
    '<think>planning</think>\n```json\n{"suggestions":[{"type":"company.capacity","subjectId":"","value":12000,"unit":"units per year","confidence":"high"},{"type":"company.warranty","value":""}]}\n```';
  const r = parseSuggestionContent(think, "stop");
  assert.deepEqual(r.items, [
    { type: "company.capacity", subjectId: null, value: "12000", unit: "units per year" },
  ]);
  assert.equal(r.invalidItems, 1);
  assert.equal(r.invalidReason, undefined);
  assert.deepEqual(parseSuggestionContent('[{"type":"product.moq","subjectId":"abc","value":"10"}]').items, [
    { type: "product.moq", subjectId: "abc", value: "10" },
  ]);
  assert.equal(parseSuggestionContent('{"facts":[{"type":"company.capacity"', "length").invalidReason, "truncated");
  assert.equal(parseSuggestionContent("no json here").invalidReason, "non_json");
  assert.equal(parseSuggestionContent('{"answer":"none"}').invalidReason, "shape");
  assert.equal(parseSuggestionContent('{"facts":[]}').invalidReason, undefined);
});
