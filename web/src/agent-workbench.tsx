import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  ClipboardList,
  Layers3,
  Route,
  ScanEye,
} from "lucide-react";
import { RunList, useLoad } from "./sites";
import type { Locale } from "./i18n";
const labels = {
  zh: {
    title: "建站 Agent",
    sub: "选择站点，查看 Agent 执行到哪一步，并接手需要审核的内容。",
    site: "当前站点",
    empty: "先创建一个站点，再开始规划和生成内容。",
    sites: "打开站点",
    more: "下一批站点",
    first: "返回首批站点",
    flow: "继续建站",
    plan: "规划站点",
    planSub: "查看关键词和页面结构",
    content: "内容审核",
    contentSub: "检查页面内容与事实依据",
    review: "质量审查",
    reviewSub: "查看截图、问题和修订",
    output: "构建与发布",
    outputSub: "预览版本并发布",
    error: "数据读取失败，请重试。",
    retry: "重试",
    loading: "正在读取站点…",
  },
  en: {
    title: "Site agent",
    sub: "Select a site to follow its runs and review the work that needs your input.",
    site: "Current site",
    empty: "Create a site to begin planning and generating content.",
    sites: "Open sites",
    more: "Next sites",
    first: "First sites",
    flow: "Continue building",
    plan: "Plan the site",
    planSub: "Keywords and page structure",
    content: "Review content",
    contentSub: "Page drafts and supporting facts",
    review: "Quality review",
    reviewSub: "Screenshots, findings and revisions",
    output: "Build & publish",
    outputSub: "Version previews and deployment",
    error: "Could not load data. Please retry.",
    retry: "Retry",
    loading: "Loading sites…",
  },
};
export function AgentWorkbench({
  locale,
  role,
}: {
  locale: Locale;
  role: "admin" | "editor" | "viewer";
}) {
  const c = labels[locale],
    [cursor, setCursor] = useState(""),
    [selected, setSelected] = useState(""),
    [history, setHistory] = useState<{ siteId: string; cursors: string[] }>({
      siteId: "",
      cursors: [""],
    });
  const sites = useLoad(
      "/sites" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    ),
    items: { id: string; name: string }[] = sites.data?.items ?? [];
  const site = items.find((s) => s.id === selected) ?? items[0],
    base = site ? "/sites/" + site.id : "";
  const trail = history.siteId === site?.id ? history.cursors : [""],
    cursorKey = trail[trail.length - 1];
  const runs = useLoad(
    site
      ? base +
          "/agent-runs" +
          (cursorKey ? "?cursor=" + encodeURIComponent(cursorKey) : "")
      : null,
    true,
  );
  return (
    <div className="agent-workbench catalog">
      <header className="agent-mast">
        <div>
          <Activity aria-hidden="true" size={23} />
          <h1>{c.title}</h1>
          <p>{c.sub}</p>
        </div>
        <section className="agent-picker">
          <label>
            {c.site}
            <select
              value={site?.id ?? ""}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!items.length}
            >
              {items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {sites.data?.nextCursor && (
            <button
              className="secondary"
              onClick={() => setCursor(sites.data.nextCursor)}
            >
              {c.more}
            </button>
          )}
          {cursor && (
            <button className="secondary" onClick={() => setCursor("")}>
              {c.first}
            </button>
          )}
        </section>
      </header>
      {sites.error ? (
        <div className="notice error" role="alert">
          {c.error}
          <button onClick={sites.reload}>{c.retry}</button>
        </div>
      ) : !sites.data ? (
        <p role="status">{c.loading}</p>
      ) : !site ? (
        <div className="catalog-panel">
          <p>{c.empty}</p>
          <Link to="/sites">
            {c.sites} <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="agent-columns">
          <div className="agent-history">
            {runs.error && (
              <div className="notice error" role="alert">
                {c.error}
                <button onClick={runs.reload}>{c.retry}</button>
              </div>
            )}
            {(!runs.error || runs.data) && (
              <RunList
                key={site.id}
                runs={runs.data?.items}
                locale={locale}
                siteId={site.id}
                refresh={runs.reload}
                page={trail.length}
                hasMore={!!runs.data?.hasMore}
                onNext={() => {
                  if (runs.data?.nextCursor)
                    setHistory({
                      siteId: site.id,
                      cursors: [...trail, runs.data.nextCursor],
                    });
                }}
                onPrevious={() =>
                  setHistory({ siteId: site.id, cursors: trail.slice(0, -1) })
                }
                canEdit={role !== "viewer"}
              />
            )}
          </div>
          <aside className="agent-handoffs">
            <h2>{c.flow}</h2>
            {[
              {
                to: base + "?tab=planning",
                title: c.plan,
                sub: c.planSub,
                Icon: Route,
              },
              {
                to: base + "?tab=pages",
                title: c.content,
                sub: c.contentSub,
                Icon: ClipboardList,
              },
              {
                to: base + "?tab=quality",
                title: c.review,
                sub: c.reviewSub,
                Icon: ScanEye,
              },
              {
                to: base + "/publishing",
                title: c.output,
                sub: c.outputSub,
                Icon: Layers3,
              },
            ].map(({ to, title, sub, Icon }) => (
              <Link key={to} to={to}>
                <Icon size={19} />
                <span>
                  <strong>{title}</strong>
                  <small>{sub}</small>
                </span>
                <ChevronRight size={15} />
              </Link>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
