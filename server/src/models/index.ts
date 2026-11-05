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
export function entity<T>(
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
    fileName: String,
    kind: { type: String, default: "image" },
    totalBytes: Number,
    variants: Schema.Types.Mixed,
    width: Number,
    height: Number,
    referenceVersion: { type: Number, default: 0 },
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

export const Product = entity<any>(
  "Product",
  {
    referenceVersion: { type: Number, default: 0 },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    category: String,
    description: String,
    specs: { type: [Schema.Types.Mixed], default: [] },
    specTable: Schema.Types.Mixed,
    material: String,
    application: String,
    certifications: { type: [String], default: [] },
    moq: String,
    leadTime: String,
    assetIds: { type: [Schema.Types.ObjectId], default: [] },
    source: { type: String, enum: ["local", "globalcrm"], default: "local" },
    externalRef: Schema.Types.Mixed,
    provenance: Schema.Types.Mixed,
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "draft",
    },
    revision: { type: Number, default: 1 },
    importKey: String,
  },
  {},
  [
    [{ organizationId: 1, sku: 1 }, { unique: true }],
    [{ organizationId: 1, status: 1, updatedAt: -1, _id: -1 }],
    [
      { organizationId: 1, importKey: 1 },
      {
        unique: true,
        partialFilterExpression: { importKey: { $type: "string" } },
      },
    ],
    [
      {
        organizationId: 1,
        "externalRef.connectionId": 1,
        "externalRef.remoteId": 1,
      },
      {
        unique: true,
        partialFilterExpression: {
          "externalRef.connectionId": { $type: "string" },
          "externalRef.remoteId": { $type: "string" },
        },
      },
    ],
  ],
);
export const FactSheet = entity<any>(
  "FactSheet",
  {
    subjectType: {
      type: String,
      enum: ["organization", "product"],
      required: true,
    },
    subjectId: Schema.Types.ObjectId,
    type: { type: String, required: true },
    value: { type: String, required: true },
    unit: String,
    source: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["candidate", "confirmed", "rejected"],
      default: "candidate",
    },
    revision: { type: Number, default: 1 },
    reviewedBy: Schema.Types.ObjectId,
    reviewedAt: Date,
    reason: String,
    originKey: String,
  },
  {},
  [
    [{ organizationId: 1, status: 1, updatedAt: -1, _id: -1 }],
    [{ organizationId: 1, subjectType: 1, subjectId: 1, type: 1 }],
    [
      { organizationId: 1, originKey: 1 },
      {
        unique: true,
        partialFilterExpression: { originKey: { $type: "string" } },
      },
    ],
  ],
);
export const FactRevision = entity<any>(
  "FactRevision",
  {
    factId: ref,
    revision: Number,
    actorId: Schema.Types.ObjectId,
    action: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
  },
  {},
  [[{ organizationId: 1, factId: 1, revision: 1 }, { unique: true }]],
);
export const ProductImport = entity<any>(
  "ProductImport",
  {
    errorCode: String,
    fileName: String,
    headers: [String],
    rows: Schema.Types.Mixed,
    mapping: Schema.Types.Mixed,
    report: Schema.Types.Mixed,
    selectedRows: [Number],
    confirmedRevision: Number,
    status: { type: String, default: "preview" },
    revision: { type: Number, default: 1 },
    actorId: ref,
    results: { type: [Schema.Types.Mixed], default: [] },
  },
  {},
  [[{ organizationId: 1, createdAt: -1, _id: -1 }]],
);
export const AgentRun = entity<any>(
  "AgentRun",
  {
    kind: String,
    source: Schema.Types.Mixed,
    actorId: ref,
    status: { type: String, default: "queued" },
    errorCode: String,
    resultIds: { type: [Schema.Types.ObjectId], default: [] },
    rejectedCount: Number,
    tokens: Number,
    pendingResult: Schema.Types.Mixed,
  },
  {},
  [[{ organizationId: 1, createdAt: -1, _id: -1 }]],
);
export const WebsiteRead = entity<any>(
  "WebsiteRead",
  {
    url: String,
    maxPages: Number,
    actorId: ref,
    status: { type: String, default: "queued" },
    errorCode: String,
    pages: { type: [Schema.Types.Mixed], default: [] },
    resultIds: { type: [Schema.Types.ObjectId], default: [] },
    factIds: { type: [Schema.Types.ObjectId], default: [] },
    truncated: Boolean,
  },
  {},
  [[{ organizationId: 1, createdAt: -1, _id: -1 }]],
);

export const models = [
  Product,
  FactSheet,
  FactRevision,
  ProductImport,
  AgentRun,
  WebsiteRead,
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
