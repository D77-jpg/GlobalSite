import { rememberSite } from "./current-site";
import { RunList } from "./agent-tasks";
export { RunList } from "./agent-tasks";
import { SiteCopilot } from "./site-copilot";
import {
  LaunchWorkflowDock,
  SiteBlueprintCanvas,
  SiteLiveInspector,
  StudioMasthead,
} from "./site-studio-visuals";
import { SiteDesign } from "./site-design";
import { SiteGuide } from "./site-journey";
import { BuyerWorkspace, SiteQuality } from "./b2b";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  FileText,
  Layers3,
  Network,
  Palette,
  Workflow,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { st } from "./sites-i18n";
import type { Locale } from "./i18n";
import {
  Badge,
  Frame,
  Notice,
  languageLabels,
  templateLabels,
  useAction,
  useAgentRuns,
  useLoad,
  type Props,
  type Row,
} from "./sites/shared";
import { SiteForm } from "./sites/SiteForm";
import { PlanEditor } from "./sites/PlanEditor";
import { Interview, IssueList } from "./sites/SiteHelpers";
import {
  DemoModeBanner,
  LogoStudio,
  SiteAiOptions,
} from "./sites/SiteStudioExtras";
export { useLoad, useAgentRuns } from "./sites/shared";
export { PageReview } from "./sites/PageReview";

export function LatestSitePreview({ locale }: { locale: Locale }) {
  const { id } = useParams();
  const t = st(locale);
  const versions = useLoad("/sites/" + id + "/versions");
  const ready = versions.data?.find((v: Row) => v.status === "ready");
  useEffect(() => {
    if (ready)
      window.location.replace(
        "/api/v1/site-versions/" + ready.id + "/preview/",
      );
  }, [ready]);
  return (
    <Frame title={t("previewSite")} t={t} error={versions.error}>
      {versions.data && !ready ? (
        <>
          <p>{t("previewNeedsBuild")}</p>
          <Link className="button primary" to={"/sites/" + id + "/publishing"}>
            {t("buildPublish")}
          </Link>
        </>
      ) : (
        !versions.error && <p>{t("loading")}</p>
      )}
    </Frame>
  );
}
export function SitesPage({ locale, role }: Props) {
  const t = st(locale),
    [cursorHistory, setCursorHistory] = useState<string[]>([""]),
    cursor = cursorHistory[cursorHistory.length - 1],
    load = useLoad("/sites" + (cursor ? "?cursor=" + cursor : ""));
  return (
    <Frame
      title={t("sites")}
      banner
      sub={t("sitesSub")}
      t={t}
      error={load.error}
      actions={
        role !== "viewer" && (
          <Link className="button primary" to="/sites/new">
            {t("create")}
          </Link>
        )
      }
    >
      <div className="studio-site-list">
        {!load.data ? (
          !load.error && <p role="status">{t("loading")}</p>
        ) : !load.data.items.length ? (
          <div className="catalog-empty studio-empty">
            <Network aria-hidden="true" />
            <strong>{t("noSites")}</strong>
            <p>{t(role === "viewer" ? "noSitesViewer" : "noSitesAction")}</p>
          </div>
        ) : (
          load.data.items.map((s: Row) => (
            <article className="studio-site-row" key={s.id}>
              <div className="sites-brand" aria-hidden="true">
                {s.name.slice(0, 1)}
              </div>
              <div className="studio-site-title">
                <h2>
                  <Link to={"/sites/" + s.id}>{s.name}</Link>
                </h2>
                <p>
                  {templateLabels[s.templateId]?.[locale === "zh" ? 0 : 1]} ·{" "}
                  {s.targetMarkets.join(", ")}
                </p>
              </div>
              <div className="catalog-actions">
                <Badge status={s.status} t={t} />
                <Badge
                  status={s.planConfirmed ? "confirmedPlan" : "unconfirmedPlan"}
                  t={t}
                />
              </div>
              <div className="studio-site-links">
                <Link to={"/sites/" + s.id + "?tab=runs"}>
                  <Activity size={15} />
                  {t("runs")}
                </Link>
                <Link to={"/sites/" + s.id + "?tab=pages"}>
                  <CheckCheck size={15} />
                  {t("pages")}
                </Link>
                <Link
                  className="button secondary"
                  to={"/sites/" + s.id + "/preview"}
                >
                  {t("previewSite")}
                  <ArrowRight size={15} />
                </Link>
              </div>
            </article>
          ))
        )}
      </div>
      {(cursor || load.data?.hasMore) && (
        <nav className="studio-pagination" aria-label={t("sitePagination")}>
          <button
            className="secondary"
            disabled={!cursor}
            onClick={() => setCursorHistory((h) => h.slice(0, -1))}
          >
            {t("prevPage")}
          </button>
          <span>{cursorHistory.length}</span>
          <button
            className="secondary"
            disabled={!load.data?.hasMore}
            onClick={() =>
              setCursorHistory((h) => [...h, load.data.nextCursor])
            }
          >
            {t("nextPage")}
          </button>
        </nav>
      )}
    </Frame>
  );
}
const workspaceTabs = [
  "guide",
  "design",
  "planning",
  "interview",
  "business",
  "pages",
  "quality",
  "runs",
  "settings",
];

export function SiteWorkspace({ locale, role }: Props) {
  const { id } = useParams(),
    t = st(locale),
    [query, setQuery] = useSearchParams(),
    [taskHistory, setTaskHistory] = useState({ siteId: id, cursors: [""] }),
    taskTrail =
      taskHistory.siteId === id && query.get("tab") === "runs"
        ? taskHistory.cursors
        : [""],
    taskCursor = taskTrail[taskTrail.length - 1],
    load = useLoad("/sites/" + id),
    sources = useLoad("/sites/" + id + "/sources"),
    siteAssets = useLoad("/assets?limit=100"),
    runs = useAgentRuns(id ?? null, taskCursor),
    pages = useLoad("/sites/" + id + "/pages"),
    ready = useLoad("/sites/" + id + "/readiness"),
    requestedTab = query.get("tab") ?? "guide",
    tab = workspaceTabs.includes(requestedTab) ? requestedTab : "guide",
    [consent, setConsent] = useState(false),
    [focusPageId, setFocusPageId] = useState<string | null>(null),
    a = useAction();
  useEffect(() => {
    if (id) rememberSite(id);
  }, [id]);
  function setTab(next: string) {
    setQuery((previous) => {
      const params = new URLSearchParams(previous);
      params.set("tab", next);
      return params;
    });
  }
  const runFingerprint = runs.data?.items
    .map((r: Row) => r.id + ":" + r.status)
    .join("|");
  useEffect(() => {
    load.reload();
    pages.reload();
    ready.reload();
    sources.reload();
  }, [runFingerprint]);
  if (!load.data)
    return (
      <Frame title={t("sites")} t={t} error={load.error}>
        {!load.error && <p role="status">{t("loading")}</p>}
      </Frame>
    );
  const site = load.data,
    canEdit = role !== "viewer";
  async function queue(step: string, pageKey?: string, instructions?: string) {
    await api(
      "/sites/" + id + "/agent-runs",
      "POST",
      {
        step,
        consent: true,
        ...(pageKey ? { pageKey } : {}),
        ...(instructions ? { instructions } : {}),
      },
      { "Idempotency-Key": crypto.randomUUID() },
    );
    runs.reload();
    if (tab !== "guide")
      setTab(["review", "refine"].includes(step) ? "quality" : "runs");
  }
  const zh = locale === "zh";
  const designRun = (runs.data?.items ?? []).find(
    (item: Row) => item.step === "design" && item.status === "succeeded",
  );
  const directions = designRun?.steps?.[0]?.output?.directions ?? [];
  const stageGroups = [
    {
      key: "prep",
      num: 1,
      label: zh ? "资料与定位" : "Brief & Facts",
      tabs: ["guide", "business", "interview", "settings"].filter((k) =>
        workspaceTabs.includes(k),
      ),
      done: (site.productIds?.length ?? 0) > 0,
    },
    {
      key: "blueprint",
      num: 2,
      label: zh ? "结构与视觉" : "Plan & Design",
      tabs: ["planning", "design"].filter((k) => workspaceTabs.includes(k)),
      done: Boolean(site.planConfirmed),
    },
    {
      key: "craft",
      num: 3,
      label: zh ? "页面精修" : "Pages & Studio",
      tabs: ["pages"],
      done:
        (site.plan?.nodes?.length ?? 0) > 0 &&
        (pages.data?.items?.filter((p: Row) => p.status === "approved").length ??
          0) === (site.plan?.nodes?.length ?? 0),
    },
    {
      key: "launch",
      num: 4,
      label: zh ? "质检与上线" : "QA & Runs",
      tabs: ["quality", "runs"].filter((k) => workspaceTabs.includes(k)),
      done: false,
    },
  ];
  const activeGroup =
    stageGroups.find((g) => g.tabs.includes(tab)) ?? stageGroups[0];
  const isThreeCol = tab === "guide" || tab === "planning";
  const visualTabs = [
    { key: "guide", icon: Network, zh: "网站蓝图", en: "Site Blueprint" },
    { key: "planning", icon: Layers3, zh: "页面结构", en: "Page Architecture" },
    { key: "pages", icon: FileText, zh: "内容创意", en: "Content & Copy" },
    { key: "design", icon: Palette, zh: "视觉风格", en: "Visual Style" },
  ];
  return (
    <div className="catalog sites-workspace gs-studio-shell">
      <StudioMasthead
        eyebrow={
          site.name +
          " · " +
          site.targetMarkets.join(", ") +
          " · " +
          (languageLabels[site.language] ?? site.language ?? "English")
        }
        title={
          tab === "planning"
            ? zh
              ? "网站结构与蓝图"
              : "Site Architecture"
            : zh
              ? "网站视觉策略工作室"
              : "Visual Strategy Studio"
        }
        enTitle={tab === "planning" ? "Site Architecture" : "Visual Strategy Studio"}
        subtitle={
          tab === "planning"
            ? zh
              ? "用 AI 规划站点结构、页面内容与转化路径，构建清晰、专业、可扩展的 B2B 官网。"
              : "Architect buyer-focused navigation, page sections, and high-conversion RFQ pathways."
            : zh
              ? "用 AI 打造高转化的企业官网，从策略、设计到上线的一体化工作流。"
              : "Craft a high-converting multilingual export website from strategy and architecture to launch."
        }
        action={
          <div className="gs-row">
            <Link className="gs-btn gs-btn-sm" to={"/sites/" + id + "/publishing"}>
              {t("buildPublish")}
            </Link>
            <Link
              className="gs-btn gs-btn-sm"
              to={"/sites/" + id + "/inquiry-settings"}
            >
              {t("inquirySettings")}
            </Link>
            <Link
              className="gs-btn gs-btn-primary"
              to={"/sites/" + id + "/preview"}
            >
              {zh ? "预览上线版本" : t("previewSite")}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        }
      />
      <DemoModeBanner site={site} locale={locale} />
      <div
        className={
          tab === "runs"
            ? "gs-stack"
            : isThreeCol
              ? "gs-studio-3col"
              : "gs-studio-body"
        }
      >
        {tab !== "runs" && (
          <SiteCopilot
            site={site}
            pages={pages.data?.items}
            runs={runs.data?.items}
            locale={locale}
            canEdit={canEdit}
            busy={a.busy}
            onQueue={(step, instructions) =>
              a.run(() => queue(step, undefined, instructions))
            }
            onNavigateTab={(nextTab) => setTab(nextTab)}
          />
        )}
        <div className={"gs-studio-stage-main project-tab-" + tab}>
          {/* 4-Tab Visual Strategy Switcher (Screens 1 & 2) */}
          <div className="gs-visual-tabs-bar">
            <nav className="gs-visual-tabs" aria-label={t("sites")}>
              {visualTabs.map(({ key, icon: Icon, zh: zLabel, en: eLabel }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>
                    <strong>{zh ? zLabel : eLabel}</strong>
                    <small>{zh ? eLabel : zLabel}</small>
                  </span>
                </button>
              ))}
            </nav>
            <div className="gs-visual-sublinks">
              {(["business", "interview", "quality", "runs", "settings"] as const).map(
                (k) => (
                  <button
                    key={k}
                    type="button"
                    className={"gs-sublink-pill" + (tab === k ? " is-active" : "")}
                    onClick={() => setTab(k)}
                  >
                    {t(k)}
                  </button>
                ),
              )}
            </div>
          </div>
          {!["guide", "runs", "planning"].includes(tab) && (
            <div
              className="studio-metrics"
              role="group"
              aria-label={t("siteProgress")}
            >
              {[
                {
                  label: t("planSize"),
                  count: site.plan?.nodes?.length ?? 0,
                  icon: Network,
                  tab: "planning",
                },
                {
                  label: t("draftedPages"),
                  count: pages.data?.items.length,
                  icon: FileText,
                  tab: "pages",
                },
                {
                  label: t("approvedPages"),
                  count: pages.data?.items.filter(
                    (p: Row) => p.status === "approved",
                  ).length,
                  icon: CheckCheck,
                  tab: "pages",
                },
                {
                  label: t("recentTasks"),
                  count: runs.data?.items.length,
                  icon: Activity,
                  tab: "runs",
                },
              ].map(({ label, count, icon: Icon, tab: target }) => (
                <button
                  className="studio-metric"
                  key={label}
                  onClick={() => setTab(target)}
                >
                  <span>
                    <Icon size={16} />
                    {label}
                  </span>
                  <strong>{count ?? "—"}</strong>
                </button>
              ))}
            </div>
          )}

          {canEdit &&
            ["interview", "pages", "quality"].includes(tab) && (
              <label className="catalog-check sites-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                {t("consent")}
              </label>
            )}
          <Notice
            t={t}
            error={
              a.error ??
              runs.error ??
              pages.error ??
              ready.error ??
              sources.error
            }
            saved={a.saved}
          />
          {tab === "guide" && (
            <>
              <SiteBlueprintCanvas
                key={site.id + "-strategy"}
                site={site}
                pages={pages.data?.items}
                locale={locale}
                mode="strategy"
                directions={directions}
                selectedDirection={site.designDirection?.key}
                assets={siteAssets.data?.items ?? []}
                onSelectTab={setTab}
                onFocus={setFocusPageId}
              />
              <details className="gs-studio-fold">
                <summary>{zh ? "展开完整分步建站清单" : "Expand step-by-step build checklist"}</summary>
                <SiteGuide
                  site={site}
                  sources={sources.data}
                  pages={pages.data?.items}
                  runs={runs.data?.items}
                  locale={locale}
                  canEdit={canEdit}
                  busy={a.busy}
                  consent={consent}
                  setConsent={setConsent}
                  queue={(step) => a.run(() => queue(step))}
                  setTab={setTab}
                />
              </details>
            </>
          )}
          {tab === "design" && (
            <SiteDesign
              site={site}
              runs={runs.data?.items ?? []}
              locale={locale}
              canEdit={canEdit}
              onSave={() => {
                load.reload();
                runs.reload();
                pages.reload();
                ready.reload();
              }}
            />
          )}
          {tab === "business" && (
            <BuyerWorkspace
              key={site.revision}
              site={site}
              products={sources.data?.products ?? []}
              locale={locale}
              canEdit={canEdit}
              onSave={() => load.reload()}
            />
          )}
          {tab === "quality" && (
            <SiteQuality
              site={site}
              locale={locale}
              canEdit={canEdit}
              canApprove={role === "admin"}
              consent={consent}
              runs={runs.data?.items ?? []}
              onRun={(step, instructions) =>
                queue(step, undefined, instructions)
              }
            />
          )}
          {tab === "planning" && (
            <div className="gs-stack">
              <SiteBlueprintCanvas
                key={site.id + "-tree"}
                site={site}
                pages={pages.data?.items}
                locale={locale}
                mode="tree"
                directions={directions}
                selectedDirection={site.designDirection?.key}
                assets={siteAssets.data?.items ?? []}
                onSelectTab={setTab}
                onFocus={setFocusPageId}
              />
              <div className="gs-stack">
                <details className="gs-studio-fold">
                  <summary>
                    {zh
                      ? "编辑栏目、路径与策略字段"
                      : "Edit sitemap fields"}
                  </summary>
                <PlanEditor
                  key={site.planRevision}
                  site={site}
                  products={sources.data?.products ?? []}
                  t={t}
                  role={role}
                  done={(r) => {
                    load.set(r);
                    pages.reload();
                    ready.reload();
                  }}
                />
                </details>
                <aside className="studio-planner-rail gs-plan-tools">
                  <div className="studio-rail-heading">
                    <Workflow size={20} />
                    <h2>{t("planningAgent")}</h2>
                  </div>
                  <section>
                    <h3>{t("sourceMaterial")}</h3>
                    <dl>
                      <div>
                        <dt>{t("products")}</dt>
                        <dd>{sources.data?.products.length ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>{t("confirmedFacts")}</dt>
                        <dd>{sources.data?.facts.length ?? "—"}</dd>
                      </div>
                    </dl>
                    <Link to="?tab=business">
                      {t("business")} <ChevronRight size={14} />
                    </Link>
                  </section>
                  <section>
                    <h3>{t("research")}</h3>
                    <p>{t("researchHint")}</p>
                    {canEdit && (
                      <label className="catalog-check sites-consent">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        {t("consent")}
                      </label>
                    )}
                    {canEdit && (
                      <button
                        disabled={!consent || a.busy}
                        onClick={() => void a.run(() => queue("research"))}
                      >
                        <Network size={15} />
                        {t("generateResearch")}
                      </button>
                    )}
                  </section>
                  {runs.data?.items[0] && (
                    <section>
                      <h3>{t("latestActivity")}</h3>
                      <p>
                        {t(
                          runs.data.items[0].step === "rewrite"
                            ? "rewriteStep"
                            : runs.data.items[0].step,
                        )}{" "}
                        · {t(runs.data.items[0].status)}
                      </p>
                      <Link to="?tab=runs">
                        {t("viewExecution")} <ArrowRight size={14} />
                      </Link>
                    </section>
                  )}
                </aside>
              </div>
            </div>
          )}
          {tab === "interview" && (
            <>
              <section className="catalog-panel">
                <h2>{t("interview")}</h2>
                <p>{t("interviewHint")}</p>
                <Link to="/facts?status=candidate">{t("facts")}</Link>
                {canEdit && (
                  <button
                    disabled={!consent || a.busy}
                    onClick={() => void a.run(() => queue("interview"))}
                  >
                    {t("generateInterview")}
                  </button>
                )}
              </section>
              <Interview
                siteId={id!}
                runs={runs.data?.items ?? []}
                t={t}
                canEdit={canEdit}
              />
            </>
          )}
          {tab === "pages" && (
            <>
              <section className="catalog-panel">
                <p>{t("contentHint")}</p>
                {canEdit && (
                  <button
                    disabled={!consent || !site.planConfirmed || a.busy}
                    onClick={() => void a.run(() => queue("content"))}
                  >
                    {t("generateContent")}
                  </button>
                )}
                <p className="muted">{t("publishingHint")}</p>
                <h2>
                  {t(
                    ready.data
                      ? ready.data.ready
                        ? "ready"
                        : "notReady"
                      : "loading",
                  )}
                </h2>
                <IssueList issues={ready.data?.issues ?? []} t={t} />
                <button
                  className="secondary"
                  onClick={() => {
                    ready.reload();
                    pages.reload();
                  }}
                >
                  {t("readiness")}
                </button>
              </section>
              {role === "admin" &&
                (() => {
                  const approvable = (pages.data?.items ?? []).filter(
                    (p: Row) =>
                      p.status !== "approved" && (p.issues?.length ?? 0) === 0,
                  );
                  return approvable.length > 0 ? (
                    <div className="studio-batch-bar">
                      <span>
                        <strong>{approvable.length}</strong>{" "}
                        {t("readyToApproveCount")}
                      </span>
                      <button
                        type="button"
                        disabled={a.busy}
                        onClick={() =>
                          void a.run(async () => {
                            await api(
                              "/sites/" + id + "/pages/batch-approve",
                              "POST",
                              {
                                items: approvable.map((p: Row) => ({
                                  id: p.id,
                                  revision: p.revision,
                                })),
                              },
                            );
                            pages.reload();
                            ready.reload();
                          })
                        }
                      >
                        <CheckCheck size={15} />
                        {t("batchApprove")} ({approvable.length})
                      </button>
                    </div>
                  ) : null;
                })()}
              <div className="sites-cards">
                {site.plan?.nodes.map((n: Row) => {
                  const p = pages.data?.items.find(
                    (p: Row) => p.nodeKey === n.key,
                  );
                  return (
                    <article className="catalog-panel" key={n.key}>
                      <h2>{n.title}</h2>
                      <p>{n.path}</p>
                      <Badge status={p?.status ?? "missing"} t={t} />
                      {canEdit && (
                        <button
                          className="secondary"
                          disabled={!consent || !site.planConfirmed || a.busy}
                          aria-label={t("generatePage") + " " + n.title}
                          onClick={() =>
                            void a.run(() => queue("content", n.key))
                          }
                        >
                          {t("generatePage")}
                        </button>
                      )}
                      {p ? (
                        <>
                          <IssueList issues={p.issues} t={t} />
                          <Link
                            className="button secondary"
                            to={"/pages/" + p.id}
                          >
                            {t("editPage")}
                          </Link>
                        </>
                      ) : (
                        canEdit && (
                          <button
                            disabled={a.busy}
                            className="secondary"
                            onClick={() =>
                              void a.run(async () => {
                                await api("/sites/" + id + "/pages", "POST", {
                                  nodeKey: n.key,
                                });
                                pages.reload();
                                ready.reload();
                              })
                            }
                          >
                            {t("newPage")}
                          </button>
                        )
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {tab === "runs" && (
            <RunList
              runs={runs.data?.items}
              locale={locale}
              siteId={id!}
              site={site}
              onCreated={() => setTaskHistory({ siteId: id, cursors: [""] })}
              canEdit={canEdit}
              refresh={runs.reload}
              page={taskTrail.length}
              hasMore={!!runs.data?.hasMore}
              onNext={() => {
                if (runs.data?.nextCursor)
                  setTaskHistory({
                    siteId: id,
                    cursors: [...taskTrail, runs.data.nextCursor],
                  });
              }}
              onPrevious={() =>
                setTaskHistory({ siteId: id, cursors: taskTrail.slice(0, -1) })
              }
            />
          )}
          {tab === "settings" &&
            (canEdit ? (
              <>
                <SiteForm
                  key={site.revision}
                  site={site}
                  t={t}
                  locale={locale}
                  done={load.set}
                />
                <SiteAiOptions
                  site={site}
                  role={role}
                  locale={locale}
                  t={t}
                  onSaved={load.set}
                />
                <LogoStudio
                  site={site}
                  role={role}
                  locale={locale}
                  t={t}
                  onChanged={load.reload}
                />
              </>
            ) : (
              <p>{t("readOnly")}</p>
            ))}
        </div>
        {isThreeCol && (
          <SiteLiveInspector
            site={site}
            sources={sources.data}
            pages={pages.data?.items}
            runs={runs.data?.items}
            locale={locale}
            mode={tab === "planning" ? "tree" : "strategy"}
            focusPageId={focusPageId}
            assets={siteAssets.data?.items ?? []}
          />
        )}
      </div>
      <LaunchWorkflowDock
        site={site}
        pages={pages.data?.items}
        locale={locale}
        activeStageKey={activeGroup.key}
        onSelectStage={(stageKey) => {
          const target = stageGroups.find((g) => g.key === stageKey);
          setTab(target?.tabs[0] ?? "guide");
        }}
      />
    </div>
  );
}
