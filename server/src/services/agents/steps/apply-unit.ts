import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog, Site, SitePage } from "../../../models";
import { ensure } from "../../../errors";
import * as v from "../../../validators/sites.validator";
import { validatePlan, writePage } from "../../sites.service";
import { pinAssets } from "../../catalog.service";
import { authorizeActor } from "../../catalog-authority";
import { validatePage } from "../../page-validation.service";
import { measuredFindings } from "../../site-review.service";
import type { AgentResult } from "../../site-agent-provider.service";
import { assertSnapshot, fenceRun, ownRun } from "../runtime";
import {
  allowedInterview,
  prepareDesignPage,
  reviewOutput,
  validateGeneratedComposition,
} from "../validation";
import type { AgentRunDoc, AgentTaskDoc, DesignDirection } from "../types";

export async function applyUnit(
  run: AgentRunDoc,
  index: number,
  result: AgentResult,
  task: AgentTaskDoc,
): Promise<void> {
  await mongoose.connection.transaction(async (session) => {
    await fenceRun(task, session);
    const r = await ownRun(String(run._id), session);
    ensure(!r.cancelRequested && r.active, 409, "AGENT_CANCELLED");
    await authorizeActor(String(r.actorId), session);
    const site = await assertSnapshot(r, session);
    const unit = r.steps[index];
    if (unit.status === "succeeded") return;
    ensure(!result.errorCode, 502, result.errorCode ?? "AI_OUTPUT_INVALID");
    let output: unknown = result.output;

    if (r.step === "interview") {
      const d = v.interviewOutput.parse(output);
      ensure(
        new Set(d.questions.map((q) => q.id)).size === d.questions.length,
        502,
        "AI_OUTPUT_INVALID",
      );
      ensure(
        d.questions.every(
          (q) =>
            allowedInterview.test(q.type) &&
            (!q.subjectId ||
              site.productIds.map(String).includes(q.subjectId)) &&
            (q.type.startsWith("product.") ? !!q.subjectId : !q.subjectId),
        ),
        502,
        "AI_OUTPUT_INVALID",
      );
      output = {
        questions: d.questions.filter(
          (q) =>
            ![...r.inputSnapshot.facts, ...r.inputSnapshot.pendingTypes].some(
              (f) =>
                f.type === q.type &&
                String(f.subjectId ?? "") === String(q.subjectId ?? ""),
            ),
        ),
      };
    } else if (r.step === "review") {
      const current = await SitePage.findOne({
        siteId: r.siteId,
        nodeKey: unit.key,
      }).session(session);
      ensure(
        current?.revision === unit.expectedRevision,
        409,
        "SOURCE_CHANGED",
      );
      const report = reviewOutput.parse(output);
      const capture = unit.capture!;
      report.findings = [
        ...report.findings,
        ...measuredFindings(capture.metrics),
      ].slice(0, 11);
      const validation = validatePage(unit.draft!, r.inputSnapshot.facts, {
        productId: unit.node?.productId,
        productIds: site.productIds.map(String),
        type: unit.node?.type ?? "home",
        brandName: site.name,
        language: site.language,
        requiredProductSections: site.plan?.strategy?.productSections,
        requireComposition: !!site.designDirection?.composition,
        paths: (site.plan?.nodes ?? []).map((n: { path: string }) => n.path),
      });
      if (validation.length) {
        report.findings = report.findings.slice(0, 11);
        report.findings.push({
          blockKey: null,
          code: validation.some((i) => i.code === "PAGE_LINK_INVALID")
            ? "navigation"
            : "procurement",
          severity: "error",
          recommendation:
            "Resolve the current fact or link validation issues listed in the page editor before approval.",
        });
      }
      output = {
        ...report,
        metrics: capture.metrics,
        requiresHumanVisualReview: !(result.visualInput ?? unit.visualInput),
        reviewMode:
          result.reviewMode ??
          ((result.visualInput ?? unit.visualInput) ? "visual" : "text"),
        screenshots: [375, 768, 1440].map((width) => ({
          width,
          url:
            "/api/v1/agent-runs/" +
            r._id +
            "/screenshots/" +
            unit.key +
            "/" +
            width,
        })),
      };
    } else if (r.step === "design") {
      if (unit.pageKind) {
        const d = prepareDesignPage(r, unit, output);
        await pinAssets(
          d.page.blocks
            .flatMap((b) => [
              b.assetId,
              ...(b.items ?? []).map((i) => i.assetId),
            ])
            .filter(Boolean) as string[],
          session,
        );
        output = d;
      } else {
        const single = unit.directionKey
          ? v.directionOutput.parse(output).proposal
          : null;
        if (single)
          ensure(single.key === unit.directionKey, 502, "AI_OUTPUT_INVALID");
        const parsedDesign = single
          ? { directions: [single] }
          : v.designOutput.parse(output);
        const pairedDirections = single
          ? [
              ...r.steps
                .filter((u) => {
                  const uo = u.output as
                    | { proposal?: DesignDirection }
                    | null
                    | undefined;
                  return u.key !== unit.key && Boolean(uo?.proposal);
                })
                .map(
                  (u) =>
                    (u.output as { proposal: DesignDirection }).proposal,
                ),
              single,
            ]
          : parsedDesign.directions;
        for (const d of parsedDesign.directions)
          validateGeneratedComposition(r, d.page, "home");
        if (
          ["brand-site-v3", "brand-site-v4"].includes(
            r.inputSnapshot.skillProfile?.version ?? "",
          ) &&
          (site.buyerProfile || site.plan?.strategy) &&
          pairedDirections.length === 2
        ) {
          const [a, b] = pairedDirections.map((d) => d.page);
          const compA = a.presentation?.composition as
            | Record<string, unknown>
            | undefined;
          const compB = b.presentation?.composition as
            | Record<string, unknown>
            | undefined;
          const axes = ["typography", "navigation", "productLayout"] as const;
          const differences =
            axes.filter((k) => compA?.[k] !== compB?.[k]).length +
            (a.presentation?.heroLayout !== b.presentation?.heroLayout
              ? 1
              : 0);
          if (differences < 2)
            throw new z.ZodError([
              {
                code: "custom",
                path: ["directions"],
                message: "Distinct compositions required",
                params: { qualityCode: "CONTENT_DIRECTIONS_REQUIRED" },
              },
            ]);
        }
        if (site.plan?.strategy && pairedDirections.length === 2) {
          const rhythm = (d: DesignDirection) =>
            JSON.stringify(
              d.page.blocks.map((b) => [
                b.type,
                b.design?.frame,
                b.design?.ratio,
              ]),
            );
          if (rhythm(pairedDirections[0]) === rhythm(pairedDirections[1]))
            throw new z.ZodError([
              {
                code: "custom",
                path: ["directions"],
                message: "Distinct section composition required",
                params: { qualityCode: "CONTENT_DIRECTIONS_REQUIRED" },
              },
            ]);
        }
        if (site.plan?.strategy)
          for (const d of parsedDesign.directions) {
            ensure(
              unit.detailNode && d.detail?.nodeKey === unit.detailNode.key,
              502,
              "AI_OUTPUT_INVALID",
            );
            validateGeneratedComposition(
              r,
              d.detail!.page,
              unit.detailNode!.type,
            );
            ensure(
              JSON.stringify(d.page.presentation?.composition) ===
                JSON.stringify(d.detail!.page.presentation?.composition),
              502,
              "AI_OUTPUT_INVALID",
            );
            for (const [kind, page] of [
              ["home", d.page],
              [unit.detailNode!.type, d.detail!.page],
            ] as const) {
              const problems = validatePage(page, r.inputSnapshot.facts, {
                type: kind,
                productId:
                  kind === "product" ? unit.detailNode!.productId : null,
                productIds: site.productIds.map(String),
                requiredProductSections: site.plan.strategy.productSections,
                paths: (site.plan.nodes ?? []).map(
                  (n: { path: string }) => n.path,
                ),
                brandName: site.name,
                language: site.language,
              });
              if (problems.length)
                throw new z.ZodError(
                  problems.map((i) => ({
                    code: "custom" as const,
                    path: ["directions", ...i.field.split(".")],
                    message: "Draft validation requirement",
                    params: { qualityCode: "CONTENT_" + i.code },
                  })),
                );
            }
            for (const page of [d.page, d.detail!.page]) {
              ensure(
                page.blocks.every((b) => !!b.design),
                502,
                "AI_OUTPUT_INVALID",
              );
            }
          }
        for (const d of parsedDesign.directions) {
          await pinAssets(
            [...d.page.blocks, ...(d.detail?.page.blocks ?? [])]
              .flatMap((b) => [
                b.assetId,
                ...(b.items ?? []).map((i) => i.assetId),
              ])
              .filter(Boolean) as string[],
            session,
          );
        }
        output = single ? { proposal: single } : parsedDesign;
      }
    } else if (r.step === "research") {
      const d = validatePlan(output, site);
      if (
        r.inputSnapshot.skillProfile?.version === "brand-site-v4" &&
        site.templateId === "adaptive"
      )
        ensure(d.strategy, 502, "AI_OUTPUT_INVALID");
      if (d.strategy?.buyingJourney === "visual-selection") {
        const irrelevant = d.strategy.productSections.filter(
          (k) =>
            ["oem", "certifications", "moq"].includes(k) &&
            !r.inputSnapshot.facts.some(
              (f) =>
                f.status === "confirmed" &&
                f.subjectType === "product" &&
                new RegExp(k === "certifications" ? "cert" : k, "i").test(
                  f.type,
                ),
            ),
        );
        if (irrelevant.length)
          throw new z.ZodError([
            {
              code: "custom",
              path: ["strategy", "productSections"],
              message:
                "Use focused questions for unconfirmed order terms; avoid industrial placeholders in visual selection",
              params: { qualityCode: "CONTENT_BUSINESS_REQUIREMENTS" },
            },
          ]);
      }
      if (site.buyerProfile)
        ensure(
          d.nodes.every((n) => !!n.brief),
          502,
          "AI_OUTPUT_INVALID",
        );
      await Site.updateOne(
        { _id: site._id },
        {
          $set: { plan: d },
          $inc: { planRevision: 1 },
          $unset: {
            confirmedPlanHash: 1,
            planReviewedBy: 1,
            planReviewedAt: 1,
          },
        },
        { session },
      );
      output = d;
    } else {
      let data: v.PageInput;
      if (r.step === "rewrite") {
        const rawOut = output as { block?: unknown } | null | undefined;
        const b = v.block.parse(rawOut?.block);
        ensure(
          b.key === unit.key &&
            b.type === unit.draft?.blocks.find((x) => x.key === unit.key)?.type,
          502,
          "AI_OUTPUT_INVALID",
        );
        data = {
          ...unit.draft!,
          blocks: unit.draft!.blocks.map((x) => (x.key === unit.key ? b : x)),
        };
      } else {
        const rawOut = output as { page?: unknown } | null | undefined;
        data = v.pageInput.parse(rawOut?.page);
      }
      if (site.designDirection && data.presentation) {
        data.presentation = {
          ...data.presentation,
          visualStyle: site.designDirection.visualStyle,
          density: site.designDirection.density,
          ...(site.designDirection.composition
            ? { composition: site.designDirection.composition }
            : {}),
        };
      }
      if (r.step !== "rewrite")
        validateGeneratedComposition(r, data, unit.node!.type);
      const page = await writePage(
        site,
        unit.node!,
        data,
        String(r.actorId),
        session,
        unit.expectedRevision ?? 0,
        String(r._id),
      );
      output = {
        pageId: String(page._id),
        ...(r.step === "refine" && unit.afterCapture
          ? {
              comparison: (["before", "after"] as const).map((phase) => ({
                phase,
                metrics:
                  (phase === "before" ? unit.beforeCapture : unit.afterCapture)
                    ?.metrics ?? [],
                screenshots: [375, 768, 1440].map((width) => ({
                  width,
                  url:
                    "/api/v1/agent-runs/" +
                    r._id +
                    "/screenshots/" +
                    unit.key +
                    "/" +
                    width +
                    "?phase=" +
                    phase,
                })),
              })),
              requiresNewReview: true,
            }
          : {}),
      };
    }

    const next = {
      ...unit,
      status: "succeeded",
      output,
      pendingResult: undefined,
      validationFeedback: undefined,
      failedBlockKeys: undefined,
      errorCode: null,
    };
    r.steps[index] = next;
    r.markModified("steps");
    r.status = r.steps.every((u) => u.status === "succeeded")
      ? "succeeded"
      : "running";
    r.active = r.status !== "succeeded";
    r.errorCode = null;
    await r.save({ session });
    await AuditLog.create(
      [
        {
          action: "site.agent.step.completed",
          actorId: r.actorId,
          targetId: String(r._id),
        },
      ],
      { session },
    );
  });
}
