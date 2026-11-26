#!/usr/bin/env node
// S37 §4.10: MongoDB + local storage volume restore helper.
// Requires explicit --confirm flag to prevent accidental overwrites.
// Usage:
//   node scripts/ops/restore.mjs --from /absolute/path/to/globalsite-backup-... [--dry-run | --confirm]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const confirm = args.includes("--confirm");
const fromIdx = args.indexOf("--from");
const backupDir = fromIdx >= 0 ? args[fromIdx + 1] : "";

if (!backupDir || !path.isAbsolute(backupDir) || (!dryRun && !confirm)) {
  console.error(
    "Usage: node scripts/ops/restore.mjs --from <absolute-backup-dir> (--dry-run | --confirm)",
  );
  process.exit(2);
}

const dumpArchive = path.join(backupDir, "globalsite-mongo.archive.gz");
const storageBackup = path.join(backupDir, "storage");
const storageRoot = path.resolve(process.env.STORAGE_ROOT || "storage");
const mongoUri =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27018/globalsite?directConnection=true";

if (!fs.existsSync(dumpArchive)) {
  console.error("Backup archive not found: " + dumpArchive);
  process.exit(1);
}

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        event: "restore_dry_run",
        dumpArchive,
        storageBackupExists: fs.existsSync(storageBackup),
        storageRoot,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const restore = spawnSync(
  "mongorestore",
  [
    "--uri",
    mongoUri,
    "--archive=" + dumpArchive,
    "--gzip",
    "--nsInclude=globalsite.*",
    "--drop",
  ],
  { stdio: "inherit" },
);
if (restore.status !== 0) {
  console.error("mongorestore failed with status " + restore.status);
  process.exit(restore.status ?? 1);
}
if (fs.existsSync(storageBackup)) {
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.cpSync(storageBackup, storageRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ event: "restore_completed", backupDir }));
