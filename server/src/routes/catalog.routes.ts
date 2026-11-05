import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import {
  Product,
  FactSheet,
  FactRevision,
  ProductImport,
  AgentRun,
  WebsiteRead,
  Asset,
  Task,
} from "../models";
import { requireRole } from "../middleware/auth.middleware";
import { AppError, ensure } from "../errors";
import * as v from "../validators/catalog.validator";
import {
  saveProduct,
  productDto,
  saveFact,
  factDto,
  transitionFact,
} from "../services/catalog.service";
import {
  prepareImport,
  remapImport,
  confirmImport,
  importDto,
  csv,
} from "../services/product-import.service";
import { queueExtraction, runDto } from "../services/catalog-run.service";
import {
  publicAsset,
  readAsset,
  store,
  removeAsset,
} from "../services/storage.service";
import { websiteUrl, WebsiteError } from "../services/website/public-web";
import mongoose from "mongoose";
const router = Router(),
  edit = requireRole("admin", "editor"),
  admin = requireRole("admin");
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });
const id = (req: Request) => v.objectId.parse(req.params.id);
async function owned(model: any, key: string) {
  const row = await model.findById(key);
  ensure(row, 404, "NOT_FOUND");
  return row;
}
async function listing(
  req: Request,
  res: Response,
  model: any,
  map: (r: any) => unknown,
  filter: any = {},
) {
  const q = v.listQuery.parse(req.query);
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await model
      .find(filter)
      .sort({ _id: -1 })
      .limit(q.limit + 1),
    items = rows.slice(0, q.limit);
  return ok(res, {
    items: items.map(map),
    hasMore: rows.length > q.limit,
    nextCursor: rows.length > q.limit ? String(items.at(-1)!._id) : null,
  });
}
router.get(
  "/products/imports",
  wrap((req, res) => listing(req, res, ProductImport, importDto)),
);
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 8192 },
});
router.post(
  "/products/imports",
  edit,
  importUpload.single("file"),
  wrap(async (req, res) => {
    ensure(req.file, 400, "FILE_INVALID");
    ok(
      res,
      await prepareImport(
        req.file.buffer,
        req.file.originalname,
        req.auth!.userId,
      ),
      201,
    );
  }),
);
router.get(
  "/products/imports/:id",
  wrap(async (req, res) =>
    ok(res, importDto(await owned(ProductImport, id(req)))),
  ),
);
router.patch(
  "/products/imports/:id",
  edit,
  wrap(async (req, res) => {
    await owned(ProductImport, id(req));
    const d = v.importMapBody.parse(req.body);
    ok(res, await remapImport(id(req), d.revision, d.mapping));
  }),
);
router.post(
  "/products/imports/:id/confirm",
  edit,
  wrap(async (req, res) => {
    await owned(ProductImport, id(req));
    const d = v.importConfirm.parse(req.body);
    ok(
      res,
      await confirmImport(id(req), d.revision, d.rows, req.auth!.userId),
      202,
    );
  }),
);
router.get(
  "/products/imports/:id/report.csv",
  wrap(async (req, res) => {
    const b = await owned(ProductImport, id(req));
    const rows: any[][] = [["row", "field", "error"]];
    for (const item of b.report.items)
      for (const e of item.errors) rows.push([item.row, e.field, e.code]);
    for (const r of b.results)
      if (r.status === "failed") rows.push([r.row, "", r.code]);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="import-report.csv"',
    );
    res.type("text/csv").send(csv(rows));
  }),
);
router.get(
  "/products",
  wrap(async (req, res) => {
    const q = v.listQuery.parse(req.query),
      filter: any = {};
    if (q.status) filter.status = q.status;
    if (q.category) filter.category = q.category;
    if (q.q) {
      const value = q.q.replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
      filter.$or = [
        { name: new RegExp(value, "i") },
        { sku: new RegExp(value, "i") },
      ];
    }
    return listing(req, res, Product, productDto, filter);
  }),
);
router.post(
  "/products",
  edit,
  wrap(async (req, res) =>
    ok(res, await saveProduct(req.body, req.auth!.userId), 201),
  ),
);
router.get(
  "/products/:id",
  wrap(async (req, res) => ok(res, productDto(await owned(Product, id(req))))),
);
router.patch(
  "/products/:id",
  edit,
  wrap(async (req, res) => {
    await owned(Product, id(req));
    const d = v.productPatch.parse(req.body);
    ok(res, await saveProduct(d.data, req.auth!.userId, id(req), d.revision));
  }),
);
router.get(
  "/assets",
  wrap((req, res) =>
    listing(req, res, Asset, publicAsset, {
      status: "ready",
      ...(req.query.kind ? { kind: v.listQuery.parse(req.query).kind } : {}),
    }),
  ),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, fieldSize: 1024 },
});
router.post(
  "/assets",
  edit,
  upload.single("file"),
  wrap(async (req, res) => {
    ensure(req.file, 400, "FILE_INVALID");
    const a = await store(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      req.body.kind,
    );
    ok(res, { id: String(a._id), bytes: a.bytes, mime: a.mime }, 201);
  }),
);
router.get(
  "/assets/:id/download",
  wrap(async (req, res) => {
    const { body, mime } = await readAsset(id(req));
    res.setHeader("Content-Disposition", 'attachment; filename="asset"');
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(mime).send(body);
  }),
);
router.get(
  "/assets/:id",
  wrap(async (req, res) => {
    const { body, mime } = await readAsset(
      id(req),
      typeof req.query.variant === "string" ? req.query.variant : undefined,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (mime === "application/pdf")
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="document.pdf"',
      );
    res.type(mime).send(body);
  }),
);
router.delete(
  "/assets/:id",
  edit,
  wrap(async (req, res) => {
    await removeAsset(id(req));
    ok(res, { deleted: true });
  }),
);
router.post(
  "/facts/extractions",
  edit,
  wrap(async (req, res) => {
    const d = v.extraction.parse(req.body);
    ok(res, await queueExtraction(d.kind, d.id, req.auth!.userId), 202);
  }),
);
router.get(
  "/facts/extractions/:id",
  wrap(async (req, res) => ok(res, runDto(await owned(AgentRun, id(req))))),
);
router.get(
  "/facts",
  wrap((req, res) => {
    const q = v.listQuery.parse(req.query);
    return listing(req, res, FactSheet, factDto, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
    });
  }),
);
router.post(
  "/facts",
  edit,
  wrap(async (req, res) =>
    ok(res, await saveFact(req.body, req.auth!.userId), 201),
  ),
);
router.patch(
  "/facts/:id",
  edit,
  wrap(async (req, res) => {
    await owned(FactSheet, id(req));
    const d = v.factPatch.parse(req.body);
    ok(res, await saveFact(d.data, req.auth!.userId, id(req), d.revision));
  }),
);
for (const [action, status] of [
  ["confirm", "confirmed"],
  ["reject", "rejected"],
] as const)
  router.post(
    "/facts/:id/" + action,
    admin,
    wrap(async (req, res) => {
      await owned(FactSheet, id(req));
      const d = v.transition.parse(req.body);
      ok(
        res,
        await transitionFact(
          id(req),
          d.revision,
          status,
          req.auth!.userId,
          d.reason,
        ),
      );
    }),
  );
router.get(
  "/facts/:id/history",
  wrap(async (req, res) => {
    await owned(FactSheet, id(req));
    return listing(
      req,
      res,
      FactRevision,
      (r) => ({
        id: String(r._id),
        factId: String(r.factId),
        revision: r.revision,
        action: r.action,
        actorId: String(r.actorId),
        before: r.before ?? null,
        after: r.after,
        createdAt: r.createdAt,
      }),
      { factId: id(req) },
    );
  }),
);
router.get(
  "/website-reads",
  wrap((req, res) => listing(req, res, WebsiteRead, runDto)),
);
router.post(
  "/website-reads",
  edit,
  wrap(async (req, res) => {
    const d = v.websiteInput.parse(req.body);
    let url: URL;
    try {
      url = websiteUrl(d.url);
    } catch (e) {
      if (e instanceof WebsiteError) throw new AppError(400, "URL_UNSAFE");
      throw e;
    }
    let run: any;
    await mongoose.connection.transaction(async (session) => {
      [run] = await WebsiteRead.create(
        [{ url: url.href, maxPages: d.maxPages, actorId: req.auth!.userId }],
        { session },
      );
      await Task.create(
        [
          {
            kind: "catalog.website",
            operationId: "website:" + run._id,
            payload: { runId: String(run._id) } as any,
          },
        ],
        { session },
      );
    });
    ok(res, runDto(run), 202);
  }),
);
router.get(
  "/website-reads/:id",
  wrap(async (req, res) => ok(res, runDto(await owned(WebsiteRead, id(req))))),
);
router.get(
  "/website-reads/:id/migration.csv",
  wrap(async (req, res) => {
    const run = await owned(WebsiteRead, id(req));
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="migration-urls.csv"',
    );
    res
      .type("text/csv")
      .send(
        csv([
          ["oldUrl", "title", "status"],
          ...run.pages.map((p: any) => [p.url, p.title, p.status]),
        ]),
      );
  }),
);
export default router;
