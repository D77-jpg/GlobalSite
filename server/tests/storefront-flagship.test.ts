import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { validatePage } from "../src/services/page-validation.service";
import { renderStaticPage } from "../src/services/static-template.service";
import { buildStatic, outputChecks } from "../src/services/static-builder.service";
import { siteInput, brandChannels } from "../src/validators/sites.validator";
import { getStorefrontCopy } from "../src/services/storefront-i18n.service";

const oid = (n: number) => n.toString(16).padStart(24, "0");

test("multi-language site validator and localized storefront copy support all 8 languages including RTL Arabic", () => {
  for (const lang of ["en", "es", "fr", "de", "ja", "ar", "ru", "zh"] as const) {
    const parsed = siteInput.safeParse({
      name: "Velaturo Global",
      templateId: "adaptive",
      targetMarkets: ["Germany"],
      language: lang,
      brandColor: "#142d59",
      logoId: null,
      productIds: [],
    });
    assert.equal(parsed.success, true, `language ${lang} should be accepted`);
    const copy = getStorefrontCopy(lang);
    assert.equal(copy.lang, lang);
    assert.equal(copy.dir, lang === "ar" ? "rtl" : "ltr");
    assert.ok(copy.requestQuote.length > 0);
    assert.ok(copy.blockKickers.gallery.length > 0);
    assert.ok(copy.blockKickers.metrics.length > 0);
    assert.ok(copy.blockKickers.certifications.length > 0);
    assert.ok(copy.blockKickers.showcase.length > 0);
  }
  assert.equal(
    siteInput.safeParse({
      name: "Velaturo",
      templateId: "adaptive",
      targetMarkets: ["US"],
      language: "xx",
      brandColor: "#142d59",
      logoId: null,
      productIds: [],
    }).success,
    false,
  );
  assert.equal(
    brandChannels.safeParse({
      whatsapp: "+8613800138000",
      phone: "+86 571 8888 9999",
      email: "sales@example.com",
      wechat: "velaturo_b2b",
      linkedin: "https://www.linkedin.com/company/velaturo",
      youtube: "https://www.youtube.com/@velaturo",
    }).success,
    true,
  );
  for (const bad of [
    { whatsapp: "javascript:alert(1)" },
    { linkedin: "https://evil.example/company" },
    { youtube: "http://www.youtube.com/@insecure" },
  ]) {
    assert.equal(brandChannels.safeParse(bad).success, false);
  }
});

test("fact gate enforces language rules while keeping strict zero-hallucination verification on metrics and certifications", () => {
  const factYear = {
    _id: oid(1),
    subjectType: "organization",
    type: "company.founded",
    value: "2008",
    status: "confirmed",
    revision: 1,
  };
  const factIso = {
    _id: oid(2),
    subjectType: "organization",
    type: "company.certifications",
    value: "ISO 9001",
    status: "confirmed",
    revision: 1,
  };
  const basePage = {
    title: "Precision Optics Manufacturing",
    metaDescription: "Industrial optical components for OEM buyers.",
    refs: [],
    blocks: [
      {
        key: "metrics",
        type: "metrics" as const,
        heading: "Key figures",
        body: "",
        table: null,
        faq: [],
        assetId: null,
        alt: "",
        refs: [],
        items: [
          {
            title: "Founded 2008",
            body: "Manufacturing continuously since 2008.",
            assetId: null,
            alt: "",
            href: null,
            refs: [{ factId: oid(1), revision: 1 }],
          },
        ],
      },
      {
        key: "certs",
        type: "certifications" as const,
        heading: "Quality standards",
        body: "",
        table: null,
        faq: [],
        assetId: null,
        alt: "",
        refs: [],
        items: [
          {
            title: "ISO 9001",
            body: "Documented ISO 9001 quality management system.",
            assetId: null,
            alt: "",
            href: null,
            refs: [{ factId: oid(2), revision: 1 }],
          },
        ],
      },
    ],
  };

  // Backed by confirmed facts -> zero issues.
  assert.deepEqual(
    validatePage(basePage, [factYear, factIso], {
      productIds: [],
      type: "about",
      language: "en",
    }),
    [],
  );

  // Removing refs from metrics/certifications MUST trigger UNSOURCED_DETAIL.
  const unsourced = structuredClone(basePage);
  unsourced.blocks[0].items![0].refs = [];
  unsourced.blocks[1].items![0].refs = [];
  const issues = validatePage(unsourced, [factYear, factIso], {
    productIds: [],
    type: "about",
    language: "en",
  });
  assert.ok(issues.some((i) => i.code === "UNSOURCED_DETAIL" && i.blockKey === "metrics"));
  assert.ok(issues.some((i) => i.code === "UNSOURCED_DETAIL" && i.blockKey === "certs"));

  // Chinese / Japanese pages allow CJK copy when language matches, while English rejects Han script.
  const zhPage = {
    title: "精密光学制造",
    metaDescription: "面向工业客户的光学元件方案。",
    refs: [],
    blocks: [
      {
        key: "intro",
        type: "text" as const,
        heading: "关于我们",
        body: "我们为工业与自动化客户提供稳定的光学组件交付服务。",
        table: null,
        faq: [],
        assetId: null,
        alt: "",
        refs: [],
      },
    ],
  };
  assert.equal(
    validatePage(zhPage, [], { productIds: [], type: "about", language: "zh" }).length,
    0,
  );
  assert.ok(
    validatePage(zhPage, [], { productIds: [], type: "about", language: "en" }).some(
      (i) => i.code === "CONTENT_NOT_ENGLISH",
    ),
  );
});

test("flagship buildStatic renders gallery lightbox, metrics, certifications, showcase, RTL Arabic and brandChannels cleanly with zero HTML outputChecks issues", async () => {
  const img = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#23394d" },
  })
    .webp()
    .toBuffer();

  const snapshot: any = {
    site: {
      id: oid(10),
      name: "Atelier Nord",
      templateId: "adaptive",
      language: "ar",
      brandColor: "#142d59",
      logoId: null,
      buyerProfile: {
        businessModel: "manufacturer",
        audiences: ["Architectural specifiers"],
        buyerNeeds: ["Custom sizing"],
        primaryAction: "quote",
        referenceUrls: [],
      },
      brandChannels: {
        whatsapp: "+971501234567",
        phone: "+971 4 555 0199",
        email: "trade@example.com",
        wechat: "atelier_nord",
        linkedin: "https://www.linkedin.com/company/atelier-nord",
        youtube: "https://www.youtube.com/@atelier-nord",
      },
      designDirection: {
        visualStyle: "minimal",
        density: "comfortable",
        composition: {
          version: "v1",
          typography: "luxury",
          palette: "obsidian",
          navigation: "solutions",
          productLayout: "gallery",
          surface: "contrast",
          headerStyle: "editorial",
          radius: "subtle",
        },
      },
    },
    settings: { canonicalBaseUrl: "https://atelier.example.invalid" },
    facts: [
      {
        id: oid(1),
        subjectType: "organization",
        type: "company.name",
        value: "Atelier Nord LLC",
      },
    ],
    products: [],
    assets: {},
    createdAt: new Date().toISOString(),
    pages: [
      {
        path: "/",
        type: "home",
        title: "Atelier Nord",
        metaDescription: "Architectural lighting and metalwork for commercial interiors.",
        presentation: {
          navigationLabel: "الرئيسية",
          headline: "إضاءة معمارية للمشاريع التجارية",
          summary: "تصنيع حسب الطلب للمصممين والمطورين.",
          primaryActionLabel: "اطلب عرض سعر",
          visualStyle: "minimal",
          heroLayout: "editorial",
          designNotes: "Private editorial brief",
          primaryActionTarget: "inquiry",
        },
        refs: [],
        blocks: [
          {
            key: "hero-img",
            type: "image",
            heading: "",
            body: "",
            table: null,
            faq: [],
            assetId: oid(20),
            alt: "Showroom lighting installation",
            refs: [],
          },
          {
            key: "proof-metrics",
            type: "metrics",
            heading: "أرقام مؤكدة",
            body: "",
            table: null,
            faq: [],
            assetId: null,
            alt: "",
            refs: [{ factId: oid(1), revision: 1 }],
            items: [
              {
                title: "Atelier Nord LLC",
                body: "شركة مصنعة معتمدة",
                assetId: null,
                alt: "",
                href: null,
                refs: [{ factId: oid(1), revision: 1 }],
              },
            ],
          },
          {
            key: "project-gallery",
            type: "gallery",
            heading: "معرض الأعمال",
            body: "نماذج من التركيبات المعمارية.",
            table: null,
            faq: [],
            assetId: null,
            alt: "",
            refs: [],
            items: [
              {
                title: "بهو فندقي",
                body: "إضاءة نحاسية دافئة",
                assetId: oid(21),
                alt: "Warm brass lobby chandelier",
                href: null,
                refs: [],
              },
            ],
          },
          {
            key: "cert-wall",
            type: "certifications",
            heading: "الاعتمادات",
            body: "",
            table: null,
            faq: [],
            assetId: null,
            alt: "",
            refs: [{ factId: oid(1), revision: 1 }],
            items: [
              {
                title: "وثيقة الاعتماد",
                body: "Atelier Nord LLC compliance dossier",
                assetId: oid(21),
                alt: "Compliance badge",
                href: null,
                refs: [{ factId: oid(1), revision: 1 }],
              },
            ],
          },
          {
            key: "stories",
            type: "showcase",
            heading: "مشاريع مختارة",
            body: "",
            table: null,
            faq: [],
            assetId: null,
            alt: "",
            refs: [],
            items: [
              {
                title: "مشروع الضيافة",
                body: "تنفيذ حلول إضاءة متكاملة.",
                assetId: oid(21),
                alt: "Hospitality interior lighting",
                href: "#inquiry",
                refs: [],
              },
            ],
          },
        ],
      },
    ],
  };

  // Unreferenced metrics block must be suppressed in renderStaticPage.
  const suppressedHtml = renderStaticPage(
    { ...snapshot, assets: { [oid(20)]: { path: "/a.webp", width: 640, height: 480 } } },
    {
      ...snapshot.pages[0],
      blocks: [
        {
          key: "fake-metrics",
          type: "metrics",
          heading: "Fake stats",
          body: "",
          table: null,
          faq: [],
          assetId: null,
          alt: "",
          refs: [],
          items: [
            { title: "999 Years", body: "Invented claim", assetId: null, alt: "", href: null, refs: [] },
          ],
        },
      ],
    },
  );
  assert.ok(!suppressedHtml.includes("999 Years"));

  // Full Astro build with zero network & outputChecks verification.
  const built = await buildStatic(
    snapshot,
    async () => ({ body: img, mime: "image/webp" }),
    "release",
  );
  assert.deepEqual(outputChecks(built.files), []);
  const html = Buffer.from(built.files["index.html"]).toString("utf8");
  assert.ok(html.includes('<html lang="ar" dir="rtl">'));
  assert.ok(html.includes("palette-obsidian"));
  assert.ok(html.includes("type-luxury"));
  assert.ok(html.includes("surface-contrast"));
  assert.ok(html.includes("header-editorial"));
  assert.ok(html.includes("radius-subtle"));
  assert.ok(html.includes("metrics-strip"));
  assert.ok(html.includes("media-gallery"));
  assert.ok(html.includes("data-lightbox-trigger"));
  assert.ok(html.includes("gs-lightbox"));
  assert.ok(html.includes("cert-wall"));
  assert.ok(html.includes("showcase-grid"));
  assert.ok(html.includes("brand-dock"));
  assert.ok(html.includes("https://wa.me/971501234567"));
  assert.ok(html.includes("https://www.linkedin.com/company/atelier-nord"));
});
