import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  Check,
  Sparkles,
} from "lucide-react";
import type { Locale } from "./i18n";
import { st } from "./sites-i18n";
import { Badge } from "./ui/primitives";

type Row = Record<string, any>;

const STEP_OPTIONS: Array<[string, [string, string]]> = [
  ["research", ["规划网站结构", "Plan site structure"]],
  ["design", ["生成双套首页方案", "Generate 2 homepage designs"]],
  ["content", ["生成全站页面内容", "Generate full-site content"]],
  ["review", ["多端截图与质量审查", "Run multi-viewport QA review"]],
  ["refine", ["按审查报告自动改进", "Refine pages from QA report"]],
  ["interview", ["AI 追问缺失外贸资料", "Ask for missing buyer facts"]],
];

export function SiteCopilot({
  site,
  pages,
  runs,
  locale,
  canEdit,
  busy,
  onQueue,
  onNavigateTab,
}: {
  site: Row;
  pages?: Row[];
  runs?: Row[];
  locale: Locale;
  canEdit: boolean;
  busy: boolean;
  onQueue: (step: string, instructions?: string) => Promise<void>;
  onNavigateTab: (tab: string) => void;
}) {
  const zh = locale === "zh";
  const t = st(locale);
  const activeRun = (runs ?? []).find((r) => r.active);
  const planCount = site.plan?.nodes?.length ?? 0;
  const pageList = pages ?? [];
  const approvedCount = pageList.filter((p) => p.status === "approved").length;

  // Smart recommendation based on real site progress.
  const recommended = !site.planConfirmed
    ? {
        step: "research",
        title: zh ? "下一步：确认外贸网站结构" : "Next: Plan & confirm site structure",
        body: zh
          ? "让 AI 结合你的产品与目标市场规划栏目、关键词与买家采购路径。"
          : "Let AI propose buyer-focused navigation, keywords, and page briefs.",
        tab: "planning",
        tabLabel: zh ? "查看规划" : "Open planner",
      }
    : site.templateId === "adaptive" && !site.designDirection
      ? {
          step: "design",
          title: zh ? "下一步：生成双套旗舰视觉方案" : "Next: Generate 2 visual concepts",
          body: zh
            ? "生成两套结构与风格截然不同的首页+代表详情提案，可视化对比后选定。"
            : "Compare two distinct homepage + product detail concepts side by side.",
          tab: "design",
          tabLabel: zh ? "看设计方案" : "Compare designs",
        }
      : !pageList.length
        ? {
            step: "content",
            title: zh ? "下一步：一键生成全站草稿" : "Next: Generate all site pages",
            body: zh
              ? "严格依据已确认的企业与产品事实生成多语种正文，拒绝虚假参数。"
              : "Draft all pages strictly from confirmed business & product facts.",
            tab: "pages",
            tabLabel: zh ? "查看页面" : "Open pages",
          }
        : approvedCount < planCount
          ? {
              step: "review",
              title: zh
                ? `还有 ${planCount - approvedCount} 页待审定`
                : `${planCount - approvedCount} pages need review`,
              body: zh
                ? "在右侧进入分屏编辑器微调文字或一键批量批准，通过后即可质检上线。"
                : "Edit in the split-screen studio or batch-approve passing pages.",
              tab: "pages",
              tabLabel: zh ? "去精修审核" : "Review pages",
            }
          : {
              step: "review",
              title: zh ? "页面已全部批准，准备上线" : "All pages approved — ready for QA",
              body: zh
                ? "运行 375/768/1440 三端截图审查，或直接前往「构建与发布」上线并配置 SEO。"
                : "Run responsive screenshot QA or head to Build & Publish to go live.",
              tab: "quality",
              tabLabel: zh ? "去质检上线" : "Open QA",
            };

  const [step, setStep] = useState(recommended.step);
  const [instructions, setInstructions] = useState("");
  const [consent, setConsent] = useState(false);

  const needsPlan = ["design", "content", "review", "refine"].includes(step);
  const blocked = needsPlan && !site.planConfirmed;

  return (
    <aside
      className="gs-copilot-rail"
      aria-label={zh ? "AI 建站副驾驶" : "AI Site Co-Pilot"}
    >
      <div className="gs-copilot-head">
        <h2>
          <Sparkles size={15} aria-hidden="true" />
          {zh ? "AI 建站副驾驶" : "AI Site Co-Pilot"}
        </h2>
        <Badge tone={activeRun ? "info" : "ok"}>
          <span className={"gs-dot " + (activeRun ? "gs-dot-info" : "gs-dot-ok")} />
          {activeRun ? (zh ? "执行中" : "Running") : zh ? "就绪" : "Ready"}
        </Badge>
      </div>

      {/* Contextual Next Best Action */}
      <div className="gs-copilot-next">
        <h3>{recommended.title}</h3>
        <p>{recommended.body}</p>
        <div className="gs-row">
          <button
            type="button"
            className="gs-btn gs-btn-sm"
            onClick={() => onNavigateTab(recommended.tab)}
          >
            {recommended.tabLabel}
            <ArrowRight size={13} />
          </button>
          <Link
            className="gs-btn gs-btn-sm gs-btn-ghost"
            to={"/sites/" + site.id + "/publishing"}
          >
            {zh ? "发布中心" : "Publish"}
          </Link>
        </div>
      </div>

      {/* Direct AI Mission Composer */}
      {canEdit && (
        <form
          className="gs-copilot-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !consent || blocked) return;
            void onQueue(step, instructions.trim() || undefined).then(() => {
              setInstructions("");
              setConsent(false);
            });
          }}
        >
          <label>
            {zh ? "下达 AI 建站指令" : "Run AI task"}
            <select
              value={step}
              onChange={(e) => setStep(e.target.value)}
              disabled={busy}
            >
              {STEP_OPTIONS.map(([k, labels]) => (
                <option key={k} value={k}>
                  {labels[zh ? 0 : 1]}
                </option>
              ))}
            </select>
          </label>
          <textarea
            rows={3}
            maxLength={1000}
            value={instructions}
            disabled={busy}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={
              zh
                ? "用大白话告诉 AI 你的偏好（如：面向欧美工程采购商、强调 OEM 定制与交期优势…）"
                : "Describe your goals in plain language (e.g. emphasize OEM capability and fast lead time)…"
            }
          />
          {blocked && (
            <p className="muted">
              {zh
                ? "请先在「结构与视觉」确认网站地图后再执行此步骤。"
                : "Confirm the site structure first before running this step."}
            </p>
          )}
          <label className="gs-copilot-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={busy}
            />
            <span>
              {zh
                ? "同意本次使用组织 AI 服务并计入用量"
                : "Use organization AI provider and count toward usage"}
            </span>
          </label>
          <button
            type="submit"
            className="gs-btn gs-btn-primary"
            disabled={busy || !consent || blocked}
          >
            <span>{busy ? (zh ? "正在提交…" : "Submitting…") : zh ? "让 AI 开始执行" : "Run with AI"}</span>
            <ArrowUp size={15} />
          </button>
        </form>
      )}

      {/* Live Recent Runs Stream */}
      <div className="gs-stack-sm">
        <div className="gs-row-between">
          <small className="muted">
            <Activity size={12} aria-hidden="true" />{" "}
            {zh ? "实时任务动态" : "Live activity"}
          </small>
          <button
            type="button"
            className="gs-btn gs-btn-sm gs-btn-ghost"
            onClick={() => onNavigateTab("runs")}
          >
            {zh ? "全部记录" : "All runs"}
          </button>
        </div>
        {(runs ?? []).length ? (
          <div className="gs-copilot-runs">
            {(runs ?? []).slice(0, 4).map((r) => {
              const done = (r.steps ?? []).filter(
                (s: Row) => s.status === "succeeded",
              ).length;
              const total = (r.steps ?? []).length;
              const tone =
                r.status === "succeeded"
                  ? "ok"
                  : r.status === "failed"
                    ? "danger"
                    : r.status === "paused"
                      ? "warn"
                      : "info";
              return (
                <div key={r.id} className="gs-copilot-run-item">
                  <span>
                    {r.status === "succeeded" && (
                      <Check size={12} aria-hidden="true" />
                    )}{" "}
                    {t(r.step === "rewrite" ? "rewriteStep" : r.step)}
                    {total > 0 ? ` (${done}/${total})` : ""}
                  </span>
                  <Badge tone={tone}>{t(r.status)}</Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">
            {zh ? "还没有运行记录，从上方发起第一个 AI 任务。" : "No runs yet. Launch your first AI task above."}
          </p>
        )}
      </div>
    </aside>
  );
}
