import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import {
  SiteInquiry,
  InquiryAttachment,
  InquiryDelivery,
  InquiryRateBucket,
  InquiryGatewayRoute,
  InquirySettings,
  Site,
  SiteDeployment,
  SiteVersion,
  Task,
  UsageBucket,
  UsageRecord,
  AuditLog,
} from "../models";
import {
  runWithTenant,
  runPublicLookup,
  tenantContext,
} from "../models/tenant-context";
import { config } from "../config";
import { ensure, AppError } from "../errors";
import { encrypt, decrypt, otpHash } from "./credential-crypto";
import { sha } from "./catalog.service";
import { detectMime, storeArtifact, readArtifact } from "./storage.service";
import {
  settingsRow,
  verifyPreviewGrant,
  turnstileClient,
  turnstileSecret,
} from "./inquiry-settings.service";
import { csv } from "./product-import.service";
const objectId = z.string().regex(/^[a-f0-9]{24}$/),
  nullableText = z.string().max(200).nullable();
export const publicInput = z
  .object({
    submissionId: z.uuid(),
    name: z.string().trim().min(1).max(100),
    company: z.string().trim().max(160),
    email: z
      .email()
      .max(200)
      .transform((v) => v.trim().toLowerCase()),
    country: z.string().trim().max(80),
    phone: z.string().trim().max(80),
    productIds: z.array(objectId).max(50),
    quantity: z.number().int().min(1).max(1000000000).nullable(),
    message: z.string().trim().min(1).max(8000),
    website: z.string().max(200),
    privacyConsent: z.literal(true),
    privacyVersion: z.string().max(80),
    pageUrl: z.url().max(2000),
    referrer: z.string().max(2000).nullable(),
    utm: z
      .object({
        source: nullableText,
        medium: nullableText,
        campaign: nullableText,
        term: nullableText,
        content: nullableText,
      })
      .strict(),
    firstVisitAt: z.iso.datetime(),
    turnstileToken: z.string().max(2048),
  })
  .strict();
export type Intake = z.infer<typeof publicInput>;
export type GatewayAccess = {
  site: any;
  version: any;
  settings: any;
  route: any;
  origin: string;
  preview: boolean;
};
export async function withGateway<T>(
  publicId: string,
  fn: (route: any) => Promise<T>,
): Promise<T> {
  ensure(/^[a-f0-9]{32}$/.test(publicId), 404, "NOT_FOUND");
  const route = await runPublicLookup(publicId, () =>
    InquiryGatewayRoute.findOne({ publicId, enabled: true }),
  );
  ensure(route, 404, "NOT_FOUND");
  return runWithTenant(String(route.organizationId), () => fn(route));
}
export async function gatewayAccess(
  route: any,
  rawOrigin: string,
  previewToken: string,
  preflight = false,
): Promise<GatewayAccess> {
  let origin: string;
  if (!rawOrigin && previewToken) rawOrigin = new URL(config.origin).origin;
  try {
    const u = new URL(rawOrigin);
    ensure(
      ["https:", "http:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        u.origin === rawOrigin,
      403,
      "ORIGIN_DENIED",
    );
    origin = u.origin;
  } catch {
    throw new AppError(403, "ORIGIN_DENIED");
  }
  const site = await Site.findOne({
    _id: route.siteId,
    status: { $ne: "archived" },
  });
  ensure(site, 404, "NOT_FOUND");
  const settings = await settingsRow(String(site._id));
  let version: any,
    preview = false;
  if (origin === new URL(config.origin).origin) {
    preview = true;
    if (preflight)
      return { site, version: null, settings, route, origin, preview };
    version = await verifyPreviewGrant(previewToken, String(site._id), origin);
  } else {
    const current = site.currentDeploymentId
      ? await SiteDeployment.findOne({
          _id: site.currentDeploymentId,
          siteId: site._id,
          status: "live",
        })
      : null;
    let deployment =
      current &&
      [current.url, ...(current.origins ?? []), current.providerUrl]
        .filter(Boolean)
        .includes(origin)
        ? current
        : null;
    if (!deployment)
      deployment = await SiteDeployment.findOne({
        siteId: site._id,
        status: "live",
        providerUrl: origin,
      });
    ensure(deployment, 403, "ORIGIN_DENIED");
    version = await SiteVersion.findOne({
      _id: deployment.versionId,
      siteId: site._id,
      status: "ready",
    });
    ensure(version, 403, "ORIGIN_DENIED");
  }
  ensure(
    version.snapshot?.inquiry?.publicId === route.publicId,
    403,
    "INQUIRIES_NOT_ENABLED",
  );
  return { site, version, settings, route, origin, preview };
}
export async function gatewayRate(siteId: string, ip: string, write: boolean) {
  const minute = Math.floor(Date.now() / 60000);
  const pairs = write
    ? [
        ["post-ip:" + otpHash(ip, "inquiry-ip"), 5],
        ["post-site", 60],
      ]
    : [["read-ip:" + otpHash(ip, "inquiry-ip"), 120]];
  for (const [key, max] of pairs) {
    const row = await InquiryRateBucket.findOneAndUpdate(
      { siteId, key, minute },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date((minute + 2) * 60000) },
      },
      { upsert: true, new: true },
    );
    ensure(row.count <= Number(max), 429, "INQUIRY_RATE_LIMIT");
  }
}
export function publicConfig(a: GatewayAccess) {
  return {
    enabled:
      !!a.settings?.enabled &&
      !!a.settings?.privacyReviewed &&
      !!a.version?.snapshot?.inquiry?.enabled,
    turnstileSiteKey: a.settings?.turnstileSiteKey ?? null,
    privacyVersion: a.version?.snapshot?.inquiry?.privacyVersion ?? "",
    maxFiles: 3,
    maxFileBytes: 2097152,
  };
}
const purpose = (id: string) =>
  "inquiry:" + tenantContext()!.organizationId + ":" + id;
export function decryptInquiry(row: any) {
  return JSON.parse(decrypt(row.secret, purpose(String(row._id))));
}
export function inquiryDto(row: any) {
  const d = decryptInquiry(row);
  return {
    id: String(row._id),
    siteId: String(row.siteId),
    receiptId: row.receiptId,
    revision: row.revision,
    contact: d.contact,
    status: row.status,
    spamScore: row.spamScore,
    classification: row.classification,
    duplicateOf: row.duplicateOf ? String(row.duplicateOf) : null,
    message: d.message,
    productIds: d.productIds,
    products: d.products ?? [],
    quantity: d.quantity,
    receivedAt: row.receivedAt.toISOString(),
    notificationStatus: row.notificationStatus,
  };
}
function safeReferrer(value: string | null) {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return null;
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}
export const attachmentsLimits = { count: 3, bytes: 2097152 };
async function canonicalFile(file: Express.Multer.File) {
  ensure(
    file.buffer.length > 0 && file.buffer.length <= attachmentsLimits.bytes,
    413,
    "INQUIRY_ATTACHMENT_LIMIT",
  );
  const mime = detectMime(file.buffer);
  ensure(
    mime &&
      ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        mime,
      ),
    400,
    "INQUIRY_ATTACHMENT_TYPE",
  );
  let body = file.buffer;
  if (mime.startsWith("image/")) {
    try {
      const image = sharp(body, {
          limitInputPixels: 12000000,
          failOn: "error",
        }),
        meta = await image.metadata();
      ensure((meta.pages ?? 1) === 1);
      body = await image
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toFormat(
          mime === "image/jpeg"
            ? "jpeg"
            : mime === "image/png"
              ? "png"
              : "webp",
        )
        .toBuffer();
    } catch {
      throw new AppError(400, "INQUIRY_ATTACHMENT_TYPE");
    }
  }
  ensure(
    body.length <= attachmentsLimits.bytes,
    413,
    "INQUIRY_ATTACHMENT_LIMIT",
  );
  const fileName =
    [...file.originalname]
      .map((c) =>
        c.charCodeAt(0) < 32 ||
        c.charCodeAt(0) === 127 ||
        c === "/" ||
        c === "\\"
          ? "_"
          : c,
      )
      .join("")
      .slice(0, 160) || "attachment";
  return { body, mime, fileName, hash: sha(body.toString("base64")) };
}
export async function archiveInquiry(
  a: GatewayAccess,
  raw: unknown,
  files: Express.Multer.File[],
  userAgent: string,
) {
  const data = publicInput.parse(raw);
  ensure(publicConfig(a).enabled, 403, "INQUIRIES_NOT_ENABLED");
  ensure(
    data.privacyVersion === a.version.snapshot.inquiry.privacyVersion,
    409,
    "PRIVACY_VERSION_CHANGED",
  );
  const ids = a.version.snapshot.pages
    .filter((p: any) => p.type === "product" && p.productId)
    .map((p: any) => String(p.productId));
  ensure(
    new Set(data.productIds).size === data.productIds.length &&
      data.productIds.every((id) => ids.includes(id)),
    400,
    "PRODUCT_NOT_AVAILABLE",
  );
  const url = new URL(data.pageUrl);
  ensure(
    url.origin === a.origin && !url.username && !url.password,
    400,
    "PAGE_INVALID",
  );
  const allowed = [
    ...a.version.snapshot.pages.map((p: any) => p.path),
    a.version.snapshot.inquiry.privacyPath,
  ].map((p) => p.replace(/\/$/, "") || "/");
  const previewPrefix = "/api/v1/site-versions/" + a.version._id + "/preview";
  const logicalPath =
    a.preview && url.pathname.startsWith(previewPrefix)
      ? url.pathname.slice(previewPrefix.length) || "/"
      : url.pathname;
  ensure(
    allowed.includes(logicalPath.replace(/\/$/, "") || "/"),
    400,
    "PAGE_INVALID",
  );
  ensure(files.length <= 3, 413, "INQUIRY_ATTACHMENT_LIMIT");
  const parts = await Promise.all(files.map(canonicalFile)),
    stable = {
      ...data,
      website: !!data.website,
      turnstileToken: undefined,
      pageUrl: url.origin + url.pathname,
      referrer: safeReferrer(data.referrer),
      files: parts.map((p) => ({
        fileName: p.fileName,
        mime: p.mime,
        hash: p.hash,
      })),
    };
  const requestHash = otpHash(
    JSON.stringify(stable),
    "inquiry-payload:" + tenantContext()!.organizationId,
  );
  const existing = await SiteInquiry.findOne({
    siteId: a.site._id,
    submissionId: data.submissionId,
  });
  if (existing) {
    ensure(existing.requestHash === requestHash, 409, "IDEMPOTENCY_CONFLICT");
    return { received: true, receiptId: existing.receiptId };
  }
  const key = turnstileSecret(a.settings, String(a.site._id));
  if (key)
    await turnstileClient.verify(
      key,
      data.turnstileToken,
      new URL(a.origin).hostname,
      a.route.publicId,
      data.submissionId,
    );
  const inquiryId = new mongoose.Types.ObjectId(),
    attachmentRows: any[] = [],
    receivedAt = new Date(),
    first = new Date(data.firstVisitAt);
  const firstVisitAt =
    first.getTime() <= receivedAt.getTime() + 300000 &&
    first.getTime() > receivedAt.getTime() - 366 * 86400000
      ? first.toISOString()
      : receivedAt.toISOString();
  const source = {
    pageUrl: url.origin + url.pathname,
    referrer: safeReferrer(data.referrer),
    utm: data.utm,
    country: data.country || null,
    device: /ipad|tablet/i.test(userAgent)
      ? "tablet"
      : /mobi|android|iphone/i.test(userAgent)
        ? "mobile"
        : userAgent
          ? "desktop"
          : "unknown",
    firstVisitAt,
    receivedAt: receivedAt.toISOString(),
    origin: a.origin,
    preview: a.preview,
  };
  let created = false,
    result: any;
  try {
    for (const part of parts) {
      const id = new mongoose.Types.ObjectId(),
        key = randomUUID(),
        encrypted = Buffer.from(
          JSON.stringify(
            encrypt(
              part.body.toString("base64"),
              "inquiry-attachment:" +
                tenantContext()!.organizationId +
                ":" +
                id,
            ),
          ),
        );
      await storeArtifact(encrypted, key);
      attachmentRows.push({
        _id: id,
        inquiryId,
        key,
        mime: part.mime,
        bytes: part.body.length,
        storedBytes: encrypted.length,
        fileName: part.fileName,
      });
    }
    await mongoose.connection.transaction(async (session) => {
      created = false;
      const prior = await SiteInquiry.findOne({
        siteId: a.site._id,
        submissionId: data.submissionId,
      }).session(session);
      if (prior) {
        ensure(prior.requestHash === requestHash, 409, "IDEMPOTENCY_CONFLICT");
        result = prior;
        return;
      }
      // Explicitly recheck the server-side switch after uploads.
      const cfg = await InquirySettings.findOne({
        siteId: a.site._id,
        enabled: true,
        privacyReviewed: true,
      }).session(session);
      ensure(cfg, 403, "INQUIRIES_NOT_ENABLED");
      const contact = {
        name: data.name,
        company: data.company,
        email: data.email,
        country: data.country,
        phone: data.phone,
      };
      const payload = {
        contact,
        message: data.message,
        productIds: data.productIds,
        products: data.productIds.map((id) => ({
          id,
          name:
            a.version.snapshot.pages.find((p: any) => p.productId === id)
              ?.title ?? "",
        })),
        quantity: data.quantity,
        source,
        privacy: { version: data.privacyVersion, at: receivedAt.toISOString() },
        attachments: attachmentRows.map((p) => ({
          id: String(p._id),
          fileName: p.fileName,
        })),
      };
      [result] = await SiteInquiry.create(
        [
          {
            _id: inquiryId,
            siteId: a.site._id,
            versionId: a.version._id,
            submissionId: data.submissionId,
            receiptId: randomUUID(),
            requestHash,
            emailHash: otpHash(
              String(a.site._id) + ":" + data.email,
              "inquiry-dedupe",
            ),
            receivedAt,
            secret: encrypt(
              JSON.stringify(payload),
              purpose(String(inquiryId)),
            ),
            attachmentIds: attachmentRows.map((p) => p._id),
            spamScore: data.website ? 100 : 0,
            reasons: data.website ? ["HONEYPOT"] : [],
          },
        ],
        { session },
      );
      for (const { fileName: _fileName, ...part } of attachmentRows)
        await InquiryAttachment.create([part], { session });
      await Task.create(
        [
          {
            kind: "inquiry.process",
            operationId: "inquiry.process:" + inquiryId,
            payload: { runId: String(inquiryId) },
            status: "pending",
            nextAttemptAt: new Date(),
          },
        ],
        { session },
      );
      await countInquiry(String(inquiryId), session);
      created = true;
    });
    return { received: true, receiptId: result.receiptId };
  } catch (error) {
    if ((error as any)?.code === 11000) {
      const prior = await SiteInquiry.findOne({
        siteId: a.site._id,
        submissionId: data.submissionId,
      });
      if (prior) {
        created = String(prior._id) === String(inquiryId);
        ensure(prior.requestHash === requestHash, 409, "IDEMPOTENCY_CONFLICT");
        return { received: true, receiptId: prior.receiptId };
      }
    }
    throw error;
  } finally {
    if (!created)
      for (const part of attachmentRows)
        await removePrivateFile(part.key, part.storedBytes);
  }
}
async function countInquiry(id: string, session: mongoose.ClientSession) {
  const operationId = "inquiry:" + id,
    metric = "inquiries",
    period = new Date().toISOString().slice(0, 7);
  if (await UsageRecord.exists({ metric, operationId }).session(session))
    return;
  await UsageBucket.updateOne(
    { metric, period },
    { $inc: { consumed: 1 }, $setOnInsert: { reserved: 0 } },
    { upsert: true, session },
  );
  await UsageRecord.create(
    [{ metric, period, operationId, amount: 1, actual: 1, state: "settled" }],
    { session },
  );
}
export async function removePrivateFile(key: string, bytes: number) {
  // Internal cleanup only: object path is still validated by the tenant storage layer.
  const fs = await import("node:fs/promises"),
    path = await import("node:path");
  const org = tenantContext()!.organizationId;
  ensure(org);
  ensure(/^[a-f0-9-]{36}$/.test(key));
  const root = path.resolve(config.storage, org),
    target = path.resolve(root, key);
  ensure(path.dirname(target) === root);
  await fs.rm(target, { force: true });
  await mongoose.connection.transaction(async (session) => {
    const rec = await UsageRecord.findOne({
      metric: "storage_bytes",
      operationId: "artifact:" + key,
      state: "settled",
      actual: bytes,
    }).session(session);
    if (!rec) return;
    await UsageBucket.updateOne(
      {
        metric: "storage_bytes",
        period: "lifetime",
        consumed: { $gte: bytes },
      },
      { $inc: { consumed: -bytes } },
      { session },
    );
    await UsageRecord.updateOne(
      { _id: rec._id },
      { $set: { state: "released", actual: 0 } },
      { session },
    );
  });
}
export async function ownInquiry(id: string) {
  const row = await SiteInquiry.findById(id).select("+secret +notesSecret");
  ensure(row, 404, "NOT_FOUND");
  return row;
}
export async function inquiryDetail(id: string) {
  const row = await ownInquiry(id),
    data = decryptInquiry(row),
    attachments = await InquiryAttachment.find({ inquiryId: id }),
    duplicates = await SiteInquiry.find({ duplicateOf: id })
      .select("+secret")
      .sort({ _id: -1 })
      .limit(20),
    deliveries = await InquiryDelivery.find({ inquiryId: id });
  return {
    ...inquiryDto(row),
    source: data.source,
    notes: row.notesSecret
      ? JSON.parse(
          decrypt(
            row.notesSecret,
            "inquiry-notes:" + tenantContext()!.organizationId + ":" + id,
          ),
        )
      : [],
    attachments: attachments.map((a) => ({
      id: String(a._id),
      fileName:
        data.attachments.find((p: any) => p.id === String(a._id))?.fileName ??
        "attachment",
      mime: a.mime,
      bytes: a.bytes,
      url: "/api/v1/inquiries/" + id + "/attachments/" + a._id,
    })),
    duplicates: duplicates.map(inquiryDto),
    deliveries: deliveries.map((d) => ({
      id: String(d._id),
      userId: String(d.userId),
      status: d.status,
      errorCode: d.errorCode ?? null,
      attempts: d.attempts,
    })),
  };
}
export const inquiryQuery = z
  .object({
    siteId: objectId.optional(),
    status: z.enum(["new", "following", "resolved", "spam"]).optional(),
    minSpamScore: z.coerce.number().int().min(0).max(100).optional(),
    maxSpamScore: z.coerce.number().int().min(0).max(100).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    includeDuplicates: z.enum(["true", "false"]).default("false"),
    cursor: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
function queryFilter(q: z.infer<typeof inquiryQuery>) {
  const f: any = {};
  if (q.siteId) f.siteId = q.siteId;
  if (q.status) f.status = q.status;
  if (q.includeDuplicates !== "true") f.duplicateOf = { $exists: false };
  if (q.cursor) f._id = { $lt: q.cursor };
  if (q.from || q.to) {
    f.receivedAt = {
      ...(q.from ? { $gte: new Date(q.from) } : {}),
      ...(q.to ? { $lte: new Date(q.to) } : {}),
    };
  }
  ensure(!q.from || !q.to || q.from <= q.to, 400, "INVALID_DATE_RANGE");
  if (q.minSpamScore !== undefined || q.maxSpamScore !== undefined)
    f.spamScore = {
      ...(q.minSpamScore !== undefined ? { $gte: q.minSpamScore } : {}),
      ...(q.maxSpamScore !== undefined ? { $lte: q.maxSpamScore } : {}),
    };
  return f;
}
export async function listInquiries(query: unknown) {
  const q = inquiryQuery.parse(query),
    rows = await SiteInquiry.find(queryFilter(q))
      .select("+secret")
      .sort({ _id: -1 })
      .limit(q.limit + 1);
  return {
    items: rows.slice(0, q.limit).map(inquiryDto),
    hasMore: rows.length > q.limit,
    nextCursor: rows.length > q.limit ? String(rows[q.limit - 1]._id) : null,
  };
}
export async function exportInquiries(query: unknown) {
  const q = inquiryQuery.parse(query),
    rows = await SiteInquiry.find(queryFilter(q))
      .select("+secret")
      .sort({ _id: -1 })
      .limit(5001);
  ensure(rows.length <= 5000, 409, "EXPORT_TOO_LARGE");
  return csv([
    [
      "Received at",
      "Site ID",
      "Name",
      "Company",
      "Email",
      "Country",
      "Phone / WhatsApp",
      "Product IDs",
      "Quantity",
      "Message",
      "Status",
      "Spam score",
      "Duplicate of",
      "Page URL",
      "Referrer",
      "UTM source",
      "UTM medium",
      "UTM campaign",
    ],
    ...rows.map((row) => {
      const r = inquiryDto(row),
        s = decryptInquiry(row).source;
      return [
        r.receivedAt,
        r.siteId,
        r.contact.name,
        r.contact.company,
        r.contact.email,
        r.contact.country,
        r.contact.phone,
        r.productIds.join(";"),
        r.quantity ?? "",
        r.message,
        r.status,
        r.spamScore,
        r.duplicateOf ?? "",
        s.pageUrl,
        s.referrer ?? "",
        s.utm.source ?? "",
        s.utm.medium ?? "",
        s.utm.campaign ?? "",
      ];
    }),
  ]);
}
export async function updateInquiry(
  id: string,
  input: unknown,
  actor: string,
  note = false,
) {
  const value = note
    ? z
        .object({
          revision: z.number().int().min(1),
          text: z.string().trim().min(1).max(4000),
        })
        .strict()
        .parse(input)
    : z
        .object({
          revision: z.number().int().min(1),
          status: z.enum(["new", "following", "resolved", "spam"]),
        })
        .strict()
        .parse(input);
  await mongoose.connection.transaction(async (session) => {
    const row = await SiteInquiry.findOne({ _id: id, revision: value.revision })
      .select("+notesSecret")
      .session(session);
    ensure(row, 409, "REVISION_CONFLICT");
    let changes: any;
    if ("text" in value) {
      const notes = row.notesSecret
        ? JSON.parse(
            decrypt(
              row.notesSecret,
              "inquiry-notes:" + tenantContext()!.organizationId + ":" + id,
            ),
          )
        : [];
      ensure(notes.length < 200, 409, "NOTE_LIMIT");
      notes.push({
        id: randomUUID(),
        text: value.text,
        actorId: actor,
        createdAt: new Date().toISOString(),
      });
      changes = {
        notesSecret: encrypt(
          JSON.stringify(notes),
          "inquiry-notes:" + tenantContext()!.organizationId + ":" + id,
        ),
      };
    } else changes = { status: value.status };
    await SiteInquiry.updateOne(
      { _id: id, revision: value.revision },
      { $set: changes, $inc: { revision: 1 } },
      { session },
    );
    await AuditLog.create(
      [
        {
          action: note ? "inquiry.note.added" : "inquiry.status.updated",
          actorId: actor,
          targetId: id,
        },
      ],
      { session },
    );
  });
  return inquiryDetail(id);
}
export async function downloadAttachment(id: string, attachmentId: string) {
  const row = await ownInquiry(id),
    a = await InquiryAttachment.findOne({ _id: attachmentId, inquiryId: id });
  ensure(a, 404, "NOT_FOUND");
  const encrypted = JSON.parse((await readArtifact(a.key)).toString("utf8")),
    body = Buffer.from(
      decrypt(
        encrypted,
        "inquiry-attachment:" + tenantContext()!.organizationId + ":" + a._id,
      ),
      "base64",
    );
  ensure(body.length === a.bytes, 409, "ATTACHMENT_INVALID");
  return {
    body,
    mime: a.mime,
    fileName:
      decryptInquiry(row).attachments.find((p: any) => p.id === attachmentId)
        ?.fileName ?? "attachment",
  };
}
