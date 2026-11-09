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
    sub: "Agent 会结合业务目标、产品与已确认资料，生成两种首页方案。选择后再生成整站。",
    selected: "已选定设计方向",
    selectedSub: "后续页面会沿用这套视觉规则。首页已保存为待审核草稿。",
    edit: "想调整哪些地方？",
    hint: "例如图片更突出、布局更紧凑、偏工业风。这里描述设计偏好，企业数据请在事实库确认。",
    generate: "生成两种首页方案",
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
    confirm: "确认后会保存首页草稿，并撤回受影响内容的旧审核结果。",
    generateHint: "此操作使用 AI 额度，生成两种真实首页草稿。",
  },
  en: {
    title: "Choose your website's design direction",
    sub: "Your agent uses business goals, products and confirmed sources to propose two homepages. Choose a direction before generating the full site.",
    selected: "Design direction selected",
    selectedSub:
      "New pages will follow these visual rules. The homepage has been saved as a draft for review.",
    edit: "What would you like to change?",
    hint: "For example, larger imagery, a denser layout or an industrial feel. Confirm business claims in the fact library.",
    generate: "Generate two homepage proposals",
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
      "Selecting a direction saves a homepage draft and resets affected content approvals.",
    generateHint: "This uses AI credits to generate two homepage drafts.",
  },
};
function MiniPreview({ html, expanded }: { html: string; expanded: boolean }) {
  const ref = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={"proposal-canvas" + (expanded ? " expanded" : "")}
      style={expanded ? undefined : { height: (width * 900) / 1280 }}
    >
      <iframe
        title="Homepage proposal"
        sandbox="allow-same-origin"
        srcDoc={html}
        style={
          expanded
            ? undefined
            : {
                width: 1280,
                height: 900,
                transform: "scale(" + width / 1280 + ")",
                transformOrigin: "top left",
                pointerEvents: "none",
              }
        }
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
    [previewErrors, setPreviewErrors] = useState<Record<string, string>>({}),
    [expanded, setExpanded] = useState("");
  const posting = useRef(false);
  const previewEpoch = useRef(0);
  const designRuns = runs.filter((r) => r.step === "design"),
    run = designRuns[0],
    active = designRuns.find((r) => r.active),
    selected = run?.id === site.designDirection?.runId;
  const directions: Row[] =
    run?.status === "succeeded" && !selected
      ? (run.steps[0]?.output?.directions ?? [])
      : [];
  const base = "/sites/" + site.id;
  const failed = (e: unknown) =>
    e instanceof ApiError
      ? ["SOURCE_CHANGED", "REVISION_CONFLICT"].includes(e.code)
        ? c.stale
        : t(e.code)
      : c.error;
  async function loadPreview(key: string, runId: string) {
    const epoch = previewEpoch.current;
    setPreviewErrors((v) => ({ ...v, [key]: "" }));
    try {
      const d = await api<{ html: string }>(
        base + "/design-proposals/" + runId + "/" + key + "/preview",
      );
      if (epoch === previewEpoch.current)
        setHtml((v) => ({ ...v, [key]: d.html }));
    } catch (e) {
      if (epoch === previewEpoch.current)
        setPreviewErrors((v) => ({ ...v, [key]: failed(e) }));
    }
  }
  useEffect(() => {
    previewEpoch.current += 1;
    setHtml({});
    setPreviewErrors({});
    setExpanded("");
    let live = true;
    if (run?.status === "succeeded" && !selected)
      for (const d of run.steps[0]?.output?.directions ?? []) {
        void api<{ html: string }>(
          base + "/design-proposals/" + run.id + "/" + d.key + "/preview",
        )
          .then((p) => {
            if (live) setHtml((v) => ({ ...v, [d.key]: p.html }));
          })
          .catch((e) => {
            if (live) setPreviewErrors((v) => ({ ...v, [d.key]: failed(e) }));
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
    if (!window.confirm(c.confirm)) return;
    posting.current = true;
    setBusy(true);
    setError("");
    try {
      await api(base + "/design-direction", "POST", {
        revision: site.revision,
        runId: run.id,
        key,
      });
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
            {html[d.key] ? (
              <MiniPreview html={html[d.key]} expanded={expanded === d.key} />
            ) : previewErrors[d.key] ? (
              <p role="alert">
                {c.stale}{" "}
                <button onClick={() => void loadPreview(d.key, run.id)}>
                  {c.retry}
                </button>
              </p>
            ) : (
              <p role="status">{c.loading}</p>
            )}
            <footer>
              <button
                className="secondary"
                disabled={!html[d.key]}
                onClick={() => setExpanded(expanded === d.key ? "" : d.key)}
              >
                {expanded === d.key ? c.close : c.preview}
              </button>
              {canEdit && (
                <button
                  disabled={busy || !!active || !html[d.key]}
                  onClick={() => void choose(d.key)}
                >
                  {c.choose}
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
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
