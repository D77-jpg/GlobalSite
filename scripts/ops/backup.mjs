#!/usr/bin/env node
// S37 §4.10: MongoDB + local storage volume backup helper.
// Safe by default: pass --dry-run to preview exact commands without touching disk.
// Usage:
//   node scripts/ops/backup.mjs --out /absolute/path/to/backups [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outIdx = args.indexOf("--out");
const outBase = outIdx >= 0 ? args[outIdx + 1] : "";

if (!outBase || !path.isAbsolute(outBase)) {
  console.error(
    "Usage: node scripts/ops/backup.mjs --out <absolute-backup-dir> [--dry-run]",
  );
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const targetDir = path.join(outBase, "globalsite-backup-" + stamp);
const mongoUri =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27018/globalsite?directConnection=true";
const storageRoot = path.resolve(process.env.STORAGE_ROOT || "storage");
const dumpArchive = path.join(targetDir, "globalsite-mongo.archive.gz");
const storageCopy = path.join(targetDir, "storage");

const plan = {
  dryRun,
  targetDir,
  mongoDatabase: "globalsite",
  dumpArchive,
  storageRoot,
  storageCopy,
};

if (dryRun) {
  console.log(JSON.stringify({ event: "backup_dry_run", ...plan }, null, 2));
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
const dump = spawnSync(
  "mongodump",
  ["--uri", mongoUri, "--db", "globalsite", "--archive=" + dumpArchive, "--gzip"],
  { stdio: "inherit" },
);
if (dump.status !== 0) {
  console.error("mongodump failed with status " + dump.status);
  process.exit(dump.status ?? 1);
}
if (fs.existsSync(storageRoot)) {
  fs.cpSync(storageRoot, storageCopy, { recursive: true });
}
fs.writeFileSync(
  path.join(targetDir, "manifest.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      database: "globalsite",
      hasStorage: fs.existsSync(storageCopy),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ event: "backup_completed", targetDir }));
