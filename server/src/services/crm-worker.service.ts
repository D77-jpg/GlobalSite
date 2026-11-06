import mongoose from "mongoose";
import {
  CrmConnection,
  CrmSyncState,
  OutboundDelivery,
  SiteInquiry,
} from "../models";
import { withCrmLease, queueSync } from "./crm-connection.service";
import { syncCrmPage } from "./crm-sync.service";
import { deliverCrmInquiry } from "./crm-delivery.service";
import { CrmError } from "./crm-client.service";
import { AppError } from "../errors";
import { fenceTask } from "./product-import.service";
export async function processCrmTask(task: any): Promise<{
  status: "done" | "pending" | "dead";
  error?: string;
  delayMs?: number;
}> {
  if (task.kind === "crm.schedule") {
    const c = await CrmConnection.findById(task.payload.runId);
    if (!c?.active) return { status: "dead", error: "CRM_DISCONNECTED" };
    if (["connected", "degraded"].includes(c.status))
      await queueSync(c, false, true, task);
    return { status: "pending", delayMs: 60000 };
  }
  const isSync = task.kind === "crm.sync",
    model = isSync ? CrmSyncState : OutboundDelivery;
  const run = await model
    .findById(task.payload.runId)
    .select(isSync ? "" : "+secret");
  if (!run) return { status: "dead", error: "NOT_FOUND" };
  if (isSync && run.dispatch !== task.payload.dispatch)
    return { status: "dead", error: "CRM_STALE_SYNC" };
  if (!isSync && run.status === "sent") return { status: "done" };
  try {
    await mongoose.connection.transaction(async (session) => {
      await fenceTask(task, session);
      if (isSync)
        await CrmSyncState.updateOne(
          { _id: run._id, dispatch: run.dispatch },
          { $set: { status: "running" } },
          { session },
        );
      else {
        const updated = await OutboundDelivery.findOneAndUpdate(
          { _id: run._id, status: { $ne: "sent" } },
          { $inc: { attempts: 1 } },
          { session, new: true },
        );
        if (updated) run.attempts = updated.attempts;
      }
    });
    const result = await withCrmLease(
      String(run.connectionId),
      task,
      async (l) => (isSync ? syncCrmPage(l, run) : deliverCrmInquiry(l, run)),
    );
    return isSync && (result as any)?.more
      ? { status: "pending", delayMs: 1000 }
      : { status: "done" };
  } catch (e) {
    const code =
      e instanceof CrmError
        ? e.code
        : e instanceof AppError
          ? e.code
          : "CRM_UNAVAILABLE";
    if (isSync && code === "CRM_CURSOR_INVALID" && run.cursor) {
      await mongoose.connection.transaction(async (session) => {
        await fenceTask(task, session);
        await CrmSyncState.updateOne(
          { _id: run._id, dispatch: run.dispatch },
          {
            $set: {
              cursor: null,
              batchUntil: null,
              full: run.resource !== "outcomes",
              seenIds: [],
              status: "queued",
              lastErrorCode: code,
            },
          },
          { session },
        );
      });
      return { status: "pending", error: code, delayMs: 1000 };
    }
    const paused = [
      "CRM_UNAUTHORIZED",
      "CRM_SCOPE_MISSING",
      "CRM_DISCONNECTED",
      "CRM_CONTRACT_MISMATCH",
      "CRM_ADMIN_REQUIRED",
      "CRM_PRIVACY_REBUILD_REQUIRED",
    ].includes(code);
    const permanent = [
      "CRM_NOT_FOUND",
      "CRM_VALIDATION_REJECTED",
      "CRM_CONFLICT",
      "CRM_PROJECT_MISMATCH",
      "CRM_TARGET_UNSAFE",
      "CRM_TARGET_UNCONFIGURED",
      "CRM_SOURCE_WITHDRAWN",
    ].includes(code);
    const attempts = isSync
      ? (run.failures ?? 0) + 1
      : Math.max(1, run.attempts ?? 0);
    const retry = !paused && !permanent && attempts < 8;
    const backoff = [
      30000, 120000, 600000, 1800000, 7200000, 21600000, 43200000, 86400000,
    ][Math.min(attempts - 1, 7)];
    const retryAfter = e instanceof CrmError ? e.retryAfterMs : 0,
      delayMs = Math.max(retryAfter, backoff);
    await mongoose.connection.transaction(async (session) => {
      await fenceTask(task, session);
      if (isSync)
        await CrmSyncState.updateOne(
          { _id: run._id, dispatch: run.dispatch },
          {
            $set: {
              status: paused ? "paused" : retry ? "queued" : "failed",
              lastErrorCode: code,
            },
            $inc: { failures: 1 },
          },
          { session },
        );
      else {
        const status = paused ? "paused" : retry ? "retry" : "failed";
        await OutboundDelivery.updateOne(
          { _id: run._id, status: { $ne: "sent" } },
          {
            $set: {
              status,
              lastErrorCode: code,
              nextAttemptAt: new Date(Date.now() + delayMs),
            },
          },
          { session },
        );
        await SiteInquiry.updateOne(
          { _id: run.inquiryId, "crm.status": { $ne: "sent" } },
          { $set: { "crm.status": status, "crm.lastErrorCode": code } },
          { session },
        );
      }
    });
    return { status: retry ? "pending" : "dead", error: code, delayMs };
  }
}
