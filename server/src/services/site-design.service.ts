import mongoose from "mongoose";
import { AgentRun, SitePage, AuditLog, Product } from "../models";
import { ensure } from "../errors";
import {
  ownRun,
  assertSnapshot,
  designDirections,
} from "./site-agents.service";
import {
  ownSite,
  siteDto,
  writePage,
  preview,
  pageData,
} from "./sites.service";
import { assertSiteEditable } from "./publication-lock.service";
import * as v from "../validators/sites.validator";

// A selected proposal remains inspectable. Only its selection revision is relaxed;
// plan, product and confirmed-fact snapshots still have to match.
async function designSite(run: any, session?: mongoose.ClientSession) {
  const current = await ownSite(String(run.siteId), session);
  if (current.designDirection?.runId === String(run._id))
    return assertSnapshot(
      {
        ...run.toObject(),
        inputSnapshot: {
          ...run.inputSnapshot,
          site: { ...run.inputSnapshot.site, revision: current.revision },
        },
      },
      session,
    );
  return assertSnapshot(run, session);
}
const draftHash = (data: unknown) => JSON.stringify(v.pageInput.parse(data));
async function proposal(
  siteId: string,
  runId: string,
  key: string,
  session?: mongoose.ClientSession,
) {
  const run = await ownRun(runId, session);
  ensure(
    String(run.siteId) === siteId &&
      run.step === "design" &&
      run.status === "succeeded",
    404,
    "NOT_FOUND",
  );
  ensure(
    !(await Product.exists({
      _id: { $in: run.inputSnapshot.site.productIds },
      crmSourceStatus: { $in: ["withdrawn", "archived"] },
    }).session(session ?? null)),
    409,
    "SOURCE_CHANGED",
  );
  const data = designDirections(run);
  const choice = data.directions.find((d) => d.key === key);
  ensure(choice, 404, "NOT_FOUND");
  return { run, choice };
}
export async function previewDesign(
  siteId: string,
  runId: string,
  key: string,
  pageKind: "home" | "detail" = "home",
) {
  const { run, choice } = await proposal(siteId, runId, key);
  const site = await designSite(run);
  const node =
    pageKind === "detail"
      ? site.plan.nodes.find((n: any) => n.key === choice.detail?.nodeKey)
      : site.plan.nodes.find((n: any) => n.type === "home");
  ensure(node, 404, "NOT_FOUND");
  const page = pageKind === "detail" ? choice.detail!.page : choice.page;
  const draftSite = {
    ...site.toObject(),
    designDirection: { ...page.presentation },
  };
  return preview("design-preview", { site: draftSite, node, data: page });
}
export async function selectDesign(
  siteId: string,
  input: unknown,
  actor: string,
) {
  const data = v.selectDesignInput.parse(input);
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    const { run, choice } = await proposal(
      siteId,
      data.runId,
      data.key,
      session,
    );
    const current = await ownSite(siteId, session);
    ensure(current.status !== "archived", 409, "SITE_ARCHIVED");
    if (
      current.designDirection?.runId === data.runId &&
      current.designDirection?.key === data.key
    ) {
      result = current;
      return;
    }
    ensure(current.revision === data.revision, 409, "REVISION_CONFLICT");
    await assertSiteEditable(siteId, session);
    ensure(
      !(await AgentRun.exists({ siteId, active: true }).session(session)),
      409,
      "STEP_BUSY",
    );
    const site = await designSite(run, session);
    const switching = current.designDirection?.runId === data.runId;
    const priorChoice = switching
      ? designDirections(run).directions.find(
          (d) => d.key === current.designDirection.key,
        )
      : undefined;
    ensure(siteDto(site).planConfirmed, 409, "PLAN_NOT_CONFIRMED");
    const node = site.plan.nodes.find((n: any) => n.type === "home");
    ensure(node, 409, "PLAN_INVALID");
    const presentation = choice.page.presentation!;
    site.designDirection = {
      runId: data.runId,
      key: data.key,
      visualStyle: presentation.visualStyle,
      heroLayout: presentation.heroLayout,
      density: presentation.density ?? "comfortable",
      rationale: choice.rationale,
      ...(presentation.composition
        ? { composition: presentation.composition }
        : {}),
    };
    site.revision += 1;
    site.lockVersion += 1;
    await site.save({ session });
    await SitePage.updateMany(
      { siteId },
      {
        $unset: { approvedHash: 1, reviewedBy: 1, reviewedAt: 1 },
        $set: { reviewStatus: "draft" },
      },
      { session },
    );
    const home = await SitePage.findOne({ siteId, nodeKey: node.key }).session(
      session,
    );
    ensure(
      switching
        ? !!home &&
            String(home.originRunId) === data.runId &&
            !!priorChoice &&
            draftHash(await pageData(home, session)) ===
              draftHash(priorChoice.page)
        : (home?.revision ?? 0) === (run.steps[0].expectedRevision ?? 0),
      409,
      "SOURCE_CHANGED",
    );
    await writePage(
      site,
      node,
      choice.page,
      actor,
      session,
      home?.revision ?? 0,
      data.runId,
    );
    if (choice.detail) {
      const detailNode = site.plan.nodes.find(
        (n: any) => n.key === choice.detail!.nodeKey,
      );
      ensure(detailNode, 409, "PLAN_INVALID");
      const existing = await SitePage.findOne({
        siteId,
        nodeKey: detailNode.key,
      }).session(session);
      ensure(
        switching
          ? !!existing &&
              String(existing.originRunId) === data.runId &&
              !!priorChoice?.detail &&
              draftHash(await pageData(existing, session)) ===
                draftHash(priorChoice.detail.page)
          : (existing?.revision ?? 0) === (run.steps[0].detailRevision ?? 0),
        409,
        "SOURCE_CHANGED",
      );
      await writePage(
        site,
        detailNode,
        choice.detail.page,
        actor,
        session,
        existing?.revision ?? 0,
        data.runId,
      );
      site.designDirection = {
        ...site.designDirection,
        detailNodeKey: detailNode.key,
      };
      await site.save({ session });
    }
    await AuditLog.create(
      [{ action: "site.design.selected", actorId: actor, targetId: siteId }],
      { session },
    );
    result = site;
  });
  return siteDto(result);
}
