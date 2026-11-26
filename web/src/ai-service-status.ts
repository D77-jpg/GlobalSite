// S36: customer-facing AI service and allowance helpers (pure, unit-tested).
// The workspace never shows model names, service URLs, keys or raw AI units.

export const NEAR_LIMIT_PERCENT = 80;

/** Settings responses use { managed: true } when the platform provides AI. */
export function isPlatformManaged(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { managed?: unknown }).managed === true
  );
}

type UsageItem = { metric: string; consumed: number; reserved: number };
type UsageData = {
  limits: Record<string, number | null>;
  items: UsageItem[];
};

/** Used share of a metric's plan limit (0-100), or null when unlimited. */
export function usagePercent(data: UsageData, metric: string): number | null {
  const limit = data.limits[metric];
  if (typeof limit !== "number" || limit <= 0) return null;
  const row = data.items.find((x) => x.metric === metric);
  const used = (row?.consumed ?? 0) + (row?.reserved ?? 0);
  return Math.min(100, (100 * used) / limit);
}

/** AI allowance or AI images at or above 80% of the plan. */
export function nearPlanLimit(data: UsageData): boolean {
  return ["ai_tokens", "images"].some(
    (metric) => (usagePercent(data, metric) ?? 0) >= NEAR_LIMIT_PERCENT,
  );
}

/** Upgrade links are limited to https: and mailto: (configured by the platform). */
export function safeUpgradeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "mailto:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Reset date shown in the UTC calendar used by monthly quotas. */
export function formatResetDate(value: unknown, locale: string): string {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
