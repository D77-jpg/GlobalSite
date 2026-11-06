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
    publicLookup?: boolean;
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
    siteLock: { type: Number, default: 0 },
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
    crmImportKey: String,
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
  [
    [{ organizationId: 1, key: 1 }, { unique: true }],
    [
      { organizationId: 1, crmImportKey: 1 },
      {
        unique: true,
        partialFilterExpression: { crmImportKey: { $type: "string" } },
      },
    ],
  ],
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
    crmSourceStatus: String,
    syncCandidate: Schema.Types.Mixed,
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
    referenceVersion: { type: Number, default: 0 },
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
    siteId: Schema.Types.ObjectId,
    step: String,
    lockKey: String,
    active: Boolean,
    requestKey: String,
    requestHash: String,
    cancelRequested: { type: Boolean, default: false },
    inputSnapshot: Schema.Types.Mixed,
    inputSummary: Schema.Types.Mixed,
    steps: { type: [Schema.Types.Mixed], default: [] },
    retryGeneration: { type: Number, default: 0 },
    elapsedMs: { type: Number, default: 0 },
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
  [
    [{ organizationId: 1, createdAt: -1, _id: -1 }],
    [
      { organizationId: 1, siteId: 1, lockKey: 1 },
      { unique: true, partialFilterExpression: { active: true } },
    ],
    [
      { organizationId: 1, requestKey: 1 },
      {
        unique: true,
        partialFilterExpression: { requestKey: { $type: "string" } },
      },
    ],
  ],
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

export const Site = entity<any>(
  "Site",
  {
    name: { type: String, required: true },
    templateId: String,
    targetMarkets: [String],
    language: { type: String, default: "en" },
    brandColor: String,
    logoId: Schema.Types.ObjectId,
    productIds: [Schema.Types.ObjectId],
    status: { type: String, default: "draft" },
    revision: { type: Number, default: 1 },
    lockVersion: { type: Number, default: 0 },
    planRevision: { type: Number, default: 1 },
    plan: Schema.Types.Mixed,
    confirmedPlanHash: String,
    planReviewedBy: Schema.Types.ObjectId,
    planReviewedAt: Date,
    versionCounter: { type: Number, default: 0 },
    currentDeploymentId: Schema.Types.ObjectId,
  },
  {},
  [[{ organizationId: 1, createdAt: -1, _id: -1 }]],
);
export const SitePage = entity<any>(
  "SitePage",
  {
    siteId: ref,
    nodeKey: String,
    retiredPath: String,
    path: String,
    type: String,
    productId: Schema.Types.ObjectId,
    title: String,
    metaDescription: String,
    refs: Schema.Types.Mixed,
    revision: { type: Number, default: 1 },
    reviewStatus: { type: String, default: "draft" },
    approvedHash: String,
    reviewedBy: Schema.Types.ObjectId,
    reviewedAt: Date,
    reviewReason: String,
    originRunId: Schema.Types.ObjectId,
  },
  {},
  [
    [{ organizationId: 1, siteId: 1, nodeKey: 1 }, { unique: true }],
    [{ organizationId: 1, siteId: 1, path: 1 }, { unique: true }],
  ],
);
export const SiteBlock = entity<any>(
  "SiteBlock",
  {
    siteId: ref,
    pageId: ref,
    key: String,
    type: String,
    heading: String,
    body: String,
    table: Schema.Types.Mixed,
    faq: Schema.Types.Mixed,
    assetId: Schema.Types.ObjectId,
    alt: String,
    refs: Schema.Types.Mixed,
    order: Number,
    revision: { type: Number, default: 1 },
  },
  {},
  [
    [{ organizationId: 1, pageId: 1, key: 1 }, { unique: true }],
    [{ organizationId: 1, siteId: 1, pageId: 1, order: 1 }],
  ],
);

export const PublishingSettings = entity<any>(
  "PublishingSettings",
  {
    siteId: ref,
    revision: { type: Number, default: 1 },
    canonicalBaseUrl: String,
    accountId: String,
    projectName: String,
    productionBranch: { type: String, default: "main" },
    domain: String,
    secret: { type: Schema.Types.Mixed, select: false },
    httpsStatus: String,
    checkedAt: Date,
  },
  {},
  [[{ organizationId: 1, siteId: 1 }, { unique: true }]],
);
export const SiteVersion = entity<any>(
  "SiteVersion",
  {
    siteId: ref,
    number: Number,
    actorId: ref,
    operationId: String,
    requestHash: String,
    status: { type: String, default: "queued" },
    snapshot: Schema.Types.Mixed,
    snapshotHash: String,
    artifactKey: String,
    artifactHash: String,
    bytes: { type: Number, default: 0 },
    errorCode: String,
    report: Schema.Types.Mixed,
    active: Boolean,
  },
  {},
  [
    [{ organizationId: 1, siteId: 1, number: 1 }, { unique: true }],
    [{ organizationId: 1, operationId: 1 }, { unique: true }],
    [
      { organizationId: 1, siteId: 1, active: 1 },
      { unique: true, partialFilterExpression: { active: true } },
    ],
  ],
);
export const SiteDeployment = entity<any>(
  "SiteDeployment",
  {
    siteId: ref,
    versionId: ref,
    actorId: ref,
    createdBy: ref,
    operationId: String,
    requestHash: String,
    status: { type: String, default: "queued" },
    kind: String,
    artifactHash: String,
    settingsRevision: Number,
    providerId: String,
    providerUrl: String,
    origins: [String],
    url: String,
    errorCode: String,
    active: Boolean,
    attemptedAt: Date,
  },
  {},
  [
    [{ organizationId: 1, operationId: 1 }, { unique: true }],
    [
      { organizationId: 1, siteId: 1, active: 1 },
      { unique: true, partialFilterExpression: { active: true } },
    ],
  ],
);

export const InquiryGatewayRoute = entity<any>(
  "InquiryGatewayRoute",
  {
    siteId: ref,
    publicId: { type: String, required: true },
    enabled: { type: Boolean, default: true },
  },
  { publicLookup: true },
  [
    [{ publicId: 1 }, { unique: true }],
    [{ organizationId: 1, siteId: 1 }, { unique: true }],
  ],
);
export const InquirySettings = entity<any>(
  "InquirySettings",
  {
    siteId: ref,
    revision: { type: Number, default: 1 },
    enabled: { type: Boolean, default: false },
    privacyReviewed: { type: Boolean, default: false },
    aiSpamEnabled: { type: Boolean, default: false },
    notificationUserIds: [Schema.Types.ObjectId],
    turnstileSiteKey: String,
    secret: { type: Schema.Types.Mixed, select: false },
  },
  {},
  [[{ organizationId: 1, siteId: 1 }, { unique: true }]],
);
export const SiteInquiry = entity<any>(
  "SiteInquiry",
  {
    siteId: ref,
    versionId: ref,
    submissionId: String,
    receiptId: String,
    requestHash: String,
    secret: { type: Schema.Types.Mixed, select: false },
    notesSecret: { type: Schema.Types.Mixed, select: false },
    emailHash: String,
    receivedAt: { type: Date, default: Date.now },
    revision: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ["new", "following", "resolved", "spam"],
      default: "new",
    },
    spamScore: { type: Number, default: 0 },
    classification: { type: String, default: "pending" },
    reasons: [String],
    duplicateOf: Schema.Types.ObjectId,
    processedAt: Date,
    aiResult: { type: Schema.Types.Mixed, select: false },
    notificationStatus: { type: String, default: "pending" },
    crm: Schema.Types.Mixed,
    attachmentIds: [Schema.Types.ObjectId],
  },
  {},
  [
    [{ organizationId: 1, siteId: 1, submissionId: 1 }, { unique: true }],
    [{ organizationId: 1, receivedAt: -1, _id: -1 }],
    [{ organizationId: 1, siteId: 1, status: 1, receivedAt: -1 }],
    [{ organizationId: 1, duplicateOf: 1 }],
  ],
);
export const InquiryAttachment = entity<any>(
  "InquiryAttachment",
  {
    inquiryId: ref,
    key: String,
    mime: String,
    bytes: Number,
    storedBytes: Number,
  },
  {},
  [[{ organizationId: 1, inquiryId: 1 }]],
);
export const InquiryDedupe = entity<any>(
  "InquiryDedupe",
  {
    siteId: ref,
    emailHash: String,
    rootId: Schema.Types.ObjectId,
    lastAt: Date,
    lockVersion: { type: Number, default: 0 },
    expiresAt: Date,
  },
  {},
  [
    [{ organizationId: 1, siteId: 1, emailHash: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export const InquiryDelivery = entity<any>(
  "InquiryDelivery",
  {
    inquiryId: ref,
    userId: ref,
    status: { type: String, default: "pending" },
    attempts: { type: Number, default: 0 },
    attemptedAt: Date,
    sentAt: Date,
    errorCode: String,
  },
  {},
  [[{ organizationId: 1, inquiryId: 1, userId: 1 }, { unique: true }]],
);
export const InquiryRateBucket = entity<any>(
  "InquiryRateBucket",
  {
    siteId: ref,
    key: String,
    minute: Number,
    count: { type: Number, default: 0 },
    expiresAt: Date,
  },
  {},
  [
    [{ organizationId: 1, siteId: 1, key: 1, minute: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);

export const CrmConnection = entity<any>(
  "CrmConnection",
  {
    baseUrl: String,
    projectId: String,
    projectName: String,
    secret: { type: Schema.Types.Mixed, select: false },
    credentialFingerprint: { type: String, select: false },
    actorId: Schema.Types.ObjectId,
    revision: { type: Number, default: 1 },
    generation: { type: Number, default: 1 },
    active: { type: Boolean, default: true },
    status: { type: String, default: "checking" },
    scopes: [String],
    lastCheckedAt: Date,
    lastErrorCode: String,
    ioOwner: String,
    ioUntil: Date,
  },
  {},
  [
    [{ organizationId: 1, baseUrl: 1, projectId: 1 }, { unique: true }],
    [
      { organizationId: 1, active: 1 },
      { unique: true, partialFilterExpression: { active: true } },
    ],
  ],
);
export const CrmSyncState = entity<any>(
  "CrmSyncState",
  {
    connectionId: ref,
    resource: String,
    status: { type: String, default: "idle" },
    cursor: String,
    updatedSince: String,
    batchUntil: String,
    lastSuccessAt: Date,
    lastErrorCode: String,
    nextDue: { type: Date, default: Date.now },
    imported: { type: Number, default: 0 },
    full: { type: Boolean, default: false },
    seenIds: [String],
    lastFullAt: Date,
    dispatch: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    actorId: Schema.Types.ObjectId,
  },
  {},
  [[{ organizationId: 1, connectionId: 1, resource: 1 }, { unique: true }]],
);
export const OutboundDelivery = entity<any>(
  "OutboundDelivery",
  {
    inquiryId: ref,
    connectionId: ref,
    kind: { type: String, default: "crm" },
    idempotencyKey: String,
    secret: { type: Schema.Types.Mixed, select: false },
    payloadHash: String,
    status: { type: String, default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lastErrorCode: String,
    remoteId: String,
    customerId: String,
    customerUrl: String,
    remoteOutcome: Schema.Types.Mixed,
  },
  {},
  [
    [{ organizationId: 1, connectionId: 1, inquiryId: 1 }, { unique: true }],
    [{ organizationId: 1, kind: 1, idempotencyKey: 1 }, { unique: true }],
  ],
);
export const CrmImportedResource = entity<any>(
  "CrmImportedResource",
  {
    connectionId: ref,
    kind: String,
    remoteId: String,
    payload: Schema.Types.Mixed,
    factValues: [String],
    sha256: String,
    withdrawn: { type: Boolean, default: false },
    capturedAt: { type: Date, default: Date.now },
  },
  {},
  [
    [
      { organizationId: 1, connectionId: 1, kind: 1, remoteId: 1, sha256: 1 },
      { unique: true },
    ],
  ],
);
export const CrmOutcome = entity<any>(
  "CrmOutcome",
  {
    connectionId: ref,
    eventId: String,
    customerId: String,
    toStatus: String,
    occurredAt: Date,
  },
  {},
  [[{ organizationId: 1, connectionId: 1, eventId: 1 }, { unique: true }]],
);

export const models = [
  CrmConnection,
  CrmSyncState,
  OutboundDelivery,
  CrmImportedResource,
  CrmOutcome,
  InquiryGatewayRoute,
  InquirySettings,
  SiteInquiry,
  InquiryAttachment,
  InquiryDedupe,
  InquiryDelivery,
  InquiryRateBucket,
  PublishingSettings,
  SiteVersion,
  SiteDeployment,
  Site,
  SitePage,
  SiteBlock,
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
