import type mongoose from "mongoose";
import type { z } from "zod";
import type { AgentResult } from "../site-agent-provider.service";
import type * as v from "../../validators/sites.validator";

export type Block = z.infer<typeof v.block>;
export type DesignDirection = z.infer<typeof v.designOutput>["directions"][number];
export type PageInput = v.PageInput;
export type Plan = v.Plan;

export type AgentStepName =
  | "research"
  | "interview"
  | "design"
  | "content"
  | "rewrite"
  | "review"
  | "refine";

export type AgentOutputMode = "json_object" | "json_schema";

export type TaskModelMap = Partial<Record<AgentStepName, string>>;

export type TemperatureByTask = Partial<Record<AgentStepName, number>>;

export type AgentHistoryEntry = {
  attempt: number;
  status: string;
  tokens: number;
  elapsedMs: number;
  errorCode: string | null;
  invalidReason?: "truncated" | "non_json" | null;
  repaired?: boolean;
  modelName?: string | null;
};

export type AgentValidationFeedback = {
  path: string;
  code: string;
  qualityCode?: string;
  maximum?: number;
  minimum?: number;
};

export type AgentCaptureMetric = {
  width: number;
  overflow: boolean;
  brokenImages: number;
  height?: number;
  emptySections?: number;
  h1Width?: number;
  h1Height?: number;
  h1LineHeight?: number;
};

export type AgentCaptureData = {
  artifactKey: string;
  metrics: AgentCaptureMetric[];
};

export type AgentSnapshotFact = {
  id: string;
  subjectType: string;
  subjectId: string | null;
  type: string;
  value: string;
  unit?: string | null;
  status: string;
  revision: number;
};

export type AgentSnapshotProduct = {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  specs?: string | null;
  specTable?: Array<{ label: string; value: string }>;
  material?: string | null;
  application?: string | null;
  certifications?: string | null;
  moq?: string | null;
  leadTime?: string | null;
  assetIds?: string[];
  revision: number;
};

export type AgentSnapshotPage = PageInput & {
  id: string;
  nodeKey: string;
  path: string;
  type: string;
  productId?: string | null;
};

export type AgentSnapshotSite = {
  id: string;
  name: string;
  templateId: string;
  targetMarkets: string[];
  language: string;
  brandColor?: string;
  productIds: string[];
  businessBrief?: string;
  buyerProfile?: {
    audiences?: string[];
    primaryAction?: string;
    referenceUrls?: string[];
  } | null;
  designDirection?: {
    key?: string;
    label?: string;
    visualStyle?: string;
    density?: string;
    detailNodeKey?: string;
    composition?: NonNullable<PageInput["presentation"]>["composition"];
  } | null;
  plan?: Plan | null;
  revision: number;
  planRevision: number;
  planConfirmed?: boolean;
};

export type AgentInputSnapshot = {
  pages: AgentSnapshotPage[];
  skillProfile?: {
    version: string;
    hash: string;
    guidance: string;
  };
  site: AgentSnapshotSite;
  products: AgentSnapshotProduct[];
  facts: AgentSnapshotFact[];
  pendingTypes: Array<{ type: string; subjectId: string | null }>;
};

export type AgentPlanNode = Plan["nodes"][number];

export type AgentStepUnit = {
  key: string;
  node?: AgentPlanNode;
  directionKey?: "primary" | "alternate";
  pageKind?: "home" | "detail";
  detailNode?: AgentPlanNode;
  expectedRevision?: number;
  detailRevision?: number;
  draft?: PageInput;
  review?: {
    summary: string;
    findings: Array<{
      blockKey: string | null;
      code: string;
      severity: "warning" | "error";
      recommendation: string;
    }>;
  };
  beforeCapture?: AgentCaptureData;
  afterCapture?: AgentCaptureData;
  afterCaptureKey?: string;
  capture?: AgentCaptureData;
  captureKey?: string;
  visualInput?: boolean;
  reviewMode?: "structural" | "text" | "visual";
  referenceResearch?: unknown[];
  previousDirections?: DesignDirection[];
  reusedProposal?: DesignDirection;
  reusedPageOutput?: {
    label: string;
    rationale: string;
    page: PageInput;
  };
  reusedFromRunId?: string;
  candidateCipher?: unknown;
  repairCandidateCipher?: unknown;
  repairCandidatePurpose?: string;
  draftCandidate?: {
    label: string;
    rationale: string;
    page: PageInput;
  };
  /** Localized repair hint: when only 1-2 blocks fail validation, track their keys */
  failedBlockKeys?: string[];
  instructions?: string;
  inputSummary?: {
    pageTitle: string;
    products: number;
    confirmedFacts: number;
    inputHash: string;
  };
  status: string;
  attempts: number;
  output: unknown;
  pendingResult?: AgentResult;
  operationId?: string;
  startedAt?: Date | string;
  tokens: number;
  elapsedMs: number;
  errorCode: string | null;
  responseDiagnostics?: AgentResult["responseDiagnostics"];
  validationFeedback?: AgentValidationFeedback[];
  history: AgentHistoryEntry[];
};

export type AgentRunDoc = mongoose.Document & {
  _id: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId | string;
  kind: string;
  siteId: mongoose.Types.ObjectId | string;
  step: AgentStepName;
  lockKey: string;
  active: boolean;
  status: string;
  cancelRequested: boolean;
  retryGeneration: number;
  actorId: mongoose.Types.ObjectId | string;
  requestKey: string;
  requestHash: string;
  qualityAcceptedAt?: Date | null;
  qualityAcceptedBy?: mongoose.Types.ObjectId | string | null;
  inputSnapshot: AgentInputSnapshot;
  inputSummary: {
    siteName: string;
    pages: number;
    products: number;
    confirmedFacts: number;
  };
  steps: AgentStepUnit[];
  tokens: number;
  elapsedMs: number;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentTaskDoc = {
  _id: mongoose.Types.ObjectId | string;
  operationId: string;
  payload: { runId?: string };
  owner?: string;
  fencingToken: number;
};

export type AgentDiagnosticsSummary = {
  attempts: number;
  repairedCount: number;
  truncatedCount: number;
  nonJsonCount: number;
  modelsUsed: string[];
};

export type ProviderCallable = (
  system: string,
  input: unknown,
  operationId: string,
  save: (r: AgentResult) => Promise<void>,
  images?: { label: string; data: string }[],
) => Promise<AgentResult>;

export type ReviewCapturer = (
  snapshot: unknown,
  pagePath: string,
  captureKey: string,
) => Promise<AgentCaptureData>;

export type AgentProcessOutcome = {
  status: "done" | "dead" | "pending";
  error?: string;
};

export type TypedBlock = Block;
