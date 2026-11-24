import type mongoose from "mongoose";
import { AgentRun, FactSheet, Product } from "../../models";
import { ensure } from "../../errors";
import * as v from "../../validators/sites.validator";
import { ownSite } from "../sites.service";
import { sha } from "../catalog.service";
import { fenceTask } from "../product-import.service";
import type {
  AgentDiagnosticsSummary,
  AgentRunDoc,
  AgentStepUnit,
  AgentTaskDoc,
} from "./types";

export const terminal = ["succeeded", "cancelled"];

export async function ownRun(
  id: string,
  session?: mongoose.ClientSession,
): Promise<AgentRunDoc> {
  const r = await AgentRun.findOne({ _id: id, kind: "site.agent" }).session(
    session ?? null,
  );
  ensure(r, 404, "NOT_FOUND");
  return r as unknown as AgentRunDoc;
}

export async function fenceRun(
  task: AgentTaskDoc,
  session: mongoose.ClientSession,
): Promise<void> {
  await fenceTask(task, session);
  ensure(task.payload.runId, 400, "INVALID_TASK");
  const run = await ownRun(task.payload.runId, session);
  ensure(
    task.operationId === "site-agent:" + run._id + ":" + run.retryGeneration,
    409,
    "RUN_SUPERSEDED",
  );
}

export function candidatePurpose(run: AgentRunDoc, unit: AgentStepUnit): string {
  return (
    "site-candidate:" +
    String(run.organizationId) +
    ":" +
    String(run._id) +
    ":" +
    unit.key
  );
}

export function designDirections(run: AgentRunDoc) {
  if (run.steps.some((s) => s.pageKind)) {
    return v.designOutput.parse({
      directions: (["primary", "alternate"] as const).map((key) => {
        const home = run.steps.find(
          (u) => u.directionKey === key && u.pageKind === "home",
        );
        const detail = run.steps.find(
          (u) => u.directionKey === key && u.pageKind === "detail",
        );
        const homeOut = home?.output as
          | { label?: string; rationale?: string; page?: unknown }
          | undefined;
        const detailOut = detail?.output as { page?: unknown } | undefined;
        return {
          key,
          label: homeOut?.label,
          rationale: homeOut?.rationale,
          page: homeOut?.page,
          detail: { nodeKey: detail?.node?.key, page: detailOut?.page },
        };
      }),
    });
  }
  if (run.steps.some((s) => s.directionKey))
    return v.designOutput.parse({
      directions: run.steps
        .map((s) => (s.output as { proposal?: unknown } | null)?.proposal)
        .filter(Boolean),
    });
  return v.designOutput.parse(run.steps[0]?.output);
}

export function summarizeRunDiagnostics(
  run: AgentRunDoc,
): AgentDiagnosticsSummary {
  let attempts = 0;
  let repairedCount = 0;
  let truncatedCount = 0;
  let nonJsonCount = 0;
  const models = new Set<string>();
  for (const s of run.steps ?? []) {
    for (const h of s.history ?? []) {
      attempts++;
      if (h.repaired) repairedCount++;
      if (h.invalidReason === "truncated") truncatedCount++;
      else if (h.invalidReason === "non_json") nonJsonCount++;
      if (h.modelName) models.add(h.modelName);
    }
  }
  return {
    attempts,
    repairedCount,
    truncatedCount,
    nonJsonCount,
    modelsUsed: [...models],
  };
}

export function agentDto(r: AgentRunDoc) {
  return {
    id: String(r._id),
    siteId: String(r.siteId),
    step: r.step,
    status: r.status,
    active: !!r.active,
    cancelRequested: !!r.cancelRequested,
    qualityAcceptedAt: r.qualityAcceptedAt ?? null,
    qualityAcceptedBy: r.qualityAcceptedBy ? String(r.qualityAcceptedBy) : null,
    inputSummary: r.inputSummary,
    diagnostics: summarizeRunDiagnostics(r),
    steps: (r.steps ?? []).map((s, index) => ({
      key: s.key,
      inputSummary: s.inputSummary ?? {
        pageTitle: s.node?.title ?? r.inputSummary.siteName,
        products: r.inputSummary.products,
        confirmedFacts: r.inputSnapshot.facts.filter(
          (f) =>
            !s.node?.productId ||
            f.subjectType === "organization" ||
            f.subjectId === s.node.productId,
        ).length,
        inputHash: sha(
          JSON.stringify({
            site: r.inputSnapshot.site,
            node: s.node ?? null,
            facts: r.inputSnapshot.facts,
            products: r.inputSnapshot.products,
          }),
        ),
      },
      status: s.status,
      attempts: s.attempts,
      output:
        r.step === "design" &&
        r.status === "succeeded" &&
        index === 0 &&
        s.directionKey
          ? designDirections(r)
          : (s.output ?? null),
      tokens: s.tokens ?? 0,
      elapsedMs: s.elapsedMs ?? 0,
      errorCode: s.errorCode ?? null,
      history: s.history ?? [],
    })),
    tokens: r.tokens ?? 0,
    elapsedMs: r.elapsedMs ?? 0,
    errorCode: r.errorCode ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function assertSnapshot(
  run: AgentRunDoc,
  session?: mongoose.ClientSession,
) {
  const snapshot = run.inputSnapshot;
  const site = await ownSite(String(run.siteId), session);
  ensure(
    site.status !== "archived" &&
      site.revision === snapshot.site.revision &&
      site.planRevision === snapshot.site.planRevision,
    409,
    "SOURCE_CHANGED",
  );
  const facts = snapshot.facts;
  const products = snapshot.products;
  if (facts.length)
    ensure(
      (await FactSheet.countDocuments({
        status: "confirmed",
        $or: facts.map((f) => ({ _id: f.id, revision: f.revision })),
      }).session(session ?? null)) === facts.length,
      409,
      "SOURCE_CHANGED",
    );
  if (products.length)
    ensure(
      (await Product.countDocuments({
        status: { $ne: "archived" },
        $or: products.map((p) => ({ _id: p.id, revision: p.revision })),
      }).session(session ?? null)) === products.length,
      409,
      "SOURCE_CHANGED",
    );
  return site;
}
