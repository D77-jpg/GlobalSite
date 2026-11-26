import { z } from "zod";
import { ensure } from "../../errors";
import * as v from "../../validators/sites.validator";
import { resolveAgentPage } from "../section-design.service";
import { compositionIssues } from "../site-composition.service";
import {
  validatePage,
  validationIdentifiers,
} from "../page-validation.service";
import { repairFaq } from "./faq-repair";
import {
  repairBrokenFragments,
  repairSamplesSection,
  repairUnsourcedClaims,
  stripAppendedFactValues,
} from "./claim-repair";
import { completeFactRefs } from "./ref-completion";
import type {
  AgentRunDoc,
  AgentStepUnit,
  AgentValidationFeedback,
} from "./types";

export const allowedInterview =
  /^(company\.(name|email|address|founded|capacity|certifications)|product\.(material|application|specifications|leadTime|moq|samples|packaging|oem))$/;

export const reviewOutput = z
  .object({
    summary: z.string().max(600),
    findings: z
      .array(
        z
          .object({
            blockKey: z.string().max(60).nullable(),
            code: z.enum([
              "content_thin",
              "repetition",
              "layout",
              "imagery",
              "procurement",
              "navigation",
              "cta",
            ]),
            severity: z.enum(["warning", "error"]),
            recommendation: z.string().max(500),
          })
          .strict(),
      )
      .max(12),
    // S35 stage D: optional subjective 1-5 scores. They are used only when the
    // run actually sent screenshots to a vision model (visualInput=true).
    scores: z
      .object({
        firstImpression: z.number().int().min(1).max(5),
        rhythm: z.number().int().min(1).max(5),
        density: z.number().int().min(1).max(5),
        credibility: z.number().int().min(1).max(5),
        conversion: z.number().int().min(1).max(5),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const NULLABLE_COMPOSITION_AXES = [
  "pack",
  "surface",
  "headerStyle",
  "radius",
] as const;
const NULLABLE_PRESENTATION_FIELDS = [
  "inquiryHeading",
  "inquiryLead",
  "density",
  "primaryActionTarget",
  "composition",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * S35: strict json_schema decoding widens optional fields to nullable, so a
 * model may return `composition.pack: null` (or surface/headerStyle/radius).
 * Normalize those nulls to omitted keys before zod parsing. Only optional
 * presentation/composition keys are touched; nothing else is rewritten.
 */
export function normalizeNullableAxes(input: unknown, depth = 0): unknown {
  if (depth > 8) return input;
  if (Array.isArray(input))
    return input.map((v) => normalizeNullableAxes(v, depth + 1));
  if (!isRecord(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input))
    out[k] = normalizeNullableAxes(v, depth + 1);
  const presentation = out.presentation;
  if (isRecord(presentation)) {
    const p: Record<string, unknown> = { ...presentation };
    for (const k of NULLABLE_PRESENTATION_FIELDS) if (p[k] === null) delete p[k];
    if (isRecord(p.composition)) {
      const c: Record<string, unknown> = { ...p.composition };
      for (const k of NULLABLE_COMPOSITION_AXES) if (c[k] === null) delete c[k];
      p.composition = c;
    }
    out.presentation = p;
  }
  return out;
}

/**
 * S36 review fix: names whose model codes ("VB-2G", "VG-83") are identifiers
 * rather than numeric claims — the frozen site name, product names and plan
 * node titles of this run.
 */
export function snapshotIdentifiers(run: AgentRunDoc): string[] {
  const s = run.inputSnapshot;
  return validationIdentifiers(s.site.name, s.products, s.site.plan?.nodes);
}

type PageContext = Parameters<typeof validatePage>[2];

/**
 * S36 review fix: the shared deterministic pre-save repair chain for design
 * pages, whole-site content and refine. Order: drop fact values pasted onto
 * item ends, complete refs for facts the text already quotes, FAQ repair,
 * samples section, unsupported-claim removal, cut-out fragment removal. Every
 * step only cites, rebalances or deletes; none writes new claims.
 */
export function repairGeneratedPage(
  run: AgentRunDoc,
  page: v.PageInput,
  context: PageContext,
): v.PageInput {
  const facts = run.inputSnapshot.facts;
  let out = stripAppendedFactValues(page, facts, context);
  out = completeFactRefs(out, facts, context, run.inputSnapshot.products);
  out = repairFaq(out, facts, context, run.inputSnapshot.products);
  out = repairSamplesSection(out, facts, context);
  out = repairUnsourcedClaims(out, facts, context);
  return repairBrokenFragments(out, facts, context);
}

/**
 * S35: deterministic pre-save repair for whole-site generation (content and
 * refine). Same FAQ and unsupported-claim repair as design proposals; it only
 * rebalances, cites literal matching facts, or removes rejected claims.
 */
export function repairDraftPage(
  run: AgentRunDoc,
  unit: AgentStepUnit,
  page: v.PageInput,
): v.PageInput {
  const site = run.inputSnapshot.site;
  const node = unit.node;
  if (!node) return page;
  const context = {
    type: node.type,
    productId: node.productId,
    productIds: site.productIds,
    requiredProductSections: site.plan?.strategy?.productSections,
    paths: (site.plan?.nodes ?? []).map((n) => n.path),
    brandName: site.name,
    language: site.language,
    allowDemoFacts: !!site.demoMode,
    identifiers: snapshotIdentifiers(run),
  };
  return repairGeneratedPage(run, page, context);
}

export const outputSchemas = {
  design: z.toJSONSchema(v.designOutput, { unrepresentable: "any" }),
  review: z.toJSONSchema(reviewOutput),
  research: z.toJSONSchema(v.plan, { unrepresentable: "any" }),
  interview: z.toJSONSchema(v.interviewOutput, { unrepresentable: "any" }),
  content: z.toJSONSchema(z.object({ page: v.pageInput }).strict(), {
    unrepresentable: "any",
  }),
  rewrite: z.toJSONSchema(z.object({ block: v.block }).strict(), {
    unrepresentable: "any",
  }),
} as const;

const UNSUPPORTED_STRICT_KEYWORDS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "uniqueItems",
  "propertyNames",
  "default",
]);

function makeNullable(node: Record<string, unknown>): Record<string, unknown> {
  if (node.type === "null") return node;
  if (typeof node.type === "string") {
    return { ...node, type: [node.type, "null"] };
  }
  if (Array.isArray(node.type)) {
    return node.type.includes("null")
      ? node
      : { ...node, type: [...node.type, "null"] };
  }
  if (Array.isArray(node.anyOf)) {
    const hasNull = node.anyOf.some(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>).type === "null",
    );
    return hasNull
      ? node
      : { ...node, anyOf: [...node.anyOf, { type: "null" }] };
  }
  return { anyOf: [node, { type: "null" }] };
}

/**
 * Converts a Zod-generated JSON Schema into the strict subset accepted by OpenAI
 * and OpenAI-compatible `response_format: { type: "json_schema", strict: true }`
 * endpoints:
 * - Every object declares `additionalProperties: false` and lists all property
 *   keys in `required`.
 * - Optional object properties are widened to nullable so strict mode accepts null.
 * - Validation keywords rejected by strict decoders (minLength, pattern, etc.)
 *   are stripped while full Zod + factual validation still runs server-side.
 */
export function toStrictOpenAiJsonSchema(
  schema: unknown,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {}, required: [], additionalProperties: false };
  }
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(src)) {
    if (UNSUPPORTED_STRICT_KEYWORDS.has(k) || k === "required") continue;
    if (k === "properties" && val && typeof val === "object" && !Array.isArray(val)) {
      const origReq = new Set(
        Array.isArray(src.required) ? src.required.map(String) : [],
      );
      const nextProps: Record<string, unknown> = {};
      const allKeys: string[] = [];
      for (const [pk, pv] of Object.entries(val as Record<string, unknown>)) {
        allKeys.push(pk);
        const converted = toStrictOpenAiJsonSchema(pv);
        nextProps[pk] = origReq.has(pk) ? converted : makeNullable(converted);
      }
      out.properties = nextProps;
      out.required = allKeys;
      out.additionalProperties = false;
    } else if (k === "items") {
      out.items = toStrictOpenAiJsonSchema(val);
    } else if (k === "anyOf" && Array.isArray(val)) {
      out.anyOf = val.map((item) => toStrictOpenAiJsonSchema(item));
    } else if (k === "oneOf" && Array.isArray(val)) {
      out.anyOf = val.map((item) => toStrictOpenAiJsonSchema(item));
    } else if (k === "allOf" && Array.isArray(val)) {
      out.allOf = val.map((item) => toStrictOpenAiJsonSchema(item));
    } else if (k === "additionalProperties") {
      out.additionalProperties = false;
    } else if (k === "$defs" && val && typeof val === "object") {
      const defs: Record<string, unknown> = {};
      for (const [dk, dv] of Object.entries(val as Record<string, unknown>)) {
        defs[dk] = toStrictOpenAiJsonSchema(dv);
      }
      out.$defs = defs;
    } else {
      out[k] = val;
    }
  }
  if (out.type === "object") {
    if (!out.properties) out.properties = {};
    if (!out.required) out.required = Object.keys(out.properties as Record<string, unknown>);
    out.additionalProperties = false;
  }
  return out;
}

const BLOCK_HEIGHT_WEIGHTS: Record<string, number> = {
  image: 520,
  "product-grid": 640,
  "category-grid": 540,
  gallery: 580,
  showcase: 620,
  split: 460,
  features: 440,
  process: 420,
  customization: 440,
  evidence: 420,
  "case-study": 480,
  comparison: 460,
  specs: 420,
  metrics: 280,
  certifications: 380,
  downloads: 340,
  faq: 480,
  cta: 260,
  text: 320,
};

export function estimateHomepageHeightPx(page: v.PageInput): number {
  const heroAndChrome = 920; // header + hero + footer
  let total = heroAndChrome;
  for (const b of page.blocks) {
    total += BLOCK_HEIGHT_WEIGHTS[b.type] ?? 380;
  }
  return total;
}

export function extractFailedBlockKeys(
  issues: Array<{ field: string; blockKey?: string | null }>,
): string[] {
  const keys = new Set<string>();
  for (const issue of issues) {
    if (issue.blockKey) {
      keys.add(issue.blockKey);
      continue;
    }
    const m = /^blocks\.([^.]+)/.exec(issue.field);
    if (m?.[1]) keys.add(m[1]);
  }
  return [...keys];
}

export function validationFeedback(error: unknown): AgentValidationFeedback[] {
  if (!(error instanceof z.ZodError))
    return [{ path: "response", code: "invalid_json" }];
  const fields = new Set([
    "strategy",
    "offering",
    "buyingJourney",
    "decisionFactors",
    "navigation",
    "nodeKeys",
    "productSections",
    "visualPriorities",
    "detail",
    "nodeKey",
    "design",
    "purpose",
    "frame",
    "ratio",
    "fit",
    "focus",
    "directions",
    "rationale",
    "presentation",
    "visualStyle",
    "heroLayout",
    "density",
    "composition",
    "version",
    "typography",
    "palette",
    "surface",
    "headerStyle",
    "radius",
    "pack",
    "productLayout",
    "nodes",
    "keywords",
    "clusters",
    "key",
    "path",
    "title",
    "type",
    "parentKey",
    "productId",
    "term",
    "intent",
    "cluster",
    "label",
    "page",
    "block",
    "blocks",
    "metaDescription",
    "refs",
    "factId",
    "revision",
    "heading",
    "body",
    "table",
    "columns",
    "rows",
    "faq",
    "question",
    "answer",
    "detail",
    "assetId",
    "alt",
    "questions",
    "id",
    "subjectId",
    "items",
    "layout",
    "tone",
    "brief",
    "buyerQuestions",
    "requiredFactTypes",
    "sections",
    "href",
    "navigationLabel",
    "headline",
    "summary",
    "primaryActionLabel",
    "designNotes",
  ]);
  // Only validator field names and limits, never model values/messages.
  return error.issues.slice(0, 12).map((issue) => {
    const customParams =
      issue.code === "custom"
        ? (issue.params as Record<string, unknown> | undefined)
        : undefined;
    const qualityCode =
      customParams &&
      /^CONTENT_[A-Z_]+$/.test(String(customParams.qualityCode ?? ""))
        ? String(customParams.qualityCode)
        : undefined;
    const maximum =
      "maximum" in issue && typeof issue.maximum === "number"
        ? issue.maximum
        : undefined;
    const minimum =
      "minimum" in issue && typeof issue.minimum === "number"
        ? issue.minimum
        : undefined;
    return {
      path: issue.path
        .map((part) =>
          typeof part === "number"
            ? part
            : fields.has(String(part))
              ? String(part)
              : "field",
        )
        .join("."),
      code: issue.code,
      ...(qualityCode ? { qualityCode } : {}),
      ...(maximum !== undefined ? { maximum } : {}),
      ...(minimum !== undefined ? { minimum } : {}),
    };
  });
}

export function validateGeneratedComposition(
  run: AgentRunDoc,
  page: v.PageInput,
  type: string,
): void {
  // Frozen legacy runs keep their former contract. New B2B runs cannot silently
  // fall back to the old one-screen template or mark thin output as complete.
  if (
    !["brand-site-v3", "brand-site-v4"].includes(
      run.inputSnapshot.skillProfile?.version ?? "",
    ) ||
    !(
      run.inputSnapshot.site.buyerProfile ||
      run.inputSnapshot.site.plan?.strategy
    )
  )
    return;
  v.presentation
    .extend({ composition: v.composition })
    .parse(page.presentation);
  const issues = compositionIssues(page, type);
  if (issues.length)
    throw new z.ZodError(
      issues.map((i) => ({
        code: "custom" as const,
        path: ["page", ...i.field.split(".")],
        message: "Composition requirement",
        params: { qualityCode: i.code },
      })),
    );
}

export function prepareDesignPage(
  run: AgentRunDoc,
  unit: AgentStepUnit,
  input: unknown,
) {
  const d = v.designPageOutput.parse(normalizeNullableAxes(input));
  const site = run.inputSnapshot.site;
  const node = unit.node;
  ensure(node, 409, "PLAN_INVALID");
  d.page = resolveAgentPage(d.page);
  const pageContext = {
    type: node.type,
    productId: node.productId,
    productIds: site.productIds,
    requiredProductSections: site.plan?.strategy?.productSections,
    paths: (site.plan?.nodes ?? []).map((n) => n.path),
    brandName: site.name,
    language: site.language,
    allowDemoFacts: !!site.demoMode,
    identifiers: snapshotIdentifiers(run),
  };
  d.page = repairGeneratedPage(run, d.page, pageContext);
  validateGeneratedComposition(run, d.page, node.type);
  ensure(
    d.page.blocks.every((b) => !!b.design),
    502,
    "AI_OUTPUT_INVALID",
  );
  const issues = validatePage(d.page, run.inputSnapshot.facts, pageContext);
  if (issues.length)
    throw new z.ZodError(
      issues.map((i) => ({
        code: "custom" as const,
        path: ["page", ...i.field.split(".")],
        message: "Draft validation requirement",
        params: { qualityCode: "CONTENT_" + i.code },
      })),
    );
  if (unit.pageKind === "detail") {
    const home = run.steps.find(
      (u) =>
        u.directionKey === unit.directionKey &&
        u.pageKind === "home" &&
        u.status === "succeeded",
    );
    const homePage = (home?.output as { page?: v.PageInput } | null)?.page;
    ensure(
      homePage &&
        JSON.stringify(homePage.presentation?.composition) ===
          JSON.stringify(d.page.presentation?.composition),
      502,
      "AI_OUTPUT_INVALID",
    );
  }
  if (unit.directionKey === "alternate" && unit.pageKind === "home") {
    const primaryStep = run.steps.find(
      (u) => u.directionKey === "primary" && u.pageKind === "home",
    );
    const a = (primaryStep?.output as { page: v.PageInput }).page;
    const compA = a.presentation?.composition as Record<string, unknown> | undefined;
    const compB = d.page.presentation?.composition as Record<string, unknown> | undefined;
    const axes = ["typography", "navigation", "productLayout"] as const;
    const differences =
      axes.filter((k) => compA?.[k] !== compB?.[k]).length +
      (a.presentation?.heroLayout !== d.page.presentation?.heroLayout ? 1 : 0);
    const rhythm = (p: v.PageInput) =>
      JSON.stringify(
        p.blocks.map((b) => [b.type, b.design?.frame, b.design?.ratio]),
      );
    if (differences < 2 || rhythm(a) === rhythm(d.page))
      throw new z.ZodError([
        {
          code: "custom",
          path: ["page"],
          message: "Distinct layout required",
          params: { qualityCode: "CONTENT_DIRECTIONS_REQUIRED" },
        },
      ]);
  }
  return d;
}
