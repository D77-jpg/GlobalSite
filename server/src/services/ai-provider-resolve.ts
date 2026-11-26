// S36: one place that decides which AI service a call uses.
//
// Priority (text and images are resolved independently):
//   1. Complete platform configuration (PLATFORM_AI_* / PLATFORM_IMAGE_*) ->
//      platform service, `managed: true`. Organization settings are ignored.
//   2. Otherwise, if ALLOW_ORG_AI_KEYS=true or NODE_ENV is not production ->
//      the organization's encrypted AgentAiProvider ("default" / "images"),
//      exactly as before S36 (local development, tests, existing pilots).
//   3. Otherwise -> unconfigured (AI_UNCONFIGURED / IMAGE_PROVIDER_MISSING).
//
// Billing never changes: callers still reserve/settle on the current
// organization's plan with their existing operation IDs. Platform base URLs
// still go through aiBase()/aiFetch() (SSRF guard + AI_ALLOWED_HOSTS) at the
// call site. Platform keys are read from the environment only; apiKey() is the
// single accessor and its value must only ever go into an Authorization header.
import mongoose from "mongoose";
import { AgentAiProvider } from "../models";
import { tenantContext } from "../models/tenant-context";
import { platformAiConfig } from "../config";
import { decrypt } from "./credential-crypto";
import { ensure } from "../errors";

export type AiProviderKind = "text" | "image";
export type AiProviderSource = "platform" | "organization" | "none";

export type ResolvedTextProvider = {
  managed: boolean;
  baseUrl: string;
  modelName: string;
  visionModelName: string;
  supportsVision: boolean;
  outputMode: "json_object" | "json_schema";
  taskModels: Record<string, string>;
  temperatureByTask: Record<string, number>;
  /** Bearer secret for the Authorization header only. Never log or return it. */
  apiKey: () => string;
};

export type ResolvedImageProvider = {
  managed: boolean;
  /** Empty for legacy organization rows; callers apply their default. */
  baseUrl: string;
  modelName: string;
  mode: "auto" | "images" | "chat";
  /** Bearer secret for the Authorization header only. Never log or return it. */
  apiKey: () => string;
};

/** Pure priority rule, shared by the resolvers, settings endpoints and tests. */
export function providerSource(
  kind: AiProviderKind,
  env: NodeJS.ProcessEnv = process.env,
): AiProviderSource {
  const platform = platformAiConfig(env);
  if (kind === "text" ? platform.text : platform.image) return "platform";
  if (platform.allowOrgKeys || !platform.production) return "organization";
  return "none";
}

/**
 * Organization AI settings are read-only for customers whenever they would not
 * be used: platform-managed, or production without ALLOW_ORG_AI_KEYS.
 */
export function settingsManaged(
  kind: AiProviderKind,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return providerSource(kind, env) !== "organization";
}

function organizationId(): string {
  const org = tenantContext()?.organizationId;
  ensure(org, 403, "TENANT_REQUIRED");
  return org;
}

function cleanRecord<T>(
  raw: unknown,
  keep: (value: unknown) => value is T,
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>))
    if (keep(value)) out[key] = value;
  return out;
}
const isModelName = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= 120;
const isTemperature = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2;

/** Text/vision service for the current organization, or null when unconfigured. */
export async function resolveTextProvider(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedTextProvider | null> {
  const source = providerSource("text", env);
  if (source === "none") return null;
  if (source === "platform") {
    const p = platformAiConfig(env).text!;
    const key = p.apiKey;
    return {
      managed: true,
      baseUrl: p.baseUrl,
      modelName: p.model,
      visionModelName: p.visionModel,
      // The platform operator enables image input by configuring a vision model.
      supportsVision: !!p.visionModel,
      outputMode: p.outputMode,
      taskModels: {},
      temperatureByTask: {},
      apiKey: () => key,
    };
  }
  const org = organizationId();
  const row = await AgentAiProvider.findOne({ name: "default" });
  if (!row?.enabled || !row.secret) return null;
  const secret = row.secret;
  return {
    managed: false,
    baseUrl: String(row.baseUrl ?? ""),
    modelName: String(row.modelName ?? ""),
    visionModelName: String(row.visionModelName ?? ""),
    supportsVision: !!row.supportsVision,
    outputMode: row.outputMode === "json_schema" ? "json_schema" : "json_object",
    taskModels: cleanRecord(row.taskModels, isModelName),
    temperatureByTask: cleanRecord(row.temperatureByTask, isTemperature),
    apiKey: () => decrypt(secret, "ai:" + org),
  };
}

/** Same as resolveTextProvider but fails with the existing AI_UNCONFIGURED code. */
export async function requireTextProvider(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedTextProvider> {
  const provider = await resolveTextProvider(env);
  ensure(provider, 409, "AI_UNCONFIGURED");
  return provider;
}

/** Image service for the current organization, or null when unconfigured. */
export async function resolveImageProvider(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedImageProvider | null> {
  const source = providerSource("image", env);
  if (source === "none") return null;
  if (source === "platform") {
    const p = platformAiConfig(env).image!;
    const key = p.apiKey;
    return {
      managed: true,
      baseUrl: p.baseUrl,
      modelName: p.model,
      mode: p.mode,
      apiKey: () => key,
    };
  }
  const org = organizationId();
  const row = await AgentAiProvider.findOne({ name: "images", enabled: true });
  if (!row?.secret) return null;
  const secret = row.secret;
  return {
    managed: false,
    baseUrl: String(row.baseUrl ?? ""),
    modelName: String(row.modelName ?? ""),
    mode: row.mode === "images" || row.mode === "chat" ? row.mode : "auto",
    apiKey: () => decrypt(secret, "image-provider:" + org),
  };
}

/**
 * Cheap availability check used before queueing image work (logo runs, auto
 * images). Keeps the pre-S36 organization rule (enabled row) and honours an
 * optional transaction session.
 */
export async function imageProviderAvailable(
  session?: mongoose.ClientSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const source = providerSource("image", env);
  if (source !== "organization") return source === "platform";
  const query = AgentAiProvider.exists({ name: "images", enabled: true });
  if (session) query.session(session);
  return !!(await query);
}
