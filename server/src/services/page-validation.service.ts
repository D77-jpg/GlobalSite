import { compositionIssues } from "./site-composition.service";
import type { PageInput } from "../validators/sites.validator";
import { productSections } from "../validators/sites.validator";
export type Issue = {
  code: string;
  field: string;
  blockKey: string | null;
  token: string;
};
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/[\s:-]+/g, "");
const numbers = (s: string) =>
  s.match(/\d+(?:[.,]\d+)*/g)?.map((x) => x.replace(/,/g, "")) ?? [];
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
function group(text: string) {
  return /\b(capacity|annual output|production output|produce)\b/i.test(text)
    ? "capacity"
    : /\b(founded|established|since|founding)\b/i.test(text)
      ? "founded"
      : /\b(moq|minimum order)\b/i.test(text)
        ? "moq"
        : /\b(lead time|delivery|sample)\b/i.test(text)
          ? "lead"
          : "";
}
const matchesGroup = (f: any, g: string) =>
  !g ||
  {
    capacity: /capacity|output|production/i,
    founded: /founded|founding|year|establish/i,
    moq: /moq|minimum|order/i,
    lead: /lead|delivery|sample/i,
  }[g]!.test(f.type);
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
    paths?: string[];
    requireComposition?: boolean;
  },
): Issue[] {
  const issues: Issue[] = [],
    factMap = new Map(facts.map((f) => [String(f._id ?? f.id), f]));
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
      if (!f || f.status !== "confirmed" || f.revision !== ref.revision) {
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
    if (/\p{Script=Han}/u.test(value)) add("CONTENT_NOT_ENGLISH", field, key);
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
      const token = words[match[0].toLowerCase()] ?? match[0].replace(/,/g, ""),
        start = Math.max(0, sanitized.lastIndexOf(".", match.index) + 1),
        end = sanitized.indexOf(".", match.index + match[0].length),
        sentence = sanitized.slice(start, end < 0 ? undefined : end),
        g =
          key === "moq" ? "moq" : key === "samples" ? "lead" : group(sentence);
      const unit = sanitized
        .slice(match.index + match[0].length)
        .match(
          /^\s*(kg|mm|cm|ml|tons?|tonnes?|units?|pieces?|pcs|days?|weeks?|years?|hours?|percent|kw|sqm|%)(?![a-z])/i,
        )?.[1]
        .toLowerCase();
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
    ] as const)
      text(data.presentation[field], data.refs, "presentation." + field, null);
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
            f.status === "confirmed" &&
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
                    ? "sample|lead|delivery"
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
        ["evidence", "case-study", "customization"].includes(b.type) &&
        !refs.length
      )
        add("UNSOURCED_DETAIL", "blocks." + b.key + ".items." + i, b.key);
      if (
        ["evidence", "case-study", "customization"].includes(b.type) &&
        refs.length &&
        !refs.some((r) => {
          const f = factMap.get(r.factId);
          return (
            f &&
            normalize(item.body + " " + item.title).includes(
              normalize(String(f.value)),
            )
          );
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
    for (const [f, i] of b.faq.map((f, i) => [f, i] as const)) {
      text(
        f.question + " " + f.answer + " " + f.detail,
        b.refs,
        "blocks." + b.key + ".faq." + i,
        b.key,
      );
      const count = f.answer.trim().split(/\s+/).filter(Boolean).length;
      if (
        count < 40 ||
        count > 60 ||
        /^(in this (article|guide)|let us|let's|it depends)/i.test(f.answer)
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
