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
          Date.now() + Math.min(3600000, 30000 * 2 ** task.attempts),
        ),
      },
      $unset: { leaseUntil: 1 },
    },
  );
}
export async function tick() {
  const task = await claimTask();
  if (!task) return;
  await runWithTenant(String(task.organizationId), async () => {
    const heartbeat = setInterval(() => {
      void Task.updateOne(
        {
          _id: task._id,
          owner: task.owner,
          fencingToken: task.fencingToken,
          status: "running",
        },
        { $set: { leaseUntil: new Date(Date.now() + 60000) } },
      ).catch(() => {});
    }, 20000);
    try {
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
    } catch {
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
