// S36 platform operations: monthly usage reconciliation (pure functions).
//
// The CLI (src/scripts/ops-usage.ts) reads each organization inside its own
// tenant context and hands plain rows to these functions, so aggregation and
// formatting are unit-tested without a database. Output is for platform
// operators only (raw AI units are fine here); it never contains keys,
// e-mail addresses, prompts or model output.
import { plans, type Plan } from "../constants/plans";

export type OpsUsageRecord = {
  metric: string;
  operationId: string;
  state: string;
  amount: number;
  actual?: number | null;
  absorbed?: boolean | null;
  unknownReason?: string | null;
};
export type OpsBucket = { metric: string; consumed: number; reserved: number };
export type OpsRun = {
  id: string;
  kind: string;
  siteId: string | null;
  createdAt: Date | string | null;
};
export type OpsSite = { id: string; name: string };
export type OpsOrganizationInput = {
  id: string;
  name: string;
  plan: string;
  status?: string;
  buckets: OpsBucket[];
  records: OpsUsageRecord[];
  runs: OpsRun[];
  sites: OpsSite[];
};
export type OpsPricing = {
  /** PLATFORM_AI_PRICE_PER_MILLION: cost per 1,000,000 AI units. */
  aiPerMillion: number | null;
  /** PLATFORM_IMAGE_PRICE: cost per generated image. */
  imagePrice: number | null;
  /** PLATFORM_COST_ALERT: total estimated monthly cost alert threshold. */
  costAlert: number | null;
};
export type OpsSiteSummary = {
  siteId: string;
  name: string;
  aiUnits: number;
  images: number;
  logoImages: number;
  logoRuns: number;
  agentRuns: number;
  absorbed: number;
};
export type OpsOrganizationSummary = {
  organizationId: string;
  name: string;
  plan: string;
  status: string;
  aiUnits: number;
  aiReserved: number;
  aiLimit: number | null;
  aiPercent: number | null;
  images: number;
  imagesLimit: number | null;
  imagesPercent: number | null;
  absorbed: number;
  absorbedUnits: number;
  absorbedReasons: Record<string, number>;
  costKnown: number | null;
  costAbsorbedMax: number | null;
  nearLimit: boolean;
  sites: OpsSiteSummary[];
  /** Usage that cannot be tied to one site (fact extraction, inquiries, tests, manual images). */
  unattributed: { aiUnits: number; images: number };
};
export type OpsReport = {
  period: string;
  generatedAt: string;
  pricing: OpsPricing;
  organizations: OpsOrganizationSummary[];
  totals: {
    organizations: number;
    aiUnits: number;
    images: number;
    absorbed: number;
    absorbedReasons: Record<string, number>;
    costKnown: number | null;
    costAbsorbedMax: number | null;
    costEstimate: number | null;
  };
  nearLimitOrganizations: string[];
  costAlert: boolean;
};

export const NEAR_LIMIT_PERCENT = 80;

/** --period YYYY-MM (UTC month, same as usage.service period()); default current month. */
export function parsePeriod(raw: string | undefined, now: Date = new Date()): string {
  if (raw === undefined || raw === "") return now.toISOString().slice(0, 7);
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw.trim());
  if (!match) throw new Error("PERIOD_INVALID");
  return match[0];
}

export function periodWindow(period: string): { start: Date; end: Date } {
  const [y, m] = parsePeriod(period).split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

function money(raw: string | undefined): number | null {
  if (raw === undefined || !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function opsPricing(env: NodeJS.ProcessEnv = process.env): OpsPricing {
  return {
    aiPerMillion: money(env.PLATFORM_AI_PRICE_PER_MILLION),
    imagePrice: money(env.PLATFORM_IMAGE_PRICE),
    costAlert: money(env.PLATFORM_COST_ALERT),
  };
}

export type OperationRef = {
  source: "site-agent" | "suggest" | "auto-image" | "logo" | "other";
  runId: string | null;
};
/**
 * Maps a UsageRecord operation ID to the run that spent it. Formats come from
 * the billing call sites: site:<run>:<unit>:<gen>:<attempt> (site.agent),
 * suggest:<run> (facts.suggest), image:auto:<run>:<slot> (auto images),
 * image:logo:<run>:<index> (site.logo). Anything else is organization-level.
 */
export function operationRef(metric: string, operationId: string): OperationRef {
  const id = "([a-f0-9]{24})";
  let m: RegExpExecArray | null;
  if (metric === "ai_tokens") {
    if ((m = new RegExp("^site:" + id + ":").exec(operationId)))
      return { source: "site-agent", runId: m[1] };
    if ((m = new RegExp("^suggest:" + id + "$").exec(operationId)))
      return { source: "suggest", runId: m[1] };
  }
  if (metric === "images") {
    if ((m = new RegExp("^image:auto:" + id + ":").exec(operationId)))
      return { source: "auto-image", runId: m[1] };
    if ((m = new RegExp("^image:logo:" + id + ":").exec(operationId)))
      return { source: "logo", runId: m[1] };
  }
  return { source: "other", runId: null };
}

/** Run IDs referenced by usage records (to load their siteId). */
export function referencedRunIds(records: OpsUsageRecord[]): string[] {
  const ids = new Set<string>();
  for (const r of records) {
    const ref = operationRef(r.metric, r.operationId);
    if (ref.runId) ids.add(ref.runId);
  }
  return [...ids];
}

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const used = (r: OpsUsageRecord) =>
  r.state === "settled" && Number.isFinite(Number(r.actual))
    ? Number(r.actual)
    : 0;
const inPeriod = (value: Date | string | null, start: Date, end: Date) => {
  if (!value) return false;
  const t = new Date(value).getTime();
  return t >= start.getTime() && t < end.getTime();
};
const planLimits = (plan: string) =>
  plans[(plan in plans ? plan : "trial") as Plan];

export function summarizeOrganization(
  input: OpsOrganizationInput,
  period: string,
  pricing: OpsPricing,
): OpsOrganizationSummary {
  const { start, end } = periodWindow(period);
  const limits = planLimits(input.plan);
  const runs = new Map(input.runs.map((r) => [r.id, r]));
  const siteNames = new Map(input.sites.map((s) => [s.id, s.name]));
  const sites = new Map<string, OpsSiteSummary>();
  const site = (id: string) => {
    let row = sites.get(id);
    if (!row) {
      row = {
        siteId: id,
        name: siteNames.get(id) ?? "",
        aiUnits: 0,
        images: 0,
        logoImages: 0,
        logoRuns: 0,
        agentRuns: 0,
        absorbed: 0,
      };
      sites.set(id, row);
    }
    return row;
  };
  const unattributed = { aiUnits: 0, images: 0 };
  const absorbedReasons: Record<string, number> = {};
  let absorbed = 0,
    absorbedUnits = 0,
    aiFromRecords = 0,
    imagesFromRecords = 0;
  for (const r of input.records) {
    if (r.metric !== "ai_tokens" && r.metric !== "images") continue;
    const ref = operationRef(r.metric, r.operationId);
    const siteId = ref.runId ? (runs.get(ref.runId)?.siteId ?? null) : null;
    const amount = used(r);
    if (r.metric === "ai_tokens") aiFromRecords += amount;
    else imagesFromRecords += amount;
    if (r.absorbed) {
      absorbed++;
      if (r.metric === "ai_tokens")
        absorbedUnits += Number.isFinite(r.amount) ? r.amount : 0;
      const reason = r.unknownReason || "unknown";
      absorbedReasons[reason] = (absorbedReasons[reason] ?? 0) + 1;
      if (siteId) site(siteId).absorbed++;
    }
    if (!siteId) {
      if (r.metric === "ai_tokens") unattributed.aiUnits += amount;
      else unattributed.images += amount;
      continue;
    }
    const row = site(siteId);
    if (r.metric === "ai_tokens") row.aiUnits += amount;
    else {
      row.images += amount;
      if (ref.source === "logo") row.logoImages += amount;
    }
  }
  for (const run of input.runs) {
    if (!run.siteId || !inPeriod(run.createdAt, start, end)) continue;
    if (run.kind === "site.agent") site(run.siteId).agentRuns++;
    else if (run.kind === "site.logo") site(run.siteId).logoRuns++;
  }
  const bucket = (metric: string) =>
    input.buckets.find((b) => b.metric === metric);
  const aiBucket = bucket("ai_tokens"),
    imageBucket = bucket("images");
  // Buckets are the billing source of truth; records cover legacy gaps.
  const aiUnits = aiBucket ? aiBucket.consumed : aiFromRecords;
  const aiReserved = aiBucket ? aiBucket.reserved : 0;
  const images = imageBucket ? imageBucket.consumed : imagesFromRecords;
  const aiLimit = typeof limits.ai_tokens === "number" ? limits.ai_tokens : null;
  const imagesLimit = typeof limits.images === "number" ? limits.images : null;
  const aiPercent = aiLimit
    ? round((100 * (aiUnits + aiReserved)) / aiLimit, 1)
    : null;
  const imagesPercent = imagesLimit
    ? round((100 * (images + (imageBucket?.reserved ?? 0))) / imagesLimit, 1)
    : null;
  const costKnown =
    pricing.aiPerMillion === null && pricing.imagePrice === null
      ? null
      : round(
          (aiUnits * (pricing.aiPerMillion ?? 0)) / 1e6 +
            images * (pricing.imagePrice ?? 0),
          4,
        );
  // Absorbed outcomes may still be billed by the provider: upper bound only.
  const costAbsorbedMax =
    pricing.aiPerMillion === null
      ? null
      : round((absorbedUnits * pricing.aiPerMillion) / 1e6, 4);
  return {
    organizationId: input.id,
    name: input.name,
    plan: input.plan,
    status: input.status ?? "active",
    aiUnits,
    aiReserved,
    aiLimit,
    aiPercent,
    images,
    imagesLimit,
    imagesPercent,
    absorbed,
    absorbedUnits,
    absorbedReasons,
    costKnown,
    costAbsorbedMax,
    nearLimit:
      (aiPercent ?? 0) >= NEAR_LIMIT_PERCENT ||
      (imagesPercent ?? 0) >= NEAR_LIMIT_PERCENT,
    sites: [...sites.values()].sort(
      (a, b) => b.aiUnits - a.aiUnits || b.images - a.images,
    ),
    unattributed,
  };
}

const sumNullable = (values: Array<number | null>) =>
  values.every((v) => v === null)
    ? null
    : round(
        values.reduce<number>((total, v) => total + (v ?? 0), 0),
        4,
      );

export function buildReport(
  period: string,
  organizations: OpsOrganizationInput[],
  pricing: OpsPricing,
  now: Date = new Date(),
): OpsReport {
  const rows = organizations
    .map((o) => summarizeOrganization(o, period, pricing))
    .sort((a, b) => (b.aiPercent ?? 0) - (a.aiPercent ?? 0));
  const absorbedReasons: Record<string, number> = {};
  for (const row of rows)
    for (const [reason, count] of Object.entries(row.absorbedReasons))
      absorbedReasons[reason] = (absorbedReasons[reason] ?? 0) + count;
  const costKnown = sumNullable(rows.map((r) => r.costKnown));
  const costAbsorbedMax = sumNullable(rows.map((r) => r.costAbsorbedMax));
  const costEstimate = sumNullable([costKnown, costAbsorbedMax]);
  return {
    period,
    generatedAt: now.toISOString(),
    pricing,
    organizations: rows,
    totals: {
      organizations: rows.length,
      aiUnits: rows.reduce((t, r) => t + r.aiUnits, 0),
      images: rows.reduce((t, r) => t + r.images, 0),
      absorbed: rows.reduce((t, r) => t + r.absorbed, 0),
      absorbedReasons,
      costKnown,
      costAbsorbedMax,
      costEstimate,
    },
    nearLimitOrganizations: rows
      .filter((r) => r.nearLimit)
      .map((r) => r.organizationId),
    costAlert:
      pricing.costAlert !== null &&
      costEstimate !== null &&
      costEstimate > pricing.costAlert,
  };
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd();
  return [
    line(headers),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
  ].join("\n");
}
const pct = (n: number | null) => (n === null ? "-" : n.toFixed(1) + "%");
const num = (n: number | null) => (n === null ? "-" : String(n));
const reasons = (r: Record<string, number>) =>
  Object.entries(r)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + "=" + v)
    .join(",") || "-";
const short = (s: string, max = 28) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

/** Plain-text report for operators. Flags: [!] >= 80% of plan, COST ALERT above PLATFORM_COST_ALERT. */
export function formatReport(report: OpsReport): string {
  const out: string[] = [];
  out.push("GlobalSite platform usage " + report.period + " (UTC month)");
  out.push("Generated " + report.generatedAt);
  out.push("");
  out.push(
    table(
      ["", "Organization", "Plan", "AI units", "AI %", "Images", "Images %", "Absorbed", "Reasons", "Cost", "Absorbed cost max"],
      report.organizations.map((o) => [
        o.nearLimit ? "[!]" : "",
        short(o.name || o.organizationId),
        o.plan,
        String(o.aiUnits + o.aiReserved),
        pct(o.aiPercent),
        o.images + "/" + num(o.imagesLimit),
        pct(o.imagesPercent),
        String(o.absorbed),
        reasons(o.absorbedReasons),
        num(o.costKnown),
        num(o.costAbsorbedMax),
      ]),
    ),
  );
  out.push("");
  out.push("Per-site consumption (calibration data)");
  const siteRows: string[][] = [];
  for (const o of report.organizations) {
    for (const s of o.sites)
      siteRows.push([
        short(o.name || o.organizationId, 20),
        short(s.name || s.siteId),
        String(s.aiUnits),
        String(s.images),
        s.logoImages + " (" + s.logoRuns + " runs)",
        String(s.agentRuns),
        String(s.absorbed),
      ]);
    if (o.unattributed.aiUnits || o.unattributed.images)
      siteRows.push([
        short(o.name || o.organizationId, 20),
        "(organization-level)",
        String(o.unattributed.aiUnits),
        String(o.unattributed.images),
        "-",
        "-",
        "-",
      ]);
  }
  out.push(
    siteRows.length
      ? table(
          ["Organization", "Site", "AI units", "Images", "Logo images", "Agent runs", "Absorbed"],
          siteRows,
        )
      : "(no site usage)",
  );
  out.push("");
  const t = report.totals;
  out.push(
    "Totals: organizations=" + t.organizations +
      " aiUnits=" + t.aiUnits +
      " images=" + t.images +
      " absorbed=" + t.absorbed +
      " (" + reasons(t.absorbedReasons) + ")",
  );
  out.push(
    "Estimated cost: known=" + num(t.costKnown) +
      " absorbedMax=" + num(t.costAbsorbedMax) +
      " total=" + num(t.costEstimate) +
      (report.pricing.costAlert === null
        ? ""
        : " alertThreshold=" + report.pricing.costAlert),
  );
  if (report.pricing.aiPerMillion === null && report.pricing.imagePrice === null)
    out.push("Set PLATFORM_AI_PRICE_PER_MILLION / PLATFORM_IMAGE_PRICE to estimate cost.");
  if (report.nearLimitOrganizations.length)
    out.push(
      "[!] " + report.nearLimitOrganizations.length +
        " organization(s) at or above " + NEAR_LIMIT_PERCENT + "% of their plan: suggest an upgrade.",
    );
  if (report.costAlert) out.push("COST ALERT: estimated total exceeds PLATFORM_COST_ALERT.");
  return out.join("\n");
}
