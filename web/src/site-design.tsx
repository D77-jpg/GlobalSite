import { trustedPreview } from "./trusted-preview";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Sparkles, ArrowUpRight } from "lucide-react";
import { api, ApiError } from "./api";
import { st } from "./sites-i18n";
import type { Locale } from "./i18n";
import "./site-design.css";
type Row = Record<string, any>;
const text = {
  zh: {
    title: "先选定网站的设计方向",
    sub: "Agent 会结合业务目标、产品与已确认资料，生成两种首页与代表性详情页提案。先审查试点，再扩展整站。",
    selected: "已选定设计方向",
    selectedSub: "后续页面会沿用这套视觉规则。试点页面已保存为待审核草稿。",
    edit: "想调整哪些地方？",
    hint: "例如图片更突出、布局更紧凑、偏工业风。这里描述设计偏好，企业数据请在事实库确认。",
    generate: "生成两套设计提案",
    regenerate: "按意见重新生成",
    consent: "同意将本站选用资料发送给组织配置的 AI 服务商，并计入 AI 额度。",
    choose: "采用这个方向",
    chosen: "已采用",
    preview: "放大预览",
    close: "收起预览",
    loading: "正在准备预览…",
    retry: "重试预览",
    busy: "正在生成设计提案，你可以离开后回来继续。",
    tasks: "查看任务与处理问题",
    review: "查看首页草稿",
    error: "操作失败，请重试。",
    stale: "资料或站点已更新，请重新生成设计提案。",
    saved: "设计方向已保存。",
    disabled: "先确认网站结构，再生成设计提案。",
    plan: "查看网站结构",
    confirm: "确认后会保存提案草稿，并撤回受影响内容的旧审核结果。",
    generateHint:
      "包含首页与代表性详情页；完成的页面会保存，任务使用组织 AI 额度。",
    issues: "项内容检查待处理，采用后仍需审核。",
  },
  en: {
    title: "Choose your website's design direction",
    sub: "Your agent uses business goals, products and confirmed sources to propose two homepage and representative detail proposals. Review the pilot before expanding the site.",
    selected: "Design direction selected",
    selectedSub:
      "New pages will follow these visual rules. The pilot pages have been saved as drafts for review.",
    edit: "What would you like to change?",
    hint: "For example, larger imagery, a denser layout or an industrial feel. Confirm business claims in the fact library.",
    generate: "Generate two design proposals",
    regenerate: "Generate revised proposals",
    consent:
      "I agree to send selected site sources to the organization's AI provider and use AI credits.",
    choose: "Use this direction",
    chosen: "Selected",
    preview: "Expand preview",
    close: "Collapse preview",
    loading: "Preparing preview…",
    retry: "Retry preview",
    busy: "Design proposals are being generated. You can leave and return later.",
    tasks: "View tasks & resolve issues",
    review: "Review homepage draft",
    error: "Could not complete the action. Please retry.",
    stale: "Site or source data has changed. Generate new proposals.",
    saved: "Design direction saved.",
    disabled: "Confirm the sitemap before generating design proposals.",
    plan: "Review sitemap",
    confirm:
      "Selecting a direction saves proposal drafts and resets affected content approvals.",
    generateHint:
      "Includes homepage and representative detail drafts. Completed pages are saved; the task uses organization AI credits.",
    issues:
      "content checks need attention. Review them after selecting this draft.",
  },
};
function MiniPreview({
  html,
  expanded,
  title,
  device,
}: {
  html: string;
  expanded: boolean;
  title: string;
  device: "desktop" | "mobile";
}) {
  return (
    <div
      className={
        "proposal-canvas" +
        (expanded ? " expanded" : "") +
        (device === "mobile" ? " mobile" : "")
      }
    >
      <iframe
        title={title}
        sandbox="allow-same-origin"
        srcDoc={trustedPreview(html)}
      />
    </div>
  );
}
export function SiteDesign({
  site,
  runs,
  locale,
  canEdit,
  onSave,
}: {
  site: Row;
  runs: Row[];
  locale: Locale;
  canEdit: boolean;
  onSave: () => void;
}) {
  const c = text[locale],
    t = st(locale),
    [instructions, setInstructions] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [html, setHtml] = useState<Record<string, string>>({}),
    [issues, setIssues] = useState<Record<string, number>>({}),
    [previewErrors, setPreviewErrors] = useState<Record<string, string>>({}),
    [expanded, setExpanded] = useState(""),
    [previewPage, setPreviewPage] = useState<"home" | "detail">("home"),
    [confirmChoice, setConfirmChoice] = useState(""),
    [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const posting = useRef(false);
  const previewEpoch = useRef(0);
  const designRuns = runs.filter((r) => r.step === "design"),
    run = designRuns[0],
    active = designRuns.find((r) => r.active),
    selected = run?.id === site.designDirection?.runId;
  const directions: Row[] =
    run?.status === "succeeded" ? (run.steps[0]?.output?.directions ?? []) : [];
  const base = "/sites/" + site.id;
  const failed = (e: unknown) =>
    e instanceof ApiError
      ? ["SOURCE_CHANGED", "REVISION_CONFLICT"].includes(e.code)
        ? c.stale
        : t(e.code)
      : c.error;
  async function loadPreview(
    key: string,
    runId: string,
    pageKind = previewPage,
  ) {
    const cacheKey = key + ":" + pageKind;
    const epoch = previewEpoch.current;
    setPreviewErrors((v) => ({ ...v, [cacheKey]: "" }));
    try {
      const d = await api<{ html: string; issues: unknown[] }>(
        base +
          "/design-proposals/" +
          runId +
          "/" +
          key +
          "/preview?page=" +
          pageKind,
      );
      if (epoch === previewEpoch.current) {
        setHtml((v) => ({ ...v, [cacheKey]: d.html }));
        setIssues((v) => ({ ...v, [cacheKey]: d.issues.length }));
      }
    } catch (e) {
      if (epoch === previewEpoch.current)
        setPreviewErrors((v) => ({ ...v, [cacheKey]: failed(e) }));
    }
  }
  useEffect(() => {
    previewEpoch.current += 1;
    setHtml({});
    setIssues({});
    setPreviewErrors({});
    setExpanded("");
    setPreviewPage("home");
    let live = true;
    if (run?.status === "succeeded")
      for (const d of (run.steps[0]?.output?.directions ?? []).flatMap(
        (d: Row) =>
          ["home", ...(d.detail ? ["detail"] : [])].map((pageKind) => ({
            ...d,
            pageKind,
          })),
      )) {
        const cacheKey = d.key + ":" + d.pageKind;
        void api<{ html: string; issues: unknown[] }>(
          base +
            "/design-proposals/" +
            run.id +
            "/" +
            d.key +
            "/preview?page=" +
            d.pageKind,
        )
          .then((p) => {
            if (live) {
              setHtml((v) => ({ ...v, [cacheKey]: p.html }));
              setIssues((v) => ({ ...v, [cacheKey]: p.issues.length }));
            }
          })
          .catch((e) => {
            if (live)
              setPreviewErrors((v) => ({ ...v, [cacheKey]: failed(e) }));
          });
      }
    return () => {
      live = false;
      previewEpoch.current += 1;
    };
  }, [run?.id, run?.status, selected, site.revision, base]);
  async function generate() {
    if (posting.current) return;
    posting.current = true;
    setBusy(true);
    setError("");
    try {
      await api(
        base + "/agent-runs",
        "POST",
        { step: "design", consent: true, instructions },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      onSave();
    } catch (e) {
      setError(failed(e));
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }
  async function choose(key: string) {
    if (posting.current) return;

    posting.current = true;
    setBusy(true);
    setError("");
    try {
      await api(base + "/design-direction", "POST", {
        revision: site.revision,
        runId: run.id,
        key,
      });
      setConfirmChoice("");
      onSave();
    } catch (e) {
      setError(failed(e));
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="design-workspace">
      <header>
        <span className="journey-eyebrow">
          <Sparkles size={15} />
          GlobalSite Agent
        </span>
        <h2>{c.title}</h2>
        <p>{c.sub}</p>
      </header>
      {site.designDirection && (
        <div className="design-selected">
          <Check size={20} />
          <div>
            <strong>{c.selected}</strong>
            <p>{site.designDirection.rationale}</p>
            <small>{c.selectedSub}</small>
          </div>
          <Link to="?tab=pages">
            {c.review}
            <ArrowUpRight size={14} />
          </Link>
        </div>
      )}
      {site.designDirection?.detailNodeKey && (
        <section className="pilot-review">
          <h3>
            {locale === "zh"
              ? "先审查首页与详情页"
              : "Review the pilot pages first"}
          </h3>
          <p>
            {locale === "zh"
              ? "打开截图检查排版、图片与询价路径，确认审查并批准这两页后，再生成其余页面。"
              : "Inspect layout, imagery and inquiry flow in the screenshots. Accept the reviews and approve both pages before expanding."}
          </p>
          <div className="catalog-actions">
            {[
              site.plan.nodes.find((n: Row) => n.type === "home")?.key,
              site.designDirection.detailNodeKey,
            ]
              .filter(Boolean)
              .map((key) => (
                <button
                  key={key}
                  disabled={
                    !canEdit || busy || !consent || runs.some((r) => r.active)
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api(
                        base + "/agent-runs",
                        "POST",
                        { step: "review", pageKey: key, consent: true },
                        { "Idempotency-Key": crypto.randomUUID() },
                      );
                      onSave();
                    } catch (e) {
                      setError(failed(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {locale === "zh" ? "审查" : "Review"}{" "}
                  {site.plan.nodes.find((n: Row) => n.key === key)?.title}
                </button>
              ))}
            <Link to="?tab=runs">{c.tasks}</Link>
          </div>
        </section>
      )}
      {!site.planConfirmed && (
        <p className="notice">
          {c.disabled} <Link to="?tab=planning">{c.plan}</Link>
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {active && (
        <p role="status">
          {["paused", "failed"].includes(active.status)
            ? t(active.status)
            : c.busy}{" "}
          <Link to="?tab=runs">{c.tasks}</Link>
        </p>
      )}
      {directions.some((d) => d.detail) && (
        <div
          className="proposal-view-tabs"
          role="group"
          aria-label={locale === "zh" ? "提案页面" : "Proposal page"}
        >
          {(["home", "detail"] as const).map((kind) => (
            <button
              key={kind}
              className="secondary"
              aria-pressed={previewPage === kind}
              onClick={() => setPreviewPage(kind)}
            >
              {kind === "home"
                ? locale === "zh"
                  ? "首页"
                  : "Homepage"
                : locale === "zh"
                  ? "代表性详情页"
                  : "Representative detail"}
            </button>
          ))}
        </div>
      )}
      {directions.length > 0 && (
        <div
          className="proposal-view-tabs"
          role="group"
          aria-label={locale === "zh" ? "预览设备" : "Preview device"}
        >
          {(["desktop", "mobile"] as const).map((kind) => (
            <button
              key={kind}
              className="secondary"
              aria-pressed={device === kind}
              onClick={() => setDevice(kind)}
            >
              {kind === "desktop"
                ? locale === "zh"
                  ? "桌面预览"
                  : "Desktop preview"
                : locale === "zh"
                  ? "手机预览"
                  : "Phone preview"}
            </button>
          ))}
        </div>
      )}
      {confirmChoice && (
        <div
          role="alertdialog"
          aria-label={c.choose}
          className="proposal-confirm"
        >
          <p>{c.confirm}</p>
          <div className="catalog-actions">
            <button disabled={busy} onClick={() => void choose(confirmChoice)}>
              {c.choose}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setConfirmChoice("")}
            >
              {locale === "zh" ? "取消" : "Cancel"}
            </button>
          </div>
        </div>
      )}
      <div className="design-proposals">
        {directions.map((d) => (
          <article
            key={d.key}
            className={expanded === d.key ? "proposal expanded" : "proposal"}
          >
            <header>
              <h3>{d.label}</h3>
              <p>{d.rationale}</p>
            </header>
            {html[d.key + ":" + previewPage] ? (
              <MiniPreview
                device={device}
                html={html[d.key + ":" + previewPage]}
                title={
                  d.label +
                  (previewPage === "detail"
                    ? locale === "zh"
                      ? " · 详情页"
                      : " · Detail"
                    : "")
                }
                expanded={expanded === d.key}
              />
            ) : previewErrors[d.key + ":" + previewPage] ? (
              <p role="alert">
                {c.stale}{" "}
                <button onClick={() => void loadPreview(d.key, run.id)}>
                  {c.retry}
                </button>
              </p>
            ) : (
              <p role="status">{c.loading}</p>
            )}
            {issues[d.key + ":" + previewPage] > 0 && (
              <p className="proposal-issues" role="status">
                {issues[d.key + ":" + previewPage]} {c.issues}
              </p>
            )}
            <footer>
              <button
                className="secondary"
                disabled={!html[d.key + ":" + previewPage]}
                onClick={() => setExpanded(expanded === d.key ? "" : d.key)}
              >
                {expanded === d.key ? c.close : c.preview}
              </button>
              {canEdit && (
                <button
                  disabled={
                    busy ||
                    !!active ||
                    !html[d.key + ":" + previewPage] ||
                    (selected && site.designDirection?.key === d.key)
                  }
                  onClick={() => setConfirmChoice(d.key)}
                >
                  {selected && site.designDirection?.key === d.key
                    ? c.chosen
                    : c.choose}
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
      {canEdit &&
        run?.status === "failed" &&
        run.steps.some(
          (u: Row) =>
            u.status === "succeeded" && (u.output?.proposal || u.output?.page),
        ) && (
          <div className="pilot-review">
            <p>
              {locale === "zh"
                ? "已完成的方向会保留，只为未完成的方向生成新提案。"
                : "Keep the completed direction and generate only the unfinished direction."}
            </p>
            <button
              disabled={busy || !!active || !consent}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api(
                    base + "/agent-runs",
                    "POST",
                    {
                      step: "design",
                      reuseRunId: run.id,
                      consent: true,
                      instructions,
                    },
                    { "Idempotency-Key": crypto.randomUUID() },
                  );
                  onSave();
                } catch (e) {
                  setError(failed(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {locale === "zh"
                ? "保留成果，生成剩余方向"
                : "Keep results and generate remaining direction"}
            </button>
          </div>
        )}
      {canEdit && (
        <div className="design-composer">
          <label>
            {c.edit}
            <textarea
              rows={3}
              maxLength={1000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={c.hint}
            />
          </label>
          <div>
            <label className="design-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {c.consent}
            </label>
            <button
              disabled={busy || !!active || !consent || !site.planConfirmed}
              onClick={() => void generate()}
            >
              {designRuns.length ? c.regenerate : c.generate}
            </button>
            <small>{c.generateHint}</small>
          </div>
        </div>
      )}
    </section>
  );
}
