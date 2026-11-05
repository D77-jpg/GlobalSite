// Adapted from GlobalCRM server/src/services/storage.service.ts @ a94a285.
// Local tenant prefixes, quota reservation and strict path containment.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Asset } from "../models";
import { tenantContext } from "../models/tenant-context";
import { ensure } from "../errors";
import { config } from "../config";
import { reserve, settle, releaseStorage } from "./usage.service";
function location(key: string) {
  const org = tenantContext()?.organizationId;
  ensure(org, 403, "TENANT_REQUIRED");
  ensure(/^[a-f0-9-]{36}$/.test(key));
  const root = path.resolve(config.storage, org);
  const target = path.resolve(root, key);
  ensure(path.dirname(target) === root);
  return { root, target };
}
export function detectMime(body: Buffer) {
  if (
    body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (body[0] === 255 && body[1] === 216 && body[2] === 255)
    return "image/jpeg";
  return null;
}
export async function store(body: Buffer, mime: string) {
  ensure(body.length > 0 && body.length <= 10 * 1024 * 1024);
  ensure(detectMime(body) === mime, 400, "FILE_INVALID");
  const key = randomUUID();
  const { root, target } = location(key);
  await reserve("storage_bytes", body.length, key);
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(target, body, { flag: "wx" });
    const asset = await Asset.create({
      key,
      bytes: body.length,
      mime,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
    await settle("storage_bytes", key, body.length);
    return asset;
  } catch (e) {
    await fs.rm(target, { force: true });
    await settle("storage_bytes", key, 0);
    throw e;
  }
}
export async function readAsset(id: string) {
  const asset = await Asset.findById(id);
  ensure(asset, 404, "NOT_FOUND");
  return { asset, body: await fs.readFile(location(asset.key).target) };
}
export async function removeAsset(id: string) {
  const asset = await Asset.findOneAndUpdate(
    { _id: id, status: "ready" },
    { $set: { status: "deleting" } },
    { new: true },
  );
  ensure(asset, 404, "NOT_FOUND");
  await fs.rm(location(asset.key).target, { force: true });
  await releaseStorage(asset.bytes);
  await Asset.deleteOne({ _id: id });
}
