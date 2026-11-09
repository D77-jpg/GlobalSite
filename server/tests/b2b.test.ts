import { renderInquiry } from "../src/services/inquiry-template.service";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { config } from "../src/config";
import {
  buildStatic,
  outputChecks,
} from "../src/services/static-builder.service";
import {
  renderB2BBlock,
  productCards,
  catalogueHtml,
} from "../src/services/b2b-template.service";
import { procurementCoverage } from "../src/services/b2b-planning.service";
import {
  renderStaticPage,
  type Snapshot,
} from "../src/services/static-template.service";
let root: string;
const oldStorage = config.storage;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "globalsite-b2b-"));
  config.storage = root;
});
after(async () => {
  config.storage = oldStorage;
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  await fs.rm(root, { recursive: true, force: true });
});
const profile = {
  businessModel: "wholesale",
  audiences: ["Retail buyers"],
  buyerNeeds: ["Compare models"],
  primaryAction: "quote",
  referenceUrls: [],
};
const item = {
  title: "Discuss your collection",
  body: "Share your preferred category and intended market.",
  assetId: null,
  alt: "",
  href: "#inquiry",
  refs: [],
};
const b = (type: string, key = type) => ({
  key,
  type,
  heading: "Purchasing information",
  body: "Useful context for preparing a product inquiry.",
  table: null,
  faq: [],
  assetId: null,
  alt: "",
  refs: [],
  items: [item],
});
const product = (id: string, title: string) => ({
  id,
  nodeKey: id,
  type: "product",
  productId: id,
  path: "/range/" + id,
  title,
  metaDescription: "Explore the product and prepare an inquiry.",
  refs: [],
  blocks: [{ ...b("text", "overview"), items: undefined }],
});
function fixture(): Snapshot {
  return {
    site: {
      id: "site",
      name: "Fixture Supply",
      templateId: "packaging-bags",
      brandColor: "#315c4b",
      productIds: ["a".repeat(24), "b".repeat(24)],
      buyerProfile: profile,
    },
    pages: [
      {
        ...product("home", "Products for buying teams"),
        type: "home",
        path: "/",
        productId: null,
        presentation: {
          headline: "Build your next collection",
          summary: "Explore product options for your buying brief.",
          navigationLabel: "Home",
          primaryActionLabel: "Request a quote",
          primaryActionTarget: "inquiry",
          visualStyle: "organic",
          heroLayout: "split",
          designNotes: "PRIVATE NOTE",
        },
        blocks: [
          b("category-grid"),
          b("product-grid"),
          b("features"),
          b("process"),
          b("downloads"),
          b("cta"),
        ],
      },
      {
        ...product("range", "Product range"),
        type: "category",
        path: "/range",
        productId: null,
        blocks: [b("product-grid")],
      },
      product("a".repeat(24), "Resting collection"),
      product("b".repeat(24), "Play collection"),
    ],
    products: [
      {
        id: "a".repeat(24),
        name: "UNAPPROVED 500 buyers",
        category: null,
        assetIds: [],
      },
      {
        id: "b".repeat(24),
        name: "Unapproved text",
        category: null,
        assetIds: [],
      },
    ],
    facts: [],
    assets: {},
    settings: { canonicalBaseUrl: "https://fixture.example" },
    createdAt: new Date().toISOString(),
    inquiry: { enabled: false },
  };
}
test("procurement coverage ignores candidate and foreign-subject facts", () => {
  const s = fixture(),
    p = [{ id: "a".repeat(24), assetIds: ["image"] }];
  const facts = [
    {
      subjectType: "organization",
      type: "company.name",
      value: "Fixture",
      status: "candidate",
    },
  ];
  const report = procurementCoverage(s.site, p, facts);
  assert(!report.canPublish);
  assert(report.gaps.some((g) => g.type === "company.name"));
  const confirmed = [
    { subjectType: "organization", type: "company.name", status: "confirmed" },
    { subjectType: "organization", type: "company.email", status: "confirmed" },
    ...["material", "moq", "leadTime", "specifications"].map((type) => ({
      subjectType: "product",
      subjectId: "a".repeat(24),
      type: "product." + type,
      status: "confirmed",
    })),
  ];
  assert(procurementCoverage(s.site, p, confirmed).canPublish);
  assert(
    !procurementCoverage(
      s.site,
      p,
      confirmed.map((f) =>
        f.subjectType === "product" ? { ...f, subjectId: "b".repeat(24) } : f,
      ),
    ).canPublish,
  );
});
test("B2B blocks escape item text, omit unsupported proof and use approved page names", () => {
  const s = fixture(),
    home = s.pages[0];
  const html = renderB2BBlock(s, home, {
    ...b("features"),
    items: [{ ...item, title: '<img src=x onerror="alert(1)">' }],
  })!;
  assert(html.includes("&lt;img"));
  assert(!html.includes("<img src=x"));
  assert.equal(renderB2BBlock(s, home, b("evidence")), "");
  const cards = productCards(s, home);
  assert(cards.includes("Resting collection"));
  assert(!cards.includes("UNAPPROVED"));
  assert(cards.includes("data-quote-add"));
  const page = renderStaticPage(s, home);
  assert(!page.includes("PRIVATE NOTE"));
  assert(page.includes("quote-bar"));
  assert.equal((page.match(/id="collection"/g) ?? []).length, 1);
  assert(catalogueHtml(s).includes("Resting collection"));
  s.pages[2].title = "Resting collection | SEO-only suffix";
  assert(!renderInquiry(s, home).includes("SEO-only suffix"));
});
test("B2B multi-page build includes an offline catalogue and safe downloadable PDFs", async () => {
  const s = fixture(),
    id = "c".repeat(24);
  s.pages[0].blocks.find((x: any) => x.type === "downloads").items = [
    { ...item, title: "Specification guide", assetId: id, href: null },
  ];
  const image = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#d5dfd0" },
  })
    .webp()
    .toBuffer();
  const built = await buildStatic(s, async (assetId, variant) => {
    if (assetId === id) {
      if (variant) throw Error("No image variant");
      return {
        body: Buffer.from("%PDF-1.4\nFixture document"),
        mime: "application/pdf",
      } as any;
    }
    return { body: image, mime: "image/webp" } as any;
  });
  assert(built.files["catalogue.html"]);
  assert(Object.keys(built.files).some((n) => n.endsWith(".pdf")));
  assert.deepEqual(outputChecks(built.files), []);
  assert(
    Buffer.from(built.files["index.html"])
      .toString()
      .includes("Download document"),
  );
});

test("workflow wording is allowed while hard quantities and unknown site paths stay blocked", async () => {
  const { validatePage } = await import(
    "../src/services/page-validation.service"
  );
  const data: any = {
    title: "Product range",
    metaDescription: "Explore products",
    refs: [],
    blocks: [
      {
        ...b("features"),
        body: "Keep product questions in one place. Send one multi-product quote request. One brief for the shortlist. Review one response covering each one.",
        items: [{ ...item, href: "/missing-product" }],
      },
    ],
  };
  const context = { type: "home", productIds: [], paths: ["/", "/range"] };
  let issues = validatePage(data, [], context);
  assert(!issues.some((i) => i.code === "UNSOURCED_NUMBER"));
  assert(issues.some((i) => i.code === "PAGE_LINK_INVALID"));
  data.blocks[0].items[0].href = "/range";
  data.blocks[0].body = "Lead time is one day.";
  issues = validatePage(data, [], context);
  assert(issues.some((i) => i.code === "UNSOURCED_NUMBER"));
  assert(!issues.some((i) => i.code === "PAGE_LINK_INVALID"));
});

test("private review can diagnose a broken draft link while release builds refuse it", async () => {
  const s = fixture();
  s.pages[0].blocks.find((b: any) => b.type === "features").items = [
    { ...item, href: "/missing-route" },
  ];
  await assert.rejects(() => buildStatic(s), /BUILD_HTML_INVALID/);
  const preview = await buildStatic(s, undefined, "review");
  assert(preview.report.issues.some((i) => i.startsWith("BROKEN_LINK:")));
});

test("AI cannot invent a public contact email or launder it through unrelated facts", async () => {
  const { validatePage } = await import(
    "../src/services/page-validation.service"
  );
  const data: any = {
    title: "Contact",
    metaDescription: "Discuss your inquiry",
    refs: [],
    blocks: [
      {
        ...b("text"),
        body: "Write to sales@fixture.example.",
        refs: [{ factId: "a".repeat(24), revision: 1 }],
      },
    ],
  };
  const f = {
    id: "a".repeat(24),
    revision: 1,
    status: "confirmed",
    subjectType: "organization",
    type: "company.name",
    value: "Fixture",
  };
  assert(
    validatePage(data, [f], { type: "home", productIds: [] }).some(
      (i) => i.code === "UNSOURCED_CONTACT",
    ),
  );
  assert(
    !validatePage(
      data,
      [{ ...f, type: "company.email", value: "sales@fixture.example" }],
      { type: "home", productIds: [] },
    ).some((i) => i.code === "UNSOURCED_CONTACT"),
  );
});

test("single-category ranges expose approved product destinations in navigation and category cards", () => {
  const s = fixture();
  const html = renderStaticPage(s, s.pages[0]);
  const navigation =
    html.match(/<nav class="desktop-nav"[^>]*>(.*?)<\/nav>/s)?.[1] ?? "";
  assert.match(
    navigation,
    /<details class="range-menu"><summary>Products<\/summary>/,
  );
  assert.ok(!navigation.split("</details>")[1].includes(s.pages[2].path));
  const card = {
    ...item,
    href: s.pages[2].path,
    title: "Resting spaces",
    body: "Explore the resting range.",
  };
  const cards = renderB2BBlock(s, s.pages[0], {
    ...b("category-grid"),
    items: [card],
  });
  assert.ok(cards?.includes(card.title));
  assert.ok(cards?.includes(card.body));
  for (const product of s.pages.filter((p) => p.type === "product")) {
    assert.ok(navigation.includes(product.path));
    assert.ok(cards?.includes(product.path));
  }
  assert.match(html, /class="quote-bar" hidden/);
});

test("home presents the repeated product range as a line sheet and product guides only link rendered buying sections", () => {
  const s = fixture();
  assert.match(renderStaticPage(s, s.pages[0]), /catalog-section line-sheet/);
  const p = s.pages[2];
  p.blocks = [
    { ...b("specs"), table: { columns: ["Material"], rows: [] } },
    {
      ...b("faq"),
      heading: "Buying questions",
      faq: [
        { question: "Which collection?", answer: "Compare the collection." },
      ],
    },
  ];
  const html = renderStaticPage(s, p);
  assert.ok(html.includes('href="#block-faq"'));
  assert.ok(!html.includes('href="#block-specs"'));
  assert.ok(!html.includes("catalog-section line-sheet"));
});
