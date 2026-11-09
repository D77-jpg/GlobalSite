import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowUp,
  Route,
  ClipboardList,
  ScanEye,
  Layers3,
} from "lucide-react";
import { api, ApiError } from "./api";
import { st, siteMessages } from "./sites-i18n";
import type { Locale } from "./i18n";

type Row = Record<string, any>;
const text = {
  zh: {
    title: "工作面板",
    next: "继续这项工作",
    task: "执行任务",
    choose: "任务类型",
    requirements: "补充要求",
    placeholder: "例如：检查产品页的信息层级，优先改善手机上的阅读与询价路径。",
    consent: "同意本次使用组织 AI 配置并计入用量",
    submit: "开始执行",
    sending: "正在提交…",
    readOnly: "你当前为只读成员，可以查看成果；执行和修改需要编辑权限。",
    safe: "生成结果将保留为待审核内容，不会自动发布。",
    error: "任务未能提交，请重试。",
    remaining: "在工作区继续",
    prepare: "先确认网站结构，再执行这项任务。",
    instructions:
      "你可以描述目标，选择要执行的工作。Agent 将按现有资料处理，缺失事实仍需你确认。",
    plan: "规划站点",
    pages: "内容审核",
    review: "质量审查",
    publish: "构建与发布",
  },
  en: {
    title: "Work panel",
    next: "Continue this work",
    task: "Run a task",
    choose: "Task type",
    requirements: "Instructions",
    placeholder:
      "For example: review product page hierarchy, prioritizing mobile readability and the quote request path.",
    consent:
      "Use the organization AI provider and count this task toward usage",
    submit: "Start task",
    sending: "Submitting…",
    readOnly:
      "You have read-only access. Editing permission is required to run or change tasks.",
    safe: "Generated results remain drafts for review. Nothing is published automatically.",
    error: "Could not submit this task. Please retry.",
    remaining: "Continue in the workspace",
    prepare: "Confirm the site structure before running this task.",
    instructions:
      "Describe the outcome and choose a task. Your agent will use the available sources; missing facts still need your confirmation.",
    plan: "Plan the site",
    pages: "Review content",
    review: "Quality review",
    publish: "Build & publish",
  },
};
const taskNames: Record<string, [string, string]> = {
  interview: ["补充企业资料", "Complete business information"],
  research: ["规划网站结构", "Plan site structure"],
  design: ["生成首页方案", "Generate homepage proposals"],
  content: ["生成页面内容", "Generate page content"],
  review: ["检查网站质量", "Review website quality"],
  refine: ["按报告改进内容", "Improve content from review"],
};
export function AgentControls({
  siteId,
  site,
  run,
  locale,
  canEdit,
  onCreated,
  children,
}: {
  siteId: string;
  site?: Row;
  run?: Row;
  locale: Locale;
  canEdit: boolean;
  onCreated: (r: Row) => void;
  children?: React.ReactNode;
}) {
  const c = text[locale],
    t = st(locale);
  const next =
    run?.step === "review" && run.status === "succeeded"
      ? "refine"
      : run?.step === "research" && run.status === "succeeded"
        ? site?.templateId === "adaptive"
          ? "design"
          : "content"
        : run?.step === "design" && run.status === "succeeded"
          ? "content"
          : run?.step === "content" && run.status === "succeeded"
            ? "review"
            : run?.step && run.step in taskNames
              ? run!.step
              : "research";
  const [step, setStep] = useState<string>(next),
    [instructions, setInstructions] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    posting = useRef(false);
  const needsPlan = ["design", "content", "review", "refine"].includes(step),
    blocked = !!site && needsPlan && !site.planConfirmed;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (posting.current || !canEdit || !consent || !site || blocked) return;
    posting.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await api(
        "/sites/" + siteId + "/agent-runs",
        "POST",
        {
          step,
          consent: true,
          ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      setInstructions("");
      setConsent(false);
      onCreated(r);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code in siteMessages ? t(e.code) : c.error,
      );
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }
  return (
    <aside className="task-control" aria-label={c.title}>
      <header>
        <span className="work-indicator" aria-hidden="true" />
        <h2>{c.title}</h2>
      </header>
      <div className="task-context">{children}</div>
      {canEdit ? (
        <form className="task-composer" onSubmit={(e) => void submit(e)}>
          <h3>{c.task}</h3>
          <p>{c.instructions}</p>
          <label>
            {c.choose}
            <select
              aria-label={c.choose}
              value={step}
              onChange={(e) => setStep(e.target.value)}
              disabled={busy}
            >
              {Object.entries(taskNames).map(([k, v]) => (
                <option key={k} value={k}>
                  {v[locale === "zh" ? 0 : 1]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.requirements}
            <textarea
              aria-label={c.requirements}
              maxLength={1000}
              rows={4}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={c.placeholder}
              disabled={busy}
            />
          </label>
          {blocked && (
            <p className="task-prerequisite">
              {c.prepare}{" "}
              <Link to={"/sites/" + siteId + "?tab=planning"}>
                {c.plan}
                <ArrowUpRight size={12} />
              </Link>
            </p>
          )}
          <label className="task-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={busy}
            />
            <span>{c.consent}</span>
          </label>
          <button
            className="primary"
            disabled={busy || !consent || !site || blocked}
          >
            {busy ? c.sending : c.submit}
            <ArrowUp size={15} />
          </button>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <small>{c.safe}</small>
        </form>
      ) : (
        <p className="task-reader">{c.readOnly}</p>
      )}
      <nav className="agent-handoffs" aria-label={c.remaining}>
        <h3>{c.remaining}</h3>
        {[
          { tab: "planning", label: c.plan, Icon: Route },
          { tab: "pages", label: c.pages, Icon: ClipboardList },
          { tab: "quality", label: c.review, Icon: ScanEye },
          { tab: "publishing", label: c.publish, Icon: Layers3 },
        ].map(({ tab, label, Icon }) => (
          <Link
            key={tab}
            to={
              "/sites/" +
              siteId +
              (tab === "publishing" ? "/publishing" : "?tab=" + tab)
            }
          >
            <Icon size={15} />
            <span>{label}</span>
            <ArrowUpRight size={13} />
          </Link>
        ))}
      </nav>
    </aside>
  );
}
