import { useState } from "react";
import {
  Activity,
  ArrowUp,
  Award,
  Check,
  LayoutGrid,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { Locale } from "./i18n";
import { st } from "./sites-i18n";
import { Badge } from "./ui/primitives";

type Row = Record<string, any>;

const STEP_OPTIONS: Array<[string, [string, string]]> = [
  ["research", ["规划网站结构与策略", "Plan site structure"]],
  ["design", ["生成双套视觉提案", "Generate 2 homepage designs"]],
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

  const recommendedStep = !site.planConfirmed
    ? "research"
    : site.templateId === "adaptive" && !site.designDirection
      ? "design"
      : !pageList.length
        ? "content"
        : approvedCount < planCount
          ? "review"
          : "review";

  const [step, setStep] = useState(recommendedStep);
  const [goal, setGoal] = useState<"inquiries" | "brand" | "showcase">("inquiries");
  const [instructions, setInstructions] = useState("");
  const [consent, setConsent] = useState(false);

  const goals = [
    {
      id: "inquiries" as const,
      icon: TrendingUp,
      zh: "获取海外询盘",
      en: "Generate Inquiries",
      prompt: zh
        ? "聚焦海外 B2B 工程与批发买家，在首屏、产品页与解决方案页强化询盘转化入口与交期/OEM 优势。"
        : "Focus on B2B overseas buyers with prominent RFQ conversion flows and OEM/lead-time clarity.",
    },
    {
      id: "brand" as const,
      icon: Award,
      zh: "提升品牌形象",
      en: "Brand Positioning",
      prompt: zh
        ? "采用博物馆级旗舰品牌叙事与留白节奏，突出工艺材质、国际认证与项目案例信任背书。"
        : "Craft a flagship editorial brand narrative emphasizing craftsmanship, certifications, and project trust.",
    },
    {
      id: "showcase" as const,
      icon: LayoutGrid,
      zh: "展示产品与应用",
      en: "Product Showcase",
      prompt: zh
        ? "以产品系列、规格参数表与真实空间应用场景为核心，方便采购商快速选型并提交询价清单。"
        : "Highlight product families, structured spec sheets, and real application scenes for fast buyer selection.",
    },
  ];

  const needsPlan = ["design", "content", "review", "refine"].includes(step);
  const blocked = needsPlan && !site.planConfirmed;

  return (
    <aside
      className="gs-copilot-rail"
      aria-label={zh ? "AI 策略顾问" : "AI Strategy Advisor"}
    >
      {/* Luminous AI Agent Header */}
      <div className="gs-copilot-agent-head">
        <span className="gs-ai-orb" aria-hidden="true" />
        <div className="gs-copilot-agent-meta">
          <h2>{zh ? "AI 策略顾问" : "AI Strategy Advisor"}</h2>
          <small>{site.name} Agent</small>
        </div>
        <Badge tone={activeRun ? "info" : "ok"}>
          <span className={"gs-dot " + (activeRun ? "gs-dot-info" : "gs-dot-ok")} />
          {activeRun ? (zh ? "执行中" : "Running") : zh ? "在线" : "Online"}
        </Badge>
      </div>

      <p className="gs-copilot-intro">
        {zh
          ? "基于你的产品、企业资料与目标市场，提供网站策略、结构与内容创意，并可一键生成方案。"
          : "Craft buyer-focused site strategy, structure, and verified copy from your products and facts."}
      </p>

      {/* Conversational Prompt Bubble + 3 Goal Tiles (Screen 1) */}
      <div className="gs-copilot-bubble">
        {zh ? "我们这次的网站主要目标是什么？" : "What is the primary goal for this site?"}
      </div>
      <div className="gs-goal-grid" role="group" aria-label={zh ? "建站目标" : "Site goal"}>
        {goals.map(({ id, icon: Icon, zh: zLabel, en: eLabel, prompt }) => (
          <button
            key={id}
            type="button"
            className="gs-goal-tile"
            aria-pressed={goal === id}
            onClick={() => {
              setGoal(id);
              setInstructions(prompt);
            }}
          >
            <Icon size={15} aria-hidden="true" />
            <strong>{zh ? zLabel : eLabel}</strong>
            <span>{zh ? eLabel : zLabel}</span>
          </button>
        ))}
      </div>

      {/* Brand Positioning Snapshot */}
      <div className="gs-positioning-box">
        <div className="gs-positioning-head">
          <Sparkles size={13} aria-hidden="true" />
          <span>{zh ? "品牌定位与核心信息" : "Brand positioning"}</span>
        </div>
        <div className="gs-positioning-tags">
          {(site.targetMarkets ?? []).slice(0, 3).map((m: string) => (
            <span key={m} className="gs-chip">
              {m}
            </span>
          ))}
          <span className="gs-chip">
            {(site.productIds?.length ?? 0)} {zh ? "款产品" : "products"}
          </span>
          {site.language && (
            <span className="gs-chip">{site.language.toUpperCase()}</span>
          )}
        </div>
        {site.businessBrief && (
          <p className="gs-positioning-brief">{site.businessBrief}</p>
        )}
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
            {zh ? "执行任务" : "AI mission"}
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
                ? "补充你的业务卖点、目标买家或视觉偏好…"
                : "Add buyer priorities, certifications, or visual direction…"
            }
          />
          {blocked && (
            <p className="gs-copilot-warn">
              {zh
                ? "请先在「结构与蓝图」确认网站结构后再执行此步骤。"
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
            className="gs-btn gs-btn-primary gs-btn-lg"
            disabled={busy || !consent || blocked}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>
              {busy
                ? zh
                  ? "正在提交…"
                  : "Submitting…"
                : zh
                  ? "让 AI 生成方案"
                  : "Generate with AI"}
            </span>
            <ArrowUp size={14} aria-hidden="true" />
          </button>
        </form>
      )}

      {/* Compact Recent Runs */}
      {(runs ?? []).length > 0 && (
        <div className="gs-stack-sm">
          <div className="gs-row-between">
            <small className="muted">
              <Activity size={12} aria-hidden="true" />
              {zh ? "近期执行记录" : "Recent runs"}
            </small>
            <button
              type="button"
              className="gs-btn gs-btn-sm gs-btn-ghost"
              onClick={() => onNavigateTab("runs")}
            >
              {zh ? "全部" : "All"}
            </button>
          </div>
          <div className="gs-copilot-runs">
            {(runs ?? []).slice(0, 3).map((r) => {
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
        </div>
      )}
    </aside>
  );
}
