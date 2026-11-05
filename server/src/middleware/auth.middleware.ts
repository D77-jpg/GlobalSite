// Adapted from GlobalCRM server/src/middleware/auth.middleware.ts @ a94a285.
// No legacy bearer fallback. Current memberships and session revocation checked per request.
import type { RequestHandler, Request } from "express";
import { Session, User, Membership, Organization } from "../models";
import { runIdentity, runWithTenant } from "../models/tenant-context";
import { digest } from "../services/mail.service";
import { parseOpaque, safeEqual } from "../services/auth.service";
import { ensure } from "../errors";
import { config } from "../config";
export interface Auth {
  userId: string;
  organizationId: string;
  sessionId: string;
  role: "admin" | "editor" | "viewer";
}
declare module "express-serve-static-core" {
  interface Request {
    auth?: Auth;
  }
}
export function cookie(req: Request, name: string) {
  return (
    (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) ?? ""
  );
}
export function assertOrigin(req: Request) {
  ensure(
    req.headers.origin === new URL(config.origin).origin,
    403,
    "CSRF_INVALID",
  );
}
export function assertCsrf(req: Request) {
  assertOrigin(req);
  ensure(
    !!cookie(req, "gs_csrf") &&
      safeEqual(
        cookie(req, "gs_csrf"),
        String(req.headers["x-csrf-token"] ?? ""),
      ),
    403,
    "CSRF_INVALID",
  );
}
export const requireAuth: RequestHandler = (req, _res, next) => {
  void runIdentity(async () => {
    const { id, secret } = parseOpaque(cookie(req, "gs_access"));
    const session = await Session.findOne({
      _id: id,
      accessHash: digest(secret),
      revokedAt: { $exists: false },
      accessExpiresAt: { $gt: new Date() },
      expiresAt: { $gt: new Date() },
    }).select("+csrfHash");
    ensure(session, 401, "UNAUTHORIZED");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      assertCsrf(req);
      ensure(
        safeEqual(session.csrfHash ?? "", digest(cookie(req, "gs_csrf"))),
        403,
        "CSRF_INVALID",
      );
    }
    const [user, member, org] = await Promise.all([
      User.findById(session.userId),
      Membership.findOne({
        userId: session.userId,
        organizationId: session.organizationId,
        status: "active",
      }),
      Organization.findById(session.organizationId),
    ]);
    ensure(
      user?.emailVerifiedAt &&
        user.authVersion === session.authVersion &&
        member &&
        org?.status === "active",
      401,
      "UNAUTHORIZED",
    );
    req.auth = {
      userId: String(user._id),
      organizationId: String(session.organizationId),
      sessionId: id,
      role: member.role,
    };
    runWithTenant(String(session.organizationId), () => next());
  }).catch(next);
};
export const requireRole =
  (...roles: Auth["role"][]): RequestHandler =>
  (req, _res, next) => {
    try {
      ensure(req.auth && roles.includes(req.auth.role), 403, "FORBIDDEN");
      next();
    } catch (e) {
      next(e);
    }
  };
