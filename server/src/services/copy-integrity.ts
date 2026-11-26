// S35 acceptance fix: detect sentences whose figures were cut out mid-sentence,
// such as "Specify the VG- for …", "…: mm flat burrs" or "… and -day lead
// time". Such text appears when a rewrite deletes only the unsupported digits
// instead of the whole claim. Renderers and the deterministic draft repair drop
// those sentences whole; nothing here adds or rewrites wording.

const sentencesOf = (s: string) =>
  s
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

// Model/SKU code ending in a bare hyphen ("VG- for"), but not a suspended
// compound such as "EU- and US-made".
const DANGLING_CODE =
  /(?<![\p{L}\p{N}-])\p{Lu}[\p{Lu}\p{N}]{0,5}-(?=[\s,.;:!?)]|$)(?!\s+(?:and|or|to|&)(?=\s))/u;
// Compound modifier that lost its figure ("a -day lead time", "and -unit MOQ").
const DANGLING_MODIFIER =
  /(?:^|[\s(])-(?:day|week|month|year|hour|minute|unit|piece|pc|set|group|cup|litre|liter|bar|kg|mm|cm|ml|kw)s?(?!\p{L})/iu;
// Quantifier directly followed by a unit ("up to bar", "at least units").
const MISSING_QUANTITY =
  /\b(?:up to|at least|at most|approximately|more than|less than|between)\s+(?:mm|cm|kg|ml|kw|bar|psi|pcs|days?|weeks?|months?|hours?|units?|pieces?|groups?|cups?|litres?|liters?)\b/i;
// Abbreviated unit; checked below for a figure in front of it.
const UNIT = /(^|[^\p{L}\p{N}])(mm|cm|kg|ml|kw|pcs|sqm|%)(?![\p{L}\p{N}])/giu;

function bareUnit(text: string) {
  for (const m of text.matchAll(UNIT)) {
    const before = text.slice(0, (m.index ?? 0) + m[1].length).trimEnd();
    const prev = before.slice(-1);
    // "83 mm", "(mm)", "40×30 mm", "sizes in mm" and "price per kg" are intact.
    if (prev && /[\p{N}(/×]/u.test(prev)) continue;
    if (/\b(?:in|per)$/i.test(before)) continue;
    return true;
  }
  return false;
}

/** True when the text contains a phrase whose figure was removed. */
export function hasBrokenFragment(text: unknown): boolean {
  const t = String(text ?? "").normalize("NFKC");
  return (
    DANGLING_CODE.test(t) ||
    DANGLING_MODIFIER.test(t) ||
    MISSING_QUANTITY.test(t) ||
    bareUnit(t)
  );
}

/**
 * Returns the original text unchanged when it is intact; otherwise only its
 * intact sentences joined by a space ("" when none remain).
 */
export function intactSentences(text: unknown): string {
  const t = String(text ?? "");
  if (!hasBrokenFragment(t)) return t;
  return sentencesOf(t)
    .filter((s) => !hasBrokenFragment(s))
    .join(" ");
}
