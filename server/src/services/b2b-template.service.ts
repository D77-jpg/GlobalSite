import { sectionClasses } from "./section-design.service";
import { getStorefrontCopy } from "./storefront-i18n.service";
import { intactSentences } from "./copy-integrity";
import type { Snapshot } from "./static-template.service";

const e = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export const pendingDetail = (v: string) =>
  /^(Contact our team for confirmed details\.|Details available on request\.|Information to be confirmed\.|Not yet confirmed\.?)$/i.test(
    v?.trim() ?? "",
  );

// S35 acceptance fix: product-card copy never shows a sentence whose figures
// were cut out ("Specify the VG- for …"). Intact summaries are returned as-is;
// otherwise only intact sentences, then the intact SEO description, else "".
export function cardSummary(v: any): string {
  const summary = v?.presentation?.summary;
  if (typeof summary !== "string" || !summary) return "";
  const kept = intactSentences(summary);
  if (kept) return kept;
  const meta = intactSentences(v?.metaDescription ?? "");
  return meta && !pendingDetail(meta) ? meta : "";
}

// S35 acceptance fix: card spec values skip placeholders and buying notes
// ("Confirm exact model code … on the quote") and Model/Name rows that only
// repeat the card title. On rendering-pack pages rows with figures come first.
const NOTE_VALUE =
  /^(?:confirm|review|check|verify|ask|contact|discuss|request|specify|share|tell us|please|subject to)\b|\b(?:on|in|with|via) (?:the|your|a|each) (?:quote|quotation|inquiry|enquiry|order)\b|\b(?:to be confirmed|tbc|tbd|on request|upon request)\b/i;
// Imperative guidance sentences ("Map the three-grouphead layout to …").
// Only whole sentences of four or more words ending in a full stop count, so
// spec values such as "Matte black" or "Plan view 600 mm" are not notes.
const INSTRUCTION_START =
  /^(?:map|plan|match|choose|select|share|include|send|ask|confirm|check|discuss|specify|review|use|tell|verify|contact|request|provide|compare|consider|attach|prepare|mention|align|agree|define)\b/i;
export function instructionNote(value: unknown) {
  const t = String(value ?? "").trim();
  return (
    INSTRUCTION_START.test(t) &&
    /[.!?]$/.test(t) &&
    t.split(/\s+/).length >= 4
  );
}
export function specNote(value: unknown) {
  const t = String(value ?? "").trim();
  return (
    !t ||
    /^[-–—·]+$/.test(t) ||
    pendingDetail(t) ||
    NOTE_VALUE.test(t) ||
    instructionNote(t) ||
    (t.split(/\s+/).length > 8 && /[.!?]$/.test(t))
  );
}
const IDENTITY_LABEL =
  /^(?:model|model name|model no\.?|model number|name|product|product name|item)$/i;
const plainText = (x: string) =>
  x
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const modelCodes = (x: string) =>
  (
    x
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
  ).filter((w) => /\p{N}/u.test(w) && /\p{L}/u.test(w));
function repeatsTitle(label: string, value: string, titles: string[]) {
  if (!IDENTITY_LABEL.test(label.trim())) return false;
  const v = plainText(value),
    raw = value.normalize("NFKC").toLowerCase();
  return titles.some((title) => {
    const t = plainText(title);
    if (!t || !v) return false;
    return (
      v.includes(t) ||
      t.includes(v) ||
      modelCodes(title).some((code) => raw.includes(code))
    );
  });
}

// S35 acceptance fix (spec tables): buying-note columns and cells never reach
// public spec, comparison or catalogue tables. A column is a note column when
// its heading names notes/guidance, or when every filled cell is a note. The
// first column is the row label and is always kept.
const NOTE_COLUMN =
  /\b(?:notes?|remarks?|comments?|guidance|buyers?|buying|purchas\w*|planning|how to|tips?)\b/i;
const dashCell = (x: string) => /^[-–—·]+$/.test(x.trim());
const placeholderCell = (x: string) => dashCell(x) || pendingDetail(x);
const noteCell = (x: string) => {
  const t = x.trim();
  return (
    !!t && !placeholderCell(t) && (NOTE_VALUE.test(t) || instructionNote(t))
  );
};
const realCell = (x: string) =>
  !!x.trim() && !placeholderCell(x) && !noteCell(x);
function cellRows(rows: unknown): string[][] {
  return Array.isArray(rows)
    ? rows.map((r) =>
        Array.isArray(r) ? r.map((x) => String(x ?? "")) : [String(r ?? "")],
      )
    : [];
}
function valueColumns(heads: string[], rows: string[][]): number[] {
  const width = Math.max(heads.length, 0, ...rows.map((r) => r.length));
  const all: number[] = [];
  for (let i = 1; i < width; i++) all.push(i);
  const byContent = new Set(
    all.filter((i) => {
      const filled = rows
        .map((r) => (r[i] ?? "").trim())
        .filter((x) => x && !placeholderCell(x));
      return filled.length > 0 && filled.every(noteCell);
    }),
  );
  const content = all.filter((i) => !byContent.has(i));
  const kept = content.filter((i) => !NOTE_COLUMN.test(heads[i] ?? ""));
  // A heading alone never removes every value column.
  return kept.length ? kept : content;
}
/** Titles a Model/Name row may repeat on this page (card, headline, product). */
export function pageTitles(s: Snapshot, p: any): string[] {
  return [
    p?.presentation?.navigationLabel,
    p?.presentation?.headline,
    String(p?.title ?? "").split("|")[0].trim(),
    s.products?.find((x) => x.id === p?.productId)?.name,
  ].filter((x): x is string => typeof x === "string" && !!x.trim());
}
/**
 * Public view of a spec/comparison table: note columns removed, single note
 * cells blanked, rows with neither a value nor a pending placeholder dropped
 * and, when titles are given, Model/Name rows repeating the page title
 * dropped. A table whose rows hold no real value returns no rows, so callers
 * fall back to the "information on request" summary instead of an empty table.
 */
export type PublicTable = { columns: string[]; rows: string[][] };
export function publicTable(
  table: unknown,
  titles: string[] = [],
): PublicTable {
  const t = (table ?? {}) as { columns?: unknown; rows?: unknown };
  const heads = Array.isArray(t.columns)
    ? t.columns.map((c) => String(c ?? ""))
    : [];
  const rows = cellRows(t.rows);
  if (Math.max(heads.length, 0, ...rows.map((r) => r.length)) <= 1) {
    // Single-column table: the only column carries the values.
    const single = rows.filter((r) => realCell(r[0] ?? ""));
    return {
      columns: heads.slice(0, 1),
      rows: single.map((r) => r.slice(0, 1)),
    };
  }
  const values = valueColumns(heads, rows);
  // Every value column holds only buying notes: nothing public remains.
  if (!values.length) return { columns: [], rows: [] };
  const keep = [0, ...values];
  const informative = (r: string[]) =>
    values.some((i) => realCell(r[i] ?? "") || placeholderCell(r[i] ?? ""));
  let kept = rows.filter(
    (r) =>
      informative(r) &&
      !(titles.length && repeatsTitle(r[0] ?? "", r[values[0]] ?? "", titles)),
  );
  if (!kept.some((r) => values.some((i) => realCell(r[i] ?? "")))) kept = [];
  return {
    columns: keep.map((i) => heads[i] ?? ""),
    rows: kept.map((r) =>
      keep.map((i) => {
        const x = r[i] ?? "";
        return i > 0 && noteCell(x) ? "" : x;
      }),
    ),
  };
}
export function cardSpecs(v: any, titles: string[], preferFigures = false) {
  const table = v.blocks.find(
    (b: any) => b.type === "specs" && b.table?.rows?.length,
  )?.table;
  const rows = cellRows(table?.rows);
  const heads: string[] = Array.isArray(table?.columns)
    ? table.columns.map((c: unknown) => String(c ?? ""))
    : [];
  // Only the first value column (the specification value) is shown on cards.
  const column = valueColumns(heads, rows)[0];
  if (column === undefined) return [];
  const specs = rows
    .map((r) => ({ label: r[0] ?? "", value: (r[column] ?? "").trim() }))
    .filter(
      (r) =>
        r.value &&
        !specNote(r.value) &&
        !repeatsTitle(r.label, r.value, titles),
    );
  if (preferFigures)
    specs.sort((a, b) => Number(/\d/.test(b.value)) - Number(/\d/.test(a.value)));
  return specs.slice(0, 2);
}
const packOf = (s: Snapshot, p: any): string | undefined => {
  const home = s.pages.find((v) => v.path === "/");
  return (
    s.site.designDirection?.composition ??
    home?.presentation?.composition ??
    p?.presentation?.composition
  )?.pack;
};

// S35 acceptance fix: href of the action a cta block renders (same rule as below).
export function ctaTarget(b: any): string {
  return (
    (b.items ?? []).filter((i: any) => !pendingDetail(i.body))[0]?.href ??
    "#inquiry"
  );
}

// S35: localized "Illustrative" label for generated concept images.
const ILLUSTRATIVE: Record<string, string> = {
  en: "Illustrative",
  es: "Ilustrativa",
  fr: "Illustration",
  de: "Illustrativ",
  ja: "イメージ",
  ar: "صورة توضيحية",
  ru: "Иллюстрация",
  zh: "示意图",
};
export function conceptNote(s: Snapshot, id?: string | null) {
  return id && s.assets[id]?.concept
    ? '<small class="concept-note">' +
        e(ILLUSTRATIVE[s.site.language] ?? ILLUSTRATIVE.en) +
        "</small>"
    : "";
}

function productImage(s: Snapshot, v: any, fallbackId?: string | null) {
  const source = s.products?.find((x) => x.id === v.productId);
  const id =
    v.blocks.find((b: any) => b.type === "image" && s.assets[b.assetId])
      ?.assetId ??
    source?.assetIds.filter((id) => s.assets[id]).at(-1) ??
    // S35: grid item illustration is used only when the product has no image.
    (fallbackId && s.assets[fallbackId] ? fallbackId : undefined);
  const a = id ? s.assets[id] : null;
  return a
    ? '<img loading="lazy" src="' +
        e(a.path) +
        '" alt="' +
        e(v.presentation?.headline ?? v.title.split("|")[0].trim()) +
        '" width="' +
        a.width +
        '" height="' +
        a.height +
        '">' +
        conceptNote(s, id)
    : "";
}

export function productGuide(s: Snapshot, p: any) {
  const copy = getStorefrontCopy(s.site.language);
  const links = p.blocks.filter(
    (b: any) =>
      (b.type === "specs" &&
        publicTable(b.table, pageTitles(s, p)).rows.length > 0) ||
      (b.type === "faq" && b.faq?.length) ||
      (b.type === "gallery" && b.items?.some((i: any) => i.assetId && s.assets[i.assetId])) ||
      (b.type === "downloads" &&
        b.items?.some((i: any) => s.assets[i.assetId]?.path.endsWith(".pdf"))),
  );
  if (!links.length) return "";
  return (
    '<nav class="product-guide" aria-label="' +
    e(copy.productInfoNav) +
    '">' +
    links
      .map(
        (b: any) =>
          '<a href="#block-' +
          e(b.key) +
          '">' +
          e(
            b.heading ||
              (b.type === "faq" ? copy.questions : copy.specifications),
          ) +
          "</a>",
      )
      .join("") +
    '<a href="#inquiry">' +
    e(copy.inquireAboutProduct) +
    "</a></nav>"
  );
}

export function productCards(
  s: Snapshot,
  p: any,
  heading?: string,
  body = "",
  design?: unknown,
  selection?: string[],
  itemAssets?: Record<string, string>,
) {
  const copy = getStorefrontCopy(s.site.language);
  const resolvedHeading = heading || copy.exploreRangeHeading;
  const products = s.pages.filter((v) => v.type === "product"),
    categories = s.pages.filter((v) => v.type === "category");
  const selected =
    p.type === "category"
      ? products.filter((v) =>
          v.path.startsWith(p.path.replace(/\/$/, "") + "/"),
        )
      : products;
  const available = selected.length ? selected : products;
  const rows = selection?.length
    ? selection
        .map((path) => available.find((v) => v.path === path))
        .filter(Boolean)
    : available;
  if (!rows.length) return "";
  const lineSheet =
    p.type === "home" &&
    !s.site.designDirection?.composition &&
    !p.presentation?.composition &&
    p.blocks.some((b: any) => b.type === "category-grid");
  return (
    '<section class="b2b-section catalog-section' +
    (lineSheet ? " line-sheet" : "") +
    sectionClasses(design) +
    '" id="collection"><div class="section-heading"><div><p class="section-kicker">' +
    e(copy.productRangeKicker) +
    "</p><h2>" +
    e(resolvedHeading) +
    "</h2>" +
    (body && !pendingDetail(body) ? "<p>" + e(body) + "</p>" : "") +
    '</div><a class="text-link" href="/catalogue.html" download>' +
    e(copy.downloadCatalogue) +
    '</a></div><div class="catalog-tools" data-catalog-tools hidden><label>' +
    e(copy.findProduct) +
    '<input type="search" data-product-search placeholder="' +
    e(copy.searchPlaceholder) +
    '"></label><label>' +
    e(copy.categoryLabel) +
    '<select data-category-filter><option value="">' +
    e(copy.allCategories) +
    "</option>" +
    categories
      .map(
        (c) =>
          '<option value="' +
          e(c.path) +
          '">' +
          e(c.presentation?.navigationLabel ?? c.title.split("|")[0]) +
          "</option>",
      )
      .join("") +
    '</select></label><p role="status" data-filter-status></p></div><div class="product-grid">' +
    rows
      .map((v) => {
        const category = categories.find((c) =>
          v.path.startsWith(c.path.replace(/\/$/, "") + "/"),
        );
        const cardTitle =
          v.presentation?.navigationLabel ?? v.title.split("|")[0].trim();
        const specs = cardSpecs(
          v,
          [
            cardTitle,
            v.title.split("|")[0].trim(),
            s.products?.find((x) => x.id === v.productId)?.name ?? "",
          ],
          !!packOf(s, p),
        );
        const summary = cardSummary(v);
        return (
          '<article class="product-card" data-product-card data-category="' +
          e(category?.path ?? "") +
          '" data-product-name="' +
          e(v.title) +
          '"><a class="product-visual" href="' +
          e(v.path) +
          '" tabindex="-1" aria-hidden="true">' +
          productImage(s, v, itemAssets?.[v.path]) +
          '</a><div class="product-copy"><p class="product-category">' +
          e(
            category?.presentation?.navigationLabel ??
              category?.title.split("|")[0] ??
              copy.navDefaults.category,
          ) +
          '</p><h3><a href="' +
          e(v.path) +
          '">' +
          e(cardTitle) +
          "</a></h3>" +
          (summary ? "<p>" + e(summary) + "</p>" : "") +
          (specs.length
            ? '<dl class="card-specs">' +
              specs
                .map(
                  (r) =>
                    "<div><dt>" +
                    e(r.label) +
                    "</dt><dd>" +
                    e(r.value) +
                    "</dd></div>",
                )
                .join("") +
              "</dl>"
            : "") +
          '<div class="card-actions"><a class="text-link" href="' +
          e(v.path) +
          '">' +
          e(copy.viewDetails) +
          '</a><button type="button" class="quote-add" data-quote-add="' +
          e(v.productId) +
          '">' +
          e(copy.addToInquiry) +
          "</button></div></div></article>"
        );
      })
      .join("") +
    '</div><p data-no-products hidden>' +
    e(copy.noMatchingProducts) +
    "</p></section>"
  );
}

export function renderB2BBlock(s: Snapshot, p: any, b: any): string | null {
  if (["text", "image", "specs", "faq"].includes(b.type)) return null;
  const copy = getStorefrontCopy(s.site.language);
  if (b.type === "product-grid")
    return productCards(
      s,
      p,
      b.heading,
      b.body,
      b.design,
      b.design
        ? b.items
            ?.map((i: any) => i.href)
            .filter(
              (href: any) => typeof href === "string" && href.startsWith("/"),
            )
        : undefined,
      Object.fromEntries(
        (b.items ?? [])
          .filter((i: any) => typeof i.href === "string" && i.assetId)
          .map((i: any) => [i.href, i.assetId]),
      ),
    );
  const a = b.assetId ? s.assets[b.assetId] : null,
    items = (b.items ?? []).filter((i: any) => !pendingDetail(i.body));
  const picture = (id: string, alt: string) =>
    s.assets[id]
      ? '<img loading="lazy" src="' +
        e(s.assets[id].path) +
        '" alt="' +
        e(alt) +
        '" width="' +
        s.assets[id].width +
        '" height="' +
        s.assets[id].height +
        '">' +
        conceptNote(s, id)
      : "";
  const heading =
    '<div class="section-intro"><p class="section-kicker">' +
    e(copy.blockKickers[b.type] ?? "") +
    "</p><h2>" +
    e(b.heading) +
    "</h2>" +
    (b.body && !pendingDetail(b.body) ? "<p>" + e(b.body) + "</p>" : "") +
    "</div>";
  let content = "";
  if (b.type === "category-grid") {
    const categories = s.pages.filter((v) => v.type === "category");
    const products = s.pages.filter((v) => v.type === "product");
    const available =
      categories.length < 2 && products.length ? products : categories;
    const listed = (b.items ?? [])
      .filter((i: any) => i.href)
      .map((i: any) => available.find((v) => v.path === i.href))
      .filter(Boolean);
    const destinations =
      b.design && listed.length
        ? ([...new Map(listed.map((p: any) => [p.path, p])).values()] as any[])
        : available;
    if (!destinations.length) return "";
    content =
      '<div class="category-grid">' +
      destinations
        .map((v) => {
          const child = products.find((product) =>
            product.path.startsWith(v.path.replace(/\/$/, "") + "/"),
          );
          const card = (b.items ?? []).find(
            (item: any) => item.href === v.path,
          );
          const visual =
            (card?.assetId ? picture(card.assetId, card.alt) : "") ||
            productImage(s, v) ||
            (child ? productImage(s, child) : "");
          const title =
            card?.title ||
            v.presentation?.navigationLabel ||
            v.title.split("|")[0].trim();
          const description =
            card?.body && !pendingDetail(card.body)
              ? "<small>" + e(card.body) + "</small>"
              : "";
          return (
            '<a href="' +
            e(v.path) +
            '">' +
            visual +
            "<span>" +
            e(title) +
            '</span><span aria-hidden="true">↗</span>' +
            description +
            "</a>"
          );
        })
        .join("") +
      "</div>";
  } else if (b.type === "gallery") {
    const photos = items.filter(
      (i: any) => i.assetId && s.assets[i.assetId] && !s.assets[i.assetId].path.endsWith(".pdf"),
    );
    if (!photos.length) return "";
    content =
      '<div class="media-gallery" data-lightbox-group="' +
      e(b.key) +
      '">' +
      photos
        .map((i: any, idx: number) => {
          const asset = s.assets[i.assetId];
          const alt = i.alt || i.title || b.heading;
          const caption = [i.title, i.body].filter(Boolean).join(" — ");
          return (
            '<figure class="gallery-item"><button type="button" class="gallery-trigger" data-lightbox-trigger data-lightbox-group="' +
            e(b.key) +
            '" data-lightbox-index="' +
            idx +
            '" data-lightbox-src="' +
            e(asset.path) +
            '" data-lightbox-alt="' +
            e(alt) +
            '" data-lightbox-caption="' +
            e(caption) +
            '" aria-label="' +
            e(copy.inspectImage + ": " + alt) +
            '">' +
            picture(i.assetId, alt) +
            "</button>" +
            (i.title || i.body
              ? "<figcaption>" +
                (i.title ? "<strong>" + e(i.title) + "</strong>" : "") +
                (i.body ? "<span>" + e(i.body) + "</span>" : "") +
                "</figcaption>"
              : "") +
            "</figure>"
          );
        })
        .join("") +
      "</div>";
  } else if (b.type === "metrics") {
    const verified = items.filter((i: any) => i.refs?.length || b.refs?.length);
    if (!verified.length) return "";
    content =
      '<dl class="metrics-strip">' +
      verified
        .map(
          (i: any) =>
            '<div class="metric-card"><dt>' +
            e(i.title) +
            "</dt><dd>" +
            e(i.body) +
            "</dd></div>",
        )
        .join("") +
      "</dl>";
  } else if (b.type === "certifications") {
    const verified = items.filter((i: any) => i.refs?.length || b.refs?.length);
    if (!verified.length) return "";
    content =
      '<div class="cert-wall">' +
      verified
        .map((i: any) => {
          const asset = i.assetId ? s.assets[i.assetId] : null;
          const isPdf =
            asset &&
            (asset.path.endsWith(".pdf") || asset.mime === "application/pdf");
          return (
            '<article class="cert-card">' +
            (asset && !isPdf
              ? '<div class="cert-media">' +
                picture(i.assetId, i.alt || i.title) +
                "</div>"
              : "") +
            '<div class="cert-copy"><span class="cert-badge">' +
            e(copy.verifiedFactBadge) +
            "</span><h3>" +
            e(i.title) +
            "</h3><p>" +
            e(i.body) +
            "</p>" +
            (isPdf
              ? '<a class="text-link" download href="' +
                e(asset.path) +
                '">' +
                e(copy.downloadDocument) +
                "</a>"
              : i.href
                ? '<a class="text-link" href="' +
                  e(i.href) +
                  '">' +
                  e(copy.exploreDetails) +
                  "</a>"
                : "") +
            "</div></article>"
          );
        })
        .join("") +
      "</div>";
  } else if (b.type === "showcase") {
    if (!items.length) return "";
    content =
      '<div class="showcase-grid">' +
      items
        .map(
          (i: any, idx: number) =>
            '<article class="showcase-card' +
            (idx === 0 ? " showcase-lead" : "") +
            '">' +
            (i.assetId && s.assets[i.assetId]
              ? '<div class="showcase-visual">' +
                picture(i.assetId, i.alt || i.title) +
                "</div>"
              : "") +
            '<div class="showcase-copy"><h3>' +
            e(i.title) +
            "</h3><p>" +
            e(i.body) +
            "</p>" +
            (i.href
              ? '<a class="text-link" href="' +
                e(i.href) +
                '">' +
                e(copy.exploreDetails) +
                "</a>"
              : "") +
            "</div></article>",
        )
        .join("") +
      "</div>";
  } else if (b.type === "split")
    content =
      (a ? "<figure>" + picture(b.assetId, b.alt) + "</figure>" : "") +
      '<div class="split-copy">' +
      heading +
      items
        .map((i: any) => "<h3>" + e(i.title) + "</h3><p>" + e(i.body) + "</p>")
        .join("") +
      "</div>";
  else if (b.type === "cta")
    content =
      '<div class="cta-band">' +
      heading +
      '<a class="cta" href="' +
      e(items[0]?.href ?? "#inquiry") +
      '">' +
      e(items[0]?.title ?? copy.discussRequirements) +
      "</a></div>";
  else if (b.type === "comparison") {
    // S35 acceptance fix: no buying-note columns/cells, and no empty table.
    const table = publicTable(b.table);
    content = table.rows.length
      ? '<div class="table-scroll"><table><caption>' +
        e(b.heading) +
        "</caption><thead><tr>" +
        table.columns
          .map((v) => '<th scope="col">' + e(v) + "</th>")
          .join("") +
        "</tr></thead><tbody>" +
        table.rows
          .map(
            (r) =>
              "<tr>" + r.map((v) => "<td>" + e(v) + "</td>").join("") + "</tr>",
          )
          .join("") +
        "</tbody></table></div>"
      : "";
  } else if (b.type === "downloads")
    content =
      '<div class="resource-grid">' +
      items
        .filter(
          (i: any) =>
            i.assetId &&
            (s.assets[i.assetId]?.path.endsWith(".pdf") ||
              s.assets[i.assetId]?.mime === "application/pdf"),
        )
        .map(
          (i: any) =>
            '<article><span class="resource-type">' +
            e(copy.pdfDocument) +
            "</span><h3>" +
            e(i.title) +
            "</h3><p>" +
            e(i.body) +
            '</p><a class="text-link" download href="' +
            e(s.assets[i.assetId].path) +
            '">' +
            e(copy.downloadDocument) +
            "</a></article>",
        )
        .join("") +
      '<article><span class="resource-type">' +
      e(copy.productCatalogueTag) +
      "</span><h3>" +
      e(copy.browseCurrentRange) +
      "</h3><p>" +
      e(copy.saveCatalogueNote) +
      '</p><a class="text-link" href="/catalogue.html" download>' +
      e(copy.downloadCatalogue) +
      "</a></article></div>";
  else
    content =
      "<" +
      (b.type === "process" ? "ol" : "div") +
      ' class="' +
      (b.type === "process" ? "process-grid" : "feature-grid") +
      '">' +
      items
        .filter(
          (i: any) =>
            !["evidence", "case-study", "customization"].includes(b.type) ||
            i.refs?.length ||
            b.refs?.length,
        )
        .map(
          (i: any) =>
            "<" +
            (b.type === "process" ? "li" : "article") +
            ">" +
            (i.assetId ? picture(i.assetId, i.alt) : "") +
            "<h3>" +
            e(i.title) +
            "</h3><p>" +
            e(i.body) +
            "</p>" +
            (i.href
              ? '<a class="text-link" href="' +
                e(i.href) +
                '">' +
                e(copy.exploreDetails) +
                "</a>"
              : "") +
            "</" +
            (b.type === "process" ? "li" : "article") +
            ">",
        )
        .join("") +
      "</" +
      (b.type === "process" ? "ol" : "div") +
      ">";
  if (
    !content ||
    ([
      "evidence",
      "case-study",
      "customization",
      "metrics",
      "certifications",
    ].includes(b.type) &&
      !items.some((i: any) => i.refs?.length || b.refs?.length))
  )
    return "";
  return (
    '<section class="b2b-section block-' +
    e(b.type) +
    " layout-" +
    e(b.layout ?? "cards") +
    " tone-" +
    e(b.tone ?? "light") +
    sectionClasses(b.design) +
    '" id="block-' +
    e(b.key) +
    '">' +
    (b.type === "split" || b.type === "cta" ? "" : heading) +
    content +
    "</section>"
  );
}

export function brandDock(s: Snapshot) {
  const ch = s.site.brandChannels;
  if (!ch) return "";
  const copy = getStorefrontCopy(s.site.language);
  const actions: string[] = [];
  if (ch.whatsapp) {
    const digits = String(ch.whatsapp).replace(/[^\d]/g, "");
    if (digits.length >= 7) {
      actions.push(
        '<a class="dock-btn dock-whatsapp" href="https://wa.me/' +
          e(digits) +
          '" target="_blank" rel="noopener noreferrer">' +
          e(copy.chatWhatsapp) +
          "</a>",
      );
    }
  }
  if (ch.wechat) {
    actions.push(
      '<details class="dock-wechat"><summary class="dock-btn">' +
        e(copy.wechatLabel) +
        '</summary><div class="dock-popover"><strong>' +
        e(copy.wechatLabel) +
        "</strong><code>" +
        e(ch.wechat) +
        "</code></div></details>",
    );
  }
  if (ch.phone) {
    actions.push(
      '<a class="dock-btn" href="tel:' +
        e(String(ch.phone).replace(/\s+/g, "")) +
        '">' +
        e(copy.callUs) +
        "</a>",
    );
  }
  if (ch.email) {
    actions.push(
      '<a class="dock-btn" href="mailto:' +
        e(ch.email) +
        '">' +
        e(copy.emailUs) +
        "</a>",
    );
  }
  if (!actions.length) return "";
  return (
    '<aside class="brand-dock" aria-label="' +
    e(copy.quickContact) +
    '">' +
    actions.join("") +
    "</aside>"
  );
}

export function catalogueHtml(s: Snapshot) {
  const copy = getStorefrontCopy(s.site.language);
  return (
    '<!DOCTYPE html><html lang="' +
    e(copy.lang) +
    '" dir="' +
    e(copy.dir) +
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    e(s.site.name + " " + copy.catalogueTitleSuffix) +
    '</title><meta name="description" content="' +
    e(copy.catalogueSubtitle) +
    '"><link rel="stylesheet" href="/assets/site.css"></head><body class="b2b-site"><main><header class="catalogue-header"><h1>' +
    e(s.site.name + " " + copy.catalogueTitleSuffix) +
    "</h1><p>" +
    e(copy.catalogueSubtitle) +
    "</p></header>" +
    s.pages
      .filter((p) => p.type === "product")
      .map(
        (p) =>
          '<article class="catalogue-product"><h2><a href="' +
          e(new URL(p.path, s.settings.canonicalBaseUrl).href) +
          '">' +
          e(p.title.split("|")[0]) +
          "</a></h2><p>" +
          e(
            p.presentation?.summary
              ? cardSummary(p)
              : intactSentences(p.metaDescription ?? ""),
          ) +
          "</p>" +
          p.blocks
            .filter((b: any) => b.type === "specs" && b.table?.rows.length)
            .map(
              (b: any): PublicTable => publicTable(b.table, pageTitles(s, p)),
            )
            .filter((table: PublicTable) => table.rows.length > 0)
            .map(
              (table: PublicTable) =>
                "<table><caption>" +
                e(copy.confirmedSpecsCaption) +
                "</caption><tbody>" +
                table.rows
                  .map(
                    (r: string[]) =>
                      "<tr>" +
                      r.map((x: string) => "<td>" + e(x) + "</td>").join("") +
                      "</tr>",
                  )
                  .join("") +
                "</tbody></table>",
            )
            .join("") +
          "</article>",
      )
      .join("") +
    "</main></body></html>"
  );
}

export function quoteBar(s: Snapshot, p: any) {
  if (!s.site.buyerProfile) return "";
  const copy = getStorefrontCopy(s.site.language);
  return (
    '<aside class="quote-bar" ' +
    (p.productId ? "" : "hidden ") +
    'aria-label="' +
    e(copy.inquiryShortlist) +
    '"><a href="#inquiry">' +
    e(copy.inquiryList) +
    ' <span data-quote-count>0</span></a><span data-quote-status role="status"></span>' +
    (p.productId
      ? '<button type="button" data-quote-add="' +
        e(p.productId) +
        '">' +
        e(copy.addThisProduct) +
        "</button>"
      : "") +
    '<button type="button" data-quote-review>' +
    e(copy.reviewInquiry) +
    '</button><button type="button" data-quote-clear>' +
    e(copy.clearList) +
    "</button></aside>"
  );
}
