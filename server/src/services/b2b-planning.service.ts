import { ownSite, sourceRows } from "./sites.service";
export const sectionRecipes: Record<string, string[]> = {
  home: [
    "category-grid",
    "product-grid",
    "split",
    "features",
    "customization",
    "process",
    "evidence",
    "downloads",
    "faq",
    "cta",
  ],
  category: ["category-grid", "product-grid", "comparison", "faq", "cta"],
  product: [
    "split",
    "specs",
    "customization",
    "features",
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
  factory: ["split", "process", "evidence", "downloads", "cta"],
  certifications: ["evidence", "downloads", "faq", "cta"],
  resources: ["downloads", "comparison", "faq", "cta"],
  solution: ["split", "features", "product-grid", "case-study", "cta"],
  about: ["split", "evidence", "process", "cta"],
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
export function pageBriefs(site: any) {
  return (site.plan?.nodes ?? []).map((n: any) => ({
    nodeKey: n.key,
    type: n.type,
    questions: n.brief?.buyerQuestions ?? questions[n.type] ?? questions.home,
    sections:
      n.brief?.sections ?? sectionRecipes[n.type] ?? sectionRecipes.home,
  }));
}
export function procurementCoverage(site: any, products: any[], facts: any[]) {
  const gaps: {
    subjectId: string | null;
    type: string;
    severity: "required" | "recommended";
  }[] = [];
  const has = (id: string | null, pattern: RegExp) =>
    facts.some(
      (f) =>
        f.status === "confirmed" &&
        (id
          ? f.subjectType === "product" && String(f.subjectId) === id
          : f.subjectType === "organization") &&
        pattern.test(f.type),
    );
  const need = (
    id: string | null,
    type: string,
    pattern: RegExp,
    severity: "required" | "recommended" = "required",
  ) => {
    if (!has(id, pattern)) gaps.push({ subjectId: id, type, severity });
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
    if (!p.assetIds?.length)
      gaps.push({
        subjectId: id,
        type: "product.images",
        severity: "required",
      });
  }
  if (!products.length)
    gaps.push({ subjectId: null, type: "products", severity: "required" });

  return {
    configured: !!site.buyerProfile,
    canPublish: !gaps.some((g) => g.severity === "required"),
    coverage: Math.max(0, Math.round(((total - gaps.length) / total) * 100)),
    gaps,
    pageBriefs: pageBriefs(site),
  };
}
export async function buyerReadiness(id: string) {
  const site = await ownSite(id),
    rows = await sourceRows(site);
  return procurementCoverage(site, rows.products, rows.facts);
}
