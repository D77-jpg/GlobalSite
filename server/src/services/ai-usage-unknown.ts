// S35 acceptance fix: why a reserved AI call ended with an unknown outcome.
//
// Once allowance is reserved, any failure before the provider's usage is read
// and settled leaves the bill unknown (AI_USAGE_UNKNOWN). The platform absorbs
// it: the customer's reservation is released and the UsageRecord is marked
// `absorbed` with one of these fixed codes for reconciliation against provider
// bills (usage.service absorbUnknownUsage). The codes are the only diagnostic
// stored: never model text, response bodies, URLs or keys.
import { AppError } from "../errors";

export const USAGE_UNKNOWN_REASONS = [
  "timeout",
  "network",
  "body_too_large",
  "usage_missing",
  "usage_over_budget",
  "parse",
  "persist",
  // A previous attempt was interrupted (Worker restart / lost lease) while
  // its reservation was still open.
  "interrupted",
  // Paused before reasons were recorded (older runs).
  "unrecorded",
] as const;
export type UsageUnknownReason = (typeof USAGE_UNKNOWN_REASONS)[number];

/** AI_USAGE_UNKNOWN with a fixed reason code (status/code unchanged). */
export class AiUsageUnknownError extends AppError {
  constructor(public readonly reason: UsageUnknownReason) {
    super(502, "AI_USAGE_UNKNOWN");
  }
}

/** Where the call was when it failed: before/while reading the response, or saving it. */
export type UsageUnknownStage = "request" | "persist";

const errorName = (value: unknown): string =>
  value && typeof value === "object" && "name" in value
    ? String((value as { name: unknown }).name)
    : "";
const errorCause = (value: unknown): unknown =>
  value && typeof value === "object" && "cause" in value
    ? (value as { cause: unknown }).cause
    : undefined;

/** AbortSignal.timeout() rejects fetch with TimeoutError; node:http aborts with AbortError. */
export function isTimeoutError(error: unknown): boolean {
  return [error, errorCause(error)].some((e) =>
    ["TimeoutError", "AbortError"].includes(errorName(e)),
  );
}

/**
 * Classifies an unexpected failure after a reservation. Errors already
 * classified keep their reason; failures while saving/settling are "persist";
 * timeouts are recognised; a SyntaxError while reading is a parse failure and
 * anything else while requesting or reading is a network failure.
 */
export function classifyUsageUnknown(
  error: unknown,
  stage: UsageUnknownStage = "request",
): UsageUnknownReason {
  if (error instanceof AiUsageUnknownError) return error.reason;
  if (stage === "persist") return "persist";
  if (isTimeoutError(error)) return "timeout";
  if (error instanceof SyntaxError) return "parse";
  return "network";
}

export function usageUnknown(
  error: unknown,
  stage: UsageUnknownStage = "request",
): AiUsageUnknownError {
  return error instanceof AiUsageUnknownError
    ? error
    : new AiUsageUnknownError(classifyUsageUnknown(error, stage));
}

/** Reason carried by an AI_USAGE_UNKNOWN error, if it was classified. */
export function usageUnknownReasonOf(
  error: unknown,
): UsageUnknownReason | undefined {
  return error instanceof AiUsageUnknownError ? error.reason : undefined;
}

/** Reads the response body with a byte cap; overflow is body_too_large. */
export async function readCappedBody<T extends Uint8Array>(
  body: ReadableStream<T>,
  limit: number,
): Promise<Buffer> {
  const reader = body.getReader(),
    parts: T[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const v = await reader.read();
      if (v.done) break;
      bytes += v.value.length;
      if (bytes > limit) {
        await reader.cancel().catch(() => undefined);
        throw new AiUsageUnknownError("body_too_large");
      }
      parts.push(v.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts);
}

/** JSON.parse of a provider envelope; failure is "parse" (no text retained). */
export function parseProviderJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new AiUsageUnknownError("parse");
  }
}

/** Provider-reported total tokens; missing or above the reservation is classified. */
export function providerTokens(body: unknown, budget: number): number {
  const usage =
    body && typeof body === "object" && "usage" in body
      ? (body as { usage?: unknown }).usage
      : undefined;
  const tokens =
    usage && typeof usage === "object" && "total_tokens" in usage
      ? (usage as { total_tokens?: unknown }).total_tokens
      : undefined;
  if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens < 0)
    throw new AiUsageUnknownError("usage_missing");
  if (tokens > budget) throw new AiUsageUnknownError("usage_over_budget");
  return tokens;
}
