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
import { authorizeActor } from "../services/catalog-authority";
import { ProductImport, WebsiteRead, AgentRun } from "../models";
import { AppError } from "../errors";
// Adapted from GlobalCRM server/src/background/runtime.ts @ a94a285.
// Mongo lease + fencing, no marketing/inbox schedulers or unrestricted tenant bypass.
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { Task } from "../models";
import { runScheduler, runWithTenant } from "../models/tenant-context";
import { decrypt } from "../services/credential-crypto";
import { config } from "../config";
const owner = randomUUID();
export async function claimTask(now = new Date()) {
  return runScheduler(() =>
    Task.findOneAndUpdate(
      {
        nextAttemptAt: { $lte: now },
        $or: [
          { status: "pending" },
          { status: "running", leaseUntil: { $lt: now } },
        ],
      },
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
  task: any,
  status: "done" | "pending" | "dead",
  error?: string,
  delayMs?: number,
) {
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
export async function tick() {
  const task = await claimTask();
  if (!task) return;
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
        await finishTask(task, outcome.status, outcome.error);
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
            await model.updateOne(
              { _id: task.payload.runId },
              {
                $set: { status: retry ? "queued" : "failed", errorCode: code },
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
}
export function startBackgroundJobs() {
  let stopping = false;
  let running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!running && !stopping) {
      running = tick()
        .catch(() =>
          console.error(JSON.stringify({ event: "worker_tick_failed" })),
        )
        .finally(() => {
          running = undefined;
        });
    }
  }, 1000);
  return async () => {
    stopping = true;
    clearInterval(timer);
    await running;
  };
}
