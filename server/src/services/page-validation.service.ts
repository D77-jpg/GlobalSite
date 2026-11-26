import { compositionIssues } from "./site-composition.service";
import type { PageInput } from "../validators/sites.validator";
import { productSections } from "../validators/sites.validator";
export type Issue = {
  code: string;
  field: string;
  blockKey: string | null;
  token: string;
};
export const CONTENT_VALIDATION_VERSION = "s35-review-fixes";
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/[\s:-]+/g, "");
const numbers = (s: string) =>
  s.match(/\d+(?:[.,]\d+)*/g)?.map((x) => x.replace(/,/g, "")) ?? [];
/** Units read after a figure; a cited fact must carry the same unit. */
export const NUMBER_UNIT =
  "kg|mm|cm|ml|tons?|tonnes?|units?|pieces?|pcs|days?|weeks?|years?|hours?|percent|kw|sqm|%";
const explicitUnit = new RegExp(
  "^\\s*(?:[-\\u2010\\u2011]\\s*)?(" + NUMBER_UNIT + ")(?![a-z])",
  "i",
);
const legacyUnit = new RegExp("^\\s*(" + NUMBER_UNIT + ")(?![a-z])", "i");
// S36 review fix: model codes such as "VB-2G" or "VG-83" are identifiers, not
// numeric claims, when the same letter-digit token appears in a product name,
// the site name or a planned page title. Plain figures with units ("83 mm",
// "25 days") and codes that are not identifiers ("X-500") stay fact-gated.
const JOIN = /[-\u2010\u2011]/;
const IDENTIFIER_TOKEN = /[\p{L}\p{N}]+(?:[-\u2010\u2011][\p{L}\p{N}]+)*/gu;
const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const mixedToken = (s: string) => /\p{L}/u.test(s) && /\p{N}/u.test(s);
const identifierKey = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[-\u2010\u2011\s]+/g, "");
/** Normalized letter-digit tokens of the given names (and their hyphen prefixes). */
export function identifierKeys(values: ReadonlyArray<unknown>): Set<string> {
  const keys = new Set<string>();
  for (const value of values)
    for (const token of String(value ?? "")
      .normalize("NFKC")
      .match(IDENTIFIER_TOKEN) ?? []) {
      const parts = token.split(JOIN);
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join("");
        if (mixedToken(prefix)) keys.add(identifierKey(prefix));
      }
    }
  return keys;
}
/** The letter/digit token (inner hyphens included) around text[start, end). */
export function tokenAround(text: string, start: number, end: number) {
  let a = start,
    b = end;
  for (;;) {
    if (wordChar(text[a - 1])) a--;
    else if (JOIN.test(text[a - 1] ?? "") && wordChar(text[a - 2])) a -= 2;
    else break;
  }
  for (;;) {
    if (wordChar(text[b])) b++;
    else if (JOIN.test(text[b] ?? "") && wordChar(text[b + 1])) b += 2;
    else break;
  }
  return text.slice(a, b);
}
/** True when a figure at text[start, end) belongs to a known model identifier. */
export function isIdentifierFigure(
  text: string,
  start: number,
  end: number,
  keys: ReadonlySet<string>,
) {
  if (!keys.size) return false;
  const token = tokenAround(text, start, end);
  return mixedToken(token) && keys.has(identifierKey(token));
}
/**
 * Identifier sources for validatePage: the site name, product names and plan
 * node titles. Accepts strings and {name}/{title} objects (or arrays of them).
 */
export function validationIdentifiers(...groups: unknown[]): string[] {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 3 || out.size >= 500) return;
    if (typeof v === "string") {
      if (v.trim()) out.add(v.trim().slice(0, 200));
    } else if (Array.isArray(v)) for (const x of v) visit(x, depth + 1);
    else if (v && typeof v === "object") {
      const o = v as { name?: unknown; title?: unknown };
      if (typeof o.name === "string") visit(o.name, depth + 1);
      if (typeof o.title === "string") visit(o.title, depth + 1);
    }
  };
  for (const g of groups) visit(g, 0);
  return [...out];
}
const STOPWORDS = new Set(
  "a an and or the of for to in on with by from at as is are be your our we you it its this that these those per each any all into via can will".split(
    " ",
  ),
);
/** Lower-case content words for overlap checks (stopwords out, plural s trimmed). */
export function contentTokens(s: string): string[] {
  return (
    String(s ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .filter((w) => !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)))
    .map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
}
/**
 * S36 review fix: an item is supported by a cited fact when the full value is
 * quoted, or when the item shares at least `threshold` of the content words of
 * the value or of one listed option in it ("powder-coat colors, wood trim and
 * branded panels"). Figures in the item are still checked by the number gate.
 */
export function supportsText(value: unknown, text: string, threshold: number) {
  const v = String(value ?? "");
  if (!v.trim()) return false;
  if (normalize(text).includes(normalize(v))) return true;
  const have = new Set(contentTokens(text));
  return [v, ...v.split(/[,;/]|\band\b|\bor\b/i)].some((part) => {
    const want = [...new Set(contentTokens(part))];
    if (!want.length) return false;
    const shared = want.filter((w) => have.has(w)).length;
    return (
      shared >= Math.min(2, want.length) && shared / want.length >= threshold
    );
  });
}
const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
};
const words: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  hundred: "100",
  thousand: "1000",
  million: "1000000",
  zero: "0",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
};
function group(text: string, legacy: boolean) {
  return /\b(capacity|annual output|production output|produce)\b/i.test(text)
    ? "capacity"
    : /\b(founded|established|since|founding)\b/i.test(text)
      ? "founded"
      : /\b(moq|minimum order)\b/i.test(text)
        ? "moq"
        : (legacy
              ? /\b(lead time|delivery|sample)\b/i
              : /\b(lead time|delivery)\b/i
            ).test(text)
          ? "lead"
          : // S36 review fix: sample terms are their own group, so a lead time
            // can no longer stand in for sample availability.
            !legacy && /\bsamples?\b/i.test(text)
            ? "samples"
            : "";
}
/** Fact group a figure in this sentence/section must match ("" = any group). */
export function numberGroup(
  sentence: string,
  blockKey: string | null,
  legacy = false,
) {
  return blockKey === "moq"
    ? "moq"
    : blockKey === "samples"
      ? legacy
        ? "lead"
        : "samples"
      : group(sentence, legacy);
}
// S35 stage C: AI-suggested candidate facts are citable only while the site
// is in demo mode. They keep their real candidate status; approval, version and
// publication gates still require confirmed facts.
export const isDemoFact = (f: any) =>
  !!f && f.status === "candidate" && f.source?.kind === "ai-suggested";
const GROUP_TYPES: Record<string, RegExp> = {
  capacity: /capacity|output|production/i,
  founded: /founded|founding|year|establish/i,
  moq: /moq|minimum|order/i,
  lead: /lead|delivery|sample/i,
  samples: /sample/i,
};
export const matchesGroup = (f: any, g: string) =>
  !g || !!GROUP_TYPES[g]?.test(String(f?.type ?? ""));
/** S36 review fix: English FAQ direct-answer window (was 40–60 words). */
export const FAQ_MIN_WORDS = 30,
  FAQ_MAX_WORDS = 80;
const buyerAuditLanguage =
  /\b(?:is|are) (?:confirmed|listed|verified) (?:with|as|at)\b|\bconfirmed (?:labels?|details?|facts?|specifications?)\b|\b(?:ask|contact) (?:our|the) team to confirm\b|\baccording to (?:our|the) records\b|\bconfirmed (?:grinder |machine |product )?(?:moq|lead time)\b/i;
const internalFactLanguage =
  /\bsupplied (?:facts?|data|evidence|information)\b|\bthe facts? (?:confirms?|shows?|states?|lists?|indicates?|says?)\b|\bno \w+(?: \w+)? facts? (?:is|are|was|were|has been|have been) (?:supplied|provided|available|listed|given)\b|\bconfirmed (?:product |company |supplier |model )?facts?\b|\bfact (?:library|refs?|references?|sheets?|base)\b/i;
export function validatePage(
  data: PageInput,
  facts: any[],
  context: {
    navigationLabels?: string[];
    requiredProductSections?: string[];
    productId?: string | null;
    productIds: string[];
    type: string;
    brandName?: string;
    language?: string;
    paths?: string[];
    requireComposition?: boolean;
    allowDemoFacts?: boolean;
    /** S36: product names, site name and plan titles (model codes are not claims). */
    identifiers?: string[];
    /** Preserve the copy rules of an unchanged approval made before this revision. */
    legacyCopyRules?: boolean;
  },
): Issue[] {
  const legacy = !!context.legacyCopyRules,
    issues: Issue[] = [],
    factMap = new Map(facts.map((f) => [String(f._id ?? f.id), f])),
    identifiers = identifierKeys(legacy ? [] : (context.identifiers ?? []));
  const citable = (f: any) =>
    !!f &&
    (f.status === "confirmed" || (!!context.allowDemoFacts && isDemoFact(f)));
  const hasBuyerCopy =
    data.presentation?.inquiryHeading || data.presentation?.inquiryLead;
  // S36 review fix: designed pages (composition) also get the buyer-copy check;
  // older pages without either keep their former rules.
  const auditCopy = !!(
    hasBuyerCopy ||
    (!legacy && data.presentation?.composition)
  );
  const add = (code: string, field: string, key: string | null, token = "") => {
    if (
      issues.length < 500 &&
      !issues.some(
        (i) => i.code === code && i.field === field && i.token === token,
      )
    )
      issues.push({ code, field, blockKey: key, token: token.slice(0, 160) });
  };
  function text(
    value: string,
    refs: PageInput["refs"],
    field: string,
    key: string | null,
  ) {
    const candidates: any[] = [];
    for (const ref of refs) {
      const f = factMap.get(ref.factId);
      if (!f || !citable(f) || f.revision !== ref.revision) {
        add("FACT_REFERENCE_STALE", field, key, ref.factId);
        continue;
      }
      if (
        f.subjectType === "product" &&
        (!context.productIds.includes(String(f.subjectId)) ||
          (context.productId && String(f.subjectId) !== context.productId))
      ) {
        add("FACT_SUBJECT_MISMATCH", field, key, ref.factId);
        continue;
      }
      candidates.push(f);
    }
    for (const email of value.match(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    ) ?? [])
      if (
        !candidates.some(
          (f) =>
            /^company\.(email|privacyEmail)$/.test(f.type) &&
            String(f.value).toLowerCase().includes(email.toLowerCase()),
        )
      )
        add("UNSOURCED_CONTACT", field, key, email);
    if ((context.language ?? "en") === "en" && /\p{Script=Han}/u.test(value))
      add("CONTENT_NOT_ENGLISH", field, key);
    const sanitized = value
      .normalize("NFKC")
      .replace(/\bB2[BC]\b/gi, "business")
      .replace(/\bin one place\b/gi, "in a shared place")
      .replace(
        /\bone\s+(?:(?:multi-product|combined)\s+)?(?:quote\s+)?(?:request|inquiry|brief|shortlist|response|reply)\b/gi,
        "a combined brief",
      )
      .replace(/\b(?:each|any) one\b/gi, "each item");
    for (const match of sanitized.matchAll(
      new RegExp(
        "\\d+(?:[.,]\\d+)*|\\b(?:" + Object.keys(words).join("|") + ")\\b",
        "gi",
      ),
    )) {
      const unit = sanitized
        .slice(match.index + match[0].length)
        .match(legacy ? legacyUnit : explicitUnit)?.[1]
        .toLowerCase();
      if (
        !unit &&
        /\d/.test(match[0]) &&
        isIdentifierFigure(
          sanitized,
          match.index,
          match.index + match[0].length,
          identifiers,
        )
      )
        continue;
      const token = words[match[0].toLowerCase()] ?? match[0].replace(/,/g, ""),
        start = Math.max(0, sanitized.lastIndexOf(".", match.index) + 1),
        end = sanitized.indexOf(".", match.index + match[0].length),
        sentence = sanitized.slice(start, end < 0 ? undefined : end),
        g = numberGroup(sentence, key, legacy);
      const supported = candidates.some(
        (f) =>
          matchesGroup(f, g) &&
          numbers(String(f.value) + " " + (f.unit ?? "")).includes(token) &&
          (!unit ||
            normalize(String(f.value) + " " + (f.unit ?? "")).includes(
              normalize(unit.replace(/s$/, "")),
            )),
      );
      if (!supported) add("UNSOURCED_NUMBER", field, key, match[0]);
    }
    for (const m of value
      .normalize("NFKC")
      .matchAll(
        /\b(?:ISO(?:[ -]?\d{3,5}(?::\d{4})?)?|CE|FDA|REACH|RoHS|FSC|BSCI|GRS|GOTS|UL|SGS|TUV|IATF(?:[ -]?\d{3,5})?)\b/gi,
      )) {
      if (
        m[0].toLowerCase() === "reach" &&
        m[0] !== "REACH" &&
        !/certif|compli|standard|regulat/i.test(value)
      )
        continue;
      if (
        !candidates.some(
          (f) =>
            /cert|compliance|standard/i.test(f.type) &&
            normalize(String(f.value)).includes(normalize(m[0])),
        )
      )
        add("UNSOURCED_CERTIFICATION", field, key, m[0]);
    }
    if (
      /\b(founded|established)\b/i.test(value) &&
      !candidates.some(
        (f) =>
          matchesGroup(f, "founded") &&
          normalize(sanitized).includes(normalize(String(f.value))),
      )
    )
      add("UNSOURCED_YEAR", field, key, "year");
    // Pages using the buyer-copy fields (or a design composition) opt into
    // the editorial check.
    if (auditCopy && (context.language ?? "en") === "en") {
      // The documented safe placeholders for missing product details are exempt.
      const copy = value.replace(
        /Contact our team for confirmed details\.|Details available on request\.|Information to be confirmed\.|Not yet confirmed\.?/gi,
        "",
      );
      const audit =
        copy.match(buyerAuditLanguage) ??
        (legacy ? null : copy.match(internalFactLanguage));
      if (audit) add("COPY_AUDIT_LANGUAGE", field, key, audit[0]);
    }
    if (
      /\bcertified\b/i.test(value) &&
      !candidates.some((f) => /cert|compliance|standard/i.test(f.type))
    )
      add("UNSOURCED_CERTIFICATION", field, key, "certified");
    if (
      /\b(capacity|annual output|production output)\b/i.test(value) &&
      !candidates.some(
        (f) =>
          matchesGroup(f, "capacity") &&
          normalize(value).includes(normalize(String(f.value))),
      )
    )
      add("UNSOURCED_CAPACITY", field, key, "capacity");
  }
  if (context.requireComposition && !data.presentation?.composition)
    add("CONTENT_DESIGN_REQUIRED", "presentation", null);
  if (context.brandName) text(context.brandName, data.refs, "site.name", null);
  if (data.presentation) {
    for (const field of [
      "navigationLabel",
      "headline",
      "summary",
      "primaryActionLabel",
      "inquiryHeading",
      "inquiryLead",
    ] as const)
      if (data.presentation[field])
        text(
          data.presentation[field]!,
          data.refs,
          "presentation." + field,
          null,
        );
  }
  for (const label of context.navigationLabels ?? [])
    text(label, data.refs, "navigation", null);
  text(data.title, data.refs, "title", null);
  text(data.metaDescription, data.refs, "metaDescription", null);
  for (const b of data.blocks) {
    if (context.type === "product") {
      const known = b.refs
        .map((r) => factMap.get(r.factId))
        .filter(
          (f) =>
            f &&
            citable(f) &&
            b.refs.some(
              (r) =>
                r.factId === String(f._id ?? f.id) && r.revision === f.revision,
            ) &&
            (f.subjectType !== "product" ||
              String(f.subjectId) === context.productId),
        );
      if (
        [
          "material",
          "application",
          "oem",
          "packaging",
          "certifications",
          "moq",
          "samples",
        ].includes(b.key) &&
        b.body.trim() &&
        !/^(Contact our team for confirmed details\.|Details available on request\.|Information to be confirmed\.|Not yet confirmed\.?)$/i.test(
          b.body.trim(),
        ) &&
        !known.some(
          (f) =>
            new RegExp(
              b.key === "oem"
                ? "oem|odm"
                : b.key === "certifications"
                  ? "cert|compliance|standard"
                  : b.key === "samples"
                    ? legacy
                      ? "sample|lead|delivery"
                      : "sample"
                    : b.key,
              "i",
            ).test(f.type) &&
            normalize(b.body).includes(normalize(String(f.value))),
        )
      )
        add("UNSOURCED_DETAIL", "blocks." + b.key + ".body", b.key);
      if (b.key === "specs" && b.table)
        for (const [row, i] of b.table.rows.map((row, i) => [row, i] as const))
          if (
            !known.some((f) =>
              normalize(row.join(" ")).includes(normalize(String(f.value))),
            )
          )
            add("UNSOURCED_DETAIL", "blocks." + b.key + ".table." + i, b.key);
    }
    for (const [field, value] of Object.entries({
      heading: b.heading,
      body: b.body,
      alt: b.alt,
    }))
      text(value, b.refs, "blocks." + b.key + "." + field, b.key);
    for (const [i, item] of (b.items ?? []).entries()) {
      if (item.href && context.paths) {
        const [path, fragment] = item.href.split("#");
        const target = path.replace(/\/$/, "") || "/";
        const paths = [
          ...context.paths,
          "/catalogue.html",
          "/privacy-policy",
        ].map((p) => p.replace(/\/$/, "") || "/");
        const anchors = [
          "inquiry",
          "main",
          "collection",
          ...(!path ? data.blocks.map((b) => "block-" + b.key) : []),
        ];
        if (
          (path && !paths.includes(target)) ||
          (fragment && !anchors.includes(fragment))
        )
          add("PAGE_LINK_INVALID", "blocks." + b.key + ".items." + i, b.key);
      }
      const refs = [...b.refs, ...item.refs];
      text(
        item.title + " " + item.body + " " + item.alt,
        refs,
        "blocks." + b.key + ".items." + i,
        b.key,
      );
      if (item.assetId && b.type !== "downloads" && !item.alt.trim())
        add("IMAGE_ALT_REQUIRED", "blocks." + b.key + ".items." + i, b.key);
      if (
        [
          "evidence",
          "case-study",
          "customization",
          "metrics",
          "certifications",
        ].includes(b.type) &&
        !refs.length
      )
        add("UNSOURCED_DETAIL", "blocks." + b.key + ".items." + i, b.key);
      // S36 review fix: word overlap with the cited value (50% for
      // customization, 60% otherwise) also counts, so items no longer need the
      // literal value pasted onto their end.
      if (
        [
          "evidence",
          "case-study",
          "customization",
          "metrics",
          "certifications",
        ].includes(b.type) &&
        refs.length &&
        !refs.some((r) => {
          const f = factMap.get(r.factId);
          if (!f) return false;
          const itemText = item.body + " " + item.title;
          return !legacy && b.type === "customization"
            ? supportsText(f.value, itemText, 0.5)
            : normalize(itemText).includes(normalize(String(f.value)));
        })
      )
        add("UNSOURCED_DETAIL", "blocks." + b.key + ".items." + i, b.key);
    }
    if (b.type === "comparison" && !b.table)
      add("SPEC_TABLE_REQUIRED", "blocks." + b.key, b.key);
    if (b.table)
      for (const [row, i] of [...[b.table.columns], ...b.table.rows].map(
        (r, i) => [r, i] as const,
      ))
        text(row.join(" "), b.refs, "blocks." + b.key + ".table." + i, b.key);
    const answers = legacy
      ? []
      : b.faq.map((f) => ({
          plain: f.answer
            .normalize("NFKC")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim(),
          tokens: new Set(contentTokens(f.answer)),
        }));
    for (const [f, i] of b.faq.map((f, i) => [f, i] as const)) {
      // S36 review fix: answers repeated across questions in one block.
      const twin = legacy
        ? -1
        : answers
            .slice(0, i)
            .findIndex(
              (a) =>
                a.plain === answers[i].plain ||
                jaccard(a.tokens, answers[i].tokens) >= 0.8,
            );
      if (twin >= 0)
        add(
          "FAQ_DUPLICATE_ANSWER",
          "blocks." + b.key + ".faq." + i,
          b.key,
          String(twin),
        );
      text(
        f.question + " " + f.answer + " " + f.detail,
        b.refs,
        "blocks." + b.key + ".faq." + i,
        b.key,
      );
      const count = f.answer.trim().split(/\s+/).filter(Boolean).length;
      if (
        (context.language ?? "en") === "en" &&
        (count < (legacy ? 40 : FAQ_MIN_WORDS) ||
          count > (legacy ? 60 : FAQ_MAX_WORDS) ||
          /^(in this (article|guide)|let us|let's|it depends)/i.test(f.answer))
      )
        add(
          "FAQ_DIRECT_ANSWER_REQUIRED",
          "blocks." + b.key + ".faq." + i,
          b.key,
          String(count),
        );
    }
    if (b.type === "image" && (!b.assetId || !b.alt.trim()))
      add("IMAGE_ALT_REQUIRED", "blocks." + b.key, b.key);
    if (b.type === "specs" && !b.table)
      add("SPEC_TABLE_REQUIRED", "blocks." + b.key, b.key);
  }
  if (context.type === "product")
    for (const key of context.requiredProductSections ?? productSections)
      if (
        !data.blocks.some(
          (b) => b.key === key && (key !== "specs" || b.type === "specs"),
        )
      )
        add("PRODUCT_SECTION_REQUIRED", "blocks." + key, key, key);
  return [...issues, ...compositionIssues(data, context.type)];
}
export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function renderPage(data: PageInput, site: any) {
  const esc = escapeHtml;
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    esc(data.title) +
    '</title><meta name="description" content="' +
    esc(data.metaDescription) +
    '"><style>body{font:16px/1.7 system-ui;margin:0;color:#243834;background:#fff}header,main,footer{max-width:1040px;margin:auto;padding:24px}header{border-bottom:4px solid ' +
    site.brandColor +
    "}section{padding:20px 0;border-bottom:1px solid #e2e8e4}h1{line-height:1.2}p{white-space:pre-wrap}table{border-collapse:collapse;width:100%;display:block;overflow:auto}td,th{border:1px solid #dce5df;padding:12px;text-align:left}img{max-width:100%;height:auto}header img{max-height:64px}h2{color:" +
    site.brandColor +
    "}</style></head><body><header>" +
    (site.logoId
      ? '<img src="/api/v1/assets/' +
        site.logoId +
        '" alt="' +
        esc(site.name) +
        '">'
      : "") +
    "<strong>" +
    esc(site.name) +
    "</strong></header><main><h1>" +
    esc(data.presentation?.headline ?? data.title) +
    "</h1>" +
    data.blocks
      .map(
        (b) =>
          "<section><h2>" +
          esc(b.heading) +
          "</h2><p>" +
          esc(b.body) +
          "</p>" +
          (b.table
            ? "<table><thead><tr>" +
              b.table.columns.map((c) => "<th>" + esc(c) + "</th>").join("") +
              "</tr></thead><tbody>" +
              b.table.rows
                .map(
                  (r) =>
                    "<tr>" +
                    r.map((c) => "<td>" + esc(c) + "</td>").join("") +
                    "</tr>",
                )
                .join("") +
              "</tbody></table>"
            : "") +
          b.faq
            .map(
              (f) =>
                "<article><h3>" +
                esc(f.question) +
                "</h3><p>" +
                esc(f.answer) +
                "</p><p>" +
                esc(f.detail) +
                "</p></article>",
            )
            .join("") +
          (b.type === "image" && b.assetId
            ? '<img src="/api/v1/assets/' +
              b.assetId +
              '" alt="' +
              esc(b.alt) +
              '">'
            : "") +
          "</section>",
      )
      .join("") +
    "</main><footer>Preview · Not published</footer></body></html>"
  );
}
