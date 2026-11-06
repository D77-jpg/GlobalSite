// Dedicated temporary globalsite database and storage; no live environment or external mail.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function main() {
  dotenv.config = () => ({ parsed: {} });
  const storage = await mkdtemp(join(tmpdir(), "globalsite-j1-"));
  process.env.NODE_ENV = "test";
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.STORAGE_ROOT = storage;
  process.env.PUBLIC_URL = "http://127.0.0.1:5092";
  process.env.CRM_ALLOWED_ORIGINS = "http://127.0.0.1:5091";
  process.env.CRM_ALLOW_LOCAL = "true";
  for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"])
    process.env[key] = "";
  const memory = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: process.env.MONGOMS_VERSION ?? "7.0.14" },
  });
  const db = await import("../src/db");
  await db.connectDatabase(memory.getUri("globalsite"));
  const app = (await import("../src/app")).createApp();
  const server = app.listen(5092, "127.0.0.1", () =>
    console.log(
      JSON.stringify({
        event: "j1_site_fixture_ready",
        url: process.env.PUBLIC_URL,
      }),
    ),
  );
  const stopWorker = (
    await import("../src/background/runtime")
  ).startBackgroundJobs();
  const stop = async () => {
    await stopWorker();
    await new Promise<void>((r) => server.close(() => r()));
    await (await import("mongoose")).default.disconnect();
    await memory.stop();
    if (!storage.startsWith(join(tmpdir(), "globalsite-j1-")))
      throw Error("Unsafe cleanup");
    await rm(storage, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
void main().catch(() => {
  console.error("J1 Site fixture failed");
  process.exit(1);
});
