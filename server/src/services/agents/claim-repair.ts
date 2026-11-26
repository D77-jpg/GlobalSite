// S35: deterministic removal of unsupported claims in generated drafts.
// It never writes new wording or facts. It only removes what the fact gate
// rejected: items and table rows are dropped, offending sentences are cut
// from block bodies, and required product sections without matching facts
// fall back to the documented safe placeholder. The result is kept only when
// it strictly reduces validation issues and introduces no new issue codes.
import type { PageInput } from "../../validators/sites.validator";
import { validatePage, type Issue } from "../page-validation.service";
import { hasBrokenFragment, intactSentences } from "../copy-integrity";

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
  const summary = out.presentation?.summary;
  if (out.presentation && summary && hasBrokenFragment(summary)) {
    const kept = intactSentences(summary);
    if (kept) {
      out.presentation.summary = kept;
      changed = true;
    }
  }
  for (const block of out.blocks) {
    if (block.body && hasBrokenFragment(block.body)) {
      const required =
        context.type === "product" && REQUIRED_SECTIONS.includes(block.key);
      block.body =
        intactSentences(block.body) || (required ? SAFE_PLACEHOLDER : "");
      changed = true;
    }
    for (const item of block.items ?? [])
      if (item.body && hasBrokenFragment(item.body)) {
        item.body = intactSentences(item.body);
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
