import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { requireRole } from "../middleware/auth.middleware";
import { objectId } from "../validators/catalog.validator";
import { ensure } from "../errors";
import * as inquiries from "../services/inquiry.service";
import * as settings from "../services/inquiry-settings.service";
import { retryNotifications } from "../services/inquiry-worker.service";
const r = Router(),
  edit = requireRole("admin", "editor"),
  admin = requireRole("admin");
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    void fn(req, res).catch(next);
r.use((req, res, next) => {
  if (/^\/(inquiries(?:\/|$)|sites\/[^/]+\/inquiry-settings)/.test(req.path))
    res.set("Cache-Control", "private, no-store");
  next();
});
const id = (req: Request) => objectId.parse(req.params.id),
  actor = (req: Request) => req.auth!.userId,
  ok = (res: Response, data: unknown, status = 200) =>
    res.status(status).json({ success: true, data });
r.get(
  "/sites/:id/inquiry-settings",
  wrap(async (req, res) => ok(res, await settings.inquirySettings(id(req)))),
);
r.put(
  "/sites/:id/inquiry-settings",
  admin,
  wrap(async (req, res) =>
    ok(res, await settings.saveInquirySettings(id(req), req.body, actor(req))),
  ),
);
r.get(
  "/inquiries",
  wrap(async (req, res) => ok(res, await inquiries.listInquiries(req.query))),
);
r.get(
  "/inquiries/export",
  wrap(async (req, res) => {
    res
      .set({
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'attachment; filename="inquiries.csv"',
      })
      .type("text/csv")
      .send(await inquiries.exportInquiries(req.query));
  }),
);
r.get(
  "/inquiries/:id",
  wrap(async (req, res) => ok(res, await inquiries.inquiryDetail(id(req)))),
);
r.patch(
  "/inquiries/:id",
  edit,
  wrap(async (req, res) =>
    ok(res, await inquiries.updateInquiry(id(req), req.body, actor(req))),
  ),
);
r.post(
  "/inquiries/:id/notes",
  edit,
  wrap(async (req, res) =>
    ok(
      res,
      await inquiries.updateInquiry(id(req), req.body, actor(req), true),
      201,
    ),
  ),
);
r.post(
  "/inquiries/:id/notifications/retry",
  edit,
  wrap(async (req, res) => {
    ensure(
      req.body && typeof req.body === "object" && !Object.keys(req.body).length,
    );
    ok(res, await retryNotifications(id(req), actor(req)), 202);
  }),
);
r.get(
  "/inquiries/:id/attachments/:attachmentId",
  wrap(async (req, res) => {
    const a = await inquiries.downloadAttachment(
      id(req),
      objectId.parse(req.params.attachmentId),
    );
    res
      .set({
        "Cache-Control": "private, no-store",
        "Content-Disposition":
          "attachment; filename=\"attachment\"; filename*=UTF-8''" +
          encodeURIComponent(a.fileName),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      })
      .type(a.mime)
      .send(a.body);
  }),
);
export default r;
