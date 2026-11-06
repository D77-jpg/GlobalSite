import mongoose from "mongoose";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  OutboundDelivery,
  CrmConnection,
  CrmOutcome,
  SiteInquiry,
  SiteVersion,
  Product,
  Task,
  AuditLog,
  RateLimit,
} from "../models";
import {
  tenantContext,
  runWithTenant,
  runIdentity,
} from "../models/tenant-context";
import { encrypt, decrypt, otpHash } from "./credential-crypto";
import { config } from "../config";
import { ensure } from "../errors";
import {
  ConnectionLease,
  assertCrmLease,
  callCrm,
  deliveryDto,
} from "./crm-connection.service";
import { checked, inquiryResultShape, CrmError } from "./crm-client.service";
import {
  ownInquiry,
  decryptInquiry,
  downloadAttachment,
} from "./inquiry.service";
const purpose = (id: string) =>
  "crm-delivery:" + tenantContext()!.organizationId + ":" + id;
function publicGrant(connection: any, inquiryId: string, attachmentId: string) {
  const body = Buffer.from(
    JSON.stringify({
      organizationId: tenantContext()!.organizationId,
      connectionId: String(connection._id),
      generation: connection.generation,
      inquiryId,
      attachmentId,
      expires: Date.now() + 86400000,
    }),
  ).toString("base64url");
  return body + "." + otpHash(body, "crm-attachment");
}
export async function enqueueCrmInquiry(
  inquiryId: string,
  session: mongoose.ClientSession,
) {
  const row = await SiteInquiry.findById(inquiryId).session(session);
  ensure(row, 404, "NOT_FOUND");
  const c = await CrmConnection.findOne({
    active: true,
    status: { $nin: ["disconnecting", "disconnected"] },
  }).session(session);
  if (!c) return null;
  if (row.crm?.connectionId && row.crm.connectionId !== String(c._id))
    return null;
  let d = await OutboundDelivery.findOne({
    inquiryId,
    connectionId: c._id,
  }).session(session);
  if (d) return d;
  const version = await SiteVersion.findById(row.versionId)
    .select("snapshot.inquiry")
    .session(session);
  if (version?.snapshot?.inquiry?.crmDisclosureVersion !== "s7-v1") {
    await SiteInquiry.updateOne(
      { _id: row._id },
      {
        $set: {
          crm: {
            connectionId: String(c._id),
            status: "blocked",
            lastErrorCode: "CRM_PRIVACY_REBUILD_REQUIRED",
            customerId: null,
            inquiryId: null,
            customerUrl: null,
            outcome: null,
          },
        },
      },
      { session },
    );
    return null;
  }
  const ready =
    ["connected", "degraded"].includes(c.status) &&
    c.scopes.includes("inquiries:write");
  [d] = await OutboundDelivery.create(
    [
      {
        inquiryId,
        connectionId: c._id,
        idempotencyKey: "gs:" + c._id + ":" + inquiryId,
        status: ready ? "pending" : "paused",
        lastErrorCode: ready ? null : "CRM_SCOPE_MISSING",
      },
    ],
    { session },
  );
  await Task.create(
    [
      {
        kind: "crm.deliver",
        operationId: "crm.deliver:" + d._id,
        payload: { runId: String(d._id) } as any,
        status: ready ? "pending" : "dead",
        nextAttemptAt: new Date(),
      },
    ],
    { session },
  );
  await SiteInquiry.updateOne(
    { _id: row._id },
    {
      $set: {
        crm: {
          connectionId: String(c._id),
          status: d.status,
          lastErrorCode: d.lastErrorCode ?? null,
          customerId: null,
          inquiryId: null,
          customerUrl: null,
          outcome: null,
        },
      },
    },
    { session },
  );
  return d;
}
async function frozenPayload(l: ConnectionLease, d: any) {
  if (d.secret) return JSON.parse(decrypt(d.secret, purpose(String(d._id))));
  const row = await ownInquiry(String(d.inquiryId)),
    data = decryptInquiry(row),
    version = await SiteVersion.findById(row.versionId).select(
      "snapshot.site.name snapshot.inquiry",
    );
  if (version?.snapshot?.inquiry?.crmDisclosureVersion !== "s7-v1")
    throw new CrmError("CRM_PRIVACY_REBUILD_REQUIRED", 409);
  const products = [];
  for (const item of data.products ?? []) {
    const p = await Product.findById(item.id);
    products.push({
      globalSiteProductId: item.id,
      crmProductId:
        p?.source === "globalcrm" &&
        p.externalRef?.connectionId === String(l.connection._id)
          ? p.externalRef.remoteId
          : null,
      name: item.name,
    });
  }
  const attachments = [];
  for (const id of row.attachmentIds ?? []) {
    const a = await downloadAttachment(String(row._id), String(id));
    attachments.push({
      id: String(id),
      fileName: a.fileName,
      mime: a.mime,
      bytes: a.body.length,
      sha256: createHash("sha256").update(a.body).digest("hex"),
    });
  }
  const payload = {
    schemaVersion: "1.0",
    sourceSystem: "globalsite",
    externalInquiryId: String(row._id),
    site: { id: String(row.siteId), name: version.snapshot.site.name },
    submittedAt: row.receivedAt.toISOString(),
    contact: data.contact,
    products,
    quantity: data.quantity,
    message: data.message,
    attachments,
    source: {
      pageUrl: data.source.pageUrl,
      referrer: data.source.referrer,
      utm: data.source.utm,
      device: data.source.device,
      firstVisitAt: data.source.firstVisitAt,
    },
    spamScore: row.spamScore,
  };
  await mongoose.connection.transaction(async (session) => {
    await assertCrmLease(l, session);
    const live = await OutboundDelivery.findById(d._id)
      .select("+secret")
      .session(session);
    ensure(live, 404, "NOT_FOUND");
    if (!live.secret)
      await OutboundDelivery.updateOne(
        { _id: d._id },
        {
          $set: {
            secret: encrypt(JSON.stringify(payload), purpose(String(d._id))),
            payloadHash: createHash("sha256")
              .update(JSON.stringify(payload))
              .digest("hex"),
          },
        },
        { session },
      );
  });
  const live = await OutboundDelivery.findById(d._id).select("+secret");
  return JSON.parse(decrypt(live.secret, purpose(String(d._id))));
}
export async function deliverCrmInquiry(l: ConnectionLease, d: any) {
  const payload = await frozenPayload(l, d);
  const body = {
    ...payload,
    attachments: payload.attachments.map((a: any) => ({
      ...a,
      downloadUrl: new URL(
        "/api/crm-attachments/" +
          publicGrant(l.connection, String(d.inquiryId), a.id),
        config.origin,
      ).href,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })),
  };
  await mongoose.connection.transaction(async (session) => {
    await assertCrmLease(l, session);
    await OutboundDelivery.updateOne(
      { _id: d._id, status: { $ne: "sent" } },
      { $set: { status: "sending", lastErrorCode: null } },
      { session },
    );
  });
  const response = checked(
    inquiryResultShape,
    await callCrm(l, "/api/integrations/v1/inquiries", {
      method: "POST",
      key: d.idempotencyKey,
      body,
    }),
  );
  if (response.data.projectId !== l.connection.projectId)
    throw new CrmError("CRM_PROJECT_MISMATCH", 409);
  await mongoose.connection.transaction(async (session) => {
    await assertCrmLease(l, session);
    const r = response.data,
      url = new URL(r.customerUrl, l.connection.baseUrl).href;
    await OutboundDelivery.updateOne(
      { _id: d._id },
      {
        $set: {
          status: "sent",
          remoteId: r.inquiryId,
          customerId: r.customerId,
          customerUrl: url,
          lastErrorCode: null,
        },
      },
      { session },
    );
    const event = await CrmOutcome.findOne({
      connectionId: l.connection._id,
      customerId: r.customerId,
    })
      .sort({ occurredAt: -1 })
      .session(session);
    const outcome = event
      ? {
          eventId: event.eventId,
          toStatus: event.toStatus,
          occurredAt: event.occurredAt.toISOString(),
        }
      : null;
    await SiteInquiry.updateOne(
      { _id: d.inquiryId },
      {
        $set: {
          crm: {
            connectionId: String(l.connection._id),
            status: "sent",
            lastErrorCode: null,
            customerId: r.customerId,
            inquiryId: r.inquiryId,
            customerUrl: url,
            outcome,
          },
        },
      },
      { session },
    );
  });
}
export async function retryCrmDelivery(id: string, actor: string) {
  const d = await OutboundDelivery.findById(id);
  ensure(d, 404, "NOT_FOUND");
  const c = await CrmConnection.findOne({
    _id: d.connectionId,
    active: true,
    status: { $in: ["connected", "degraded"] },
  });
  ensure(c, 409, "CRM_DESTINATION_CHANGED");
  ensure(c.scopes.includes("inquiries:write"), 409, "CRM_SCOPE_MISSING");
  ensure(
    ["failed", "retry", "paused", "pending"].includes(d.status),
    409,
    "CRM_RETRY_UNAVAILABLE",
  );
  await mongoose.connection.transaction(async (session) => {
    const task = await Task.findOne({
      operationId: "crm.deliver:" + d._id,
    }).session(session);
    ensure(task && task.status !== "running", 409, "CRM_BUSY");
    await OutboundDelivery.updateOne(
      { _id: d._id },
      {
        $set: {
          status: "pending",
          lastErrorCode: null,
          nextAttemptAt: new Date(),
          attempts: 0,
        },
      },
      { session },
    );
    await Task.updateOne(
      { _id: task._id, status: { $ne: "running" } },
      {
        $set: { status: "pending", nextAttemptAt: new Date(), attempts: 0 },
        $unset: { owner: 1, leaseUntil: 1 },
      },
      { session },
    );
    await SiteInquiry.updateOne(
      { _id: d.inquiryId },
      { $set: { "crm.status": "pending", "crm.lastErrorCode": null } },
      { session },
    );
    await AuditLog.create(
      [{ action: "crm.delivery.retried", actorId: actor, targetId: id }],
      { session },
    );
  });
  return deliveryDto(await OutboundDelivery.findById(id));
}
export async function pushInquiryToCrm(id: string, actor: string) {
  const row = await ownInquiry(id),
    existing = await OutboundDelivery.findOne({ inquiryId: id });
  if (existing) return retryCrmDelivery(String(existing._id), actor);
  ensure(
    row.crm?.lastErrorCode !== "CRM_PRIVACY_REBUILD_REQUIRED",
    409,
    "CRM_PRIVACY_REBUILD_REQUIRED",
  );
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    result = await enqueueCrmInquiry(id, session);
    ensure(result, 409, "CRM_NOT_CONNECTED");
    await AuditLog.create(
      [{ action: "crm.delivery.queued", actorId: actor, targetId: id }],
      { session },
    );
  });
  return deliveryDto(result);
}
export async function readCrmAttachmentGrant(grant: string, ip: string) {
  const [body, sig, extra] = grant.split(".");
  ensure(
    !extra && body && body.length <= 2048 && /^[a-f0-9]{64}$/.test(sig ?? ""),
    403,
    "INVALID_GRANT",
  );
  const expected = otpHash(body, "crm-attachment");
  ensure(
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected)),
    403,
    "INVALID_GRANT",
  );
  let data: any;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    ensure(false, 403, "INVALID_GRANT");
  }
  ensure(
    ["organizationId", "connectionId", "inquiryId", "attachmentId"].every((k) =>
      /^[a-f0-9]{24}$/.test(data[k] ?? ""),
    ) &&
      Number.isFinite(data.expires) &&
      data.expires > Date.now() &&
      data.expires <= Date.now() + 86400000,
    403,
    "INVALID_GRANT",
  );
  const minute = Math.floor(Date.now() / 60000);
  const rate = await runIdentity(() =>
    RateLimit.findOneAndUpdate(
      { key: "crm-attachment:" + otpHash(ip, "crm-ip") + ":" + minute },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date(Date.now() + 120000) },
      },
      { upsert: true, new: true },
    ),
  );
  ensure(rate.count <= 180, 429, "RATE_LIMIT");
  return runWithTenant(data.organizationId, async () => {
    const c = await CrmConnection.findOne({
      _id: data.connectionId,
      generation: data.generation,
      active: true,
      status: { $in: ["connected", "degraded"] },
    });
    ensure(c, 403, "INVALID_GRANT");
    const row = await SiteInquiry.findOne({
      _id: data.inquiryId,
      "crm.connectionId": data.connectionId,
    });
    ensure(row, 404, "NOT_FOUND");
    return downloadAttachment(data.inquiryId, data.attachmentId);
  });
}
