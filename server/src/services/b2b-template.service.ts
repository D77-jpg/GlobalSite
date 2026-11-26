import { sectionClasses } from "./section-design.service";
import { getStorefrontCopy } from "./storefront-i18n.service";
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
      (b.type === "specs" && b.table?.rows?.length) ||
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
        const specs =
          v.blocks
            .find((b: any) => b.type === "specs" && b.table?.rows.length)
            ?.table?.rows.slice(0, 2) ?? [];
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
          e(v.presentation?.navigationLabel ?? v.title.split("|")[0].trim()) +
          "</a></h3>" +
          (v.presentation?.summary
            ? "<p>" + e(v.presentation.summary) + "</p>"
            : "") +
          (specs.length
            ? '<dl class="card-specs">' +
              specs
                .map(
                  (r: string[]) =>
                    "<div><dt>" +
                    e(r[0]) +
                    "</dt><dd>" +
                    e(r.slice(1).join(" · ")) +
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
  else if (b.type === "comparison")
    content =
      '<div class="table-scroll"><table><caption>' +
      e(b.heading) +
      "</caption><thead><tr>" +
      (b.table?.columns ?? [])
        .map((v: string) => '<th scope="col">' + e(v) + "</th>")
        .join("") +
      "</tr></thead><tbody>" +
      (b.table?.rows ?? [])
        .map(
          (r: string[]) =>
            "<tr>" + r.map((v) => "<td>" + e(v) + "</td>").join("") + "</tr>",
        )
        .join("") +
      "</tbody></table></div>";
  else if (b.type === "downloads")
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
          e(p.presentation?.summary ?? p.metaDescription) +
          "</p>" +
          p.blocks
            .filter((b: any) => b.type === "specs" && b.table?.rows.length)
            .map(
              (b: any) =>
                "<table><caption>" +
                e(copy.confirmedSpecsCaption) +
                "</caption><tbody>" +
                b.table.rows
                  .map(
                    (r: string[]) =>
                      "<tr>" +
                      r.map((x) => "<td>" + e(x) + "</td>").join("") +
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
