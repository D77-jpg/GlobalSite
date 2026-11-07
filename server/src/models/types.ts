import type { Types } from "mongoose";
import type { EncryptedSecret } from "../services/credential-crypto";
type Base = {
  createdAt: Date;
  updatedAt: Date;
};
type TenantBase = Base & { organizationId: Types.ObjectId };
export type UserRow = Base & {
  authVersion: number;
  emailNormalized: string;
  name: string;
  passwordHash: string;
  emailVerifiedAt?: Date;
  twoFactorEnabled: boolean;
  failedAttempts: number;
  lockedUntil?: Date;
  locale: "zh" | "en";
};
export type OrganizationRow = Base & {
  name: string;
  slug: string;
  ownerUserId: Types.ObjectId;
  plan: "trial" | "starter" | "growth";
  status: string;
};
export type MembershipRow = TenantBase & {
  userId?: Types.ObjectId;
  invitedEmail?: string;
  role: "admin" | "editor" | "viewer";
  status: "invited" | "active" | "revoked";
  inviteTokenHash?: string;
  inviteExpiresAt?: Date;
};
export type SessionRow = TenantBase & {
  authVersion: number;
  userId: Types.ObjectId;
  accessHash: string;
  refreshHash: string;
  usedRefreshHashes: string[];
  csrfHash: string;
  accessExpiresAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  userAgent: string;
};
export type AuthTokenRow = TenantBase & {
  authVersion: number;
  userId: Types.ObjectId;
  kind: string;
  tokenHash: string;
  codeHash?: string;
  attempts: number;
  expiresAt: Date;
  usedAt?: Date;
};
export type AuditRow = TenantBase & {
  actorId?: Types.ObjectId;
  action: string;
  targetId?: string;
  requestId?: string;
  expiresAt: Date;
};
export type UsageRow = TenantBase & {
  period: string;
  metric: string;
  operationId: string;
  amount: number;
  state: string;
  actual?: number;
};
export type BucketRow = TenantBase & {
  period: string;
  metric: string;
  consumed: number;
  reserved: number;
};
export type AssetRow = TenantBase & {
  generatedConcept?: boolean;
  key: string;
  fileName?: string;
  kind?: string;
  totalBytes?: number;
  width?: number;
  height?: number;
  variants?: Record<string, { key: string; bytes: number; mime: string }>;
  bytes: number;
  mime: string;
  sha256: string;
  status: string;
};
export type TaskRow = TenantBase & {
  kind: string;
  payload: { secret: EncryptedSecret; previewHash?: string; runId?: string };
  operationId: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  owner?: string;
  fencingToken: number;
  lastErrorCode?: string;
};
export type ProviderRow = TenantBase & {
  name: string;
  modelName: string;
  supportsVision?: boolean;
  baseUrl: string;
  enabled: boolean;
  secret?: EncryptedSecret;
};
export type MigrationRow = Base & { key: string; completedAt: Date };
export type RateLimitRow = Base & {
  key: string;
  count: number;
  expiresAt: Date;
};
