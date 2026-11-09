import type { PageInput } from "../validators/sites.validator";
import { pendingDetail } from "./b2b-template.service";

// Procurement patterns are composable starting points, never industry enums.
// They contain no supplier claims and cannot authorize facts or external assets.
export const compositionPatterns = [
  {
    approach: "engineering",
    decisions: [
      "process suitability",
      "material and tolerance",
      "drawing review",
      "inspection evidence",
    ],
    visuals:
      "technical sans, compact specification rows, process imagery, strong typographic hierarchy",
    sections: [
      "features",
      "comparison",
      "specs",
      "process",
      "evidence",
      "downloads",
    ],
  },
  {
    approach: "configurable-range",
    decisions: [
      "product family",
      "material and finish",
      "customization boundaries",
      "sample approval",
      "packing and delivery",
    ],
    visuals:
      "catalogue grid, large product still lifes, material details, contrasting section rhythms",
    sections: [
      "category-grid",
      "product-grid",
      "comparison",
      "customization",
      "process",
      "faq",
    ],
  },
  {
    approach: "material-brand",
    decisions: [
      "material characteristics",
      "form and application",
      "compatibility",
      "sample selection",
    ],
    visuals:
      "editorial typography, panoramic or asymmetric hero, generous photography, precise product index",
    sections: [
      "split",
      "features",
      "product-grid",
      "comparison",
      "case-study",
      "faq",
    ],
  },
  {
    approach: "project-solutions",
    decisions: [
      "buyer problem",
      "application constraints",
      "delivery scope",
      "project evidence",
      "consultation brief",
    ],
    visuals:
      "solution-led navigation, project storytelling, structured capability lists, contextual imagery",
    sections: [
      "split",
      "features",
      "process",
      "case-study",
      "downloads",
      "cta",
    ],
  },
];
export function compositionBrief(site: any, node?: any) {
  const type = node?.type ?? "home";
  return {
    version: "v1",
    patterns: compositionPatterns,
    instruction:
      "Choose or mix by the actual business, buyer decisions and available evidence. Do not choose by legacy templateId. Explain the choice privately. Unfamiliar industries use the same decision analysis; do not force an industry label.",
    pagePurpose: type,
    buyerQuestions: node?.brief?.buyerQuestions ?? [],
    contentTargets:
      type === "home"
        ? {
            usefulWords: "400–800 when evidence allows",
            purposefulSections: "6–10",
            decisions: [
              "offer and audience",
              "range or capability discovery",
              "selection criteria",
              "application context",
              "buying process",
              "inquiry brief",
            ],
          }
        : type === "product"
          ? {
              usefulWords: "250–600 when evidence allows",
              decisions: [
                "specification fit",
                "material and application",
                "options and constraints",
                "purchasing terms",
                "next action",
              ],
            }
          : {
              usefulWords: "180–500 appropriate to purpose",
              decisions: [
                "page-specific buyer questions",
                "supporting information",
                "next action",
              ],
            },
    rules: [
      "Targets are not permission to pad text. Distinct useful information matters more than raw word count.",
      "Missing company evidence stays an internal gap. Explain what a buyer should specify as guidance, never promise supplier capabilities.",
      "Do not generate empty factory/certification/case pages. Surface missing requiredFactTypes for interview and confirmation.",
      "Build linked buying journeys; separate categories, capabilities, applications and resources when actual source material supports them.",
      "Each section answers a different question. Avoid a category grid and product grid showing the same tiny range twice.",
      "No copying competitor copy, images, brand identity, claims or proprietary product details.",
    ],
  };
}
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const normalized = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function bodyText(b: PageInput["blocks"][number]) {
  return [
    b.body,
    ...(b.items ?? []).map((i) => i.body),
    ...b.faq.map((f) => f.answer + " " + f.detail),
    ...(b.table?.rows ?? []).map((r) => r.join(" ")),
  ]
    .filter((v) => v && !pendingDetail(v))
    .join(" ");
}
export function compositionIssues(page: PageInput, type: string) {
  if (!page.presentation?.composition) return []; // Existing pages keep their original approval contract.
  const issues: {
    code: string;
    field: string;
    blockKey: string | null;
    token: string;
  }[] = [];
  const add = (code: string, key: string | null = null) =>
    issues.push({
      code,
      field: key ? "blocks." + key : "page",
      blockKey: key,
      token: "",
    });
  const blocks = page.blocks.filter(
    (b) =>
      bodyText(b).trim() || ["product-grid", "category-grid"].includes(b.type),
  );
  const text = blocks.map(bodyText).join(" ");
  if (words(text) < (type === "home" ? 260 : type === "product" ? 100 : 60))
    add("CONTENT_DEPTH_REQUIRED");
  const seen = new Set<string>();
  for (const b of blocks) {
    const value = normalized(bodyText(b));
    if (words(value) >= 16 && seen.has(value)) add("CONTENT_REPEATED", b.key);
    seen.add(value);
  }
  if (type === "home") {
    if (blocks.length < 5) add("CONTENT_SECTIONS_REQUIRED");
    if (
      !blocks.some(
        (b) =>
          ["product-grid", "category-grid"].includes(b.type) ||
          (["features", "split"].includes(b.type) &&
            (b.items ?? []).some(
              (i) => i.href?.startsWith("/") && i.body.trim(),
            )),
      )
    )
      add("CONTENT_DISCOVERY_REQUIRED");
    if (
      !blocks.some((b) =>
        ["features", "comparison", "split", "specs"].includes(b.type),
      )
    )
      add("CONTENT_DECISION_REQUIRED");
    if (!blocks.some((b) => ["process", "faq"].includes(b.type)))
      add("CONTENT_BUYING_REQUIRED");
    if (
      blocks.filter((b) => b.type === "product-grid").length > 1 ||
      blocks.filter((b) => b.type === "category-grid").length > 1
    )
      add("CONTENT_REPEATED");
  }
  return issues;
}
