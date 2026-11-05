import { z } from "zod";
export const objectId = z.string().regex(/^[a-f0-9]{24}$/);
const opt = (max: number) => z.string().trim().max(max).nullable().optional();
export const spec = z
  .object({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(500),
    unit: opt(40),
  })
  .strict();
export const specTable = z
  .object({
    columns: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
    rows: z.array(z.array(z.string().max(200)).max(10)).max(50),
  })
  .strict()
  .refine((x) => x.rows.every((r) => r.length === x.columns.length));
export const productInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    sku: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .transform((x) => x.toUpperCase())
      .optional(),
    category: opt(120),
    description: opt(4000),
    material: opt(2000),
    application: opt(2000),
    certifications: z
      .array(z.string().trim().min(1).max(300))
      .max(50)
      .default([]),
    moq: opt(120),
    leadTime: opt(120),
    specs: z.array(spec).max(100).default([]),
    specTable: specTable.nullable().optional(),
    assetIds: z.array(objectId).max(20).default([]),
    status: z.enum(["draft", "active", "archived"]).default("draft"),
  })
  .strict()
  .refine(
    (p) =>
      new Set(p.specs.map((s) => s.code.toUpperCase())).size === p.specs.length,
    "SPEC_DUPLICATE",
  );
export const revision = z.number().int().min(1);
export const productPatch = z.object({ revision, data: productInput }).strict();
export const sourceSchema = z
  .object({
    kind: z.enum(["manual", "product", "asset", "website", "globalcrm"]),
    refId: objectId.optional(),
    url: z
      .string()
      .url()
      .max(1200)
      .refine((x) => /^https?:\/\//i.test(x))
      .optional(),
    revision: z.number().int().positive().optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    quote: z.string().trim().min(1).max(1200),
    label: z.string().max(200).optional(),
    capturedAt: z.string().datetime().optional(),
    textVerified: z.boolean().optional(),
  })
  .strict();
export const factInput = z
  .object({
    subjectType: z.enum(["organization", "product"]),
    subjectId: objectId.optional(),
    type: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(1200),
    unit: opt(40),
    source: sourceSchema,
  })
  .strict()
  .refine((x) => (x.subjectType === "product" ? !!x.subjectId : !x.subjectId));
export const factPatch = z.object({ revision, data: factInput }).strict();
export const transition = z
  .object({ revision, reason: z.string().trim().max(500).optional() })
  .strict();
export const listQuery = z
  .object({
    cursor: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    q: z.string().trim().max(120).optional(),
    status: z.string().max(20).optional(),
    category: z.string().max(120).optional(),
    subjectId: objectId.optional(),
    kind: z.string().max(30).optional(),
  })
  .strict();
export const importMapping = z.partialRecord(
  z.enum([
    "name",
    "sku",
    "category",
    "description",
    "material",
    "application",
    "certifications",
    "moq",
    "leadTime",
    "specs",
    "specTable",
  ]),
  z.string().min(1).max(120),
);
export const importMapBody = z
  .object({ revision, mapping: importMapping })
  .strict();
export const importConfirm = z
  .object({
    revision,
    rows: z.array(z.number().int().min(2).max(1048576)).max(500).optional(),
  })
  .strict();
export const extraction = z
  .object({
    kind: z.enum(["product", "asset"]),
    id: objectId,
    consent: z.literal(true),
  })
  .strict();
export const websiteInput = z
  .object({
    url: z.string().trim().min(1).max(1200),
    maxPages: z.number().int().min(1).max(8).default(5),
  })
  .strict();
