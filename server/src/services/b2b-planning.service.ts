import { demoFactRows, ownSite, sourceRows } from "./sites.service";
export const sectionRecipes: Record<string, string[]> = {
  home: [
    "category-grid",
    "product-grid",
    "metrics",
    "gallery",
    "showcase",
    "split",
    "features",
    "customization",
    "process",
    "certifications",
    "evidence",
    "downloads",
    "faq",
    "cta",
  ],
  category: [
    "category-grid",
    "product-grid",
    "gallery",
    "comparison",
    "faq",
    "cta",
  ],
  product: [
    "split",
    "gallery",
    "specs",
    "customization",
    "features",
    "certifications",
    "evidence",
    "downloads",
    "faq",
    "cta",
  ],
  customization: [
    "split",
    "customization",
    "process",
    "evidence",
    "faq",
    "cta",
  ],
  factory: [
    "split",
    "gallery",
    "metrics",
    "process",
    "certifications",
    "evidence",
    "downloads",
    "cta",
  ],
  certifications: ["certifications", "evidence", "downloads", "faq", "cta"],
  resources: ["downloads", "comparison", "faq", "cta"],
  solution: [
    "split",
    "features",
    "product-grid",
    "showcase",
    "case-study",
    "cta",
  ],
  about: [
    "split",
    "metrics",
    "gallery",
    "certifications",
    "evidence",
    "process",
    "cta",
  ],
  faq: ["faq", "cta"],
  contact: ["process", "cta"],
};
const questions: Record<string, string[]> = {
  home: [
    "What can I source?",
    "Who is this range for?",
    "How do I request a catalogue or quote?",
  ],
  category: [
    "Which option fits my market?",
    "How do models differ?",
    "Can I request several products together?",
  ],
  product: [
    "What are the specifications?",
    "What are the order and sample terms?",
    "What can be customized?",
  ],
  customization: [
    "Which options are confirmed?",
    "How does sample approval work?",
  ],
  factory: ["How is production controlled?", "Which evidence can I inspect?"],
  certifications: ["Which product and market does each document cover?"],
  resources: ["Which specification sheets and catalogues are available?"],
  solution: ["Which products fit this buying scenario?"],
  about: ["Who will supply and support my order?"],
  faq: ["What must I provide for a quotation?"],
  contact: ["How do I submit a useful purchasing brief?"],
};
export type CoverageNode = {
  key: string;
  type: string;
  brief?: { buyerQuestions?: string[]; sections?: string[] };
};
export type CoverageSite = {
  buyerProfile?: unknown;
  demoMode?: boolean;
  plan?: {
    nodes?: CoverageNode[];
    strategy?: { productSections?: string[] };
  } | null;
};
export type CoverageProduct = {
  _id?: unknown;
  id?: string;
  assetIds?: unknown[];
};
export type CoverageFact = {
  status?: string;
  subjectType?: string;
  subjectId?: unknown;
  type: string;
};

export function pageBriefs(site: CoverageSite) {
  return (site.plan?.nodes ?? []).map((n) => ({
    nodeKey: n.key,
    type: n.type,
    questions: n.brief?.buyerQuestions ?? questions[n.type] ?? questions.home,
    sections:
      n.brief?.sections ?? sectionRecipes[n.type] ?? sectionRecipes.home,
  }));
}
export function procurementCoverage(
  site: CoverageSite,
  products: CoverageProduct[],
  facts: CoverageFact[],
  options: { allowDemoFacts?: boolean } = {},
) {
  const gaps: {
    subjectId: string | null;
    type: string;
    severity: "required" | "recommended";
  }[] = [];
  const confirmedGaps: {
    subjectId: string | null;
    type: string;
    severity: "required" | "recommended";
  }[] = [];
  const has = (
    id: string | null,
    pattern: RegExp,
    includeCandidates: boolean,
  ) =>
    facts.some(
      (f) =>
        (f.status === "confirmed" ||
          (includeCandidates && f.status === "candidate")) &&
        (id
          ? f.subjectType === "product" && String(f.subjectId) === id
          : f.subjectType === "organization") &&
        pattern.test(f.type),
    );
  const allowDemo = !!options.allowDemoFacts;
  const need = (
    id: string | null,
    type: string,
    pattern: RegExp,
    severity: "required" | "recommended" = "required",
  ) => {
    if (!has(id, pattern, allowDemo)) gaps.push({ subjectId: id, type, severity });
    if (!has(id, pattern, false))
      confirmedGaps.push({ subjectId: id, type, severity });
  };
  need(null, "company.name", /^company\.name$/);
  need(null, "company.email", /^company\.(email|privacyEmail)$/);
  need(null, "company.address", /^company\.address$/, "recommended");
  const sections: string[] | undefined = site.plan?.strategy?.productSections;
  let total = 3 + (products.length ? 0 : 1);
  for (const p of products) {
    const id = String(p._id ?? p.id);
    const fields: [string, string, RegExp, "required" | "recommended"][] = [
      ["material", "product.material", /material/i, "required"],
      ["moq", "product.moq", /moq|minimumOrder/i, "required"],
      ["samples", "product.leadTime", /lead.?time|delivery/i, "required"],
      ["specs", "product.specifications", /spec|dimension|size/i, "required"],
      ["packaging", "product.packaging", /packaging/i, "recommended"],
      ["samples", "product.samples", /sample/i, "recommended"],
    ];
    const applicable = fields.filter(
      ([section]) => !sections || sections.includes(section),
    );
    total += applicable.length + 1;
    for (const [, type, pattern, severity] of applicable)
      need(id, type, pattern, severity);
    if (!p.assetIds?.length) {
      gaps.push({
        subjectId: id,
        type: "product.images",
        severity: "required",
      });
      confirmedGaps.push({
        subjectId: id,
        type: "product.images",
        severity: "required",
      });
    }
  }
  if (!products.length) {
    gaps.push({ subjectId: null, type: "products", severity: "required" });
    confirmedGaps.push({
      subjectId: null,
      type: "products",
      severity: "required",
    });
  }

  // S37 §4.6-2: enrichment checklist for metrics, credibility and proof sections
  // (informational only; never blocks canPublish or alters required coverage).
  const enrichmentGaps: {
    subjectId: string | null;
    type: string;
    severity: "recommended";
  }[] = [];
  const orgEnrich: Array<[string, RegExp]> = [
    ["company.founded", /^company\.founded/i],
    ["company.capacity", /^company\.capacity/i],
    ["company.exportCountries", /^company\.exportCountries/i],
    ["company.warranty", /^company\.warranty/i],
    ["company.customers", /^company\.customers/i],
    ["company.caseStudy", /^company\.caseStudy/i],
    ["company.factoryArea", /^company\.factoryArea/i],
    ["company.employees", /^company\.employees/i],
    ["company.certifications", /^company\.certifications/i],
  ];
  for (const [type, pattern] of orgEnrich) {
    if (!has(null, pattern, allowDemo))
      enrichmentGaps.push({ subjectId: null, type, severity: "recommended" });
  }
  for (const p of products) {
    const id = String(p._id ?? p.id);
    if (!has(id, /warranty/i, allowDemo))
      enrichmentGaps.push({
        subjectId: id,
        type: "product.warranty",
        severity: "recommended",
      });
  }

  return {
    configured: !!site.buyerProfile,
    // Commercial publication always requires confirmed facts, never demo candidates.
    canPublish: !confirmedGaps.some((g) => g.severity === "required"),
    coverage: Math.max(0, Math.round(((total - gaps.length) / total) * 100)),
    gaps,
    enrichmentGaps,
    pageBriefs: pageBriefs(site),
  };
}
export async function buyerReadiness(id: string) {
  const site = await ownSite(id),
    rows = await sourceRows(site);
  const facts = site.demoMode
    ? [...rows.facts, ...(await demoFactRows(site))]
    : rows.facts;
  return procurementCoverage(site, rows.products, facts, {
    allowDemoFacts: !!site.demoMode,
  });
}
