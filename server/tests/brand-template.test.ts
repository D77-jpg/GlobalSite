import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStaticPage } from "../src/services/static-template.service";
import { siteSkillProfile } from "../src/services/site-skill-profile";
import { validatePage } from "../src/services/page-validation.service";
import { pageInput } from "../src/validators/sites.validator";

const block = {
  key: "overview",
  type: "text",
  heading: "Overview",
  body: "Explore our collection.",
  table: null,
  faq: [],
  assetId: null,
  alt: "",
  refs: [],
};
const presentation = {
  navigationLabel: "Home",
  headline: "A home shared with cats",
  summary: "Browse everyday essentials for rest, scratching and play.",
  primaryActionLabel: "Explore collection",
  visualStyle: "organic",
  heroLayout: "split",
  designNotes: "Private design rationale, never publish this.",
};
const home = {
  id: "home",
  type: "home",
  path: "/",
  title: "Long SEO title | Business supplies | Brand",
  metaDescription: "Explore our collection.",
  refs: [],
  blocks: [block],
  presentation,
};
test("brand renderer separates SEO, public presentation, private notes and compact navigation", () => {
  const pages = [
    home,
    ...[
      "category",
      "about",
      "faq",
      "contact",
      "factory",
      "certifications",
      "product",
      "product",
    ].map((type, i) => ({
      ...home,
      id: String(i),
      type,
      path: "/page-" + i,
      title: "Long page " + i + " | SEO title",
      presentation: undefined,
    })),
  ];
  const html = renderStaticPage(
    {
      site: {
        id: "fixture",
        name: "Fixture",
        brandColor: "#687a59",
        templateId: "packaging-bags",
      },
      pages,
      facts: [],
      settings: { canonicalBaseUrl: "https://fixture.example.invalid" },
      assets: {},
      createdAt: "fixture",
    },
    home,
  );
  assert(html.includes("<h1>A home shared with cats</h1>"));
  assert(
    html.includes("<title>Long SEO title | Business supplies | Brand</title>"),
  );
  assert(!html.includes(presentation.designNotes));
  const nav = html.match(/<nav class="desktop-nav"[^>]*>(.*?)<\/nav>/s)![1];
  assert.equal((nav.match(/<a /g) ?? []).length, 4);
  assert(!nav.includes("| SEO"));
  assert(!nav.includes("Long page"));
  assert(html.includes('class="mobile-navigation"'));
  assert(html.includes('property="og:title"'));
});
test("presentation cannot bypass the fact gate and content remains escaped", () => {
  const p = pageInput.parse({
    title: "Fixture",
    metaDescription: "Fixture",
    refs: [],
    blocks: [block],
    presentation: {
      ...presentation,
      headline: "ISO 9001 certified",
      summary: "<script>fixture()</script>",
    },
  });
  const issues = validatePage(p, [], { productIds: [], type: "home" });
  assert(
    issues.some(
      (i) =>
        i.field === "presentation.headline" &&
        i.code === "UNSOURCED_CERTIFICATION",
    ),
  );
  const html = renderStaticPage(
    {
      site: {
        name: "Fixture",
        templateId: "packaging-bags",
        brandColor: "#687a59",
      },
      pages: [{ ...home, ...p }],
      facts: [],
      settings: { canonicalBaseUrl: "https://fixture.example.invalid" },
      assets: {},
      createdAt: "fixture",
    },
    { ...home, ...p },
  );
  assert(html.includes("&lt;script&gt;fixture()&lt;/script&gt;"));
  assert(!html.includes("<script>fixture()"));
});
test("reviewed skill profile is bounded, versioned and shipped locally", () => {
  const profile = siteSkillProfile();
  assert.equal(profile.version, "brand-site-v4");
  assert.match(profile.hash, /^[a-f0-9]{64}$/);
  assert(
    profile.guidance.includes("copywriting") &&
      profile.guidance.includes("instant-site") &&
      profile.guidance.includes("frontend-design"),
  );
  assert(Buffer.byteLength(profile.guidance) <= 17000);
});
