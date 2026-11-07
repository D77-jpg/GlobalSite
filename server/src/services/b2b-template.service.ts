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
function productImage(s: Snapshot, v: any) {
  const source = s.products?.find((x) => x.id === v.productId);
  const id =
    source?.assetIds.filter((id) => s.assets[id]).at(-1) ??
    v.blocks.find((b: any) => b.type === "image" && s.assets[b.assetId])
      ?.assetId;
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
        '">'
    : "";
}
export function productCards(
  s: Snapshot,
  p: any,
  heading = "Explore the product range",
  body = "",
) {
  const products = s.pages.filter((v) => v.type === "product"),
    categories = s.pages.filter((v) => v.type === "category");
  const selected =
    p.type === "category"
      ? products.filter((v) =>
          v.path.startsWith(p.path.replace(/\/$/, "") + "/"),
        )
      : products;
  const rows = selected.length ? selected : products;
  return (
    '<section class="b2b-section catalog-section" id="collection"><div class="section-heading"><div><p class="section-kicker">PRODUCT RANGE</p><h2>' +
    e(heading) +
    "</h2>" +
    (body && !pendingDetail(body) ? "<p>" + e(body) + "</p>" : "") +
    '</div><a class="text-link" href="/catalogue.html" download>Download catalogue ↗</a></div>' +
    '<div class="catalog-tools" data-catalog-tools hidden><label>Find a product<input type="search" data-product-search placeholder="Search product names"></label><label>Category<select data-category-filter><option value="">All categories</option>' +
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
          productImage(s, v) +
          '</a><div class="product-copy"><p class="product-category">' +
          e(
            category?.presentation?.navigationLabel ??
              category?.title.split("|")[0] ??
              "Collection",
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
          '">View details ↗</a><button type="button" class="quote-add" data-quote-add="' +
          e(v.productId) +
          '">Add to inquiry</button></div></div></article>'
        );
      })
      .join("") +
    "</div><p data-no-products hidden>No matching products. Try another category or search.</p></section>"
  );
}
export function renderB2BBlock(s: Snapshot, p: any, b: any): string | null {
  if (["text", "image", "specs", "faq"].includes(b.type)) return null;
  if (b.type === "product-grid") return productCards(s, p, b.heading, b.body);
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
        '">'
      : "";
  const heading =
    '<div class="section-intro"><p class="section-kicker">' +
    e(
      (
        {
          process: "HOW TO WORK WITH US",
          customization: "YOUR PRODUCT BRIEF",
          evidence: "DOCUMENTED DETAILS",
          "case-study": "PROJECT STORY",
          downloads: "BUYING RESOURCES",
          comparison: "COMPARE OPTIONS",
          "category-grid": "EXPLORE BY CATEGORY",
          features: "PRODUCT CONSIDERATIONS",
          split: "A CLOSER LOOK",
          cta: "NEXT STEP",
        } as Record<string, string>
      )[b.type] ?? "",
    ) +
    "</p><h2>" +
    e(b.heading) +
    "</h2>" +
    (b.body && !pendingDetail(b.body) ? "<p>" + e(b.body) + "</p>" : "") +
    "</div>";
  let content = "";
  if (b.type === "category-grid") {
    const categories = s.pages.filter((v) => v.type === "category");
    const products = s.pages.filter((v) => v.type === "product");
    const destinations =
      categories.length < 2 && products.length ? products : categories;
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
      e(items[0]?.title ?? "Discuss your requirements") +
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
            '<article><span class="resource-type">PDF DOCUMENT</span><h3>' +
            e(i.title) +
            "</h3><p>" +
            e(i.body) +
            '</p><a class="text-link" download href="' +
            e(s.assets[i.assetId].path) +
            '">Download document ↗</a></article>',
        )
        .join("") +
      '<article><span class="resource-type">PRODUCT CATALOGUE</span><h3>Browse the current range</h3><p>Save the product catalogue for your purchasing brief.</p><a class="text-link" href="/catalogue.html" download>Download catalogue ↗</a></article></div>';
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
                '">Explore details ↗</a>'
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
    (["evidence", "case-study", "customization"].includes(b.type) &&
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
    '" id="block-' +
    e(b.key) +
    '">' +
    (b.type === "split" || b.type === "cta" ? "" : heading) +
    content +
    "</section>"
  );
}
export function catalogueHtml(s: Snapshot) {
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    e(s.site.name) +
    ' product catalogue</title><meta name="description" content="Product range and confirmed purchasing information."><link rel="stylesheet" href="/assets/site.css"></head><body class="b2b-site"><main><header class="catalogue-header"><h1>' +
    e(s.site.name) +
    " product catalogue</h1><p>Use product names and links when preparing an inquiry. Commercial terms require written confirmation.</p></header>" +
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
                "<table><caption>Confirmed specifications</caption><tbody>" +
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
  return (
    '<aside class="quote-bar" ' +
    (p.productId ? "" : "hidden ") +
    'aria-label="Inquiry shortlist"><a href="#inquiry">Inquiry list <span data-quote-count>0</span></a><span data-quote-status role="status"></span>' +
    (p.productId
      ? '<button type="button" data-quote-add="' +
        e(p.productId) +
        '">Add this product</button>'
      : "") +
    '<button type="button" data-quote-review>Review inquiry</button><button type="button" data-quote-clear>Clear list</button></aside>'
  );
}
