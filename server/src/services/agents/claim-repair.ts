// S35: deterministic removal of unsupported claims in generated drafts.
// It never writes new wording or facts. It only removes what the fact gate
// rejected: items and table rows are dropped, offending sentences are cut
// from block bodies, and required product sections without matching facts
// fall back to the documented safe placeholder. The result is kept only when
// it strictly reduces validation issues and introduces no new issue codes.
import type { PageInput } from "../../validators/sites.validator";
import { productSections } from "../../validators/sites.validator";
import {
  contentTokens,
  validatePage,
  type Issue,
} from "../page-validation.service";
import { hasBrokenFragment, intactSentences } from "../copy-integrity";
import { pendingDetail } from "../b2b-template.service";
import { citableFact, factId, REFS_MAX, type FactLike } from "./ref-completion";

type Context = Parameters<typeof validatePage>[2];
type Fact = Parameters<typeof validatePage>[1][number];
type Block = PageInput["blocks"][number];

export const SAFE_PLACEHOLDER = "Contact our team for confirmed details.";
const REQUIRED_SECTIONS = [
  "material",
  "application",
  "oem",
  "packaging",
  "certifications",
  "moq",
  "samples",
];
const CLAIM_CODES = new Set([
  "UNSOURCED_NUMBER",
  "UNSOURCED_DETAIL",
  "UNSOURCED_YEAR",
  "UNSOURCED_CERTIFICATION",
  "UNSOURCED_CAPACITY",
]);
const sentences = (s: string) =>
  s
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matcher(issue: Issue): RegExp | null {
  if (issue.code === "UNSOURCED_YEAR") return /\b(founded|established)\b/i;
  if (issue.code === "UNSOURCED_CAPACITY")
    return /\b(capacity|annual output|production output)\b/i;
  if (!issue.token) return null;
  return new RegExp(
    "(?<![\\p{L}\\p{N}])" + escape(issue.token) + "(?![\\p{L}\\p{N}])",
    "iu",
  );
}

function prune(page: PageInput, issues: Issue[], context: Context) {
  const out = structuredClone(page);
  const dropItems = new Map<string, Set<number>>();
  const dropRows = new Map<string, Set<number>>();
  const mark = (m: Map<string, Set<number>>, key: string, i: number) =>
    m.set(key, (m.get(key) ?? new Set<number>()).add(i));
  for (const issue of issues) {
    if (!CLAIM_CODES.has(issue.code)) continue;
    const f = /^blocks\.([^.]+)\.(body|items|table)(?:\.(\d+))?$/.exec(
      issue.field,
    );
    if (!f) continue; // headings, alt text, presentation and FAQ stay as-is
    const [, key, part, index] = f;
    const block = out.blocks.find((b: Block) => b.key === key);
    if (!block) continue;
    if (part === "items" && index !== undefined) mark(dropItems, key, +index);
    if (part === "table" && index !== undefined && block.table) {
      // Fact-detail checks index data rows; text checks index [columns, ...rows].
      const row = issue.code === "UNSOURCED_DETAIL" ? +index : +index - 1;
      if (row >= 0) mark(dropRows, key, row);
    }
    if (part === "body") {
      const required =
        context.type === "product" && REQUIRED_SECTIONS.includes(key);
      if (issue.code === "UNSOURCED_DETAIL" && required) {
        block.body = SAFE_PLACEHOLDER;
        continue;
      }
      const re = matcher(issue);
      if (!re) continue;
      const kept = sentences(block.body).filter((s) => !re.test(s));
      block.body = kept.length ? kept.join(" ") : required ? SAFE_PLACEHOLDER : "";
    }
  }
  for (const block of out.blocks) {
    const items = dropItems.get(block.key);
    if (items && block.items)
      block.items = block.items.filter((_, i) => !items.has(i));
    const rows = dropRows.get(block.key);
    if (rows && block.table) {
      block.table = {
        ...block.table,
        rows: block.table.rows.filter((_, i) => !rows.has(i)),
      };
      if (block.type === "specs" && !block.table.rows.length)
        block.body = SAFE_PLACEHOLDER;
    }
  }
  return out;
}

export function repairUnsourcedClaims(
  input: PageInput,
  facts: Fact[],
  context: Context,
): PageInput {
  let page = input;
  let issues = validatePage(page, facts, context);
  for (let pass = 0; pass < 2 && issues.some((i) => CLAIM_CODES.has(i.code)); pass++) {
    const next = prune(page, issues, context);
    const after = validatePage(next, facts, context);
    const known = new Set(issues.map((i) => i.code));
    if (after.length >= issues.length || after.some((i) => !known.has(i.code)))
      break;
    page = next;
    issues = after;
  }
  return page;
}

/**
 * S35 acceptance fix: drop whole sentences whose figures were cut out by an
 * earlier rewrite ("Specify the VG- for …", ": mm flat burrs", "-day lead
 * time"). Only deletes. presentation.summary keeps its text when no intact
 * sentence remains (the renderer then falls back); emptied required product
 * sections use the safe placeholder. Kept only when it adds no issue.
 */
export function repairBrokenFragments(
  input: PageInput,
  facts: Fact[],
  context: Context,
): PageInput {
  const out = structuredClone(input);
  let changed = false;
  const ids = context.identifiers;
  const summary = out.presentation?.summary;
  if (out.presentation && summary && hasBrokenFragment(summary, ids)) {
    const kept = intactSentences(summary, ids);
    if (kept) {
      out.presentation.summary = kept;
      changed = true;
    }
  }
  for (const block of out.blocks) {
    if (block.body && hasBrokenFragment(block.body, ids)) {
      const required =
        context.type === "product" && REQUIRED_SECTIONS.includes(block.key);
      block.body =
        intactSentences(block.body, ids) || (required ? SAFE_PLACEHOLDER : "");
      changed = true;
    }
    for (const item of block.items ?? [])
      if (item.body && hasBrokenFragment(item.body, ids)) {
        item.body = intactSentences(item.body, ids);
        changed = true;
      }
  }
  if (!changed) return input;
  const before = validatePage(input, facts, context);
  const after = validatePage(out, facts, context);
  const known = new Set(before.map((i) => i.code));
  return after.length > before.length || after.some((i) => !known.has(i.code))
    ? input
    : out;
}

// S36 review fix: items whose text ends with an unrelated fact value that the
// model appended to pass the literal-evidence check ("… branded panels.
// Titanium alloy", "… artwork approval 3 independent groupheads").
const EVIDENCE_ITEMS = new Set([
  "evidence",
  "case-study",
  "customization",
  "metrics",
  "certifications",
]);
const TAIL_GLUE =
  /\b(?:a|an|the|and|or|of|for|to|in|on|with|by|from|at|as|per|via|is|are)$/i;
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Removes a trailing fragment from an item body when it is exactly a citable
 * fact value of at most six words, follows a sentence end or a run-on space
 * (never a preposition such as "in matte black"), and shares no content word
 * with the item title. Returns the body unchanged otherwise.
 */
export function stripAppendedValue(
  body: string,
  title: string,
  values: ReadonlyArray<string>,
): string {
  const trimmed = body.trim();
  const base = trimmed.replace(/[.!]+$/, "");
  const titleWords = new Set(contentTokens(title));
  for (const raw of values) {
    const value = raw.trim().replace(/[.!]+$/, "");
    if (!value || wordCount(value) > 6 || base.length <= value.length) continue;
    const tail = base.slice(base.length - value.length);
    if (tail.normalize("NFKC").toLowerCase() !== value.normalize("NFKC").toLowerCase())
      continue;
    const rest = base.slice(0, base.length - value.length);
    const sentenceEnd = /[.!?]\s+$/.test(rest);
    const runOn =
      /[\p{L}\p{N})]\s+$/u.test(rest) &&
      /^[\p{Lu}\p{N}]/u.test(tail) &&
      !TAIL_GLUE.test(rest.trim());
    if (!sentenceEnd && !runOn) continue;
    if (contentTokens(value).some((w) => titleWords.has(w))) continue;
    const kept = rest.trim().replace(/[,;:\u2013\u2014-]+$/, "").trim();
    if (contentTokens(kept).length < 2) continue;
    return /[.!?]$/.test(kept) ? kept : kept + ".";
  }
  return body;
}

/**
 * Applies stripAppendedValue to evidence/case-study/customization/metrics/
 * certification items, one item at a time; each removal is kept only when the
 * page has no more validation issues than before. Only deletes text.
 */
export function stripAppendedFactValues(
  input: PageInput,
  facts: Fact[],
  context: Context,
): PageInput {
  const values = [
    ...new Set(
      (facts as FactLike[])
        .filter((f) => citableFact(f, context))
        .map((f) => String(f.value ?? "").trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
  if (!values.length) return input;
  let page = input;
  let count = -1;
  for (const [bi, block] of input.blocks.entries()) {
    if (!EVIDENCE_ITEMS.has(block.type)) continue;
    for (const [ii, item] of (block.items ?? []).entries()) {
      const body = stripAppendedValue(item.body, item.title, values);
      if (body === item.body) continue;
      if (count < 0) count = validatePage(page, facts, context).length;
      const next = structuredClone(page);
      next.blocks[bi].items![ii].body = body;
      const after = validatePage(next, facts, context).length;
      if (after > count) continue;
      page = next;
      count = after;
    }
  }
  return page;
}

/**
 * S36 review fix: the required product "samples" section only states sample
 * terms. Without a cited sample fact for this product the body becomes the
 * safe placeholder (grouped into "information on request"); a heading that
 * names lead time/delivery is reset to "Samples". Kept only when the page has
 * no more validation issues than before.
 */
export function repairSamplesSection(
  input: PageInput,
  facts: Fact[],
  context: Context,
): PageInput {
  if (context.type !== "product") return input;
  const index = input.blocks.findIndex((b) => b.key === "samples");
  if (index < 0) return input;
  const block = input.blocks[index];
  if (!block.body.trim() || block.body.trim() === SAFE_PLACEHOLDER) return input;
  const byId = new Map((facts as FactLike[]).map((f) => [factId(f), f]));
  const cited = block.refs.some((r) => {
    const f = byId.get(r.factId);
    return (
      !!f &&
      citableFact(f, context) &&
      f.revision === r.revision &&
      /sample/i.test(String(f.type ?? "")) &&
      (f.subjectType !== "product" ||
        String(f.subjectId) === String(context.productId ?? ""))
    );
  });
  if (cited) return input;
  const out = structuredClone(input);
  out.blocks[index].body = SAFE_PLACEHOLDER;
  if (
    (context.language ?? "en") === "en" &&
    /\b(?:lead[- ]?times?|delivery)\b/i.test(block.heading)
  )
    out.blocks[index].heading = "Samples";
  return validatePage(out, facts, context).length >
    validatePage(input, facts, context).length
    ? input
    : out;
}

// S37 §1.2: normalize non-standard required product section keys ("order-terms"
// -> "moq", "sample-terms" -> "samples", "vb-3g-specs" -> "specs", etc.) and
// populate empty/placeholder required product sections verbatim from citable
// product facts. Never invents wording; keeps SAFE_PLACEHOLDER when no fact
// exists.
const SECTION_ALIASES: Array<[string, RegExp]> = [
  [
    "specs",
    /^(?:.*-specs?|specifications?|technical-specs?|spec-table|product-specs)$/i,
  ],
  [
    "moq",
    /^(?:order-terms|ordering|minimum-order|min-order|order-and-lead-time|moq-and-lead-time|lead-time|leadtime|delivery-terms|.*-moq|.*-order-terms)$/i,
  ],
  [
    "samples",
    /^(?:sample-terms|sampling|sample-policy|sample-availability|.*-samples|.*-sample-terms)$/i,
  ],
  [
    "material",
    /^(?:materials|finish|finishes|material-finish|materials-and-finish|build-materials|.*-material|.*-materials)$/i,
  ],
  [
    "application",
    /^(?:applications|use-cases|venues|ideal-for|target-applications|.*-application|.*-applications)$/i,
  ],
  [
    "oem",
    /^(?:oem-options|oem-odm|customization-options|custom-options|private-label|.*-oem|.*-oem-options)$/i,
  ],
  ["packaging", /^(?:packing|packing-and-shipping|packaging-details|.*-packaging)$/i],
  [
    "certifications",
    /^(?:certs|compliance|standards|.*-certifications|.*-compliance)$/i,
  ],
];

const SECTION_FACT_TYPE: Record<string, RegExp> = {
  material: /material/i,
  application: /application/i,
  oem: /oem|odm/i,
  packaging: /packaging/i,
  certifications: /cert|compliance|standard/i,
  moq: /moq|minimum.?order/i,
  samples: /sample/i,
};

const SECTION_HEADING: Record<string, string> = {
  specs: "Specifications",
  material: "Materials",
  application: "Applications",
  oem: "OEM / ODM Options",
  packaging: "Packaging",
  certifications: "Certifications",
  moq: "Minimum Order",
  samples: "Samples",
};

function mergeRefs(
  target: Array<{ factId: string; revision: number }>,
  incoming: ReadonlyArray<{ factId: string; revision: number }>,
) {
  for (const r of incoming) {
    if (target.length >= REFS_MAX) break;
    if (!target.some((x) => x.factId === r.factId)) target.push({ ...r });
  }
}

function formatFactValue(f: FactLike): string {
  const val = String(f.value ?? "").trim();
  const unit = String(f.unit ?? "").trim();
  if (!val) return "";
  if (unit && !val.toLowerCase().includes(unit.toLowerCase()))
    return val + " " + unit;
  return val;
}

function productSectionFacts(
  sectionKey: string,
  facts: Fact[],
  context: Context,
): FactLike[] {
  const re = SECTION_FACT_TYPE[sectionKey];
  if (!re) return [];
  return (facts as FactLike[]).filter(
    (f) =>
      citableFact(f, context) &&
      f.subjectType === "product" &&
      (!context.productId || String(f.subjectId) === String(context.productId)) &&
      re.test(String(f.type ?? "")),
  );
}

function specLabelFromType(type: string): string {
  const tail = type.replace(/^product\.(?:spec\.)?/i, "");
  return tail
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Normalizes non-standard required product section keys (merging when the
 * target key already exists) and fills empty/placeholder/missing required
 * product sections verbatim from citable product facts. Kept only when it
 * adds no new validation issue codes and does not increase issue count.
 */
export function normalizeRequiredProductSections(
  input: PageInput,
  facts: Fact[],
  context: Context,
): PageInput {
  if (context.type !== "product") return input;
  const required = [...(context.requiredProductSections ?? productSections)];
  if (!required.length) return input;
  const requiredSet = new Set(required);
  const out = structuredClone(input);
  let changed = false;

  // 1. Key normalization (with safe merge into existing target key).
  const dropIndices = new Set<number>();
  for (let i = 0; i < out.blocks.length; i++) {
    const b = out.blocks[i];
    if (requiredSet.has(b.key)) continue;
    let targetKey: string | null = null;
    if (b.type === "specs" && requiredSet.has("specs")) {
      targetKey = "specs";
    } else {
      for (const [canonical, pattern] of SECTION_ALIASES) {
        if (!requiredSet.has(canonical)) continue;
        if (canonical === "specs" && b.type !== "specs") continue;
        if (pattern.test(b.key)) {
          targetKey = canonical;
          break;
        }
      }
    }
    if (!targetKey) continue;
    const existing = out.blocks.find(
      (x, idx) => !dropIndices.has(idx) && x.key === targetKey,
    );
    if (!existing) {
      b.key = targetKey;
      changed = true;
    } else if (existing !== b) {
      const bText = b.body.trim();
      const eText = existing.body.trim();
      if (bText && !pendingDetail(bText)) {
        if (!eText || pendingDetail(eText)) existing.body = bText;
        else if (!eText.includes(bText)) existing.body = (eText + " " + bText).slice(0, 6000);
      }
      mergeRefs(existing.refs, b.refs);
      if (b.items?.length) {
        existing.items = [...(existing.items ?? []), ...b.items].slice(0, 12);
      }
      if (b.table?.rows?.length && existing.table) {
        const sameCols = b.table.columns.length === existing.table.columns.length;
        if (sameCols)
          existing.table.rows = [...existing.table.rows, ...b.table.rows].slice(0, 50);
      }
      dropIndices.add(i);
      changed = true;
    }
  }
  if (dropIndices.size) {
    out.blocks = out.blocks.filter((_, idx) => !dropIndices.has(idx));
  }

  // 2. Ensure every required section exists and fill empty/placeholder ones from citable facts.
  const hasDesign = out.blocks.some((b) => !!b.design);
  const insertAt = (() => {
    const idx = out.blocks.findIndex((b) => b.type === "faq" || b.type === "cta");
    return idx >= 0 ? idx : out.blocks.length;
  })();

  for (const key of required) {
    let block = out.blocks.find(
      (b) => b.key === key && (key !== "specs" || b.type === "specs"),
    );
    if (!block) {
      if (key === "specs") {
        const specFacts = (facts as FactLike[]).filter(
          (f) =>
            citableFact(f, context) &&
            f.subjectType === "product" &&
            (!context.productId ||
              String(f.subjectId) === String(context.productId)) &&
            /spec|dimension|size|weight|burr|boiler|group|control|capacity/i.test(
              String(f.type ?? ""),
            ),
        );
        const rows: string[][] = [];
        const refs: Array<{ factId: string; revision: number }> = [];
        for (const f of specFacts.slice(0, 20)) {
          const val = formatFactValue(f);
          if (!val) continue;
          rows.push([specLabelFromType(String(f.type ?? "Specification")), val]);
          mergeRefs(refs, [{ factId: factId(f), revision: f.revision as number }]);
        }
        block = {
          key: "specs",
          type: "specs",
          heading: SECTION_HEADING.specs,
          body: rows.length ? "" : SAFE_PLACEHOLDER,
          table: { columns: ["Specification", "Details"], rows },
          faq: [],
          assetId: null,
          alt: "",
          refs,
          ...(hasDesign
            ? {
                design: {
                  purpose: "selection" as const,
                  frame: "table" as const,
                  ratio: "natural" as const,
                  fit: "contain" as const,
                  focus: "center" as const,
                  density: "compact" as const,
                },
              }
            : {}),
        };
      } else {
        block = {
          key,
          type: "text",
          heading: SECTION_HEADING[key] ?? key,
          body: SAFE_PLACEHOLDER,
          table: null,
          faq: [],
          assetId: null,
          alt: "",
          refs: [],
          ...(hasDesign
            ? {
                design: {
                  purpose: "selection" as const,
                  frame: "band" as const,
                  ratio: "natural" as const,
                  fit: "contain" as const,
                  focus: "center" as const,
                  density: "compact" as const,
                },
              }
            : {}),
        };
      }
      out.blocks.splice(insertAt, 0, block);
      changed = true;
    }

    if (key !== "specs") {
      const matched = productSectionFacts(key, facts, context);
      const values = matched.map(formatFactValue).filter(Boolean);
      const hasBody = !!block.body.trim() && !pendingDetail(block.body);
      const bodySupportedByMatched =
        hasBody &&
        matched.some((f) =>
          block!.body
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[\s,:-]+/g, "")
            .includes(
              String(f.value ?? "")
                .normalize("NFKC")
                .toLowerCase()
                .replace(/[\s,:-]+/g, ""),
            ),
        );
      if (!hasBody) {
        if (values.length) {
          const joined = values.join("; ");
          block.body = /[.!?]$/.test(joined) ? joined : joined + ".";
          mergeRefs(
            block.refs,
            matched.map((f) => ({
              factId: factId(f),
              revision: f.revision as number,
            })),
          );
          changed = true;
        } else if (!block.body.trim()) {
          block.body = SAFE_PLACEHOLDER;
          changed = true;
        }
      } else if (!bodySupportedByMatched) {
        // Renamed or existing required section whose body lacks a matching
        // citable fact value: populate verbatim from matching facts or fall
        // back to SAFE_PLACEHOLDER so normalization never adds UNSOURCED_DETAIL.
        if (values.length) {
          const joined = values.join("; ");
          block.body = /[.!?]$/.test(joined) ? joined : joined + ".";
          mergeRefs(
            block.refs,
            matched.map((f) => ({
              factId: factId(f),
              revision: f.revision as number,
            })),
          );
          changed = true;
        } else {
          block.body = SAFE_PLACEHOLDER;
          changed = true;
        }
      } else {
        // Body already quotes a matching citable fact: ensure those refs are attached.
        const beforeRefs = block.refs.length;
        mergeRefs(
          block.refs,
          matched.map((f) => ({
            factId: factId(f),
            revision: f.revision as number,
          })),
        );
        if (block.refs.length !== beforeRefs) changed = true;
      }
    }
  }

  if (!changed) return input;
  const before = validatePage(input, facts, context);
  const after = validatePage(out, facts, context);
  const known = new Set(before.map((i) => i.code));
  return after.length > before.length || after.some((i) => !known.has(i.code))
    ? input
    : out;
}
