// Adapted from GlobalCRM server/src/constants/plans.ts @ a94a285; GlobalSite quotas only.
export const plans = {
  trial: {
    members: 2,
    sites: 1,
    ai_tokens: 200000,
    builds: 20,
    publishes: 10,
    storage_bytes: 1073741824,
  },
  starter: {
    members: 3,
    sites: 1,
    ai_tokens: 2000000,
    builds: 100,
    publishes: 50,
    storage_bytes: 10737418240,
  },
  growth: {
    members: 10,
    sites: 5,
    ai_tokens: 10000000,
    builds: 500,
    publishes: 250,
    storage_bytes: 53687091200,
  },
} as const;
export type Plan = keyof typeof plans;
export type Metric = "ai_tokens" | "builds" | "publishes" | "storage_bytes";
