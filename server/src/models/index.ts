import type {
  UserRow,
  OrganizationRow,
  MembershipRow,
  SessionRow,
  AuthTokenRow,
  AuditRow,
  UsageRow,
  BucketRow,
  AssetRow,
  TaskRow,
  ProviderRow,
  MigrationRow,
  RateLimitRow,
} from "./types";
import mongoose, { Schema } from "mongoose";
import { applyTenant } from "./tenant-setup";
function entity<T>(
  name: string,
  fields: Record<string, any>,
  options: {
    identity?: boolean;
    authLookup?: boolean;
    scheduler?: boolean;
  } = {},
  indexes: Array<[Record<string, any>, Record<string, any>?]> = [],
): mongoose.Model<T> {
  const schema = new Schema(fields, { timestamps: true, versionKey: false });
  schema.plugin(applyTenant, options);
  for (const [keys, opts] of indexes) schema.index(keys, opts);
  return mongoose.model(name, schema) as unknown as mongoose.Model<T>;
}
const ref = { type: Schema.Types.ObjectId, required: true };
export const User = entity<UserRow>(
  "User",
  {
    authVersion: { type: Number, default: 0 },
    emailNormalized: { type: String, required: true, unique: true },
    name: String,
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: Date,
    twoFactorEnabled: { type: Boolean, default: false },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: Date,
    locale: { type: String, enum: ["zh", "en"], default: "zh" },
  },
  { identity: true },
);
export const Organization = entity<OrganizationRow>(
  "Organization",
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    ownerUserId: ref,
    plan: {
      type: String,
      enum: ["trial", "starter", "growth"],
      default: "trial",
    },
    status: { type: String, default: "active" },
  },
  { identity: true },
);
export const Membership = entity<MembershipRow>(
  "Membership",
  {
    userId: Schema.Types.ObjectId,
    invitedEmail: String,
    role: { type: String, enum: ["admin", "editor", "viewer"], required: true },
    status: {
      type: String,
      enum: ["invited", "active", "revoked"],
      required: true,
    },
    inviteTokenHash: { type: String, select: false },
    inviteExpiresAt: Date,
  },
  { authLookup: true },
  [
    [
      { organizationId: 1, userId: 1 },
      {
        unique: true,
        partialFilterExpression: { userId: { $type: "objectId" } },
      },
    ],
    [
      { organizationId: 1, invitedEmail: 1 },
      {
        unique: true,
        partialFilterExpression: { invitedEmail: { $type: "string" } },
      },
    ],
  ],
);
export const Session = entity<SessionRow>(
  "Session",
  {
    authVersion: { type: Number, default: 0 },
    userId: ref,
    accessHash: { type: String, select: false },
    refreshHash: { type: String, select: false },
    usedRefreshHashes: { type: [String], default: [], select: false },
    csrfHash: { type: String, select: false },
    accessExpiresAt: Date,
    expiresAt: Date,
    revokedAt: Date,
    userAgent: String,
  },
  { authLookup: true },
  [
    [{ organizationId: 1, userId: 1 }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export const AuthToken = entity<AuthTokenRow>(
  "AuthToken",
  {
    authVersion: { type: Number, default: 0 },
    userId: ref,
    kind: {
      type: String,
      enum: ["verify", "reset", "login2fa", "security2fa"],
      required: true,
    },
    tokenHash: { type: String, required: true, select: false },
    codeHash: { type: String, select: false },
    attempts: { type: Number, default: 0 },
    expiresAt: Date,
    usedAt: Date,
  },
  { authLookup: true },
  [
    [{ tokenHash: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export const AuditLog = entity<AuditRow>(
  "AuditLog",
  {
    actorId: Schema.Types.ObjectId,
    action: { type: String, required: true },
    targetId: String,
    requestId: String,
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 86400000),
    },
  },
  {},
  [
    [{ organizationId: 1, createdAt: -1 }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export const UsageRecord = entity<UsageRow>(
  "UsageRecord",
  {
    period: String,
    metric: String,
    operationId: String,
    amount: Number,
    state: { type: String, enum: ["reserved", "settled", "released"] },
    actual: Number,
  },
  {},
  [[{ organizationId: 1, metric: 1, operationId: 1 }, { unique: true }]],
);
export const UsageBucket = entity<BucketRow>(
  "UsageBucket",
  {
    period: String,
    metric: String,
    consumed: { type: Number, default: 0 },
    reserved: { type: Number, default: 0 },
  },
  {},
  [[{ organizationId: 1, period: 1, metric: 1 }, { unique: true }]],
);
export const Asset = entity<AssetRow>(
  "Asset",
  {
    key: { type: String, required: true },
    bytes: Number,
    mime: String,
    sha256: String,
    status: { type: String, default: "ready" },
  },
  {},
  [[{ organizationId: 1, key: 1 }, { unique: true }]],
);
export const Task = entity<TaskRow>(
  "Task",
  {
    kind: String,
    payload: Schema.Types.Mixed,
    operationId: String,
    status: {
      type: String,
      enum: ["pending", "running", "done", "dead"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: Date,
    owner: String,
    fencingToken: { type: Number, default: 0 },
    lastErrorCode: String,
  },
  { scheduler: true },
  [
    [{ organizationId: 1, operationId: 1 }, { unique: true }],
    [{ status: 1, nextAttemptAt: 1, leaseUntil: 1 }],
  ],
);
export const AgentAiProvider = entity<ProviderRow>(
  "AgentAiProvider",
  {
    name: String,
    modelName: String,
    baseUrl: String,
    enabled: { type: Boolean, default: false },
    secret: Schema.Types.Mixed,
  },
  {},
  [[{ organizationId: 1, name: 1 }, { unique: true }]],
);
export const RateLimit = entity<RateLimitRow>(
  "RateLimit",
  {
    key: { type: String, unique: true },
    count: { type: Number, default: 0 },
    expiresAt: Date,
  },
  { identity: true },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
);
export const Migration = entity<MigrationRow>(
  "Migration",
  { key: { type: String, unique: true }, completedAt: Date },
  { identity: true },
);
export const models = [
  User,
  Organization,
  Membership,
  Session,
  AuthToken,
  AuditLog,
  UsageRecord,
  UsageBucket,
  Asset,
  Task,
  AgentAiProvider,
  RateLimit,
  Migration,
];
