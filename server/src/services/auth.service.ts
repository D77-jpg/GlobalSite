import { otpHash } from "./credential-crypto";
// Adapted from GlobalCRM server/src/services/auth.service.ts @ a94a285.
// Opaque revocable cookies, per-organization Membership, atomic rotation and OTP consumption.
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { User, Organization, Membership, Session, AuthToken } from "../models";
import { runIdentity, runWithTenant } from "../models/tenant-context";
import { queueMail, digest } from "./mail.service";
import { ensure, AppError } from "../errors";
import { config } from "../config";
import { audit } from "./audit.service";
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const hashPassword = (password: string) =>
  bcrypt.hash(digest("globalsite-password:v1:" + password), 12);
export const verifyPassword = (password: string, hash: string) =>
  bcrypt.compare(digest("globalsite-password:v1:" + password), hash);
const random = () => randomBytes(32).toString("hex");
export const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export function publicUser(user: any) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.emailNormalized,
    emailVerified: !!user.emailVerifiedAt,
    twoFactorEnabled: !!user.twoFactorEnabled,
    locale: user.locale,
  };
}
export async function token(
  user: any,
  org: string,
  kind: "verify" | "reset" | "login2fa" | "security2fa",
) {
  const secret = random();
  const code = String(randomInt(100000, 1000000));
  const isCode = kind.endsWith("2fa");
  const record = await runWithTenant(org, () =>
    AuthToken.create({
      userId: user._id,
      kind,
      tokenHash: digest(secret),
      codeHash: isCode ? otpHash(code, org) : undefined,
      authVersion: user.authVersion ?? 0,
      expiresAt: new Date(
        Date.now() +
          (isCode ? 5 * 60 : kind === "verify" ? 1440 * 60 : 30 * 60) * 1000,
      ),
    }),
  );
  const url =
    config.origin +
    (kind === "verify" ? "/verify-email" : "/reset-password") +
    "?token=" +
    secret;
  const receipt = await runWithTenant(org, () =>
    queueMail(
      user.emailNormalized,
      "GlobalSite · " + kind,
      isCode ? "GlobalSite verification code: " + code : url,
    ),
  );
  return { id: String(record._id), secret, devReceipt: receipt };
}
export async function register(input: {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  locale: string;
}) {
  const existing = await runIdentity(() =>
    User.findOne({ emailNormalized: input.email }),
  );
  if (existing) return { accepted: true };
  const passwordHash = await hashPassword(input.password);
  let user: any, org: any;
  try {
    await mongoose.connection.transaction(async (session) =>
      runIdentity(async () => {
        [user] = await User.create(
          [
            {
              emailNormalized: input.email,
              name: input.name,
              passwordHash,
              locale: input.locale,
            },
          ],
          { session },
        );
        [org] = await Organization.create(
          [
            {
              name: input.organizationName,
              slug: "org-" + random().slice(0, 16),
              ownerUserId: user._id,
            },
          ],
          { session },
        );
        await runWithTenant(String(org._id), () =>
          Membership.create(
            [{ userId: user._id, role: "admin", status: "active" }],
            { session },
          ),
        );
      }),
    );
  } catch (error) {
    if ((error as any).code === 11000) return { accepted: true };
    throw error;
  }
  const issued = await token(user, String(org._id), "verify");
  await runWithTenant(String(org._id), () =>
    audit("organization.created", String(user._id), String(org._id)),
  );
  return { accepted: true, devReceipt: issued.devReceipt };
}
export async function consume(secret: string, kind: "verify" | "reset") {
  return runIdentity(async () => {
    const record = await AuthToken.findOneAndUpdate(
      {
        tokenHash: digest(secret),
        kind,
        usedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { $set: { usedAt: new Date() } },
      { new: true },
    );
    ensure(record, 400, "TOKEN_INVALID");
    return record;
  });
}
export async function verifyEmail(secret: string) {
  const record = await consume(secret, "verify");
  await runIdentity(() =>
    User.updateOne(
      { _id: record.userId },
      { $set: { emailVerifiedAt: new Date() } },
    ),
  );
}
export async function resetPassword(secret: string, password: string) {
  const hash = await hashPassword(password);
  const record = await consume(secret, "reset");
  await mongoose.connection.transaction(async (session) =>
    runIdentity(async () => {
      await User.updateOne(
        { _id: record.userId },
        {
          $inc: { authVersion: 1 },
          $set: { passwordHash: hash, failedAttempts: 0 },
          $unset: { lockedUntil: 1 },
        },
        { session },
      );
      await Session.updateMany(
        { userId: record.userId },
        { $set: { revokedAt: new Date() } },
        { session },
      );
      await AuthToken.updateMany(
        { userId: record.userId },
        { $set: { usedAt: new Date() } },
        { session },
      );
    }),
  );
}
async function firstMembership(userId: string, organizationId?: string) {
  return runIdentity(() =>
    Membership.findOne({
      userId,
      status: "active",
      ...(organizationId ? { organizationId } : {}),
    }),
  );
}
export async function resend(email: string, kind: "verify" | "reset") {
  const user = await runIdentity(() =>
    User.findOne({ emailNormalized: email }),
  );
  if (!user || (kind === "verify" && user.emailVerifiedAt))
    return { accepted: true };
  const member = await firstMembership(String(user._id));
  if (!member) return { accepted: true };
  const result = await token(user, String(member.organizationId), kind);
  return { accepted: true, devReceipt: result.devReceipt };
}
export async function createSession(
  userId: string,
  org: string,
  userAgent = "",
  expectedVersion?: number,
) {
  const member = await firstMembership(userId, org);
  ensure(member, 403, "MEMBERSHIP_REQUIRED");
  const identity = await runIdentity(async () => ({
    user: await User.findById(userId),
    organization: await Organization.findById(org),
  }));
  ensure(
    identity.user?.emailVerifiedAt &&
      identity.organization?.status === "active",
    401,
    "UNAUTHORIZED",
  );
  ensure(
    expectedVersion === undefined ||
      identity.user!.authVersion === expectedVersion,
    401,
    "UNAUTHORIZED",
  );
  const access = random(),
    refresh = random(),
    csrf = random();
  const row = await runWithTenant(org, () =>
    Session.create({
      userId,
      authVersion: identity.user!.authVersion,
      accessHash: digest(access),
      refreshHash: digest(refresh),
      csrfHash: digest(csrf),
      accessExpiresAt: new Date(Date.now() + 15 * 60000),
      expiresAt: new Date(Date.now() + 14 * 86400000),
      userAgent: userAgent.slice(0, 120),
    }),
  );
  return {
    access: String(row._id) + "." + access,
    refresh: String(row._id) + "." + refresh,
    csrf,
    expiresAt: row.expiresAt,
  };
}
export async function login(email: string, password: string, userAgent = "") {
  return runIdentity(async () => {
    const user = await User.findOne({ emailNormalized: email }).select(
      "+passwordHash",
    );
    // Same expensive verification for unknown users, avoiding a fast existence oracle.
    const hash =
      user?.passwordHash ??
      "$2b$12$C6UzMDM.H6dfI/f/IKcEe.ouhL.xBlMlyzTQ11k5.ZvFt/knDZhSy";
    const valid = await verifyPassword(password, hash);
    if (user?.lockedUntil && user.lockedUntil > new Date())
      throw new AppError(423, "ACCOUNT_LOCKED");
    if (!user || !valid) {
      if (user) {
        const now = new Date();
        const base = {
          $cond: [
            {
              $and: [
                { $ne: [{ $ifNull: ["$lockedUntil", null] }, null] },
                { $lte: ["$lockedUntil", now] },
              ],
            },
            0,
            { $ifNull: ["$failedAttempts", 0] },
          ],
        };
        const next = { $add: [base, 1] };
        await User.updateOne({ _id: user._id }, [
          {
            $set: {
              failedAttempts: next,
              lockedUntil: {
                $cond: [
                  { $gte: [next, LOGIN_MAX_FAILED_ATTEMPTS] },
                  new Date(now.getTime() + 15 * 60000),
                  "$$REMOVE",
                ],
              },
            },
          },
        ]);
      }
      throw new AppError(401, "AUTH_INVALID");
    }
    ensure(user.emailVerifiedAt, 403, "EMAIL_UNVERIFIED");
    await User.updateOne(
      { _id: user._id },
      { $set: { failedAttempts: 0 }, $unset: { lockedUntil: 1 } },
    );
    const member = await firstMembership(String(user._id));
    ensure(member, 403, "MEMBERSHIP_REQUIRED");
    const org = String(member.organizationId);
    if (user.twoFactorEnabled) {
      const challenge = await token(user, org, "login2fa");
      return { challengeId: challenge.id, devReceipt: challenge.devReceipt };
    }
    return {
      cookies: await createSession(
        String(user._id),
        org,
        userAgent,
        user.authVersion,
      ),
    };
  });
}
export async function verifyChallenge(
  id: string,
  code: string,
  kind: "login2fa" | "security2fa",
  userId?: string,
) {
  return runIdentity(async () => {
    const row = await AuthToken.findOneAndUpdate(
      {
        _id: id,
        kind,
        ...(userId ? { userId } : {}),
        attempts: { $lt: 5 },
        usedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { $inc: { attempts: 1 } },
      { new: true },
    ).select("+codeHash");
    ensure(
      row &&
        safeEqual(
          row.codeHash ?? "",
          otpHash(code, String(row.organizationId)),
        ),
      400,
      "CODE_INVALID",
    );
    const currentUser = await User.findById(row.userId);
    ensure(
      currentUser && currentUser.authVersion === row.authVersion,
      400,
      "CODE_INVALID",
    );
    const claimed = await AuthToken.findOneAndUpdate(
      { _id: id, usedAt: { $exists: false } },
      { $set: { usedAt: new Date() } },
      { new: true },
    );
    ensure(claimed, 400, "CODE_INVALID");
    return row;
  });
}
export function parseOpaque(value: string) {
  const [id, secret] = value.split(".");
  ensure(
    /^[a-f0-9]{24}$/.test(id ?? "") && /^[a-f0-9]{64}$/.test(secret ?? ""),
    401,
    "UNAUTHORIZED",
  );
  return { id, secret };
}
export async function rotate(refresh: string, csrf: string) {
  const { id, secret } = parseOpaque(refresh);
  return runIdentity(async () => {
    const current = await Session.findOne({
      _id: id,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    }).select("+refreshHash +usedRefreshHashes +csrfHash");
    ensure(
      current && safeEqual(current.csrfHash ?? "", digest(csrf)),
      401,
      "UNAUTHORIZED",
    );
    if (!safeEqual(current.refreshHash ?? "", digest(secret))) {
      if (current.usedRefreshHashes?.includes(digest(secret)))
        await Session.updateOne(
          { _id: id },
          { $set: { revokedAt: new Date() } },
        );
      throw new AppError(401, "UNAUTHORIZED");
    }
    ensure(
      (current.usedRefreshHashes?.length ?? 0) < 1000,
      401,
      "UNAUTHORIZED",
    );
    const member = await firstMembership(
      String(current.userId),
      String(current.organizationId),
    );
    ensure(member, 403, "MEMBERSHIP_REQUIRED");
    const user = await User.findById(current.userId);
    ensure(
      user?.emailVerifiedAt && user.authVersion === current.authVersion,
      401,
      "UNAUTHORIZED",
    );
    const access = random(),
      next = random();
    const claimed = await Session.findOneAndUpdate(
      { _id: id, refreshHash: digest(secret), revokedAt: { $exists: false } },
      {
        $set: {
          accessHash: digest(access),
          refreshHash: digest(next),
          accessExpiresAt: new Date(Date.now() + 15 * 60000),
        },
        $push: { usedRefreshHashes: digest(secret) },
      },
      { new: true },
    );
    if (!claimed) {
      await Session.updateOne({ _id: id }, { $set: { revokedAt: new Date() } });
      throw new AppError(401, "UNAUTHORIZED");
    }
    return {
      access: id + "." + access,
      refresh: id + "." + next,
      csrf,
      expiresAt: current.expiresAt,
    };
  });
}
