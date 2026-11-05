import { createHash } from "node:crypto";
import path from "node:path";
import { blake3 } from "@noble/hashes/blake3";
import { ensure, AppError } from "../errors";
import type { Files } from "./static-builder.service";
import { fetchWebsite } from "./website/public-web";
export const mime = (n: string) =>
  n.endsWith(".html")
    ? "text/html; charset=utf-8"
    : n.endsWith(".css")
      ? "text/css; charset=utf-8"
      : n.endsWith(".webp")
        ? "image/webp"
        : n.endsWith(".json")
          ? "application/json"
          : n.endsWith(".xml")
            ? "application/xml"
            : "text/plain; charset=utf-8";
export async function cfRequest(
  token: string,
  route: string,
  method = "GET",
  body?: BodyInit,
) {
  let r: Response;
  try {
    r = await fetch("https://api.cloudflare.com/client/v4" + route, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        ...(typeof body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(502, "CLOUDFLARE_UNAVAILABLE");
  }
  ensure(
    r.ok,
    502,
    r.status >= 400 && r.status < 500
      ? "CLOUDFLARE_DENIED"
      : "CLOUDFLARE_UNAVAILABLE",
  );
  const text = await r.text();
  ensure(text.length <= 2 * 1024 * 1024, 502, "CLOUDFLARE_RESPONSE_INVALID");
  let d: any;
  try {
    d = JSON.parse(text);
  } catch {
    throw new AppError(502, "CLOUDFLARE_RESPONSE_INVALID");
  }
  ensure(d.success === true, 502, "CLOUDFLARE_REJECTED");
  return d.result;
}
export const projectPath = (s: any) =>
  "/accounts/" + s.accountId + "/pages/projects/" + s.projectName;
export function assetHash(n: string, b: Uint8Array) {
  return Buffer.from(
    blake3(
      Buffer.from(Buffer.from(b).toString("base64") + path.extname(n).slice(1)),
    ),
  )
    .toString("hex")
    .slice(0, 32);
}
export async function uploadFiles(s: any, token: string, files: Files) {
  const project = await cfRequest(token, projectPath(s));
  ensure(
    project.production_branch === s.productionBranch && !project.source,
    409,
    "DIRECT_UPLOAD_REQUIRED",
  );
  const jwt = (await cfRequest(token, projectPath(s) + "/upload-token")).jwt;
  ensure(
    typeof jwt === "string" && jwt.length > 0,
    502,
    "CLOUDFLARE_RESPONSE_INVALID",
  );
  const entries = Object.entries(files),
    manifest: Record<string, string> = {};
  for (const [name, b] of entries) manifest["/" + name] = assetHash(name, b);
  const hashes = [...new Set(Object.values(manifest))],
    missing = await cfRequest(
      jwt,
      "/pages/assets/check-missing",
      "POST",
      JSON.stringify({ hashes }),
    );
  ensure(
    Array.isArray(missing) && missing.every((h) => hashes.includes(h)),
    502,
    "CLOUDFLARE_RESPONSE_INVALID",
  );
  // Bounded sequential batches; each source file <=25MiB.
  let batch: any[] = [],
    bytes = 0;
  async function flush() {
    if (batch.length) {
      await cfRequest(
        jwt,
        "/pages/assets/upload",
        "POST",
        JSON.stringify(batch),
      );
      batch = [];
      bytes = 0;
    }
  }
  for (const [name, b] of entries) {
    const hash = manifest["/" + name];
    if (!missing.includes(hash)) continue;
    if (bytes + b.length > 30 * 1024 * 1024 || batch.length >= 100)
      await flush();
    batch.push({
      key: hash,
      value: Buffer.from(b).toString("base64"),
      metadata: { contentType: mime(name) },
      base64: true,
    });
    bytes += b.length;
  }
  await flush();
  await cfRequest(
    jwt,
    "/pages/assets/upsert-hashes",
    "POST",
    JSON.stringify({ hashes }),
  );
  return manifest;
}
export async function submitDeployment(
  s: any,
  token: string,
  manifest: Record<string, string>,
  operation: string,
) {
  const form = new FormData();
  form.set("manifest", JSON.stringify(manifest));
  form.set("branch", s.productionBranch);
  form.set("commit_message", "GlobalSite " + operation);
  form.set("commit_dirty", "false");
  let d: any;
  try {
    d = await cfRequest(token, projectPath(s) + "/deployments", "POST", form);
  } catch (error) {
    if (
      error instanceof AppError &&
      ["CLOUDFLARE_DENIED", "CLOUDFLARE_REJECTED"].includes(error.code)
    )
      throw new AppError(502, "DEPLOYMENT_REJECTED");
    throw error;
  }
  ensure(
    typeof d.id === "string" &&
      /^[a-f0-9-]{36}$/.test(d.id) &&
      typeof d.url === "string",
    502,
    "CLOUDFLARE_RESPONSE_INVALID",
  );
  const u = new URL(d.url);
  ensure(
    u.protocol === "https:" &&
      u.hostname.endsWith("." + s.projectName + ".pages.dev") &&
      !u.username &&
      !u.password &&
      u.port === "",
    502,
    "CLOUDFLARE_RESPONSE_INVALID",
  );
  return { id: d.id, url: u.origin };
}
export async function verifyDeployment(
  s: any,
  token: string,
  providerId: string,
  files: Files,
) {
  const d = await cfRequest(
    token,
    projectPath(s) + "/deployments/" + providerId,
  );
  if (d.latest_stage?.status === "failure")
    throw new AppError(502, "CLOUDFLARE_BUILD_FAILED");
  if (d.latest_stage?.status !== "success") return false;
  const project = await cfRequest(token, projectPath(s));
  ensure(
    project.canonical_deployment?.id === providerId,
    409,
    "PRODUCTION_CHANGED",
  );
  for (const origin of [
    ...new Set([
      "https://" + s.projectName + ".pages.dev",
      ...(s.domain ? ["https://" + s.domain] : []),
    ]),
  ]) {
    for (const name of ["globalsite-manifest.json", "index.html"]) {
      const remote = await websiteReader.fetch(
        origin + "/" + name,
        name.endsWith(".html") ? "html" : "json",
      );
      ensure(
        remote.status === 200 &&
          new URL(remote.url).protocol === "https:" &&
          createHash("sha256").update(remote.text).digest("hex") ===
            createHash("sha256").update(files[name]).digest("hex"),
        502,
        "DEPLOYMENT_MISMATCH",
      );
    }
  }
  return true;
}

export const pagesClient = {
  uploadFiles,
  submitDeployment,
  verifyDeployment,
  request: cfRequest,
};

export const websiteReader = { fetch: fetchWebsite };
