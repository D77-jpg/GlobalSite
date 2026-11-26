// S35 B2: logo brief, AI logo candidates and logo selection.
//
// Candidates are generated in a catalog.logo Worker task (lease + fence),
// billed per image through generateImage (reserve/settle), post-processed with
// sharp into square and wide PNGs and stored as generatedConcept assets. AI
// lettering is often misspelled, so every candidate is flagged for a spelling
// check; the deterministic SVG wordmark (brand-mark.service) is always offered
// as the correctly spelled fallback. An uploaded real logo always wins: it is
// selected the same way through site.logoId.
import mongoose from "mongoose";
import sharp from "sharp";
import { z } from "zod";
import {
  AgentAiProvider,
  AgentRun,
  Asset,
  AuditLog,
  Site,
  Task,
} from "../models";
import { AppError, ensure } from "../errors";
import * as v from "../validators/sites.validator";
import { authorizeActor } from "./catalog-authority";
import { fenceTask } from "./product-import.service";
import { pinAssets } from "./catalog.service";
import { assertSiteEditable } from "./publication-lock.service";
import { generateImage } from "./image-studio.service";
import { readAsset, store } from "./storage.service";
import { standaloneWordmarkSvg } from "./brand-mark.service";

export type LogoDesign = z.infer<typeof v.logoDesign>;
export type LogoCandidate = {
  index: number;
  sourceAssetId: string;
  squareAssetId: string;
  wideAssetId: string;
  spellingCheckRequired: true;
};

const PALETTE_COLORS: Record<string, string[]> = {
  obsidian: ["#14110f", "#b8875a"],
  ivory: ["#2b2622", "#c9b28f"],
  clay: ["#5b3426", "#c8754f"],
  graphite: ["#1f2a2e", "#7d8a8f"],
  cobalt: ["#12305f", "#3f7bd6"],
  forest: ["#1f3a2c", "#6f9b72"],
  ocean: ["#0f3b46", "#2c9aa8"],
  violet: ["#2d2240", "#8b6fc4"],
};

/** Rule-derived brief from the site's name and selected composition (editable). */
export function defaultLogoDesign(site: {
  name?: string;
  brandColor?: string;
  designDirection?: {
    composition?: { palette?: string; typography?: string; pack?: string };
  } | null;
}): LogoDesign {
  const c = site.designDirection?.composition;
  const colors =
    (c?.palette && PALETTE_COLORS[c.palette]) ||
    (site.brandColor && /^#[0-9a-f]{6}$/i.test(site.brandColor)
      ? [site.brandColor]
      : ["#1f2a2e"]);
  const keywords = [
    c?.pack === "precision" ? "precision engineering" : "",
    c?.typography === "technical" || c?.typography === "geometric"
      ? "geometric"
      : c?.typography === "luxury" || c?.typography === "editorial"
        ? "refined"
        : "modern",
    "minimal",
  ].filter(Boolean);
  return {
    name: String(site.name ?? "Brand").trim().slice(0, 60) || "Brand",
    keywords,
    colors: colors.slice(0, 3),
    concept:
      c?.pack === "precision"
        ? "Bold condensed wordmark with a simple angular geometric symbol"
        : "Clean wordmark with a simple geometric symbol",
  };
}

export function logoSubject(d: LogoDesign, index: number) {
  const variants = [
    "symbol plus wordmark side by side",
    "wordmark only, strong letterforms",
    "compact emblem above the wordmark",
  ];
  return (
    'Logo for the brand "' +
    d.name +
    '". Exact spelling: ' +
    d.name.split("").join(" ") +
    ". " +
    variants[index % variants.length] +
    ". Style: " +
    d.keywords.join(", ") +
    ". Concept: " +
    d.concept +
    ". Colors " +
    d.colors.join(", ") +
    " on a plain light background; flat vector, no gradients, no photorealistic people, no mockup."
  ).slice(0, 600);
}

/** Square (512) and wide (960x320) PNG variants with transparent padding. */
export async function logoVariants(body: Buffer) {
  let base = sharp(body, { limitInputPixels: 20_000_000 });
  try {
    base = sharp(await base.clone().trim({ threshold: 18 }).png().toBuffer());
  } catch {
    base = sharp(body, { limitInputPixels: 20_000_000 });
  }
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const square = await base
    .clone()
    .resize(512, 512, { fit: "contain", background: transparent })
    .png()
    .toBuffer();
  const wide = await base
    .clone()
    .resize(960, 320, { fit: "contain", background: transparent })
    .png()
    .toBuffer();
  return { square, wide };
}

export async function logoView(siteId: string) {
  const site = await Site.findById(siteId);
  ensure(site, 404, "NOT_FOUND");
  const runs = await AgentRun.find({ kind: "site.logo", siteId })
    .sort({ _id: -1 })
    .limit(3);
  const design: LogoDesign = v.logoDesign.safeParse(site.logoDesign).success
    ? site.logoDesign
    : defaultLogoDesign(site);
  const provider = await AgentAiProvider.findOne({
    name: "images",
    enabled: true,
  })
    .select("enabled")
    .lean();
  return {
    siteId: String(site._id),
    revision: site.revision,
    logoId: site.logoId ? String(site.logoId) : null,
    logoDesign: design,
    imagesConfigured: !!provider,
    wordmarkSvg: standaloneWordmarkSvg(design.name, {
      mark: design.colors[0],
      text: design.colors[0],
    }),
    runs: runs.map((r) => ({
      id: String(r._id),
      status: String(r.status),
      errorCode: r.errorCode ?? null,
      createdAt: r.createdAt,
      candidates: ((r.steps ?? []) as LogoCandidate[]).filter(
        (c) => !!c?.squareAssetId,
      ),
    })),
  };
}

async function createLogoRun(
  siteId: string,
  design: LogoDesign,
  candidates: number,
  actorId: string,
  session: mongoose.ClientSession,
) {
  // Private brief; it never enters a page, version or public snapshot.
  await Site.updateOne(
    { _id: siteId },
    { $set: { logoDesign: design }, $inc: { lockVersion: 1 } },
    { session },
  );
  const [run] = await AgentRun.create(
    [
      {
        kind: "site.logo",
        siteId,
        actorId,
        status: "queued",
        source: { kind: "site", id: siteId, logoDesign: design, candidates },
        steps: [],
      },
    ],
    { session },
  );
  await Task.create(
    [
      {
        kind: "catalog.logo",
        operationId: "logo:" + String(run._id),
        payload: { runId: String(run._id) } as Record<string, unknown>,
      },
    ],
    { session },
  );
  await AuditLog.create(
    [{ action: "site.logo.queued", actorId, targetId: String(run._id) }],
    { session },
  );
  return String(run._id);
}

export async function queueLogo(siteId: string, input: unknown, actorId: string) {
  const d = v.logoGenerateInput.parse(input);
  let runId = "";
  await mongoose.connection.transaction(async (session) => {
    const site = await Site.findById(siteId).session(session);
    ensure(site, 404, "NOT_FOUND");
    ensure(site.status !== "archived", 409, "SITE_ARCHIVED");
    await assertSiteEditable(siteId, session);
    ensure(
      await AgentAiProvider.exists({ name: "images", enabled: true }).session(
        session,
      ),
      409,
      "IMAGE_PROVIDER_MISSING",
    );
    ensure(
      !(await AgentRun.exists({
        kind: "site.logo",
        siteId,
        status: { $in: ["queued", "running"] },
      }).session(session)),
      409,
      "STEP_BUSY",
    );
    runId = await createLogoRun(
      siteId,
      d.logoDesign ?? defaultLogoDesign(site),
      d.candidates ?? 2,
      actorId,
      session,
    );
  });
  return { ...(await logoView(siteId)), runId };
}

/**
 * Design-stage hook: sites that opted into AI images and have no logo get one
 * automatic logo run (once). Skipped silently when images are not configured.
 */
export async function queueAutoLogo(
  site: { _id: unknown; logoId?: unknown; autoImages?: boolean; name?: string; brandColor?: string; designDirection?: unknown },
  actorId: string,
  session: mongoose.ClientSession,
) {
  if (!site.autoImages || site.logoId) return null;
  const siteId = String(site._id);
  if (
    !(await AgentAiProvider.exists({ name: "images", enabled: true }).session(
      session,
    )) ||
    (await AgentRun.exists({ kind: "site.logo", siteId }).session(session))
  )
    return null;
  return createLogoRun(
    siteId,
    defaultLogoDesign(site as Parameters<typeof defaultLogoDesign>[0]),
    2,
    actorId,
    session,
  );
}

type TaskLike = Parameters<typeof fenceTask>[0] & {
  payload: { runId?: string };
};

export async function processLogo(
  task: TaskLike,
  generate: typeof generateImage = generateImage,
) {
  const runId = String(task.payload.runId ?? "");
  const run = await AgentRun.findOne({ _id: runId, kind: "site.logo" });
  ensure(run, 404, "NOT_FOUND");
  if (run.status === "complete") return;
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
    await authorizeActor(String(run.actorId), session);
    await AgentRun.updateOne(
      { _id: run._id },
      { $set: { status: "running" } },
      { session },
    );
  });
  const design = v.logoDesign.parse(run.source?.logoDesign);
  const total = Math.min(3, Math.max(2, Number(run.source?.candidates) || 2));
  const done: LogoCandidate[] = ((run.steps ?? []) as LogoCandidate[]).filter(
    (c) => !!c?.squareAssetId,
  );
  let errorCode: string | null = null;
  for (let index = 0; index < total; index++) {
    if (done.some((c) => c.index === index)) continue;
    let sourceAssetId: string;
    try {
      // Stable per run+index: a resumed task never pays for the same slot twice.
      sourceAssetId = (
        await generate(
          { subject: logoSubject(design, index), composition: "logo" },
          "logo:" + runId + ":" + index,
          { fileLabel: "AI-logo" },
        )
      ).id;
    } catch (error) {
      errorCode = error instanceof AppError ? error.code : "IMAGE_FAILED";
      console.error(JSON.stringify({ event: "logo_candidate_skipped", code: errorCode }));
      if (["IMAGE_PROVIDER_MISSING", "QUOTA_EXCEEDED"].includes(errorCode)) break;
      continue;
    }
    const { body } = await readAsset(sourceAssetId);
    const { square, wide } = await logoVariants(body);
    const sq = await store(square, "image/png", "AI-logo-square.png", "image", undefined, true);
    const wd = await store(wide, "image/png", "AI-logo-wide.png", "image", undefined, true);
    done.push({
      index,
      sourceAssetId,
      squareAssetId: String(sq._id),
      wideAssetId: String(wd._id),
      spellingCheckRequired: true,
    });
    await mongoose.connection.transaction(async (session) => {
      await fenceTask(task, session);
      await AgentRun.updateOne(
        { _id: run._id },
        { $set: { steps: done } },
        { session },
      );
    });
  }
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
    await AgentRun.updateOne(
      { _id: run._id },
      {
        $set: {
          status: done.length ? "complete" : "failed",
          errorCode: done.length ? null : (errorCode ?? "IMAGE_FAILED"),
          resultIds: done.flatMap((c) => [c.squareAssetId, c.wideAssetId]),
        },
      },
      { session },
    );
    await AuditLog.create(
      [{ action: "site.logo.completed", actorId: run.actorId, targetId: runId }],
      { session },
    );
  });
}

/** Selects (or clears) the site logo. A visible change withdraws page approvals. */
export async function selectLogo(siteId: string, input: unknown, actor: string) {
  const d = v.logoSelectInput.parse(input);
  await mongoose.connection.transaction(async (session) => {
    const site = await Site.findById(siteId).session(session);
    ensure(site, 404, "NOT_FOUND");
    await assertSiteEditable(siteId, session);
    ensure(site.revision === d.revision, 409, "REVISION_CONFLICT");
    ensure(
      !(await AgentRun.exists({ siteId, active: true }).session(session)),
      409,
      "STEP_BUSY",
    );
    if (d.assetId) {
      ensure(
        await Asset.exists({
          _id: d.assetId,
          status: "ready",
          mime: /^image\//,
        }).session(session),
        404,
        "NOT_FOUND",
      );
      await pinAssets([d.assetId], session);
    }
    const updated = await Site.findOneAndUpdate(
      { _id: siteId, revision: d.revision },
      d.assetId
        ? { $set: { logoId: d.assetId }, $inc: { revision: 1 } }
        : { $unset: { logoId: 1 }, $inc: { revision: 1 } },
      { session, new: true },
    );
    ensure(updated, 409, "REVISION_CONFLICT");
    await AuditLog.create(
      [{ action: "site.logo.selected", actorId: actor, targetId: siteId }],
      { session },
    );
  });
  return logoView(siteId);
}
