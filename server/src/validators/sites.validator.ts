import { z } from "zod";
import { objectId, revision } from "./catalog.validator";
export const templates = [
  { id: "adaptive", name: "Agent-composed website", industry: "adaptive" },
  { id: "machinery", name: "Machinery & equipment", industry: "machinery" },
  {
    id: "building-hardware",
    name: "Building materials & hardware",
    industry: "building",
  },
  { id: "packaging-bags", name: "Packaging & bags", industry: "packaging" },
];
export const buyerProfile = z
  .object({
    businessModel: z.enum([
      "wholesale",
      "private_label",
      "manufacturer",
      "distributor",
    ]),
    audiences: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
    buyerNeeds: z.array(z.string().trim().min(1).max(160)).max(8),
    primaryAction: z.enum(["quote", "catalogue", "sample"]),
    referenceUrls: z
      .array(
        z
          .string()
          .url()
          .max(500)
          .refine((value) => {
            try {
              const u = new URL(value);
              return (
                u.protocol === "https:" &&
                !u.username &&
                !u.password &&
                !u.search &&
                !u.hash
              );
            } catch {
              return false;
            }
          }),
      )
      .max(3),
  })
  .strict();
export const pageBrief = z
  .object({
    purpose: z.string().max(240),
    buyerQuestions: z.array(z.string().max(200)).max(8),
    requiredFactTypes: z
      .array(
        z
          .string()
          .regex(/^(company|product)\.[a-zA-Z][a-zA-Z0-9.]*$/)
          .max(80),
      )
      .max(12),
    sections: z.array(z.string().max(60)).max(16),
  })
  .strict();
export const siteInput = z
  .object({
    buyerProfile: buyerProfile.optional(),
    businessBrief: z.string().trim().max(2000).optional(),
    name: z.string().trim().min(1).max(120),
    templateId: z.enum([
      "adaptive",
      "machinery",
      "building-hardware",
      "packaging-bags",
    ]),
    targetMarkets: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
    language: z.literal("en"),
    brandColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    logoId: objectId.nullable(),
    productIds: z.array(objectId).max(50),
    status: z.enum(["draft", "archived"]).default("draft"),
  })
  .strict()
  .refine((x) => new Set(x.productIds).size === x.productIds.length);
export const sitePatch = z.object({ revision, data: siteInput }).strict();
export const intent = z.enum(["learn", "compare", "specify", "source", "buy"]);
const key = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(60);
export const node = z
  .object({
    key,
    path: z.string().min(1).max(160),
    title: z.string().trim().min(1).max(120),
    type: z.enum([
      "home",
      "category",
      "product",
      "about",
      "factory",
      "certifications",
      "faq",
      "contact",
      "customization",
      "resources",
      "solution",
    ]),
    parentKey: key.nullable(),
    productId: objectId.nullable(),
    brief: pageBrief.optional(),
    keywords: z.array(z.string().trim().min(1).max(120)).max(10),
    intent,
  })
  .strict();
export const keyword = z
  .object({
    term: z.string().trim().min(1).max(120),
    intent,
    cluster: z.string().min(1).max(80),
  })
  .strict();
export const cluster = z
  .object({
    key,
    label: z.string().min(1).max(120),
    intent,
    keywords: z.array(z.string().min(1).max(120)).max(20),
  })
  .strict();
export const plan = z
  .object({
    nodes: z.array(node).min(1).max(50),
    keywords: z.array(keyword).max(100),
    clusters: z.array(cluster).max(30),
  })
  .strict();
export const planPatch = z
  .object({
    revision,
    nodes: z.array(node).min(1).max(50),
    keywords: z.array(keyword).max(100),
    clusters: z.array(cluster).max(30),
  })
  .strict();
export const factRef = z.object({ factId: objectId, revision }).strict();
export const table = z
  .object({
    columns: z.array(z.string().min(1).max(100)).min(1).max(10),
    rows: z.array(z.array(z.string().max(300)).max(10)).max(50),
  })
  .strict()
  .refine((x) => x.rows.every((r) => r.length === x.columns.length));
export const faq = z
  .object({
    question: z.string().trim().min(1).max(300),
    answer: z.string().trim().min(1).max(1800),
    detail: z.string().max(2500),
  })
  .strict();
export const blockItem = z
  .object({
    title: z.string().max(160),
    body: z.string().max(1200),
    assetId: objectId.nullable(),
    alt: z.string().max(200),
    href: z
      .string()
      .max(200)
      .regex(/^(?:\/(?!\/)(?!.*\.\.)[a-zA-Z0-9/_#.-]*|#[a-zA-Z0-9_-]+)$/)
      .nullable(),
    refs: z.array(factRef).max(50),
  })
  .strict();
export const block = z
  .object({
    key,
    type: z.enum([
      "text",
      "specs",
      "faq",
      "image",
      "category-grid",
      "product-grid",
      "split",
      "features",
      "process",
      "customization",
      "evidence",
      "case-study",
      "downloads",
      "cta",
      "comparison",
    ]),
    items: z.array(blockItem).max(12).optional(),
    layout: z.enum(["cards", "split", "reverse", "band", "compact"]).optional(),
    tone: z.enum(["light", "sage", "dark"]).optional(),
    heading: z.string().max(160),
    body: z.string().max(6000),
    table: table.nullable(),
    faq: z.array(faq).max(20),
    assetId: objectId.nullable(),
    alt: z.string().max(200),
    refs: z.array(factRef).max(50),
  })
  .strict();
export const composition = z
  .object({
    version: z.literal("v1"),
    typography: z.enum(["sans", "editorial", "technical"]),
    palette: z.enum(["graphite", "cobalt", "clay", "forest", "violet"]),
    navigation: z.enum(["catalogue", "capabilities", "solutions"]),
    productLayout: z.enum(["cards", "rows", "gallery"]),
  })
  .strict();
export const presentation = z
  .object({
    navigationLabel: z.string().trim().min(1).max(24),
    headline: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(240),
    primaryActionLabel: z.string().trim().min(1).max(32),
    visualStyle: z.enum(["organic", "industrial", "minimal"]),
    heroLayout: z.enum(["split", "stacked", "editorial", "panorama"]),
    composition: composition.optional(),
    designNotes: z.string().max(500),
    density: z.enum(["comfortable", "compact"]).optional(),
    primaryActionTarget: z
      .enum(["collection", "inquiry", "catalogue"])
      .optional(),
  })
  .strict();
export const pageInput = z
  .object({
    title: z.string().trim().min(1).max(100),
    metaDescription: z.string().max(200),
    presentation: presentation.optional(),
    refs: z.array(factRef).max(50),
    blocks: z.array(block).min(1).max(32),
  })
  .strict()
  .refine((x) => new Set(x.blocks.map((b) => b.key)).size === x.blocks.length);
export const designOutput = z
  .object({
    directions: z
      .array(
        z
          .object({
            key: z.enum(["primary", "alternate"]),
            label: z.string().trim().min(1).max(80),
            rationale: z.string().trim().min(1).max(500),
            page: pageInput.refine((p) => !!p.presentation),
          })
          .strict(),
      )
      .length(2),
  })
  .strict()
  .refine((d) => new Set(d.directions.map((v) => v.key)).size === 2)
  .refine((d) => {
    const [a, b] = d.directions.map((v) => v.page);
    return (
      JSON.stringify([
        a.presentation?.visualStyle,
        a.presentation?.heroLayout,
        a.presentation?.density,
        a.presentation?.composition,
        a.blocks.map((v) => [v.type, v.layout, v.tone]),
      ]) !==
      JSON.stringify([
        b.presentation?.visualStyle,
        b.presentation?.heroLayout,
        b.presentation?.density,
        b.presentation?.composition,
        b.blocks.map((v) => [v.type, v.layout, v.tone]),
      ])
    );
  });
export const selectDesignInput = z
  .object({ revision, runId: objectId, key: z.enum(["primary", "alternate"]) })
  .strict();
export const pagePatch = z.object({ revision, data: pageInput }).strict();
export const review = z
  .object({ revision, reason: z.string().trim().max(500).optional() })
  .strict();
export const agentInput = z
  .object({
    step: z.enum([
      "design",
      "interview",
      "research",
      "content",
      "rewrite",
      "review",
      "refine",
    ]),
    consent: z.literal(true),
    pageKey: key.optional(),
    pageId: objectId.optional(),
    blockKey: key.optional(),
    instructions: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((x) => x.step !== "rewrite" || (!!x.pageId && !!x.blockKey))
  .refine((x) => x.step === "rewrite" || (!x.pageId && !x.blockKey));
export const answerInput = z
  .object({
    runId: objectId,
    answers: z
      .array(
        z
          .object({
            questionId: key,
            answer: z.string().trim().min(1).max(800),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.answers.map((a) => a.questionId)).size === x.answers.length,
  );
export const interviewOutput = z
  .object({
    questions: z
      .array(
        z
          .object({
            id: key,
            type: z.string().min(1).max(80),
            question: z.string().min(1).max(240),
            subjectId: objectId.nullable(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export const productSections = [
  "specs",
  "material",
  "application",
  "certifications",
  "oem",
  "moq",
  "samples",
  "packaging",
];
export type PageInput = z.infer<typeof pageInput>;
export type Plan = z.infer<typeof plan>;

export const newPageInput = z.object({ nodeKey: key }).strict();
