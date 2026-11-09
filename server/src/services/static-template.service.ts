import {
  renderB2BBlock,
  productCards,
  productGuide,
  quoteBar,
} from "./b2b-template.service";
import {
  renderInquiry,
  renderConsent,
  privacyPath,
} from "./inquiry-template.service";
export const e = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export type Snapshot = {
  site: any;
  pages: any[];
  products?: Array<{
    id: string;
    name: string;
    category: string | null;
    assetIds: string[];
  }>;
  facts: any[];
  settings: any;
  assets: Record<
    string,
    { path: string; width: number; height: number; mime?: string }
  >;
  createdAt: string;
  inquiry?: any;
};
export const templateVersion = "b2b-site-v6";
const json = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");
function image(s: Snapshot, id: string, alt: string, hero = false) {
  const a = s.assets[id];
  if (!a) return "";
  return (
    '<img src="' +
    e(a.path) +
    '" alt="' +
    e(alt) +
    '" width="' +
    a.width +
    '" height="' +
    a.height +
    '" ' +
    (hero ? 'fetchpriority="high"' : 'loading="lazy"') +
    ' decoding="async">'
  );
}
function section(s: Snapshot, b: any, p?: any) {
  const rich = renderB2BBlock(s, p, b);
  if (rich !== null) return rich;
  let html = "";
  if (b.type === "image") html = image(s, b.assetId, b.alt);
  else if (b.type === "specs" && b.table)
    html =
      '<div class="table-scroll"><table><caption>' +
      e(b.heading || "Specifications") +
      "</caption><thead><tr>" +
      b.table.columns
        .map((c: string) => '<th scope="col">' + e(c) + "</th>")
        .join("") +
      "</tr></thead><tbody>" +
      b.table.rows
        .map(
          (r: string[]) =>
            "<tr>" + r.map((c) => "<td>" + e(c) + "</td>").join("") + "</tr>",
        )
        .join("") +
      "</tbody></table></div>";
  else if (b.type === "faq")
    html = (b.faq ?? [])
      .map(
        (f: any) =>
          "<details><summary>" +
          e(f.question) +
          "</summary><p>" +
          e(f.answer) +
          "</p>" +
          (f.detail ? "<p>" + e(f.detail) + "</p>" : "") +
          "</details>",
      )
      .join("");
  else html = "<p>" + e(b.body).replace(/\n/g, "<br>") + "</p>";
  return (
    '<section class="section section-' +
    e(b.key) +
    '" id="block-' +
    e(b.key) +
    '"><h2>' +
    e(b.heading || "Details") +
    "</h2>" +
    html +
    "</section>"
  );
}
function fact(s: Snapshot, type: string) {
  return s.facts.find(
    (f) =>
      f.subjectType === "organization" &&
      (f.type === type ||
        f.type === "company." + type ||
        (type === "foundedYear" && f.type === "company.founded")),
  )?.value;
}
export function renderStaticPage(s: Snapshot, p: any) {
  const canonical = new URL(
    p.path.endsWith("/") ? p.path : p.path + "/",
    s.settings.canonicalBaseUrl,
  ).href;
  const org: any = {
    "@context": "https://schema.org",
    "@type": "Organization",
    url: s.settings.canonicalBaseUrl,
  };
  const name = fact(s, "name");
  if (name) org.name = name;
  const email = fact(s, "email");
  if (email) org.email = email;
  const founded = fact(s, "foundedYear");
  if (founded && /^\d{4}$/.test(founded)) org.foundingDate = founded;
  const address = fact(s, "address");
  if (address) org.address = address;
  const schema: any[] = [
    org,
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: s.site.name,
          item: s.settings.canonicalBaseUrl,
        },
        ...(p.path !== "/"
          ? [
              {
                "@type": "ListItem",
                position: 2,
                name: p.title,
                item: canonical,
              },
            ]
          : []),
      ],
    },
  ];
  const faqs = p.blocks
    .filter((b: any) => b.type === "faq")
    .flatMap((b: any) => b.faq ?? []);
  if (faqs.length)
    schema.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f: any) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: f.answer + (f.detail ? " " + f.detail : ""),
        },
      })),
    });
  if (p.type === "product")
    schema.push({
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.title,
      description: p.metaDescription,
      url: canonical,
      image: p.blocks
        .filter((b: any) => b.type === "image" && s.assets[b.assetId])
        .map(
          (b: any) =>
            new URL(s.assets[b.assetId].path, s.settings.canonicalBaseUrl).href,
        ),
    });
  const firstImage = p.blocks.find(
      (b: any) => b.type === "image" && s.assets[b.assetId],
    ),
    home = s.pages.find((v) => v.path === "/"),
    presentation = p.presentation ?? {},
    style =
      presentation.visualStyle ??
      home?.presentation?.visualStyle ??
      (s.site.templateId === "packaging-bags"
        ? "organic"
        : s.site.templateId === "machinery"
          ? "industrial"
          : "minimal"),
    layout = presentation.heroLayout ?? (firstImage ? "split" : "stacked");
  const cleanTitle = (v: any) => String(v.title).split(/[|—–]/)[0].trim();
  const label = (v: any) =>
    v.presentation?.navigationLabel ??
    (
      {
        customization: "Private label",
        resources: "Resources",
        solution: "Solutions",
        category: "Collection",
        about: "Our story",
        faq: "FAQs",
        contact: "Contact",
        factory: "Our process",
        certifications: "Documents",
      } as Record<string, string>
    )[v.type] ??
    cleanTitle(v);
  const categories = s.pages.filter((v) => v.type === "category");
  const products = s.pages.filter((v) => v.type === "product");
  const buyingPages = [
    "customization",
    "resources",
    "solution",
    "factory",
    "about",
    "faq",
  ]
    .map((type) => s.pages.find((v) => v.type === type))
    .filter(Boolean);
  const contact = s.pages.find((v) => v.type === "contact");
  const link = (path: string, text: string, visual = "") =>
    '<a href="' +
    e(path) +
    '"' +
    (p.path === path ? ' aria-current="page"' : "") +
    ">" +
    visual +
    "<span>" +
    e(text) +
    "</span></a>";
  const catalogueLink = link("/catalogue.html", "View full catalogue");
  const ranges = categories.length > 1 ? categories : products;
  const rangeLinks = ranges
    .slice(0, 6)
    .map((v) => {
      const artwork = v.blocks.find(
        (block: any) => block.type === "image" && s.assets[block.assetId],
      );
      return link(
        v.path,
        label(v),
        artwork ? '<span aria-hidden="true">' + image(s, artwork.assetId, artwork.alt || label(v)) + "</span>" : "",
      );
    })
    .join("");
  const rangeMenu =
    '<details class="range-menu"><summary>Products</summary><div class="range-panel"><div class="range-index">' +
    catalogueLink +
    (categories.length === 1 ? link(categories[0].path, label(categories[0])) : "") +
    '</div><div class="range-tiles">' +
    rangeLinks +
    "</div></div></details>";
  const buyingLinks = buyingPages.map((v) => link(v.path, label(v)));
  for (const [type, title] of [
    ["process", "How to order"],
    ["faq", "Buyer FAQs"],
  ]) {
    const block = home?.blocks.find(
      (v: any) =>
        v.type === type &&
        (type === "faq" ? v.faq?.length : v.items?.length),
    );
    if (block && !buyingPages.some((v) => v.type === type)) {
      buyingLinks.push(link("/#block-" + block.key, title));
    }
  }
  const legacyLinks = ["category", "about", "faq", "contact"]
    .map((type) => s.pages.find((v) => v.type === type))
    .filter(Boolean)
    .map((v) => link(v.path, label(v)))
    .join("");
  const destinations =
    buyingLinks.slice(0, contact ? 3 : 4).join("") +
    (contact ? link(contact.path, label(contact)) : "");
  const nav = s.site.buyerProfile ? rangeMenu + destinations : legacyLinks;
  const footerNav = s.site.buyerProfile
    ? catalogueLink + destinations
    : legacyLinks;

  const catalog = s.pages.find((v) => v.type === "category");
  const collectionHref =
    p.path === "/" && products.length ? "#collection" : (catalog?.path ?? "/");
  const about = s.pages.find((v) => v.type === "about");
  const grid =
    ["/", catalog?.path].includes(p.path) &&
    products.length &&
    !p.blocks.some((b: any) => b.type === "product-grid")
      ? s.site.buyerProfile
        ? productCards(s, p)
        : '<section class="collection section" id="collection"><div class="section-heading"><div><p class="section-kicker">The collection</p><h2>Explore the everyday essentials</h2></div>' +
          (catalog && p.path !== catalog.path
            ? '<a class="text-link" href="' +
              e(catalog.path) +
              '">View collection</a>'
            : "") +
          '</div><div class="product-grid">' +
          products
            .map((v) => {
              const product = s.products?.find(
                (product) => product.id === v.productId,
              );
              const assetId = product?.assetIds
                .filter((id) => s.assets[id])
                .at(-1);
              const b = v.blocks.find(
                (b: any) => b.type === "image" && s.assets[b.assetId],
              );
              const visual = assetId
                ? image(s, assetId, cleanTitle(v) + " collection image")
                : b
                  ? image(s, b.assetId, b.alt)
                  : "";
              return (
                '<article class="product-card">' +
                (visual
                  ? '<a class="product-visual" href="' +
                    e(v.path) +
                    '" tabindex="-1" aria-hidden="true">' +
                    visual +
                    "</a>"
                  : "") +
                '<div class="product-copy"><h3><a href="' +
                e(v.path) +
                '">' +
                e(v.presentation?.navigationLabel ?? cleanTitle(v)) +
                "</a></h3>" +
                (v.presentation?.summary
                  ? "<p>" + e(v.presentation.summary) + "</p>"
                  : "") +
                '<a class="text-link" href="' +
                e(v.path) +
                '">Explore product<span aria-hidden="true"> ↗</span></a></div></article>'
              );
            })
            .join("") +
          "</div></section>"
      : "";
  const pending = (b: any) =>
    /^(Contact our team for confirmed details\.|Details available on request\.|Information to be confirmed\.|Not yet confirmed\.?)$/i.test(
      b.body?.trim() ?? "",
    ) &&
    !b.faq?.length &&
    !b.items?.length &&
    !["product-grid", "category-grid", "downloads", "cta"].includes(b.type) &&
    (!b.table || !b.table.rows?.length);
  const pendingBlocks = p.blocks.filter(pending);
  const detailRequest = pendingBlocks.length
    ? '<section class="section information-request"><details><summary>Product information on request</summary><p>Contact our team for confirmed product details before placing an order.</p><ul>' +
      pendingBlocks
        .map(
          (b: any) =>
            '<li id="block-' +
            e(b.key) +
            '">' +
            e(b.heading || "Product details") +
            "</li>",
        )
        .join("") +
      "</ul></details></section>"
    : "";
  const brand =
    '<a class="brand" href="/">' +
    (s.site.logoId
      ? image(s, s.site.logoId, s.site.name + " logo")
      : '<span class="brand-mark" aria-hidden="true">' +
        e(s.site.name.slice(0, 1)) +
        "</span>") +
    "<span>" +
    e(s.site.name) +
    "</span></a>";
  const heading = presentation.headline ?? cleanTitle(p);
  const lead = presentation.summary ?? p.metaDescription;
  const hero =
    '<section class="hero hero-' +
    e(layout) +
    (firstImage ? " has-visual" : "") +
    '"><div class="hero-copy"><h1>' +
    e(heading) +
    '</h1><p class="hero-lead">' +
    e(lead) +
    '</p><div class="hero-actions"><a class="cta" href="' +
    e(
      presentation.primaryActionTarget === "inquiry"
        ? "#inquiry"
        : presentation.primaryActionTarget === "catalogue"
          ? "/catalogue.html"
          : p.type === "home" || p.type === "category"
            ? collectionHref
            : "#inquiry",
    ) +
    '">' +
    e(
      presentation.primaryActionLabel ??
        (p.type === "home" || p.type === "category"
          ? "Explore collection"
          : "Request details"),
    ) +
    "</a>" +
    (s.site.buyerProfile &&
    p.type === "home" &&
    catalog &&
    presentation.primaryActionTarget === "inquiry"
      ? '<a class="secondary-link" href="' +
        e(catalog.path) +
        '">Explore the collection ↗</a>'
      : p.type === "home" && about
        ? '<a class="secondary-link" href="' + e(about.path) + '">Our story</a>'
        : "") +
    "</div></div>" +
    (firstImage
      ? '<figure class="hero-visual">' +
        image(s, firstImage.assetId, firstImage.alt, true) +
        "</figure>"
      : "") +
    "</section>";
  const brandColor = /^#[0-9a-f]{6}$/i.test(s.site.brandColor)
    ? s.site.brandColor
    : "#49694c";
  const ogImage = firstImage
    ? new URL(s.assets[firstImage.assetId].path, s.settings.canonicalBaseUrl)
        .href
    : null;
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
    e(p.title) +
    '</title><meta name="description" content="' +
    e(p.metaDescription) +
    '"><link rel="canonical" href="' +
    e(canonical) +
    '"><meta property="og:type" content="website"><meta property="og:title" content="' +
    e(p.title) +
    '"><meta property="og:description" content="' +
    e(p.metaDescription) +
    '"><meta property="og:url" content="' +
    e(canonical) +
    '"><meta name="twitter:card" content="summary_large_image">' +
    (ogImage
      ? '<meta property="og:image" content="' +
        e(ogImage) +
        '"><meta name="twitter:image" content="' +
        e(ogImage) +
        '">'
      : "") +
    '<link rel="preload" href="/assets/fonts/varela-round.ttf" as="font" type="font/ttf" crossorigin><link rel="stylesheet" href="/assets/site.css"><script src="/assets/inquiry.js" defer></script><style>:root{--brand:' +
    brandColor +
    '}</style><script type="application/ld+json">' +
    json(schema) +
    '</script></head><body class="theme-' +
    e(s.site.templateId) +
    (s.site.buyerProfile
      ? " b2b-site page-" +
        e(p.type) +
        " density-" +
        e(presentation.density ?? "comfortable")
      : "") +
    " style-" +
    e(style) +
    '"><a class="skip" href="#main">Skip to content</a><header class="site-header"><div class="header-inner">' +
    brand +
    '<nav class="desktop-nav" aria-label="Main navigation">' +
    nav +
    '</nav><a class="header-action" href="' +
    e(s.site.buyerProfile ? "#inquiry" : collectionHref) +
    '">' +
    (s.site.buyerProfile ? "Request a quote" : "View collection") +
    '</a><details class="mobile-navigation"><summary>Menu<span aria-hidden="true"> ☰</span></summary><nav aria-label="Mobile navigation">' +
    nav +
    '</nav></details></div></header><main id="main">' +
    (s.site.buyerProfile && p.path !== "/"
      ? '<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true"> / </span><span>' +
        e(cleanTitle(p)) +
        "</span></nav>"
      : "") +
    hero +
    (s.site.buyerProfile && p.type === "product" ? productGuide(s, p) : "") +
    grid +
    p.blocks
      .filter((b: any) => b !== firstImage && !pending(b))
      .map((b: any) => section(s, b, p))
      .join("") +
    detailRequest +
    renderInquiry(s, p) +
    quoteBar(s, p) +
    '</main><footer><div class="footer-brand"><strong>' +
    e(s.site.name) +
    "</strong><p>" +
    e(
      [fact(s, "address"), fact(s, "email"), fact(s, "phone")]
        .filter(Boolean)
        .join(" · "),
    ) +
    '</p></div><nav aria-label="Footer navigation">' +
    footerNav +
    '<a href="' +
    e(privacyPath(s)) +
    '">Privacy Policy</a><button type="button" data-cookie-settings>Privacy choices</button></nav><a class="back-top" href="#main">Back to top</a></footer>' +
    renderConsent(s) +
    "</body></html>"
  );
}
