import { test } from "node:test";
import assert from "node:assert/strict";
import { diffPageDraft } from "../src/page-diff.ts";

test("diffPageDraft detects metadata, presentation, added, removed, reordered, and edited blocks", () => {
  const base = {
    title: "Home",
    metaDescription: "Summary",
    presentation: { headline: "Old", visualStyle: "minimal" },
    refs: [],
    blocks: [
      { key: "hero", heading: "Hero", body: "Alpha" },
      { key: "specs", heading: "Specs", body: "Beta" },
      { key: "faq", heading: "FAQ", body: "Gamma" },
    ],
  };

  assert.deepEqual(diffPageDraft(base, structuredClone(base)), []);

  const modified = {
    title: "Home Updated",
    metaDescription: "Summary",
    presentation: { headline: "New", visualStyle: "minimal" },
    refs: [],
    blocks: [
      { key: "specs", heading: "Specs", body: "Beta revised" },
      { key: "hero", heading: "Hero", body: "Alpha" },
      { key: "gallery", heading: "Gallery", body: "Delta" },
    ],
  };

  const diff = diffPageDraft(base, modified);
  assert.ok(diff.some((d) => d.kind === "meta" && d.target === "title"));
  assert.ok(diff.some((d) => d.kind === "presentation"));
  assert.ok(diff.some((d) => d.kind === "block-removed" && d.target === "faq"));
  assert.ok(diff.some((d) => d.kind === "block-added" && d.target === "gallery"));
  assert.ok(diff.some((d) => d.kind === "block-moved" && d.target === "specs"));
  assert.ok(diff.some((d) => d.kind === "block-edited" && d.target === "specs"));
});
