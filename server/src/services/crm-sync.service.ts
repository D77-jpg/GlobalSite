import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CrmSyncState,
  CrmImportedResource,
  CrmOutcome,
  Product,
  Asset,
  FactSheet,
  FactRevision,
  SiteInquiry,
  AuditLog,
  Site,
} from "../models";
import {
  ConnectionLease,
  assertCrmLease,
  callCrm,
} from "./crm-connection.service";
import {
  checked,
  feedShapes,
  outcomesShape,
  CrmError,
} from "./crm-client.service";
import { crmProductShape, mapCrmProduct } from "./crm-product-mapping";
import { store, detectMime } from "./storage.service";
import { factDto } from "./catalog.service";
import {
  assertFactsEditable,
  assertSiteEditable,
} from "./publication-lock.service";
import { sha } from "./catalog.service";
const stable = (v: any): string =>
  Array.isArray(v)
    ? "[" + v.map(stable).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + stable(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
export function publicCrmRecord(kind: string, row: any) {
  const data = { ...row };
  delete data.updatedAt;
  if (kind === "products")
    data.images = (data.images ?? []).map(
      ({ id, mime, bytes, sha256 }: any) => ({ id, mime, bytes, sha256 }),
    );
  return data;
}
function fieldValues(kind: string, row: any) {
  const result: { type: string; value: string; field: string }[] = [];
  const add = (field: string, type: string, value: any) => {
    if (value === null || value === undefined || value === "") return;
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    if (text.trim()) result.push({ type, value: text.slice(0, 1200), field });
  };
  if (kind === "products") {
    for (const key of [
      "name",
      "material",
      "application",
      "moq",
      "leadTime",
      "certifications",
    ])
      add(key, "product." + key, row[key]);
    for (const spec of row.specs ?? [])
      add(
        "spec:" + spec.code,
        "product.specification",
        spec.name + ": " + spec.value + (spec.unit ? " " + spec.unit : ""),
      );
  } else if (kind === "company") {
    for (const key of [
      "name",
      "website",
      "industry",
      "address",
      "phone",
      "email",
      "foundedYear",
      "capacity",
      "certifications",
    ])
      add(key, "company." + key, row[key]);
  } else if (kind === "playbook") {
    add("brandPositioning", "company.brandPositioning", row.brandPositioning);
    add("sellingPoints", "company.sellingPoints", row.sellingPoints);
    add("targetMarkets", "company.targetMarkets", row.targetMarkets);
  } else if (kind === "knowledge" && !row.deleted)
    add("summary", "knowledge.summary", row.summary);
  return result;
}
async function setProductSource(
  p: any,
  status: string,
  session: mongoose.ClientSession,
) {
  if (p.crmSourceStatus === status) return;
  const sites = await Site.find({ productIds: p._id })
    .select("_id")
    .session(session);
  for (const site of sites) await assertSiteEditable(String(site._id), session);
  await Product.updateOne(
    { _id: p._id },
    { $set: { crmSourceStatus: status }, $inc: { referenceVersion: 1 } },
    { session },
  );
}
async function withdraw(
  kind: string,
  connectionId: string,
  remoteIds: string[],
  session: mongoose.ClientSession,
  actor: string,
) {
  if (!remoteIds.length) return;
  const resources = await CrmImportedResource.find({
    connectionId,
    kind,
    remoteId: { $in: remoteIds },
    withdrawn: false,
  }).session(session);
  const ids = resources.map((r) => r._id);
  const facts = await FactSheet.find({
    "source.kind": "globalcrm",
    "source.refId": { $in: ids },
    status: "confirmed",
  }).session(session);
  await assertFactsEditable(
    facts.map((f) => String(f._id)),
    session,
  );
  for (const f of facts) {
    const before = factDto(f);
    f.status = "candidate";
    f.revision++;
    f.reason = "CRM_SOURCE_WITHDRAWN";
    f.reviewedAt = undefined;
    f.reviewedBy = undefined;
    await f.save({ session });
    await FactRevision.create(
      [
        {
          factId: f._id,
          revision: f.revision,
          actorId: actor,
          action: "source.withdrawn",
          before,
          after: factDto(f),
        },
      ],
      { session },
    );
  }
  await CrmImportedResource.updateMany(
    { _id: { $in: ids } },
    { $set: { withdrawn: true } },
    { session },
  );
}
async function imageAssets(l: ConnectionLease, p: any) {
  const ids: string[] = [];
  for (let image of p.images) {
    const key =
      String(l.connection._id) +
      ":" +
      p.id +
      ":" +
      image.id +
      ":" +
      image.sha256;
    const cached = await Asset.findOne({ crmImportKey: key, status: "ready" });
    if (cached) {
      ids.push(String(cached._id));
      continue;
    }
    if (new Date(image.expiresAt).getTime() <= Date.now()) {
      const fresh = checked(
        z
          .object({ success: z.literal(true), data: crmProductShape })
          .passthrough(),
        await callCrm(l, "/api/integrations/v1/products/" + p.id),
      );
      image = fresh.data.images.find(
        (i) => i.id === image.id && i.sha256 === image.sha256,
      );
      if (!image) throw new CrmError("CRM_SOURCE_CHANGED", 409);
    }
    const url = new URL(image.url, l.connection.baseUrl);
    const bytes = (await callCrm(l, url.href, {
      binary: true,
      maxBytes: 10485760,
    })) as Buffer;
    if (
      bytes.length !== image.bytes ||
      detectMime(bytes) !== image.mime ||
      createHash("sha256").update(bytes).digest("hex") !== image.sha256
    )
      throw new CrmError("CRM_CONTRACT_MISMATCH", 409);
    await assertCrmLease(l);
    const asset = await store(
      bytes,
      image.mime,
      "CRM " + p.name.slice(0, 140),
      "image",
      key,
    );
    ids.push(String(asset._id));
  }
  return ids;
}
export async function importCrmItem(l: ConnectionLease, state: any, row: any) {
  const kind = state.resource,
    c = l.connection,
    clean = publicCrmRecord(kind, row),
    hash = sha(stable(clean));
  const existing =
    kind === "products"
      ? await Product.findOne({
          "externalRef.connectionId": String(c._id),
          "externalRef.remoteId": row.id,
        })
      : null;
  const assetIds =
    kind === "products" && existing?.externalRef?.lastSeenHash !== hash
      ? await imageAssets(l, row)
      : (existing?.assetIds ?? []);
  await mongoose.connection.transaction(async (session) => {
    await assertCrmLease(l, session);
    const stateLive = await CrmSyncState.exists({
      _id: state._id,
      dispatch: state.dispatch,
    }).session(session);
    if (!stateLive) throw new CrmError("CRM_STALE_SYNC", 409);
    if (kind === "knowledge" && row.deleted) {
      await withdraw(kind, String(c._id), [row.id], session, String(c.actorId));
      return;
    }
    let product: any;
    if (kind === "products") {
      product = await Product.findOne({
        "externalRef.connectionId": String(c._id),
        "externalRef.remoteId": row.id,
      }).session(session);
      const mapped = mapCrmProduct(row, String(c._id)),
        {
          remoteImages: _images,
          externalRef: remoteRef,
          source: _source,
          ...data
        } = mapped;
      if (!product) {
        let sku = data.sku.toUpperCase();
        if (await Product.exists({ sku }).session(session))
          sku = "CRM-" + String(c._id).slice(-8) + "-" + row.id;
        [product] = await Product.create(
          [
            {
              ...data,
              sku,
              assetIds,
              source: "globalcrm",
              externalRef: {
                ...remoteRef,
                lastSeenHash: hash,
                remoteSku: row.sku,
              },
              crmSourceStatus: row.status,
            },
          ],
          { session },
        );
        await AuditLog.create(
          [
            {
              action: "crm.product.imported",
              actorId: c.actorId,
              targetId: String(product._id),
            },
          ],
          { session },
        );
      } else {
        if (product.externalRef.lastSeenHash !== hash) {
          await Product.updateOne(
            { _id: product._id },
            {
              $set: {
                syncCandidate: {
                  hash,
                  data: { ...data, sku: product.sku, assetIds },
                  remoteUpdatedAt: row.updatedAt,
                  remoteName: row.name,
                },
                externalRef: {
                  ...product.externalRef,
                  remoteUpdatedAt: row.updatedAt,
                  lastSeenHash: hash,
                },
              },
            },
            { session },
          );
          await AuditLog.create(
            [
              {
                action: "crm.product.candidate",
                actorId: c.actorId,
                targetId: String(product._id),
              },
            ],
            { session },
          );
        }
        await setProductSource(product, row.status, session);
      }
    }
    const values = fieldValues(kind, row);
    let resource = await CrmImportedResource.findOne({
      connectionId: c._id,
      kind,
      remoteId: row.id,
      sha256: hash,
    }).session(session);
    if (!resource)
      [resource] = await CrmImportedResource.create(
        [
          {
            connectionId: c._id,
            kind,
            remoteId: row.id,
            payload: clean,
            factValues: values.map((v) => v.value),
            sha256: hash,
            capturedAt: new Date(),
          },
        ],
        { session },
      );
    else if (resource.withdrawn) {
      resource.withdrawn = false;
      await resource.save({ session });
    }
    for (const field of values) {
      const originKey =
        "crm:" +
        c._id +
        ":" +
        kind +
        ":" +
        row.id +
        ":" +
        field.field +
        ":" +
        sha(field.value);
      if (await FactSheet.exists({ originKey }).session(session)) continue;
      const source = {
        kind: "globalcrm",
        refId: String(resource._id),
        revision: 1,
        sha256: hash,
        quote: field.value,
        label: (
          "GlobalCRM " +
          kind +
          " / " +
          (row.title ?? row.name ?? row.id)
        ).slice(0, 200),
        capturedAt: new Date().toISOString(),
        textVerified: true,
      };
      const [fact] = await FactSheet.create(
        [
          {
            subjectType: kind === "products" ? "product" : "organization",
            ...(product ? { subjectId: product._id } : {}),
            type: field.type,
            value: field.value,
            source,
            status: "candidate",
            originKey,
          },
        ],
        { session },
      );
      await FactRevision.create(
        [
          {
            factId: fact._id,
            revision: 1,
            actorId: c.actorId,
            action: "created",
            before: null,
            after: factDto(fact),
          },
        ],
        { session },
      );
    }
  });
}
async function importOutcomes(l: ConnectionLease, state: any, data: any) {
  await mongoose.connection.transaction(async (session) => {
    await assertCrmLease(l, session);
    if (
      !(await CrmSyncState.exists({
        _id: state._id,
        dispatch: state.dispatch,
      }).session(session))
    )
      throw new CrmError("CRM_STALE_SYNC", 409);
    for (const event of data.items) {
      await CrmOutcome.updateOne(
        { connectionId: l.connection._id, eventId: event.eventId },
        {
          $setOnInsert: {
            customerId: event.customerId,
            toStatus: event.toStatus,
            occurredAt: new Date(event.occurredAt),
          },
        },
        { upsert: true, session },
      );
      const result = {
        eventId: event.eventId,
        toStatus: event.toStatus,
        occurredAt: event.occurredAt,
      };
      const inquiries = await SiteInquiry.find({
        "crm.connectionId": String(l.connection._id),
        "crm.customerId": event.customerId,
      }).session(session);
      for (const inquiry of inquiries) {
        if (
          inquiry.crm?.outcome &&
          inquiry.crm.outcome.occurredAt > event.occurredAt
        )
          continue;
        await SiteInquiry.updateOne(
          { _id: inquiry._id },
          { $set: { "crm.outcome": result } },
          { session },
        );
      }
    }
  });
}
const paths: Record<string, string> = {
  products: "/products",
  company: "/company-profile",
  playbook: "/playbook",
  knowledge: "/knowledge/summaries",
  outcomes: "/outcomes",
};
export async function syncCrmPage(l: ConnectionLease, state: any) {
  const query = new URLSearchParams({ limit: "50" });
  if (state.cursor) query.set("cursor", state.cursor);
  if (state.resource !== "outcomes" && !state.full && state.updatedSince)
    query.set("updatedSince", state.updatedSince);
  const raw = await callCrm(
    l,
    "/api/integrations/v1" + paths[state.resource] + "?" + query,
  );
  const response = checked(
      state.resource === "outcomes"
        ? outcomesShape
        : feedShapes[state.resource],
      raw,
    ) as any,
    data = response.data;
  if (data.hasMore && !data.nextCursor)
    throw new CrmError("CRM_CONTRACT_MISMATCH", 409);
  if (state.resource === "outcomes") await importOutcomes(l, state, data);
  else for (const item of data.items) await importCrmItem(l, state, item);
  await mongoose.connection.transaction(async (session) => {
    await assertCrmLease(l, session);
    const current = await CrmSyncState.findOne({
      _id: state._id,
      dispatch: state.dispatch,
    }).session(session);
    if (!current) throw new CrmError("CRM_STALE_SYNC", 409);
    const seen = [
      ...new Set([
        ...(current.seenIds ?? []),
        ...data.items.map((r: any) => r.id).filter(Boolean),
      ]),
    ];
    if (state.full && !data.hasMore && state.resource !== "outcomes") {
      const kind = state.resource,
        previous = await CrmImportedResource.distinct("remoteId", {
          connectionId: l.connection._id,
          kind,
          withdrawn: false,
        });
      const missing = previous.filter((id) => !seen.includes(String(id)));
      await withdraw(
        kind,
        String(l.connection._id),
        missing.map(String),
        session,
        String(l.connection.actorId),
      );
      if (kind === "products") {
        const missingProducts = await Product.find({
          "externalRef.connectionId": String(l.connection._id),
          "externalRef.remoteId": { $in: missing },
        }).session(session);
        for (const p of missingProducts)
          await setProductSource(p, "withdrawn", session);
      }
    }
    const update: any = {
      status: data.hasMore ? "queued" : "idle",
      lastErrorCode: null,
      failures: 0,
      cursor: data.hasMore
        ? data.nextCursor
        : state.resource === "outcomes"
          ? (data.nextCursor ?? current.cursor ?? null)
          : null,
      seenIds: data.hasMore ? seen : [],
      lastSuccessAt: new Date(),
    };
    if (state.resource !== "outcomes") {
      update.batchUntil = data.hasMore ? data.syncUntil : null;
      if (!data.hasMore) {
        update.updatedSince = new Date(
          new Date(data.syncUntil).getTime() - 1000,
        ).toISOString();
        if (state.full) update.lastFullAt = new Date();
      }
    }
    await CrmSyncState.updateOne(
      { _id: state._id, dispatch: state.dispatch },
      { $set: update, $inc: { imported: data.items.length } },
      { session },
    );
  });
  return { more: data.hasMore };
}
