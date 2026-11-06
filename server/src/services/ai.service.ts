// Adapted from GlobalCRM AgentAiProvider/AgentAiSettings and agent/openai-provider.ts @ a94a285.
// One organization provider, encrypted secret, bounded test call, no CRM tools.
import { AgentAiProvider } from "../models";
import { encrypt, decrypt } from "./credential-crypto";
import { tenantContext } from "../models/tenant-context";
import { ensure, AppError } from "../errors";
import { reserve, settle } from "./usage.service";
import { aiBase, aiFetch, localAiBase } from "./ai-target";
import { audit } from "./audit.service";
export async function getProvider() {
  const p = await AgentAiProvider.findOne({ name: "default" });
  return p
    ? {
        modelName: p.modelName,
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        configured: !!p.secret,
      }
    : {
        enabled: false,
        configured: false,
        modelName: "",
        baseUrl: localAiBase() ?? "https://api.openai.com/v1",
      };
}
export async function saveProvider(
  input: {
    modelName: string;
    baseUrl: string;
    enabled: boolean;
    apiKey?: string;
  },
  userId: string,
) {
  await aiBase(input.baseUrl);
  const org = tenantContext()?.organizationId;
  ensure(org);
  const existing = await AgentAiProvider.findOne({ name: "default" });
  ensure(
    !input.enabled || input.apiKey || existing?.secret,
    400,
    "AI_KEY_REQUIRED",
  );
  const value = {
    modelName: input.modelName,
    baseUrl: input.baseUrl,
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
  const provider = await AgentAiProvider.findOne({ name: "default" });
  ensure(provider?.enabled && provider.secret, 409, "AI_UNCONFIGURED");
  const org = tenantContext()?.organizationId;
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
          Authorization: "Bearer " + decrypt(provider.secret, "ai:" + org),
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
    ensure(
      Number.isSafeInteger(tokens) && tokens >= 0 && tokens <= 4096,
      502,
      "AI_USAGE_UNKNOWN",
    );
    await settle("ai_tokens", operationId, tokens);
    return { ok: true, tokens };
  } catch (e) {
    if (e instanceof AppError && e.code === "AI_REQUEST_FAILED") throw e;
    // Unknown provider outcome stays reserved for reconciliation, preventing free retries.
    throw new AppError(502, "AI_USAGE_UNKNOWN");
  }
}
