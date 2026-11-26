import { z } from "zod";
import { previewDesign, selectDesign } from "../services/site-design.service";
import { ensure } from "../errors";
import { reviewScreenshot } from "../services/site-review.service";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Site, SitePage, AgentRun, Session, Membership } from "../models";
import { runIdentity, runWithTenant } from "../models/tenant-context";
import { requireRole } from "../middleware/auth.middleware";
import { objectId, listQuery } from "../validators/catalog.validator";
import * as v from "../validators/sites.validator";
import * as sites from "../services/sites.service";
import { buyerReadiness } from "../services/b2b-planning.service";
import * as agents from "../services/site-agents.service";
import { queueFactSuggestions } from "../services/fact-suggest.service";
import { runDto } from "../services/catalog-run.service";
import {
  logoView,
  queueLogo,
  selectLogo,
} from "../services/site-media.service";
import { standaloneWordmarkSvg } from "../services/brand-mark.service";
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
// S35: demo preview mode / AI illustration switches (admin; gates unchanged).
r.patch(
  "/sites/:id/options",
  admin,
  wrap(async (req, res) => {
    await sites.ownSite(id(req));
    ok(res, await sites.setSiteOptions(id(req), req.body, actor(req)));
  }),
);
// S35 stage C: one billed AI call proposing candidate facts (never confirmed).
r.post(
  "/sites/:id/fact-suggestions",
  edit,
  wrap(async (req, res) => {
    await sites.ownSite(id(req));
    ok(res, await queueFactSuggestions(id(req), req.body, actor(req)), 202);
  }),
);
r.get(
  "/fact-suggestions/:id",
  wrap(async (req, res) => {
    const run = await AgentRun.findOne({ _id: id(req), kind: "facts.suggest" });
    ensure(run, 404, "NOT_FOUND");
    ok(res, runDto(run));
  }),
);
// S35 B2: logo brief, AI candidates, selection and the deterministic wordmark.
r.get(
  "/sites/:id/logo",
  wrap(async (req, res) => {
    await sites.ownSite(id(req));
    ok(res, await logoView(id(req)));
  }),
);
r.get(
  "/sites/:id/logo/wordmark.svg",
  wrap(async (req, res) => {
    const view = await logoView(id(req));
    res
      .set({
        "Cache-Control": "private, no-store",
        "Content-Type": "image/svg+xml",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      })
      .send(
        standaloneWordmarkSvg(view.logoDesign.name, {
          mark: view.logoDesign.colors[0],
          text: view.logoDesign.colors[0],
        }),
      );
  }),
);
r.post(
  "/sites/:id/logo/generate",
  edit,
  wrap(async (req, res) => {
    await sites.ownSite(id(req));
    ok(res, await queueLogo(id(req), req.body, actor(req)), 202);
  }),
);
r.put(
  "/sites/:id/logo",
  edit,
  wrap(async (req, res) => {
    await sites.ownSite(id(req));
    ok(res, await selectLogo(id(req), req.body, actor(req)));
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
r.get(
  "/sites/:id/agent-runs/stream",
  wrap(async (req, res) => {
    const siteId = id(req);
    await sites.ownSite(siteId);
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit);
    const orgId = req.auth!.organizationId;
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    let closed = false;
    let lastSignature: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const maxLife = setTimeout(() => {
      if (!closed) {
        closed = true;
        clearTimeout(timer);
        clearInterval(keepalive);
        res.end();
      }
    }, 600000);
    const keepalive = setInterval(() => {
      if (!closed) res.write(": keepalive\n\n");
    }, 15000);
    req.on("close", () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(maxLife);
      clearInterval(keepalive);
    });
    const push = async () => {
      if (closed) return;
      try {
        const alive = await runIdentity(async () => {
          const [session, member] = await Promise.all([
            Session.exists({
              _id: req.auth!.sessionId,
              revokedAt: { $exists: false },
              accessExpiresAt: { $gt: new Date() },
              expiresAt: { $gt: new Date() },
            }),
            Membership.exists({
              userId: req.auth!.userId,
              organizationId: orgId,
              status: "active",
            }),
          ]);
          return Boolean(session && member);
        });
        if (!alive || closed) {
          if (!closed) {
            closed = true;
            clearTimeout(maxLife);
            clearInterval(keepalive);
            res.end();
          }
          return;
        }
        const snapshot = await runWithTenant(orgId, async () => {
          const rows = await AgentRun.find({ siteId, kind: "site.agent" })
            .sort({ _id: -1 })
            .limit(limit + 1);
          const slice = rows.slice(0, limit);
          const hasMore = rows.length > limit;
          const items = slice.map(agents.agentDto);
          const hasActive = slice.some((r: any) =>
            ["queued", "running", "cancelling"].includes(r.status),
          );
          const sig = slice
            .map(
              (r: any) =>
                `${r._id}:${r.status}:${r.updatedAt?.getTime?.() ?? ""}:${(r.steps ?? []).map((s: any) => `${s.key}=${s.status}`).join(",")}`,
            )
            .join("|");
          return {
            sig,
            hasActive,
            payload: {
              items,
              hasMore,
              nextCursor: hasMore ? String(slice[slice.length - 1]._id) : null,
            },
          };
        });
        if (closed) return;
        if (snapshot.sig !== lastSignature) {
          lastSignature = snapshot.sig;
          res.write(`event: runs\ndata: ${JSON.stringify(snapshot.payload)}\n\n`);
        }
        timer = setTimeout(() => void push(), snapshot.hasActive ? 800 : 2500);
      } catch {
        if (!closed) {
          closed = true;
          clearTimeout(maxLife);
          clearInterval(keepalive);
          res.end();
        }
      }
    };
    await push();
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
    const phase =
      req.query.phase === undefined
        ? undefined
        : z.enum(["before", "after"]).parse(req.query.phase);
    const capture =
      run.step === "refine"
        ? phase === "before"
          ? unit?.beforeCapture
          : phase === "after"
            ? unit?.afterCapture
            : undefined
        : !phase
          ? unit?.capture
          : undefined;
    ensure(
      ["review", "refine"].includes(run.step) &&
        capture?.artifactKey &&
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
      .send(await reviewScreenshot(capture.artifactKey, width));
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
  "/sites/:id/design-proposals/:runId/:key/preview",
  wrap(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    ok(
      res,
      await previewDesign(
        id(req),
        objectId.parse(req.params.runId),
        v.selectDesignInput.shape.key.parse(req.params.key),
        req.query.page === undefined
          ? "home"
          : z.enum(["home", "detail"]).parse(req.query.page),
      ),
    );
  }),
);
r.post(
  "/sites/:id/design-direction",
  edit,
  wrap(async (req, res) => {
    ok(res, await selectDesign(id(req), req.body, actor(req)));
  }),
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
r.post(
  "/sites/:id/pages/batch-approve",
  admin,
  wrap(async (req, res) => {
    const d = v.batchReviewInput.parse(req.body);
    ok(
      res,
      await sites.batchApprovePages(id(req), d.items, actor(req), d.reason),
    );
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
r.post(
  "/pages/:id/preview-draft",
  edit,
  wrap(async (req, res) => ok(res, await sites.previewDraft(id(req), req.body))),
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
