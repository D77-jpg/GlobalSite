import { authorizeActor } from "./catalog-authority";
import * as XLSX from "xlsx";
import { unzipSync, zipSync } from "fflate";
import mongoose from "mongoose";
import { Product, ProductImport, Task, AuditLog } from "../models";
import { ensure, AppError } from "../errors";
import { productInput, importMapping } from "../validators/catalog.validator";
import { pinAssets } from "./catalog.service";
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function csv(rows: unknown[][]) {
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
function parseWorkbook(buffer: Buffer, fileName: string) {
  ensure(
    buffer.length > 0 && buffer.length <= 5 * 1024 * 1024,
    413,
    "BODY_TOO_LARGE",
  );
  let input = buffer;
  if (/\.xlsx$/i.test(fileName)) {
    ensure(buffer[0] === 80 && buffer[1] === 75, 400, "FILE_INVALID");
    let total = 0,
      count = 0;
    const files = unzipSync(buffer, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        ensure(
          count <= 100 &&
            total <= 20 * 1024 * 1024 &&
            f.originalSize <= 10 * 1024 * 1024,
          413,
          "IMPORT_ZIP_LIMIT",
        );
        ensure(
          !/vbaProject|externalLinks|embeddings|\.\.\//i.test(f.name),
          400,
          "IMPORT_UNSAFE_WORKBOOK",
        );
        return true;
      },
    });
    ensure(files["xl/workbook.xml"], 400, "FILE_INVALID");
    input = Buffer.from(zipSync(files, { level: 0 }));
  } else
    ensure(
      /\.csv$/i.test(fileName) &&
        !buffer.includes(0) &&
        !buffer.toString("utf8", 0, 100).trimStart().startsWith("<"),
      400,
      "FILE_INVALID",
    );
  const book = XLSX.read(input, {
    type: "buffer",
    sheetRows: 502,
    cellFormula: true,
    bookVBA: false,
    raw: true,
  });
  const sheet = book.Sheets[book.SheetNames[0]];
  ensure(sheet?.["!ref"], 400, "IMPORT_EMPTY");
  const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]!);
  ensure(
    range.e.r - range.s.r <= 500 && range.e.c - range.s.c < 40,
    413,
    "IMPORT_ROW_LIMIT",
  );
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });
  ensure(rows.length >= 2, 400, "IMPORT_EMPTY");
  const headers = rows[0].map((v) => String(v).trim());
  ensure(
    headers.every((h) => h.length > 0 && h.length <= 120) &&
      new Set(headers).size === headers.length,
    400,
    "IMPORT_HEADERS_INVALID",
  );
  const output = rows
    .slice(1)
    .map((cells, i) => ({
      row: i + 2 + range.s.r,
      cells: Object.fromEntries(
        headers.map((h, j) => [h, String(cells[j] ?? "").slice(0, 8000)]),
      ),
      invalid: headers.filter((_h, j) => {
        const cell =
          sheet[
            XLSX.utils.encode_cell({ r: i + 1 + range.s.r, c: j + range.s.c })
          ];
        return (
          !!cell?.f ||
          cell?.t === "e" ||
          /^[=+@]/.test(String(cells[j] ?? "").trim())
        );
      }),
    }))
    .filter((r) => Object.values(r.cells).some((v) => String(v).trim()));
  ensure(
    Buffer.byteLength(JSON.stringify(output)) <= 3 * 1024 * 1024,
    413,
    "IMPORT_ROW_LIMIT",
  );
  return { headers, rows: output };
}
export function readWorkbook(buffer: Buffer, fileName: string) {
  try {
    return parseWorkbook(buffer, fileName);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "FILE_INVALID");
  }
}
export function suggestMapping(headers: string[]) {
  const result: Record<string, string> = {};
  const aliases: Record<string, string[]> = {
    name: ["name", "product name", "名称", "产品名称"],
    sku: ["sku", "型号", "产品编号"],
    category: ["category", "分类"],
    material: ["material", "材质"],
    application: ["application", "应用"],
    certifications: ["certifications", "认证"],
    moq: ["moq", "起订量"],
    leadTime: ["lead time", "交期"],
    description: ["description", "描述"],
    specs: ["specs", "规格"],
    specTable: ["spec table", "规格表"],
  };
  for (const [key, values] of Object.entries(aliases)) {
    const hit = headers.find((h) => values.includes(h.toLowerCase()));
    if (hit) result[key] = hit;
  }
  return result;
}
export async function buildReport(batch: any, mappingInput: unknown) {
  const mapping = importMapping.parse(mappingInput);
  ensure(
    Object.values(mapping).every((h) => batch.headers.includes(h)),
    400,
    "IMPORT_MAPPING_INVALID",
  );
  const seen = new Set<string>();
  const items: any[] = [];
  for (const row of batch.rows) {
    const data: any = {
      name: "",
      sku: "GS-" + String(batch._id).slice(-8).toUpperCase() + "-" + row.row,
      status: "draft",
      assetIds: [],
      specs: [],
      certifications: [],
    };
    const errors: { field: string; code: string }[] = [];
    for (const [field, header] of Object.entries(mapping)) {
      const text = String(row.cells[header] ?? "").trim();
      if (row.invalid.includes(header)) {
        errors.push({ field, code: "FORMULA_NOT_ALLOWED" });
        continue;
      }
      if (!text) continue;
      try {
        if (field === "certifications")
          data[field] = text
            .split(/[;|,；]/)
            .map((v) => v.trim())
            .filter(Boolean);
        else if (field === "specs") {
          const v = JSON.parse(text);
          data.specs = Array.isArray(v)
            ? v
            : Object.entries(v).map(([k, value], i) => ({
                code: "SPEC_" + (i + 1),
                name: k,
                value: String(value),
                unit: null,
              }));
        } else if (field === "specTable") data.specTable = JSON.parse(text);
        else data[field] = text;
      } catch {
        errors.push({ field, code: "INVALID_JSON" });
      }
    }
    const checked = productInput.safeParse(data);
    if (!checked.success)
      for (const issue of checked.error.issues)
        errors.push({ field: issue.path.join("."), code: "INVALID_FIELD" });
    const parsed = checked.success ? checked.data : undefined;
    if (parsed?.sku) {
      if (seen.has(parsed.sku))
        errors.push({ field: "sku", code: "DUPLICATE_SKU" });
      seen.add(parsed.sku);
    }
    items.push({ row: row.row, data: parsed, errors });
  }
  const existing = await Product.find({
    sku: { $in: items.filter((i) => i.data).map((i) => i.data.sku) },
  })
    .select("sku")
    .lean();
  const occupied = new Set(existing.map((p) => p.sku));
  for (const i of items)
    if (i.data && occupied.has(i.data.sku))
      i.errors.push({ field: "sku", code: "SKU_EXISTS" });
  return {
    total: items.length,
    valid: items.filter((i) => !i.errors.length).length,
    errorRows: items.filter((i) => i.errors.length).length,
    items,
  };
}
export function importDto(b: any) {
  return {
    id: String(b._id),
    fileName: b.fileName,
    errorCode: b.errorCode ?? null,
    headers: b.headers,
    mapping: b.mapping ?? {},
    report: b.report ?? {},
    status: b.status,
    revision: b.revision,
    results: b.results ?? [],
  };
}
export async function prepareImport(
  buffer: Buffer,
  fileName: string,
  actor: string,
) {
  const parsed = readWorkbook(buffer, fileName),
    mapping = suggestMapping(parsed.headers);
  const batch = new ProductImport({
    ...parsed,
    mapping,
    fileName: [...fileName]
      .map((c) => (c.charCodeAt(0) < 32 || c === "\\" || c === "/" ? "_" : c))
      .join("")
      .slice(0, 160),
    actorId: actor,
  });
  batch.report = await buildReport(batch, mapping);
  await batch.save();
  return importDto(batch);
}
export async function remapImport(
  id: string,
  revision: number,
  mapping: unknown,
) {
  const batch = await ProductImport.findOne({
    _id: id,
    revision,
    status: "preview",
  });
  ensure(batch, 409, "REVISION_CONFLICT");
  const report = await buildReport(batch, mapping);
  const updated = await ProductImport.findOneAndUpdate(
    { _id: id, revision, status: "preview" },
    {
      $set: { mapping: importMapping.parse(mapping), report },
      $inc: { revision: 1 },
    },
    { new: true },
  );
  ensure(updated, 409, "REVISION_CONFLICT");
  return importDto(updated);
}
export async function confirmImport(
  id: string,
  revision: number,
  selected: number[] | undefined,
  actor: string,
) {
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    const batch = await ProductImport.findById(id).session(session);
    ensure(batch, 404, "NOT_FOUND");
    const available = batch.report.items
      .filter((i: any) => !i.errors.length)
      .map((i: any) => i.row);
    const rows = [...new Set(selected ?? available)].sort(
      (a: any, b: any) => a - b,
    );
    ensure(
      rows.length && rows.every((r) => available.includes(r)),
      400,
      "IMPORT_SELECTION_INVALID",
    );
    if (batch.status !== "preview") {
      ensure(
        batch.confirmedRevision === revision &&
          JSON.stringify(batch.selectedRows) === JSON.stringify(rows),
        409,
        "CONFLICT",
      );
      result = batch;
      return;
    }
    ensure(batch.revision === revision, 409, "REVISION_CONFLICT");
    result = await ProductImport.findOneAndUpdate(
      { _id: id, revision, status: "preview" },
      {
        $set: {
          status: "queued",
          actorId: actor,
          selectedRows: rows,
          confirmedRevision: revision,
        },
        $inc: { revision: 1 },
      },
      { session, new: true },
    );
    ensure(result, 409, "REVISION_CONFLICT");
    await Task.create(
      [
        {
          kind: "catalog.import",
          operationId: "import:" + id,
          payload: { runId: id } as any,
        },
      ],
      { session },
    );
    await AuditLog.create(
      [{ action: "import.confirmed", actorId: actor, targetId: id }],
      { session },
    );
  });
  return importDto(result);
}
export async function fenceTask(task: any, session: mongoose.ClientSession) {
  const r = await Task.updateOne(
    {
      _id: task._id,
      owner: task.owner,
      fencingToken: task.fencingToken,
      status: "running",
      leaseUntil: { $gt: new Date() },
    },
    { $set: { leaseUntil: new Date(Date.now() + 60000) } },
    { session },
  );
  ensure(r.matchedCount === 1, 409, "LEASE_LOST");
}
export async function processImport(task: any) {
  const id = task.payload.runId;
  const batch = await ProductImport.findById(id);
  ensure(batch, 404, "NOT_FOUND");
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
    await authorizeActor(String(batch.actorId), session);
    await ProductImport.updateOne(
      { _id: id },
      { $set: { status: "running" } },
      { session },
    );
  });
  for (const row of batch.report.items.filter((i: any) =>
    batch.selectedRows.includes(i.row),
  )) {
    if (
      (await ProductImport.findById(id))!.results.some(
        (r: any) => r.row === row.row,
      )
    )
      continue;
    try {
      await mongoose.connection.transaction(async (session) => {
        await fenceTask(task, session);
        await authorizeActor(String(batch.actorId), session);
        const fresh = await ProductImport.findById(id).session(session);
        if (fresh.results.some((r: any) => r.row === row.row)) return;
        await pinAssets(row.data.assetIds, session);
        const [p] = await Product.create(
          [
            {
              ...row.data,
              source: "local",
              importKey: id + ":" + row.row,
              provenance: { kind: "import", refId: id, row: row.row },
            },
          ],
          { session },
        );
        await ProductImport.updateOne(
          { _id: id },
          {
            $push: {
              results: {
                row: row.row,
                status: "imported",
                productId: String(p._id),
              },
            },
          },
          { session },
        );
        await AuditLog.create(
          [
            {
              action: "product.imported",
              actorId: batch.actorId,
              targetId: String(p._id),
            },
          ],
          { session },
        );
      });
    } catch (e) {
      if ((e as any)?.code !== 11000) throw e;
      await mongoose.connection.transaction(async (session) => {
        await fenceTask(task, session);
        await ProductImport.updateOne(
          { _id: id },
          {
            $push: {
              results: { row: row.row, status: "failed", code: "SKU_EXISTS" },
            },
          },
          { session },
        );
      });
    }
  }
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
    await ProductImport.updateOne(
      { _id: id },
      { $set: { status: "complete" } },
      { session },
    );
  });
}
