import http from "node:http";
import dns from "node:dns/promises";
import { Readable } from "node:stream";
import { ensure } from "../errors";
import { publicUrl } from "./website/public-web";
export function localAiBase(): string | undefined {
  if (process.env.NODE_ENV === "production") return;
  try {
    const u = new URL(process.env.AI_LOCAL_BASE_URL ?? "");
    if (
      u.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "host.docker.internal"].includes(u.hostname) &&
      u.pathname === "/v1" &&
      !u.search &&
      !u.hash &&
      !u.username &&
      !u.password
    )
      return u.href;
  } catch {
    /* Invalid optional configuration leaves AI disabled. */
  }
}
export async function aiBase(value: string): Promise<URL> {
  const u = new URL(value);
  if (localAiBase() && u.href === localAiBase()) return u;
  const url = await publicUrl(value);
  ensure(
    url.origin === "https://api.openai.com" &&
      url.pathname === "/v1" &&
      !url.search,
    400,
    "PROVIDER_URL_UNSUPPORTED",
  );
  return url;
}
export async function aiFetch(
  value: string,
  init: RequestInit,
): Promise<Response> {
  const target = new URL(value),
    base = new URL(value);
  base.pathname = "/v1";
  await aiBase(base.href);
  ensure(
    target.pathname === "/v1/chat/completions" &&
      !target.search &&
      !target.hash,
    400,
    "PROVIDER_URL_UNSUPPORTED",
  );
  if (target.protocol === "https:") return fetch(value, init);
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
