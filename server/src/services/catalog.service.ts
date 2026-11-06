import { assertFactsEditable } from "./publication-lock.service";
import mongoose from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import {
  CrmImportedResource,
  Product,
  FactSheet,
  FactRevision,
  Asset,
  AuditLog,
  WebsiteRead,
} from "../models";
import { ensure } from "../errors";
import { productInput, factInput } from "../validators/catalog.validator";
const auditTx = (
  action: string,
  actorId: string,
  targetId: string,
  session: mongoose.ClientSession,
) => AuditLog.create([{ action, actorId, targetId }], { session });
export function productDto(p: any) {
  return {
    id: String(p._id),
    sku: p.sku,
    name: p.name,
    category: p.category ?? null,
    description: p.description ?? null,
    specs: (p.specs ?? []).map((s: any) => ({ ...s, unit: s.unit ?? null })),
    specTable: p.specTable ?? null,
    material: p.material ?? null,
    application: p.application ?? null,
    certifications: p.certifications ?? [],
    moq: p.moq ?? null,
    leadTime: p.leadTime ?? null,
    assetIds: (p.assetIds ?? []).map(String),
    source: p.source,
    externalRef: p.externalRef ?? null,
    provenance: p.provenance ?? null,
    status: p.status,
    revision: p.revision,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
export function factDto(f: any) {
  return {
    id: String(f._id),
    subjectType: f.subjectType,
    subjectId: f.subjectId ? String(f.subjectId) : null,
    type: f.type,
    value: f.value,
    unit: f.unit ?? null,
    source: f.source,
    status: f.status,
    revision: f.revision,
    reviewedBy: f.reviewedBy ? String(f.reviewedBy) : null,
    reviewedAt: f.reviewedAt ?? null,
    reason: f.reason ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}
export async function pinAssets(
  ids: string[],
  session: mongoose.ClientSession,
) {
  for (const id of new Set(ids)) {
    const a = await Asset.findOneAndUpdate(
      { _id: id, status: "ready", mime: /^image\// },
      { $inc: { referenceVersion: 1 } },
      { session },
    );
    ensure(a, 404, "NOT_FOUND");
  }
}
export async function saveProduct(
  input: unknown,
  actor: string,
  id?: string,
  revision?: number,
  afterWrite?: (product: any, session: mongoose.ClientSession) => Promise<void>,
) {
  const data = productInput.parse(input);
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    await pinAssets(data.assetIds, session);
    if (id) {
      result = await Product.findOneAndUpdate(
        { _id: id, revision },
        { $set: data, $inc: { revision: 1 } },
        { session, new: true },
      );
      ensure(result, 409, "REVISION_CONFLICT");
      const affected = await FactSheet.find({
        "source.kind": "product",
        "source.refId": id,
        status: "confirmed",
      }).session(session);
      await assertFactsEditable(
        affected.map((f) => String(f._id)),
        session,
      );
      for (const f of affected) {
        const before = factDto(f);
        f.status = "candidate";
        f.revision++;
        f.reviewedBy = undefined;
        f.reviewedAt = undefined;
        await f.save({ session });
        await FactRevision.create(
          [
            {
              factId: f._id,
              revision: f.revision,
              actorId: actor,
              action: "source.changed",
              before,
              after: factDto(f),
            },
          ],
          { session },
        );
      }
    } else
      [result] = await Product.create(
        [
          {
            ...data,
            sku: data.sku ?? "GS-" + randomUUID().slice(0, 12).toUpperCase(),
            source: "local",
          },
        ],
        { session },
      );
    if (afterWrite) await afterWrite(result, session);
    await auditTx(
      id ? "product.updated" : "product.created",
      actor,
      String(result._id),
      session,
    );
  });
  return productDto(result);
}
export async function validateSource(
  source: any,
  subjectId: string | undefined,
  session: mongoose.ClientSession,
) {
  if (subjectId)
    ensure(
      await Product.exists({
        _id: subjectId,
        status: { $ne: "archived" },
      }).session(session),
      404,
      "NOT_FOUND",
    );
  if (source.kind === "asset") {
    ensure(source.refId, 400, "SOURCE_REQUIRED");
    const a = await Asset.findOneAndUpdate(
      { _id: source.refId, status: "ready" },
      { $inc: { referenceVersion: 1 } },
      { session },
    );
    ensure(a, 404, "NOT_FOUND");
    ensure(!source.sha256 || source.sha256 === a.sha256, 409, "SOURCE_CHANGED");
    source.sha256 = a.sha256;
  } else if (source.kind === "product") {
    ensure(source.refId, 400, "SOURCE_REQUIRED");
    const p = await Product.findOneAndUpdate(
      {
        _id: source.refId,
        status: { $ne: "archived" },
      },
      { $inc: { referenceVersion: 1 } },
      { session },
    );
    ensure(p, 404, "NOT_FOUND");
    ensure(
      !source.revision || source.revision === p.revision,
      409,
      "SOURCE_CHANGED",
    );
    source.revision = p.revision;
  } else if (source.kind === "website") {
    const run = await WebsiteRead.findOne({
      _id: source.refId,
      status: "complete",
    }).session(session);
    ensure(
      run &&
        run.pages.some((p: any) => p.url === source.url && p.status === "read"),
      404,
      "NOT_FOUND",
    );
  } else if (source.kind === "globalcrm") {
    const r = await CrmImportedResource.findOne({
      _id: source.refId,
      withdrawn: false,
    }).session(session);
    ensure(
      r && r.sha256 === source.sha256 && r.factValues.includes(source.quote),
      409,
      "SOURCE_CHANGED",
    );
  } else ensure(source.kind === "manual", 400, "SOURCE_NOT_LOCAL");
  source.capturedAt ??= new Date().toISOString();
  return source;
}
export async function saveFact(
  input: unknown,
  actor: string,
  id?: string,
  revision?: number,
) {
  const data = factInput.parse(input);
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    const source = await validateSource(
      { ...data.source },
      data.subjectId,
      session,
    );
    if (id) {
      const current = await FactSheet.findOne({ _id: id, revision }).session(
        session,
      );
      ensure(current, 409, "REVISION_CONFLICT");
      await assertFactsEditable([String(current._id)], session);
      const before = factDto(current);
      result = await FactSheet.findOneAndUpdate(
        { _id: id, revision },
        {
          $set: { ...data, source, status: "candidate" },
          $unset: {
            reviewedBy: 1,
            reviewedAt: 1,
            reason: 1,
            ...(!data.subjectId ? { subjectId: 1 } : {}),
          },
          $inc: { revision: 1 },
        },
        { session, new: true },
      );
      ensure(result, 409, "REVISION_CONFLICT");
      await FactRevision.create(
        [
          {
            factId: id,
            revision: result.revision,
            actorId: actor,
            action: "edited",
            before,
            after: factDto(result),
          },
        ],
        { session },
      );
    } else {
      [result] = await FactSheet.create(
        [{ ...data, source, status: "candidate" }],
        { session },
      );
      await FactRevision.create(
        [
          {
            factId: result._id,
            revision: 1,
            actorId: actor,
            action: "created",
            before: null,
            after: factDto(result),
          },
        ],
        { session },
      );
    }
    await auditTx(
      id ? "fact.edited" : "fact.created",
      actor,
      String(result._id),
      session,
    );
  });
  return factDto(result);
}
export async function transitionFact(
  id: string,
  revision: number,
  status: "confirmed" | "rejected",
  actor: string,
  reason?: string,
) {
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    const current = await FactSheet.findOne({ _id: id, revision }).session(
      session,
    );
    ensure(current, 409, "REVISION_CONFLICT");
    await assertFactsEditable([String(current._id)], session);
    if (status === "confirmed") {
      if (
        ["product", "asset", "manual", "globalcrm"].includes(
          current.source.kind,
        )
      )
        await validateSource(
          { ...current.source },
          current.subjectId ? String(current.subjectId) : undefined,
          session,
        );
      else if (current.source.kind === "website") {
        const { WebsiteRead } = await import("../models");
        ensure(
          await WebsiteRead.exists({
            _id: current.source.refId,
            status: "complete",
          }).session(session),
          404,
          "NOT_FOUND",
        );
      } else ensure(false, 400, "SOURCE_NOT_LOCAL");
    }
    const before = factDto(current);
    result = await FactSheet.findOneAndUpdate(
      { _id: id, revision },
      {
        $set: {
          status,
          reviewedBy: actor,
          reviewedAt: new Date(),
          reason: reason ?? null,
        },
        $inc: { revision: 1 },
      },
      { session, new: true },
    );
    ensure(result, 409, "REVISION_CONFLICT");
    await FactRevision.create(
      [
        {
          factId: id,
          revision: result.revision,
          actorId: actor,
          action: status,
          before,
          after: factDto(result),
        },
      ],
      { session },
    );
    await auditTx("fact." + status, actor, id, session);
  });
  return factDto(result);
}
export const sha = (text: string) =>
  createHash("sha256").update(text).digest("hex");
