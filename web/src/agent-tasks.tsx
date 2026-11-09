import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Check,
  CirclePause,
  Clock3,
  TriangleAlert,
  X,
  RotateCcw,
  ChevronRight,
  ListChecks,
  FileText,
} from "lucide-react";
import { api, ApiError } from "./api";
import { st, siteMessages } from "./sites-i18n";
import type { Locale } from "./i18n";
import "./agent-tasks.css";
type Row = Record<string, any>;
const copy = {
  zh: {
    title: "任务中心",
    sub: "查看执行情况，处理需要你接手的任务。",
    all: "全部",
    active: "进行中",
    attention: "需处理",
    ended: "已结束",
    scope: "当前页任务",
    history: "任务记录",
    empty: "还没有任务",
    emptySub: "从建站向导开始，Agent 的规划、生成和检查会记录在这里。",
    noMatch: "当前页没有这类任务",
    select: "选择一项任务查看结果。",
    result: "任务结果",
    progress: "执行进度",
    completed: "已完成",
    of: "/",
    units: "项",
    recorded: "本次审查记录了",
    findings: "项建议",
    reviewSub: "打开报告查看检查结果与页面截图，再决定如何调整。",
    contentSub: "内容已保存为草稿，可以逐页查看和审核。",
    planSub: "网站结构建议已生成，确认页面安排后即可继续建站。",
    designSub: "首页设计方案已生成，可以比较预览并选择方向。",
    interviewSub: "Agent 已整理需要补充的问题，回答后可继续完善企业资料。",
    genericSub: "执行已完成，可以查看本次产出。",
    runningSub: "Agent 正在处理任务。你可以离开此页，稍后回来查看结果。",
    queuedSub: "任务已排队，开始执行后会在这里更新进度。",
    pausedSub: "任务已暂停，需要处理以下问题后继续。",
    failedSub: "这次执行未能完成，已保存的结果仍可查看。",
    cancelledSub: "任务已取消，已经保存的结果仍然保留。",
    stopping: "正在停止",
    stoppingSub: "已提交停止请求，正在等待当前步骤结束。",
    reviewAction: "查看审查报告",
    contentAction: "审核页面内容",
    planAction: "确认网站结构",
    designAction: "查看设计方案",
    interviewAction: "回答补充问题",
    openPage: "查看页面",
    diagnostics: "执行详情与用量",
    tokens: "AI 用量（Token）",
    duration: "累计执行耗时",
    attempts: "执行次数",
    sources: "输入资料",
    products: "选用产品",
    facts: "已确认事实",
    step: "步骤",
    seconds: "秒",
    minutes: "分",
    updated: "更新于",
    pages: "处理明细",
    notProcessed: "未继续处理",
    ai: "配置 AI 服务",
    usage: "查看用量",
    factsAction: "核对资料",
    workspace: "返回建站向导",
    technicalError: "错误记录",
    error: "操作未完成，请重试。",
    saving: "正在提交…",
    loading: "正在读取任务…",
    first: "上一页",
    next: "下一页",
    page: "第",
    pageEnd: "页",
    unknownTask: "建站任务",
  },
  en: {
    title: "Task center",
    sub: "Follow progress and handle work that needs your input.",
    all: "All",
    active: "In progress",
    attention: "Needs attention",
    ended: "Finished",
    scope: "Tasks on this page",
    history: "Task history",
    empty: "No tasks yet",
    emptySub:
      "Start from the site guide. Planning, generation and checks will appear here.",
    noMatch: "No matching tasks on this page",
    select: "Select a task to see its results.",
    result: "Task results",
    progress: "Progress",
    completed: "Completed",
    of: "/",
    units: "steps",
    recorded: "This review recorded",
    findings: "suggestions",
    reviewSub:
      "Open the report to inspect findings and page screenshots before making changes.",
    contentSub: "Content was saved as drafts. Open the pages to review them.",
    planSub:
      "The proposed structure is ready. Confirm the page plan to continue.",
    designSub: "Homepage proposals are ready to compare and choose from.",
    interviewSub:
      "Your agent has prepared questions to complete your company information.",
    genericSub: "The task finished. Its recorded outputs are available below.",
    runningSub:
      "Your agent is working. You can leave and return later to check the results.",
    queuedSub: "The task is queued and waiting to start.",
    pausedSub: "The task is paused. Resolve the issue below to continue.",
    failedSub:
      "This attempt could not finish. Saved results are still available.",
    cancelledSub: "The task was cancelled. Saved results have been retained.",
    stopping: "Stopping",
    stoppingSub: "The stop request is waiting for the current step to finish.",
    reviewAction: "Open review report",
    contentAction: "Review page content",
    planAction: "Confirm site structure",
    designAction: "View design proposals",
    interviewAction: "Answer questions",
    openPage: "Open page",
    diagnostics: "Execution details & usage",
    tokens: "AI usage (tokens)",
    duration: "Total execution time",
    attempts: "Attempts",
    sources: "Input sources",
    products: "Selected products",
    facts: "Confirmed facts",
    step: "Step",
    seconds: "sec",
    minutes: "min",
    updated: "Updated",
    pages: "Items processed",
    notProcessed: "Not processed",
    ai: "Configure AI provider",
    usage: "View usage",
    factsAction: "Check sources",
    workspace: "Back to site guide",
    technicalError: "Recorded error",
    error: "Could not complete the action. Please retry.",
    saving: "Submitting…",
    loading: "Loading tasks…",
    first: "Previous",
    next: "Next",
    page: "Page",
    pageEnd: "",
    unknownTask: "Site task",
  },
};
const names: Record<string, [string, string]> = {
  interview: ["补充建站资料", "Complete business information"],
  research: ["规划网站结构", "Plan site structure"],
  design: ["生成首页设计方案", "Generate homepage proposals"],
  content: ["生成网站内容", "Generate site content"],
  rewrite: ["修改页面内容", "Rewrite page content"],
  review: ["检查网站质量", "Review website quality"],
  refine: ["改进页面内容", "Improve page content"],
};
function stateIcon(status: string) {
  return status === "succeeded"
    ? Check
    : status === "paused"
      ? CirclePause
      : status === "failed"
        ? TriangleAlert
        : status === "cancelled"
          ? X
          : status === "queued"
            ? Clock3
            : Activity;
}
function target(run: Row, siteId: string, unit?: Row) {
  const base = "/sites/" + siteId;
  if (unit?.output?.pageId) return "/pages/" + unit.output.pageId;
  return (
    base +
    "?tab=" +
    ({
      research: "planning",
      design: "design",
      interview: "interview",
      review: "quality",
      content: "pages",
      rewrite: "pages",
      refine: "pages",
    }[run.step as string] ?? "guide")
  );
}
export function RunList({
  runs,
  locale,
  canEdit,
  refresh,
  siteId,
  page = 1,
  hasMore = false,
  onNext,
  onPrevious,
}: {
  runs?: Row[];
  locale: Locale;
  canEdit: boolean;
  refresh: () => void;
  siteId: string;
  page?: number;
  hasMore?: boolean;
  onNext?: () => void;
  onPrevious?: () => void;
}) {
  const c = copy[locale],
    t = st(locale),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState<{ id: string; message: string }>(),
    posting = useRef(false);
  const list = runs ?? [],
    attention = (r: Row) => ["paused", "failed"].includes(r.status),
    running = (r: Row) => r.active && !attention(r),
    ended = (r: Row) => ["succeeded", "cancelled"].includes(r.status);
  const filtered = list.filter(
    (r) =>
      filter === "all" ||
      (filter === "attention"
        ? attention(r)
        : filter === "active"
          ? running(r)
          : ended(r)),
  );
  const run =
    filtered.find((r) => r.id === selected) ??
    filtered.find(attention) ??
    filtered.find(running) ??
    filtered[0];
  const title = (r: Row) =>
    names[r.step]?.[locale === "zh" ? 0 : 1] ?? c.unknownTask;
  const date = (value: unknown) => {
    const d = new Date(String(value ?? ""));
    return Number.isNaN(d.getTime())
      ? "—"
      : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(d);
  };
  const humanError = (code: string) =>
    code in siteMessages ? t(code) : c.error;
  async function act(r: Row, action: string) {
    if (posting.current) return;
    posting.current = true;
    setBusy(r.id);
    setError(undefined);
    try {
      await api("/agent-runs/" + r.id + "/" + action, "POST");
      refresh();
    } catch (e) {
      setError({
        id: r.id,
        message: e instanceof ApiError ? humanError(e.code) : c.error,
      });
    } finally {
      posting.current = false;
      setBusy("");
    }
  }
  const steps: Row[] = run?.steps ?? [],
    done = steps.filter((s) => s.status === "succeeded").length;
  const resultText =
    run?.cancelRequested && run.active
      ? c.stoppingSub
      : run?.status === "succeeded"
        ? ({
            research: c.planSub,
            design: c.designSub,
            interview: c.interviewSub,
            content: c.contentSub,
            rewrite: c.contentSub,
            refine: c.contentSub,
            review: c.reviewSub,
          }[run.step as string] ?? c.genericSub)
        : run?.status === "running"
          ? c.runningSub
          : run?.status === "queued"
            ? c.queuedSub
            : run?.status === "paused"
              ? c.pausedSub
              : run?.status === "cancelled"
                ? c.cancelledSub
                : c.failedSub;
  const actionLabel = run
    ? ({
        research: c.planAction,
        design: c.designAction,
        interview: c.interviewAction,
        review: c.reviewAction,
      }[run.step as string] ?? c.contentAction)
    : "";
  const knownFindings =
    run?.step === "review" &&
    steps.length > 0 &&
    steps.every((s) => Array.isArray(s.output?.findings));
  const findingCount = knownFindings
    ? steps.reduce((n, s) => n + s.output.findings.length, 0)
    : 0;
  return (
    <section className="task-center">
      <header className="task-center-heading">
        <div>
          <h2>{c.title}</h2>
          <p>{c.sub}</p>
        </div>
        <Link to={"/sites/" + siteId + "?tab=guide"}>
          {c.workspace}
          <ArrowUpRight size={15} />
        </Link>
      </header>
      {!runs ? (
        <p className="task-feedback" role="status">
          {c.loading}
        </p>
      ) : !runs.length ? (
        <div className="task-empty">
          <ListChecks size={29} />
          <h3>{c.empty}</h3>
          <p>{c.emptySub}</p>
          <Link
            className="button primary"
            to={"/sites/" + siteId + "?tab=guide"}
          >
            {c.workspace}
          </Link>
        </div>
      ) : (
        <>
          <div className="task-toolbar">
            <div role="group" aria-label={c.history}>
              {(["all", "attention", "active", "ended"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {c[k]}
                  <span>
                    {
                      list.filter(
                        (r) =>
                          k === "all" ||
                          (k === "attention"
                            ? attention(r)
                            : k === "active"
                              ? running(r)
                              : ended(r)),
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
            <span>{c.scope}</span>
          </div>
          <div className="task-split">
            <div className="task-index" aria-label={c.history}>
              {filtered.length ? (
                filtered.map((r) => {
                  const Icon = stateIcon(r.status);
                  return (
                    <button
                      type="button"
                      key={r.id}
                      className="task-index-item"
                      aria-pressed={run?.id === r.id}
                      onClick={() => {
                        setSelected(r.id);
                        setError(undefined);
                      }}
                    >
                      <span className={"task-index-icon state-" + r.status}>
                        <Icon size={18} />
                      </span>
                      <span className="task-index-copy">
                        <strong>{title(r)}</strong>
                        <small>{date(r.updatedAt ?? r.createdAt)}</small>
                      </span>
                      <span className={"task-state state-" + r.status}>
                        {r.cancelRequested && r.active
                          ? c.stopping
                          : t(r.status)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="task-feedback">{c.noMatch}</p>
              )}
            </div>
            {run ? (
              <article className="task-detail studio-run" key={run.id}>
                <header>
                  <span
                    role="status"
                    className={"task-state state-" + run.status}
                  >
                    {run.cancelRequested && run.active
                      ? c.stopping
                      : t(run.status)}
                  </span>
                  <h3>{title(run)}</h3>
                  <p>
                    {c.updated} {date(run.updatedAt ?? run.createdAt)}
                  </p>
                </header>
                <section className={"task-outcome state-" + run.status}>
                  <h4>{c.result}</h4>
                  <p>{resultText}</p>
                  {knownFindings && (
                    <p className="task-findings">
                      {c.recorded} <strong>{findingCount}</strong> {c.findings}
                    </p>
                  )}
                  {run.errorCode && (
                    <p
                      className="task-problem"
                      role={attention(run) ? "status" : undefined}
                    >
                      {humanError(run.errorCode)}
                    </p>
                  )}
                  <div className="task-actions" aria-busy={busy === run.id}>
                    {(run.status === "succeeded" || done > 0) && (
                      <Link className="button primary" to={target(run, siteId)}>
                        {actionLabel}
                        <ArrowUpRight size={15} />
                      </Link>
                    )}
                    {attention(run) && run.errorCode === "AI_UNCONFIGURED" && (
                      <Link className="button secondary" to="/ai">
                        {c.ai}
                        <ArrowUpRight size={15} />
                      </Link>
                    )}
                    {attention(run) &&
                      ["QUOTA_EXCEEDED", "AI_USAGE_UNKNOWN"].includes(
                        run.errorCode,
                      ) && (
                        <Link className="button secondary" to="/usage">
                          {c.usage}
                          <ArrowUpRight size={15} />
                        </Link>
                      )}
                    {attention(run) &&
                      ["SOURCE_CHANGED", "SOURCE_WITHDRAWN"].includes(
                        run.errorCode,
                      ) && (
                        <Link
                          className="button secondary"
                          to={"/sites/" + siteId + "?tab=guide"}
                        >
                          {c.factsAction}
                          <ArrowUpRight size={15} />
                        </Link>
                      )}
                    {canEdit && attention(run) && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void act(run, "retry")}
                      >
                        <RotateCcw size={15} />
                        {t("retry")}
                      </button>
                    )}
                    {canEdit && run.active && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!busy || run.cancelRequested}
                        onClick={() => void act(run, "cancel")}
                      >
                        {t("cancel")}
                      </button>
                    )}
                  </div>
                  {busy === run.id && <p role="status">{c.saving}</p>}
                  {error && error.id === run.id && (
                    <p className="notice error" role="alert">
                      {error.message}
                    </p>
                  )}
                </section>
                {steps.length > 0 && (
                  <section className="task-items">
                    <div className="task-section-title">
                      <h4>
                        {run.active && !attention(run) ? c.progress : c.pages}
                      </h4>
                      <span>
                        {c.completed} {done}
                        {c.of}
                        {steps.length}
                      </span>
                    </div>
                    {run.active && (
                      <progress
                        value={done}
                        max={steps.length}
                        aria-label={c.progress}
                      />
                    )}
                    <ul>
                      {steps.map((s, i) => {
                        const Icon = stateIcon(s.status),
                          output = s.status === "succeeded" && s.output;
                        return (
                          <li key={s.key ?? i}>
                            <span
                              className={"task-item-icon state-" + s.status}
                            >
                              <Icon size={15} />
                            </span>
                            <span className="task-item-title">
                              {s.inputSummary?.pageTitle ??
                                c.step + " " + (i + 1)}
                            </span>
                            <span
                              className={"task-item-status state-" + s.status}
                            >
                              {run.status === "cancelled" &&
                              s.status !== "succeeded"
                                ? c.notProcessed
                                : t(s.status)}
                            </span>
                            {output?.pageId && (
                              <Link to={target(run, siteId, s)}>
                                {c.openPage}
                                <ChevronRight size={14} />
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                <details className="task-diagnostics">
                  <summary>{c.diagnostics}</summary>
                  <dl>
                    <div>
                      <dt>{c.tokens}</dt>
                      <dd>
                        {new Intl.NumberFormat(locale).format(run.tokens ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt>{c.duration}</dt>
                      <dd>
                        {((run.elapsedMs ?? 0) / 1000).toFixed(1)} {c.seconds}
                      </dd>
                    </div>
                    <div>
                      <dt>{c.products}</dt>
                      <dd>{run.inputSummary?.products ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>{c.facts}</dt>
                      <dd>{run.inputSummary?.confirmedFacts ?? "—"}</dd>
                    </div>
                  </dl>
                  {run.errorCode && (
                    <p>
                      {c.technicalError} <code>{run.errorCode}</code>
                    </p>
                  )}
                  {steps.map((s, i) => (
                    <details key={s.key ?? i}>
                      <summary>
                        {s.inputSummary?.pageTitle ?? c.step + " " + (i + 1)} ·{" "}
                        {c.attempts} {s.attempts ?? 0}
                      </summary>
                      <p>
                        {c.tokens}{" "}
                        {new Intl.NumberFormat(locale).format(s.tokens ?? 0)} ·{" "}
                        {c.duration} {((s.elapsedMs ?? 0) / 1000).toFixed(1)}{" "}
                        {c.seconds}
                      </p>
                      {s.inputSummary && (
                        <p>
                          {c.products} {s.inputSummary.products ?? "—"} ·{" "}
                          {c.facts} {s.inputSummary.confirmedFacts ?? "—"}
                        </p>
                      )}
                      {s.errorCode && (
                        <p>
                          {c.technicalError} <code>{s.errorCode}</code>
                        </p>
                      )}
                      {s.output?.reviewMode && (
                        <p>
                          {t("reviewMethod")} ·{" "}
                          {t("reviewMethod_" + s.output.reviewMode)}
                        </p>
                      )}
                      {s.output?.metrics?.length > 0 && (
                        <ul>
                          {s.output.metrics.map((m: Row) => (
                            <li key={m.width}>
                              {m.width}px ·{" "}
                              {t(
                                m.overflow ? "overflowDetected" : "noOverflow",
                              )}{" "}
                              · {t("brokenImages")} {m.brokenImages}
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.output?.screenshots?.length > 0 && (
                        <Link to={target({ ...run, step: "review" }, siteId)}>
                          {t("openReport")} · {s.output.screenshots.length}{" "}
                          {t("screenCaptures")}
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
                      {(s.history ?? []).map((h: Row, j: number) => (
                        <p key={j}>
                          {c.attempts} {h.attempt} · {t(h.status)} ·{" "}
                          {new Intl.NumberFormat(locale).format(h.tokens ?? 0)}{" "}
                          Token · {((h.elapsedMs ?? 0) / 1000).toFixed(1)}{" "}
                          {c.seconds}
                          {h.errorCode ? " · " + humanError(h.errorCode) : ""}
                        </p>
                      ))}
                    </details>
                  ))}
                </details>
              </article>
            ) : (
              <div className="task-empty task-no-selection">
                <FileText size={28} />
                <p>{c.select}</p>
              </div>
            )}
          </div>
        </>
      )}
      {(page > 1 || hasMore) && (
        <nav className="task-pagination" aria-label={c.history}>
          <button
            className="secondary"
            disabled={page === 1}
            onClick={onPrevious}
          >
            {c.first}
          </button>
          <span>
            {c.page} {page} {c.pageEnd}
          </span>
          <button className="secondary" disabled={!hasMore} onClick={onNext}>
            {c.next}
          </button>
        </nav>
      )}
    </section>
  );
}
