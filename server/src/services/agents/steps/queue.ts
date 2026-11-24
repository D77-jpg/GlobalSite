import mongoose from "mongoose";
import {
  AgentRun,
  AuditLog,
  FactRevision,
  FactSheet,
  Site,
  SitePage,
  Task,
} from "../../../models";
import { ensure } from "../../../errors";
import * as v from "../../../validators/sites.validator";
import {
  ownSite,
  pageData,
  pageView,
  siteDto,
  sourceRows,
} from "../../sites.service";
import { factDto, productDto, sha } from "../../catalog.service";
import { assertSiteEditable } from "../../publication-lock.service";
import { siteSkillProfile } from "../../site-skill-profile";
import { validatePage } from "../../page-validation.service";
import {
  agentDto,
  assertSnapshot,
  candidatePurpose,
  designDirections,
  ownRun,
  terminal,
} from "../runtime";
import type {
  AgentPlanNode,
  AgentRunDoc,
  AgentStepUnit,
  DesignDirection,
} from "../types";

export async function queueAgent(
  siteId: string,
  input: unknown,
  requestId: string,
  actorId: string,
) {
  const data = v.agentInput.parse(input);
  ensure(/^[A-Za-z0-9_-]{8,100}$/.test(requestId), 400, "IDEMPOTENCY_REQUIRED");
  const requestKey = siteId + ":" + requestId;
  const requestHash = sha(JSON.stringify(data));
  let result!: AgentRunDoc;

  await mongoose.connection.transaction(async (session) => {
    const site = await ownSite(siteId, session);
    await assertSiteEditable(siteId, session);
    await Site.updateOne(
      { _id: siteId },
      { $inc: { lockVersion: 1 } },
      { session },
    );
    ensure(site.status !== "archived", 409, "SITE_ARCHIVED");
    const old = (await AgentRun.findOne({ requestKey }).session(
      session,
    )) as unknown as AgentRunDoc | null;
    if (old) {
      ensure(old.requestHash === requestHash, 409, "CONFLICT");
      result = old;
      return;
    }
    const lockKey = [
      "design",
      "content",
      "rewrite",
      "review",
      "refine",
    ].includes(data.step)
      ? "content"
      : data.step;
    const active = (await AgentRun.findOne({
      siteId,
      lockKey,
      active: true,
    }).session(session)) as unknown as AgentRunDoc | null;
    if (active) {
      ensure(active.requestHash === requestHash, 409, "STEP_BUSY");
      result = active;
      return;
    }
    const planNodes: AgentPlanNode[] = site.plan?.nodes ?? [];
    if (
      data.step === "content" &&
      !data.pageKey &&
      site.plan?.strategy &&
      site.designDirection
    ) {
      const pilotKeys = [
        planNodes.find((n) => n.type === "home")?.key,
        site.designDirection.detailNodeKey,
      ].filter(Boolean) as string[];
      const reviews = (await AgentRun.find({
        siteId,
        step: "review",
        status: "succeeded",
        qualityAcceptedAt: { $ne: null },
      })
        .sort({ _id: -1 })
        .limit(50)
        .session(session)) as unknown as AgentRunDoc[];
      ensure(pilotKeys.length === 2, 409, "PILOT_REVIEW_REQUIRED");
      for (const key of pilotKeys) {
        const p = await SitePage.findOne({ siteId, nodeKey: key }).session(
          session,
        );
        ensure(p, 409, "PILOT_REVIEW_REQUIRED");
        const currentPilot = await pageView(p, site, session);
        ensure(
          currentPilot.status === "approved" && !currentPilot.issues.length,
          409,
          "PILOT_REVIEW_REQUIRED",
        );
        const hash = sha(JSON.stringify(await pageData(p, session)));
        ensure(
          reviews.some(
            (r) =>
              r.inputSnapshot.site.planRevision === site.planRevision &&
              r.steps.some((u) => {
                const out = u.output as
                  | { findings?: Array<{ severity: string }> }
                  | null
                  | undefined;
                return (
                  u.key === key &&
                  sha(JSON.stringify(u.draft)) === hash &&
                  !(out?.findings ?? []).some((f) => f.severity === "error")
                );
              }),
          ),
          409,
          "PILOT_REVIEW_REQUIRED",
        );
      }
    }
    const rows = await sourceRows(site, session);
    ensure(
      rows.products.length === site.productIds.length,
      409,
      "SOURCE_CHANGED",
    );
    if (
      ["design", "content", "rewrite", "review", "refine"].includes(data.step)
    )
      ensure(siteDto(site).planConfirmed, 409, "PLAN_NOT_CONFIRMED");
    if (
      (site.templateId === "adaptive" || site.plan?.strategy) &&
      ["content", "refine"].includes(data.step)
    )
      ensure(site.designDirection, 409, "DESIGN_REQUIRED");
    const pages = await SitePage.find({ siteId }).session(session);
    const units: Partial<AgentStepUnit>[] = [];

    if (["content", "review", "refine"].includes(data.step)) {
      const nodes = planNodes.filter(
        (n) =>
          (!data.pageKey || n.key === data.pageKey) &&
          !(
            data.step === "content" &&
            !data.pageKey &&
            site.designDirection &&
            (n.type === "home" || n.key === site.designDirection.detailNodeKey)
          ),
      );
      ensure(nodes.length, 400, "PLAN_INVALID");
      const previous =
        data.step === "refine"
          ? ((await AgentRun.findOne({
              siteId,
              step: "review",
              status: "succeeded",
            })
              .sort({ _id: -1 })
              .session(session)) as unknown as AgentRunDoc | null)
          : null;
      for (const n of nodes) {
        const page = pages.find((p) => p.nodeKey === n.key);
        let draft: v.PageInput | undefined;
        let review: AgentStepUnit["review"];
        let beforeCapture: AgentStepUnit["beforeCapture"];
        if (["review", "refine"].includes(data.step)) {
          ensure(page, 409, "PAGE_MISSING");
          draft = await pageData(page, session);
          if (data.step === "refine") {
            const step = previous?.steps.find((u) => u.key === n.key);
            ensure(
              step && step.expectedRevision === page.revision,
              409,
              "REVIEW_REQUIRED",
            );
            review = step!.output as AgentStepUnit["review"];
            beforeCapture = step!.capture;
          }
        }
        units.push({
          key: n.key,
          node: n,
          expectedRevision: page?.revision ?? 0,
          ...(draft ? { draft } : {}),
          ...(review ? { review, beforeCapture } : {}),
          instructions: data.instructions ?? "",
        });
      }
    } else if (data.step === "rewrite") {
      const p = pages.find((p) => String(p._id) === data.pageId);
      ensure(p, 404, "NOT_FOUND");
      const node = planNodes.find((n) => n.key === p.nodeKey);
      ensure(node, 409, "PAGE_PLAN_CHANGED");
      const draft = await pageData(p, session);
      ensure(
        draft.blocks.some((b) => b.key === data.blockKey),
        404,
        "NOT_FOUND",
      );
      units.push({
        key: data.blockKey,
        node,
        expectedRevision: p.revision,
        draft,
        instructions: data.instructions ?? "",
      });
    } else if (data.step === "design") {
      const node = planNodes.find((n) => n.type === "home");
      ensure(node, 409, "PLAN_INVALID");
      const homeNode = node!;
      const previousDesign = site.plan?.strategy
        ? ((await AgentRun.findOne({
            siteId,
            step: "design",
            status: "succeeded",
          })
            .sort({ _id: -1 })
            .session(session)) as unknown as AgentRunDoc | null)
        : null;
      const representative =
        planNodes.find((n) => n.type === "product") ??
        planNodes.find((n) => n.type === "solution") ??
        planNodes.find((n) => n.type !== "home");
      const designUnit: Partial<AgentStepUnit> = {
        key: "design",
        ...(previousDesign
          ? { previousDirections: designDirections(previousDesign).directions }
          : {}),
        node: homeNode,
        expectedRevision:
          pages.find((p) => p.nodeKey === homeNode.key)?.revision ?? 0,
        detailNode: site.plan?.strategy ? representative : undefined,
        detailRevision: site.plan?.strategy
          ? (pages.find((p) => p.nodeKey === representative?.key)?.revision ??
            0)
          : undefined,
        instructions: data.instructions ?? "",
      };
      if (site.plan?.strategy) {
        ensure(designUnit.detailNode, 409, "PLAN_INVALID");
        for (const directionKey of ["primary", "alternate"] as const)
          for (const pageKind of ["home", "detail"] as const)
            units.push({
              ...designUnit,
              key: directionKey + "-" + pageKind,
              directionKey,
              pageKind,
              node: pageKind === "home" ? node : designUnit.detailNode,
              expectedRevision:
                pageKind === "home"
                  ? designUnit.expectedRevision
                  : designUnit.detailRevision,
            });
      } else units.push(designUnit);
    } else {
      units.push({ key: data.step });
    }

    if (data.reuseRunId) {
      const prior = await ownRun(data.reuseRunId, session);
      ensure(
        String(prior.siteId) === siteId &&
          prior.step === "design" &&
          !prior.active &&
          ["failed", "cancelled"].includes(prior.status),
        409,
        "RUN_NOT_RETRYABLE",
      );
      await assertSnapshot(prior, session);
      let reused = 0;
      for (const unit of units) {
        const original = prior.steps.find(
          (u) =>
            u.directionKey === unit.directionKey &&
            (!u.pageKind || u.pageKind === unit.pageKind) &&
            u.status === "succeeded",
        );
        if (!original) {
          const failed = prior.steps.find(
            (u) =>
              u.directionKey === unit.directionKey &&
              u.pageKind === unit.pageKind &&
              u.candidateCipher,
          );
          if (failed) {
            ensure(
              failed.expectedRevision === unit.expectedRevision &&
                failed.detailRevision === unit.detailRevision,
              409,
              "SOURCE_CHANGED",
            );
            unit.repairCandidateCipher = failed.candidateCipher;
            unit.repairCandidatePurpose = candidatePurpose(prior, failed);
          }
          continue;
        }
        const expected = original.pageKind
          ? original.expectedRevision
          : unit.pageKind === "detail"
            ? original.detailRevision
            : original.expectedRevision;
        ensure(
          expected === unit.expectedRevision &&
            original.detailRevision === unit.detailRevision,
          409,
          "SOURCE_CHANGED",
        );
        if (unit.pageKind) {
          const origOut = original.output as {
            proposal?: DesignDirection;
          };
          const value = original.pageKind
            ? v.designPageOutput.parse(original.output)
            : {
                label: origOut.proposal!.label,
                rationale: origOut.proposal!.rationale,
                page:
                  unit.pageKind === "home"
                    ? origOut.proposal!.page
                    : origOut.proposal!.detail!.page,
              };
          unit.reusedPageOutput = value;
        } else {
          unit.reusedProposal = v.directionOutput.parse(
            original.output,
          ).proposal;
        }
        unit.reusedFromRunId = data.reuseRunId;
        reused++;
      }
      ensure(reused > 0 && reused < units.length, 409, "RUN_NOT_RETRYABLE");
    }

    const pending = await FactSheet.find({
      status: "candidate",
      $or: [
        { subjectType: "organization" },
        { subjectId: { $in: site.productIds } },
      ],
    })
      .select("type subjectId")
      .limit(200)
      .session(session);
    const frozenPages = [];
    if (["review", "refine"].includes(data.step))
      for (const page of pages) {
        const node = planNodes.find((n) => n.key === page.nodeKey);
        if (node)
          frozenPages.push({
            id: String(page._id),
            nodeKey: page.nodeKey,
            path: node.path,
            type: node.type,
            productId: node.productId,
            ...(await pageData(page, session)),
          });
      }
    const snapshot = {
      pages: frozenPages,
      skillProfile: siteSkillProfile(),
      site: siteDto(site),
      products: rows.products.map(productDto),
      facts: rows.facts.map(factDto),
      pendingTypes: pending.map((p) => ({
        type: p.type,
        subjectId: p.subjectId ? String(p.subjectId) : null,
      })),
    };
    const [created] = await AgentRun.create(
      [
        {
          kind: "site.agent",
          siteId,
          step: data.step,
          lockKey,
          active: true,
          actorId,
          requestKey,
          requestHash,
          inputSnapshot: snapshot,
          inputSummary: {
            siteName: site.name,
            pages: units.length,
            products: rows.products.length,
            confirmedFacts: rows.facts.length,
          },
          steps: units.map((u) => ({
            ...u,
            inputSummary: {
              pageTitle: u.node?.title ?? site.name,
              products: rows.products.length,
              confirmedFacts: snapshot.facts.filter(
                (f) =>
                  !u.node?.productId ||
                  f.subjectType === "organization" ||
                  f.subjectId === u.node.productId,
              ).length,
              inputHash: sha(
                JSON.stringify({
                  site: snapshot.site,
                  skillHash: snapshot.skillProfile.hash,
                  node: u.node ?? null,
                  facts: snapshot.facts,
                  products: snapshot.products,
                }),
              ),
            },
            status:
              u.reusedProposal || u.reusedPageOutput ? "succeeded" : "pending",
            attempts: 0,
            output:
              u.reusedPageOutput ??
              (u.reusedProposal ? { proposal: u.reusedProposal } : null),
            tokens: 0,
            elapsedMs: 0,
            errorCode: null,
            history: [],
          })),
          tokens: 0,
        },
      ],
      { session },
    );
    result = created as unknown as AgentRunDoc;
    await Task.create(
      [
        {
          kind: "site.agent",
          operationId: "site-agent:" + result._id + ":0",
          payload: { runId: String(result._id) } as Record<string, unknown>,
        },
      ],
      { session },
    );
    await AuditLog.create(
      [{ action: "site.agent.queued", actorId, targetId: String(result._id) }],
      { session },
    );
  });
  return agentDto(result);
}

export async function retryAgent(id: string, actor: string) {
  let result!: AgentRunDoc;
  await mongoose.connection.transaction(async (session) => {
    const r = await ownRun(id, session);
    await ownSite(String(r.siteId), session);
    await Site.updateOne(
      { _id: r.siteId },
      { $inc: { lockVersion: 1 } },
      { session },
    );
    ensure(
      ["failed", "paused"].includes(r.status) &&
        (r.errorCode !== "AI_USAGE_UNKNOWN" ||
          r.steps.some((s) => !!s.pendingResult)),
      409,
      r.errorCode === "AI_USAGE_UNKNOWN"
        ? "AI_USAGE_UNKNOWN"
        : "RUN_NOT_RETRYABLE",
    );
    ensure(
      !(await AgentRun.exists({
        siteId: r.siteId,
        lockKey: r.lockKey,
        active: true,
        _id: { $ne: r._id },
      }).session(session)),
      409,
      "STEP_BUSY",
    );
    r.status = "queued";
    r.active = true;
    r.cancelRequested = false;
    r.errorCode = null;
    r.retryGeneration++;
    r.actorId = actor;
    r.steps = r.steps.map((s) =>
      s.status === "succeeded"
        ? s
        : { ...s, status: "pending", attempts: 0, errorCode: null },
    );
    await r.save({ session });
    await Task.create(
      [
        {
          kind: "site.agent",
          operationId: "site-agent:" + r._id + ":" + r.retryGeneration,
          payload: { runId: String(r._id) } as Record<string, unknown>,
        },
      ],
      { session },
    );
    await AuditLog.create(
      [{ action: "site.agent.retried", actorId: actor, targetId: id }],
      { session },
    );
    result = r;
  });
  return agentDto(result);
}

export async function acceptQualityReview(id: string, actor: string) {
  await mongoose.connection.transaction(async (session) => {
    const run = await ownRun(id, session);
    ensure(
      run.step === "review" && run.status === "succeeded",
      409,
      "REVIEW_REQUIRED",
    );
    await assertSiteEditable(String(run.siteId), session);
    await assertSnapshot(run, session);
    for (const unit of run.steps) {
      const page = await SitePage.findOne({
        siteId: run.siteId,
        nodeKey: unit.key,
      }).session(session);
      ensure(page?.revision === unit.expectedRevision, 409, "SOURCE_CHANGED");
      const site = run.inputSnapshot.site;
      ensure(
        !validatePage(await pageData(page, session), run.inputSnapshot.facts, {
          productId: unit.node?.productId,
          productIds: site.productIds,
          type: unit.node?.type ?? "home",
          brandName: site.name,
          language: site.language,
          requiredProductSections: site.plan?.strategy?.productSections,
          requireComposition: !!site.designDirection?.composition,
          paths: (site.plan?.nodes ?? []).map((n) => n.path),
        }).length,
        409,
        "QUALITY_BLOCKED",
      );
      const out = unit.output as { findings: Array<{ severity: string }> };
      const capture = unit.capture!;
      ensure(
        !out.findings.some((f) => f.severity === "error") &&
          capture.metrics.every((m) => !m.overflow && !m.brokenImages),
        409,
        "QUALITY_BLOCKED",
      );
    }
    run.qualityAcceptedAt = new Date();
    run.qualityAcceptedBy = actor;
    await run.save({ session });
    await AuditLog.create(
      [{ action: "site.quality.accepted", actorId: actor, targetId: id }],
      { session },
    );
  });
  return agentDto(await ownRun(id));
}

export async function cancelAgent(id: string, actor: string) {
  let result!: AgentRunDoc;
  await mongoose.connection.transaction(async (session) => {
    const r = await ownRun(id, session);
    if (terminal.includes(r.status)) {
      result = r;
      return;
    }
    r.cancelRequested = true;
    if (["queued", "paused", "failed"].includes(r.status)) {
      r.status = "cancelled";
      r.errorCode = "AGENT_CANCELLED";
      r.active = false;
      await Task.updateMany(
        { "payload.runId": id, kind: "site.agent", status: "pending" },
        { $set: { status: "dead", lastErrorCode: "AGENT_CANCELLED" } },
        { session },
      );
    }
    await r.save({ session });
    await AuditLog.create(
      [{ action: "site.agent.cancelled", actorId: actor, targetId: id }],
      { session },
    );
    result = r;
  });
  return agentDto(result);
}

export async function interviewAnswers(
  siteId: string,
  input: unknown,
  actor: string,
) {
  const d = v.answerInput.parse(input);
  const ids: string[] = [];
  await mongoose.connection.transaction(async (session) => {
    const site = await ownSite(siteId, session);
    const run = await ownRun(d.runId, session);
    ensure(
      String(run.siteId) === siteId &&
        run.step === "interview" &&
        run.status === "succeeded",
      404,
      "NOT_FOUND",
    );
    const stepOut = run.steps[0].output as {
      questions: Array<{
        id: string;
        type: string;
        question: string;
        subjectId: string | null;
      }>;
    };
    for (const a of d.answers) {
      const found = stepOut.questions.find((item) => item.id === a.questionId);
      ensure(found, 400, "VALIDATION_ERROR");
      const q = found!;
      ensure(
        !q.subjectId || site.productIds.map(String).includes(q.subjectId),
        409,
        "SOURCE_CHANGED",
      );
      const originKey =
        "interview:" + run._id + ":" + q.id + ":" + sha(a.answer);
      let fact = await FactSheet.findOne({ originKey }).session(session);
      if (!fact) {
        [fact] = await FactSheet.create(
          [
            {
              subjectType: q.subjectId ? "product" : "organization",
              ...(q.subjectId ? { subjectId: q.subjectId } : {}),
              type: q.type,
              value: a.answer,
              status: "candidate",
              originKey,
              source: {
                kind: "manual",
                refId: String(run._id),
                label: "Site interview",
                quote: q.question + "\n" + a.answer,
                capturedAt: new Date().toISOString(),
              },
            },
          ],
          { session },
        );
        await FactRevision.create(
          [
            {
              factId: fact._id,
              revision: 1,
              actorId: actor,
              action: "interview.candidate",
              before: null,
              after: factDto(fact),
            },
          ],
          { session },
        );
      }
      ids.push(String(fact._id));
    }
    await AuditLog.create(
      [{ action: "site.interview.answered", actorId: actor, targetId: siteId }],
      { session },
    );
  });
  return { factIds: ids };
}
