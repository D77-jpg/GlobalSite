import { procurementCoverage } from "./b2b-planning.service";
import {
  inquiryBuildConfig,
  previewGrant,
  validateInquiryGateway,
} from "./inquiry-settings.service";
import mongoose from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import {
  Product,
  Site,
  SitePage,
  FactSheet,
  AgentRun,
  Membership,
  AuditLog,
  Task,
  UsageRecord,
  SiteVersion,
  SiteDeployment,
  PublishingSettings,
} from "../models";
import { tenantContext } from "../models/tenant-context";
import { ensure, AppError } from "../errors";
import {
  ownSite,
  siteDto,
  pageView,
  pageData,
  savePage,
} from "./sites.service";
import { sha } from "./catalog.service";
import { validatePage } from "./page-validation.service";
import { reserve, settle } from "./usage.service";
import { readAsset, readArtifact, storeArtifact } from "./storage.service";
import { encrypt, decrypt } from "./credential-crypto";
import { fenceTask } from "./product-import.service";
import { authorizeActor } from "./catalog-authority";
import { buildStatic, unpack } from "./static-builder.service";
import type { Snapshot } from "./static-template.service";
import * as cf from "./cloudflare-pages.service";
import { fetchWebsite } from "./website/public-web";
const safeHost = (s: string) =>
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(s) &&
  !/(^|\.)(localhost|local|internal|test)$/.test(s);
const host = z.string().toLowerCase().refine(safeHost);
export const settingsInput = z
  .object({
    revision: z.number().int().min(0),
    canonicalBaseUrl: z.string().url().nullable(),
    accountId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .nullable(),
    projectName: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,57}$/)
      .nullable(),
    productionBranch: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,99}$/),
    domain: host.nullable(),
    token: z.string().min(20).max(1024).nullable().optional(),
  })
  .strict();
export const empty = z.object({}).strict();
export const versionInput = z
  .object({ versionId: z.string().regex(/^[a-f0-9]{24}$/) })
  .strict();
export function settingsDto(s: any) {
  return {
    revision: s?.revision ?? 0,
    canonicalBaseUrl: s?.canonicalBaseUrl ?? null,
    accountId: s?.accountId ?? null,
    projectName: s?.projectName ?? null,
    productionBranch: s?.productionBranch ?? "main",
    domain: s?.domain ?? null,
    configured: !!s?.secret,
    httpsStatus: s?.httpsStatus ?? null,
    checkedAt: s?.checkedAt?.toISOString() ?? null,
  };
}
export async function settings(id: string) {
  await ownSite(id);
  return settingsDto(
    await PublishingSettings.findOne({ siteId: id }).select("+secret"),
  );
}
export async function saveSettings(id: string, input: unknown, actor: string) {
  const v = settingsInput.parse(input);
  if (v.canonicalBaseUrl) {
    const u = new URL(v.canonicalBaseUrl);
    ensure(
      u.protocol === "https:" &&
        safeHost(u.hostname) &&
        !u.username &&
        !u.password &&
        !u.port &&
        u.pathname === "/" &&
        !u.search &&
        !u.hash,
      400,
      "CANONICAL_INVALID",
    );
    v.canonicalBaseUrl = u.origin;
  }
  ensure(!!v.accountId === !!v.projectName, 400, "CLOUDFLARE_CONFIG_INVALID");
  if (v.domain)
    ensure(
      v.canonicalBaseUrl === "https://" + v.domain,
      400,
      "DOMAIN_CANONICAL_MISMATCH",
    );
  if (v.projectName && v.canonicalBaseUrl && !v.domain)
    ensure(
      v.canonicalBaseUrl === "https://" + v.projectName + ".pages.dev",
      400,
      "DOMAIN_CANONICAL_MISMATCH",
    );
  await mongoose.connection.transaction(async (session) => {
    const site = await ownSite(id, session);
    ensure(site.status !== "archived", 409, "SITE_ARCHIVED");
    await Site.updateOne(
      { _id: id },
      { $inc: { lockVersion: 1 } },
      { session },
    );
    const active = await SiteDeployment.findOne({
      siteId: id,
      active: true,
    }).session(session);
    const old = await PublishingSettings.findOne({ siteId: id })
      .select("+secret")
      .session(session);
    ensure((old?.revision ?? 0) === v.revision, 409, "REVISION_CONFLICT");
    const { token, revision, ...data } = v;
    if (active) {
      ensure(
        old &&
          typeof token === "string" &&
          [
            "canonicalBaseUrl",
            "accountId",
            "projectName",
            "productionBranch",
            "domain",
          ].every((k) => (data as any)[k] === (old as any)[k]),
        409,
        "DEPLOYMENT_BUSY",
      );
      await SiteDeployment.updateOne(
        { _id: active._id },
        { $set: { settingsRevision: revision + 1 } },
        { session },
      );
    }
    const secret =
      typeof token === "string"
        ? encrypt(
            token,
            "cloudflare:" + tenantContext()!.organizationId + ":" + id,
          )
        : token === null
          ? null
          : old?.secret;
    ensure(
      !secret || (data.accountId && data.projectName && data.canonicalBaseUrl),
      400,
      "CLOUDFLARE_CONFIG_INVALID",
    );
    // Credentials never leave the encrypted model; audit records only an action and target.
    await PublishingSettings.updateOne(
      { siteId: id },
      {
        $set: {
          ...data,
          secret,
          revision: revision + 1,
          httpsStatus: null,
          checkedAt: null,
        },
      },
      { upsert: true, session },
    );
    await AuditLog.create(
      [{ action: "site.publishing.configured", actorId: actor, targetId: id }],
      { session },
    );
  });
  return settings(id);
}
export function versionDto(v: any) {
  return {
    id: String(v._id),
    siteId: String(v.siteId),
    number: v.number,
    status: v.status,
    snapshotHash: v.snapshotHash,
    artifactHash: v.artifactHash ?? null,
    bytes: v.bytes ?? 0,
    errorCode: v.errorCode ?? null,
    createdAt: v.createdAt.toISOString(),
    report: v.report ?? null,
  };
}
export function deploymentDto(d: any) {
  return {
    id: String(d._id),
    siteId: String(d.siteId),
    versionId: String(d.versionId),
    status: d.status,
    kind: d.kind,
    url: d.url ?? null,
    errorCode: d.errorCode ?? null,
    createdAt: d.createdAt.toISOString(),
    artifactHash: d.artifactHash,
  };
}
export async function ownVersion(id: string) {
  const v = await SiteVersion.findById(id);
  ensure(v, 404, "NOT_FOUND");
  await ownSite(String(v.siteId));
  return v;
}
async function actorAdmin(id: string, session?: mongoose.ClientSession) {
  await authorizeActor(id, session);
  ensure(
    await Membership.exists({
      userId: id,
      status: "active",
      role: "admin",
    }).session(session ?? null),
    403,
    "ACTOR_REVOKED",
  );
}
type BuildIssue = {
  code: string;
  pageId: string | null;
  path: string | null;
  fixable: boolean;
};
async function inspect(id: string, session?: mongoose.ClientSession) {
  const site = await ownSite(id, session),
    issues: BuildIssue[] = [],
    pages: any[] = [];
  const add = (code: string, p?: any, fixable = false) =>
    issues.push({
      code,
      pageId: p && (p.id || p._id) ? String(p.id ?? p._id) : null,
      path: p?.path ?? null,
      fixable,
    });
  const cfg = await PublishingSettings.findOne({ siteId: id }).session(
    session ?? null,
  );
  if (!cfg?.canonicalBaseUrl) add("CANONICAL_REQUIRED");
  if (!siteDto(site).planConfirmed) add("PLAN_NOT_CONFIRMED");
  if (site.status === "archived") add("SITE_ARCHIVED");
  if (
    await AgentRun.exists({ siteId: id, active: true }).session(session ?? null)
  )
    add("AGENT_ACTIVE");
  const rows = await SitePage.find({ siteId: id }).session(session ?? null),
    titles = new Set<string>();
  for (const node of site.plan?.nodes ?? []) {
    const row = rows.find((p) => p.nodeKey === node.key);
    if (!row) {
      add("PAGE_MISSING", { id: null, path: node.path });
      continue;
    }
    const p = await pageView(row, site, session);
    pages.push(p);
    if (p.status !== "approved") add("PAGE_NOT_APPROVED", p);
    for (const i of p.issues)
      add(
        i.code,
        p,
        i.code === "IMAGE_ALT_REQUIRED" &&
          p.blocks.some(
            (b) => b.key === i.blockKey && !!b.assetId && !!b.heading?.trim(),
          ),
      );
    if (!p.title.trim()) add("TITLE_MISSING", p);
    const title = p.title.trim().toLowerCase();
    if (titles.has(title)) add("TITLE_DUPLICATE", p);
    titles.add(title);
    if (!p.metaDescription.trim()) add("DESCRIPTION_MISSING", p, true);
    const text = p.blocks
      .map((b: any) =>
        [
          b.body,
          ...(b.items ?? []).map((i: any) => i.title + " " + i.body),
          ...(b.faq ?? []).map((q: any) => q.answer),
          ...(b.table?.rows ?? []).flat(),
        ].join(" "),
      )
      .join(" ");
    if (text.trim().split(/\s+/).filter(Boolean).length < 60)
      add("CONTENT_TOO_SHORT", p);
  }
  if (!pages.length) add("PAGE_MISSING");
  return { site, pages, cfg, issues };
}
export async function preflight(id: string) {
  const r = await inspect(id);
  return { ready: !r.issues.length, issues: r.issues, repaired: 0 };
}
export async function repair(id: string, actor: string) {
  const r = await inspect(id);
  let repaired = 0;
  for (const p of r.pages) {
    const data = await pageData(await SitePage.findById(p.id));
    let changed = false;
    if (!data.metaDescription.trim()) {
      const text = data.blocks
        .map((b) => b.body)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length >= 20) {
        data.metaDescription = text.slice(0, 160);
        changed = true;
      }
    }
    for (const b of data.blocks)
      if (b.type === "image" && !b.alt.trim() && b.heading.trim()) {
        b.alt = b.heading;
        changed = true;
      }
    if (changed) {
      await savePage(p.id, p.revision, data, actor);
      repaired++;
    }
  }
  return { ...(await preflight(id)), repaired };
}
export async function palette(id: string) {
  const s = await ownSite(id);
  ensure(s.logoId, 409, "LOGO_REQUIRED");
  const { body } = await readAsset(String(s.logoId), "webp");
  const { data, info } = await sharp(body)
    .resize(48, 48, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += info.channels) {
    const rgb = [data[i], data[i + 1], data[i + 2]]
      .map((v) => Math.round(v / 32) * 32)
      .map((v) => Math.min(255, v));
    if (info.channels === 4 && data[i + 3] < 128) continue;
    const hex = "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return {
    colors: [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c]) => c)
      .concat(counts.size ? [] : ["#16634a"]),
  };
}
async function snapshot(
  id: string,
  session: mongoose.ClientSession,
): Promise<Snapshot> {
  const r = await inspect(id, session);
  ensure(!r.issues.length, 409, "SITE_NOT_READY");
  await Site.updateOne({ _id: id }, { $inc: { lockVersion: 1 } }, { session });
  const ids = [
    ...new Set(
      r.pages.flatMap((p) =>
        [
          ...p.refs,
          ...p.blocks.flatMap((b: any) => [
            ...b.refs,
            ...(b.items ?? []).flatMap((i: any) => i.refs),
          ]),
        ].map((v: any) => v.factId),
      ),
    ),
  ];
  const facts = await FactSheet.find({
    _id: { $in: ids },
    status: "confirmed",
  }).session(session);
  for (const f of facts)
    await FactSheet.updateOne(
      { _id: f._id, revision: f.revision, status: "confirmed" },
      { $inc: { referenceVersion: 1 } },
      { session },
    );
  const inquiryData = await inquiryBuildConfig(r.site, session);
  return JSON.parse(
    JSON.stringify({
      inquiry: inquiryData.inquiry,
      site: siteDto(r.site),
      pages: r.pages.map((p) => ({ ...p })),
      products: (
        await Product.find({
          _id: { $in: r.site.productIds },
          status: { $ne: "archived" },
        }).session(session)
      ).map((p) => ({
        id: String(p._id),
        name: p.name,
        category: p.category ?? null,
        assetIds: (p.assetIds ?? []).map(String),
      })),
      facts: [
        ...facts.map((f) => ({
          id: String(f._id),
          revision: f.revision,
          type: f.type,
          value: f.value,
          subjectType: f.subjectType,
          subjectId: f.subjectId ? String(f.subjectId) : null,
        })),
        ...inquiryData.facts.filter(
          (f) => !facts.some((existing) => String(existing._id) === f.id),
        ),
      ],
      settings: {
        canonicalBaseUrl: r.cfg.canonicalBaseUrl,
        revision: r.cfg.revision,
      },
      assets: {},
      createdAt: new Date().toISOString(),
    }),
  );
}
function requestKey(value: string) {
  ensure(/^[A-Za-z0-9:_-]{8,100}$/.test(value), 400, "IDEMPOTENCY_REQUIRED");
  return value;
}
export async function queueBuild(id: string, key: string, actor: string) {
  const operationId = "build:" + requestKey(key),
    requestHash = sha(id),
    old = await SiteVersion.findOne({ operationId });
  if (old) {
    ensure(old.requestHash === requestHash, 409, "IDEMPOTENCY_CONFLICT");
    return versionDto(old);
  }
  ensure(
    !(await UsageRecord.exists({
      metric: "builds",
      operationId,
      state: "released",
    })),
    409,
    "IDEMPOTENCY_CLOSED",
  );
  await reserve("builds", 1, operationId);
  let result: any;
  try {
    await mongoose.connection.transaction(async (session) => {
      const duplicate = await SiteVersion.findOne({ operationId }).session(
        session,
      );
      if (duplicate) {
        ensure(
          duplicate.requestHash === requestHash,
          409,
          "IDEMPOTENCY_CONFLICT",
        );
        result = duplicate;
        return;
      }
      const frozen = await snapshot(id, session);
      ensure(
        !(await SiteVersion.exists({ siteId: id, active: true }).session(
          session,
        )),
        409,
        "BUILD_BUSY",
      );
      const site = await Site.findOneAndUpdate(
        { _id: id },
        { $inc: { versionCounter: 1 } },
        { session, new: true },
      );
      [result] = await SiteVersion.create(
        [
          {
            siteId: id,
            number: site!.versionCounter,
            actorId: actor,
            operationId,
            requestHash,
            snapshot: frozen,
            snapshotHash: sha(JSON.stringify(frozen)),
            artifactKey: randomUUID(),
            status: "queued",
            active: true,
          },
        ],
        { session },
      );
      await Task.create(
        [
          {
            kind: "site.build",
            operationId: "site.build:" + result._id,
            payload: { runId: String(result._id) },
            status: "pending",
            nextAttemptAt: new Date(),
          },
        ],
        { session },
      );
      await AuditLog.create(
        [
          {
            action: "site.build.queued",
            actorId: actor,
            targetId: String(result._id),
          },
        ],
        { session },
      );
    });
  } catch (e) {
    if (!(await SiteVersion.exists({ operationId })))
      await settle("builds", operationId, 0);
    throw e;
  }
  return versionDto(result);
}
export async function validVersion(
  v: any,
  current = false,
  session?: mongoose.ClientSession,
  commercial = false,
) {
  const s = v.snapshot as Snapshot;
  const available = await Product.countDocuments({
    _id: { $in: s.site.productIds ?? [] },
    status: { $ne: "archived" },
    crmSourceStatus: { $nin: ["archived", "withdrawn"] },
  }).session(session ?? null);
  ensure(
    available === (s.site.productIds ?? []).length,
    409,
    "CRM_SOURCE_WITHDRAWN",
  );
  const facts = await FactSheet.find({
    _id: { $in: s.facts.map((f) => f.id) },
  }).session(session ?? null);
  ensure(
    s.facts.every((f) =>
      facts.some(
        (x) =>
          String(x._id) === f.id &&
          x.status === "confirmed" &&
          x.revision === f.revision,
      ),
    ),
    409,
    "VERSION_FACTS_CHANGED",
  );
  for (const p of s.pages)
    ensure(
      !validatePage(p, facts, {
        productId: p.productId,
        productIds: s.site.productIds,
        type: p.type,
        brandName: s.site.name,
        requireComposition: !!s.site.designDirection?.composition,
        paths: s.pages.map((p) => p.path),
      }).length,
      409,
      "VERSION_FACTS_CHANGED",
    );
  const site = await ownSite(String(v.siteId), session);
  ensure(site.status !== "archived", 409, "SITE_ARCHIVED");
  if (commercial && current && site.buyerProfile) {
    const products = await Product.find({
      _id: { $in: site.productIds },
    }).session(session ?? null);
    const allFacts = await FactSheet.find({
      status: "confirmed",
      $or: [
        { subjectType: "organization" },
        { subjectId: { $in: site.productIds } },
      ],
    }).session(session ?? null);
    ensure(
      procurementCoverage(site, products, allFacts).canPublish,
      409,
      "PROCUREMENT_INCOMPLETE",
    );
    const review = await AgentRun.findOne({
      siteId: v.siteId,
      step: "review",
      status: "succeeded",
      qualityAcceptedAt: { $type: "date" },
    })
      .sort({ _id: -1 })
      .session(session ?? null);
    ensure(
      review &&
        review.inputSnapshot.site.revision === site.revision &&
        review.inputSnapshot.site.planRevision === site.planRevision,
      409,
      "QUALITY_REVIEW_REQUIRED",
    );
    for (const page of s.pages)
      ensure(
        review.steps.some(
          (u: any) =>
            u.key === page.nodeKey && u.expectedRevision === page.revision,
        ),
        409,
        "QUALITY_REVIEW_REQUIRED",
      );
  }
  if (current) {
    ensure(
      !(await AgentRun.exists({ siteId: v.siteId, active: true }).session(
        session ?? null,
      )),
      409,
      "AGENT_ACTIVE",
    );
    ensure(
      site.revision === s.site.revision &&
        site.confirmedPlanHash === sha(JSON.stringify(s.site.plan)),
      409,
      "VERSION_SOURCE_CHANGED",
    );
    for (const p of s.pages) {
      const row = await SitePage.findById(p.id).session(session ?? null);
      ensure(row, 409, "VERSION_SOURCE_CHANGED");
      const view = await pageView(row, site, session);
      ensure(
        view.status === "approved" && view.hash === p.hash,
        409,
        "VERSION_SOURCE_CHANGED",
      );
    }
  }
  if (session) {
    await Site.updateOne(
      { _id: site._id },
      { $inc: { lockVersion: 1 } },
      { session },
    );
    for (const f of facts)
      await FactSheet.updateOne(
        { _id: f._id, revision: f.revision, status: "confirmed" },
        { $inc: { referenceVersion: 1 } },
        { session },
      );
  }
}
export async function queueDeployment(
  id: string,
  versionId: string,
  key: string,
  actor: string,
  kind: "publish" | "rollback",
) {
  const operationId = "deploy:" + requestKey(key),
    requestHash = sha(JSON.stringify({ id, versionId, kind })),
    old = await SiteDeployment.findOne({ operationId });
  if (old) {
    ensure(old.requestHash === requestHash, 409, "IDEMPOTENCY_CONFLICT");
    return deploymentDto(old);
  }
  const v = await ownVersion(versionId);
  ensure(
    String(v.siteId) === id && v.status === "ready",
    409,
    "VERSION_NOT_READY",
  );
  await validVersion(v, kind === "publish", undefined, kind === "publish");
  await validateInquiryGateway(v);
  const cfg = await PublishingSettings.findOne({ siteId: id }).select(
    "+secret",
  );
  ensure(
    cfg?.secret && cfg.accountId && cfg.projectName,
    409,
    "CLOUDFLARE_UNCONFIGURED",
  );
  ensure(
    cfg.canonicalBaseUrl === v.snapshot.settings.canonicalBaseUrl,
    409,
    "VERSION_CONFIG_CHANGED",
  );
  if (cfg.domain)
    ensure(
      cfg.httpsStatus === "valid" &&
        cfg.checkedAt &&
        Date.now() - cfg.checkedAt.getTime() < 86400000,
      409,
      "DOMAIN_NOT_READY",
    );
  if (kind === "rollback")
    ensure(
      await SiteDeployment.exists({ siteId: id, versionId, status: "live" }),
      409,
      "ROLLBACK_VERSION_REQUIRED",
    );
  ensure(
    !(await UsageRecord.exists({
      metric: "publishes",
      operationId,
      state: "released",
    })),
    409,
    "IDEMPOTENCY_CLOSED",
  );
  await reserve("publishes", 1, operationId);
  let result: any;
  try {
    await mongoose.connection.transaction(async (session) => {
      const duplicate = await SiteDeployment.findOne({ operationId }).session(
        session,
      );
      if (duplicate) {
        ensure(
          duplicate.requestHash === requestHash,
          409,
          "IDEMPOTENCY_CONFLICT",
        );
        result = duplicate;
        return;
      }
      await Site.updateOne(
        { _id: id },
        { $inc: { lockVersion: 1 } },
        { session },
      );
      await actorAdmin(actor, session);
      await validVersion(v, kind === "publish", session, kind === "publish");
      ensure(
        !(await SiteDeployment.exists({ siteId: id, active: true }).session(
          session,
        )),
        409,
        "DEPLOYMENT_BUSY",
      );
      [result] = await SiteDeployment.create(
        [
          {
            siteId: id,
            versionId,
            actorId: actor,
            createdBy: actor,
            operationId,
            requestHash,
            kind,
            artifactHash: v.artifactHash,
            settingsRevision: cfg.revision,
            active: true,
          },
        ],
        { session },
      );
      await Task.create(
        [
          {
            kind: "site.deploy",
            operationId: "site.deploy:" + result._id,
            payload: { runId: String(result._id) },
            status: "pending",
            nextAttemptAt: new Date(),
          },
        ],
        { session },
      );
      await AuditLog.create(
        [
          {
            action: "site." + kind + ".queued",
            actorId: actor,
            targetId: String(result._id),
          },
        ],
        { session },
      );
    });
  } catch (e) {
    if (!(await SiteDeployment.exists({ operationId })))
      await settle("publishes", operationId, 0);
    throw e;
  }
  return deploymentDto(result);
}
async function checkTask(task: any) {
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
  });
}
export async function processPublishing(
  task: any,
): Promise<{ status: "done" | "pending" | "dead"; error?: string }> {
  const isBuild = task.kind === "site.build",
    model = isBuild ? SiteVersion : SiteDeployment,
    row = await model.findById(task.payload.runId);
  if (!row) return { status: "dead", error: "NOT_FOUND" };
  if (["ready", "live", "failed"].includes(row.status)) {
    await settle(
      isBuild ? "builds" : "publishes",
      row.operationId,
      row.status === "failed" && !isBuild ? 0 : 1,
    );
    return { status: row.status === "failed" ? "dead" : "done" };
  }
  try {
    await checkTask(task);
    await authorizeActor(String(row.actorId));
    if (isBuild) {
      await validVersion(row, true);
      await mongoose.connection.transaction(async (session) => {
        await fenceTask(task, session);
        await model.updateOne(
          { _id: row._id },
          { $set: { status: "building" } },
          { session },
        );
      });
      const built = await buildStatic(row.snapshot);
      await checkTask(task);
      await authorizeActor(String(row.actorId));
      await validVersion(row, true);
      const artifactHash = createHash("sha256")
        .update(built.body)
        .digest("hex");
      await storeArtifact(built.body, row.artifactKey);
      await mongoose.connection.transaction(async (session) => {
        await fenceTask(task, session);
        await validVersion(row, true, session);
        await authorizeActor(String(row.actorId), session);
        await model.updateOne(
          { _id: row._id },
          {
            $set: {
              status: "ready",
              active: false,
              artifactHash,
              bytes: built.body.length,
              report: built.report,
            },
            $unset: { errorCode: 1 },
          },
          { session },
        );
      });
      await settle("builds", row.operationId, 1);
      return { status: "done" };
    }
    await actorAdmin(String(row.actorId));
    const v = await ownVersion(String(row.versionId));
    await validVersion(
      v,
      row.kind === "publish",
      undefined,
      row.kind === "publish",
    );
    await validateInquiryGateway(v);
    const cfg = await PublishingSettings.findOne({ siteId: row.siteId }).select(
      "+secret",
    );
    ensure(
      cfg?.secret && cfg.revision === row.settingsRevision,
      409,
      "VERSION_CONFIG_CHANGED",
    );
    const token = decrypt(
      cfg.secret,
      "cloudflare:" + tenantContext()!.organizationId + ":" + row.siteId,
    );
    const zip = await readArtifact(v.artifactKey);
    ensure(
      createHash("sha256").update(zip).digest("hex") === v.artifactHash,
      409,
      "ARTIFACT_INVALID",
    );
    const files = unpack(zip);
    if (!row.providerId) {
      // Recover an ambiguous POST by its fixed operation marker. Never blindly create it twice.
      if (row.attemptedAt) {
        const list = await cf.pagesClient.request(
          token,
          cf.projectPath(cfg) + "/deployments?per_page=100",
        );
        const found = Array.isArray(list)
          ? list.filter(
              (d: any) =>
                d.deployment_trigger?.metadata?.commit_message ===
                "GlobalSite " + row._id,
            )
          : [];
        ensure(found.length === 1, 409, "DEPLOYMENT_UNKNOWN");
        row.providerId = found[0].id;
      } else {
        const manifest = await cf.pagesClient.uploadFiles(cfg, token, files);
        await checkTask(task);
        await actorAdmin(String(row.actorId));
        await validVersion(
          v,
          row.kind === "publish",
          undefined,
          row.kind === "publish",
        );
        await mongoose.connection.transaction(async (session) => {
          await fenceTask(task, session);
          await model.updateOne(
            { _id: row._id },
            { $set: { attemptedAt: new Date(), status: "uploading" } },
            { session },
          );
        });
        const remote = await cf.pagesClient.submitDeployment(
          cfg,
          token,
          manifest,
          String(row._id),
        );
        row.providerId = remote.id;
        row.providerUrl = remote.url;
      }
      await mongoose.connection.transaction(async (session) => {
        await fenceTask(task, session);
        await model.updateOne(
          { _id: row._id },
          {
            $set: {
              providerId: row.providerId,
              providerUrl: row.providerUrl,
              status: "verifying",
            },
          },
          { session },
        );
      });
    }
    const verified = await cf.pagesClient.verifyDeployment(
      cfg,
      token,
      row.providerId,
      files,
    );
    if (!verified) return { status: "pending" };
    await validVersion(
      v,
      row.kind === "publish",
      undefined,
      row.kind === "publish",
    );
    await actorAdmin(String(row.actorId));
    await mongoose.connection.transaction(async (session) => {
      await fenceTask(task, session);
      await validVersion(
        v,
        row.kind === "publish",
        session,
        row.kind === "publish",
      );
      await actorAdmin(String(row.actorId), session);
      await Site.updateOne(
        { _id: row.siteId },
        { $inc: { lockVersion: 1 }, $set: { currentDeploymentId: row._id } },
        { session },
      );
      await model.updateOne(
        { _id: row._id },
        {
          $set: {
            status: "live",
            active: false,
            url: cfg.canonicalBaseUrl,
            origins: [
              ...new Set(
                [
                  cfg.canonicalBaseUrl,
                  "https://" + cfg.projectName + ".pages.dev",
                  row.providerUrl,
                ].filter(Boolean),
              ),
            ],
          },
          $unset: { errorCode: 1 },
        },
        { session },
      );
      await AuditLog.create(
        [
          {
            action: "site." + row.kind + ".live",
            actorId: row.actorId,
            targetId: String(row._id),
          },
        ],
        { session },
      );
    });
    await settle("publishes", row.operationId, 1);
    return { status: "done" };
  } catch (error) {
    // A stale worker cannot fail or unlock the current task.
    const live = await Task.exists({
      _id: task._id,
      status: "running",
      owner: task.owner,
      fencingToken: task.fencingToken,
      leaseUntil: { $gt: new Date() },
    });
    if (!live) throw error;
    const current = await model.findById(row._id),
      unknown =
        !isBuild &&
        !!current?.attemptedAt &&
        !(
          error instanceof AppError &&
          ["CLOUDFLARE_BUILD_FAILED", "DEPLOYMENT_REJECTED"].includes(
            error.code,
          )
        );
    const code =
      error instanceof AppError
        ? error.code
        : isBuild
          ? "BUILD_FAILED"
          : "DEPLOYMENT_FAILED";
    if (unknown && task.attempts < 8) {
      await mongoose.connection.transaction(async (session) => {
        await fenceTask(task, session);
        await model.updateOne(
          { _id: row._id },
          { $set: { status: "unknown", errorCode: code } },
          { session },
        );
      });
      return { status: "pending", error: code };
    }
    await mongoose.connection.transaction(async (session) => {
      await fenceTask(task, session);
      await model.updateOne(
        { _id: row._id },
        {
          $set: {
            status: unknown ? "unknown" : "failed",
            active: unknown,
            errorCode: code,
          },
        },
        { session },
      );
    });
    if (!unknown)
      await settle(
        isBuild ? "builds" : "publishes",
        row.operationId,
        isBuild ? 1 : 0,
      );
    return { status: "dead", error: code };
  }
}
export async function exportVersion(id: string) {
  const v = await ownVersion(id);
  ensure(v.status === "ready", 409, "VERSION_NOT_READY");
  await validVersion(v);
  const body = await readArtifact(v.artifactKey);
  ensure(
    createHash("sha256").update(body).digest("hex") === v.artifactHash,
    409,
    "ARTIFACT_INVALID",
  );
  return body;
}
export async function previewFile(id: string, raw: string) {
  const file = raw || "index.html";
  ensure(!/[\\\0]|\.\./.test(file) && file.length <= 240, 400, "INVALID_PATH");
  const files = unpack(await exportVersion(id)),
    key = files[file] ? file : file.replace(/\/$/, "") + "/index.html",
    data = files[key];
  ensure(data, 404, "NOT_FOUND");
  let body = Buffer.from(data);
  if (key.endsWith(".html")) {
    const version = await ownVersion(id);
    let html = body
      .toString("utf8")
      .replace(
        "<form data-gs-inquiry",
        '<form data-gs-inquiry data-preview-token="' +
          previewGrant(version) +
          '"',
      );
    html = html
      .replace(
        "<head>",
        '<head><meta name="robots" content="noindex,nofollow">',
      )
      .replace(
        /(href|src)="\/([^"]*)"/g,
        '$1="/api/v1/site-versions/' + id + '/preview/$2"',
      );
    body = Buffer.from(html);
  }
  return { body, mime: cf.mime(key) };
}
export async function domainCheck(id: string, actor: string) {
  await ownSite(id);
  const cfg = await PublishingSettings.findOne({ siteId: id }).select(
      "+secret",
    ),
    checkedAt = new Date();
  let status = "unconfigured";
  if (cfg?.domain && cfg.secret) {
    try {
      const token = decrypt(
        cfg.secret,
        "cloudflare:" + tenantContext()!.organizationId + ":" + id,
      );
      const domain = await cf.cfRequest(
        token,
        cf.projectPath(cfg) + "/domains/" + cfg.domain,
      );
      status = domain.status === "active" ? "pending" : "pending";
      if (domain.status === "active") {
        const r = await fetchWebsite("https://" + cfg.domain + "/", "html");
        status =
          r.status === 200 && new URL(r.url).protocol === "https:"
            ? "valid"
            : "failed";
      }
    } catch {
      status = "failed";
    }
  }
  if (cfg) {
    await PublishingSettings.updateOne(
      { _id: cfg._id, revision: cfg.revision },
      { $set: { httpsStatus: status, checkedAt } },
    );
    await AuditLog.create({
      action: "site.domain.checked",
      actorId: actor,
      targetId: id,
    });
  }
  return {
    status,
    domain: cfg?.domain ?? null,
    checkedAt: checkedAt.toISOString(),
  };
}

export async function reconcile(id: string, actor: string) {
  let row: any;
  await mongoose.connection.transaction(async (session) => {
    row = await SiteDeployment.findById(id).session(session);
    ensure(row, 404, "NOT_FOUND");
    await ownSite(String(row.siteId), session);
    await actorAdmin(actor, session);
    ensure(
      ["unknown", "verifying"].includes(row.status),
      409,
      "RECONCILE_NOT_REQUIRED",
    );
    const task = await Task.findOne({
      operationId: "site.deploy:" + id,
    }).session(session);
    ensure(task, 404, "NOT_FOUND");
    if (["dead", "pending"].includes(task.status))
      await Task.updateOne(
        { _id: task._id, status: task.status },
        {
          $set: { status: "pending", attempts: 0, nextAttemptAt: new Date() },
          $unset: { owner: 1, leaseUntil: 1 },
        },
        { session },
      );
    await SiteDeployment.updateOne(
      { _id: id },
      { $set: { actorId: actor } },
      { session },
    );
    await AuditLog.create(
      [{ action: "site.deployment.reconcile", actorId: actor, targetId: id }],
      { session },
    );
  });
  return deploymentDto(row);
}
