// Adapted from GlobalCRM storage.service.ts @ a94a285; independent tenant storage.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import mongoose from "mongoose";
import sharp from "sharp";
import { Asset, Product, FactSheet, AgentRun, UsageBucket } from "../models";
import { tenantContext } from "../models/tenant-context";
import { ensure, AppError } from "../errors";
import { config } from "../config";
import { reserve, settle } from "./usage.service";
function location(key: string) {
  const org = tenantContext()?.organizationId;
  ensure(org, 403, "TENANT_REQUIRED");
  ensure(/^[a-f0-9-]{36}$/.test(key));
  const root = path.resolve(config.storage, org),
    target = path.resolve(root, key);
  ensure(path.dirname(target) === root);
  return { root, target };
}
export function detectMime(b: Buffer) {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (b.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}
export async function store(
  body: Buffer,
  mime: string,
  fileName = "asset",
  kind?: string,
) {
  ensure(
    body.length > 0 && body.length <= 10 * 1024 * 1024,
    413,
    "BODY_TOO_LARGE",
  );
  ensure(detectMime(body) === mime, 400, "FILE_INVALID");
  ensure(!kind || ["image", "document", "certificate"].includes(kind));
  const parts: { key: string; body: Buffer; mime: string; name: string }[] = [];
  let width: number | undefined, height: number | undefined;
  if (mime.startsWith("image/")) {
    try {
      const image = sharp(body, {
          limitInputPixels: 20_000_000,
          failOn: "error",
        }),
        m = await image.metadata();
      ensure(m.width && m.height && (m.pages ?? 1) === 1, 400, "FILE_INVALID");
      const format =
        mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpeg" : "webp";
      const canonical = await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toFormat(format)
        .toBuffer({ resolveWithObject: true });
      width = canonical.info.width;
      height = canonical.info.height;
      parts.push({
        key: randomUUID(),
        body: canonical.data,
        mime,
        name: "original",
      });
      for (const [name, size] of [
        ["thumb", 320],
        ["webp", 1600],
      ] as const)
        parts.push({
          key: randomUUID(),
          body: await sharp(canonical.data)
            .resize({
              width: size,
              height: size,
              fit: "inside",
              withoutEnlargement: true,
            })
            .webp({ quality: 82 })
            .toBuffer(),
          mime: "image/webp",
          name,
        });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(400, "FILE_INVALID");
    }
  } else parts.push({ key: randomUUID(), body, mime, name: "original" });
  ensure(
    parts.every((p) => p.body.length <= 10 * 1024 * 1024),
    413,
    "BODY_TOO_LARGE",
  );
  const original = parts[0],
    total = parts.reduce((n, p) => n + p.body.length, 0),
    op = original.key;
  await reserve("storage_bytes", total, op);
  let asset: any;
  try {
    for (const p of parts) {
      const l = location(p.key);
      await fs.mkdir(l.root, { recursive: true });
      await fs.writeFile(l.target, p.body, { flag: "wx" });
    }
    asset = await Asset.create({
      key: original.key,
      bytes: original.body.length,
      totalBytes: total,
      mime,
      sha256: createHash("sha256").update(original.body).digest("hex"),
      fileName: [...fileName]
        .map((c) => (c.charCodeAt(0) < 32 || c === "\\" || c === "/" ? "_" : c))
        .join("")
        .slice(0, 160),
      kind: kind ?? (mime.startsWith("image/") ? "image" : "document"),
      width,
      height,
      variants: Object.fromEntries(
        parts
          .slice(1)
          .map((p) => [
            p.name,
            { key: p.key, bytes: p.body.length, mime: p.mime },
          ]),
      ),
    });
    await settle("storage_bytes", op, total);
    return asset;
  } catch (e) {
    if (asset) await Asset.deleteOne({ _id: asset._id });
    for (const p of parts) await fs.rm(location(p.key).target, { force: true });
    await settle("storage_bytes", op, 0);
    throw e;
  }
}
export function publicAsset(a: any) {
  return {
    id: String(a._id),
    fileName: a.fileName ?? "asset",
    kind: a.kind ?? "image",
    mime: a.mime,
    bytes: a.bytes,
    totalBytes: a.totalBytes ?? a.bytes,
    sha256: a.sha256,
    width: a.width ?? null,
    height: a.height ?? null,
    createdAt: a.createdAt,
    url: "/api/v1/assets/" + a._id,
    thumbnailUrl: a.variants?.thumb
      ? "/api/v1/assets/" + a._id + "?variant=thumb"
      : null,
    webpUrl: a.variants?.webp
      ? "/api/v1/assets/" + a._id + "?variant=webp"
      : null,
  };
}
export async function readAsset(id: string, variant?: string) {
  const asset = await Asset.findOne({ _id: id, status: "ready" });
  ensure(asset, 404, "NOT_FOUND");
  ensure(!variant || ["thumb", "webp"].includes(variant));
  const part = variant ? asset.variants?.[variant] : undefined;
  ensure(!variant || part, 404, "NOT_FOUND");
  const target = location(part?.key ?? asset.key).target,
    stat = await fs.lstat(target);
  ensure(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 10 * 1024 * 1024,
    404,
    "NOT_FOUND",
  );
  return {
    asset,
    body: await fs.readFile(target),
    mime: part?.mime ?? asset.mime,
  };
}
export async function removeAsset(id: string) {
  let asset: any;
  await mongoose.connection.transaction(async (session) => {
    asset = await Asset.findOne({
      _id: id,
      status: { $in: ["ready", "deleting"] },
    }).session(session);
    ensure(asset, 404, "NOT_FOUND");
    ensure(
      !(await Product.exists({ assetIds: id }).session(session)) &&
        !(await FactSheet.exists({
          "source.kind": "asset",
          "source.refId": id,
          status: { $in: ["candidate", "confirmed"] },
        }).session(session)) &&
        !(await AgentRun.exists({
          "source.kind": "asset",
          "source.id": id,
          status: { $in: ["queued", "running"] },
        }).session(session)),
      409,
      "ASSET_IN_USE",
    );
    await Asset.updateOne(
      { _id: id },
      { $set: { status: "deleting" } },
      { session },
    );
  });
  for (const key of [
    asset.key,
    ...Object.values(asset.variants ?? {}).map((v: any) => v.key),
  ])
    await fs.rm(location(key).target, { force: true });
  await mongoose.connection.transaction(async (session) => {
    const row = await Asset.findOne({ _id: id, status: "deleting" }).session(
      session,
    );
    if (!row) return;
    const total = row.totalBytes ?? row.bytes;
    const updated = await UsageBucket.updateOne(
      {
        metric: "storage_bytes",
        period: "lifetime",
        consumed: { $gte: total },
      },
      { $inc: { consumed: -total } },
      { session },
    );
    ensure(updated.modifiedCount === 1, 409, "STORAGE_ACCOUNTING_CONFLICT");
    await Asset.deleteOne({ _id: id, status: "deleting" }, { session });
  });
}
