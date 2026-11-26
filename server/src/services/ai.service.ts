// Adapted from GlobalCRM AgentAiProvider/AgentAiSettings and agent/openai-provider.ts @ a94a285.
// One organization provider, encrypted secret, bounded test call, no CRM tools.
import mongoose from "mongoose";
import { AgentAiProvider } from "../models";
import { encrypt } from "./credential-crypto";
import { tenantContext } from "../models/tenant-context";
import { ensure, AppError } from "../errors";
import { absorbUnknownUsage, reserve, settle } from "./usage.service";
import { aiBase, aiFetch, localAiBase } from "./ai-target";
import { audit } from "./audit.service";
import {
  AiUsageUnknownError,
  usageUnknown,
  usageUnknownReasonOf,
} from "./ai-usage-unknown";
import {
  requireTextProvider,
  resolveTextProvider,
  settingsManaged,
} from "./ai-provider-resolve";
const TASK_KEYS = [
  "research",
  "interview",
  "design",
  "content",
  "review",
  "rewrite",
] as const;

type TaskRouteKey = (typeof TASK_KEYS)[number];
type TaskModelConfig = Partial<Record<TaskRouteKey, string>>;
type TemperatureConfig = Partial<Record<TaskRouteKey, number>>;

function normalizeTaskModels(raw: unknown): TaskModelConfig {
  const out: TaskModelConfig = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of TASK_KEYS) {
    const val = (raw as Record<string, unknown>)[key];
    if (typeof val === "string" && val.trim()) {
      out[key] = val.trim().slice(0, 120);
    }
  }
  return out;
}

function normalizeTemperatures(raw: unknown): TemperatureConfig {
  const out: TemperatureConfig = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of TASK_KEYS) {
    const val = (raw as Record<string, unknown>)[key];
    if (typeof val === "number" && Number.isFinite(val) && val >= 0 && val <= 2) {
      out[key] = Math.round(val * 100) / 100;
    }
  }
  return out;
}

/**
 * S36: when the platform provides AI (or organization keys are not allowed in
 * production), customers only learn that the service is managed and whether it
 * is available; model names and service URLs are never returned.
 */
export async function managedProviderStatus() {
  const available = !!(await resolveTextProvider());
  return {
    managed: true as const,
    enabled: available,
    configured: available,
  };
}
export async function getProvider() {
  if (settingsManaged("text")) return managedProviderStatus();
  const p = await AgentAiProvider.findOne({ name: "default" });
  return p
    ? {
        modelName: p.modelName,
        visionModelName: p.visionModelName ?? "",
        supportsVision: !!p.supportsVision,
        outputMode:
          p.outputMode === "json_schema" ? ("json_schema" as const) : ("json_object" as const),
        taskModels: normalizeTaskModels(p.taskModels),
        temperatureByTask: normalizeTemperatures(p.temperatureByTask),
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        configured: !!p.secret,
      }
    : {
        enabled: false,
        configured: false,
        modelName: "",
        visionModelName: "",
        outputMode: "json_object" as const,
        taskModels: {},
        temperatureByTask: {},
        baseUrl: localAiBase() ?? "https://api.openai.com/v1",
      };
}
export async function saveProvider(
  input: {
    modelName: string;
    visionModelName?: string;
    baseUrl: string;
    enabled: boolean;
    supportsVision?: boolean;
    outputMode?: "json_object" | "json_schema";
    taskModels?: TaskModelConfig;
    temperatureByTask?: TemperatureConfig;
    apiKey?: string;
  },
  userId: string,
) {
  ensure(!settingsManaged("text"), 409, "PLATFORM_MANAGED");
  const normalizedBase = (await aiBase(input.baseUrl)).href.replace(/\/+$/, "");
  const org = tenantContext()?.organizationId;
  ensure(org);
  const existing = await AgentAiProvider.findOne({ name: "default" });
  ensure(
    !input.enabled || input.apiKey || existing?.secret,
    400,
    "AI_KEY_REQUIRED",
  );
  const visionModel = (input.visionModelName ?? "").trim();
  const value = {
    modelName: input.modelName.trim(),
    visionModelName: visionModel,
    supportsVision: !!input.supportsVision,
    outputMode: input.outputMode ?? existing?.outputMode ?? "json_object",
    taskModels:
      input.taskModels !== undefined
        ? normalizeTaskModels(input.taskModels)
        : normalizeTaskModels(existing?.taskModels),
    temperatureByTask:
      input.temperatureByTask !== undefined
        ? normalizeTemperatures(input.temperatureByTask)
        : normalizeTemperatures(existing?.temperatureByTask),
    baseUrl: normalizedBase,
    enabled: input.enabled,
    ...(input.apiKey ? { secret: encrypt(input.apiKey, "ai:" + org) } : {}),
  };
  await AgentAiProvider.updateOne(
    { name: "default" },
    { $set: value },
    { upsert: true },
  );
  await audit("ai.provider.updated", userId);
  return getProvider();
}
export async function testProvider(operationId: string) {
  ensure(!settingsManaged("text"), 409, "PLATFORM_MANAGED");
  const provider = await requireTextProvider();
  const url = await aiBase(provider.baseUrl);
  ensure(await reserve("ai_tokens", 4096, operationId), 409, "CONFLICT");
  try {
    const response = await aiFetch(
      url.href.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + provider.apiKey(),
        },
        body: JSON.stringify({
          model: provider.modelName,
          messages: [{ role: "user", content: "Reply with OK." }],
          max_tokens: 16,
        }),
      },
    );
    if (!response.ok) {
      await settle("ai_tokens", operationId, 0);
      throw new AppError(502, "AI_REQUEST_FAILED");
    }
    const raw = await response.text();
    ensure(raw.length < 65536, 502, "AI_REQUEST_FAILED");
    const body = JSON.parse(raw);
    const tokens = body.usage?.total_tokens;
    if (!Number.isSafeInteger(tokens) || tokens < 0)
      throw new AiUsageUnknownError("usage_missing");
    if (tokens > 4096) throw new AiUsageUnknownError("usage_over_budget");
    await settle("ai_tokens", operationId, tokens);
    return { ok: true, tokens };
  } catch (e) {
    if (e instanceof AppError && e.code === "AI_REQUEST_FAILED") throw e;
    const unknownErr = usageUnknown(e, "request");
    const reason = usageUnknownReasonOf(unknownErr) ?? "unrecorded";
    await mongoose.connection.transaction(async (session) => {
      await absorbUnknownUsage("ai_tokens", operationId, reason, session);
    });
    throw unknownErr;
  }
}
