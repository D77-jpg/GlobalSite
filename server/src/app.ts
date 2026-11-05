import sitesRoutes from "./routes/sites.routes";
import catalogRoutes from "./routes/catalog.routes";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";
import { z, ZodError } from "zod";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { AppError, ensure } from "./errors";
import { requestId } from "./middleware/request-id.middleware";
import {
  requireAuth,
  requireRole,
  assertCsrf,
  assertOrigin,
  cookie,
} from "./middleware/auth.middleware";
import {
  User,
  Membership,
  Organization,
  Session,
  RateLimit,
  AuditLog,
} from "./models";
import { runIdentity, runWithTenant } from "./models/tenant-context";
import * as auth from "./services/auth.service";
import { previewMail, queueMail, digest } from "./services/mail.service";
import { audit } from "./services/audit.service";
import { usage, limits } from "./services/usage.service";
import { plans } from "./constants/plans";
import { metrics } from "./services/metrics.service";
import { reportError } from "./services/error-monitor.service";
import { getProvider, saveProvider, testProvider } from "./services/ai.service";
const email = z.string().trim().toLowerCase().email().max(200),
  password = z.string().min(12).max(128),
  id = z.string().regex(/^[a-f0-9]{24}$/),
  secret = z.string().regex(/^[a-f0-9]{64}$/),
  role = z.enum(["admin", "editor", "viewer"]);
const body = (req: Request, schema: z.ZodType) => schema.parse(req.body) as any;
const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
const cookies = (res: Response, value: any) => {
  const options = {
    secure: config.env === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  res.cookie("gs_access", value.access, {
    ...options,
    httpOnly: true,
    maxAge: 15 * 60000,
  });
  res.cookie("gs_refresh", value.refresh, {
    ...options,
    httpOnly: true,
    expires: value.expiresAt,
  });
  res.cookie("gs_csrf", value.csrf, {
    ...options,
    httpOnly: false,
    expires: value.expiresAt,
  });
};
const clear = (res: Response) => {
  for (const name of ["gs_access", "gs_refresh", "gs_csrf"])
    res.clearCookie(name, {
      path: "/",
      secure: config.env === "production",
      sameSite: "lax",
    });
};
const paging = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
function page(rows: any[], limit: number, map: (row: any) => unknown) {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    items: items.map(map),
    nextCursor: hasMore ? String(items.at(-1)._id) : null,
    hasMore,
  };
}
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(requestId);
  app.get("/api/v1/health/live", (_req, res) => ok(res, { ok: true }));
  app.get(
    "/api/v1/health/ready",
    wrap(async (_req, res) => {
      try {
        await mongoose.connection.db?.admin().ping();
        ensure(mongoose.connection.readyState === 1, 503, "NOT_READY");
        ok(res, { ok: true });
      } catch {
        ok(res, { ok: false }, 503);
      }
    }),
  );
  app.use("/api/v1/pages", express.json({ limit: "512kb" }));
  app.use("/api/v1/sites", express.json({ limit: "128kb" }));
  app.use("/api", express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    void (async () => {
      const minute = Math.floor(Date.now() / 60000);
      const key = digest(
        (req.ip ?? "unknown") +
          ":" +
          (req.path.startsWith("/v1/auth") ? "auth" : "api") +
          ":" +
          minute,
      );
      const bucket = await runIdentity(() =>
        RateLimit.findOneAndUpdate(
          { key },
          {
            $inc: { count: 1 },
            $setOnInsert: { expiresAt: new Date((minute + 2) * 60000) },
          },
          { upsert: true, new: true },
        ),
      );
      if (bucket.count > (req.path.startsWith("/v1/auth") ? 40 : 240)) {
        res.setHeader("Retry-After", "60");
        throw new AppError(429, "RATE_LIMITED");
      }
    })()
      .then(() => next())
      .catch(next);
  });
  const publicPost = (
    route: string,
    schema: z.ZodType,
    handler: (data: any, req: Request, res: Response) => Promise<unknown>,
  ) =>
    app.post(
      "/api/v1" + route,
      wrap(async (req, res) => {
        assertOrigin(req);
        await handler(body(req, schema), req, res);
      }),
    );
  publicPost(
    "/auth/register",
    z
      .object({
        email,
        password,
        name: z.string().trim().min(1).max(120),
        organizationName: z.string().trim().min(1).max(160),
        locale: z.enum(["zh", "en"]).default("zh"),
      })
      .strict(),
    async (data, _req, res) => ok(res, await auth.register(data), 202),
  );
  publicPost(
    "/auth/verify-email",
    z.object({ token: secret }).strict(),
    async (data, _req, res) => {
      await auth.verifyEmail(data.token);
      ok(res, { verified: true });
    },
  );
  publicPost(
    "/auth/resend-verification",
    z.object({ email }).strict(),
    async (data, _req, res) =>
      ok(res, await auth.resend(data.email, "verify"), 202),
  );
  publicPost(
    "/auth/forgot-password",
    z.object({ email }).strict(),
    async (data, _req, res) =>
      ok(res, await auth.resend(data.email, "reset"), 202),
  );
  publicPost(
    "/auth/reset-password",
    z.object({ token: secret, password }).strict(),
    async (data, _req, res) => {
      await auth.resetPassword(data.token, data.password);
      clear(res);
      ok(res, { reset: true });
    },
  );
  publicPost(
    "/auth/login",
    z.object({ email, password: z.string().max(128) }).strict(),
    async (data, req, res) => {
      const result = await auth.login(
        data.email,
        data.password,
        req.headers["user-agent"],
      );
      if (result.cookies) {
        cookies(res, result.cookies);
        ok(res, { authenticated: true });
      } else ok(res, result);
    },
  );
  publicPost(
    "/auth/2fa/verify",
    z.object({ challengeId: id, code: z.string().regex(/^\d{6}$/) }).strict(),
    async (data, req, res) => {
      const row = await auth.verifyChallenge(
        data.challengeId,
        data.code,
        "login2fa",
      );
      cookies(
        res,
        await auth.createSession(
          String(row.userId),
          String(row.organizationId),
          req.headers["user-agent"],
          row.authVersion,
        ),
      );
      ok(res, { authenticated: true });
    },
  );
  app.post(
    "/api/v1/auth/refresh",
    wrap(async (req, res) => {
      assertCsrf(req);
      cookies(
        res,
        await auth.rotate(cookie(req, "gs_refresh"), cookie(req, "gs_csrf")),
      );
      ok(res, { authenticated: true });
    }),
  );
  app.get(
    "/api/v1/dev/mail/:receipt",
    wrap(async (req, res) => ok(res, await previewMail(req.params.receipt))),
  );
  app.use("/api/v1", requireAuth);
  app.use("/api/v1", catalogRoutes);
  app.use("/api/v1", sitesRoutes);
  app.get(
    "/api/v1/auth/me",
    wrap(async (req, res) => {
      const user = await runIdentity(() => User.findById(req.auth!.userId));
      ok(res, {
        user: auth.publicUser(user),
        organizationId: req.auth!.organizationId,
        role: req.auth!.role,
      });
    }),
  );
  app.post(
    "/api/v1/auth/logout",
    wrap(async (req, res) => {
      await Session.updateOne(
        { _id: req.auth!.sessionId },
        { $set: { revokedAt: new Date() } },
      );
      clear(res);
      ok(res, { loggedOut: true });
    }),
  );
  app.get(
    "/api/v1/auth/sessions",
    wrap(async (req, res) => {
      const { cursor, limit } = paging.parse(req.query);
      const rows = await Session.find({
        userId: req.auth!.userId,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
        ...(cursor ? { _id: { $lt: cursor } } : {}),
      })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean();
      ok(
        res,
        page(rows, limit, (s) => ({
          id: String(s._id),
          current: String(s._id) === req.auth!.sessionId,
          userAgent: s.userAgent,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
        })),
      );
    }),
  );

  app.delete(
    "/api/v1/auth/sessions/:id",
    wrap(async (req, res) => {
      const row = await Session.findOneAndUpdate(
        { _id: id.parse(req.params.id), userId: req.auth!.userId },
        { $set: { revokedAt: new Date() } },
      );
      ensure(row, 404, "NOT_FOUND");
      await audit("session.revoked", req.auth!.userId, String(row._id));
      if (String(row._id) === req.auth!.sessionId) clear(res);
      ok(res, { revoked: true });
    }),
  );
  app.post(
    "/api/v1/auth/2fa/challenge",
    wrap(async (req, res) => {
      const data = body(req, z.object({ password }).strict());
      const user = await runIdentity(() =>
        User.findById(req.auth!.userId).select("+passwordHash"),
      );
      ensure(
        user && (await auth.verifyPassword(data.password, user.passwordHash)),
        401,
        "AUTH_INVALID",
      );
      const result = await auth.token(
        user,
        req.auth!.organizationId,
        "security2fa",
      );
      ok(res, { challengeId: result.id, devReceipt: result.devReceipt });
    }),
  );
  app.put(
    "/api/v1/auth/2fa",
    wrap(async (req, res) => {
      const data = body(
        req,
        z
          .object({
            challengeId: id,
            code: z.string().regex(/^\d{6}$/),
            enabled: z.boolean(),
          })
          .strict(),
      );
      await auth.verifyChallenge(
        data.challengeId,
        data.code,
        "security2fa",
        req.auth!.userId,
      );
      const changed = await runIdentity(() =>
        User.findOneAndUpdate(
          { _id: req.auth!.userId },
          {
            $set: { twoFactorEnabled: data.enabled },
            $inc: { authVersion: 1 },
          },
          { new: true },
        ),
      );
      await Session.updateOne(
        { _id: req.auth!.sessionId },
        { $set: { authVersion: changed!.authVersion } },
      );
      await runIdentity(() =>
        Session.updateMany(
          { userId: req.auth!.userId, _id: { $ne: req.auth!.sessionId } },
          { $set: { revokedAt: new Date() } },
        ),
      );
      await audit("security.2fa.updated", req.auth!.userId);
      ok(res, { enabled: data.enabled });
    }),
  );
  app.get(
    "/api/v1/organizations",
    wrap(async (req, res) => {
      const { cursor, limit } = paging.parse(req.query);
      const members = await runIdentity(() =>
        Membership.find({ userId: req.auth!.userId, status: "active" }),
      );
      const rows = await runIdentity(() =>
        Organization.find({
          _id: {
            $in: members.map((m) => m.organizationId),
            ...(cursor ? { $lt: cursor } : {}),
          },
        })
          .sort({ _id: -1 })
          .limit(limit + 1),
      );
      ok(
        res,
        page(rows, limit, (o) => ({
          id: String(o._id),
          name: o.name,
          plan: o.plan,
        })),
      );
    }),
  );

  app.post(
    "/api/v1/organizations/:id/select",
    wrap(async (req, res) => {
      cookies(
        res,
        await auth.createSession(
          req.auth!.userId,
          id.parse(req.params.id),
          req.headers["user-agent"],
        ),
      );
      await Session.updateOne(
        { _id: req.auth!.sessionId },
        { $set: { revokedAt: new Date() } },
      );
      ok(res, { selected: true });
    }),
  );
  app.get(
    "/api/v1/organization",
    wrap(async (req, res) => {
      const org = await runIdentity(() =>
        Organization.findById(req.auth!.organizationId),
      );
      ok(res, { id: String(org!._id), name: org!.name, plan: org!.plan });
    }),
  );
  app.patch(
    "/api/v1/organization",
    requireRole("admin"),
    wrap(async (req, res) => {
      const data = body(
        req,
        z.object({ name: z.string().trim().min(1).max(160) }).strict(),
      );
      const org = await runIdentity(() =>
        Organization.findOneAndUpdate(
          { _id: req.auth!.organizationId },
          { $set: { name: data.name } },
          { new: true },
        ),
      );
      await audit("organization.updated", req.auth!.userId);
      ok(res, { id: String(org!._id), name: org!.name, plan: org!.plan });
    }),
  );
  app.get(
    "/api/v1/members",
    wrap(async (req, res) => {
      const { cursor, limit } = paging.parse(req.query);
      const rows = await Membership.find(cursor ? { _id: { $lt: cursor } } : {})
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean();
      const users = await runIdentity(() =>
        User.find({
          _id: { $in: rows.flatMap((m) => (m.userId ? [m.userId] : [])) },
        }),
      );
      const lookup = new Map(users.map((u) => [String(u._id), u]));
      ok(
        res,
        page(rows, limit, (m) => ({
          id: String(m._id),
          userId: m.userId ? String(m.userId) : undefined,
          name: lookup.get(String(m.userId))?.name,
          email:
            lookup.get(String(m.userId))?.emailNormalized ?? m.invitedEmail,
          role: m.role,
          status: m.status,
        })),
      );
    }),
  );

  app.post(
    "/api/v1/invitations",
    requireRole("admin"),
    wrap(async (req, res) => {
      const data = body(req, z.object({ email, role }).strict()),
        invite = randomBytes(32).toString("hex");
      let row: any;
      await mongoose.connection.transaction(async (session) => {
        // Serialize seat allocation on organization root, including pending invitations.
        await runIdentity(() =>
          Organization.updateOne(
            { _id: req.auth!.organizationId },
            { $set: { updatedAt: new Date() } },
            { session },
          ),
        );
        const cap = await limits();
        const count = await Membership.countDocuments({
          $or: [
            { status: "active" },
            { status: "invited", inviteExpiresAt: { $gt: new Date() } },
          ],
        }).session(session);
        ensure(count < cap.members, 409, "QUOTA_EXCEEDED");
        const user = await runIdentity(() =>
          User.findOne({ emailNormalized: data.email }).session(session),
        );
        const exists = await Membership.findOne({
          $or: [
            { invitedEmail: data.email },
            ...(user ? [{ userId: user._id, status: "active" }] : []),
          ],
        }).session(session);
        ensure(!exists || exists.status !== "active", 409, "CONFLICT");
        row = await Membership.findOneAndUpdate(
          { invitedEmail: data.email },
          {
            $set: {
              role: data.role,
              status: "invited",
              inviteTokenHash: digest(invite),
              inviteExpiresAt: new Date(Date.now() + 7 * 86400000),
            },
          },
          { upsert: true, new: true, session },
        );
      });
      const receipt = await queueMail(
        data.email,
        "GlobalSite · invitation",
        config.origin + "/accept-invitation?token=" + invite,
      );
      await audit("member.invited", req.auth!.userId, String(row._id));
      ok(res, { id: String(row._id), devReceipt: receipt }, 201);
    }),
  );
  app.patch(
    "/api/v1/members/:id",
    requireRole("admin"),
    wrap(async (req, res) => {
      const data = body(
        req,
        z
          .object({
            role: role.optional(),
            status: z.enum(["active", "revoked"]).optional(),
          })
          .strict(),
      );
      const member = await Membership.findById(id.parse(req.params.id));
      ensure(member, 404, "NOT_FOUND");
      const org = await runIdentity(() =>
        Organization.findById(req.auth!.organizationId),
      );
      ensure(
        String(member.userId) !== String(org!.ownerUserId),
        409,
        "OWNER_PROTECTED",
      );
      if (member.status !== "active")
        ensure(data.status !== "active", 400, "INVITATION_REQUIRED");
      await Membership.updateOne({ _id: member._id }, { $set: data });
      await audit("member.updated", req.auth!.userId, String(member._id));
      ok(res, { updated: true });
    }),
  );
  app.post(
    "/api/v1/invitations/accept",
    wrap(async (req, res) => {
      const data = body(req, z.object({ token: secret }).strict());
      const user = await runIdentity(() => User.findById(req.auth!.userId));
      const invite = await runIdentity(() =>
        Membership.findOne({
          inviteTokenHash: digest(data.token),
          status: "invited",
          inviteExpiresAt: { $gt: new Date() },
        }),
      );
      ensure(
        invite && invite.invitedEmail === user!.emailNormalized,
        400,
        "TOKEN_INVALID",
      );
      await runWithTenant(String(invite.organizationId), async () => {
        const previous = await Membership.findOne({ userId: req.auth!.userId });
        ensure(!previous || previous.status !== "active", 409, "CONFLICT");
        if (previous && String(previous._id) !== String(invite._id))
          await Membership.deleteOne({ _id: previous._id });
        const row = await Membership.findOneAndUpdate(
          {
            _id: invite._id,
            inviteTokenHash: digest(data.token),
            status: "invited",
          },
          {
            $set: { userId: req.auth!.userId, status: "active" },
            $unset: { inviteTokenHash: 1, inviteExpiresAt: 1 },
          },
          { new: true },
        );
        ensure(row, 400, "TOKEN_INVALID");
        await audit("member.accepted", req.auth!.userId, String(row._id));
      });
      ok(res, { organizationId: String(invite.organizationId) });
    }),
  );
  app.get(
    "/api/v1/usage",
    wrap(async (_req, res) => ok(res, await usage())),
  );
  app.get(
    "/api/v1/audit-logs",
    requireRole("admin"),
    wrap(async (req, res) => {
      const { cursor, limit } = paging.parse(req.query);
      const rows = await AuditLog.find(cursor ? { _id: { $lt: cursor } } : {})
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean();
      ok(
        res,
        page(rows, limit, (row) => ({
          id: String(row._id),
          action: row.action,
          actorId: row.actorId ? String(row.actorId) : undefined,
          targetId: row.targetId,
          requestId: row.requestId,
          createdAt: row.createdAt,
        })),
      );
    }),
  );
  app.get("/api/v1/plans", (_req, res) => ok(res, plans));
  app.get(
    "/api/v1/ai/provider",
    requireRole("admin"),
    wrap(async (_req, res) => ok(res, await getProvider())),
  );
  app.put(
    "/api/v1/ai/provider",
    requireRole("admin"),
    wrap(async (req, res) =>
      ok(
        res,
        await saveProvider(
          body(
            req,
            z
              .object({
                modelName: z.string().min(1).max(120),
                baseUrl: z.string().url().max(500),
                enabled: z.boolean(),
                apiKey: z.string().min(1).max(512).optional(),
              })
              .strict(),
          ),
          req.auth!.userId,
        ),
      ),
    ),
  );
  app.post(
    "/api/v1/ai/provider/test",
    requireRole("admin"),
    wrap(async (req, res) => {
      const op = z.string().uuid().parse(req.headers["idempotency-key"]);
      ok(res, await testProvider(op));
    }),
  );
  app.get("/api/v1/metrics", requireRole("admin"), (_req, res) =>
    res.type("text/plain").send(metrics()),
  );
  app.use("/api", (_req, _res, next) => next(new AppError(404, "NOT_FOUND")));
  const web = path.resolve(__dirname, "../../web/dist");
  if (fs.existsSync(web)) {
    app.use(express.static(web));
    app.get("*", (_req, res) => res.sendFile(path.join(web, "index.html")));
  }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof ZodError
          ? 400
          : error.name === "MulterError"
            ? error.code === "LIMIT_FILE_SIZE"
              ? 413
              : 400
            : error.type === "entity.parse.failed"
              ? 400
              : error.name === "CastError"
                ? 404
                : error.code === 11000
                  ? 409
                  : error.type === "entity.too.large" ||
                      error.code === "LIMIT_FILE_SIZE"
                    ? 413
                    : 500;
    const code =
      error instanceof AppError
        ? error.code
        : error instanceof ZodError ||
            error.type === "entity.parse.failed" ||
            (status === 400 && error.name === "MulterError")
          ? "VALIDATION_ERROR"
          : status === 404
            ? "NOT_FOUND"
            : status === 409
              ? "CONFLICT"
              : status === 413
                ? "BODY_TOO_LARGE"
                : "INTERNAL_ERROR";
    if (status === 500) reportError(res.locals.requestId);
    res.status(status).json({
      success: false,
      error: { code, requestId: res.locals.requestId },
    });
  });
  return app;
}
