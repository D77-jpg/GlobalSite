// S35 stage B: AI illustration fill for generated pages.
//
// Runs inside the site.agent Worker unit, after the model result is stored and
// before the unit is applied, so it shares the run lease, fence and resume
// path. It is opt-in (site.autoImages) and needs a configured images provider.
// Each slot is billed through generateImage (reserve/settle per image). The
// generated asset id is persisted on the unit before use, and the billing
// operation is stable per run+slot, so a resumed unit never pays twice. Any
// failure skips the slot with a fixed event code; the run never fails because
// of illustrations. Existing images are never replaced.
import mongoose from "mongoose";
import { AgentAiProvider, AgentRun, Asset } from "../../models";
import { AppError } from "../../errors";
import * as v from "../../validators/sites.validator";
import { sha } from "../catalog.service";
import { validatePage } from "../page-validation.service";
import { generateImage } from "../image-studio.service";
import type { AgentResult } from "../site-agent-provider.service";
import { fenceRun, ownRun } from "./runtime";
import { normalizeNullableAxes, repairDraftPage } from "./validation";
import type { AgentRunDoc, AgentStepUnit, AgentTaskDoc } from "./types";

export type ImageSlot = {
  key: string;
  blockKey: string;
  itemIndex: number | null;
  kind: "hero" | "split" | "gallery" | "features" | "product";
  composition: "campaign" | "still-life" | "detail";
  subject: string;
  alt: string;
  insertHero?: boolean;
};

const clampInt = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) ? Math.min(12, Math.max(0, n)) : fallback;
};

/** Per-page illustration caps (AUTO_IMAGE_HOME_MAX / AUTO_IMAGE_DETAIL_MAX). */
export function autoImageCaps() {
  return {
    home: clampInt(process.env.AUTO_IMAGE_HOME_MAX, 6),
    detail: clampInt(process.env.AUTO_IMAGE_DETAIL_MAX, 3),
  };
}

const IMAGE_ISSUES = new Set(["CONTENT_IMAGE_REQUIRED", "IMAGE_ALT_REQUIRED"]);
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
const RULES =
  "Commercial B2B illustration. No people, no human faces or hands, no readable text, letters, numbers, labels or logos.";

const heroDesign: NonNullable<v.PageInput["blocks"][number]["design"]> = {
  purpose: "context",
  frame: "story",
  ratio: "landscape",
  fit: "cover",
  focus: "center",
  density: "comfortable",
};

/** Plans missing-image slots in priority order; never targets existing images. */
export function planImageSlots(
  page: v.PageInput,
  options: {
    siteName: string;
    max: number;
    productPaths?: Record<string, { name: string; hasImage: boolean }>;
  },
): ImageSlot[] {
  const slots: ImageSlot[] = [];
  const subjectOf = (...parts: Array<string | undefined>) =>
    clip(
      [options.siteName + ":", ...parts.filter(Boolean)].join(" ") + ". " + RULES,
      560,
    );
  const hasHero = page.blocks.some((b) => b.type === "image" && !!b.assetId);
  if (!hasHero) {
    const empty = page.blocks.find((b) => b.type === "image" && !b.assetId);
    const headline = page.presentation?.headline ?? page.title;
    slots.push({
      key: "hero",
      blockKey: empty?.key ?? "hero-image",
      itemIndex: null,
      kind: "hero",
      composition: "campaign",
      subject: subjectOf("hero scene for", headline),
      alt: clip(headline, 200),
      insertHero: !empty,
    });
  }
  for (const b of page.blocks) {
    if (b.type === "split" && !b.assetId)
      slots.push({
        key: "split:" + b.key,
        blockKey: b.key,
        itemIndex: null,
        kind: "split",
        composition: "still-life",
        subject: subjectOf("companion product scene for", b.heading),
        alt: clip(b.heading || page.title, 200),
      });
  }
  for (const type of ["gallery", "features"] as const)
    for (const b of page.blocks) {
      if (b.type !== type) continue;
      let used = 0;
      for (const [i, item] of (b.items ?? []).entries()) {
        if (item.assetId || used >= 3) continue;
        used++;
        slots.push({
          key: type + ":" + b.key + ":" + i,
          blockKey: b.key,
          itemIndex: i,
          kind: type,
          composition: type === "gallery" ? "detail" : "campaign",
          subject: subjectOf(
            type === "gallery" ? "craft or process detail:" : "application scene:",
            item.title,
            b.heading,
          ),
          alt: clip(item.title || b.heading || page.title, 200),
        });
      }
    }
  for (const b of page.blocks) {
    if (b.type !== "product-grid") continue;
    for (const [i, item] of (b.items ?? []).entries()) {
      const product = item.href ? options.productPaths?.[item.href] : undefined;
      if (item.assetId || !product || product.hasImage) continue;
      slots.push({
        key: "product:" + b.key + ":" + i,
        blockKey: b.key,
        itemIndex: i,
        kind: "product",
        composition: "still-life",
        subject: subjectOf("product concept of", product.name),
        alt: clip(product.name, 200),
      });
    }
  }
  return slots.slice(0, Math.max(0, options.max));
}

/** Applies generated asset ids to their slots; existing images are kept. */
export function applyImageSlots(
  page: v.PageInput,
  slots: ImageSlot[],
  assets: Record<string, string>,
): v.PageInput {
  const out = structuredClone(page);
  for (const slot of slots) {
    const assetId = assets[slot.key];
    if (!assetId) continue;
    if (slot.insertHero) {
      if (out.blocks.some((b) => b.type === "image" && !!b.assetId)) continue;
      out.blocks.unshift({
        key: out.blocks.some((b) => b.key === slot.blockKey)
          ? slot.blockKey + "-ai"
          : slot.blockKey,
        type: "image",
        heading: "",
        body: "",
        table: null,
        faq: [],
        assetId,
        alt: slot.alt || "Illustrative image",
        refs: [],
        ...(out.blocks.some((b) => b.design) ? { design: heroDesign } : {}),
      });
      continue;
    }
    const block = out.blocks.find((b) => b.key === slot.blockKey);
    if (!block) continue;
    if (slot.itemIndex === null) {
      if (block.assetId) continue;
      block.assetId = assetId;
      if (!block.alt.trim()) block.alt = slot.alt || "Illustrative image";
    } else {
      const item = block.items?.[slot.itemIndex];
      if (!item || item.assetId) continue;
      item.assetId = assetId;
      if (!item.alt.trim()) item.alt = slot.alt || "Illustrative image";
    }
  }
  return out;
}

function issueCount(
  run: AgentRunDoc,
  unit: AgentStepUnit,
  page: v.PageInput,
  onlyImage: boolean,
) {
  const site = run.inputSnapshot.site;
  return validatePage(page, run.inputSnapshot.facts, {
    type: unit.node?.type ?? "home",
    productId: unit.node?.productId,
    productIds: site.productIds,
    requiredProductSections: site.plan?.strategy?.productSections,
    paths: (site.plan?.nodes ?? []).map((n) => n.path),
    brandName: site.name,
    language: site.language,
    allowDemoFacts: !!site.demoMode,
  }).filter((i) => IMAGE_ISSUES.has(i.code) === onlyImage).length;
}

function event(code: string) {
  console.error(JSON.stringify({ event: "auto_image_skipped", code }));
  return code;
}

/**
 * Fills missing images for one design/content/refine unit. Returns the result
 * unchanged when disabled, unconfigured or nothing is missing.
 */
export async function fillUnitImages(
  run: AgentRunDoc,
  index: number,
  result: AgentResult,
  task: AgentTaskDoc,
  generate: typeof generateImage = generateImage,
): Promise<AgentResult> {
  const unit = run.steps[index];
  const site = run.inputSnapshot.site;
  if (
    result.errorCode ||
    !site.autoImages ||
    !unit?.node ||
    !["design", "content", "refine"].includes(run.step) ||
    (run.step === "design" && !unit.pageKind)
  )
    return result;
  const raw = normalizeNullableAxes(result.output) as {
    page?: unknown;
  } & Record<string, unknown>;
  const parsed = v.pageInput.safeParse(raw?.page);
  if (!parsed.success) return result;
  const page = repairDraftPage(run, unit, parsed.data);
  // Only spend on pages whose remaining issues are image-related.
  if (issueCount(run, unit, page, false) > 0) return result;
  const isHome = unit.node.type === "home";
  const caps = autoImageCaps();
  const productPaths: Record<string, { name: string; hasImage: boolean }> = {};
  for (const n of site.plan?.nodes ?? []) {
    if (n.type !== "product" || !n.productId) continue;
    const p = run.inputSnapshot.products.find((x) => x.id === n.productId);
    if (p) productPaths[n.path] = { name: p.name, hasImage: !!p.assetIds?.length };
  }
  const slots = planImageSlots(page, {
    siteName: site.name,
    max: isHome ? caps.home : caps.detail,
    productPaths,
  });
  if (!slots.length) return result;
  const provider = await AgentAiProvider.findOne({ name: "images", enabled: true })
    .select("enabled")
    .lean();
  if (!provider) return result;

  const palette = (site.designDirection?.composition?.palette ??
    page.presentation?.composition?.palette) as
    | "obsidian"
    | "ivory"
    | "clay"
    | "graphite"
    | "cobalt"
    | "forest"
    | "ocean"
    | "violet"
    | "brand"
    | undefined;
  const assets: Record<string, string> = { ...(unit.generatedImages ?? {}) };
  const events: string[] = [...(unit.imageEvents ?? [])];
  let stop = false;
  for (const slot of slots) {
    if (stop) break;
    if (assets[slot.key]) {
      if (
        await Asset.exists({ _id: assets[slot.key], status: "ready" })
      )
        continue;
      delete assets[slot.key];
    }
    const originKey =
      "auto-image:" +
      sha(
        JSON.stringify({
          site: site.id,
          node: unit.node.key,
          slot: slot.key,
          palette: palette ?? null,
          subject: slot.subject,
        }),
      ).slice(0, 48);
    const reused = await Asset.findOne({
      originKey,
      status: "ready",
      generatedConcept: true,
    })
      .select("_id")
      .lean();
    let assetId = reused ? String(reused._id) : "";
    if (!assetId) {
      try {
        const generated = await generate(
          {
            subject: slot.subject,
            composition: slot.composition,
            ...(palette ? { palette } : {}),
          },
          "auto:" + String(run._id) + ":" + originKey.slice(11, 43),
          { originKey },
        );
        assetId = generated.id;
      } catch (error) {
        const code = error instanceof AppError ? error.code : "IMAGE_FAILED";
        events.push(event(code));
        if (["IMAGE_PROVIDER_MISSING", "QUOTA_EXCEEDED"].includes(code))
          stop = true;
        continue;
      }
    }
    assets[slot.key] = assetId;
    // Persist before use so a resumed unit reuses the paid image.
    await mongoose.connection.transaction(async (session) => {
      await fenceRun(task, session);
      const fresh = await ownRun(String(run._id), session);
      if (fresh.cancelRequested) throw new AppError(409, "AGENT_CANCELLED");
      await AgentRun.updateOne(
        { _id: fresh._id },
        {
          $set: {
            ["steps." + index + ".generatedImages"]: assets,
            ["steps." + index + ".imageEvents"]: events.slice(-20),
          },
        },
        { session },
      );
    });
  }
  const filled = applyImageSlots(page, slots, assets);
  // Never let illustrations make validation worse.
  if (
    issueCount(run, unit, filled, true) > issueCount(run, unit, page, true) ||
    issueCount(run, unit, filled, false) > 0
  ) {
    events.push(event("IMAGE_FILL_REVERTED"));
    return result;
  }
  return { ...result, output: { ...raw, page: filled } };
}
