import http from "node:http";
import dns from "node:dns/promises";
import net from "node:net";
import { Readable } from "node:stream";
import { ensure } from "../errors";
import { publicUrl } from "./website/public-web";

const ENDPOINT_SUFFIXES = ["/chat/completions", "/images/generations"] as const;

export function localAiBase(): string | undefined {
  if (process.env.NODE_ENV === "production") return;
  try {
    const u = new URL(process.env.AI_LOCAL_BASE_URL ?? "");
    if (
      u.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "host.docker.internal"].includes(u.hostname) &&
      /^\/(?:[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)?$/.test(u.pathname) &&
      !u.pathname.split("/").includes("..") &&
      u.pathname !== "/" &&
      !u.search &&
      !u.hash &&
      !u.username &&
      !u.password
    )
      return u.href.replace(/\/+$/, "");
  } catch {
    /* Invalid optional configuration leaves AI disabled. */
  }
}

function allowedHosts(): Set<string> | null {
  const raw = (process.env.AI_ALLOWED_HOSTS ?? "").trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

export async function aiBase(value: string): Promise<URL> {
  const trimmed = value.trim().replace(/\/+$/, "");
  ensure(
    !trimmed.includes("..") && !/%(?:2e|2f|5c)/i.test(trimmed) && !trimmed.includes("\\"),
    400,
    "PROVIDER_URL_UNSUPPORTED",
  );
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    ensure(false, 400, "URL_UNSAFE");
  }
  const local = localAiBase();
  if (local && u.href.replace(/\/+$/, "") === local) {
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u;
  }
  const url = await publicUrl(trimmed);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  ensure(
    !net.isIP(host) &&
      host.includes(".") &&
      !/\.(?:local|localhost|internal|test|invalid|example|onion)$/i.test(host),
    400,
    "URL_UNSAFE",
  );
  const cleanPath = url.pathname.replace(/\/+$/, "");
  ensure(
    !url.search &&
      !url.hash &&
      cleanPath.length <= 200 &&
      /^\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(cleanPath) &&
      !cleanPath.split("/").includes(".."),
    400,
    "PROVIDER_URL_UNSUPPORTED",
  );
  const hosts = allowedHosts();
  if (hosts) ensure(hosts.has(host), 400, "PROVIDER_URL_UNSUPPORTED");
  url.pathname = cleanPath;
  return url;
}

export async function aiFetch(
  value: string,
  init: RequestInit,
): Promise<Response> {
  ensure(
    !value.includes("..") && !/%(?:2e|2f|5c)/i.test(value) && !value.includes("\\"),
    400,
    "PROVIDER_URL_UNSUPPORTED",
  );
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    ensure(false, 400, "PROVIDER_URL_UNSUPPORTED");
  }
  ensure(!target.search && !target.hash, 400, "PROVIDER_URL_UNSUPPORTED");
  const suffix = ENDPOINT_SUFFIXES.find((s) => target.pathname.endsWith(s));
  ensure(suffix, 400, "PROVIDER_URL_UNSUPPORTED");
  const base = new URL(target.href);
  base.pathname = target.pathname.slice(0, -suffix.length);
  await aiBase(base.href);
  if (target.protocol === "https:")
    return fetch(target.href, { ...init, redirect: "error" });
  const address = await dns.lookup(target.hostname.replace(/^\[|\]$/g, ""));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: address.address,
        family: address.family,
        port: target.port || 80,
        path: target.pathname,
        method: "POST",
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          Host: target.host,
        },
        signal: init.signal ?? undefined,
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers))
          if (v !== undefined)
            headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        resolve(
          new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
            status: res.statusCode ?? 502,
            headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(typeof init.body === "string" ? init.body : undefined);
  });
}
