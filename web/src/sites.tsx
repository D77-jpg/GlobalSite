import { SiteDesign } from "./site-design";
import { SiteGuide } from "./site-journey";
import { BuyerWorkspace, SiteQuality } from "./b2b";
import { orderedNodes, moveNode } from "./site-plan";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCheck,
  ChevronRight,
  FileText,
  Layers3,
  Network,
  Workflow,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { api, ApiError } from "./api";
import { st, siteMessages } from "./sites-i18n";
import type { Locale } from "./i18n";
import "./sites.css";
import "./studio.css";
type Props = { locale: Locale; role: "admin" | "editor" | "viewer" };
type Row = Record<string, any>;
type T = ReturnType<typeof st>;
export function useLoad(path: string | null, poll = false) {
  const [state, setState] = useState<{ path: string; value: any }>(),
    [error, setError] = useState<unknown>(),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(undefined);
    const load = () =>
      api(path)
        .then((value) => {
          if (live) {
            setState({ path, value });
            setError(undefined);
          }
        })
        .catch((e) => {
          if (live) setError(e);
        })
        .finally(() => {
          if (live && poll) timer = setTimeout(load, 2000);
        });
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, poll, version]);
  return {
    data: state?.path === path ? state?.value : undefined,
    error,
    reload: () => setVersion((v) => v + 1),
    set: (value: any) => path && setState({ path, value }),
  };
}
function useAction() {
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  return {
    error,
    busy,
    saved,
    run: async (fn: () => Promise<unknown>) => {
      setError(undefined);
      setSaved(false);
      setBusy(true);
      try {
        await fn();
        setSaved(true);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
  };
}
function Notice({
  error,
  saved,
  t,
}: {
  error?: unknown;
  saved?: boolean;
  t: T;
}) {
  return error ? (
    <p className="notice error" role="alert">
      {t(
        error instanceof ApiError && error.code in siteMessages
          ? error.code
          : "failedGeneric",
      )}
    </p>
  ) : saved ? (
    <p className="notice success" role="status">
      {t("saved")}
    </p>
  ) : null;
}
function Badge({ status, t }: { status: string; t: T }) {
  return <span className={"catalog-badge " + status}>{t(status)}</span>;
}
function Frame({
  title,
  sub,
  t,
  children,
  error,
  actions,
  banner = false,
}: {
  banner?: boolean;
  title: string;
  sub?: string;
  t: T;
  children: React.ReactNode;
  error?: unknown;
  actions?: React.ReactNode;
}) {
  return (
    <div className="catalog sites-workspace">
      <header className={"catalog-heading" + (banner ? " studio-banner" : "")}>
        <div>
          <h1>{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        <div className="catalog-actions">{actions}</div>
      </header>
      <Notice t={t} error={error} />
      {children}
    </div>
  );
}
const templateLabels: Record<string, [string, string]> = {
  adaptive: ["Agent 智能设计", "Agent-composed design"],
  machinery: ["机械设备", "Machinery & equipment"],
  "building-hardware": ["建材五金", "Building materials & hardware"],
  "packaging-bags": ["包装 / 箱包", "Packaging & bags"],
};
const split = (s: string) =>
  s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
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
function SiteForm({
  site,
  t,
  done,
}: {
  site?: Row;
  locale: Locale;
  t: T;
  done: (r: any) => void;
}) {
  const a = useAction(),
    products = useLoad("/products?limit=100"),
    assets = useLoad("/assets?limit=100"),
    [ids, setIds] = useState<string[]>(site?.productIds ?? []),
    { register, handleSubmit } = useForm<any>({
      defaultValues: site
        ? { ...site, targetMarkets: site.targetMarkets.join(", ") }
        : {
            name: "",
            templateId: "machinery",
            targetMarkets: "United States",
            language: "en",
            brandColor: "#126a54",
            logoId: "",
            status: "draft",
          },
    });
  return (
    <form
      className="catalog-panel"
      onSubmit={handleSubmit((v) =>
        a.run(async () => {
          const data = {
            name: v.name,
            businessBrief: v.businessBrief ?? site?.businessBrief ?? "",
            templateId: v.templateId,
            targetMarkets: split(v.targetMarkets),
            language: "en",
            brandColor: site?.brandColor ?? "#126a54",
            ...(site?.buyerProfile ? { buyerProfile: site.buyerProfile } : {}),
            logoId: v.logoId || null,
            productIds: ids,
            status: v.status,
          };
          done(
            await api(
              site ? "/sites/" + site.id : "/sites",
              site ? "PATCH" : "POST",
              site ? { revision: site.revision, data } : data,
            ),
          );
        }),
      )}
    >
      <fieldset disabled={a.busy}>
        <div className="catalog-grid">
          <label>
            {t("name")}
            <input
              aria-label={t("name")}
              required
              maxLength={120}
              {...register("name")}
            />
            <small>{t("nameHint")}</small>
          </label>
          <label>
            {t("businessBrief")}
            <textarea
              rows={4}
              maxLength={2000}
              {...register("businessBrief")}
            />
          </label>
          <label>
            {t("markets")}
            <input required {...register("targetMarkets")} />
          </label>
          <label>
            {t("logo")}
            <select aria-label={t("logo")} {...register("logoId")}>
              <option value="">{t("none")}</option>
              {assets.data?.items
                .filter((a: Row) => a.mime.startsWith("image/"))
                .map((a: Row) => (
                  <option key={a.id} value={a.id}>
                    {a.fileName}
                  </option>
                ))}
            </select>
          </label>
          {site && (
            <label>
              {t("type")}
              <select aria-label={t("type")} {...register("status")}>
                <option value="draft">{t("draft")}</option>
                <option value="archived">{t("archived")}</option>
              </select>
            </label>
          )}
        </div>
        <details open>
          <summary>
            {t("products")} ({ids.length}/50)
          </summary>
          <div className="sites-choice-list">
            {products.data?.items
              .filter((p: Row) => p.status !== "archived")
              .map((p: Row) => (
                <label key={p.id} className="catalog-check">
                  <input
                    type="checkbox"
                    checked={ids.includes(p.id)}
                    onChange={(e) =>
                      setIds((old) =>
                        e.target.checked
                          ? [...old, p.id]
                          : old.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.name} <small>{p.sku}</small>
                </label>
              ))}
          </div>
        </details>
        <button disabled={a.busy}>{a.busy ? t("working") : t("save")}</button>
      </fieldset>
      <Notice t={t} error={a.error} saved={a.saved} />
    </form>
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
    load = useLoad("/sites/" + id),
    sources = useLoad("/sites/" + id + "/sources"),
    runs = useLoad("/sites/" + id + "/agent-runs", true),
    pages = useLoad("/sites/" + id + "/pages"),
    ready = useLoad("/sites/" + id + "/readiness"),
    [query, setQuery] = useSearchParams(),
    requestedTab = query.get("tab") ?? "guide",
    tab = workspaceTabs.includes(requestedTab) ? requestedTab : "guide",
    [consent, setConsent] = useState(false),
    a = useAction();
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
  return (
    <Frame
      title={site.name}
      banner
      sub={site.targetMarkets.join(", ") + " · English"}
      t={t}
      error={load.error}
      actions={
        <>
          <Link className="button secondary" to="/sites">
            {t("back")}
          </Link>
          <Link className="button primary" to={"/sites/" + id + "/preview"}>
            {t("previewSite")}
          </Link>
          <Link
            className="button secondary"
            to={"/sites/" + id + "/publishing"}
          >
            {t("buildPublish")}
          </Link>
          <Link
            className="button secondary"
            to={"/sites/" + id + "/inquiry-settings"}
          >
            {t("inquirySettings")}
          </Link>
        </>
      }
    >
      {tab !== "guide" && (
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
      <nav className="sites-tabs" aria-label={t("sites")}>
        {workspaceTabs.map((k) => (
          <button
            key={k}
            className={tab === k ? "" : "secondary"}
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
          >
            {t(k)}
          </button>
        ))}
      </nav>
      {canEdit &&
        ["planning", "interview", "pages", "quality"].includes(tab) && (
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
          a.error ?? runs.error ?? pages.error ?? ready.error ?? sources.error
        }
        saved={a.saved}
      />
      {tab === "guide" && (
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
          onRun={(step, instructions) => queue(step, undefined, instructions)}
        />
      )}
      {tab === "planning" && (
        <div className="studio-planner-layout">
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
          <aside className="studio-planner-rail">
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
          <div className="sites-cards">
            {site.plan?.nodes.map((n: Row) => {
              const p = pages.data?.items.find((p: Row) => p.nodeKey === n.key);
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
                      onClick={() => void a.run(() => queue("content", n.key))}
                    >
                      {t("generatePage")}
                    </button>
                  )}
                  {p ? (
                    <>
                      <IssueList issues={p.issues} t={t} />
                      <Link className="button secondary" to={"/pages/" + p.id}>
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
          t={t}
          canEdit={canEdit}
          refresh={runs.reload}
        />
      )}
      {tab === "settings" &&
        (canEdit ? (
          <SiteForm
            key={site.revision}
            site={site}
            t={t}
            locale={locale}
            done={load.set}
          />
        ) : (
          <p>{t("readOnly")}</p>
        ))}
    </Frame>
  );
}
function PlanEditor({
  site,
  products,
  t,
  role,
  done,
}: {
  site: Row;
  products: Row[];
  t: T;
  role: Props["role"];
  done: (r: any) => void;
}) {
  const defaults = site.plan?.nodes ?? [
      {
        key: "home",
        path: "/",
        title: "Home",
        type: "home",
        parentKey: null,
        productId: null,
        keywords: [],
        intent: "source",
      },
    ],
    [nodes, setNodes] = useState<Row[]>(defaults),
    [selectedNode, selectNode] = useState<string>(defaults[0]?.key),
    [dirty, setDirty] = useState(false),
    [drag, setDrag] = useState(""),
    a = useAction(),
    canEdit = role !== "viewer";
  const update = (key: string, patch: Row) => {
    setDirty(true);
    setNodes((old) => old.map((n) => (n.key === key ? { ...n, ...patch } : n)));
  };
  const move = (key: string, target: string) => {
    setDirty(true);
    setNodes((old) => moveNode(old, key, target));
  };
  const ordered = orderedNodes(nodes);
  const current = ordered.some((n) => n.key === selectedNode)
    ? selectedNode
    : ordered[0]?.key;
  return (
    <section className="catalog-panel">
      <div className="catalog-heading">
        <h2>{t("planning")}</h2>
        <Badge
          status={site.planConfirmed ? "confirmedPlan" : "unconfirmedPlan"}
          t={t}
        />
      </div>
      <p className="muted">{t("dragHint")}</p>
      {site.plan?.clusters?.length > 0 && (
        <details className="studio-clusters">
          <summary>
            {t("keywordClusters")} <span>{site.plan.clusters.length}</span>
          </summary>
          <div className="sites-keywords">
            {site.plan?.clusters.map((c: Row) => (
              <article className="catalog-subpanel" key={c.key}>
                <strong>{c.label}</strong>
                <small>{t(c.intent)}</small>
                <p>{c.keywords.join(" · ")}</p>
              </article>
            ))}
          </div>
        </details>
      )}
      <div className="studio-plan-layout">
        <nav aria-label={t("pageOutline")} className="studio-outline">
          <h3>
            <Network size={16} />
            {t("pageOutline")}
          </h3>
          {ordered.map((n) => (
            <button
              key={n.key}
              aria-pressed={n.key === current}
              onClick={() => selectNode(n.key)}
              draggable={canEdit && n.type !== "home"}
              onDragStart={() => setDrag(n.key)}
              onDragEnd={() => setDrag("")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (canEdit && drag) move(drag, n.key);
              }}
              style={{ paddingInlineStart: 12 + Math.min(n.depth, 3) * 10 }}
            >
              <FileText size={14} />
              <span>
                <strong>{n.title}</strong>
                <small>{n.path}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="sites-tree">
          {ordered.map((n) => (
            <article
              key={n.key}
              hidden={n.key !== current}
              className="sites-tree-node"
            >
              <div className="catalog-heading">
                <strong>{n.title}</strong>
                <div className="catalog-actions">
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={t("up") + " " + n.title}
                        onClick={() => {
                          const list = orderedNodes(nodes).filter(
                              (x) => x.parentKey === n.parentKey,
                            ),
                            i = list.findIndex((x) => x.key === n.key);
                          if (i > 0) move(n.key, list[i - 1].key);
                        }}
                      >
                        {t("up")}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={t("down") + " " + n.title}
                        onClick={() => {
                          const list = orderedNodes(nodes).filter(
                              (x) => x.parentKey === n.parentKey,
                            ),
                            i = list.findIndex((x) => x.key === n.key);
                          if (i >= 0 && i < list.length - 1)
                            move(list[i + 1].key, n.key);
                        }}
                      >
                        {t("down")}
                      </button>
                      {n.type !== "home" && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setDirty(true);
                            setNodes((old) =>
                              old
                                .filter((x) => x.key !== n.key)
                                .map((x) =>
                                  x.parentKey === n.key
                                    ? { ...x, parentKey: n.parentKey }
                                    : x,
                                ),
                            );
                          }}
                        >
                          {t("remove")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <fieldset disabled={!canEdit || a.busy}>
                <div className="catalog-grid">
                  <label>
                    {t("pageTitle")}
                    <input
                      maxLength={120}
                      value={n.title}
                      onChange={(e) => update(n.key, { title: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("path")}
                    <input
                      maxLength={160}
                      value={n.path}
                      onChange={(e) => update(n.key, { path: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("type")}
                    <select
                      aria-label={t("type") + " " + n.key}
                      value={n.type}
                      disabled={n.type === "home"}
                      onChange={(e) =>
                        update(n.key, { type: e.target.value, productId: null })
                      }
                    >
                      {[
                        "home",
                        "category",
                        "product",
                        "about",
                        "factory",
                        "certifications",
                        "faq",
                        "contact",
                        "customization",
                        "resources",
                        "solution",
                      ].map((k) => (
                        <option key={k} value={k}>
                          {t(k)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("parent")}
                    <select
                      aria-label={t("parent") + " " + n.key}
                      value={n.parentKey ?? ""}
                      disabled={n.type === "home"}
                      onChange={(e) =>
                        update(n.key, { parentKey: e.target.value || null })
                      }
                    >
                      <option value="">{t("none")}</option>
                      {nodes
                        .filter((x) => x.key !== n.key)
                        .map((x) => (
                          <option value={x.key} key={x.key}>
                            {x.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {t("keywords")}
                    <input
                      value={n.keywords.join(", ")}
                      onChange={(e) =>
                        update(n.key, { keywords: split(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    {t("intent")}
                    <select
                      aria-label={t("intent") + " " + n.key}
                      value={n.intent}
                      onChange={(e) =>
                        update(n.key, { intent: e.target.value })
                      }
                    >
                      {["learn", "compare", "specify", "source", "buy"].map(
                        (k) => (
                          <option key={k} value={k}>
                            {t(k)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  {n.type === "product" && (
                    <label>
                      {t("product")}
                      <select
                        value={n.productId ?? ""}
                        aria-label={t("product") + " " + n.key}
                        onChange={(e) =>
                          update(n.key, { productId: e.target.value || null })
                        }
                      >
                        <option value="">{t("none")}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {n.brief ? (
                  <details open>
                    <summary>{t("pageBriefs")}</summary>
                    <label>
                      {t("briefPurpose")}
                      <textarea
                        maxLength={240}
                        value={n.brief.purpose}
                        onChange={(e) =>
                          update(n.key, {
                            brief: { ...n.brief, purpose: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      {t("briefQuestions")}
                      <textarea
                        rows={4}
                        value={n.brief.buyerQuestions.join("\n")}
                        onChange={(e) =>
                          update(n.key, {
                            brief: {
                              ...n.brief,
                              buyerQuestions: e.target.value.split("\n"),
                            },
                          })
                        }
                        onBlur={() =>
                          update(n.key, {
                            brief: {
                              ...n.brief,
                              buyerQuestions: n.brief.buyerQuestions
                                .map((v: string) => v.trim())
                                .filter(Boolean),
                            },
                          })
                        }
                      />
                    </label>
                    <fieldset>
                      <legend>{t("briefSections")}</legend>
                      <div className="catalog-grid">
                        {[
                          "text",
                          "image",
                          "category-grid",
                          "product-grid",
                          "split",
                          "features",
                          "specs",
                          "comparison",
                          "customization",
                          "process",
                          "evidence",
                          "case-study",
                          "downloads",
                          "faq",
                          "cta",
                        ].map((k) => (
                          <label key={k} className="catalog-check">
                            <input
                              type="checkbox"
                              checked={n.brief.sections.includes(k)}
                              onChange={(e) =>
                                update(n.key, {
                                  brief: {
                                    ...n.brief,
                                    sections: e.target.checked
                                      ? [...n.brief.sections, k]
                                      : n.brief.sections.filter(
                                          (v: string) => v !== k,
                                        ),
                                  },
                                })
                              }
                            />
                            {t(k)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </details>
                ) : (
                  canEdit && (
                    <button
                      className="secondary"
                      onClick={() =>
                        update(n.key, {
                          brief: {
                            purpose: "",
                            buyerQuestions: [],
                            requiredFactTypes: [],
                            sections: [],
                          },
                        })
                      }
                    >
                      {t("addPageBrief")}
                    </button>
                  )
                )}
              </fieldset>
            </article>
          ))}
        </div>
      </div>
      {canEdit && (
        <div className="catalog-actions">
          <button
            className="secondary"
            disabled={nodes.length >= 50}
            onClick={() => {
              const key = "page-" + crypto.randomUUID().slice(0, 8);
              selectNode(key);
              setDirty(true);
              setNodes((old) => [
                ...old,
                {
                  key,
                  path: "/" + key,
                  title: "New page",
                  type: "about",
                  parentKey: nodes.find((n) => n.type === "home")?.key ?? null,
                  productId: null,
                  keywords: [],
                  intent: "learn",
                },
              ]);
            }}
          >
            {t("addNode")}
          </button>
          <button
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                done(
                  await api("/sites/" + site.id + "/plan", "PUT", {
                    revision: site.planRevision,
                    nodes: nodes.map(({ depth: _depth, ...n }) => n),
                    keywords: site.plan?.keywords ?? [],
                    clusters: site.plan?.clusters ?? [],
                  }),
                );
                setDirty(false);
              })
            }
          >
            {t("manualPlan")}
          </button>
          {role === "admin" && (
            <button
              className="secondary"
              disabled={a.busy || dirty || !site.plan || site.planConfirmed}
              onClick={() =>
                void a.run(async () =>
                  done(
                    await api("/sites/" + site.id + "/plan/confirm", "POST", {
                      revision: site.planRevision,
                    }),
                  ),
                )
              }
            >
              {t("confirmPlan")}
            </button>
          )}
        </div>
      )}
      <Notice t={t} error={a.error} saved={a.saved} />
    </section>
  );
}
function Interview({
  siteId,
  runs,
  t,
  canEdit,
}: {
  siteId: string;
  runs: Row[];
  t: T;
  canEdit: boolean;
}) {
  const run = runs.find(
      (r) => r.step === "interview" && r.status === "succeeded",
    ),
    questions = run?.steps[0]?.output?.questions ?? [],
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [saved, setSaved] = useState(false),
    a = useAction();
  return (
    <section className="catalog-panel">
      <div className="sites-dialogue" role="log" aria-label={t("interview")}>
        {!questions.length ? (
          <p className="muted">{t("empty")}</p>
        ) : (
          questions.map((q: Row) => (
            <article key={q.id}>
              <p className="sites-question">{q.question}</p>
              <label>
                {t("answer")}
                <textarea
                  aria-label={t("answer")}
                  rows={3}
                  maxLength={800}
                  disabled={!canEdit}
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((old) => ({ ...old, [q.id]: e.target.value }))
                  }
                />
              </label>
            </article>
          ))
        )}
      </div>
      {canEdit && questions.length > 0 && (
        <button
          disabled={a.busy || !Object.values(answers).some((v) => v.trim())}
          onClick={() =>
            void a.run(async () => {
              await api("/sites/" + siteId + "/interview/answers", "POST", {
                runId: run!.id,
                answers: questions
                  .filter((q: Row) => answers[q.id]?.trim())
                  .map((q: Row) => ({
                    questionId: q.id,
                    answer: answers[q.id].trim(),
                  })),
              });
              setSaved(true);
            })
          }
        >
          {t("submitAnswers")}
        </button>
      )}
      <Notice t={t} error={a.error} />
      {saved && (
        <p className="notice success" role="status">
          {t("candidatesSaved")}
        </p>
      )}
    </section>
  );
}
export function RunList({
  runs,
  t,
  canEdit,
  refresh,
}: {
  runs?: Row[];
  t: T;
  canEdit: boolean;
  refresh: () => void;
}) {
  const a = useAction();
  return (
    <section className="catalog-panel studio-runs">
      <h2>
        <Workflow size={20} />
        {t("runs")}
      </h2>
      <Notice t={t} error={a.error} />
      {!runs ? (
        <p>{t("loading")}</p>
      ) : !runs.length ? (
        <div className="studio-empty">
          <Activity aria-hidden="true" />
          <strong>{t("noTasks")}</strong>
          <p>{t("noTasksHint")}</p>
        </div>
      ) : (
        runs.map((r) => (
          <article className="studio-run" key={r.id}>
            <div className="catalog-heading">
              <h3>{t(r.step === "rewrite" ? "rewriteStep" : r.step)}</h3>
              {r.cancelRequested && r.active && (
                <p role="status">{t("cancelling")}</p>
              )}
              <Badge status={r.status} t={t} />
            </div>
            <div className="studio-run-progress">
              <span>
                {t("stepsCompleted")}{" "}
                <strong>
                  {r.steps.filter((u: Row) => u.status === "succeeded").length}{" "}
                  / {r.steps.length}
                </strong>
              </span>
              {r.steps.length > 0 && (
                <progress
                  aria-label={t("stepsCompleted")}
                  value={
                    r.steps.filter((u: Row) => u.status === "succeeded").length
                  }
                  max={r.steps.length}
                />
              )}
            </div>
            <p className="muted">
              {t("inputSummary")}: {t("products")} {r.inputSummary.products} ·{" "}
              {t("confirmedFacts")} {r.inputSummary.confirmedFacts} ·{" "}
              {t("pages")} {r.inputSummary.pages}
            </p>
            <p>
              {t("tokens")}: {r.tokens} · {t("elapsed")}:{" "}
              {(r.elapsedMs / 1000).toFixed(1)} {t("seconds")}
            </p>
            {r.errorCode && (
              <p className="notice error">
                {t(r.errorCode in siteMessages ? r.errorCode : "AGENT_FAILED")}
              </p>
            )}
            {r.steps.map((s: Row) => (
              <details key={s.key}>
                <summary>
                  {s.inputSummary?.pageTitle || s.key}
                  {r.step === "rewrite" && " / " + s.key} · {t(s.status)} ·{" "}
                  {t("attempts")} {s.attempts} · {s.tokens} tokens
                </summary>
                <p>
                  {t("elapsed")}: {(s.elapsedMs / 1000).toFixed(1)}{" "}
                  {t("seconds")}
                </p>
                {s.inputSummary && (
                  <p className="muted">
                    {t("sourceMaterial")} · {t("products")}{" "}
                    {s.inputSummary.products} · {t("confirmedFacts")}{" "}
                    {s.inputSummary.confirmedFacts}
                  </p>
                )}
                {s.output?.reviewMode && (
                  <p>
                    <strong>{t("reviewMethod")}</strong> ·{" "}
                    {t("reviewMethod_" + s.output.reviewMode)}
                  </p>
                )}
                {s.output?.metrics?.length > 0 && (
                  <ul aria-label={t("browserMeasurements")}>
                    {s.output.metrics.map((m: Row) => (
                      <li key={m.width}>
                        {m.width}px ·{" "}
                        {t(m.overflow ? "overflowDetected" : "noOverflow")} ·{" "}
                        {t("brokenImages")} {m.brokenImages}
                      </li>
                    ))}
                  </ul>
                )}
                {Array.isArray(s.output?.findings) && (
                  <p>
                    {t("recordedFindings")} · {s.output.findings.length}
                  </p>
                )}
                {s.output?.directions?.length > 0 && (
                  <Link to={"/sites/" + r.siteId + "?tab=design"}>
                    {t("design")}
                  </Link>
                )}
                {s.output?.nodes && (
                  <Link to={"/sites/" + r.siteId + "?tab=planning"}>
                    {t("openGeneratedPlan")} · {s.output.nodes.length}
                  </Link>
                )}
                {s.output?.questions?.length > 0 && (
                  <Link to={"/sites/" + r.siteId + "?tab=interview"}>
                    {t("openInterview")} · {s.output.questions.length}
                  </Link>
                )}
                {s.output?.screenshots?.length > 0 && (
                  <Link to={"/sites/" + r.siteId + "?tab=quality"}>
                    {t("openReport")} · {s.output.screenshots.length}{" "}
                    {t("screenCaptures")}
                  </Link>
                )}
                {s.output?.pageId && (
                  <Link to={"/pages/" + s.output.pageId}>{t("editPage")}</Link>
                )}
                {s.output?.directions?.length > 0 && (
                  <Link to={"/sites/" + r.siteId + "?tab=design"}>
                    {t("design")}
                  </Link>
                )}
                {s.output?.nodes && (
                  <ul>
                    {s.output.nodes.map((n: Row) => (
                      <li key={n.key}>
                        {n.title} · {n.path}
                      </li>
                    ))}
                  </ul>
                )}
                {s.output?.questions && (
                  <ul>
                    {s.output.questions.map((q: Row) => (
                      <li key={q.id}>{q.question}</li>
                    ))}
                  </ul>
                )}
                {s.history.map((h: Row, i: number) => (
                  <p key={i}>
                    {t("attempts")} {h.attempt} · {h.tokens} tokens ·{" "}
                    {(h.elapsedMs / 1000).toFixed(1)} {t("seconds")}{" "}
                    {h.errorCode
                      ? t(
                          h.errorCode in siteMessages
                            ? h.errorCode
                            : "AGENT_FAILED",
                        )
                      : ""}
                  </p>
                ))}
              </details>
            ))}
            {canEdit && (
              <div className="catalog-actions">
                {["failed", "paused"].includes(r.status) && (
                  <button
                    className="secondary"
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(async () => {
                        await api("/agent-runs/" + r.id + "/retry", "POST");
                        refresh();
                      })
                    }
                  >
                    {t("retry")}
                  </button>
                )}
                {r.active && (
                  <button
                    className="secondary"
                    disabled={a.busy || r.cancelRequested}
                    onClick={() =>
                      void a.run(async () => {
                        await api("/agent-runs/" + r.id + "/cancel", "POST");
                        refresh();
                      })
                    }
                  >
                    {t("cancel")}
                  </button>
                )}
              </div>
            )}
          </article>
        ))
      )}
    </section>
  );
}
function IssueList({ issues, t }: { issues: Row[]; t: T }) {
  return issues.length ? (
    <ul className="sites-issues" role="list">
      {issues.map((i, index) => (
        <li key={index}>
          {t(i.code)}
          {i.token ? " · " + i.token : ""}
        </li>
      ))}
    </ul>
  ) : null;
}
function RefPicker({
  refs,
  facts,
  t,
  onChange,
  disabled,
}: {
  refs: Row[];
  facts: Row[];
  t: T;
  onChange: (refs: Row[]) => void;
  disabled?: boolean;
}) {
  return (
    <details className="sites-refs">
      <summary>
        {t("factRefs")} ({refs.length})
      </summary>
      <div className="sites-choice-list">
        {!facts.length && (
          <p>
            {t("noFacts")} <Link to="/facts">{t("facts")}</Link>
          </p>
        )}
        {refs
          .filter(
            (r) =>
              !facts.some(
                (f) => f.id === r.factId && f.revision === r.revision,
              ),
          )
          .map((r) => (
            <label key={r.factId} className="catalog-check">
              <input
                disabled={disabled}
                type="checkbox"
                checked
                onChange={() =>
                  onChange(refs.filter((x) => x.factId !== r.factId))
                }
              />
              {t("stale")} {r.factId}
            </label>
          ))}
        {facts.map((f) => (
          <label key={f.id} className="catalog-check">
            <input
              disabled={disabled}
              type="checkbox"
              checked={refs.some(
                (r) => r.factId === f.id && r.revision === f.revision,
              )}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [
                        ...refs.filter((r) => r.factId !== f.id),
                        { factId: f.id, revision: f.revision },
                      ]
                    : refs.filter((r) => r.factId !== f.id),
                )
              }
            />
            <span>
              <strong>
                {f.value}
                {f.unit ? " " + f.unit : ""}
              </strong>
              <small>{f.type}</small>
              <small>
                {t("sourceQuote")}: {f.source.quote}
              </small>
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}
export function PageReview({ locale, role }: Props) {
  const { id } = useParams(),
    load = useLoad("/pages/" + id),
    t = st(locale);
  if (!load.data)
    return (
      <Frame title={t("editPage")} t={t} error={load.error}>
        <p>{t("loading")}</p>
      </Frame>
    );
  return (
    <PageEditor
      key={load.data.revision}
      page={load.data}
      t={t}
      role={role}
      reload={load.reload}
    />
  );
}
function PageEditor({
  page,
  t,
  role,
  reload,
}: {
  page: Row;
  t: T;
  role: Props["role"];
  reload: () => void;
}) {
  const [data, setData] = useState<Row>({
      title: page.title,
      metaDescription: page.metaDescription,
      ...(page.presentation ? { presentation: page.presentation } : {}),
      refs: page.refs,
      blocks: page.blocks,
    }),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(""),
    [editingBlock, setEditingBlock] = useState<string>(
      page.blocks[0]?.key ?? "",
    ),
    [shotBrief, setShotBrief] = useState(
      [
        page.presentation?.headline ?? page.title,
        page.presentation?.designNotes,
      ]
        .filter(Boolean)
        .join(". ")
        .slice(0, 600),
    ),
    [candidate, setCandidate] = useState(""),
    imageConnection = useLoad(
      role !== "viewer" ? "/assets/image-provider" : null,
    ),
    [mobile, setMobile] = useState(false),
    [consent, setConsent] = useState(false),
    [instructions, setInstructions] = useState(""),
    [reason, setReason] = useState(""),
    [job, setJob] = useState<string>(),
    sources = useLoad("/sites/" + page.siteId + "/sources"),
    assets = useLoad("/assets?limit=100"),
    run = useLoad(job ? "/agent-runs/" + job : null, true),
    a = useAction(),
    canEdit = role !== "viewer";
  useEffect(() => {
    if (
      run.data &&
      ["succeeded", "cancelled", "failed", "paused"].includes(run.data.status)
    ) {
      if (run.data.status === "succeeded") reload();
    }
  }, [run.data?.status]);
  const update = (patch: Row) => {
    setDirty(true);
    setData((old: Row) => ({ ...old, ...patch }));
  };
  const blockUpdate = (key: string, patch: Row) =>
    update({
      blocks: data.blocks.map((b: Row) =>
        b.key === key ? { ...b, ...patch } : b,
      ),
    });
  const selectedBlock = data.blocks.some((b: Row) => b.key === editingBlock)
    ? editingBlock
    : data.blocks[0]?.key;
  const locked = a.busy || !!(job && run.data?.active);
  return (
    <Frame
      title={page.title}
      sub={t("editPage") + " · " + page.path}
      t={t}
      error={sources.error}
      actions={
        <>
          <Badge status={page.status} t={t} />
          <Link className="button secondary" to={"/sites/" + page.siteId}>
            {t("sites")}
          </Link>
        </>
      }
    >
      <Notice t={t} error={a.error} saved={a.saved} />
      <IssueList issues={page.issues} t={t} />
      <nav className="studio-jumps" aria-label={t("editorJump")}>
        <Layers3 size={15} />
        <a href="#editor-meta">{t("metaFields")}</a>
        {data.blocks.length > 0 && (
          <a href="#editor-blocks">
            {t("blockEditor")} · {data.blocks.length}
          </a>
        )}
        <a href="#editor-review">{t("pageReview")}</a>
      </nav>
      {canEdit && (
        <details className="catalog-panel">
          <summary>{t("coverStudio")}</summary>
          {imageConnection.data?.configured ? (
            <fieldset disabled={locked}>
              <label>
                {t("coverBrief")}
                <textarea
                  value={shotBrief}
                  maxLength={600}
                  onChange={(e) => setShotBrief(e.target.value)}
                />
              </label>
              <p>{t("coverConsent")}</p>
              <button
                disabled={shotBrief.trim().length < 3}
                onClick={() =>
                  void a.run(async () => {
                    const result = await api(
                      "/assets/generate-image",
                      "POST",
                      {
                        subject: shotBrief,
                        composition:
                          page.type === "product" ? "still-life" : "campaign",
                      },
                      { "Idempotency-Key": crypto.randomUUID() },
                    );
                    setCandidate(result.id);
                    assets.reload();
                  })
                }
              >
                {t(a.busy ? "coverGenerating" : "coverGenerate")}
              </button>
              {candidate && (
                <figure>
                  <img
                    width="320"
                    src={"/api/v1/assets/" + candidate + "?variant=webp"}
                    alt={t("coverCandidate")}
                  />
                  <figcaption>
                    <button
                      disabled={
                        data.blocks.length >= 32 &&
                        !data.blocks.some((b: Row) => b.type === "image")
                      }
                      onClick={() => {
                        const imageIndex = data.blocks.findIndex(
                          (b: Row) => b.type === "image",
                        );
                        const alt =
                          "Concept illustration for " +
                          String(
                            data.presentation?.navigationLabel || data.title,
                          ).slice(0, 140);
                        const next =
                          imageIndex < 0
                            ? [
                                {
                                  key:
                                    "visual-" + crypto.randomUUID().slice(0, 8),
                                  type: "image",
                                  heading: "",
                                  body: "",
                                  table: null,
                                  faq: [],
                                  assetId: candidate,
                                  alt,
                                  refs: [],
                                },
                                ...data.blocks,
                              ]
                            : data.blocks.map((b: Row, i: number) =>
                                i === imageIndex
                                  ? { ...b, assetId: candidate, alt, refs: [] }
                                  : b,
                              );
                        update({ blocks: next });
                        setCandidate("");
                      }}
                    >
                      {t("useCover")}
                    </button>
                  </figcaption>
                </figure>
              )}
            </fieldset>
          ) : (
            <Link to="/assets">{t("configureCover")}</Link>
          )}
        </details>
      )}
      {dirty && <p className="notice">{t("saveBefore")}</p>}
      <fieldset
        id="editor-meta"
        disabled={!canEdit || locked}
        className="catalog-panel"
      >
        <div className="catalog-grid">
          <label>
            {t("seoTitle")}
            <input
              maxLength={100}
              value={data.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <label>
            {t("metaDescription")}
            <textarea
              aria-label={t("metaDescription")}
              maxLength={200}
              value={data.metaDescription}
              onChange={(e) => update({ metaDescription: e.target.value })}
            />
          </label>
        </div>
        <RefPicker
          refs={data.refs}
          facts={sources.data?.facts ?? []}
          t={t}
          onChange={(refs) => update({ refs })}
          disabled={!canEdit || locked}
        />
      </fieldset>
      {data.presentation ? (
        <fieldset disabled={!canEdit || locked} className="catalog-panel">
          <h2>{t("brandPresentation")}</h2>
          <p className="hint">{t("presentationHint")}</p>
          <div className="catalog-grid">
            {(
              [
                "navigationLabel",
                "headline",
                "summary",
                "primaryActionLabel",
              ] as const
            ).map((field) => (
              <label key={field}>
                {t(field)}
                <input
                  value={data.presentation[field]}
                  maxLength={
                    field === "navigationLabel"
                      ? 24
                      : field === "summary"
                        ? 240
                        : field === "primaryActionLabel"
                          ? 32
                          : 100
                  }
                  onChange={(e) =>
                    update({
                      presentation: {
                        ...data.presentation,
                        [field]: e.target.value,
                      },
                    })
                  }
                />
              </label>
            ))}
            <label>
              {t("visualStyle")}
              <select
                value={data.presentation.visualStyle}
                onChange={(e) =>
                  update({
                    presentation: {
                      ...data.presentation,
                      visualStyle: e.target.value,
                    },
                  })
                }
              >
                {(["organic", "industrial", "minimal"] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {t(value)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {t("heroLayout")}
              <select
                value={data.presentation.heroLayout}
                onChange={(e) =>
                  update({
                    presentation: {
                      ...data.presentation,
                      heroLayout: e.target.value,
                    },
                  })
                }
              >
                <option value="split">{t("split")}</option>
                <option value="stacked">{t("stacked")}</option>
              </select>
            </label>
            <label>
              {t("primaryActionTarget")}
              <select
                value={data.presentation.primaryActionTarget ?? "collection"}
                onChange={(e) =>
                  update({
                    presentation: {
                      ...data.presentation,
                      primaryActionTarget: e.target.value,
                    },
                  })
                }
              >
                {["collection", "inquiry", "catalogue"].map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("density")}
              <select
                value={data.presentation.density ?? "comfortable"}
                onChange={(e) =>
                  update({
                    presentation: {
                      ...data.presentation,
                      density: e.target.value,
                    },
                  })
                }
              >
                {["comfortable", "compact"].map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("designNotes")}
              <textarea
                value={data.presentation.designNotes}
                maxLength={500}
                onChange={(e) =>
                  update({
                    presentation: {
                      ...data.presentation,
                      designNotes: e.target.value,
                    },
                  })
                }
              />
            </label>
          </div>
        </fieldset>
      ) : (
        canEdit && (
          <button
            className="button secondary"
            disabled={locked}
            onClick={() =>
              update({
                presentation: {
                  navigationLabel:
                    page.type === "home"
                      ? "Home"
                      : page.title.split("|")[0].trim().slice(0, 24),
                  headline: page.title.split("|")[0].trim().slice(0, 100),
                  summary: page.metaDescription || "Explore the collection.",
                  primaryActionLabel: "Explore collection",
                  visualStyle: "organic",
                  heroLayout: "split",
                  designNotes: "",
                },
              })
            }
          >
            {t("addPresentation")}
          </button>
        )
      )}
      {data.blocks.length > 0 && (
        <nav
          id="editor-blocks"
          className="studio-block-nav"
          aria-label={t("blockEditor")}
        >
          {data.blocks.map((b: Row, i: number) => (
            <button
              key={b.key}
              aria-pressed={b.key === selectedBlock}
              onClick={() => setEditingBlock(b.key)}
            >
              <span>{i + 1}</span>
              {b.heading || b.key}
              {page.issues.some((v: Row) => v.blockKey === b.key) && (
                <small>{t("needsEvidence")}</small>
              )}
            </button>
          ))}
        </nav>
      )}
      {data.blocks.map(
        (b: Row, index: number) =>
          b.key === selectedBlock && (
            <section
              className={
                "catalog-panel sites-block " +
                (page.issues.some((i: Row) => i.blockKey === b.key)
                  ? "sites-block-error"
                  : "")
              }
              key={b.key}
            >
              <div className="catalog-heading">
                <h2>
                  {t("jobStep")} {index + 1} · {b.key}
                </h2>
                {canEdit && (
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() =>
                      update({
                        blocks: data.blocks.filter((x: Row) => x.key !== b.key),
                      })
                    }
                  >
                    {t("remove")}
                  </button>
                )}
              </div>
              <IssueList
                issues={page.issues.filter((i: Row) => i.blockKey === b.key)}
                t={t}
              />
              <fieldset disabled={!canEdit || locked}>
                <div className="catalog-grid">
                  <label>
                    {t("heading")}
                    <input
                      maxLength={160}
                      value={b.heading}
                      onChange={(e) =>
                        blockUpdate(b.key, { heading: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t("type")}
                    <select
                      aria-label={t("type") + " " + b.key}
                      value={b.type}
                      onChange={(e) =>
                        blockUpdate(b.key, {
                          type: e.target.value,
                          ...(["specs", "comparison"].includes(
                            e.target.value,
                          ) && !b.table
                            ? {
                                table: {
                                  columns: ["Specification", "Value"],
                                  rows: [],
                                },
                              }
                            : {}),
                        })
                      }
                    >
                      {[
                        "text",
                        "specs",
                        "faq",
                        "image",
                        "category-grid",
                        "product-grid",
                        "split",
                        "features",
                        "process",
                        "customization",
                        "evidence",
                        "case-study",
                        "downloads",
                        "cta",
                        "comparison",
                      ].map((k) => (
                        <option key={k} value={k}>
                          {t(k)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  {t("body")}
                  <textarea
                    aria-label={t("body")}
                    rows={5}
                    maxLength={6000}
                    value={b.body}
                    onChange={(e) =>
                      blockUpdate(b.key, { body: e.target.value })
                    }
                  />
                </label>
                {["specs", "comparison"].includes(b.type) && b.table && (
                  <>
                    <label>
                      {t("tableColumns")}
                      <input
                        value={b.table.columns.join(", ")}
                        onChange={(e) => {
                          const columns = split(e.target.value).slice(0, 10);
                          blockUpdate(b.key, {
                            table: {
                              columns,
                              rows: b.table.rows.map((r: string[]) =>
                                columns.map((_, i) => r[i] ?? ""),
                              ),
                            },
                          });
                        }}
                      />
                    </label>
                    <div className="catalog-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            {b.table.columns.map((c: string, i: number) => (
                              <th key={i}>{c}</th>
                            ))}
                            <th>{t("remove")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.table.rows.map((r: string[], i: number) => (
                            <tr key={i}>
                              {r.map((c: string, j: number) => (
                                <td key={j}>
                                  <input
                                    aria-label={
                                      b.table.columns[j] + " " + (i + 1)
                                    }
                                    maxLength={300}
                                    value={c}
                                    onChange={(e) =>
                                      blockUpdate(b.key, {
                                        table: {
                                          ...b.table,
                                          rows: b.table.rows.map(
                                            (r: string[], k: number) =>
                                              k === i
                                                ? r.map(
                                                    (c: string, l: number) =>
                                                      j === l
                                                        ? e.target.value
                                                        : c,
                                                  )
                                                : r,
                                          ),
                                        },
                                      })
                                    }
                                  />
                                </td>
                              ))}
                              <td>
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    blockUpdate(b.key, {
                                      table: {
                                        ...b.table,
                                        rows: b.table.rows.filter(
                                          (_: any, k: number) => i !== k,
                                        ),
                                      },
                                    })
                                  }
                                >
                                  {t("remove")}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      className="secondary"
                      disabled={b.table.rows.length >= 50}
                      onClick={() =>
                        blockUpdate(b.key, {
                          table: {
                            ...b.table,
                            rows: [
                              ...b.table.rows,
                              b.table.columns.map(() => ""),
                            ],
                          },
                        })
                      }
                    >
                      {t("addRow")}
                    </button>
                  </>
                )}
                {b.type === "faq" && (
                  <>
                    {b.faq.map((f: Row, i: number) => {
                      const patch = (p: Row) =>
                        blockUpdate(b.key, {
                          faq: b.faq.map((q: Row, k: number) =>
                            k === i ? { ...q, ...p } : q,
                          ),
                        });
                      return (
                        <div className="catalog-subpanel" key={i}>
                          <label>
                            {t("question")}
                            <input
                              value={f.question}
                              maxLength={300}
                              onChange={(e) =>
                                patch({ question: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            {t("directAnswer")}
                            <textarea
                              aria-label={t("directAnswer")}
                              rows={5}
                              value={f.answer}
                              maxLength={1800}
                              onChange={(e) =>
                                patch({ answer: e.target.value })
                              }
                            />
                            <small>
                              {
                                f.answer.trim().split(/\s+/).filter(Boolean)
                                  .length
                              }{" "}
                              {t("words")}
                            </small>
                          </label>
                          <label>
                            {t("detail")}
                            <textarea
                              aria-label={t("detail")}
                              value={f.detail}
                              maxLength={2500}
                              onChange={(e) =>
                                patch({ detail: e.target.value })
                              }
                            />
                          </label>
                          <button
                            className="secondary"
                            onClick={() =>
                              blockUpdate(b.key, {
                                faq: b.faq.filter(
                                  (_: any, k: number) => i !== k,
                                ),
                              })
                            }
                          >
                            {t("remove")}
                          </button>
                        </div>
                      );
                    })}
                    <button
                      className="secondary"
                      disabled={b.faq.length >= 20}
                      onClick={() =>
                        blockUpdate(b.key, {
                          faq: [
                            ...b.faq,
                            { question: "", answer: "", detail: "" },
                          ],
                        })
                      }
                    >
                      {t("addFaq")}
                    </button>
                  </>
                )}
                {["image", "split"].includes(b.type) && (
                  <div className="catalog-grid">
                    <label>
                      {t("image")}
                      <select
                        aria-label={t("image") + " " + b.key}
                        value={b.assetId ?? ""}
                        onChange={(e) =>
                          blockUpdate(b.key, {
                            assetId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">{t("none")}</option>
                        {assets.data?.items
                          .filter((a: Row) => a.mime.startsWith("image/"))
                          .map((a: Row) => (
                            <option key={a.id} value={a.id}>
                              {a.fileName}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      {t("alt")}
                      <input
                        maxLength={200}
                        value={b.alt}
                        onChange={(e) =>
                          blockUpdate(b.key, { alt: e.target.value })
                        }
                      />
                    </label>
                  </div>
                )}
                {!["text", "specs", "faq", "image"].includes(b.type) && (
                  <>
                    <label>
                      {t("blockLayout")}
                      <select
                        value={b.layout ?? "cards"}
                        onChange={(e) =>
                          blockUpdate(b.key, { layout: e.target.value })
                        }
                      >
                        {["cards", "split", "reverse", "band", "compact"].map(
                          (v) => (
                            <option key={v} value={v}>
                              {t(v)}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      {t("blockTone")}
                      <select
                        value={b.tone ?? "light"}
                        onChange={(e) =>
                          blockUpdate(b.key, { tone: e.target.value })
                        }
                      >
                        {["light", "sage", "dark"].map((v) => (
                          <option key={v} value={v}>
                            {t(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(b.items ?? []).map((item: Row, i: number) => {
                      const change = (patch: Row) =>
                        blockUpdate(b.key, {
                          items: b.items.map((x: Row, j: number) =>
                            j === i ? { ...x, ...patch } : x,
                          ),
                        });
                      return (
                        <fieldset className="catalog-panel" key={i}>
                          <legend>
                            {t("blockItem")} {i + 1}
                          </legend>
                          <label>
                            {t("heading")}
                            <input
                              maxLength={160}
                              value={item.title}
                              onChange={(e) =>
                                change({ title: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            {t("body")}
                            <textarea
                              maxLength={1200}
                              value={item.body}
                              onChange={(e) => change({ body: e.target.value })}
                            />
                          </label>
                          <label>
                            {t("internalLink")}
                            <input
                              value={item.href ?? ""}
                              onChange={(e) =>
                                change({ href: e.target.value || null })
                              }
                            />
                          </label>
                          <label>
                            {t("image")} / PDF
                            <select
                              value={item.assetId ?? ""}
                              onChange={(e) =>
                                change({ assetId: e.target.value || null })
                              }
                            >
                              <option value="">{t("none")}</option>
                              {(assets.data?.items ?? [])
                                .filter((a: Row) =>
                                  b.type === "downloads"
                                    ? a.mime === "application/pdf"
                                    : a.mime.startsWith("image/"),
                                )
                                .map((a: Row) => (
                                  <option key={a.id} value={a.id}>
                                    {a.fileName}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            {t("alt")}
                            <input
                              maxLength={200}
                              value={item.alt}
                              onChange={(e) => change({ alt: e.target.value })}
                            />
                          </label>
                          <RefPicker
                            refs={item.refs}
                            facts={sources.data?.facts ?? []}
                            t={t}
                            onChange={(refs) => change({ refs })}
                          />
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              blockUpdate(b.key, {
                                items: b.items.filter(
                                  (_: Row, j: number) => j !== i,
                                ),
                              })
                            }
                          >
                            {t("remove")}
                          </button>
                        </fieldset>
                      );
                    })}
                    <button
                      type="button"
                      className="secondary"
                      disabled={(b.items ?? []).length >= 12}
                      onClick={() =>
                        blockUpdate(b.key, {
                          items: [
                            ...(b.items ?? []),
                            {
                              title: "",
                              body: "",
                              assetId: null,
                              alt: "",
                              href: null,
                              refs: [],
                            },
                          ],
                        })
                      }
                    >
                      {t("addBlockItem")}
                    </button>
                  </>
                )}
                <RefPicker
                  refs={b.refs}
                  facts={sources.data?.facts ?? []}
                  t={t}
                  onChange={(refs) => blockUpdate(b.key, { refs })}
                  disabled={!canEdit || locked}
                />
              </fieldset>
              {canEdit && (
                <button
                  className="secondary"
                  disabled={locked || dirty || !consent}
                  onClick={() =>
                    void a.run(async () => {
                      const r = await api(
                        "/sites/" + page.siteId + "/agent-runs",
                        "POST",
                        {
                          step: "rewrite",
                          consent: true,
                          pageId: page.id,
                          blockKey: b.key,
                          instructions,
                        },
                        { "Idempotency-Key": crypto.randomUUID() },
                      );
                      setJob(r.id);
                    })
                  }
                >
                  {t("rewrite")}
                </button>
              )}
            </section>
          ),
      )}
      {canEdit && (
        <section className="catalog-panel">
          <div className="catalog-actions">
            <button
              className="secondary"
              disabled={data.blocks.length >= 20 || locked}
              onClick={() => {
                const key = "section-" + crypto.randomUUID().slice(0, 8);
                setEditingBlock(key);
                update({
                  blocks: [
                    ...data.blocks,
                    {
                      key,
                      type: "text",
                      heading: "",
                      body: "",
                      table: null,
                      faq: [],
                      assetId: null,
                      alt: "",
                      refs: [],
                    },
                  ],
                });
              }}
            >
              {t("addBlock")}
            </button>
            <button
              disabled={locked}
              onClick={() =>
                void a.run(async () => {
                  await api("/pages/" + page.id, "PATCH", {
                    revision: page.revision,
                    data,
                  });
                  reload();
                })
              }
            >
              {t("save")}
            </button>
          </div>
          <label className="catalog-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t("consent")}
          </label>
          <label>
            {t("rewriteInstructions")}
            <input
              maxLength={1000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
        </section>
      )}
      {job && (
        <section className="catalog-panel">
          <Badge status={run.data?.status ?? "queued"} t={t} />
          {run.data?.errorCode && (
            <p className="notice error">
              {t(
                run.data.errorCode in siteMessages
                  ? run.data.errorCode
                  : "AGENT_FAILED",
              )}
            </p>
          )}
          {run.data?.active && (
            <button
              disabled={a.busy}
              className="secondary"
              onClick={() =>
                void a.run(async () => {
                  await api("/agent-runs/" + job + "/cancel", "POST");
                  run.reload();
                })
              }
            >
              {t("cancel")}
            </button>
          )}
        </section>
      )}
      <section className="catalog-panel" id="editor-review">
        <h2>{t("pageReview")}</h2>
        <div className="catalog-actions">
          <button
            className="secondary"
            disabled={dirty || a.busy}
            onClick={() =>
              void a.run(async () =>
                setPreview((await api("/pages/" + page.id + "/preview")).html),
              )
            }
          >
            {t("preview")}
          </button>
          {preview && (
            <button className="secondary" onClick={() => setMobile(!mobile)}>
              {t(mobile ? "desktop" : "mobile")}
            </button>
          )}
        </div>
        {preview && (
          <iframe
            title={t("preview")}
            sandbox="allow-same-origin"
            srcDoc={preview}
            className={"sites-preview " + (mobile ? "mobile" : "")}
          />
        )}
        {role === "admin" && (
          <>
            <label>
              {t("reason")}
              <textarea
                aria-label={t("reason")}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="catalog-actions">
              <button
                disabled={dirty || locked || page.issues.length > 0}
                onClick={() =>
                  void a.run(async () => {
                    await api("/pages/" + page.id + "/approve", "POST", {
                      revision: page.revision,
                      reason,
                    });
                    reload();
                  })
                }
              >
                {t("approve")}
              </button>
              <button
                className="secondary"
                disabled={dirty || locked}
                onClick={() =>
                  void a.run(async () => {
                    await api("/pages/" + page.id + "/reject", "POST", {
                      revision: page.revision,
                      reason,
                    });
                    reload();
                  })
                }
              >
                {t("reject")}
              </button>
            </div>
          </>
        )}
      </section>
    </Frame>
  );
}
