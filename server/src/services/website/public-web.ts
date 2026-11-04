// Adapted from GlobalCRM server/src/services/website/public-web.ts @ a94a285.
// S2 only uses outbound target validation for AI providers; no website extraction yet.
import dns from "node:dns/promises";
import net from "node:net";
import { ensure } from "../../errors";
export function isPublicAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Restrict IPv6 to global unicast; reject mapped IPv4, loopback, ULA and link-local.
  return (
    net.isIPv6(address) &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !address.includes(".")
  );
}
export async function publicUrl(value: string) {
  const url = new URL(value);
  ensure(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.port === "" || url.port === "443"),
    400,
    "URL_UNSAFE",
  );
  const addresses = await dns.lookup(url.hostname, { all: true });
  ensure(
    addresses.length && addresses.every((x) => isPublicAddress(x.address)),
    400,
    "URL_UNSAFE",
  );
  return url;
}
