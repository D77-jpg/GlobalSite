import { processCrmTask } from "../services/crm-worker.service";
import { processInquiryTask } from "../services/inquiry-worker.service";
import { processPublishing } from "../services/publishing.service";
import { processSiteAgent } from "../services/site-agents.service";
import mongoose from "mongoose";
import { fenceTask } from "../services/product-import.service";
import { WebsiteError } from "../services/website/public-web";
import { processImport } from "../services/product-import.service";
import { processWebsite } from "../services/website-read.service";
import { processExtraction } from "../services/catalog-run.service";
import { processFactSuggestions } from "../services/fact-suggest.service";
import { processLogo } from "../services/site-media.service";
import { authorizeActor } from "../services/catalog-authority";
import { ProductImport, WebsiteRead, AgentRun } from "../models";
import { AppError } from "../errors";
import { usageUnknownReasonOf } from "../services/ai-usage-unknown";
import { absorbUnknownUsage } from "../services/usage.service";
// Adapted from GlobalCRM server/src/background/runtime.ts @ a94a285.
// Mongo lease + fencing, no marketing/inbox schedulers or unrestricted tenant bypass.
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { Task } from "../models";
import { runScheduler, runWithTenant } from "../models/tenant-context";
import { decrypt } from "../services/credential-crypto";
import { config } from "../config";
import { recordTaskMetric } from "../services/metrics.service";
import { reportWorkerError } from "../services/error-monitor.service";
const owner = randomUUID();
export type TaskLane = "fast" | "heavy";
const FAST_LANE_FILTER = {
  $or: [
    { kind: "mail" },
    { kind: /^inquiry\./ },
    { kind: /^crm\./ },
  ],
};
const HEAVY_LANE_FILTER = {
  $or: [
    { kind: "site.agent" },
    { kind: "site.build" },
    { kind: "site.deploy" },
    { kind: /^catalog\./ },
  ],
};
export async function claimTask(now = new Date(), lane?: TaskLane) {
  const readyCondition = {
    $or: [
      { status: "pending", nextAttemptAt: { $lte: now } },
      // Older known format failures may carry a task-wide long backoff.
      // Preserve attempts and fences; only their paid, known outcome can
      // use the bounded short correction delay. Network/unknown outcomes
      // never enter this branch.
      {
        kind: "site.agent",
        status: "pending",
        lastErrorCode: "AI_OUTPUT_INVALID",
        updatedAt: { $lte: new Date(now.getTime() - 3000) },
      },
      {
        status: "running",
        nextAttemptAt: { $lte: now },
        leaseUntil: { $lt: now },
      },
    ],
  };
  const filter =
    lane === "fast"
      ? { $and: [FAST_LANE_FILTER, readyCondition] }
      : lane === "heavy"
        ? { $and: [HEAVY_LANE_FILTER, readyCondition] }
        : readyCondition;
  return runScheduler(() =>
    Task.findOneAndUpdate(
      filter,
      {
        $set: {
          status: "running",
          owner,
          leaseUntil: new Date(now.getTime() + 60000),
        },
        $inc: { fencingToken: 1, attempts: 1 },
      },
      { new: true, sort: { nextAttemptAt: 1 } },
    ),
  );
}
export async function finishTask(
  task: { _id: unknown; owner?: string; fencingToken?: number; attempts: number; kind?: string },
  status: "done" | "pending" | "dead",
  error?: string,
  delayMs?: number,
  durationMs?: number,
) {
  if (task.kind) {
    recordTaskMetric(task.kind, status, durationMs ?? 0);
    if (status === "dead" && error) reportWorkerError(task.kind, error);
  }
  return Task.updateOne(
    {
      _id: task._id,
      owner: task.owner,
      fencingToken: task.fencingToken,
      status: "running",
      leaseUntil: { $gt: new Date() },
    },
    {
      $set: {
        status,
        lastErrorCode: error,
        nextAttemptAt: new Date(
          Date.now() +
            (delayMs ?? Math.min(3600000, 30000 * 2 ** task.attempts)),
        ),
      },
      $unset: { leaseUntil: 1 },
    },
  );
}
export async function renewTask(task: any) {
  return Task.updateOne(
    {
      _id: task._id,
      owner: task.owner,
      fencingToken: task.fencingToken,
      status: "running",
      leaseUntil: { $gt: new Date() },
    },
    { $set: { leaseUntil: new Date(Date.now() + 60000) } },
  );
}
export async function tick(lane?: TaskLane): Promise<boolean> {
  const task = await claimTask(new Date(), lane);
  if (!task) return false;
  await runWithTenant(String(task.organizationId), async () => {
    const heartbeat = setInterval(() => {
      void renewTask(task).catch(() => {});
    }, 20000);
    try {
      if (task.kind.startsWith("crm.")) {
        const result = await processCrmTask(task);
        await finishTask(task, result.status, result.error, result.delayMs);
        return;
      }
      if (task.kind.startsWith("inquiry.")) {
        const outcome = await processInquiryTask(task);
        await finishTask(task, outcome.status, outcome.error);
        return;
      }
      if (["site.build", "site.deploy"].includes(task.kind)) {
        const outcome = await processPublishing(task);
        await finishTask(task, outcome.status, outcome.error);
        return;
      }
      if (task.kind === "site.agent") {
        const outcome = await processSiteAgent(task);
        await finishTask(
          task,
          outcome.status,
          outcome.error,
          outcome.status === "pending" && outcome.error === "AI_OUTPUT_INVALID"
            ? 3000
            : undefined,
        );
        return;
      }
      if (task.kind.startsWith("catalog.")) {
        const model =
          task.kind === "catalog.import"
            ? ProductImport
            : task.kind === "catalog.website"
              ? WebsiteRead
              : AgentRun;
        const run = await model.findById(task.payload.runId);
        if (!run) throw new AppError(404, "NOT_FOUND");
        await authorizeActor(String(run.actorId));
        if (run.status !== "complete") {
          if (task.kind === "catalog.import") await processImport(task);
          else if (task.kind === "catalog.website") await processWebsite(task);
          else if (task.kind === "catalog.extract")
            await processExtraction(task);
          else if (task.kind === "catalog.suggest")
            await processFactSuggestions(task);
          else if (task.kind === "catalog.logo") await processLogo(task);
          else throw new AppError(400, "UNSUPPORTED_TASK");
        }
        await finishTask(task, "done");
        return;
      }
      if (task.kind !== "mail") throw new Error("UNSUPPORTED_TASK");
      if (!config.smtpHost) {
        await finishTask(
          task,
          config.env === "production" ? "pending" : "done",
          config.env === "production" ? "SMTP_UNCONFIGURED" : undefined,
        );
        return;
      }
      const mail = JSON.parse(
        decrypt(task.payload.secret, "mail:" + task.organizationId),
      );
      const transport = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        requireTLS: config.smtpPort !== 465,
        connectionTimeout: 10000,
        socketTimeout: 20000,
        ...(config.smtpUser
          ? { auth: { user: config.smtpUser, pass: config.smtpPassword } }
          : {}),
      });
      await transport.sendMail({
        ...mail,
        from: config.mailFrom,
        messageId: "<" + task._id + "@globalsite.invalid>",
      });
      transport.close();
      await finishTask(task, "done");
    } catch (error) {
      if (
        task.kind.startsWith("crm.") ||
        task.kind.startsWith("site.") ||
        task.kind.startsWith("inquiry.")
      )
        throw error;
      if (task.kind.startsWith("catalog.")) {
        const code =
          error instanceof AppError
            ? error.code
            : error instanceof WebsiteError
              ? "WEBSITE_" + error.code.toUpperCase()
              : "CATALOG_PROCESS_FAILED";
        const live = await Task.exists({
          _id: task._id,
          owner: task.owner,
          fencingToken: task.fencingToken,
          status: "running",
          leaseUntil: { $gt: new Date() },
        });
        if (live) {
          const model =
            task.kind === "catalog.import"
              ? ProductImport
              : task.kind === "catalog.website"
                ? WebsiteRead
                : AgentRun;
          const retry =
            task.kind === "catalog.import" &&
            !(error instanceof AppError) &&
            task.attempts < 8;
          await mongoose.connection.transaction(async (session) => {
            await fenceTask(task, session);
            const reason = usageUnknownReasonOf(error);
            // S35: the platform absorbs the unknown outcome of a failed AI
            // catalog run (customer not charged) within the monthly limit.
            const operation =
              task.kind === "catalog.extract"
                ? "extract:" + task.payload.runId
                : task.kind === "catalog.suggest"
                  ? "suggest:" + task.payload.runId
                  : null;
            if (reason && operation)
              await absorbUnknownUsage("ai_tokens", operation, reason, session);
            await model.updateOne(
              { _id: task.payload.runId },
              {
                $set: {
                  status: retry ? "queued" : "failed",
                  errorCode: code,
                  // S35: fixed code only (timeout/network/…), never model text.
                  ...(reason ? { usageUnknownReason: reason } : {}),
                },
              },
              { session },
            );
          });
          await finishTask(task, retry ? "pending" : "dead", code);
        }
        return;
      }
      await finishTask(
        task,
        task.attempts >= 8 ? "dead" : "pending",
        "MAIL_DELIVERY_FAILED",
      );
    } finally {
      clearInterval(heartbeat);
    }
  });
  return true;
}
function sleepMs(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
export function startBackgroundJobs(options?: {
  fastConcurrency?: number;
  heavyConcurrency?: number;
}) {
  const controller = new AbortController();
  const fastCount = options?.fastConcurrency ?? config.workerFastConcurrency;
  const heavyCount = options?.heavyConcurrency ?? config.workerHeavyConcurrency;
  const runLane = async (lane: TaskLane, idleMs: number) => {
    while (!controller.signal.aborted) {
      let claimed = false;
      try {
        claimed = await tick(lane);
      } catch {
        console.error(
          JSON.stringify({ event: "worker_tick_failed", lane }),
        );
      }
      if (!claimed && !controller.signal.aborted) {
        await sleepMs(idleMs, controller.signal);
      }
    }
  };
  const loops: Promise<void>[] = [];
  for (let i = 0; i < fastCount; i++) loops.push(runLane("fast", 500));
  for (let i = 0; i < heavyCount; i++) loops.push(runLane("heavy", 1000));
  return async () => {
    controller.abort();
    await Promise.allSettled(loops);
  };
}
