// S36 platform operations: monthly AI usage reconciliation (read-only CLI).
//
//   npm run ops:usage -- --period 2026-11 [--json]        (repository root)
//   node server/dist/scripts/ops-usage.js --period 2026-11 (built image)
//
// Restricted read-only context (see docs/design/S36 implementation notes):
// - The organization list is read with the existing identity context;
//   Organization is an identity-mode model, so this is the same restricted
//   lookup the auth/usage code already uses.
// - Every other query runs inside runWithTenant(<that organization>), so the
//   tenant plugin still adds the organization filter. There is no new
//   bypass, no Model.collection / raw driver access and no aggregate.
// - Only find().select().lean() reads; no writes. The connection skips
//   migrate() and automatic index/collection creation.
// Output is for platform operators only. It never contains keys, e-mail
// addresses, prompts or model output; failures print a fixed event code.
import mongoose from "mongoose";
import { config } from "../config";
import {
  AgentRun,
  Organization,
  Site,
  UsageBucket,
  UsageRecord,
} from "../models";
import { runIdentity, runWithTenant } from "../models/tenant-context";
import {
  buildReport,
  formatReport,
  opsPricing,
  parsePeriod,
  periodWindow,
  referencedRunIds,
  type OpsOrganizationInput,
  type OpsRun,
  type OpsSite,
  type OpsUsageRecord,
} from "../services/ops-usage-report";

const METRICS = ["ai_tokens", "images"];
const KNOWN_ERRORS = [
  "ARGUMENT_INVALID",
  "PERIOD_INVALID",
  "DATABASE_MUST_BE_GLOBALSITE",
];

export function parseArgs(argv: string[]): { period: string; json: boolean } {
  let period: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--period") period = argv[++i] ?? "";
    else if (arg.startsWith("--period=")) period = arg.slice("--period=".length);
    else throw new Error("ARGUMENT_INVALID");
  }
  if (period === "") throw new Error("PERIOD_INVALID");
  return { period: parsePeriod(period), json };
}

async function connectReadOnly(uri: string = config.mongo) {
  // Same database-name guard as connectDatabase(), without migrate().
  const database = new URL(
    uri.replace("mongodb://", "http://").replace("mongodb+srv://", "https://"),
  ).pathname.slice(1);
  if (database !== "globalsite") throw new Error("DATABASE_MUST_BE_GLOBALSITE");
  await mongoose.connect(uri, {
    dbName: "globalsite",
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
    autoCreate: false,
  });
}

type OrgRow = { id: string; name: string; plan: string; status: string };

async function listOrganizations(): Promise<OrgRow[]> {
  const rows = await runIdentity(async () =>
    await Organization.find({}).select("name plan status").lean(),
  );
  return rows.map(
    (o: { _id: unknown; name?: unknown; plan?: unknown; status?: unknown }) => ({
      id: String(o._id),
      name: String(o.name ?? ""),
      plan: String(o.plan ?? "trial"),
      status: String(o.status ?? "active"),
    }),
  );
}

async function readOrganization(
  org: OrgRow,
  period: string,
): Promise<OpsOrganizationInput> {
  const { start, end } = periodWindow(period);
  return runWithTenant(org.id, async () => {
    const buckets = await UsageBucket.find({
      period,
      metric: { $in: METRICS },
    })
      .select("metric consumed reserved")
      .lean();
    const rawRecords = await UsageRecord.find({
      period,
      metric: { $in: METRICS },
    })
      .select("metric operationId state amount actual absorbed unknownReason")
      .lean();
    const records: OpsUsageRecord[] = rawRecords.map(
      (r: {
        metric?: unknown;
        operationId?: unknown;
        state?: unknown;
        amount?: unknown;
        actual?: unknown;
        absorbed?: unknown;
        unknownReason?: unknown;
      }) => ({
        metric: String(r.metric ?? ""),
        operationId: String(r.operationId ?? ""),
        state: String(r.state ?? ""),
        amount: Number(r.amount ?? 0),
        actual: r.actual === undefined || r.actual === null ? null : Number(r.actual),
        absorbed: r.absorbed === true,
        unknownReason:
          typeof r.unknownReason === "string" ? r.unknownReason : null,
      }),
    );
    const runIds = referencedRunIds(records);
    const rawRuns: Array<{
      _id: unknown;
      kind?: unknown;
      siteId?: unknown;
      createdAt?: unknown;
    }> = await AgentRun.find({
      $or: [
        ...(runIds.length ? [{ _id: { $in: runIds } }] : []),
        {
          kind: { $in: ["site.agent", "site.logo"] },
          createdAt: { $gte: start, $lt: end },
        },
      ],
    })
      .select("kind siteId createdAt")
      .lean();
    const runs: OpsRun[] = rawRuns.map((r) => ({
      id: String(r._id),
      kind: String(r.kind ?? ""),
      siteId: r.siteId ? String(r.siteId) : null,
      createdAt:
        r.createdAt instanceof Date || typeof r.createdAt === "string"
          ? r.createdAt
          : null,
    }));
    const rawSites: Array<{ _id: unknown; name?: unknown }> = await Site.find(
      {},
    )
      .select("name")
      .lean();
    const sites: OpsSite[] = rawSites.map((s) => ({
      id: String(s._id),
      name: String(s.name ?? ""),
    }));
    return {
      id: org.id,
      name: org.name,
      plan: org.plan,
      status: org.status,
      buckets: buckets.map(
        (b: { metric?: unknown; consumed?: unknown; reserved?: unknown }) => ({
          metric: String(b.metric ?? ""),
          consumed: Number(b.consumed ?? 0),
          reserved: Number(b.reserved ?? 0),
        }),
      ),
      records,
      runs,
      sites,
    };
  });
}

async function main() {
  const { period, json } = parseArgs(process.argv.slice(2));
  await connectReadOnly();
  try {
    const organizations: OpsOrganizationInput[] = [];
    for (const org of await listOrganizations())
      organizations.push(await readOrganization(org, period));
    const report = buildReport(period, organizations, opsPricing());
    console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    const code =
      error instanceof Error && KNOWN_ERRORS.includes(error.message)
        ? error.message
        : "OPS_USAGE_FAILED";
    console.error(JSON.stringify({ event: "ops_usage_failed", code }));
    process.exit(1);
  });
