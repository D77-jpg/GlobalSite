// HTTP-only Integration API consumer. No GlobalCRM imports or database access.
// Authority: GlobalCRM integration-v1.openapi.yaml @4e4cca4 (C1-C3).
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import { config } from "../config";
import { publicIpv4 } from "./website/public-web";
import { crmProductShape } from "./crm-product-mapping";
export class CrmError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
    readonly retryAfterMs = 0,
  ) {
    super(code);
  }
}
export const crmNetwork = { lookup };
export function crmBase(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new CrmError("CRM_TARGET_UNSAFE", 400);
  }
  const origins = config.crmAllowedOrigins
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origins.length) throw new CrmError("CRM_TARGET_UNCONFIGURED", 400);
  const local =
    config.env !== "production" &&
    config.crmAllowLocal &&
    ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (
    !origins.includes(u.origin) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    (!local && (u.protocol !== "https:" || !!u.port)) ||
    !["http:", "https:"].includes(u.protocol)
  )
    throw new CrmError("CRM_TARGET_UNSAFE", 400);
  return u.origin;
}
export async function crmHttp(input: {
  baseUrl: string;
  token: string;
  projectId: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  key?: string;
  binary?: boolean;
  maxBytes?: number;
}) {
  const base = crmBase(input.baseUrl),
    url = new URL(input.path, base);
  if (
    url.origin !== base ||
    !url.pathname.startsWith("/api/integrations/v1/") ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new CrmError("CRM_TARGET_UNSAFE", 400);
  const local =
    config.env !== "production" &&
    config.crmAllowLocal &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  let addresses: Awaited<ReturnType<typeof lookup>>;
  try {
    addresses = (await crmNetwork.lookup(url.hostname.replace(/^\[|\]$/g, ""), {
      all: true,
      family: 4,
    })) as any;
  } catch {
    throw new CrmError("CRM_UNAVAILABLE");
  }
  const rows = addresses as unknown as { address: string; family: number }[];
  if (
    !rows.length ||
    rows.some((a) =>
      local
        ? !["127.0.0.1", "::1"].includes(a.address)
        : !publicIpv4(a.address),
    )
  )
    throw new CrmError("CRM_TARGET_UNSAFE", 400);
  const chosen = rows[0],
    body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const reply = await new Promise<{
    status: number;
    headers: Record<string, unknown>;
    body: Buffer;
  }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: input.method ?? "GET",
        agent: false,
        lookup: ((_h: any, o: any, cb: any) =>
          o?.all
            ? cb(null, [chosen])
            : cb(null, chosen.address, chosen.family)) as any,
        headers: {
          Authorization: "Bearer " + input.token,
          "X-Project-Id": input.projectId,
          Accept: input.binary
            ? "application/octet-stream"
            : "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
          ...(input.key ? { "Idempotency-Key": input.key } : {}),
        },
      },
      (res) => {
        const max = input.maxBytes ?? (input.binary ? 10485760 : 2097152);
        let size = 0;
        const chunks: Buffer[] = [];
        if (Number(res.headers["content-length"] ?? 0) > max) {
          res.destroy();
          reject(new CrmError("CRM_CONTRACT_MISMATCH", 409));
          return;
        }
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > max) {
            res.destroy();
            reject(new CrmError("CRM_CONTRACT_MISMATCH", 409));
          } else chunks.push(Buffer.from(chunk));
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 500,
            headers: res.headers as any,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", () => reject(new CrmError("CRM_UNAVAILABLE")));
      },
    );
    const deadline = setTimeout(() => req.destroy(Error()), 15000);
    req.once("close", () => clearTimeout(deadline));
    req.on("error", () => reject(new CrmError("CRM_UNAVAILABLE")));
    if (body) req.write(body);
    req.end();
  });
  if (reply.status >= 300) {
    if ([400, 422].includes(reply.status) && url.searchParams.has("cursor")) {
      try {
        const e = JSON.parse(reply.body.toString("utf8"));
        if (
          e?.error?.code === "VALIDATION_ERROR" &&
          e.error.details?.some((d: any) => d.field === "query.cursor")
        )
          throw new CrmError("CRM_CURSOR_INVALID", 409);
      } catch (e) {
        if (e instanceof CrmError) throw e;
      }
    }

    const codes: Record<number, string> = {
      401: "CRM_UNAUTHORIZED",
      403: "CRM_SCOPE_MISSING",
      404: "CRM_NOT_FOUND",
      409: "CRM_CONFLICT",
      422: "CRM_VALIDATION_REJECTED",
      429: "CRM_RATE_LIMITED",
    };
    let retry = 0;
    if (reply.status === 429) {
      const raw = String(reply.headers["retry-after"] ?? "60"),
        seconds = Number(raw);
      retry = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(raw) - Date.now();
      retry = Math.min(86400000, Math.max(1000, retry || 60000));
    }
    throw new CrmError(
      reply.status >= 500
        ? "CRM_UNAVAILABLE"
        : reply.status >= 300 && reply.status < 400
          ? "CRM_TARGET_UNSAFE"
          : (codes[reply.status] ?? "CRM_VALIDATION_REJECTED"),
      reply.status,
      retry,
    );
  }
  if (input.binary) return reply.body;
  if (!String(reply.headers["content-type"] ?? "").includes("application/json"))
    throw new CrmError("CRM_CONTRACT_MISMATCH", 409);
  try {
    return JSON.parse(reply.body.toString("utf8"));
  } catch {
    throw new CrmError("CRM_CONTRACT_MISMATCH", 409);
  }
}
const id = z.string().regex(/^[a-f0-9]{24}$/),
  date = z.string().datetime(),
  text = z.string(),
  nullable = text.nullable();
export const healthShape = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        ok: z.boolean(),
        contractVersion: z.literal("1.0"),
        serverTime: date,
        projectId: id,
        projectName: text.nullable().optional(),
        scopes: z.array(text),
        credentialId: text.nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();
const company = z
  .object({
    id,
    name: text,
    website: nullable,
    industry: nullable,
    address: nullable,
    phone: nullable,
    email: nullable,
    foundedYear: z.number().int().nullable(),
    capacity: nullable,
    certifications: z.array(text),
    updatedAt: date,
  })
  .strict();
const playbook = z
  .object({
    id,
    brandPositioning: nullable,
    sellingPoints: z.array(text),
    targetMarkets: z.array(text),
    updatedAt: date,
  })
  .strict();
const knowledge = z
  .object({
    id,
    title: text,
    summary: text,
    updatedAt: date,
    deleted: z.boolean(),
  })
  .strict();
const outcome = z
  .object({
    eventId: text,
    cursor: text,
    customerId: text,
    externalId: nullable.optional(),
    fromStatus: nullable.optional(),
    toStatus: z.enum(["won", "lost"]),
    occurredAt: date,
  })
  .passthrough();
export const feedShapes: Record<string, z.ZodType> = Object.fromEntries(
  Object.entries({
    products: crmProductShape,
    company,
    playbook,
    knowledge,
  }).map(([k, item]) => [
    k,
    z
      .object({
        success: z.literal(true),
        data: z
          .object({
            items: z.array(item),
            nextCursor: nullable,
            hasMore: z.boolean(),
            syncUntil: date,
          })
          .strict(),
      })
      .strict(),
  ]),
);
export const outcomesShape = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        items: z.array(outcome),
        nextCursor: nullable.optional(),
        hasMore: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();
export const inquiryResultShape = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        inquiryId: id,
        customerId: id,
        prospectId: z.null(),
        customerUrl: z.string().regex(/^\/customers\/[a-f0-9]{24}$/),
        projectId: id,
        action: z.enum(["created", "linked"]),
        attachmentStatus: z.enum(["pending", "none"]),
        sourceSystem: z.literal("globalsite"),
      })
      .strict(),
  })
  .strict();
export function checked<T>(shape: z.ZodType<T>, raw: unknown): T {
  const r = shape.safeParse(raw);
  if (!r.success) throw new CrmError("CRM_CONTRACT_MISMATCH", 409);
  return r.data;
}
