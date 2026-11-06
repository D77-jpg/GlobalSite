import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireRole } from "../middleware/auth.middleware";
import {
  CrmImportedResource,
  Product,
  AuditLog,
  FactSheet,
  FactRevision,
} from "../models";
import { ensure, AppError } from "../errors";
import { CrmError } from "../services/crm-client.service";
import {
  crmState,
  saveConnection,
  testConnection,
  currentConnection,
  disconnectConnection,
  queueSync,
} from "../services/crm-connection.service";
import {
  retryCrmDelivery,
  pushInquiryToCrm,
  readCrmAttachmentGrant,
} from "../services/crm-delivery.service";
import { saveProduct, factDto } from "../services/catalog.service";
import { assertFactsEditable } from "../services/publication-lock.service";
const r = Router(),
  admin = requireRole("admin"),
  id = z.string().regex(/^[a-f0-9]{24}$/),
  empty = z.object({}).strict();
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    void fn(req, res).catch((e) =>
      next(
        e instanceof CrmError
          ? new AppError(
              e.status === 503
                ? 503
                : e.status === 429
                  ? 429
                  : e.status === 409
                    ? 409
                    : 400,
              e.code,
            )
          : e,
      ),
    );
const ok = (res: Response, data: unknown, status = 200) =>
    res.status(status).json({ success: true, data }),
  actor = (req: Request) => req.auth!.userId;
r.use((req, res, next) => {
  if (req.path.startsWith("/crm") || /^\/inquiries\/[^/]+\/crm/.test(req.path))
    res.set("Cache-Control", "private, no-store");
  next();
});
r.get(
  "/crm/connection",
  admin,
  wrap(async (_req, res) => ok(res, await crmState())),
);
r.post(
  "/crm/connection",
  admin,
  wrap(async (req, res) =>
    ok(res, await saveConnection(req.body, actor(req)), 201),
  ),
);
r.post(
  "/crm/connection/test",
  admin,
  wrap(async (req, res) => {
    empty.parse(req.body);
    ok(res, await testConnection(actor(req)));
  }),
);
r.post(
  "/crm/connection/disconnect",
  admin,
  wrap(async (req, res) => {
    const d = z
        .object({ revision: z.number().int().min(1) })
        .strict()
        .parse(req.body),
      result = await disconnectConnection(d.revision, actor(req));
    ok(res, result, result.status === "disconnecting" ? 202 : 200);
  }),
);
r.post(
  "/crm/connection/sync",
  admin,
  wrap(async (req, res) => {
    const d = z.object({ full: z.boolean() }).strict().parse(req.body);
    ok(res, await queueSync(await currentConnection(), d.full), 202);
  }),
);
r.post(
  "/crm/deliveries/:id/retry",
  admin,
  wrap(async (req, res) => {
    empty.parse(req.body);
    ok(res, await retryCrmDelivery(id.parse(req.params.id), actor(req)), 202);
  }),
);
r.post(
  "/inquiries/:id/crm/retry",
  admin,
  wrap(async (req, res) => {
    empty.parse(req.body);
    ok(res, await pushInquiryToCrm(id.parse(req.params.id), actor(req)), 202);
  }),
);
r.get(
  "/crm/resources/:id",
  wrap(async (req, res) => {
    const row = await CrmImportedResource.findById(id.parse(req.params.id));
    ensure(row, 404, "NOT_FOUND");
    ok(res, {
      id: String(row._id),
      kind: row.kind,
      remoteId: row.remoteId,
      payload: row.payload,
      sha256: row.sha256,
      withdrawn: row.withdrawn,
      capturedAt: row.capturedAt.toISOString(),
    });
  }),
);
r.get(
  "/crm/sync-candidates",
  admin,
  wrap(async (req, res) => {
    const q = z
      .object({
        cursor: id.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .strict()
      .parse(req.query);
    const rows = await Product.find({
      source: "globalcrm",
      $or: [
        { syncCandidate: { $ne: null } },
        { crmSourceStatus: { $in: ["archived", "withdrawn"] } },
      ],
      ...(q.cursor ? { _id: { $lt: q.cursor } } : {}),
    })
      .sort({ _id: -1 })
      .limit(q.limit + 1);
    ok(res, {
      items: rows.slice(0, q.limit).map((p) => ({
        id: String(p._id),
        revision: p.revision,
        localName: p.name,
        remoteName: p.syncCandidate?.remoteName ?? null,
        candidateHash: p.syncCandidate?.hash ?? null,
        sourceStatus: p.crmSourceStatus ?? "active",
        data: p.syncCandidate?.data ?? null,
      })),
      hasMore: rows.length > q.limit,
      nextCursor: rows.length > q.limit ? String(rows[q.limit - 1]._id) : null,
    });
  }),
);
r.post(
  "/crm/sync-candidates/:id/review",
  admin,
  wrap(async (req, res) => {
    const key = id.parse(req.params.id),
      d = z
        .object({
          revision: z.number().int().min(1),
          candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
          decision: z.enum(["accept", "reject"]),
        })
        .strict()
        .parse(req.body);
    const p = await Product.findOne({
      _id: key,
      source: "globalcrm",
      revision: d.revision,
      "syncCandidate.hash": d.candidateHash,
    });
    ensure(p, 409, "REVISION_CONFLICT");
    if (d.decision === "accept")
      await saveProduct(
        p.syncCandidate.data,
        actor(req),
        key,
        d.revision,
        async (result, session) => {
          ensure(
            result.syncCandidate?.hash === d.candidateHash,
            409,
            "REVISION_CONFLICT",
          );
          const facts = await FactSheet.find({
            subjectId: result._id,
            "source.kind": "globalcrm",
            status: "confirmed",
          }).session(session);
          await assertFactsEditable(
            facts.map((f) => String(f._id)),
            session,
          );
          for (const f of facts) {
            const before = factDto(f);
            f.status = "candidate";
            f.revision++;
            f.reviewedBy = undefined;
            f.reviewedAt = undefined;
            await f.save({ session });
            await FactRevision.create(
              [
                {
                  factId: f._id,
                  revision: f.revision,
                  actorId: actor(req),
                  action: "source.changed",
                  before,
                  after: factDto(f),
                },
              ],
              { session },
            );
          }
          await Product.updateOne(
            { _id: result._id },
            { $unset: { syncCandidate: 1 } },
            { session },
          );
        },
      );
    else
      await mongoose.connection.transaction(async (session) => {
        const result = await Product.updateOne(
          {
            _id: key,
            revision: d.revision,
            "syncCandidate.hash": d.candidateHash,
          },
          { $unset: { syncCandidate: 1 }, $inc: { revision: 1 } },
          { session },
        );
        ensure(result.matchedCount === 1, 409, "REVISION_CONFLICT");
        await AuditLog.create(
          [
            {
              action: "crm.product.candidate.rejected",
              actorId: actor(req),
              targetId: key,
            },
          ],
          { session },
        );
      });
    ok(res, { reviewed: true });
  }),
);
export const crmAttachmentRouter = Router();
crmAttachmentRouter.get(
  "/:grant",
  wrap(async (req, res) => {
    const a = await readCrmAttachmentGrant(
      req.params.grant,
      req.ip ?? "unknown",
    );
    res
      .set({
        "Cache-Control": "private, no-store",
        "Content-Type": a.mime,
        "Content-Disposition":
          "attachment; filename=\"attachment\"; filename*=UTF-8''" +
          encodeURIComponent(a.fileName),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      })
      .send(a.body);
  }),
);
export default r;
