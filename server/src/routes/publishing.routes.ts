import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { requireRole } from "../middleware/auth.middleware";
import { objectId } from "../validators/catalog.validator";
import { SiteVersion, SiteDeployment } from "../models";
import { ownSite } from "../services/sites.service";
import * as p from "../services/publishing.service";
const r = Router(),
  edit = requireRole("admin", "editor"),
  admin = requireRole("admin");
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    void fn(req, res).catch(next);
const id = (req: Request) => objectId.parse(req.params.id),
  actor = (req: Request) => req.auth!.userId,
  ok = (res: Response, data: unknown, status = 200) =>
    res.status(status).json({ success: true, data });
r.get(
  "/sites/:id/publishing-settings",
  wrap(async (req, res) => ok(res, await p.settings(id(req)))),
);
r.put(
  "/sites/:id/publishing-settings",
  admin,
  wrap(async (req, res) =>
    ok(res, await p.saveSettings(id(req), req.body, actor(req))),
  ),
);
r.post(
  "/sites/:id/brand-palette",
  edit,
  wrap(async (req, res) => {
    p.empty.parse(req.body);
    ok(res, await p.palette(id(req)));
  }),
);
r.get(
  "/sites/:id/preflight",
  wrap(async (req, res) => ok(res, await p.preflight(id(req)))),
);
r.post(
  "/sites/:id/preflight/repair",
  edit,
  wrap(async (req, res) => {
    p.empty.parse(req.body);
    ok(res, await p.repair(id(req), actor(req)));
  }),
);
r.post(
  "/sites/:id/builds",
  edit,
  wrap(async (req, res) => {
    p.empty.parse(req.body);
    ok(
      res,
      await p.queueBuild(
        id(req),
        String(req.headers["idempotency-key"] ?? ""),
        actor(req),
      ),
      202,
    );
  }),
);
r.get(
  "/sites/:id/versions",
  wrap(async (req, res) => {
    await ownSite(id(req));
    ok(
      res,
      (
        await SiteVersion.find({ siteId: id(req) })
          .sort({ number: -1 })
          .limit(100)
      ).map(p.versionDto),
    );
  }),
);
r.get(
  "/site-versions/:id",
  wrap(async (req, res) => ok(res, p.versionDto(await p.ownVersion(id(req))))),
);
r.get(
  "/site-versions/:id/export",
  wrap(async (req, res) => {
    const body = await p.exportVersion(id(req));
    res
      .set({
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
        "Content-Disposition":
          'attachment; filename="site-' + id(req) + '.zip"',
      })
      .type("application/zip")
      .send(body);
  }),
);
r.get(
  "/site-versions/:id/preview/*",
  wrap(async (req, res) => {
    const file = await p.previewFile(id(req), String(req.params[0] ?? ""));
    res
      .set({
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
      })
      .type(file.mime)
      .send(file.body);
  }),
);
r.get(
  "/sites/:id/deployments",
  wrap(async (req, res) => {
    await ownSite(id(req));
    ok(
      res,
      (
        await SiteDeployment.find({ siteId: id(req) })
          .sort({ _id: -1 })
          .limit(100)
      ).map(p.deploymentDto),
    );
  }),
);
for (const kind of ["publish", "rollback"] as const)
  r.post(
    "/sites/:id/" + (kind === "publish" ? "deployments" : "rollback"),
    admin,
    wrap(async (req, res) => {
      const v = p.versionInput.parse(req.body);
      ok(
        res,
        await p.queueDeployment(
          id(req),
          v.versionId,
          String(req.headers["idempotency-key"] ?? ""),
          actor(req),
          kind,
        ),
        202,
      );
    }),
  );
r.post(
  "/sites/:id/domain-check",
  admin,
  wrap(async (req, res) => {
    p.empty.parse(req.body);
    ok(res, await p.domainCheck(id(req), actor(req)));
  }),
);
r.post(
  "/site-deployments/:id/reconcile",
  admin,
  wrap(async (req, res) => {
    p.empty.parse(req.body);
    ok(res, await p.reconcile(id(req), actor(req)));
  }),
);
export default r;
