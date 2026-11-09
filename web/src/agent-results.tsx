import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronDown, FileText, ImageOff } from "lucide-react";
import { api } from "./api";
import { st, siteMessages } from "./sites-i18n";
import type { Locale } from "./i18n";
type Row = Record<string, any>;
const copy = {
  zh: {
    all: "全部问题",
    content: "内容与采购信息",
    layout: "布局与转化",
    other: "其他检查",
    pages: "检查页面",
    issues: "条记录",
    none: "本次未记录这类问题。",
    pending: "尚无可查看的成果。任务完成后，页面、问题或设计方向会显示在这里。",
    report: "逐页检查结果",
    screen: "页面截图",
    screenError: "截图暂时无法加载",
    select: "选择页面",
    source: "检查依据",
    measure: "浏览器检查",
    human: "本次仅完成浏览器/结构检查，内容与视觉仍需人工审查。",
    document: "页面内容",
    preview: "预览页面",
    editor: "打开编辑与审核",
    loading: "正在读取页面…",
    failed: "页面读取失败。",
    retry: "重试",
    changed: "这里展示当前保存的页面。页面可能已在本次任务完成后修改。",
    noBlocks: "页面尚未生成正文。",
    plan: "页面结构",
    intent: "采购意图",
    design: "设计方向",
    designOpen: "打开设计比较与预览",
    questions: "待补充信息",
    answer: "回答并保存为候选事实",
    unknown: "检查记录",
    noSummary: "该步骤已保存结果。",
    emptySummary: "任务尚未产生可查看的结果。",
    cancelled: "未继续处理",
  },
  en: {
    all: "All findings",
    content: "Content & purchasing",
    layout: "Layout & conversion",
    other: "Other checks",
    pages: "Pages checked",
    issues: "records",
    none: "No findings of this type were recorded.",
    pending:
      "No output yet. Pages, findings or design directions will appear here as the task progresses.",
    report: "Page review",
    screen: "Page screenshots",
    screenError: "Screenshot unavailable",
    select: "Select page",
    source: "Review evidence",
    measure: "Browser checks",
    human:
      "This was a browser/structural review. Content and visuals still require human inspection.",
    document: "Page content",
    preview: "Preview page",
    editor: "Open editor & review",
    loading: "Loading page…",
    failed: "Could not load this page.",
    retry: "Retry",
    changed:
      "This is the currently saved page. It may have changed since this task completed.",
    noBlocks: "No page content has been generated.",
    plan: "Page structure",
    intent: "Buyer intent",
    design: "Design directions",
    designOpen: "Compare and preview designs",
    questions: "Information to complete",
    answer: "Answer and save candidate facts",
    unknown: "Review record",
    noSummary: "This step saved its results.",
    emptySummary: "This task has not produced results yet.",
    cancelled: "Not processed",
  },
};
function group(code: string) {
  return ["content_thin", "repetition", "procurement"].includes(code)
    ? "content"
    : ["layout", "imagery", "navigation", "cta"].includes(code)
      ? "layout"
      : "other";
}
function Screenshot({ shot, locale }: { shot: Row; locale: Locale }) {
  const [broken, setBroken] = useState(false),
    c = copy[locale];
  return broken ? (
    <p className="result-image-error">
      <ImageOff size={18} />
      {c.screenError}
    </p>
  ) : (
    <a href={shot.url} target="_blank" rel="noreferrer">
      <span>{shot.width}px</span>
      <img
        src={shot.url}
        alt={c.screen + " " + shot.width + "px"}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    </a>
  );
}
function CurrentPage({ id, locale }: { id: string; locale: Locale }) {
  const c = copy[locale],
    [data, setData] = useState<Row>(),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0),
    [html, setHtml] = useState<string>(),
    [previewError, setPreviewError] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(undefined);
    setError(false);
    api("/pages/" + id)
      .then((r) => {
        if (live) setData(r);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [id, attempt]);
  return (
    <section className="result-document">
      <div className="result-actions">
        <Link to={"/pages/" + id}>
          {c.editor}
          <ArrowUpRight size={13} />
        </Link>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setPreviewError(false);
            void api("/pages/" + id + "/preview")
              .then((r) => setHtml(r.html))
              .catch(() => setPreviewError(true))
              .finally(() => setBusy(false));
          }}
        >
          {c.preview}
        </button>
      </div>
      <p className="result-caption">{c.changed}</p>
      {error ? (
        <p role="alert">
          {c.failed}
          <button
            className="secondary"
            onClick={() => setAttempt((v) => v + 1)}
          >
            {c.retry}
          </button>
        </p>
      ) : !data ? (
        <p role="status">{c.loading}</p>
      ) : (
        <>
          <h3>{data.presentation?.headline ?? data.title}</h3>
          {!data.blocks?.length && <p>{c.noBlocks}</p>}
          {data.blocks?.map((b: Row, i: number) => (
            <section key={b.key ?? i}>
              <h4>{b.heading}</h4>
              {(b.body || b.text) && <p>{b.body || b.text}</p>}
              {b.faq?.map((q: Row, j: number) => (
                <div key={j}>
                  <strong>{q.question}</strong>
                  <p>{q.answer}</p>
                  <p>{q.detail}</p>
                </div>
              ))}
              {b.items?.map((item: Row, j: number) => (
                <div key={j}>
                  <strong>{item.title ?? item.question}</strong>
                  <p>
                    {item.body ?? item.text ?? item.answer ?? item.description}
                  </p>
                </div>
              ))}
              {(b.table?.rows || b.rows) && (
                <div className="result-table">
                  <table>
                    <tbody>
                      {(b.table?.rows || b.rows).map(
                        (row: string[], j: number) => (
                          <tr key={j}>
                            {row.map((cell, k) => (
                              <td key={k}>{cell}</td>
                            ))}
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      )}
      {previewError && <p role="alert">{c.failed}</p>}
      {html && (
        <iframe
          title={c.preview}
          srcDoc={html}
          sandbox="allow-same-origin"
          className="result-page-preview"
        />
      )}
    </section>
  );
}
export function AgentResults({
  run,
  siteId,
  locale,
}: {
  run: Row;
  siteId: string;
  locale: Locale;
}) {
  const c = copy[locale],
    t = st(locale),
    [category, setCategory] = useState("all"),
    [selected, setSelected] = useState("");
  const steps: Row[] = run.steps ?? [],
    records = steps.flatMap((s: Row) =>
      Array.isArray(s.output?.findings)
        ? s.output.findings.map((f: Row) => ({ ...f, unit: s }))
        : [],
    );
  const unit =
    steps.find((s) => s.key === selected) ??
    steps.find((s) => s.status === "succeeded") ??
    steps[0];
  if (!unit)
    return (
      <p className="result-placeholder">
        <FileText size={23} />
        {c.pending}
      </p>
    );
  const output = unit.output;
  return (
    <div className="agent-results">
      {run.step === "review" && (
        <>
          <div className="review-totals">
            <span>
              <strong>
                {steps.filter((s) => s.status === "succeeded").length}
              </strong>
              {c.pages}
            </span>
            <span>
              <strong>{records.length}</strong>
              {c.issues}
            </span>
          </div>
          <div className="result-category" role="group" aria-label={c.report}>
            {["all", "content", "layout", "other"].map((k) => (
              <button
                type="button"
                key={k}
                aria-pressed={category === k}
                onClick={() => setCategory(k)}
              >
                {c[k as keyof typeof c]}
                <span>
                  {
                    records.filter((f) => k === "all" || group(f.code) === k)
                      .length
                  }
                </span>
              </button>
            ))}
          </div>
          <div className="result-findings">
            {records.filter(
              (f) => category === "all" || group(f.code) === category,
            ).length ? (
              records
                .filter((f) => category === "all" || group(f.code) === category)
                .map((f, i) => (
                  <button
                    key={i}
                    type="button"
                    className="result-finding"
                    aria-pressed={selected === f.unit.key}
                    onClick={() => setSelected(f.unit.key)}
                  >
                    <span className={"finding-level " + f.severity}>
                      {t(f.severity ?? "warning")}
                    </span>
                    <span>
                      <small>{f.unit.inputSummary?.pageTitle}</small>
                      <strong>
                        {f.unit.output.reviewMode === "structural"
                          ? "structuralFinding_" + f.code in siteMessages
                            ? t("structuralFinding_" + f.code)
                            : (f.recommendation ?? f.message ?? c.unknown)
                          : (f.recommendation ?? f.message ?? c.unknown)}
                      </strong>
                      {f.blockKey && <code>{f.blockKey}</code>}
                    </span>
                    <ArrowUpRight size={13} />
                  </button>
                ))
            ) : (
              <p>{c.none}</p>
            )}
          </div>
        </>
      )}
      <div className="result-unit-picker">
        <label>
          {c.select}
          <select
            value={unit.key}
            onChange={(e) => setSelected(e.target.value)}
          >
            {steps.map((s, i) => (
              <option key={s.key ?? i} value={s.key}>
                {s.inputSummary?.pageTitle ?? t(run.step) + " " + (i + 1)} ·{" "}
                {run.status === "cancelled" && s.status !== "succeeded"
                  ? c.cancelled
                  : t(s.status)}
              </option>
            ))}
          </select>
        </label>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      {output ? (
        <div className="result-unit" key={unit.key}>
          {output.reviewMode && (
            <>
              <div className="result-evidence">
                <span>{c.source}</span>
                <strong>
                  {"reviewMethod_" + output.reviewMode in siteMessages
                    ? t("reviewMethod_" + output.reviewMode)
                    : c.unknown}
                </strong>
              </div>
              {output.reviewMode === "structural" && (
                <p className="notice">{c.human}</p>
              )}
            </>
          )}
          {output.summary && output.reviewMode !== "structural" && (
            <p className="result-summary">{output.summary}</p>
          )}
          {output.metrics?.length > 0 && (
            <dl className="result-measurements">
              {output.metrics.map((m: Row) => (
                <div key={m.width}>
                  <dt>{m.width}px</dt>
                  <dd>{t(m.overflow ? "overflowDetected" : "noOverflow")}</dd>
                  <dd>
                    {t("brokenImages")} {m.brokenImages}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {output.screenshots?.length > 0 && (
            <div className="result-screenshots">
              {output.screenshots.map((s: Row) => (
                <Screenshot key={s.width} shot={s} locale={locale} />
              ))}
            </div>
          )}
          {output.pageId && (
            <CurrentPage
              key={output.pageId}
              id={output.pageId}
              locale={locale}
            />
          )}
          {output.nodes && (
            <div className="result-plan">
              <h4>{c.plan}</h4>
              {output.nodes.map((n: Row) => (
                <div key={n.key}>
                  <strong>{n.title}</strong>
                  <code>{n.path}</code>
                  <span>{n.keywords?.join(", ")}</span>
                </div>
              ))}
            </div>
          )}
          {output.directions && (
            <>
              <h4>{c.design}</h4>
              {output.directions.map((d: Row) => (
                <div className="result-direction" key={d.key}>
                  <strong>{d.label}</strong>
                  <p>{d.rationale}</p>
                </div>
              ))}
              <Link to={"/sites/" + siteId + "?tab=design"}>
                {c.designOpen}
                <ArrowUpRight size={13} />
              </Link>
            </>
          )}
          {output.questions && (
            <>
              <h4>{c.questions}</h4>
              <ol>
                {output.questions.map((q: Row) => (
                  <li key={q.id}>{q.question}</li>
                ))}
              </ol>
              <Link to={"/sites/" + siteId + "?tab=interview"}>
                {c.answer}
                <ArrowUpRight size={13} />
              </Link>
            </>
          )}
        </div>
      ) : (
        <p className="result-placeholder">{c.emptySummary}</p>
      )}
    </div>
  );
}
