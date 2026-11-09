import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  Circle,
  Files,
  Globe2,
  Layers3,
  ListChecks,
  Radio,
  Workflow,
} from "lucide-react";
import { api, ApiError } from "./api";
import { messages, errors, type Key, type Locale } from "./i18n";
import { st } from "./sites-i18n";

type Site = {
  id: string;
  name: string;
  planConfirmed: boolean;
  productIds: string[];
  plan: { nodes: { key: string }[] } | null;
};
type Run = {
  id: string;
  step: string;
  status: string;
  active: boolean;
  updatedAt: string;
  steps: { status: string }[];
};
type Page = { id: string; title: string; path: string; status: string };
type Version = { number: number; status: string };

function useResource<T>(path: string, poll = false) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let current = true,
      timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await api<T>(path);
        if (current) {
          setData(value);
          setError(undefined);
        }
      } catch (e) {
        if (current) setError(e);
      } finally {
        if (current && poll) schedule();
      }
    }
    function schedule() {
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") void load();
        else schedule();
      }, 10000);
    }
    void load();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [path, poll, revision]);
  const retry = useCallback(() => refresh((n) => n + 1), []);
  return { data, error, retry };
}
function Feedback({
  locale,
  error,
  retry,
}: {
  locale: Locale;
  error?: unknown;
  retry: () => void;
}) {
  const t = messages[locale];
  return error ? (
    <div className="mission-feedback" role="alert">
      <span>
        {error instanceof ApiError
          ? (errors[error.code]?.[locale === "zh" ? 0 : 1] ?? t.failed)
          : t.failed}
      </span>
      <button className="button secondary" onClick={retry}>
        {t.retry}
      </button>
    </div>
  ) : (
    <p className="mission-feedback" role="status">
      {t.loading}
    </p>
  );
}
export function MissionOverview({
  locale,
  organization,
  role,
}: {
  locale: Locale;
  organization?: string;
  role: "admin" | "editor" | "viewer";
}) {
  const t = messages[locale];
  const sites = useResource<{ items: Site[]; hasMore: boolean }>(
    "/sites?limit=100",
  );
  const [selected, setSelected] = useState("");
  const site =
    sites.data?.items.find((s) => s.id === selected) ?? sites.data?.items[0];
  return (
    <div className="mission">
      <header className="mission-hero">
        <div>
          <h1>{organization ?? t.workspace}</h1>
          <p>{t.agentWorkspaceSub}</p>
        </div>
        <Link
          className="mission-hero-action"
          to={site ? "/sites/" + site.id : "/sites"}
        >
          {site ? t.openSite : t.sites}
          <ArrowRight size={16} />
        </Link>
      </header>
      {!sites.data ? (
        <Feedback locale={locale} {...sites} />
      ) : !site ? (
        <section className="mission-empty">
          <Globe2 size={28} />
          <h2>{t.firstSite}</h2>
          <p>{role === "viewer" ? t.waitForSite : t.firstSiteSub}</p>
          <Link className="button primary" to="/sites">
            {t.sites}
            <ArrowRight size={15} />
          </Link>
        </section>
      ) : (
        <>
          <div className="mission-context">
            <h2>{t.siteOperations}</h2>
            <label>
              {t.activeSite}
              <select
                value={site.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {sites.data.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <SiteActivity
            key={site.id}
            site={site}
            locale={locale}
            refreshSite={sites.retry}
          />
        </>
      )}
      <section className="mission-shortcuts" aria-label={t.teamResources}>
        {(
          [
            ["products", "/products", Box],
            ["facts", "/facts", Layers3],
            ["inquiries", "/inquiries", Radio],
            ["usage", "/usage", Activity],
          ] as const
        ).map(([label, to, Icon]) => (
          <Link to={to} key={to}>
            <Icon size={18} />
            {t[label]}
            <ArrowUpRight size={14} />
          </Link>
        ))}
      </section>
    </div>
  );
}
function SiteActivity({
  site,
  locale,
  refreshSite,
}: {
  site: Site;
  locale: Locale;
  refreshSite: () => void;
}) {
  const t = messages[locale],
    siteText = st(locale),
    base = "/sites/" + site.id;
  const runs = useResource<{ items: Run[] }>(
    base + "/agent-runs?limit=5",
    true,
  );
  const pages = useResource<{ items: Page[] }>(base + "/pages");
  const versions = useResource<Version[]>(base + "/versions");
  const settledRun = runs.data?.items.find(
    (r) => !r.active && r.status === "succeeded",
  );
  const completion = settledRun
    ? settledRun.id + ":" + settledRun.updatedAt
    : "";
  const lastCompletion = useRef<string>();
  const refreshPages = pages.retry;
  useEffect(() => {
    if (!runs.data) return;
    if (
      completion &&
      lastCompletion.current !== undefined &&
      lastCompletion.current !== completion
    ) {
      refreshSite();
      refreshPages();
    }
    lastCompletion.current = completion;
  }, [completion, runs.data, refreshSite, refreshPages]);
  const rows = pages.data?.items;
  const readyVersion = versions.data?.find((v) => v.status === "ready");
  const planCount = site.plan?.nodes.length ?? 0;
  const approved = rows?.filter((p) => p.status === "approved").length;
  const review = rows?.filter((p) => p.status !== "approved");
  const metrics = [
    {
      icon: Box,
      label: "selectedProducts",
      value: site.productIds.length,
      to: base + "?tab=settings",
    },
    {
      icon: Workflow,
      label: "plannedPages",
      value: planCount,
      to: base + "?tab=planning",
    },
    {
      icon: ListChecks,
      label: "reviewedPages",
      value: approved,
      to: base + "?tab=pages",
    },
    {
      icon: Globe2,
      label: "previewVersion",
      value: readyVersion
        ? "v" + readyVersion.number
        : versions.data
          ? t.noneYet
          : undefined,
      to: readyVersion ? base + "/preview" : base + "/publishing",
    },
  ] as const;
  const stages: { label: Key; done: boolean; to: string; detail: string }[] = [
    {
      label: "siteProducts",
      done: !!site.productIds.length,
      to: base + "?tab=settings",
      detail: String(site.productIds.length),
    },
    {
      label: "sitePlan",
      done: site.planConfirmed,
      to: base + "?tab=planning",
      detail: siteText(
        site.planConfirmed ? "confirmedPlan" : "unconfirmedPlan",
      ),
    },
    {
      label: "pageApproval",
      done: !!planCount && approved === planCount,
      to: base + "?tab=pages",
      detail: (approved ?? "—") + " / " + planCount,
    },
    {
      label: "sitePreview",
      done: !!readyVersion,
      to: readyVersion ? base + "/preview" : base + "/publishing",
      detail: readyVersion
        ? "v" + readyVersion.number
        : versions.data
          ? t.noneYet
          : "—",
    },
  ];
  return (
    <>
      <div className="mission-metrics">
        {metrics.map(({ icon: Icon, label, value, to }) => (
          <Link key={label} to={to}>
            <div>
              <Icon size={16} />
              <span>{t[label]}</span>
            </div>
            <strong>{value ?? "—"}</strong>
          </Link>
        ))}
      </div>
      <div className="mission-body">
        <section className="mission-panel">
          <header>
            <h3>
              <Workflow size={17} />
              {t.productionFlow}
            </h3>
            <Link to={base}>
              {t.openSite}
              <ArrowUpRight size={14} />
            </Link>
          </header>
          <ol className="mission-stages">
            {stages.map((s) => (
              <li key={s.label}>
                <Link to={s.to}>
                  <span className={"stage-symbol " + (s.done ? "done" : "")}>
                    {s.done ? <Check size={13} /> : <Circle size={8} />}
                  </span>
                  <strong>{t[s.label]}</strong>
                  <small>{s.detail}</small>
                  <ArrowRight size={14} />
                </Link>
              </li>
            ))}
          </ol>
          {!!versions.error && (
            <Feedback
              locale={locale}
              error={versions.error}
              retry={versions.retry}
            />
          )}
        </section>
        <section className="mission-panel">
          <header>
            <h3>
              <Activity size={17} />
              {t.agentActivity}
            </h3>
            <Link to={"/agent?site=" + site.id}>
              {t.openTasks}
              <ArrowUpRight size={14} />
            </Link>
          </header>
          {runs.error || !runs.data ? (
            <Feedback locale={locale} {...runs} />
          ) : runs.data.items.length ? (
            <ul className="mission-jobs">
              {runs.data.items.map((run) => (
                <li key={run.id}>
                  <Link to={"/agent?site=" + site.id}>
                    <div>
                      <strong>
                        {siteText(
                          run.step === "rewrite" ? "rewriteStep" : run.step,
                        )}
                      </strong>
                      <small>
                        {new Date(run.updatedAt).toLocaleString(locale, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </div>
                    {run.active && run.steps.length > 0 && (
                      <span
                        className="mission-run-progress"
                        title={t.doneSteps}
                      >
                        <progress
                          aria-label={t.doneSteps}
                          max={run.steps.length}
                          value={
                            run.steps.filter(
                              (step) => step.status === "succeeded",
                            ).length
                          }
                        />
                        <small>
                          {
                            run.steps.filter(
                              (step) => step.status === "succeeded",
                            ).length
                          }{" "}
                          / {run.steps.length}
                        </small>
                      </span>
                    )}
                    <span className={"mission-state state-" + run.status}>
                      {siteText(run.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mission-placeholder">{t.noTasks}</p>
          )}
        </section>
        <section className="mission-panel mission-review">
          <header>
            <h3>
              <Files size={17} />
              {t.reviewQueue}
            </h3>
            <Link to={base + "?tab=pages"}>
              {t.allPages}
              <ArrowUpRight size={14} />
            </Link>
          </header>
          {pages.error || !rows ? (
            <Feedback locale={locale} {...pages} />
          ) : review?.length ? (
            <ul className="mission-jobs">
              {review.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <Link to={"/pages/" + p.id}>
                    <div>
                      <strong>{p.title}</strong>
                      <small>{p.path}</small>
                    </div>
                    <span className={"mission-state state-" + p.status}>
                      {siteText(p.status)}
                    </span>
                    <ArrowRight size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mission-placeholder">
              {rows.length ? t.reviewClear : t.noPagesYet}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
