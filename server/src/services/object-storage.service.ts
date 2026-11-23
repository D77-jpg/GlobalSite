import { createHash, createHmac } from "node:crypto";
import { config } from "../config";
import { ensure, AppError } from "../errors";

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
};

const sha256Hex = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();

function encodePathSegment(segment: string) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function s3Config(): S3Config {
  ensure(
    config.s3Endpoint &&
      config.s3Bucket &&
      config.s3AccessKeyId &&
      config.s3SecretAccessKey,
    503,
    "STORAGE_MISCONFIGURED",
  );
  const url = new URL(config.s3Endpoint);
  ensure(
    (url.protocol === "https:" ||
      (config.env !== "production" && url.protocol === "http:")) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    503,
    "STORAGE_MISCONFIGURED",
  );
  return {
    endpoint: url.origin + url.pathname.replace(/\/+$/, ""),
    bucket: config.s3Bucket,
    region: config.s3Region || "auto",
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    prefix: config.s3Prefix,
  };
}

export function objectKey(orgId: string, key: string, prefix = config.s3Prefix) {
  ensure(/^[a-f0-9]{24}$/.test(orgId), 403, "TENANT_REQUIRED");
  ensure(/^[a-f0-9-]{36}$/.test(key), 400, "INVALID_PATH");
  return prefix ? `${prefix}/${orgId}/${key}` : `${orgId}/${key}`;
}

export function signS3Request(input: {
  method: "GET" | "PUT" | "DELETE";
  key: string;
  body?: Buffer;
  contentType?: string;
  cfg: S3Config;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const base = new URL(input.cfg.endpoint);
  const basePath = base.pathname.replace(/\/+$/, "");
  const encodedKey = input.key.split("/").map(encodePathSegment).join("/");
  const canonicalUri = `${basePath}/${encodePathSegment(input.cfg.bucket)}/${encodedKey}`;
  const payloadHash = sha256Hex(input.body ?? Buffer.alloc(0));
  const headers: Record<string, string> = {
    host: base.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (input.contentType) headers["content-type"] = input.contentType;
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join("");
  const signedHeaders = sortedNames.join(";");
  const canonicalRequest = [
    input.method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac("AWS4" + input.cfg.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, input.cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `${base.origin}${canonicalUri}`,
    headers: {
      ...headers,
      Authorization: authorization,
    },
  };
}

export const s3Transport = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
};

export async function s3Put(
  orgId: string,
  key: string,
  body: Buffer,
  contentType = "application/octet-stream",
) {
  const cfg = s3Config();
  const req = signS3Request({
    method: "PUT",
    key: objectKey(orgId, key, cfg.prefix),
    body,
    contentType,
    cfg,
  });
  let res: Response;
  try {
    res = await s3Transport.fetch(req.url, {
      method: "PUT",
      headers: req.headers,
      body: new Uint8Array(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new AppError(502, "STORAGE_UNAVAILABLE");
  }
  ensure(res.ok, 502, "STORAGE_UNAVAILABLE");
}

export async function s3Get(
  orgId: string,
  key: string,
  maxBytes: number,
): Promise<Buffer> {
  const cfg = s3Config();
  const req = signS3Request({
    method: "GET",
    key: objectKey(orgId, key, cfg.prefix),
    cfg,
  });
  let res: Response;
  try {
    res = await s3Transport.fetch(req.url, {
      method: "GET",
      headers: req.headers,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new AppError(502, "STORAGE_UNAVAILABLE");
  }
  ensure(res.status !== 404, 404, "NOT_FOUND");
  ensure(res.ok, 502, "STORAGE_UNAVAILABLE");
  const body = Buffer.from(await res.arrayBuffer());
  ensure(body.length <= maxBytes, 404, "NOT_FOUND");
  return body;
}

export async function s3Delete(orgId: string, key: string) {
  const cfg = s3Config();
  const req = signS3Request({
    method: "DELETE",
    key: objectKey(orgId, key, cfg.prefix),
    cfg,
  });
  let res: Response;
  try {
    res = await s3Transport.fetch(req.url, {
      method: "DELETE",
      headers: req.headers,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(502, "STORAGE_UNAVAILABLE");
  }
  ensure(res.ok || res.status === 404, 502, "STORAGE_UNAVAILABLE");
}
