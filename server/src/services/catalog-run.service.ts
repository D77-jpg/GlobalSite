import mongoose from "mongoose";
import sharp from "sharp";
import {
  AgentRun,
  Product,
  Asset,
  FactSheet,
  FactRevision,
  Task,
  AuditLog,
} from "../models";
import { authorizeActor } from "./catalog-authority";
import { readAsset } from "./storage.service";
import { productDto, factDto } from "./catalog.service";
import { fenceTask } from "./product-import.service";
import { extractEvidence, type ExtractionResult } from "./fact-ai.service";
import { settle } from "./usage.service";
import { ensure } from "../errors";
export function runDto(r: any) {
  return {
    id: String(r._id),
    status: r.status,
    errorCode: r.errorCode ?? null,
    resultIds: (r.resultIds ?? []).map(String),
    createdAt: r.createdAt,
    ...(r.kind
      ? {
          kind: r.kind,
          source: r.source,
          rejectedCount: r.rejectedCount ?? 0,
          tokens: r.tokens ?? 0,
        }
      : {}),
    ...(r.pages
      ? {
          url: r.url,
          maxPages: r.maxPages,
          pages: r.pages,
          factIds: (r.factIds ?? []).map(String),
          truncated: !!r.truncated,
        }
      : {}),
  };
}
export async function queueExtraction(
  kind: "product" | "asset",
  id: string,
  actorId: string,
) {
  let run: any;
  await mongoose.connection.transaction(async (session) => {
    const source =
      kind === "product"
        ? await Product.findOne({
            _id: id,
            status: { $ne: "archived" },
          }).session(session)
        : await Asset.findOne({ _id: id, status: "ready" }).session(session);
    ensure(source, 404, "NOT_FOUND");
    [run] = await AgentRun.create(
      [
        {
          kind: "facts.extract",
          actorId,
          source: {
            kind,
            id,
            revision: source.revision,
            sha256: source.sha256,
          },
        },
      ],
      { session },
    );
    if (kind === "asset")
      await Asset.updateOne(
        { _id: id, status: "ready" },
        { $inc: { referenceVersion: 1 } },
        { session },
      );
    await Task.create(
      [
        {
          kind: "catalog.extract",
          operationId: "extract:" + run._id,
          payload: { runId: String(run._id) } as any,
        },
      ],
      { session },
    );
    await AuditLog.create(
      [
        {
          action: "facts.extraction.queued",
          actorId,
          targetId: String(run._id),
        },
      ],
      { session },
    );
  });
  return runDto(run);
}
export async function processExtraction(
  task: any,
  extractor = extractEvidence,
) {
  let run = await AgentRun.findById(task.payload.runId);
  ensure(run, 404, "NOT_FOUND");
  if (run.status === "complete") return;
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
    await authorizeActor(String(run.actorId), session);
    await AgentRun.updateOne(
      { _id: run._id },
      { $set: { status: "running" } },
      { session },
    );
  });
  const source = run.source;
  let text = "",
    imageData: string | undefined;
  if (source.kind === "product") {
    const p = await Product.findOne({
      _id: source.id,
      status: { $ne: "archived" },
    });
    ensure(p && p.revision === source.revision, 409, "SOURCE_CHANGED");
    text = JSON.stringify(productDto(p)).slice(0, 24000);
  } else {
    const { asset, body } = await readAsset(source.id);
    ensure(asset.sha256 === source.sha256, 409, "SOURCE_CHANGED");
    if (asset.mime === "application/pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(body), verbosity: 0 });
      try {
        const info = await parser.getInfo();
        ensure(info.total <= 50, 400, "PDF_PAGE_LIMIT");
        text = (await parser.getText({ pageJoiner: "" })).text.slice(0, 24000);
        ensure(text.trim(), 400, "DOCUMENT_NO_TEXT");
      } finally {
        await parser.destroy();
      }
    } else {
      const image = await sharp(body)
        .resize({
          width: 768,
          height: 768,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 75 })
        .toBuffer();
      ensure(image.length <= 1024 * 1024, 413, "BODY_TOO_LARGE");
      imageData = "data:image/webp;base64," + image.toString("base64");
      text =
        "Uploaded image; any transcribed quote is machine-read and must be reviewed against the original image.";
    }
  }
  let result = run.pendingResult as ExtractionResult | undefined;
  if (!result) {
    result = await extractor(
      text,
      imageData,
      "extract:" + run._id,
      async (pending) => {
        await mongoose.connection.transaction(async (session) => {
          await fenceTask(task, session);
          await AgentRun.updateOne(
            { _id: run._id },
            { $set: { pendingResult: pending } },
            { session },
          );
        });
      },
    );
  } else await settle("ai_tokens", "extract:" + run._id, result.tokens);
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
    await authorizeActor(String(run.actorId), session);
    if (source.kind === "product")
      ensure(
        await Product.exists({
          _id: source.id,
          revision: source.revision,
          status: { $ne: "archived" },
        }).session(session),
        409,
        "SOURCE_CHANGED",
      );
    else
      ensure(
        await Asset.exists({
          _id: source.id,
          status: "ready",
          sha256: source.sha256,
        }).session(session),
        409,
        "SOURCE_CHANGED",
      );
    const ids: any[] = [];
    if (!result!.errorCode)
      for (const [itemIndex, item] of result!.items.entries()) {
        let fact = await FactSheet.findOne({
          originKey: "extract:" + run._id + ":" + itemIndex,
        }).session(session);
        if (!fact) {
          [fact] = await FactSheet.create(
            [
              {
                subjectType:
                  source.kind === "product" ? "product" : "organization",
                ...(source.kind === "product" ? { subjectId: source.id } : {}),
                ...item,
                status: "candidate",
                originKey: "extract:" + run._id + ":" + itemIndex,
                source: {
                  kind: source.kind,
                  refId: source.id,
                  quote: item.quote,
                  revision: source.revision,
                  sha256: source.sha256,
                  capturedAt: new Date().toISOString(),
                  textVerified: !imageData,
                },
              },
            ],
            { session },
          );
          await FactRevision.create(
            [
              {
                factId: fact._id,
                revision: 1,
                actorId: run.actorId,
                action: "ai.candidate",
                before: null,
                after: factDto(fact),
              },
            ],
            { session },
          );
        }
        ids.push(fact._id);
      }
    await AgentRun.updateOne(
      { _id: run._id },
      {
        $set: {
          status: result!.errorCode ? "failed" : "complete",
          errorCode: result!.errorCode ?? null,
          resultIds: ids,
          tokens: result!.tokens,
          rejectedCount: result!.rejectedCount,
        },
        $unset: { pendingResult: 1 },
      },
      { session },
    );
    await AuditLog.create(
      [
        {
          action: "facts.extraction.completed",
          actorId: run.actorId,
          targetId: String(run._id),
        },
      ],
      { session },
    );
  });
  run = await AgentRun.findById(run._id);
  return runDto(run);
}
