import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Box,
  Check,
  Files,
  Globe2,
  Inbox,
  ListChecks,
  Plus,
  Rocket,
  Sparkles,
  UploadCloud,
  Workflow,
} from "lucide-react";
import { api, ApiError } from "./api";
import { messages, errors, type Locale } from "./i18n";
import { st } from "./sites-i18n";
import { Badge, KpiCard } from "./ui/primitives";

type Site = {
  id: string;
  name: string;
  language?: string;
  targetMarkets?: string[];
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
type InquirySummary = {
  nonDuplicate: number;
  responseRate: number;
  byStatus: { new: number; following: number; resolved: number; spam: number };
};

function useResource<T>(path: string, poll = false) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
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
    <div className="notice error" role="alert">
      <span>
        {error instanceof ApiError
          ? (errors[error.code]?.[locale === "zh" ? 0 : 1] ?? t.failed)
          : t.failed}
      </span>
      <button className="gs-btn gs-btn-sm" onClick={retry}>
        {t.retry}
      </button>
    </div>
  ) : (
    <p className="muted" role="status">
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
  const zh = locale === "zh";
  const sites = useResource<{ items: Site[]; hasMore: boolean }>(
    "/sites?limit=100",
  );
  const leads = useResource<InquirySummary>("/inquiries/summary");
  const [selected, setSelected] = useState("");
  const site =
    sites.data?.items.find((s) => s.id === selected) ?? sites.data?.items[0];

  return (
    <div className="gs-stack">
      {/* Executive Hero Banner */}
      <section className="gs-hub-hero">
        <div className="gs-hub-hero-copy">
          <span className="gs-hub-eyebrow">
            <Sparkles size={14} aria-hidden="true" />
            {zh ? "外贸独立站 AI 建站指挥台" : "B2B Export AI Site Command Hub"}
          </span>
          <h1>{organization ?? t.workspace}</h1>
          <p>
            {zh
              ? "从企业与产品资料出发，由 AI 规划、视觉设计与精修，一键发布并承接全球询盘。"
              : "Turn verified product & company knowledge into a flagship multilingual export website and capture leads."}
          </p>
        </div>
        <div className="gs-row">
          {sites.data && sites.data.items.length > 1 && site && (
            <select
              aria-label={t.activeSite}
              value={site.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {sites.data.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <Link className="gs-btn" to="/products">
            <BookOpenCheck size={15} aria-hidden="true" />
            {zh ? "外贸资料中心" : "Knowledge Hub"}
          </Link>
          {site ? (
            <Link
              className="gs-btn gs-btn-primary"
              to={"/sites/" + site.id}
            >
              <Sparkles size={15} aria-hidden="true" />
              {zh ? "进入建站 Studio" : "Open Site Studio"}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          ) : (
            role !== "viewer" && (
              <Link className="gs-btn gs-btn-primary" to="/sites/new">
                <Plus size={15} aria-hidden="true" />
                {zh ? "创建第一个外贸站" : "Create first site"}
              </Link>
            )
          )}
        </div>
      </section>

      {/* Main Command Stage */}
      {!sites.data ? (
        <Feedback locale={locale} {...sites} />
      ) : !site ? (
        <section className="gs-stack">
          <div className="gs-launch-grid">
            <Link className="gs-launch-card" to="/website-reads">
              <span className="gs-kpi-icon">
                <Globe2 size={18} aria-hidden="true" />
              </span>
              <h3>{zh ? "01 · 粘贴旧官网自动抓取" : "01 · Import existing website"}</h3>
              <p>
                {zh
                  ? "直接读取旧官网的公司介绍与产品卖点，自动提炼成待确认的企业事实卡片。"
                  : "Crawl your existing site safely to extract company highlights and product specs as verifiable facts."}
              </p>
              <span className="gs-launch-cta">
                {zh ? "去读取旧官网" : "Read website"} <ArrowRight size={14} />
              </span>
            </Link>
            <Link className="gs-launch-card" to="/products">
              <span className="gs-kpi-icon">
                <UploadCloud size={18} aria-hidden="true" />
              </span>
              <h3>{zh ? "02 · 投喂产品表与画册 PDF" : "02 · Upload catalog & PDFs"}</h3>
              <p>
                {zh
                  ? "支持 Excel 批量导入 SKU、拖拽上传产品实拍与认证证书，AI 自动解析关键参数。"
                  : "Bulk import SKUs via Excel, upload product photos and ISO/CE PDFs for AI extraction."}
              </p>
              <span className="gs-launch-cta">
                {zh ? "打开外贸资料中心" : "Open Knowledge Hub"} <ArrowRight size={14} />
              </span>
            </Link>
            <Link className="gs-launch-card" to="/sites/new">
              <span className="gs-kpi-icon">
                <Rocket size={18} aria-hidden="true" />
              </span>
              <h3>{zh ? "03 · 启动 AI 智能建站向导" : "03 · Launch AI Site Studio"}</h3>
              <p>
                {zh
                  ? "选定目标市场与 8 种建站语种，生成双套旗舰级首页方案并在画布中精修上线。"
                  : "Pick target markets and any of 8 languages, compare two flagship designs, and publish."}
              </p>
              <span className="gs-launch-cta">
                {zh ? "立即创建站点" : "Create website"} <ArrowRight size={14} />
              </span>
            </Link>
          </div>
        </section>
      ) : (
        <SiteCommandCockpit
          key={site.id}
          site={site}
          locale={locale}
          leads={leads.data}
          refreshSite={sites.retry}
        />
      )}
    </div>
  );
}

function SiteCommandCockpit({
  site,
  locale,
  leads,
  refreshSite,
}: {
  site: Site;
  locale: Locale;
  leads?: InquirySummary;
  refreshSite: () => void;
}) {
  const t = messages[locale];
  const zh = locale === "zh";
  const siteText = st(locale);
  const base = "/sites/" + site.id;

  const runs = useResource<{ items: Run[] }>(base + "/agent-runs?limit=5", true);
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
  const approved = rows?.filter((p) => p.status === "approved").length ?? 0;
  const review = rows?.filter((p) => p.status !== "approved") ?? [];

  const steps = [
    {
      num: 1,
      title: zh ? "投喂产品与企业事实" : "Products & verified facts",
      desc: zh
        ? `已关联 ${site.productIds.length} 款产品，可随时补充认证、MOQ 与交期`
        : `${site.productIds.length} products linked — add MOQ, lead time & certifications`,
      done: site.productIds.length > 0,
      to: base + "?tab=buyer",
      cta: zh ? "完善资料" : "Prepare",
    },
    {
      num: 2,
      title: zh ? "确认站点结构与双视觉方案" : "Site structure & visual direction",
      desc: site.planConfirmed
        ? zh
          ? `已确认 ${planCount} 个规划页面，可对比挑选首页设计方案`
          : `${planCount} planned pages confirmed — compare homepage proposals`
        : zh
          ? "让 AI 根据外贸买家决策自动规划栏目并生成两套设计方向"
          : "Let AI plan buyer-focused pages and craft two distinct visual concepts",
      done: site.planConfirmed,
      to: base + "?tab=" + (site.planConfirmed ? "design" : "planning"),
      cta: site.planConfirmed
        ? zh
          ? "看设计方案"
          : "Designs"
        : zh
          ? "去规划"
          : "Plan site",
    },
    {
      num: 3,
      title: zh ? "分屏精修页面与批量批准" : "Live-edit & approve pages",
      desc: zh
        ? `已批准 ${approved} / ${planCount} 页，支持右侧实时预览与 AI 局部改写`
        : `${approved} / ${planCount} pages approved — split-screen editor & inline AI rewrite`,
      done: planCount > 0 && approved === planCount,
      to: base + "?tab=pages",
      cta: zh ? "内容审核" : "Review",
    },
    {
      num: 4,
      title: zh ? "质检、SEO 配置与正式上线" : "QA, SEO & publish live",
      desc: readyVersion
        ? zh
          ? `已生成可预览版本 v${readyVersion.number}，可导出或配置域名/GA4 上线`
          : `Version v${readyVersion.number} ready — preview, configure SEO/domain, and publish`
        : zh
          ? "完成三端截图审查后，一键打包静态站、配置 301 与询盘表单上线"
          : "Inspect responsive captures, configure SEO/analytics, and ship your static site",
      done: Boolean(readyVersion),
      to: base + "/publishing",
      cta: zh ? "构建与发布" : "Publish",
    },
  ];

  const currentIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="gs-stack">
      {/* 4 Bento KPI Cards */}
      <section className="gs-grid-4" aria-label={t.siteOperations}>
        <KpiCard
          icon={Box}
          label={t.selectedProducts}
          value={site.productIds.length}
          sub={zh ? "关联建站产品" : "Products on site"}
          to={base + "?tab=settings"}
        />
        <KpiCard
          icon={ListChecks}
          label={t.reviewedPages}
          value={`${approved} / ${planCount}`}
          sub={
            review.length
              ? zh
                ? `${review.length} 页待审核`
                : `${review.length} pending review`
              : zh
                ? "全部就绪"
                : "All approved"
          }
          to={base + "?tab=pages"}
        />
        <KpiCard
          icon={Inbox}
          label={zh ? "有效询盘 / 跟进率" : "Leads & response"}
          value={leads ? leads.nonDuplicate : "—"}
          sub={
            leads
              ? zh
                ? `待跟进 ${leads.byStatus.new} · 处理率 ${leads.responseRate}%`
                : `${leads.byStatus.new} new · ${leads.responseRate}% handled`
              : t.loading
          }
          to="/inquiries"
        />
        <KpiCard
          icon={Rocket}
          label={t.previewVersion}
          value={
            readyVersion
              ? "v" + readyVersion.number
              : versions.data
                ? t.noneYet
                : "—"
          }
          sub={
            readyVersion
              ? zh
                ? "点击立即打开预览"
                : "Click to open preview"
              : zh
                ? "前往构建首个版本"
                : "Go build first release"
          }
          to={readyVersion ? base + "/preview" : base + "/publishing"}
        />
      </section>

      {/* Main 2-Column Executive Cockpit */}
      <div className="gs-hub-main">
        {/* Left: Guided 4-Step Launch Engine */}
        <section className="gs-card">
          <div className="gs-card-header">
            <h2 className="gs-card-title">
              <Workflow size={17} aria-hidden="true" />
              {site.name} · {zh ? "建站上线推进路线" : "Website Launch Pipeline"}
            </h2>
            <div className="gs-row">
              {site.language && (
                <Badge tone="accent">{site.language.toUpperCase()}</Badge>
              )}
              <Link className="gs-btn gs-btn-sm" to={base}>
                {zh ? "进入 Studio" : "Open Studio"}
                <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
          <ol className="gs-pipeline">
            {steps.map((s, idx) => {
              const isActive = idx === currentIdx;
              return (
                <li key={s.num}>
                  <Link
                    to={s.to}
                    className={
                      "gs-pipeline-step" +
                      (s.done ? " is-done" : isActive ? " is-active" : "")
                    }
                  >
                    <span className="gs-pipeline-num">
                      {s.done ? <Check size={14} /> : s.num}
                    </span>
                    <div className="gs-pipeline-copy">
                      <strong>{s.title}</strong>
                      <span>{s.desc}</span>
                    </div>
                    <Badge tone={s.done ? "ok" : isActive ? "accent" : "neutral"}>
                      {s.cta}
                    </Badge>
                    <ArrowRight size={14} />
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Right: Review Queue + Live Agent Feed */}
        <div className="gs-stack">
          <section className="gs-card">
            <div className="gs-card-header">
              <h2 className="gs-card-title">
                <Files size={17} aria-hidden="true" />
                {t.reviewQueue}
              </h2>
              <Link className="gs-btn gs-btn-sm gs-btn-ghost" to={base + "?tab=pages"}>
                {t.allPages}
                <ArrowUpRight size={13} />
              </Link>
            </div>
            {pages.error || !rows ? (
              <Feedback locale={locale} {...pages} />
            ) : review.length ? (
              <ul className="gs-list">
                {review.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <Link className="gs-list-row" to={"/pages/" + p.id}>
                      <div className="gs-list-row-copy">
                        <strong>{p.title}</strong>
                        <small>{p.path}</small>
                      </div>
                      <Badge tone="warn">{siteText(p.status)}</Badge>
                      <ArrowRight size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                {rows.length ? t.reviewClear : t.noPagesYet}
              </p>
            )}
          </section>

          <section className="gs-card">
            <div className="gs-card-header">
              <h2 className="gs-card-title">
                <Activity size={17} aria-hidden="true" />
                {t.agentActivity}
              </h2>
              <Link
                className="gs-btn gs-btn-sm gs-btn-ghost"
                to={"/agent?site=" + site.id}
              >
                {t.openTasks}
                <ArrowUpRight size={13} />
              </Link>
            </div>
            {runs.error || !runs.data ? (
              <Feedback locale={locale} {...runs} />
            ) : runs.data.items.length ? (
              <ul className="gs-list">
                {runs.data.items.slice(0, 4).map((run) => {
                  const tone =
                    run.status === "succeeded"
                      ? "ok"
                      : run.status === "failed"
                        ? "danger"
                        : run.status === "paused"
                          ? "warn"
                          : "info";
                  return (
                    <li key={run.id}>
                      <Link
                        className="gs-list-row"
                        to={"/agent?site=" + site.id}
                      >
                        <div className="gs-list-row-copy">
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
                        <Badge tone={tone}>{siteText(run.status)}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">{t.noTasks}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
