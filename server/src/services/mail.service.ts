// Adapted from GlobalCRM server/src/services/auth-mail.service.ts @ a94a285.
// Persistent encrypted notification queue; development logs contain metadata only.
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { Task } from "../models";
import { tenantContext, runWithTenant } from "../models/tenant-context";
import { encrypt, decrypt } from "./credential-crypto";
import { config } from "../config";
import { ensure } from "../errors";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function queueMail(to: string, subject: string, text: string) {
  const org = tenantContext()?.organizationId;
  ensure(org, 500, "TENANT_REQUIRED");
  const preview = randomBytes(32).toString("hex");
  const task = await Task.create({
    kind: "mail",
    operationId: randomUUID(),
    payload: {
      secret: encrypt(JSON.stringify({ to, subject, text }), "mail:" + org),
      previewHash: digest(preview),
    },
  });
  if (!config.smtpHost && config.env === "development")
    console.info(
      JSON.stringify({
        event: "development_mail",
        notificationId: String(task._id),
        preview: "available_in_browser",
      }),
    );
  return config.env === "production"
    ? undefined
    : org + "." + task._id + "." + preview;
}
export async function previewMail(receipt: string) {
  ensure(config.env !== "production", 404, "NOT_FOUND");
  const [org, id, token] = receipt.split(".");
  ensure(
    /^[a-f0-9]{24}$/.test(org ?? "") &&
      /^[a-f0-9]{24}$/.test(id ?? "") &&
      /^[a-f0-9]{64}$/.test(token ?? ""),
    404,
    "NOT_FOUND",
  );
  return runWithTenant(org, async () => {
    const task = await Task.findOne({
      _id: id,
      "payload.previewHash": digest(token),
      createdAt: { $gt: new Date(Date.now() - 3600000) },
    });
    ensure(task, 404, "NOT_FOUND");
    const mail = JSON.parse(decrypt(task.payload.secret, "mail:" + org));
    return { subject: mail.subject, text: mail.text };
  });
}
