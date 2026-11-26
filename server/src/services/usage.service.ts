// Adapted from GlobalCRM server/src/services/usage.service.ts @ a94a285.
// Atomic reservations + idempotent settlement replace post-hoc CRM marketing counters.
import mongoose from "mongoose";
import { Organization, UsageBucket, UsageRecord } from "../models";
import { runIdentity, tenantContext } from "../models/tenant-context";
import { plans, type Plan, type Metric } from "../constants/plans";
import { ensure, AppError } from "../errors";
import { platformAiConfig } from "../config";
export const period = (metric: Metric) =>
  metric === "storage_bytes"
    ? "lifetime"
    : new Date().toISOString().slice(0, 7);
/**
 * S36: monthly quotas use UTC calendar months (see period()); the next period
 * starts on the first day of the following UTC month.
 */
export function periodResetsAt(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
export async function limits() {
  const id = tenantContext()?.organizationId;
  const org = await runIdentity(() => Organization.findById(id));
  ensure(org, 404, "NOT_FOUND");
  return plans[(org.plan ?? "trial") as Plan];
}
export async function reserve(
  metric: Metric,
  amount: number,
  operationId: string,
) {
  ensure(Number.isSafeInteger(amount) && amount > 0 && amount <= 1e12);
  const max = (await limits())[metric];
  ensure(typeof max === "number", 400, "METRIC_NOT_RESERVABLE");
  const p = period(metric);
  let created = false;
  await mongoose.connection.transaction(async (session) => {
    created = false;
    const existing = await UsageRecord.findOne({ metric, operationId }).session(
      session,
    );
    if (existing) {
      ensure(existing.amount === amount, 409, "CONFLICT");
      return;
    }
    await UsageBucket.updateOne(
      { period: p, metric },
      { $setOnInsert: { consumed: 0, reserved: 0 } },
      { upsert: true, session },
    );
    const bucket = await UsageBucket.findOneAndUpdate(
      {
        period: p,
        metric,
        $expr: { $lte: [{ $add: ["$consumed", "$reserved", amount] }, max] },
      },
      { $inc: { reserved: amount } },
      { session, new: true },
    );
    if (!bucket) throw new AppError(409, "QUOTA_EXCEEDED");
    await UsageRecord.create(
      [{ period: p, metric, operationId, amount, state: "reserved" }],
      { session },
    );
    created = true;
  });
  return created;
}
export async function settle(
  metric: Metric,
  operationId: string,
  actual: number,
) {
  await mongoose.connection.transaction(async (session) => {
    const record = await UsageRecord.findOne({
      metric,
      operationId,
      state: "reserved",
    }).session(session);
    if (!record) return;
    ensure(
      Number.isSafeInteger(actual) && actual >= 0 && actual <= record.amount,
      409,
      "INVALID_SETTLEMENT",
    );
    await UsageBucket.updateOne(
      { period: record.period, metric },
      { $inc: { reserved: -record.amount, consumed: actual } },
      { session },
    );
    await UsageRecord.updateOne(
      { _id: record._id, state: "reserved" },
      { $set: { state: actual ? "settled" : "released", actual } },
      { session },
    );
  });
}

// S35 acceptance fix: unknown AI outcomes are absorbed by the platform.
// AI_UNKNOWN_ABSORB_LIMIT: automatic absorptions per organization and month
// (default 5, 0-1000). Above it the job pauses; an explicit user retry still
// absorbs (force) so the customer is never charged for an unknown outcome.
export function unknownAbsorbLimit(
  raw: string | undefined = process.env.AI_UNKNOWN_ABSORB_LIMIT,
): number {
  const n = Number(raw);
  if (raw === undefined || !raw.trim() || !Number.isInteger(n)) return 5;
  return Math.min(1000, Math.max(0, n));
}
export type UnknownAbsorption = "absorbed" | "limit" | "none";
/**
 * Releases the customer's reservation for an operation whose outcome is
 * unknown (customer consumption +0) and marks the record `absorbed` with the
 * fixed reason code, for platform reconciliation against provider bills.
 * "none": no reservation is open (already released/settled or never made).
 * "limit": the monthly automatic allowance is used up; nothing changes.
 */
export async function absorbUnknownUsage(
  metric: Metric,
  operationId: string,
  reason: string,
  session: mongoose.ClientSession,
  options: { force?: boolean } = {},
): Promise<UnknownAbsorption> {
  const record = await UsageRecord.findOne({
    metric,
    operationId,
    state: "reserved",
  }).session(session);
  if (!record) return "none";
  if (!options.force) {
    const used = await UsageRecord.countDocuments({
      metric,
      period: record.period,
      absorbed: true,
    }).session(session);
    if (used >= unknownAbsorbLimit()) return "limit";
  }
  await UsageBucket.updateOne(
    { period: record.period, metric },
    { $inc: { reserved: -record.amount } },
    { session },
  );
  await UsageRecord.updateOne(
    { _id: record._id, state: "reserved" },
    {
      $set: {
        state: "released",
        actual: 0,
        absorbed: true,
        unknownReason: reason,
        absorbedAt: new Date(),
        absorbedBy: options.force ? "retry" : "auto",
      },
    },
    { session },
  );
  return "absorbed";
}
export async function releaseStorage(bytes: number) {
  await UsageBucket.updateOne(
    { period: "lifetime", metric: "storage_bytes" },
    { $inc: { consumed: -bytes } },
  );
}
export async function usage() {
  const cap = await limits();
  const buckets = await UsageBucket.find({
    $or: [{ period: period("ai_tokens") }, { period: "lifetime" }],
  }).lean();
  return {
    limits: cap,
    period: period("ai_tokens"),
    // S36: customer-facing reset date and optional upgrade entry.
    resetsAt: periodResetsAt().toISOString(),
    upgradeUrl: platformAiConfig().upgradeUrl || null,
    items: buckets.map((x) => ({
      metric: x.metric,
      consumed: x.consumed,
      reserved: x.reserved,
    })),
  };
}
