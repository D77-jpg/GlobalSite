import { randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import {
  InquirySettings,
  InquiryGatewayRoute,
  Membership,
  FactSheet,
  AuditLog,
  SiteVersion,
} from "../models";
import { tenantContext } from "../models/tenant-context";
import { ownSite } from "./sites.service";
import { encrypt, decrypt, otpHash } from "./credential-crypto";
import { sha } from "./catalog.service";
import { config } from "../config";
import { ensure, AppError } from "../errors";
import { publicUrl } from "./website/public-web";
export const POLICY_VERSION = "s6-v1";
const id = z.string().regex(/^[a-f0-9]{24}$/);
export const inquirySettingsInput = z
  .object({
    revision: z.number().int().min(0),
    enabled: z.boolean(),
    privacyReviewed: z.boolean(),
    aiSpamEnabled: z.boolean(),
    notificationUserIds: z.array(id).max(20),
    turnstileSiteKey: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{10,100}$/)
      .nullable(),
    turnstileSecret: z.string().min(20).max(1024).nullable().optional(),
  })
  .strict();
export async function gatewayRoute(
  siteId: string,
  session?: mongoose.ClientSession,
) {
  let row = await InquiryGatewayRoute.findOne({ siteId }).session(
    session ?? null,
  );
  if (!row) {
    [row] = await InquiryGatewayRoute.create(
      [{ siteId, publicId: randomBytes(16).toString("hex"), enabled: true }],
      session ? { session } : {},
    );
  }
  return row;
}
export async function settingsRow(
  siteId: string,
  session?: mongoose.ClientSession,
) {
  return InquirySettings.findOne({ siteId })
    .select("+secret")
    .session(session ?? null);
}
function dto(row: any, route: any) {
  return {
    revision: row?.revision ?? 0,
    publicId: route?.publicId ?? "",
    enabled: row?.enabled ?? false,
    privacyReviewed: row?.privacyReviewed ?? false,
    aiSpamEnabled: row?.aiSpamEnabled ?? false,
    notificationUserIds: (row?.notificationUserIds ?? []).map(String),
    turnstileSiteKey: row?.turnstileSiteKey ?? null,
    turnstileConfigured: !!row?.secret,
    gatewayUrl: new URL("/api/inquiry-gateway/v1", config.origin).href,
  };
}
export async function inquirySettings(siteId: string) {
  await ownSite(siteId);
  return dto(
    await settingsRow(siteId),
    await InquiryGatewayRoute.findOne({ siteId }),
  );
}
export async function saveInquirySettings(
  siteId: string,
  input: unknown,
  actor: string,
) {
  const data = inquirySettingsInput.parse(input);
  ensure(
    new Set(data.notificationUserIds).size === data.notificationUserIds.length,
  );
  ensure(!data.enabled || data.privacyReviewed, 400, "PRIVACY_REVIEW_REQUIRED");
  await mongoose.connection.transaction(async (session) => {
    await ownSite(siteId, session);
    const old = await settingsRow(siteId, session);
    ensure((old?.revision ?? 0) === data.revision, 409, "REVISION_CONFLICT");
    ensure(
      (await Membership.countDocuments({
        userId: { $in: data.notificationUserIds },
        status: "active",
      }).session(session)) === data.notificationUserIds.length,
      404,
      "NOT_FOUND",
    );
    await gatewayRoute(siteId, session);
    const { turnstileSecret, revision, ...values } = data,
      secret =
        typeof turnstileSecret === "string"
          ? encrypt(
              turnstileSecret,
              "inquiry-turnstile:" +
                tenantContext()!.organizationId +
                ":" +
                siteId,
            )
          : turnstileSecret === null
            ? null
            : old?.secret;
    ensure(
      !!secret === !!values.turnstileSiteKey,
      400,
      "TURNSTILE_CONFIG_INVALID",
    );
    await InquirySettings.updateOne(
      { siteId },
      { $set: { ...values, revision: revision + 1, secret } },
      { upsert: true, session },
    );
    await AuditLog.create(
      [
        {
          action: "inquiry.settings.updated",
          actorId: actor,
          targetId: siteId,
        },
      ],
      { session },
    );
  });
  return inquirySettings(siteId);
}
export async function inquiryBuildConfig(
  site: any,
  session: mongoose.ClientSession,
) {
  const route = await gatewayRoute(String(site._id), session),
    settings = await settingsRow(String(site._id), session);
  const rows = settings?.privacyReviewed
    ? await FactSheet.find({
        subjectType: "organization",
        status: "confirmed",
        type: {
          $in: [
            "company.name",
            "company.address",
            "company.email",
            "company.privacyEmail",
          ],
        },
      })
        .sort({ _id: -1 })
        .limit(100)
        .session(session)
    : [];
  const selected = new Map<string, any>();
  for (const f of rows) if (!selected.has(f.type)) selected.set(f.type, f);
  const facts = [...selected.values()].map((f) => ({
    id: String(f._id),
    revision: f.revision,
    type: f.type,
    value: f.value,
    subjectType: f.subjectType,
    subjectId: null,
  }));
  for (const f of facts)
    await FactSheet.updateOne(
      { _id: f.id, status: "confirmed", revision: f.revision },
      { $inc: { referenceVersion: 1 } },
      { session },
    );
  let privacyPath = "/privacy-policy";
  if (site.plan?.nodes?.some((p: any) => p.path === privacyPath))
    privacyPath = "/legal/privacy-policy";
  while (site.plan?.nodes?.some((p: any) => p.path === privacyPath))
    privacyPath += "-policy";
  const enabled = !!settings?.enabled && !!settings?.privacyReviewed;
  return {
    inquiry: {
      publicId: route.publicId,
      gatewayUrl: new URL("/api/inquiry-gateway/v1", config.origin).href,
      enabled,
      privacyPath,
      privacyVersion:
        POLICY_VERSION + "-" + sha(JSON.stringify(facts)).slice(0, 12),
      policyFacts: facts,
      aiSpamEnabled: !!settings?.aiSpamEnabled,
    },
    facts,
  };
}
function sign(body: string) {
  return otpHash(body, "inquiry-preview:" + tenantContext()!.organizationId);
}
export function previewGrant(version: any) {
  const body = Buffer.from(
    JSON.stringify({
      versionId: String(version._id),
      siteId: String(version.siteId),
      origin: new URL(config.origin).origin,
      expiresAt: Date.now() + 2 * 3600000,
    }),
  ).toString("base64url");
  return body + "." + sign(body);
}
export async function verifyPreviewGrant(
  token: string,
  siteId: string,
  origin: string,
) {
  const [body, sig, extra] = token.split(".");
  ensure(
    !extra && body && body.length < 2048 && sig?.length === 64,
    403,
    "ORIGIN_DENIED",
  );
  const expected = sign(body);
  ensure(
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected)),
    403,
    "ORIGIN_DENIED",
  );
  let data: any;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    ensure(false, 403, "ORIGIN_DENIED");
  }
  ensure(
    data.siteId === siteId &&
      data.origin === origin &&
      Number.isFinite(data.expiresAt) &&
      data.expiresAt > Date.now() &&
      data.expiresAt <= Date.now() + 2 * 3600000,
    403,
    "ORIGIN_DENIED",
  );
  const version = await SiteVersion.findOne({
    _id: data.versionId,
    siteId,
    status: "ready",
  });
  ensure(version, 403, "ORIGIN_DENIED");
  return version;
}
export const turnstileClient = {
  verify: async (
    secret: string,
    token: string,
    hostname: string,
    publicId: string,
    submissionId: string,
  ) => {
    ensure(token, 400, "TURNSTILE_REQUIRED");
    let response: Response;
    try {
      response = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret,
            response: token,
            idempotency_key: submissionId,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch {
      ensure(false, 503, "TURNSTILE_UNAVAILABLE");
    }
    ensure(response!.ok, 503, "TURNSTILE_UNAVAILABLE");
    const raw = await response!.text();
    ensure(raw.length <= 32768, 503, "TURNSTILE_UNAVAILABLE");
    let result: any;
    try {
      result = JSON.parse(raw);
    } catch {
      ensure(false, 503, "TURNSTILE_UNAVAILABLE");
    }
    ensure(
      result.success === true &&
        result.hostname === hostname &&
        result.action === "inquiry" &&
        result.cdata === publicId,
      400,
      "TURNSTILE_INVALID",
    );
  },
};
export function turnstileSecret(row: any, siteId: string) {
  return row?.secret
    ? decrypt(
        row.secret,
        "inquiry-turnstile:" + tenantContext()!.organizationId + ":" + siteId,
      )
    : null;
}

export async function validateInquiryGateway(version: any) {
  if (!version.snapshot?.inquiry?.enabled) return;
  try {
    const u = await publicUrl(version.snapshot.inquiry.gatewayUrl);
    ensure(
      u.origin === new URL(config.origin).origin,
      409,
      "INQUIRY_GATEWAY_UNSAFE",
    );
  } catch {
    throw new AppError(409, "INQUIRY_GATEWAY_UNSAFE");
  }
}
