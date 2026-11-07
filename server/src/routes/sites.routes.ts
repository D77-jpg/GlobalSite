import { ensure } from "../errors";
import { reviewScreenshot } from "../services/site-review.service";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Site, SitePage, AgentRun } from "../models";
import { requireRole } from "../middleware/auth.middleware";
import { objectId, listQuery } from "../validators/catalog.validator";
import * as v from "../validators/sites.validator";
import * as sites from "../services/sites.service";
import { buyerReadiness } from "../services/b2b-planning.service";
import * as agents from "../services/site-agents.service";
const r = Router(),
  edit = requireRole("admin", "editor"),
  admin = requireRole("admin");
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    void fn(req, res).catch(next);
const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });
const id = (req: Request) => objectId.parse(req.params.id),
  actor = (req: Request) => req.auth!.userId;
async function list(
  req: Request,
  res: Response,
  model: any,
  map: (r: any) => unknown,
  filter: any = {},
) {
  const q = listQuery.parse(req.query);
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await model
    .find(filter)
    .sort({ _id: -1 })
    .limit(q.limit + 1);
  return ok(res, {
    items: rows.slice(0, q.limit).map(map),
    hasMore: rows.length > q.limit,
    nextCursor: rows.length > q.limit ? String(rows[q.limit - 1]._id) : null,
  });
}
r.get(
  "/site-templates",
  wrap(async (_req, res) => ok(res, v.templates)),
);
r.get(
  "/sites",
  wrap((req, res) => list(req, res, Site, sites.siteDto)),
);
r.post(
  "/sites",
  edit,
  wrap(async (req, res) =>
    ok(res, await sites.saveSite(req.body, actor(req)), 201),
  ),
);
r.get(
  "/sites/:id",
  wrap(async (req, res) =>
    ok(res, sites.siteDto(await sites.ownSite(id(req)))),
  ),
);
r.patch(
  "/sites/:id",
  edit,
  wrap(async (req, res) => {
    await sites.ownSite(id(req));
    const d = v.sitePatch.parse(req.body);
    ok(res, await sites.saveSite(d.data, actor(req), id(req), d.revision));
  }),
);
r.put(
  "/sites/:id/plan",
  edit,
  wrap(async (req, res) =>
    ok(res, await sites.savePlan(id(req), req.body, actor(req))),
  ),
);
r.post(
  "/sites/:id/plan/confirm",
  admin,
  wrap(async (req, res) =>
    ok(
      res,
      await sites.confirmPlan(
        id(req),
        v.review.parse(req.body).revision,
        actor(req),
      ),
    ),
  ),
);
r.get(
  "/sites/:id/buyer-readiness",
  wrap(async (req, res) => ok(res, await buyerReadiness(id(req)))),
);
r.get(
  "/sites/:id/sources",
  wrap(async (req, res) => ok(res, await sites.sources(id(req)))),
);
r.get(
  "/sites/:id/agent-runs",
  wrap(async (req, res) => {
    await sites.ownSite(id(req));
    return list(req, res, AgentRun, agents.agentDto, {
      siteId: id(req),
      kind: "site.agent",
    });
  }),
);
r.post(
  "/sites/:id/agent-runs",
  edit,
  wrap(async (req, res) =>
    ok(
      res,
      await agents.queueAgent(
        id(req),
        req.body,
        String(req.headers["idempotency-key"] ?? ""),
        actor(req),
      ),
      202,
    ),
  ),
);
r.get(
  "/agent-runs/:id/screenshots/:key/:width",
  wrap(async (req, res) => {
    const run = await agents.ownRun(id(req));
    const key = String(req.params.key),
      width = Number(req.params.width);
    const unit = run.steps.find((s: any) => s.key === key);
    ensure(
      run.step === "review" &&
        unit?.capture?.artifactKey &&
        [375, 768, 1440].includes(width),
      404,
      "NOT_FOUND",
    );
    res
      .set({
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex,nofollow",
        "Content-Type": "image/jpeg",
      })
      .send(await reviewScreenshot(unit.capture.artifactKey, width));
  }),
);
r.get(
  "/agent-runs/:id",
  wrap(async (req, res) =>
    ok(res, agents.agentDto(await agents.ownRun(id(req)))),
  ),
);
r.post(
  "/agent-runs/:id/accept-review",
  admin,
  wrap(async (req, res) => {
    v.review.pick({}).strict().parse(req.body);
    ok(res, await agents.acceptQualityReview(id(req), actor(req)));
  }),
);
r.post(
  "/agent-runs/:id/retry",
  edit,
  wrap(async (req, res) =>
    ok(res, await agents.retryAgent(id(req), actor(req)), 202),
  ),
);
r.post(
  "/agent-runs/:id/cancel",
  edit,
  wrap(async (req, res) =>
    ok(res, await agents.cancelAgent(id(req), actor(req)), 202),
  ),
);
r.post(
  "/sites/:id/interview/answers",
  edit,
  wrap(async (req, res) =>
    ok(res, await agents.interviewAnswers(id(req), req.body, actor(req)), 201),
  ),
);
r.get(
  "/sites/:id/pages",
  wrap(async (req, res) => {
    const site = await sites.ownSite(id(req)),
      rows = await SitePage.find({
        siteId: id(req),
        nodeKey: { $in: site.plan?.nodes.map((n: any) => n.key) ?? [] },
      }).sort({ path: 1 });
    ok(res, {
      items: await Promise.all(rows.map((p) => sites.pageView(p, site))),
      hasMore: false,
      nextCursor: null,
    });
  }),
);
r.post(
  "/sites/:id/pages",
  edit,
  wrap(async (req, res) => {
    const key = v.newPageInput.parse(req.body).nodeKey;
    ok(res, await sites.createPage(id(req), key, actor(req)), 201);
  }),
);
r.get(
  "/pages/:id",
  wrap(async (req, res) =>
    ok(res, await sites.pageView(await sites.ownedPage(id(req)))),
  ),
);
r.patch(
  "/pages/:id",
  edit,
  wrap(async (req, res) => {
    await sites.ownedPage(id(req));
    const d = v.pagePatch.parse(req.body);
    ok(res, await sites.savePage(id(req), d.revision, d.data, actor(req)));
  }),
);
r.post(
  "/pages/:id/approve",
  admin,
  wrap(async (req, res) => {
    const d = v.review.parse(req.body);
    ok(
      res,
      await sites.reviewPage(id(req), d.revision, true, actor(req), d.reason),
    );
  }),
);
r.post(
  "/pages/:id/reject",
  admin,
  wrap(async (req, res) => {
    const d = v.review.parse(req.body);
    ok(
      res,
      await sites.reviewPage(id(req), d.revision, false, actor(req), d.reason),
    );
  }),
);
r.get(
  "/pages/:id/preview",
  wrap(async (req, res) => ok(res, await sites.preview(id(req)))),
);
r.get(
  "/sites/:id/readiness",
  wrap(async (req, res) => ok(res, await sites.readiness(id(req)))),
);
r.post(
  "/sites/:id/publication-check",
  admin,
  wrap(async (req, res) =>
    ok(res, await sites.requirePublishableSite(id(req))),
  ),
);
export default r;
