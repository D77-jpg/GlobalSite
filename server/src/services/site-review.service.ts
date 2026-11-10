import { settle } from "./usage.service";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
import sharp from "sharp";
import { config } from "../config";
import { ensure, AppError } from "../errors";
import { buildStatic } from "./static-builder.service";
import { storeArtifact, readArtifact, readAsset } from "./storage.service";
import { tenantContext } from "../models/tenant-context";
import type { Snapshot } from "./static-template.service";
export async function captureSitePage(
  snapshot: Snapshot,
  pagePath: string,
  operationKey?: string,
) {
  const organizationId = tenantContext()?.organizationId;
  ensure(organizationId, 403, "FORBIDDEN");
  const parent = path.resolve(
      config.storage,
      ".reviews",
      String(organizationId),
    ),
    root = path.join(parent, randomUUID());
  const key = operationKey ?? randomUUID();
  try {
    const body = await readArtifact(key);
    const files = unzipSync(body);
    ensure(files["report.json"], 409, "ARTIFACT_INVALID");
    const metrics = JSON.parse(
      Buffer.from(files["report.json"]).toString("utf8"),
    );
    await settle("storage_bytes", "artifact:" + key, body.length);
    return { artifactKey: key, metrics };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await fs.mkdir(root, { recursive: true });
  try {
    const built = await buildStatic(snapshot, undefined, "review");
    await fs.mkdir(path.join(root, "files"), { recursive: true });
    for (const [name, body] of Object.entries(built.files)) {
      ensure(!/(^\/|\\|\.\.)/.test(name), 409, "ARTIFACT_INVALID");
      const file = path.join(root, "files", name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body);
    }
    await fs.writeFile(
      path.join(root, "input.json"),
      JSON.stringify({ files: Object.keys(built.files), pagePath }),
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=384",
          path.resolve(__dirname, "../../builder/review.mjs"),
          root,
        ],
        {
          windowsHide: true,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: root,
            TMP: root,
            HOME: root,
            USERPROFILE: root,
            PLAYWRIGHT_BROWSERS_PATH:
              process.env.PLAYWRIGHT_BROWSERS_PATH ??
              path.dirname(
                path.dirname(path.dirname(chromium.executablePath())),
              ),
          },
          stdio: "ignore",
        },
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new AppError(409, "REVIEW_BROWSER_UNAVAILABLE"));
      }, 90000);
      child.on("error", () => {
        clearTimeout(timer);
        reject(new AppError(409, "REVIEW_BROWSER_UNAVAILABLE"));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new AppError(409, "REVIEW_BROWSER_UNAVAILABLE"));
      });
    });
    const report = JSON.parse(
      await fs.readFile(path.join(root, "report.json"), "utf8"),
    );
    const files: Record<string, Uint8Array> = {
      "report.json": Buffer.from(JSON.stringify(report)),
    };
    for (const width of [375, 768, 1440]) {
      const body = await fs.readFile(path.join(root, width + ".jpg"));
      ensure(body.length <= 8 * 1024 * 1024, 413, "ARTIFACT_TOO_LARGE");
      files[width + ".jpg"] = body;
    }
    const artifactKey = await storeArtifact(
      Buffer.from(zipSync(files, { mtime: new Date("2026-01-01T00:00:00Z") })),
      key,
    );
    return { artifactKey, metrics: report };
  } finally {
    ensure(path.dirname(root) === parent, 409, "ARTIFACT_INVALID");
    await fs.rm(root, { recursive: true, force: true });
  }
}
export async function reviewScreenshot(key: string, width: number) {
  ensure([375, 768, 1440].includes(width));
  const files = unzipSync(await readArtifact(key));
  const bytes = files[width + ".jpg"];
  ensure(bytes, 404, "NOT_FOUND");
  return Buffer.from(bytes);
}
export async function reviewImages(key: string) {
  const images = [];
  for (const width of [375, 1440]) {
    const body = await sharp(await reviewScreenshot(key, width))
      .resize({ width: 900, height: 3000, fit: "inside" })
      .jpeg({ quality: 65 })
      .toBuffer();
    ensure(body.length < 1024 * 1024, 413, "BODY_TOO_LARGE");
    images.push({
      label: width + "px screenshot",
      data: "data:image/jpeg;base64," + body.toString("base64"),
    });
  }
  return images;
}

export async function assetImages(ids: string[]) {
  const images = [];
  for (const id of [...new Set(ids)].slice(0, 4)) {
    const asset = await readAsset(id, "thumb");
    const body = await sharp(asset.body)
      .resize({ width: 480, height: 480, fit: "inside" })
      .jpeg({ quality: 65 })
      .toBuffer();
    images.push({
      label:
        "Selected product asset " +
        id +
        "; illustration is not business evidence",
      data: "data:image/jpeg;base64," + body.toString("base64"),
    });
  }
  return images;
}

// Measurements support a critique; they never claim subjective visual excellence.
export function measuredFindings(metrics: any[]) {
  const findings: {
    blockKey: string | null;
    code: "layout" | "repetition" | "imagery";
    severity: "warning" | "error";
    recommendation: string;
  }[] = [];
  if (metrics.some((m) => m.discoverySections > 1))
    findings.push({
      blockKey: null,
      code: "repetition",
      severity: "warning",
      recommendation:
        "Review repeated product/category discovery sections; keep one clear browsing decision instead of repeating the same range.",
    });
  if (metrics.some((m) => m.repeatedHeadings?.length))
    findings.push({
      blockKey: null,
      code: "repetition",
      severity: "warning",
      recommendation:
        "Repeated section headings reduce information hierarchy. Give each section a distinct buyer decision or merge it.",
    });
  for (const section of metrics.find((m) => m.width === 1440)?.sections ?? []) {
    if (section.height > 1800 && section.words < 100)
      findings.push({
        blockKey: section.id?.replace(/^block-/, "") || null,
        code: "layout",
        severity: "warning",
        recommendation:
          "This section is unusually tall for its information. Reduce media scale or choose a compact index/gallery frame, then inspect desktop and phone screenshots.",
      });
  }
  return findings.slice(0, 6);
}
