import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CrmConnection,
  CrmSyncState,
  OutboundDelivery,
  Task,
  Membership,
  Organization,
  AuditLog,
} from "../models";
import { runIdentity, tenantContext } from "../models/tenant-context";
import { encrypt, decrypt, otpHash } from "./credential-crypto";
import {
  crmBase,
  crmHttp,
  checked,
  healthShape,
  CrmError,
} from "./crm-client.service";
import { fenceTask } from "./product-import.service";
import { ensure } from "../errors";
const purpose = (id: string) =>
  "crm-connection:" + tenantContext()!.organizationId + ":" + id;
export const crmTransport = { request: crmHttp };
export const crmResources = [
  "products",
  "company",
  "playbook",
  "knowledge",
  "outcomes",
] as const;
export const resourceScopes: Record<string, string> = {
  products: "products:read",
  company: "company:read",
  playbook: "playbook:read",
  knowledge: "knowledge:read",
  outcomes: "outcomes:read",
};
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function connectionDto(c: any) {
  return {
    id: String(c._id),
    baseUrl: c.baseUrl,
    projectId: c.projectId,
    projectName: c.projectName ?? null,
    revision: c.revision,
    generation: c.generation,
    status: c.status,
    active: c.active,
    scopes: c.scopes ?? [],
    lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
    lastErrorCode: c.lastErrorCode ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}
export function syncDto(s: any) {
  return {
    id: String(s._id),
    resource: s.resource,
    status: s.status,
    cursor: s.cursor ?? null,
    updatedSince: s.updatedSince ?? null,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    lastErrorCode: s.lastErrorCode ?? null,
    nextDue: s.nextDue.toISOString(),
    imported: s.imported,
    full: s.full,
  };
}
export function deliveryDto(d: any) {
  return {
    id: String(d._id),
    inquiryId: String(d.inquiryId),
    connectionId: String(d.connectionId),
    status: d.status,
    attempts: d.attempts,
    nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
    lastErrorCode: d.lastErrorCode ?? null,
    remoteId: d.remoteId ?? null,
    customerId: d.customerId ?? null,
    customerUrl: d.customerUrl ?? null,
  };
}
export async function currentConnection() {
  return (
    (await CrmConnection.findOne({ active: true })) ??
    (await CrmConnection.findOne().sort({ createdAt: -1 }))
  );
}
export async function crmState() {
  const c = await currentConnection();
  return {
    connection: c ? connectionDto(c) : null,
    syncStates: c
      ? (await CrmSyncState.find({ connectionId: c._id })).map(syncDto)
      : [],
    deliveries: (await OutboundDelivery.find().sort({ _id: -1 }).limit(20)).map(
      deliveryDto,
    ),
  };
}
export async function requireConnection(id: string) {
  const c = await CrmConnection.findById(id).select(
    "+secret +credentialFingerprint",
  );
  ensure(c, 404, "NOT_FOUND");
  return c;
}
async function activeAdmin(actorId: string) {
  const id = tenantContext()!.organizationId,
    member = await Membership.exists({
      userId: actorId,
      status: "active",
      role: "admin",
    });
  const org = await runIdentity(() =>
    Organization.findOne({ _id: id, status: "active" }),
  );
  if (!member || !org) throw new CrmError("CRM_ADMIN_REQUIRED", 409);
}
export type ConnectionLease = {
  connection: any;
  owner: string;
  task?: any;
  testing: boolean;
};
const states = (testing: boolean) =>
  testing
    ? ["checking", "connected", "degraded", "auth_failed", "contract_error"]
    : ["connected", "degraded"];
export function leaseFilter(l: ConnectionLease) {
  return {
    _id: l.connection._id,
    generation: l.connection.generation,
    active: true,
    status: { $in: states(l.testing) },
    ioOwner: l.owner,
    ioUntil: { $gt: new Date() },
  };
}
export async function assertCrmLease(
  l: ConnectionLease,
  session?: mongoose.ClientSession,
) {
  if (l.task && session) await fenceTask(l.task, session);
  if (!(await CrmConnection.exists(leaseFilter(l)).session(session ?? null)))
    throw new CrmError("CRM_DISCONNECTED", 409);
  await activeAdmin(String(l.connection.actorId));
}
export async function withCrmLease<T>(
  id: string,
  task: any | undefined,
  fn: (l: ConnectionLease) => Promise<T>,
  testing = false,
): Promise<T> {
  const c = await requireConnection(id);
  try {
    await activeAdmin(String(c.actorId));
  } catch (e) {
    await CrmConnection.updateOne(
      { _id: c._id, generation: c.generation, active: true },
      { $set: { status: "auth_failed", lastErrorCode: "CRM_ADMIN_REQUIRED" } },
    );
    throw e;
  }
  if (!c.active || !states(testing).includes(c.status))
    throw new CrmError(
      c.status === "auth_failed"
        ? "CRM_UNAUTHORIZED"
        : c.status === "contract_error"
          ? "CRM_CONTRACT_MISMATCH"
          : "CRM_DISCONNECTED",
      409,
    );
  const owner = randomUUID(),
    acquired = await CrmConnection.findOneAndUpdate(
      {
        _id: c._id,
        generation: c.generation,
        active: true,
        status: { $in: states(testing) },
        $or: [{ ioOwner: null }, { ioUntil: { $lte: new Date() } }],
      },
      { $set: { ioOwner: owner, ioUntil: new Date(Date.now() + 45000) } },
      { new: true },
    );
  if (!acquired) throw new CrmError("CRM_BUSY", 409);
  const lease = { connection: c, owner, task, testing };
  const heartbeat = setInterval(() => {
    void CrmConnection.updateOne(leaseFilter(lease), {
      $set: { ioUntil: new Date(Date.now() + 45000) },
    }).catch(() => undefined);
  }, 10000);
  try {
    const result = await fn(lease);
    await CrmConnection.updateOne(
      { ...leaseFilter(lease), status: "degraded" },
      { $set: { status: "connected", lastErrorCode: null } },
    );
    return result;
  } catch (e) {
    if (
      e instanceof CrmError &&
      [
        "CRM_UNAUTHORIZED",
        "CRM_SCOPE_MISSING",
        "CRM_CONTRACT_MISMATCH",
        "CRM_UNAVAILABLE",
        "CRM_ADMIN_REQUIRED",
      ].includes(e.code)
    ) {
      await CrmConnection.updateOne(
        { _id: c._id, generation: c.generation, active: true },
        {
          $set: {
            status: [
              "CRM_UNAUTHORIZED",
              "CRM_SCOPE_MISSING",
              "CRM_ADMIN_REQUIRED",
            ].includes(e.code)
              ? "auth_failed"
              : e.code === "CRM_CONTRACT_MISMATCH"
                ? "contract_error"
                : "degraded",
            lastErrorCode: e.code,
          },
        },
      );
    }
    throw e;
  } finally {
    clearInterval(heartbeat);
    await CrmConnection.updateOne(
      { _id: c._id, ioOwner: owner },
      { $unset: { ioOwner: 1, ioUntil: 1 } },
    );
  }
}
export async function callCrm(
  l: ConnectionLease,
  path: string,
  options: Partial<Parameters<typeof crmHttp>[0]> = {},
) {
  await assertCrmLease(l);
  const c = l.connection;
  return crmTransport.request({
    ...options,
    baseUrl: c.baseUrl,
    token: decrypt(c.secret, purpose(String(c._id))),
    projectId: c.projectId,
    path,
  });
}
async function resumeQueues(c: any, session: mongoose.ClientSession) {
  await Task.updateOne(
    { operationId: "crm.schedule:" + c._id },
    {
      $set: {
        kind: "crm.schedule",
        payload: { runId: String(c._id) },
        status: "pending",
        nextAttemptAt: new Date(),
        attempts: 0,
      },
      $unset: { owner: 1, leaseUntil: 1 },
    },
    { upsert: true, session },
  );
  const paused = await OutboundDelivery.find({
    connectionId: c._id,
    status: "paused",
  }).session(session);
  for (const d of paused) {
    await OutboundDelivery.updateOne(
      { _id: d._id },
      {
        $set: {
          status: "pending",
          lastErrorCode: null,
          nextAttemptAt: new Date(),
        },
      },
      { session },
    );
    await Task.updateOne(
      { operationId: "crm.deliver:" + d._id },
      {
        $set: {
          kind: "crm.deliver",
          payload: { runId: String(d._id) },
          status: "pending",
          nextAttemptAt: new Date(),
          attempts: 0,
        },
        $unset: { owner: 1, leaseUntil: 1 },
      },
      { upsert: true, session },
    );
  }
}
export async function testConnection(actor: string) {
  await activeAdmin(actor);
  const c = await currentConnection();
  ensure(c?.active, 409, "CRM_NOT_CONNECTED");
  if (String(c.actorId) !== actor) {
    ensure(!c.ioOwner || c.ioUntil <= new Date(), 409, "CRM_BUSY");
    await CrmConnection.updateOne(
      { _id: c._id, revision: c.revision },
      { $set: { actorId: actor } },
    );
  }
  return withCrmLease(
    String(c._id),
    undefined,
    async (l) => {
      const raw = checked(
        healthShape,
        await callCrm(l, "/api/integrations/v1/health"),
      );
      if (!raw.data.ok) throw new CrmError("CRM_UNAVAILABLE", 503);
      if (raw.data.projectId !== c.projectId)
        throw new CrmError("CRM_PROJECT_MISMATCH", 409);
      await mongoose.connection.transaction(async (session) => {
        await assertCrmLease(l, session);
        await CrmConnection.updateOne(
          leaseFilter(l),
          {
            $set: {
              status: "connected",
              scopes: raw.data.scopes,
              projectName: raw.data.projectName ?? null,
              lastCheckedAt: new Date(),
              lastErrorCode: null,
              actorId: actor,
            },
          },
          { session },
        );
        await resumeQueues(c, session);
        await AuditLog.create(
          [
            {
              action: "crm.connection.tested",
              actorId: actor,
              targetId: String(c._id),
            },
          ],
          { session },
        );
      });
      return connectionDto(await requireConnection(String(c._id)));
    },
    true,
  );
}
export const saveConnectionInput = z
  .object({
    baseUrl: z.string().url().max(500),
    projectId: z.string().regex(/^[a-f0-9]{24}$/),
    credential: z.string().trim().min(20).max(512),
    revision: z.number().int().min(0),
  })
  .strict();
export async function saveConnection(input: unknown, actor: string) {
  const data = saveConnectionInput.parse(input),
    baseUrl = crmBase(data.baseUrl);
  let id: string = "";
  await mongoose.connection.transaction(async (session) => {
    const active = await CrmConnection.findOne({ active: true }).session(
      session,
    );
    if (active) {
      ensure(
        active.baseUrl === baseUrl && active.projectId === data.projectId,
        409,
        "CRM_DISCONNECT_FIRST",
      );
      ensure(active.revision === data.revision, 409, "REVISION_CONFLICT");
      ensure(!active.ioOwner || active.ioUntil <= new Date(), 409, "CRM_BUSY");
    }
    const row =
      active ??
      (await CrmConnection.findOne({
        baseUrl,
        projectId: data.projectId,
      }).session(session));
    if (!active)
      ensure(
        data.revision === 0 || data.revision === row?.revision,
        409,
        "REVISION_CONFLICT",
      );
    id = String(row?._id ?? new mongoose.Types.ObjectId());
    const values = {
      baseUrl,
      projectId: data.projectId,
      secret: encrypt(data.credential, purpose(id)),
      credentialFingerprint: otpHash(data.credential, "crm-fingerprint"),
      actorId: actor,
      status: "checking",
      active: true,
      lastErrorCode: null,
      scopes: [],
    };
    if (row)
      await CrmConnection.updateOne(
        { _id: row._id },
        { $set: values, $inc: { generation: 1, revision: 1 } },
        { session },
      );
    else await CrmConnection.create([{ _id: id, ...values }], { session });
    await CrmSyncState.updateMany(
      { connectionId: id },
      {
        $set: { status: "idle", cursor: null, batchUntil: null },
        $inc: { dispatch: 1 },
      },
      { session },
    );
    await AuditLog.create(
      [{ action: "crm.connection.saved", actorId: actor, targetId: id }],
      { session },
    );
  });
  return testConnection(actor);
}
export async function disconnectConnection(revision: number, actor: string) {
  const c = await CrmConnection.findOne({ active: true });
  ensure(c, 409, "CRM_NOT_CONNECTED");
  const changed = await CrmConnection.findOneAndUpdate(
    { _id: c._id, revision, active: true },
    {
      $set: { active: false, status: "disconnecting" },
      $inc: { generation: 1, revision: 1 },
    },
    { new: true },
  );
  ensure(changed, 409, "REVISION_CONFLICT");
  await OutboundDelivery.updateMany(
    { connectionId: c._id, status: { $in: ["pending", "retry", "sending"] } },
    { $set: { status: "paused", lastErrorCode: "CRM_DISCONNECTED" } },
  );
  await AuditLog.create({
    action: "crm.connection.disconnected",
    actorId: actor,
    targetId: String(c._id),
  });
  const until = Date.now() + 50000;
  while (Date.now() < until) {
    const row = await CrmConnection.findById(c._id);
    if (!row?.ioOwner || row.ioUntil <= new Date()) break;
    await delay(250);
  }
  const row = await CrmConnection.findById(c._id);
  if (!row?.ioOwner || row.ioUntil <= new Date())
    await CrmConnection.updateOne(
      { _id: c._id, status: "disconnecting" },
      { $set: { status: "disconnected" } },
    );
  return connectionDto(await requireConnection(String(c._id)));
}
export async function queueSync(
  c: any,
  full = false,
  onlyDue = false,
  parentTask?: any,
) {
  ensure(
    c?.active && ["connected", "degraded"].includes(c.status),
    409,
    "CRM_NOT_CONNECTED",
  );
  let queued = 0;
  for (const resource of crmResources) {
    let created = false;
    await mongoose.connection.transaction(async (session) => {
      created = false;
      if (parentTask) await fenceTask(parentTask, session);
      const live = await CrmConnection.findOne({
        _id: c._id,
        active: true,
        status: { $in: ["connected", "degraded"] },
      }).session(session);
      ensure(live, 409, "CRM_NOT_CONNECTED");
      let state = await CrmSyncState.findOne({
        connectionId: c._id,
        resource,
      }).session(session);
      if (!state)
        [state] = await CrmSyncState.create(
          [{ connectionId: c._id, resource, actorId: c.actorId }],
          { session },
        );
      if (!c.scopes.includes(resourceScopes[resource])) {
        await CrmSyncState.updateOne(
          { _id: state._id },
          {
            $set: {
              status: "unsupported",
              lastErrorCode: "CRM_SCOPE_MISSING",
              nextDue: new Date(Date.now() + 900000),
            },
          },
          { session },
        );
        return;
      }
      if (["queued", "running"].includes(state.status)) return;
      if (onlyDue && state.nextDue > new Date()) return;
      const fullRun =
        resource !== "outcomes" &&
        (full ||
          !state.lastFullAt ||
          Date.now() - state.lastFullAt.getTime() > 86400000);
      const set: any = {
        status: "queued",
        lastErrorCode: null,
        nextDue: new Date(
          Date.now() + (resource === "outcomes" ? 300000 : 900000),
        ),
        actorId: c.actorId,
        full: fullRun,
      };
      if (fullRun) {
        set.cursor = null;
        set.batchUntil = null;
        set.seenIds = [];
      }
      state = await CrmSyncState.findOneAndUpdate(
        { _id: state._id },
        { $set: set, $inc: { dispatch: 1 } },
        { new: true, session },
      );
      await Task.create(
        [
          {
            kind: "crm.sync",
            operationId: "crm.sync:" + state._id + ":" + state.dispatch,
            payload: {
              runId: String(state._id),
              dispatch: state.dispatch,
            } as any,
            status: "pending",
            nextAttemptAt: new Date(),
          },
        ],
        { session },
      );
      created = true;
    });
    if (created) queued++;
  }
  return { queued };
}
