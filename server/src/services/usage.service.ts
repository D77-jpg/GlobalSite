// Adapted from GlobalCRM server/src/services/usage.service.ts @ a94a285.
// Atomic reservations + idempotent settlement replace post-hoc CRM marketing counters.
import mongoose from "mongoose";
import { Organization, UsageBucket, UsageRecord } from "../models";
import { runIdentity, tenantContext } from "../models/tenant-context";
import { plans, type Plan, type Metric } from "../constants/plans";
import { ensure, AppError } from "../errors";
export const period = (metric: Metric) =>
  metric === "storage_bytes"
    ? "lifetime"
    : new Date().toISOString().slice(0, 7);
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
    items: buckets.map((x) => ({
      metric: x.metric,
      consumed: x.consumed,
      reserved: x.reserved,
    })),
  };
}
