// Adapted from GlobalCRM server/src/services/credential-crypto.ts @ a94a285.
// Independent key, version and authenticated purpose/tenant binding. No JWT fallback.
import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
let cached: Buffer | undefined;
function key() {
  if (cached) return cached;
  if (config.encryptionKey) {
    const k = Buffer.from(config.encryptionKey, "base64");
    if (k.length !== 32) throw new Error("INVALID_ENCRYPTION_KEY");
    return (cached = k);
  }
  if (config.env === "production") throw new Error("ENCRYPTION_KEY_REQUIRED");
  fs.mkdirSync(config.storage, { recursive: true });
  const filename = path.join(config.storage, ".local-key");
  try {
    fs.writeFileSync(filename, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const k = fs.readFileSync(filename);
  if (k.length !== 32) throw new Error("INVALID_LOCAL_KEY");
  return (cached = k);
}
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: 1;
}
export function encrypt(value: string, purpose: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  return {
    ciphertext: Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]).toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}
export function decrypt(value: EncryptedSecret, purpose: string) {
  if (value.keyVersion !== 1) throw new Error("UNKNOWN_KEY_VERSION");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(value.iv, "base64"),
  );
  cipher.setAAD(Buffer.from(purpose));
  cipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(value.ciphertext, "base64")),
    cipher.final(),
  ]).toString("utf8");
}

export function otpHash(value: string, organizationId: string) {
  return createHmac("sha256", key())
    .update("otp:" + organizationId + ":" + value)
    .digest("hex");
}
