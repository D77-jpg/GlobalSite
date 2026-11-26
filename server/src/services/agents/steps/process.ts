import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentRun, AuditLog, UsageRecord } from "../../../models";
import { AppError, ensure } from "../../../errors";
import * as v from "../../../validators/sites.validator";
import { decrypt, encrypt } from "../../credential-crypto";
import { authorizeActor } from "../../catalog-authority";
import { absorbUnknownUsage, settle } from "../../usage.service";
import {
  AiUsageUnknownError,
  usageUnknownReasonOf,
} from "../../ai-usage-unknown";
import {
  callSiteAgent,
  type AgentResult,
} from "../../site-agent-provider.service";
import {
  assetImages,
  captureSitePage,
  reviewImages,
} from "../../site-review.service";
import { referenceResearch } from "../../site-reference.service";
import { resolveTextProvider } from "../../ai-provider-resolve";
import { procurementCoverage } from "../../b2b-planning.service";
import {
  assertSnapshot,
  candidatePurpose,
  fenceRun,
  ownRun,
  terminal,
} from "../runtime";
import {
  extractFailedBlockKeys,
  normalizeNullableAxes,
  prepareDesignPage,
  repairDraftPage,
  validateGeneratedComposition,
  validationFeedback,
} from "../validation";
import { fillUnitImages } from "../auto-images";
import { selectFullReviewKeys } from "../quality-baseline";
import { unitPrompt } from "../prompts";
import { applyUnit } from "./apply-unit";
import type {
  AgentProcessOutcome,
  AgentTaskDoc,
  ProviderCallable,
  ReviewCapturer,
} from "../types";

export async function processSiteAgent(
  task: AgentTaskDoc,
  provider: ProviderCallable = callSiteAgent,
  reviewer: ReviewCapturer = captureSitePage as ReviewCapturer,
): Promise<AgentProcessOutcome> {
  ensure(task.payload.runId, 400, "INVALID_TASK");
  const runId = task.payload.runId!;
  let run = await ownRun(runId);
  if (terminal.includes(run.status)) return { status: "done" };
  try {
    await mongoose.connection.transaction(async (session) => {
      await fenceRun(task, session);
      run = await ownRun(runId, session);
      ensure(!run.cancelRequested, 409, "AGENT_CANCELLED");
      await authorizeActor(String(run.actorId), session);
      await assertSnapshot(run, session);
      await AgentRun.updateOne(
        { _id: run._id },
        { $set: { status: "running" } },
        { session },
      );
    });

    for (let index = 0; index < run.steps.length; index++) {
      run = await ownRun(runId);
      if (run.steps[index].status === "succeeded") continue;
      ensure(!run.cancelRequested, 409, "AGENT_CANCELLED");
      await assertSnapshot(run);
      await authorizeActor(String(run.actorId));
      let unit = run.steps[index];
      let result = unit.pendingResult as AgentResult | undefined;
      let operationId = unit.operationId;

      if (
        !result &&
        !unit.operationId &&
        unit.pageKind &&
        (unit.repairCandidateCipher || unit.candidateCipher)
      ) {
        const cipher = (unit.repairCandidateCipher ??
          unit.candidateCipher) as Parameters<typeof decrypt>[0];
        const candidate = JSON.parse(
          decrypt(
            cipher,
            unit.repairCandidatePurpose ?? candidatePurpose(run, unit),
          ),
        ) as { label: string; rationale: string; page: v.PageInput };
        try {
          const prepared = prepareDesignPage(run, unit, candidate);
          const filled = await fillUnitImages(
            run,
            index,
            { output: prepared, tokens: 0 },
            task,
          );
          await applyUnit(run, index, filled, task);
          continue;
        } catch (error) {
          if (
            error instanceof z.ZodError ||
            (error instanceof AppError && error.code === "AI_OUTPUT_INVALID")
          ) {
            const failedKeys =
              error instanceof z.ZodError
                ? extractFailedBlockKeys(
                    error.issues.map((i) => ({
                      field: i.path.slice(1).join("."),
                    })),
                  )
                : [];
            unit = {
              ...unit,
              draftCandidate: candidate,
              ...(failedKeys.length > 0 && failedKeys.length <= 2
                ? { failedBlockKeys: failedKeys }
                : {}),
            };
          } else throw error;
        }
      }

      if (!result) {
        if (unit.operationId) {
          const previous = await UsageRecord.findOne({
            metric: "ai_tokens",
            operationId: unit.operationId,
          });
          // S35 acceptance fix: a released (incl. platform-absorbed) or settled
          // previous operation is closed; the next attempt reserves again under
          // a new operation ID. An open reservation means an interrupted call.
          if (previous && !["released", "settled"].includes(previous.state))
            throw new AiUsageUnknownError("interrupted");
        }
        await mongoose.connection.transaction(async (session) => {
          await fenceRun(task, session);
          const fresh = await ownRun(runId, session);
          ensure(!fresh.cancelRequested, 409, "AGENT_CANCELLED");
          unit = {
            ...fresh.steps[index],
            ...(unit.draftCandidate
              ? { draftCandidate: unit.draftCandidate }
              : {}),
            ...(unit.failedBlockKeys?.length
              ? { failedBlockKeys: unit.failedBlockKeys }
              : {}),
            status: "running",
            attempts: fresh.steps[index].attempts + 1,
          };
          operationId =
            "site:" +
            fresh._id +
            ":" +
            index +
            ":" +
            fresh.retryGeneration +
            ":" +
            unit.attempts;
          unit.operationId = operationId;
          unit.startedAt = new Date();
          const storedUnit = { ...unit };
          // The decrypted repair candidate is transient prompt input only.
          delete storedUnit.draftCandidate;
          // The unknown-outcome reason describes the previous attempt only.
          delete storedUnit.usageUnknownReason;
          fresh.steps[index] = storedUnit;
          fresh.markModified("steps");
          await fresh.save({ session });
        });
        const start = Date.now();

        if (run.step === "research" && !unit.referenceResearch) {
          const references = await referenceResearch(
            run.inputSnapshot.site.buyerProfile?.referenceUrls ?? [],
          );
          await mongoose.connection.transaction(async (session) => {
            await fenceRun(task, session);
            const fresh = await ownRun(String(run._id), session);
            ensure(!fresh.cancelRequested, 409, "AGENT_CANCELLED");
            fresh.steps[index].referenceResearch = references;
            fresh.markModified("steps");
            await fresh.save({ session });
          });
          unit = { ...unit, referenceResearch: references };
        }

        if (run.step === "review" && !unit.capture) {
          const snapshot = {
            site: run.inputSnapshot.site,
            pages: run.inputSnapshot.pages,
            products: run.inputSnapshot.products,
            facts: run.inputSnapshot.facts,
            assets: {},
            settings: { canonicalBaseUrl: "https://review.invalid" },
            inquiry: { enabled: false },
            createdAt: run.createdAt.toISOString(),
          };
          if (!unit.captureKey) {
            const key = randomUUID();
            await mongoose.connection.transaction(async (session) => {
              await fenceRun(task, session);
              const fresh = await ownRun(String(run._id), session);
              fresh.steps[index].captureKey = key;
              fresh.markModified("steps");
              await fresh.save({ session });
            });
            unit.captureKey = key;
          }
          const capture = await reviewer(
            snapshot,
            unit.node!.path,
            unit.captureKey,
          );
          // S36: platform or organization text service (null = unconfigured).
          const config = await resolveTextProvider();
          await mongoose.connection.transaction(async (session) => {
            await fenceRun(task, session);
            const fresh = await ownRun(String(run._id), session);
            ensure(!fresh.cancelRequested, 409, "AGENT_CANCELLED");
            fresh.steps[index].capture = capture;
            fresh.steps[index].visualInput = !!config?.supportsVision;
            fresh.steps[index].reviewMode = !config
              ? "structural"
              : config.supportsVision
                ? "visual"
                : "text";
            fresh.markModified("steps");
            await fresh.save({ session });
          });
          unit = { ...unit, capture, visualInput: !!config?.supportsVision };
        }

        const prompt = unitPrompt(run, unit);
        const config = await resolveTextProvider();
        const images =
          run.step === "review" && unit.visualInput && unit.capture
            ? await reviewImages(unit.capture.artifactKey)
            : ["design", "content", "refine", "rewrite"].includes(run.step) &&
                config?.supportsVision
              ? await assetImages(
                  run.inputSnapshot.products
                    .filter(
                      (p) =>
                        !unit.node?.productId || p.id === unit.node.productId,
                    )
                    .flatMap((p) => p.assetIds ?? []),
                )
              : [];

        const fullReviewKeys =
          run.step === "review" ? selectFullReviewKeys(run.steps) : null;
        const sampledStructural =
          run.step === "review" &&
          provider === callSiteAgent &&
          !!fullReviewKeys &&
          !fullReviewKeys.has(unit.key);
        const selectedProvider: ProviderCallable =
          run.step === "review" &&
          (!config || sampledStructural) &&
          provider === callSiteAgent
            ? async (_system, _input, _operation, save) => {
                const findings: Array<{
                  blockKey: null;
                  code: "layout" | "imagery" | "procurement";
                  severity: "warning" | "error";
                  recommendation: string;
                }> = [];
                const metrics = unit.capture?.metrics ?? [];
                if (metrics.some((m) => m.overflow))
                  findings.push({
                    blockKey: null,
                    code: "layout",
                    severity: "error",
                    recommendation:
                      "Correct horizontal overflow at the recorded viewport.",
                  });
                if (metrics.some((m) => m.brokenImages))
                  findings.push({
                    blockKey: null,
                    code: "imagery",
                    severity: "error",
                    recommendation:
                      "Replace unavailable images before publishing.",
                  });
                if (
                  procurementCoverage(
                    run.inputSnapshot.site,
                    run.inputSnapshot.products,
                    run.inputSnapshot.facts,
                    { allowDemoFacts: !!run.inputSnapshot.site.demoMode },
                  ).gaps.length
                )
                  findings.push({
                    blockKey: null,
                    code: "procurement",
                    severity: "warning",
                    recommendation:
                      "Review the procurement information gaps and confirm required company and product data.",
                  });
                const r: AgentResult = {
                  output: {
                    summary: sampledStructural
                      ? "Browser measurements, screenshots and structural baseline are ready (sampled sibling page; run a single-page review for full AI critique). A human must inspect screenshots."
                      : "Browser measurements and screenshots are ready. AI is not configured; a human must inspect content, images and purchasing usefulness.",
                    findings,
                  },
                  tokens: 0,
                  visualInput: false,
                  reviewMode: "structural",
                };
                await save(r);
                return r;
              }
            : provider;

        result = await selectedProvider(
          prompt.system,
          prompt.input,
          operationId!,
          async (pending) => {
            await mongoose.connection.transaction(async (session) => {
              await fenceRun(task, session);
              const fresh = await ownRun(runId, session);
              const elapsedMs = Date.now() - start;
              const u = {
                ...fresh.steps[index],
                pendingResult: pending,
                tokens: (fresh.steps[index].tokens ?? 0) + pending.tokens,
                elapsedMs: (fresh.steps[index].elapsedMs ?? 0) + elapsedMs,
                history: [
                  ...fresh.steps[index].history,
                  {
                    attempt: fresh.steps[index].attempts,
                    status: pending.errorCode ? "invalid" : "received",
                    tokens: pending.tokens,
                    elapsedMs,
                    errorCode: pending.errorCode ?? null,
                    ...(pending.invalidReason
                      ? { invalidReason: pending.invalidReason }
                      : {}),
                    ...(pending.repaired ? { repaired: true } : {}),
                    ...(pending.modelName
                      ? { modelName: pending.modelName }
                      : {}),
                  },
                ],
              };
              fresh.steps[index] = u;
              fresh.tokens = (fresh.tokens ?? 0) + pending.tokens;
              fresh.elapsedMs = (fresh.elapsedMs ?? 0) + elapsedMs;
              fresh.markModified("steps");
              await fresh.save({ session });
            });
          },
          images,
        );
      } else {
        await settle("ai_tokens", operationId!, result.tokens);
      }

      // S35 stage B: optional illustration fill (opt-in, never fails the unit).
      if (!result.errorCode) {
        const current = await ownRun(runId);
        result = await fillUnitImages(current, index, result, task);
      }

      if (run.step === "refine" && !result.errorCode) {
        const fresh = await ownRun(String(run._id));
        let u = fresh.steps[index];
        if (!u.afterCapture) {
          const outObj = normalizeNullableAxes(result.output) as
            | { page?: unknown }
            | null
            | undefined;
          let page = v.pageInput.parse(outObj?.page);
          if (fresh.inputSnapshot.site.designDirection && page.presentation) {
            const direction = fresh.inputSnapshot.site.designDirection;
            page.presentation = {
              ...page.presentation,
              visualStyle:
                (direction.visualStyle as v.PageInput["presentation"] extends infer P
                  ? P extends { visualStyle: infer VS }
                    ? VS
                    : never
                  : never) ?? page.presentation.visualStyle,
              density:
                (direction.density as "comfortable" | "compact" | undefined) ??
                page.presentation.density,
              ...(direction.composition
                ? { composition: direction.composition }
                : {}),
            };
          }
          page = repairDraftPage(fresh, u, page);
          validateGeneratedComposition(fresh, page, u.node!.type);
          if (!u.afterCaptureKey) {
            const key = randomUUID();
            await mongoose.connection.transaction(async (session) => {
              await fenceRun(task, session);
              await AgentRun.updateOne(
                { _id: fresh._id },
                { $set: { ["steps." + index + ".afterCaptureKey"]: key } },
                { session },
              );
            });
            u = { ...u, afterCaptureKey: key };
          }
          const snapshot = {
            site: fresh.inputSnapshot.site,
            pages: fresh.inputSnapshot.pages.map((p) =>
              p.nodeKey === u.key ? { ...p, ...page } : p,
            ),
            products: fresh.inputSnapshot.products,
            facts: fresh.inputSnapshot.facts,
            assets: {},
            settings: { canonicalBaseUrl: "https://review.invalid" },
            inquiry: { enabled: false },
            createdAt: fresh.createdAt.toISOString(),
          };
          const afterCapture = await reviewer(
            snapshot,
            u.node!.path,
            u.afterCaptureKey!,
          );
          await mongoose.connection.transaction(async (session) => {
            await fenceRun(task, session);
            const current = await ownRun(String(fresh._id), session);
            ensure(!current.cancelRequested, 409, "AGENT_CANCELLED");
            await assertSnapshot(current, session);
            current.steps[index].afterCapture = afterCapture;
            current.markModified("steps");
            await current.save({ session });
          });
        }
      }
      await applyUnit(run, index, result, task);
    }
    return { status: "done" };
  } catch (error) {
    const code =
      error instanceof AppError
        ? error.code
        : error instanceof z.ZodError
          ? "AI_OUTPUT_INVALID"
          : "AGENT_FAILED";
    if (code === "LEASE_LOST" || code === "RUN_SUPERSEDED")
      return { status: "dead", error: code };
    let outcome: AgentProcessOutcome = {
      status: "dead",
      error: code,
    };
    await mongoose.connection.transaction(async (session) => {
      await fenceRun(task, session);
      const fresh = await ownRun(runId, session);
      const index = fresh.steps.findIndex((u) => u.status !== "succeeded");
      const unit = index >= 0 ? fresh.steps[index] : null;
      const cancelled = fresh.cancelRequested || code === "AGENT_CANCELLED";
      // S35 acceptance fix: the platform absorbs an unknown outcome. The
      // customer's reservation is released (not charged) and the record is
      // marked for reconciliation; the unit then retries like AI_TRANSIENT
      // within its three attempts. Above AI_UNKNOWN_ABSORB_LIMIT per month the
      // job pauses until the user retries. A saved result (pendingResult) is a
      // known outcome and keeps the previous pause-and-settle behaviour.
      const unknown = code === "AI_USAGE_UNKNOWN";
      const unknownReason = unknown
        ? (usageUnknownReasonOf(error) ?? unit?.usageUnknownReason ?? "unrecorded")
        : undefined;
      const absorption =
        unknownReason && unit && !unit.pendingResult && unit.operationId
          ? await absorbUnknownUsage(
              "ai_tokens",
              unit.operationId,
              unknownReason,
              session,
            )
          : "none";
      const paused =
        ["QUOTA_EXCEEDED", "AI_UNCONFIGURED"].includes(code) ||
        (unknown && (absorption === "limit" || !!unit?.pendingResult));
      const retry =
        !cancelled &&
        !paused &&
        [
          "AI_TRANSIENT",
          "AI_RATE_LIMIT",
          "AI_OUTPUT_INVALID",
          "AI_USAGE_UNKNOWN",
        ].includes(code) &&
        (unit?.attempts ?? 3) < 3;
      fresh.status = cancelled
        ? "cancelled"
        : paused
          ? "paused"
          : retry
            ? "queued"
            : "failed";
      fresh.active = paused || retry;
      fresh.errorCode = cancelled ? "AGENT_CANCELLED" : code;
      if (unit) {
        const elapsedMs = unit.startedAt
          ? Date.now() - new Date(unit.startedAt).getTime()
          : 0;
        const failedBlockKeys =
          code === "AI_OUTPUT_INVALID" && error instanceof z.ZodError
            ? extractFailedBlockKeys(
                error.issues.map((i) => ({
                  field: i.path.slice(1).join("."),
                })),
              )
            : [];
        fresh.steps[index] = {
          ...unit,
          status: cancelled
            ? "cancelled"
            : paused
              ? "paused"
              : retry
                ? "pending"
                : "failed",
          errorCode: fresh.errorCode,
          ...(unknownReason ? { usageUnknownReason: unknownReason } : {}),
          ...(code === "AI_OUTPUT_INVALID"
            ? {
                pendingResult: undefined,
                ...(fresh.step === "design" &&
                unit.pageKind &&
                v.designPageOutput.safeParse(
                  normalizeNullableAxes(unit.pendingResult?.output),
                ).success
                  ? {
                      candidateCipher: encrypt(
                        JSON.stringify(
                          v.designPageOutput.parse(
                            normalizeNullableAxes(unit.pendingResult!.output),
                          ),
                        ),
                        candidatePurpose(fresh, unit),
                      ),
                    }
                  : {}),
                ...(failedBlockKeys.length > 0 && failedBlockKeys.length <= 2
                  ? { failedBlockKeys }
                  : {}),
                responseDiagnostics: unit.pendingResult?.responseDiagnostics,
                validationFeedback: unit.pendingResult?.invalidReason
                  ? [
                      {
                        path: "response",
                        code: unit.pendingResult.invalidReason,
                      },
                    ]
                  : validationFeedback(error),
                // A received, metered invalid result is a known attempt. The next
                // attempt needs a new operation ID; unresolved requests retain theirs.
                ...(unit.pendingResult ? { operationId: undefined } : {}),
              }
            : {}),
          ...(!unit.pendingResult
            ? {
                elapsedMs: (unit.elapsedMs ?? 0) + elapsedMs,
                history: [
                  ...unit.history,
                  {
                    attempt: Math.max(1, unit.attempts),
                    status: "failed",
                    tokens: 0,
                    elapsedMs,
                    errorCode: fresh.errorCode,
                  },
                ],
              }
            : {}),
        };
        if (!unit.pendingResult)
          fresh.elapsedMs = (fresh.elapsedMs ?? 0) + elapsedMs;
        fresh.markModified("steps");
      }
      await fresh.save({ session });
      await AuditLog.create(
        [
          {
            action: "site.agent." + fresh.status,
            actorId: fresh.actorId,
            targetId: String(fresh._id),
          },
        ],
        { session },
      );
      outcome = {
        status: retry ? "pending" : "dead",
        error: fresh.errorCode ?? undefined,
      };
    });
    return outcome;
  }
}
