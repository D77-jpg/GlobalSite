// S36 review fix: deterministic citation completion for generated drafts.
//
// When a draft already quotes the full value of a citable fact (confirmed, or
// an ai-suggested demo candidate while the site is in demo mode) but the block
// does not cite it, the fact gate reports the figure as unsourced and models
// tend to delete the number ("lead time days"). This step only ADDS the
// matching {factId, revision} refs; it never changes wording, never cites a
// fact of another product (FACT_SUBJECT_MISMATCH rule) and never exceeds the
// 50-ref schema limit. Figures must appear with the fact's unit, or in a
// sentence whose group keyword (MOQ, lead time, samples ...) matches the fact.
import type { PageInput } from "../../validators/sites.validator";
import {
  NUMBER_UNIT,
  identifierKeys,
  isDemoFact,
  matchesGroup,
  numberGroup,
  validatePage,
} from "../page-validation.service";

type Context = Parameters<typeof validatePage>[2];
type Fact = Parameters<typeof validatePage>[1][number];
type Ref = { factId: string; revision: number };
export type FactLike = {
  _id?: unknown;
  id?: unknown;
  status?: string;
  type?: string;
  value?: unknown;
  unit?: unknown;
  revision?: number;
  subjectType?: string;
  subjectId?: unknown;
  source?: { kind?: string } | null;
};
export type ProductName = { id: string; name: string };

export const REFS_MAX = 50;
const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const literal = (value: string) =>
  new RegExp(
    "(?<![\\p{L}\\p{N}_])(?<!\\d[.,])" +
      escapeRe(norm(value)) +
      "(?![\\p{L}\\p{N}_]|[.,]\\d)",
    "u",
  );
const FIGURE = new RegExp(
  "(\\d+(?:[.,]\\d+)*)\\s*-?\\s*(" + NUMBER_UNIT + ")?(?![\\p{L}])",
  "giu",
);
const singleQuantity = new RegExp(
  "^\\d+(?:[.,]\\d+)*(?:\\s*-?\\s*(?:" + NUMBER_UNIT + "))?$",
  "i",
);
function sentenceAt(text: string, index: number) {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  const end = text.indexOf(".", index);
  return text.slice(start, end < 0 ? undefined : end);
}
const unitKey = (u: string) => u.toLowerCase().replace(/s$/, "");

export function factId(f: FactLike) {
  return String(f._id ?? f.id ?? "");
}
/** Same citability rule as validatePage (confirmed, or demo candidates in demo mode). */
export function citableFact(f: FactLike, context: Context) {
  return (
    !!factId(f) &&
    typeof f.revision === "number" &&
    (f.status === "confirmed" || (!!context.allowDemoFacts && isDemoFact(f)))
  );
}
/** Same subject rule as validatePage's FACT_SUBJECT_MISMATCH. */
export function subjectAllowed(f: FactLike, context: Context) {
  return !(
    f.subjectType === "product" &&
    (!context.productIds.includes(String(f.subjectId)) ||
      (!!context.productId && String(f.subjectId) !== context.productId))
  );
}

/**
 * Index in `text` (already normalized with norm) where the fact value is
 * quoted, or -1. Non-numeric values need the full literal value. Numeric
 * values match the full literal, a figure written with the fact's unit
 * ("25 days", "25-day"), or the bare figure in a sentence whose group keyword
 * matches the fact type ("MOQ is 5").
 */
function quoteIndex(t: string, f: FactLike, blockKey: string | null) {
  const value = String(f.value ?? "").trim();
  if (!value) return -1;
  const unit = String(f.unit ?? "").trim();
  const full =
    unit && !norm(value).includes(norm(unit)) ? value + " " + unit : value;
  // A full value with words or a unit ("25 days", "Titanium alloy") counts
  // wherever it is quoted; a bare figure ("5") needs its group keyword below.
  const whole = literal(full).exec(t);
  if (whole && (!/\d/.test(full) || /[\p{L}%]/u.test(full))) return whole.index;
  if (!/\d/.test(value)) {
    const bare = literal(value).exec(t);
    return bare ? bare.index : -1;
  }
  if (!singleQuantity.test(norm(full))) return -1;
  const wanted = [...norm(full).matchAll(FIGURE)].map((m) => ({
    figure: m[1].replace(/,/g, ""),
    unit: m[2] ? unitKey(m[2]) : "",
  }));
  if (!wanted.length) return -1;
  for (const m of t.matchAll(FIGURE)) {
    const before = t[m.index - 1] ?? "";
    if (/[\p{L}\p{N}.,]/u.test(before) && !/[-\s]/.test(before)) continue;
    const figure = m[1].replace(/,/g, ""),
      u = m[2] ? unitKey(m[2]) : "";
    for (const w of wanted) {
      if (w.figure !== figure) continue;
      if (w.unit && u === w.unit) return m.index;
      const g = numberGroup(sentenceAt(t, m.index), blockKey);
      if (!u && g && matchesGroup(f, g)) return m.index;
    }
  }
  return -1;
}

/**
 * On pages that are not about one product, a sentence naming one of the
 * selected models ("VB-3G ships in 30 days") may only cite that model's facts.
 */
function namesOtherProduct(
  sentence: string,
  f: FactLike,
  products: ReadonlyArray<{ id: string; keys: Set<string> }>,
) {
  if (f.subjectType !== "product" || !products.length) return false;
  const said = identifierKeys([sentence]);
  if (!said.size) return false;
  const named = products.filter((p) => [...p.keys].some((k) => said.has(k)));
  return !!named.length && !named.some((p) => p.id === String(f.subjectId));
}

/** Facts whose value `text` quotes, in input order (already-cited ones skipped). */
export function quotedFacts(
  text: string,
  facts: Fact[],
  context: Context,
  blockKey: string | null,
  products: ReadonlyArray<ProductName> = [],
): FactLike[] {
  const t = norm(text);
  if (!t) return [];
  const named = context.productId
    ? []
    : products.map((p) => ({
        id: String(p.id),
        keys: identifierKeys([p.name]),
      }));
  const out: FactLike[] = [];
  for (const f of facts as FactLike[]) {
    if (!citableFact(f, context) || !subjectAllowed(f, context)) continue;
    const at = quoteIndex(t, f, blockKey);
    if (at < 0) continue;
    if (namesOtherProduct(sentenceAt(t, at), f, named)) continue;
    out.push(f);
  }
  return out;
}

/** Adds refs for quoted facts to `refs` (in place). Returns true when changed. */
export function citeQuotedFacts(
  refs: Ref[],
  text: string,
  facts: Fact[],
  context: Context,
  blockKey: string | null,
  products: ReadonlyArray<ProductName> = [],
  also: ReadonlyArray<Ref> = [],
): boolean {
  let changed = false;
  for (const f of quotedFacts(text, facts, context, blockKey, products)) {
    if (refs.length >= REFS_MAX) break;
    const id = factId(f);
    if (refs.some((r) => r.factId === id) || also.some((r) => r.factId === id))
      continue;
    refs.push({ factId: id, revision: f.revision as number });
    changed = true;
  }
  return changed;
}

/**
 * Completes missing citations across the page: SEO title, meta description
 * and presentation copy cite on page.refs; heading, body, alt, table and FAQ
 * text on the block; item text on the item (block refs already count there).
 * Returns the input object unchanged when nothing was added.
 */
export function completeFactRefs(
  input: PageInput,
  facts: Fact[],
  context: Context,
  products: ReadonlyArray<ProductName> = [],
): PageInput {
  const page = structuredClone(input);
  let changed = false;
  const p = page.presentation;
  const pageText = [
    page.title,
    page.metaDescription,
    p?.navigationLabel,
    p?.headline,
    p?.summary,
    p?.primaryActionLabel,
    p?.inquiryHeading,
    p?.inquiryLead,
  ];
  for (const value of pageText)
    if (
      value &&
      citeQuotedFacts(page.refs, value, facts, context, null, products)
    )
      changed = true;
  for (const b of page.blocks) {
    const texts = [
      b.heading,
      b.body,
      b.alt,
      ...(b.table
        ? [b.table.columns, ...b.table.rows].map((r) => r.join(" "))
        : []),
      ...b.faq.map((f) => f.question + " " + f.answer + " " + f.detail),
    ];
    for (const value of texts)
      if (
        value &&
        citeQuotedFacts(b.refs, value, facts, context, b.key, products)
      )
        changed = true;
    for (const item of b.items ?? [])
      if (
        citeQuotedFacts(
          item.refs,
          item.title + " " + item.body + " " + item.alt,
          facts,
          context,
          b.key,
          products,
          b.refs,
        )
      )
        changed = true;
  }
  return changed ? page : input;
}
