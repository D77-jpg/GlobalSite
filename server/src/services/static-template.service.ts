import { sectionClasses } from "./section-design.service";
import { composition as compositionSchema } from "../validators/sites.validator";
import { getStorefrontCopy } from "./storefront-i18n.service";
import {
  renderB2BBlock,
  productCards,
  productGuide,
  quoteBar,
  brandDock,
  conceptNote,
  cardSummary,
  ctaTarget,
} from "./b2b-template.service";
import { intactSentences } from "./copy-integrity";
import { wordmarkSvg } from "./brand-mark.service";
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
    // concept: S35 generated illustration (labelled "Illustrative" on render).
    { path: string; width: number; height: number; mime?: string; concept?: boolean }
  >;
  createdAt: string;
  inquiry?: any;
};

export const templateVersion = "b2b-site-v8";

// S35: same composition resolution as renderStaticPage, exported so the builder and
// private preview only bundle an optional rendering pack when a page actually uses it.
export function pageComposition(s: Snapshot, p: any) {
  const home = s.pages.find((v) => v.path === "/");
  const parsed = compositionSchema.safeParse(
    s.site.designDirection?.composition ??
      home?.presentation?.composition ??
      p?.presentation?.composition,
  );
  return parsed.success ? parsed.data : null;
}
const json = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

function image(
  s: Snapshot,
  id: string,
  alt: string,
  hero = false,
  note = true,
) {
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
    ' decoding="async">' +
    (note ? conceptNote(s, id) : "")
  );
}

// S35: first-screen fallback for pages using a rendering pack. Only approved
// assets already present in the frozen snapshot are used, in this order: the
// first product page main image, then the first split/gallery/features asset on
// the page. Pages with their own hero image are unchanged.
function heroFallback(s: Snapshot, p: any): { assetId: string; alt: string } | null {
  const own = (v: any) => {
    const block = v.blocks.find(
      (b: any) => b.type === "image" && b.assetId && s.assets[b.assetId],
    );
    if (block) return { assetId: block.assetId, alt: block.alt || v.title };
    const product = s.products?.find((x) => x.id === v.productId);
    const id = product?.assetIds.filter((a) => s.assets[a]).at(-1);
    return id ? { assetId: id, alt: product!.name } : null;
  };
  const productPage =
    p.type === "product" ? p : s.pages.find((v) => v.type === "product");
  const fromProduct = productPage ? own(productPage) : null;
  if (fromProduct) return fromProduct;
  for (const b of p.blocks) {
    if (b.type === "split" && b.assetId && s.assets[b.assetId])
      return { assetId: b.assetId, alt: b.alt || b.heading };
    if (["gallery", "features"].includes(b.type)) {
      const item = (b.items ?? []).find(
        (i: any) =>
          i.assetId &&
          s.assets[i.assetId] &&
          !s.assets[i.assetId].path.endsWith(".pdf"),
      );
      if (item) return { assetId: item.assetId, alt: item.alt || item.title };
    }
  }
  return null;
}

function section(s: Snapshot, b: any, p?: any) {
  const rich = renderB2BBlock(s, p, b);
  if (rich !== null) return rich;
  const copy = getStorefrontCopy(s.site.language);
  let html = "";
  if (b.type === "image") html = image(s, b.assetId, b.alt);
  else if (b.type === "specs" && b.table)
    html =
      '<div class="table-scroll"><table><caption>' +
      e(b.heading || copy.specifications) +
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
    sectionClasses(b.design) +
    '" id="block-' +
    e(b.key) +
    '"><h2>' +
    e(b.heading || copy.detailsHeading) +
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
  const copy = getStorefrontCopy(s.site.language);
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
    fallbackVisual =
      !firstImage && pageComposition(s, p)?.pack ? heroFallback(s, p) : null,
    logoAsset: Snapshot["assets"][string] | undefined = s.site.logoId
      ? s.assets[s.site.logoId]
      : undefined,
    style =
      s.site.designDirection?.visualStyle ??
      presentation.visualStyle ??
      home?.presentation?.visualStyle ??
      (s.site.templateId === "packaging-bags"
        ? "organic"
        : s.site.templateId === "machinery"
          ? "industrial"
          : "minimal"),
    layout =
      presentation.heroLayout ??
      (firstImage || fallbackVisual ? "split" : "stacked");
  const parsedComposition = compositionSchema.safeParse(
    s.site.designDirection?.composition ??
      home?.presentation?.composition ??
      presentation.composition,
  );
  const composition = parsedComposition.success ? parsedComposition.data : null;
  const cleanTitle = (v: any) => String(v.title).split(/[|—–]/)[0].trim();
  const label = (v: any) =>
    v.presentation?.navigationLabel ??
    copy.navDefaults[v.type] ??
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
  const catalogueLink = link("/catalogue.html", copy.viewFullCatalogue);
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
        artwork
          ? '<span aria-hidden="true">' +
              image(s, artwork.assetId, artwork.alt || label(v)) +
              "</span>"
          : "",
      );
    })
    .join("");
  const rangeMenu =
    '<details class="range-menu"><summary>' +
    e(copy.products) +
    '</summary><div class="range-panel"><div class="range-index">' +
    catalogueLink +
    (categories.length === 1
      ? link(categories[0].path, label(categories[0]))
      : "") +
    '</div><div class="range-tiles">' +
    rangeLinks +
    "</div></div></details>";
  const buyingLinks = buyingPages.map((v) => link(v.path, label(v)));
  for (const [type, title] of [
    ["process", copy.howToOrder],
    ["faq", copy.buyerFaqs],
  ]) {
    const block = home?.blocks.find(
      (v: any) =>
        v.type === type && (type === "faq" ? v.faq?.length : v.items?.length),
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
  const group = (title: string, rows: any[], extra = "") => {
    if (!rows.length) return "";
    if (rows.length === 1 && !extra) return link(rows[0].path, label(rows[0]));
    return (
      '<details class="range-menu"><summary>' +
      e(title) +
      '</summary><div class="buyer-menu">' +
      extra +
      rows.map((v) => link(v.path, label(v))).join("") +
      "</div></details>"
    );
  };
  const composedNav = composition
    ? [
        group(
          composition.navigation === "capabilities"
            ? copy.capabilities
            : copy.products,
          categories.length ? categories : products,
          catalogueLink,
        ),
        group(
          copy.solutions,
          s.pages.filter((v) => ["solution", "customization"].includes(v.type)),
        ),
        group(
          copy.company,
          s.pages.filter((v) =>
            ["about", "factory", "certifications"].includes(v.type),
          ),
        ),
        group(
          copy.resources,
          s.pages.filter((v) => ["resources", "faq"].includes(v.type)),
        ),
        contact ? link(contact.path, label(contact)) : "",
      ].join("")
    : "";
  const strategyNav = s.site.plan?.strategy?.navigation
    ?.map((g: any) => {
      const rows = g.nodeKeys
        .map((key: string) => {
          const node = s.site.plan.nodes.find((n: any) => n.key === key);
          return node ? s.pages.find((v) => v.path === node.path) : undefined;
        })
        .filter(Boolean);
      return rows.length === 1
        ? link(rows[0].path, g.label)
        : group(g.label, rows);
    })
    .join("");
  const nav =
    strategyNav ||
    (composition
      ? composedNav
      : s.site.buyerProfile
        ? rangeMenu + destinations
        : legacyLinks);
  const footerNav = composition
    ? s.pages
        .filter((v) => v.type !== "product" && v.type !== "home")
        .map((v) => link(v.path, label(v)))
        .join("") + catalogueLink
    : s.site.buyerProfile
      ? catalogueLink + destinations
      : legacyLinks;

  const catalog = s.pages.find((v) => v.type === "category");
  const collectionHref =
    p.path === "/" && p.blocks.some((b: any) => b.type === "category-grid")
      ? "#block-" + p.blocks.find((b: any) => b.type === "category-grid").key
      : p.path === "/" && products.length
        ? "#collection"
        : (catalog?.path ?? "/");
  const about = s.pages.find((v) => v.type === "about");
  const grid =
    ["/", catalog?.path].includes(p.path) &&
    products.length &&
    !p.blocks.some(
      (b: any) =>
        b.type === "product-grid" ||
        ((composition || s.site.plan?.strategy) && b.type === "category-grid"),
    )
      ? s.site.buyerProfile
        ? productCards(s, p)
        : '<section class="collection section" id="collection"><div class="section-heading"><div><p class="section-kicker">' +
          e(copy.collectionKicker) +
          "</p><h2>" +
          e(copy.collectionHeading) +
          "</h2></div>" +
          (catalog && p.path !== catalog.path
            ? '<a class="text-link" href="' +
              e(catalog.path) +
              '">' +
              e(copy.viewCollection) +
              "</a>"
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
                (cardSummary(v) ? "<p>" + e(cardSummary(v)) + "</p>" : "") +
                '<a class="text-link" href="' +
                e(v.path) +
                '">' +
                e(copy.exploreProduct) +
                '<span aria-hidden="true"> ↗</span></a></div></article>'
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
    ? '<section class="section information-request"><details><summary>' +
      e(copy.infoOnRequest) +
      "</summary><p>" +
      e(copy.infoOnRequestNote) +
      "</p><ul>" +
      pendingBlocks
        .map(
          (b: any) =>
            '<li id="block-' +
            e(b.key) +
            '">' +
            e(b.heading || copy.detailsHeading) +
            "</li>",
        )
        .join("") +
      "</ul></details></section>"
    : "";
  const inquiryHtml = renderInquiry(s, p);
  const rendered = p.blocks
    .filter((b: any) => b !== firstImage && !pending(b))
    .map((b: any) => ({ block: b, html: section(s, b, p) }));
  // S35 acceptance fix: a closing cta band that leads to the inquiry section
  // directly below it repeats that section; the inquiry section keeps the action.
  const closing = [...rendered].reverse().find((r) => r.html);
  const inquiryAnchor = (href: string) => {
    const [path, fragment] = href.split("#");
    return (
      fragment === "inquiry" &&
      (!path || path.replace(/\/$/, "") === p.path.replace(/\/$/, ""))
    );
  };
  if (
    closing &&
    closing.block.type === "cta" &&
    !detailRequest &&
    inquiryHtml.includes('id="inquiry"') &&
    inquiryAnchor(String(ctaTarget(closing.block)))
  )
    closing.html = "";
  const blocksHtml = rendered.map((r: { html: string }) => r.html).join("");
  // S35 B2: the selected (uploaded or generated) logo, else a deterministic
  // SVG wordmark of the exact site name instead of the former initial letter.
  const brand =
    '<a class="brand" href="/">' +
    (logoAsset
      ? image(s, s.site.logoId, s.site.name + " logo", false, false) +
        "<span>" +
        e(s.site.name) +
        "</span>"
      : wordmarkSvg(s.site.name)) +
    "</a>";
  const heading = presentation.headline ?? cleanTitle(p);
  // S35 acceptance fix: never show a lead sentence whose figures were cut out.
  const lead =
    presentation.summary != null
      ? cardSummary(p)
      : intactSentences(p.metaDescription ?? "");
  const hero =
    '<section class="hero ' +
    (composition ? "composition-hero-" : "hero-") +
    e(layout) +
    (firstImage
      ? " has-visual" + sectionClasses(firstImage.design)
      : fallbackVisual
        ? " has-visual"
        : "") +
    '"><div class="hero-copy">' +
    (composition
      ? '<p class="hero-eyebrow">' +
        e(p.type === "home" ? s.site.name : label(p)) +
        "</p>"
      : "") +
    "<h1>" +
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
          ? copy.exploreCollection
          : copy.requestDetails),
    ) +
    "</a>" +
    (s.site.buyerProfile &&
    p.type === "home" &&
    catalog &&
    presentation.primaryActionTarget === "inquiry"
      ? '<a class="secondary-link" href="' +
        e(catalog.path) +
        '">' +
        e(copy.exploreCollectionArrow) +
        "</a>"
      : p.type === "home" && about
        ? '<a class="secondary-link" href="' +
          e(about.path) +
          '">' +
          e(copy.ourStory) +
          "</a>"
        : "") +
    "</div></div>" +
    (firstImage
      ? '<figure class="hero-visual">' +
        image(s, firstImage.assetId, firstImage.alt, true) +
        "</figure>"
      : fallbackVisual
        ? '<figure class="hero-visual">' +
          image(s, fallbackVisual.assetId, fallbackVisual.alt, true) +
          "</figure>"
        : "") +
    "</section>";
  const brandColor = /^#[0-9a-f]{6}$/i.test(s.site.brandColor)
    ? s.site.brandColor
    : "#49694c";
  const seo = s.settings?.seoAnalytics ?? {};
  const customOg =
    seo.ogImageAssetId && s.assets[seo.ogImageAssetId]
      ? new URL(s.assets[seo.ogImageAssetId].path, s.settings.canonicalBaseUrl)
          .href
      : null;
  const ogImage =
    customOg ??
    (firstImage
      ? new URL(s.assets[firstImage.assetId].path, s.settings.canonicalBaseUrl)
          .href
      : fallbackVisual
        ? new URL(
            s.assets[fallbackVisual.assetId].path,
            s.settings.canonicalBaseUrl,
          ).href
        : logoAsset
          ? new URL(logoAsset.path, s.settings.canonicalBaseUrl).href
          : null);
  const hasGallery = p.blocks.some(
    (b: any) =>
      b.type === "gallery" &&
      (b.items ?? []).some((i: any) => i.assetId && s.assets[i.assetId]),
  );
  const lightbox = hasGallery
    ? '<dialog class="gs-lightbox" data-lightbox aria-label="' +
      e(copy.inspectImage) +
      '"><div class="lightbox-frame"><button type="button" class="lightbox-close" data-lightbox-close aria-label="' +
      e(copy.closeLightbox) +
      '">×</button><button type="button" class="lightbox-nav lightbox-prev" data-lightbox-prev aria-label="' +
      e(copy.prevImage) +
      '">‹</button><figure class="lightbox-stage" data-lightbox-stage></figure><button type="button" class="lightbox-nav lightbox-next" data-lightbox-next aria-label="' +
      e(copy.nextImage) +
      '">›</button></div></dialog>'
    : "";
  const ch = s.site.brandChannels ?? {};
  const socialLinks = [
    ch.linkedin
      ? '<a href="' +
        e(ch.linkedin) +
        '" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>'
      : "",
    ch.youtube
      ? '<a href="' +
        e(ch.youtube) +
        '" target="_blank" rel="noopener noreferrer">YouTube ↗</a>'
      : "",
  ]
    .filter(Boolean)
    .join("");
  const footerContact = [
    fact(s, "address"),
    fact(s, "email") || ch.email,
    fact(s, "phone") || ch.phone,
  ]
    .filter(Boolean)
    .join(" · ");
  const compositionClasses = composition
    ? " composed-site type-" +
      composition.typography +
      " palette-" +
      composition.palette +
      " products-" +
      composition.productLayout +
      (composition.surface ? " surface-" + composition.surface : "") +
      (composition.headerStyle ? " header-" + composition.headerStyle : "") +
      (composition.radius ? " radius-" + composition.radius : "") +
      (composition.pack ? " pack-" + composition.pack : "")
    : "";
  const fontPreload = composition
    ? composition.pack === "precision"
      ? '<link rel="preload" href="/assets/fonts/barlow-condensed-700.woff2" as="font" type="font/woff2" crossorigin>'
      : composition.typography === "luxury" ||
          composition.typography === "editorial"
        ? '<link rel="preload" href="/assets/fonts/cormorant-garamond-400.woff2" as="font" type="font/woff2" crossorigin>'
        : composition.typography === "technical" ||
            composition.typography === "geometric"
          ? '<link rel="preload" href="/assets/fonts/space-grotesk-700.woff2" as="font" type="font/woff2" crossorigin>'
          : '<link rel="preload" href="/assets/fonts/plus-jakarta-sans-700.woff2" as="font" type="font/woff2" crossorigin>'
    : '<link rel="preload" href="/assets/fonts/varela-round.ttf" as="font" type="font/ttf" crossorigin>';
  return (
    '<!DOCTYPE html><html lang="' +
    e(copy.lang) +
    '" dir="' +
    e(copy.dir) +
    '"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
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
    (seo.googleSiteVerification
      ? '<meta name="google-site-verification" content="' +
        e(seo.googleSiteVerification) +
        '">'
      : "") +
    (seo.bingSiteVerification
      ? '<meta name="msvalidate.01" content="' +
        e(seo.bingSiteVerification) +
        '">'
      : "") +
    (logoAsset
      ? '<link rel="icon" href="' + e(logoAsset.path) + '">'
      : '<link rel="icon" href="/favicon.svg" type="image/svg+xml">') +
    fontPreload +
    '<link rel="stylesheet" href="/assets/site.css"><script src="/assets/inquiry.js" defer></script><style>:root{--brand:' +
    brandColor +
    '}</style><script type="application/ld+json">' +
    json(schema) +
    '</script></head><body' +
    (seo.ga4MeasurementId
      ? ' data-ga4-id="' + e(seo.ga4MeasurementId) + '"'
      : "") +
    (seo.gtmContainerId ? ' data-gtm-id="' + e(seo.gtmContainerId) + '"' : "") +
    (seo.metaPixelId ? ' data-meta-pixel-id="' + e(seo.metaPixelId) + '"' : "") +
    ' data-i18n-add="' +
    e(copy.addToInquiry) +
    '" data-i18n-added="' +
    e(copy.addedToInquiry) +
    '" data-i18n-selected="' +
    e(copy.selectedProducts) +
    '" data-i18n-remove="' +
    e(copy.remove) +
    '" data-i18n-products="' +
    e(copy.productsCount) +
    '" class="theme-' +
    e(s.site.templateId) +
    (s.site.buyerProfile
      ? " b2b-site page-" +
        e(p.type) +
        " density-" +
        e(
          s.site.designDirection?.density ??
            presentation.density ??
            "comfortable",
        )
      : "") +
    compositionClasses +
    " style-" +
    e(style) +
    '"><a class="skip" href="#main">' +
    e(copy.skipToContent) +
    '</a><header class="site-header"><div class="header-inner">' +
    brand +
    '<nav class="desktop-nav" aria-label="' +
    e(copy.mainNav) +
    '">' +
    nav +
    '</nav><a class="header-action" href="' +
    e(s.site.buyerProfile ? "#inquiry" : collectionHref) +
    '">' +
    e(s.site.buyerProfile ? copy.requestQuote : copy.viewCollection) +
    '</a><details class="mobile-navigation"><summary>' +
    e(copy.menu) +
    '<span aria-hidden="true"> ☰</span></summary><nav aria-label="' +
    e(copy.mobileNav) +
    '">' +
    nav +
    '</nav></details></div></header><main id="main">' +
    (s.site.buyerProfile && p.path !== "/"
      ? '<nav class="breadcrumbs" aria-label="' +
        e(copy.breadcrumb) +
        '"><a href="/">' +
        e(copy.home) +
        '</a><span aria-hidden="true"> / </span><span>' +
        e(cleanTitle(p)) +
        "</span></nav>"
      : "") +
    hero +
    (s.site.buyerProfile && p.type === "product" ? productGuide(s, p) : "") +
    grid +
    blocksHtml +
    detailRequest +
    inquiryHtml +
    quoteBar(s, p) +
    brandDock(s) +
    lightbox +
    '</main><footer><div class="footer-brand"><span class="footer-logo">' +
    (logoAsset
      ? image(s, s.site.logoId, s.site.name + " logo", false, false)
      : wordmarkSvg(s.site.name, { decorative: true })) +
    "</span><strong>" +
    e(s.site.name) +
    "</strong><p>" +
    e(footerContact) +
    "</p>" +
    (socialLinks ? '<div class="footer-social">' + socialLinks + "</div>" : "") +
    '</div><nav aria-label="' +
    e(copy.footerNav) +
    '">' +
    footerNav +
    '<a href="' +
    e(privacyPath(s)) +
    '">' +
    e(copy.privacyPolicy) +
    '</a><button type="button" data-cookie-settings>' +
    e(copy.privacyChoices) +
    '</button></nav><a class="back-top" href="#main">' +
    e(copy.backToTop) +
    "</a></footer>" +
    renderConsent(s) +
    "</body></html>"
  );
}
