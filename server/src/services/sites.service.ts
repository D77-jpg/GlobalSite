import fs from "node:fs/promises";
import path from "node:path";
import { renderStaticPage, type Snapshot } from "./static-template.service";
import { assertSiteEditable } from "./publication-lock.service";
import mongoose from "mongoose";
import {
  Site,
  SitePage,
  SiteBlock,
  Product,
  FactSheet,
  Asset,
  AgentRun,
  AuditLog,
} from "../models";
import { runIdentity, tenantContext } from "../models/tenant-context";
import { Organization } from "../models";
import { plans } from "../constants/plans";
import { ensure } from "../errors";
import * as v from "../validators/sites.validator";
import { pinAssets, productDto, factDto, sha } from "./catalog.service";
import {
  validatePage,
  renderPage,
  type Issue,
} from "./page-validation.service";
export async function ownSite(id: string, session?: mongoose.ClientSession) {
  const s = await Site.findById(id).session(session ?? null);
  ensure(s, 404, "NOT_FOUND");
  return s;
}
export function siteDto(s: any) {
  return {
    id: String(s._id),
    revision: s.revision,
    ...(s.buyerProfile ? { buyerProfile: s.buyerProfile } : {}),
    ...(s.designDirection ? { designDirection: s.designDirection } : {}),
    ...(s.businessBrief ? { businessBrief: s.businessBrief } : {}),
    name: s.name,
    templateId: s.templateId,
    targetMarkets: s.targetMarkets,
    language: s.language,
    brandColor: s.brandColor,
    logoId: s.logoId ? String(s.logoId) : null,
    productIds: s.productIds.map(String),
    status: s.status,
    planRevision: s.planRevision,
    plan: s.plan ?? null,
    planConfirmed:
      !!s.plan && s.confirmedPlanHash === sha(JSON.stringify(s.plan)),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
export async function saveSite(
  input: unknown,
  actor: string,
  id?: string,
  revision?: number,
) {
  const data = v.siteInput.parse(input);
  let result: any;
  const orgId = tenantContext()!.organizationId;
  await mongoose.connection.transaction(async (session) => {
    const org = await runIdentity(() =>
      Organization.findOneAndUpdate(
        { _id: orgId },
        { $inc: { siteLock: 1 } },
        { session, new: true },
      ),
    );
    ensure(org, 404, "NOT_FOUND");
    if (data.logoId) await pinAssets([data.logoId], session);
    ensure(
      (await Product.countDocuments({
        _id: { $in: data.productIds },
        status: { $ne: "archived" },
        crmSourceStatus: { $nin: ["archived", "withdrawn"] },
      }).session(session)) === data.productIds.length,
      404,
      "NOT_FOUND",
    );
    if (id) {
      const before = await ownSite(id, session);
      await assertSiteEditable(id, session);
      if (before.status === "archived" && data.status !== "archived") {
        const cap = plans[(org.plan ?? "trial") as keyof typeof plans].sites;
        ensure(
          (await Site.countDocuments({ status: { $ne: "archived" } }).session(
            session,
          )) < cap,
          409,
          "SITE_LIMIT",
        );
      }
      ensure(
        !(await AgentRun.exists({ siteId: id, active: true }).session(session)),
        409,
        "STEP_BUSY",
      );
      result = await Site.findOneAndUpdate(
        { _id: id, revision },
        {
          $set: data,
          $inc: { revision: 1 },
          $unset: { confirmedPlanHash: 1, designDirection: 1 },
        },
        { session, new: true },
      );
      ensure(result, 409, "REVISION_CONFLICT");
    } else {
      const cap = plans[(org.plan ?? "trial") as keyof typeof plans].sites;
      ensure(
        (await Site.countDocuments({ status: { $ne: "archived" } }).session(
          session,
        )) < cap,
        409,
        "SITE_LIMIT",
      );
      [result] = await Site.create([data], { session });
    }
    await AuditLog.create(
      [
        {
          action: id ? "site.edited" : "site.created",
          actorId: actor,
          targetId: String(result._id),
        },
      ],
      { session },
    );
  });
  return siteDto(result);
}
export function validatePlan(input: unknown, site: any) {
  const data = v.plan.parse(input);
  for (const node of data.nodes)
    node.path = node.path === "/" ? "/" : node.path.replace(/\/+$/, "");
  const keys = new Set(data.nodes.map((n) => n.key)),
    paths = new Set(data.nodes.map((n) => n.path));
  ensure(
    keys.size === data.nodes.length && paths.size === data.nodes.length,
    400,
    "PLAN_INVALID",
  );
  ensure(
    data.nodes.filter(
      (n) => n.type === "home" && n.path === "/" && !n.parentKey,
    ).length === 1,
    400,
    "PLAN_INVALID",
  );
  for (const n of data.nodes) {
    ensure(
      /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)*$/.test(n.path) &&
        !/^\/(?:api|public|admin)(?:\/|$)/.test(n.path),
      400,
      "PLAN_INVALID",
    );
    ensure(
      n.type !== "product" ||
        (n.productId && site.productIds.map(String).includes(n.productId)),
      400,
      "PLAN_INVALID",
    );
    ensure(n.type === "product" || !n.productId, 400, "PLAN_INVALID");
    let p = n.parentKey;
    const seen = new Set([n.key]);
    let depth = 0;
    while (p) {
      ensure(keys.has(p) && !seen.has(p) && ++depth <= 4, 400, "PLAN_INVALID");
      seen.add(p);
      p = data.nodes.find((x) => x.key === p)!.parentKey;
    }
  }
  if (data.strategy) {
    const assigned = data.strategy.navigation.flatMap((g) => g.nodeKeys);
    ensure(
      new Set(assigned).size === assigned.length &&
        assigned.every(
          (k) =>
            keys.has(k) && data.nodes.find((n) => n.key === k)?.type !== "home",
        ),
      400,
      "PLAN_INVALID",
    );
  }
  return data;
}
export async function savePlan(id: string, input: unknown, actor: string) {
  const d = v.planPatch.parse(input);
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    const s = await ownSite(id, session);
    await assertSiteEditable(id, session);
    ensure(s.planRevision === d.revision, 409, "REVISION_CONFLICT");
    ensure(
      !(await AgentRun.exists({ siteId: id, active: true }).session(session)),
      409,
      "STEP_BUSY",
    );
    const plan = validatePlan(
      {
        nodes: d.nodes,
        keywords: d.keywords,
        clusters: d.clusters,
        ...((d.strategy ?? s.plan?.strategy)
          ? { strategy: d.strategy ?? s.plan.strategy }
          : {}),
      },
      s,
    );
    result = await Site.findOneAndUpdate(
      { _id: id, planRevision: d.revision },
      {
        $set: { plan },
        $inc: { planRevision: 1 },
        $unset: { confirmedPlanHash: 1, planReviewedAt: 1, planReviewedBy: 1 },
      },
      { session, new: true },
    );
    ensure(result, 409, "REVISION_CONFLICT");
    await AuditLog.create(
      [{ action: "site.plan.edited", actorId: actor, targetId: id }],
      { session },
    );
  });
  return siteDto(result);
}
export async function confirmPlan(id: string, revision: number, actor: string) {
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    const s = await ownSite(id, session);
    await assertSiteEditable(id, session);
    ensure(s.plan && s.planRevision === revision, 409, "REVISION_CONFLICT");
    validatePlan(s.plan, s);
    ensure(
      !(await AgentRun.exists({ siteId: id, active: true }).session(session)),
      409,
      "STEP_BUSY",
    );
    const existingPages = await SitePage.find({ siteId: id }).session(session);
    for (const page of existingPages) {
      const node = s.plan.nodes.find((n: any) => n.key === page.nodeKey);
      if (!node || node.path !== page.path) {
        await SitePage.updateOne(
          { _id: page._id },
          {
            $set: {
              retiredPath: page.retiredPath ?? page.path,
              path: "/__drafts/" + page._id,
              reviewStatus: "draft",
            },
            $unset: { approvedHash: 1, reviewedBy: 1, reviewedAt: 1 },
            $inc: { revision: 1 },
          },
          { session },
        );
      }
    }
    result = await Site.findOneAndUpdate(
      { _id: id, planRevision: revision },
      {
        $set: {
          confirmedPlanHash: sha(JSON.stringify(s.plan)),
          planReviewedBy: actor,
          planReviewedAt: new Date(),
        },
      },
      { session, new: true },
    );
    await AuditLog.create(
      [{ action: "site.plan.confirmed", actorId: actor, targetId: id }],
      { session },
    );
  });
  return siteDto(result);
}
export async function sourceRows(site: any, session?: mongoose.ClientSession) {
  const products = await Product.find({
    _id: { $in: site.productIds },
    status: { $ne: "archived" },
    crmSourceStatus: { $nin: ["archived", "withdrawn"] },
  }).session(session ?? null);
  const facts = await FactSheet.find({
    status: "confirmed",
    $or: [
      { subjectType: "organization" },
      { subjectType: "product", subjectId: { $in: site.productIds } },
    ],
  })
    .limit(201)
    .session(session ?? null);
  ensure(facts.length <= 200, 409, "AGENT_INPUT_TOO_LARGE");
  return { products, facts };
}
export async function sources(id: string) {
  const site = await ownSite(id),
    data = await sourceRows(site);
  return {
    products: data.products.map(productDto),
    facts: data.facts.map(factDto),
  };
}
export function blockDto(b: any) {
  return {
    ...(b.items ? { items: b.items } : {}),
    ...(b.design ? { design: b.design } : {}),
    ...(b.layout ? { layout: b.layout } : {}),
    ...(b.tone ? { tone: b.tone } : {}),
    key: b.key,
    type: b.type,
    heading: b.heading ?? "",
    body: b.body ?? "",
    table: b.table ?? null,
    faq: b.faq ?? [],
    assetId: b.assetId ? String(b.assetId) : null,
    alt: b.alt ?? "",
    refs: b.refs ?? [],
  };
}
export async function pageData(
  page: any,
  session?: mongoose.ClientSession,
): Promise<v.PageInput> {
  const blocks = await SiteBlock.find({ pageId: page._id })
    .sort({ order: 1 })
    .session(session ?? null);
  return {
    title: page.title,
    metaDescription: page.metaDescription ?? "",
    ...(page.presentation ? { presentation: page.presentation } : {}),
    refs: page.refs ?? [],
    blocks: blocks.map(blockDto),
  };
}
export async function pageView(
  page: any,
  site?: any,
  session?: mongoose.ClientSession,
) {
  site ??= await ownSite(String(page.siteId), session);
  const data = await pageData(page, session),
    refIds = [
      ...new Set(
        [
          ...data.refs,
          ...data.blocks.flatMap((b) => [
            ...b.refs,
            ...(b.items ?? []).flatMap((i) => i.refs),
          ]),
        ].map((r) => r.factId),
      ),
    ],
    facts = await FactSheet.find({ _id: { $in: refIds } }).session(
      session ?? null,
    );
  const node = site.plan?.nodes.find((n: any) => n.key === page.nodeKey),
    issues = validatePage(data, facts, {
      productId: page.productId ? String(page.productId) : null,
      productIds: site.productIds.map(String),
      type: page.type,
      brandName: site.name,
      navigationLabels:
        page.type === "home"
          ? site.plan?.strategy?.navigation.map((g: any) => g.label)
          : [],
      requiredProductSections: site.plan?.strategy?.productSections,
      requireComposition: !!site.designDirection?.composition,
      paths: site.plan?.nodes.map((n: any) => n.path),
    });
  if (
    !node ||
    node.path !== page.path ||
    node.type !== page.type ||
    String(node.productId ?? "") !== String(page.productId ?? "")
  )
    issues.push({
      code: "PAGE_PLAN_CHANGED",
      field: "page",
      blockKey: null,
      token: "",
    });
  if (
    await Product.exists({
      _id: { $in: site.productIds },
      crmSourceStatus: { $in: ["archived", "withdrawn"] },
    })
  )
    issues.push({
      code: "CRM_SOURCE_WITHDRAWN",
      field: "site",
      blockKey: null,
      token: "",
    });
  if (!siteDto(site).planConfirmed)
    issues.push({
      code: "PLAN_NOT_CONFIRMED",
      field: "page",
      blockKey: null,
      token: "",
    });
  if (site.status === "archived")
    issues.push({
      code: "SITE_ARCHIVED",
      field: "page",
      blockKey: null,
      token: "",
    });
  const assets = [
    ...new Set(
      data.blocks
        .flatMap((b) => [b.assetId, ...(b.items ?? []).map((i) => i.assetId)])
        .filter((id): id is string => !!id),
    ),
  ];
  if (
    (await Asset.countDocuments({
      _id: { $in: assets },
      status: "ready",
      mime: {
        $in: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      },
    }).session(session ?? null)) !== assets.length
  )
    issues.push({
      code: "IMAGE_UNAVAILABLE",
      field: "page",
      blockKey: null,
      token: "",
    });
  const hash = sha(
    JSON.stringify({
      data,
      path: page.path,
      siteRevision: site.revision,
      planHash: site.confirmedPlanHash ?? null,
    }),
  );
  const status = issues.length
    ? "blocked"
    : page.approvedHash === hash
      ? "approved"
      : page.reviewStatus === "rejected"
        ? "rejected"
        : "draft";
  return {
    id: String(page._id),
    siteId: String(page.siteId),
    nodeKey: page.nodeKey,
    path: node?.path ?? page.retiredPath ?? page.path,
    type: page.type,
    productId: page.productId ? String(page.productId) : null,
    revision: page.revision,
    ...data,
    issues,
    status,
    hash,
    inPlan: !!node,
    reviewedAt: page.reviewedAt ?? null,
    reviewedBy: page.reviewedBy ? String(page.reviewedBy) : null,
  };
}
export async function ownedPage(id: string, session?: mongoose.ClientSession) {
  const p = await SitePage.findById(id).session(session ?? null);
  ensure(p, 404, "NOT_FOUND");
  return p;
}
export function placeholder(node: any): v.PageInput {
  const keys = node.type === "product" ? v.productSections : ["overview"];
  return {
    title: node.title,
    metaDescription:
      "Explore our products and contact our team for information.",
    refs: [],
    blocks: keys.map((key) => ({
      key,
      type: key === "specs" ? "specs" : "text",
      heading:
        key === "specs"
          ? "Specification range"
          : key[0].toUpperCase() + key.slice(1),
      body: "Contact our team for confirmed details.",
      table:
        key === "specs"
          ? { columns: ["Specification", "Value"], rows: [] }
          : null,
      faq: [],
      assetId: null,
      alt: "",
      refs: [],
    })),
  };
}
export async function writePage(
  site: any,
  node: any,
  dataInput: unknown,
  actor: string,
  session: mongoose.ClientSession,
  expected: number,
  runId?: string,
) {
  await assertSiteEditable(String(site._id), session);
  const data = v.pageInput.parse(dataInput);
  const refIds = [
    ...new Set(
      [
        ...data.refs,
        ...data.blocks.flatMap((b) => [
          ...b.refs,
          ...(b.items ?? []).flatMap((i) => i.refs),
        ]),
      ].map((r) => r.factId),
    ),
  ];
  ensure(
    (await FactSheet.countDocuments({ _id: { $in: refIds } }).session(
      session,
    )) === refIds.length,
    404,
    "NOT_FOUND",
  );
  await pinAssets(
    data.blocks
      .flatMap((b) => [b.assetId, ...(b.items ?? []).map((i) => i.assetId)])
      .filter((id): id is string => !!id),
    session,
  );
  for (const b of data.blocks) {
    if (b.assetId)
      ensure(
        await Asset.exists({
          _id: b.assetId,
          status: "ready",
          mime: /^image\//,
        }).session(session),
        400,
        "FILE_INVALID",
      );
    for (const item of b.items ?? [])
      if (item.assetId)
        ensure(
          await Asset.exists({
            _id: item.assetId,
            status: "ready",
            mime: b.type === "downloads" ? "application/pdf" : /^image\//,
          }).session(session),
          400,
          "FILE_INVALID",
        );
  }
  let page = await SitePage.findOne({
    siteId: site._id,
    nodeKey: node.key,
  }).session(session);
  ensure((page?.revision ?? 0) === expected, 409, "SOURCE_CHANGED");
  if (page) {
    page = await SitePage.findOneAndUpdate(
      { _id: page._id, revision: expected },
      {
        $set: {
          title: data.title,
          metaDescription: data.metaDescription,
          presentation: data.presentation ?? null,
          refs: data.refs,
          path: node.path,
          type: node.type,
          productId: node.productId,
          reviewStatus: "draft",
          originRunId: runId,
        },
        $inc: { revision: 1 },
        $unset: {
          retiredPath: 1,
          approvedHash: 1,
          reviewedBy: 1,
          reviewedAt: 1,
          reviewReason: 1,
        },
      },
      { session, new: true },
    );
    ensure(page, 409, "REVISION_CONFLICT");
  } else
    [page] = await SitePage.create(
      [
        {
          siteId: site._id,
          nodeKey: node.key,
          path: node.path,
          type: node.type,
          productId: node.productId,
          title: data.title,
          metaDescription: data.metaDescription,
          presentation: data.presentation ?? null,
          refs: data.refs,
          originRunId: runId,
        },
      ],
      { session },
    );
  const old = await SiteBlock.find({ pageId: page._id }).session(session);
  await SiteBlock.deleteMany({ pageId: page._id }).session(session);
  for (const [b, i] of data.blocks.map((b, i) => [b, i] as const))
    await SiteBlock.create(
      [
        {
          ...b,
          siteId: site._id,
          pageId: page._id,
          order: i,
          revision: (old.find((x) => x.key === b.key)?.revision ?? 0) + 1,
        },
      ],
      { session },
    );
  await AuditLog.create(
    [
      {
        action: "site.page.edited",
        actorId: actor,
        targetId: String(page._id),
      },
    ],
    { session },
  );
  return page;
}
export async function createPage(id: string, nodeKey: string, actor: string) {
  let page: any;
  await mongoose.connection.transaction(async (session) => {
    const site = await ownSite(id, session),
      node = site.plan?.nodes.find((n: any) => n.key === nodeKey);
    ensure(node, 400, "PLAN_INVALID");
    page = await writePage(site, node, placeholder(node), actor, session, 0);
  });
  return pageView(page);
}
export async function savePage(
  id: string,
  revision: number,
  data: unknown,
  actor: string,
) {
  let page: any;
  await mongoose.connection.transaction(async (session) => {
    const current = await ownedPage(id, session);
    ensure(current.revision === revision, 409, "REVISION_CONFLICT");
    const site = await ownSite(String(current.siteId), session),
      node = site.plan?.nodes.find((n: any) => n.key === current.nodeKey);
    ensure(node, 409, "PAGE_PLAN_CHANGED");
    page = await writePage(site, node, data, actor, session, revision);
  });
  return pageView(page);
}
export async function reviewPage(
  id: string,
  revision: number,
  approve: boolean,
  actor: string,
  reason?: string,
) {
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    const page = await ownedPage(id, session);
    ensure(page.revision === revision, 409, "REVISION_CONFLICT");
    const site = await ownSite(String(page.siteId), session);
    await assertSiteEditable(String(site._id), session);
    await Site.updateOne(
      { _id: site._id },
      { $inc: { lockVersion: 1 } },
      { session },
    );
    const data = await pageView(page, site, session);
    if (approve) {
      ensure(!data.issues.length, 409, "PAGE_BLOCKED");
      for (const ref of [
        ...data.refs,
        ...data.blocks.flatMap((b) => [
          ...b.refs,
          ...(b.items ?? []).flatMap((i) => i.refs),
        ]),
      ])
        ensure(
          await FactSheet.findOneAndUpdate(
            { _id: ref.factId, status: "confirmed", revision: ref.revision },
            { $inc: { referenceVersion: 1 } },
            { session },
          ),
          409,
          "PAGE_BLOCKED",
        );
    }
    result = await SitePage.findOneAndUpdate(
      { _id: id, revision },
      {
        $set: {
          reviewStatus: approve ? "approved" : "rejected",
          ...(approve ? { approvedHash: data.hash } : {}),
          reviewedBy: actor,
          reviewedAt: new Date(),
          reviewReason: reason ?? null,
        },
        ...(!approve ? { $unset: { approvedHash: 1 } } : {}),
        $inc: { revision: 1 },
      },
      { session, new: true },
    );
    ensure(result, 409, "REVISION_CONFLICT");
    await AuditLog.create(
      [
        {
          action: approve ? "site.page.approved" : "site.page.rejected",
          actorId: actor,
          targetId: id,
        },
      ],
      { session },
    );
  });
  return pageView(result);
}
export async function preview(
  id: string,
  draft?: { site: any; node: any; data: v.PageInput },
) {
  const page = draft ? { siteId: draft.site._id } : await ownedPage(id),
    site = draft?.site ?? (await ownSite(String(page.siteId))),
    data = draft
      ? {
          ...draft.data,
          hash: sha(JSON.stringify(draft.data)),
          issues: validatePage(
            draft.data,
            (await sourceRows(site)).facts.map(factDto),
            {
              productIds: site.productIds.map(String),
              type: draft.node.type,
              productId: draft.node.productId,
              brandName: site.name,
              requiredProductSections: site.plan?.strategy?.productSections,
              requireComposition: !!site.designDirection?.composition,
              paths: site.plan.nodes.map((n: any) => n.path),
            },
          ),
        }
      : await pageView(page, site);
  if (!site.buyerProfile && !draft)
    return {
      html: renderPage(data, site),
      hash: data.hash,
      issues: data.issues,
    };
  const rows = await sourceRows(site);
  const pages = await SitePage.find({ siteId: site._id });
  const views = [];
  for (const row of pages) {
    if (
      !site.plan?.nodes.some(
        (n: any) => n.key === row.nodeKey && n.path === row.path,
      )
    )
      continue;
    views.push({
      ...(await pageData(row)),
      id: String(row._id),
      path: row.path,
      type: row.type,
      productId: row.productId ? String(row.productId) : null,
    });
  }
  if (draft) {
    const old = views.findIndex((p) => p.path === draft.node.path);
    if (old >= 0) views.splice(old, 1);
    views.push({
      ...draft.data,
      id,
      path: draft.node.path,
      type: draft.node.type,
      productId: draft.node.productId ?? null,
    });
    // Planned routes provide navigation and product discovery in the private concept.
    // They are render-only metadata and never create or approve pages.
    for (const node of site.plan.nodes) {
      if (!views.some((p) => p.path === node.path))
        views.push({
          id: "planned:" + node.key,
          path: node.path,
          type: node.type,
          productId: node.productId,
          title: node.title,
          metaDescription: "",
          refs: [],
          blocks: [],
        });
    }
  }
  const ids = [
    ...new Set(
      [
        site.logoId,
        ...rows.products.flatMap((p: any) => p.assetIds),
        ...views.flatMap((p: any) =>
          p.blocks.flatMap((b: any) => [
            b.assetId,
            ...(b.items ?? []).map((i: any) => i.assetId),
          ]),
        ),
      ]
        .filter(Boolean)
        .map(String),
    ),
  ];
  const assets: Snapshot["assets"] = {};
  for (const a of await Asset.find({ _id: { $in: ids } }))
    assets[String(a._id)] = {
      path: "/api/v1/assets/" + a._id,
      width: a.width ?? 640,
      height: a.height ?? 480,
      mime: a.mime,
    };
  const snapshot: Snapshot = {
    site: siteDto(site),
    pages: views,
    products: rows.products.map(productDto),
    facts: rows.facts.filter((f: any) => f.status === "confirmed").map(factDto),
    settings: { canonicalBaseUrl: "https://preview.invalid" },
    assets,
    createdAt: new Date().toISOString(),
  };
  const css = (
    (await fs.readFile(
      path.resolve(__dirname, "../../builder/site.css"),
      "utf8",
    )) +
    "\n" +
    (await fs.readFile(
      path.resolve(__dirname, "../../builder/composition.css"),
      "utf8",
    ))
  ).replace(/@font-face\s*\{[^}]+\}/g, "");
  const current = views.find((p: any) => p.id === id);
  ensure(current, 409, "PAGE_PLAN_CHANGED");
  const html = renderStaticPage(snapshot, current)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(
      "</head>",
      '<meta name="robots" content="noindex,nofollow"><style>' +
        css +
        "</style></head>",
    );
  return { html, hash: data.hash, issues: data.issues };
}
export async function readiness(id: string) {
  const site = await ownSite(id),
    issues: Issue[] = [],
    pages: any[] = [];
  if (
    await Product.exists({
      _id: { $in: site.productIds },
      crmSourceStatus: { $in: ["archived", "withdrawn"] },
    })
  )
    issues.push({
      code: "CRM_SOURCE_WITHDRAWN",
      field: "site",
      blockKey: null,
      token: "",
    });
  if (!siteDto(site).planConfirmed)
    issues.push({
      code: "PLAN_NOT_CONFIRMED",
      field: "site",
      blockKey: null,
      token: "",
    });
  if (site.status === "archived")
    issues.push({
      code: "SITE_ARCHIVED",
      field: "site",
      blockKey: null,
      token: "",
    });
  if (await AgentRun.exists({ siteId: id, active: true }))
    issues.push({
      code: "AGENT_ACTIVE",
      field: "site",
      blockKey: null,
      token: "",
    });
  const rows = await SitePage.find({ siteId: id });
  for (const node of site.plan?.nodes ?? []) {
    const row = rows.find((p) => p.nodeKey === node.key);
    if (!row) {
      issues.push({
        code: "PAGE_MISSING",
        field: "site",
        blockKey: null,
        token: node.path,
      });
      continue;
    }
    const p = await pageView(row, site),
      list = [...p.issues];
    if (p.status !== "approved")
      list.push({
        code: "PAGE_NOT_APPROVED",
        field: "page",
        blockKey: null,
        token: p.path,
      });
    pages.push({ id: p.id, ready: !list.length, issues: list });
  }
  if (!site.plan?.nodes.length)
    issues.push({
      code: "PAGE_MISSING",
      field: "site",
      blockKey: null,
      token: "/",
    });
  return {
    ready: !issues.length && pages.every((p) => p.ready),
    issues,
    pages,
  };
}
export async function requirePublishableSite(id: string) {
  const result = await readiness(id);
  ensure(result.ready, 409, "SITE_NOT_READY");
  return result;
}
