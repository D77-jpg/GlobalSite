import { test } from "node:test";
import assert from "node:assert/strict";
import { compositionPage, compositionCases } from "./fixtures/composition";
import {
  compositionIssues,
  compositionBrief,
} from "../src/services/site-composition.service";
import { pageInput } from "../src/validators/sites.validator";
import { validatePage } from "../src/services/page-validation.service";
import { renderStaticPage } from "../src/services/static-template.service";
import { referenceStructure } from "../src/services/reference-structure.service";

test("composed pages use bounded axes, distinct structures and retain fact gates", () => {
  const html = [];
  for (const [i, c] of compositionCases.entries()) {
    const page = compositionPage(i);
    assert(pageInput.safeParse(page).success);
    assert.deepEqual(compositionIssues(page, "home"), []);
    const injected = structuredClone(page);
    (injected.presentation!.composition as any).palette = 'red" onclick="bad()';
    assert.equal(pageInput.safeParse(injected).success, false);
    injected.presentation!.headline = "Serving 9000 buyers";
    assert(
      validatePage(injected, [], { type: "home", productIds: [] }).some(
        (i) => i.code === "UNSOURCED_NUMBER",
      ),
    );
    const snapshot = {
      site: { name: "Fixture", templateId: "adaptive", buyerProfile: {} },
      pages: [
        { ...page, type: "home", path: "/" },
        { ...page, type: "category", path: "/range" },
        ...[
          "solution",
          "customization",
          "about",
          "factory",
          "certifications",
          "resources",
          "faq",
          "contact",
        ].map((type) => ({
          ...page,
          type,
          path: "/" + type,
          presentation: { ...page.presentation, navigationLabel: type },
        })),
      ],
      products: [],
      facts: [],
      assets: {},
      settings: { canonicalBaseUrl: "https://fixture.invalid" },
      createdAt: "fixture",
    };
    const rendered = renderStaticPage(snapshot, snapshot.pages[0]);
    assert.match(rendered, new RegExp("palette-" + c.palette));
    assert.match(rendered, new RegExp("products-" + c.productLayout));
    assert.match(rendered, /href="\/certifications"/);
    assert.match(rendered, /href="\/customization"/);
    assert(!rendered.includes(c.brief)); // private rationale
    html.push(rendered);
  }
  assert.equal(new Set(html).size, 4);
  const unknown = compositionBrief(
    { businessBrief: "Marine survey services", templateId: "adaptive" },
    { type: "solution" },
  );
  assert.match(unknown.instruction, /Unfamiliar industries/);
});
test("thin and repeated pages fail readiness; old pages retain their approval rules", () => {
  const page = compositionPage(0);
  page.blocks = [page.blocks[0]];
  assert(
    compositionIssues(page, "home").some(
      (i) => i.code === "CONTENT_DEPTH_REQUIRED",
    ),
  );
  assert(
    compositionIssues(page, "home").some(
      (i) => i.code === "CONTENT_BUYING_REQUIRED",
    ),
  );
  const rich = compositionPage(0);
  rich.blocks.push({ ...rich.blocks[2], key: "repeat" });
  assert(
    compositionIssues(rich, "home").some((i) => i.code === "CONTENT_REPEATED"),
  );
  delete page.presentation!.composition;
  assert.deepEqual(compositionIssues(page, "home"), []);
  assert(
    validatePage(page, [], {
      type: "home",
      productIds: [],
      requireComposition: true,
    }).some((i) => i.code === "CONTENT_DESIGN_REQUIRED"),
  );
});
test("reference evidence captures navigation and section depth without importing claims or running code", () => {
  const result = referenceStructure(
    '<nav><a href="/products">Products</a><a href="http://127.0.0.1/private">Private</a><a href="/x?token=hidden">Tracking</a></nav><h2>Materials</h2><p>Compare product options and applications.</p><img src="/sample.webp" alt="Sample"><script>fetch("bad")</script><h2>Ordering guidance</h2><p>Prepare your brief.</p>',
    "https://example.com",
  );
  assert.deepEqual(result.navigation, [
    { label: "Products", path: "/products" },
  ]);
  assert.equal(result.sections[0].images, 1);
  assert.equal(result.sections[0].words, 5);
  assert.equal(result.sections.length, 2);
  assert(!JSON.stringify(result).includes("fetch"));
});
