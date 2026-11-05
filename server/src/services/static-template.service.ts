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
  facts: any[];
  settings: any;
  assets: Record<string, { path: string; width: number; height: number }>;
  createdAt: string;
};
export const templateVersion = "s5.1";
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
function section(s: Snapshot, b: any) {
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
  const firstImage = p.blocks.find((b: any) => b.type === "image"),
    intro = p.blocks.find((b: any) => b.type === "text");
  const nav = s.pages
    .slice(0, 9)
    .map((v) => '<a href="' + e(v.path) + '">' + e(v.title) + "</a>")
    .join("");
  const products = s.pages.filter((v) => v.type === "product");
  const grid =
    p.path === "/" && products.length
      ? '<section class="section"><h2>Explore products</h2><div class="grid">' +
        products
          .map((v) => {
            const b = v.blocks.find((b: any) => b.type === "image");
            return (
              '<article class="card">' +
              (b ? image(s, b.assetId, b.alt) : "") +
              '<h3><a href="' +
              e(v.path) +
              '">' +
              e(v.title) +
              "</a></h3><p>" +
              e(v.metaDescription) +
              "</p></article>"
            );
          })
          .join("") +
        "</div></section>"
      : "";
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
    e(p.title) +
    '</title><meta name="description" content="' +
    e(p.metaDescription) +
    '"><link rel="canonical" href="' +
    e(canonical) +
    '"><link rel="stylesheet" href="/assets/site.css"><style>:root{--brand:' +
    e(s.site.brandColor) +
    '}</style><script type="application/ld+json">' +
    json(schema) +
    '</script></head><body class="theme-' +
    e(s.site.templateId) +
    '"><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="/">' +
    (s.site.logoId ? image(s, s.site.logoId, s.site.name + " logo") : "") +
    e(s.site.name) +
    '</a><nav aria-label="Main navigation">' +
    nav +
    '</nav></header><main id="main"><section class="hero"><span class="eyebrow">' +
    e(p.type === "product" ? "Product overview" : "Products & capabilities") +
    "</span><h1>" +
    e(p.title) +
    "</h1><p>" +
    e(intro?.body || p.metaDescription) +
    '</p><a class="cta" href="#inquiry">Discuss your requirements</a>' +
    (firstImage ? image(s, firstImage.assetId, firstImage.alt, true) : "") +
    "</section>" +
    grid +
    p.blocks
      .filter((b: any) => b !== intro && b !== firstImage)
      .map((b: any) => section(s, b))
      .join("") +
    '<section class="section" id="inquiry"><div class="inquiry"><h2>Tell us what you need</h2><p>Online inquiry submission is not available yet. Please use the company contact details below, when provided.</p><form><div class="fields"><label>Your name<input type="text" name="name" autocomplete="name" disabled></label><label>Work email<input name="email" type="email" autocomplete="email" disabled></label></div><label>Requirements<textarea name="message" disabled></textarea></label><p><button type="button" disabled>Online inquiries coming soon</button></p></form></div></section></main><footer><span>' +
    e(s.site.name) +
    "</span><span>" +
    e(
      [fact(s, "address"), fact(s, "email"), fact(s, "phone")]
        .filter(Boolean)
        .join(" · "),
    ) +
    '</span><a href="#main">Back to top</a></footer></body></html>'
  );
}
