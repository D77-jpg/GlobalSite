import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Box,
  Sparkles,
  Globe2,
} from "lucide-react";
import { api, ApiError } from "./api";
import { useLoad } from "./sites";
import { st, siteMessages } from "./sites-i18n";
import type { Locale } from "./i18n";
import "./site-journey.css";

const copy = {
  zh: {
    title: "创建你的网站",
    sub: "告诉我们你做什么、想向谁销售。Agent 会据此规划网站，你随时可以审核和调整。",
    back: "返回站点",
    basics: "业务与目标",
    products: "选用产品",
    name: "站点名称",
    nameHint: "填写对外使用的英文品牌或企业名称",
    markets: "目标市场",
    marketHint: "多个市场用逗号分隔，例如 United States, Germany",
    audience: "面向哪些客户",
    audienceHint: "例如宠物用品进口商、零售品牌",
    needs: "希望网站帮你实现什么",
    needsHint: "例如展示猫窝、猫抓板和玩具，吸引批发商询价",
    next: "下一步，选择产品",
    previous: "上一步",
    create: "创建并进入建站向导",
    creating: "正在创建…",
    look: "基础版式",
    lookHint: "选择接近业务的起点，后续可调整内容与页面结构。",
    machinery: "机械设备",
    hardware: "建材五金",
    bags: "消费品与包装",
    pickTitle: "哪些产品要出现在网站上？",
    pickSub: "从现有产品库选用，最多 50 个。也可以先创建站点，稍后补充。",
    search: "搜索产品名称或编号",
    searchButton: "搜索",
    selected: "已选产品",
    noProducts: "还没有可选产品",
    addProducts: "前往产品库添加",
    loading: "正在读取产品…",
    retry: "重新加载",
    more: "下一批产品",
    first: "返回首批",
    none: "没有匹配的产品",
    choose: "选择",
    limit: "最多选择 50 个产品，请先取消部分选择。",
    selectedOnly: "只看已选",
    all: "查看全部",
    nextTitle: "创建后会发生什么",
    nextSub: "准备资料 → Agent 规划 → 生成内容 → 人工审核 → 构建预览与发布",
    error: "未能保存，请检查填写内容后重试。",
    saved: "站点已创建。请继续进入建站向导。",
    resume: "进入建站向导",
    guide: "建站向导",
    guideSub: "跟着下面的步骤完成网站。每一步都会保留进度。",
    prepare: "准备建站资料",
    prepareSub: "补充产品、企业资料和目标客户，确认可用于网站的事实。",
    planning: "规划网站结构",
    planningSub: "Agent 提出页面与关键词建议，由你确认网站结构。",
    writing: "生成网站内容",
    writingSub: "按确认的结构生成页面，接着逐页审核内容与事实。",
    preview: "检查并预览网站",
    previewSub: "完成质量审查后，构建可浏览版本，再决定是否发布。",
    open: "打开",
    current: "当前步骤",
    done: "已完成",
    later: "后续步骤",
    start: "让 Agent 规划网站",
    viewPlan: "查看并确认网站结构",
    generate: "让 Agent 生成页面",
    review: "审核页面内容",
    publish: "检查、构建与预览",
    working: "查看正在执行的任务",
    resumeRun: "处理暂停或失败的任务",
    consent: "同意将本站选用资料发送给组织配置的 AI 服务商，并计入 AI 额度。",
    data: "选用产品",
    facts: "已确认事实",
    pages: "已生成页面",
    approved: "已审核页面",
    settings: "调整业务与产品",
    confirmFacts: "核对企业事实",
    needProducts: "先选用建站产品，或补充企业事实，再开始规划。",
    wait: "正在读取建站进度…",
    aiSettings: "配置 AI 服务商",
    quota: "查看 AI 用量",
    ready: "资料和结构随时可调整；修改后需要重新审核受影响的内容。",
    taskHint: "任务执行期间可以离开页面。进度保存在站点中。",
  },
  en: {
    title: "Create your website",
    sub: "Tell us what you sell and who you want to reach. Your agent will plan the site for your review.",
    back: "Back to sites",
    basics: "Business & goals",
    products: "Select products",
    name: "Site name",
    nameHint: "Use your public English brand or company name",
    markets: "Target markets",
    marketHint: "Separate markets with commas, e.g. United States, Germany",
    audience: "Who are your buyers?",
    audienceHint: "For example, pet product importers and retail brands",
    needs: "What should this website achieve?",
    needsHint:
      "For example, showcase cat beds, scratchers and toys to attract wholesale inquiries",
    next: "Continue to products",
    previous: "Back",
    create: "Create and open the site guide",
    creating: "Creating…",
    look: "Starting layout",
    lookHint:
      "Choose a starting point for your business. Content and page structure can be adjusted later.",
    machinery: "Machinery",
    hardware: "Building & hardware",
    bags: "Consumer goods & packaging",
    pickTitle: "Which products belong on this site?",
    pickSub:
      "Select up to 50 products from your library. You can also add them after creating the site.",
    search: "Search product name or SKU",
    searchButton: "Search",
    selected: "Selected products",
    noProducts: "No products available yet",
    addProducts: "Add products to your library",
    loading: "Loading products…",
    retry: "Retry",
    more: "Next products",
    first: "First products",
    none: "No matching products",
    choose: "Select",
    limit: "Select up to 50 products. Remove a selection to add another.",
    selectedOnly: "Selected only",
    all: "Show all",
    nextTitle: "What happens next",
    nextSub:
      "Prepare sources → Agent planning → Content generation → Review → Build, preview & publish",
    error: "Could not save. Check your entries and retry.",
    saved: "Your site was created. Continue to the site guide.",
    resume: "Open site guide",
    guide: "Site guide",
    guideSub:
      "Follow these steps to build your website. Your progress is saved along the way.",
    prepare: "Prepare your sources",
    prepareSub:
      "Add products, company details and buyer goals. Confirm the facts your site may use.",
    planning: "Plan the website",
    planningSub:
      "Your agent proposes pages and keywords. Review and confirm the structure.",
    writing: "Generate the content",
    writingSub:
      "Generate pages from the confirmed plan, then review their content and evidence.",
    preview: "Check & preview the site",
    previewSub:
      "Review quality and build a browsable version before publishing.",
    open: "Open",
    current: "Current step",
    done: "Complete",
    later: "Upcoming",
    start: "Ask the agent to plan",
    viewPlan: "Review and confirm the sitemap",
    generate: "Ask the agent to write",
    review: "Review page content",
    publish: "Check, build & preview",
    working: "View running tasks",
    resumeRun: "Resolve paused or failed tasks",
    consent:
      "I agree to send selected site sources to the organization's AI provider and use AI credits.",
    data: "Selected products",
    facts: "Confirmed facts",
    pages: "Drafted pages",
    approved: "Reviewed pages",
    settings: "Edit business & products",
    confirmFacts: "Confirm company facts",
    needProducts:
      "Select products or add confirmed company facts before planning.",
    wait: "Loading your progress…",
    aiSettings: "Configure AI provider",
    quota: "View AI usage",
    ready:
      "You can update your sources and structure later. Affected content will need another review.",
    taskHint:
      "You can leave while tasks run. Progress is saved with your site.",
  },
};
export function SiteCreation({
  locale,
  role,
}: {
  locale: Locale;
  role: "admin" | "editor" | "viewer";
}) {
  const c = copy[locale],
    navigate = useNavigate(),
    messages = st(locale);
  const [step, setStep] = useState(0),
    [ids, setIds] = useState<string[]>([]),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [query, setQuery] = useState(""),
    [cursor, setCursor] = useState(""),
    [filter, setFilter] = useState(""),
    [onlySelected, setOnlySelected] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [createdId, setCreatedId] = useState("");
  const saving = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const products = useLoad(
    "/products?" +
      new URLSearchParams({
        limit: "30",
        q: query,
        ...(cursor ? { cursor } : {}),
      }),
  );
  const form = useForm({
    defaultValues: {
      name: "",
      targetMarkets: "United States",
      audience: "",
      needs: "",
      templateId: "packaging-bags",
    },
  });
  if (role === "viewer") return <Navigate to="/sites" replace />;
  async function submit(value: {
    name: string;
    targetMarkets: string;
    audience: string;
    needs: string;
    templateId: string;
  }) {
    if (saving.current) return;
    if (step === 0) {
      setStep(1);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const site = await api<{ id: string }>("/sites", "POST", {
        name: value.name.trim(),
        templateId: value.templateId,
        targetMarkets: value.targetMarkets
          .split(/[,，]/)
          .map((v) => v.trim())
          .filter(Boolean),
        language: "en",
        brandColor: "#126a54",
        logoId: null,
        productIds: ids,
        status: "draft",
        ...(value.audience.trim()
          ? {
              buyerProfile: {
                businessModel: "wholesale",
                audiences: [value.audience.trim()],
                buyerNeeds: value.needs.trim() ? [value.needs.trim()] : [],
                primaryAction: "quote",
                referenceUrls: [],
              },
            }
          : {}),
      });
      setCreatedId(site.id);
      navigate("/sites/" + site.id + "?tab=guide", { replace: true });
    } catch (e) {
      setError(
        e instanceof ApiError
          ? messages(e.code in siteMessages ? e.code : "failedGeneric")
          : c.error,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="site-creation">
      <Link className="journey-back" to="/sites">
        <ArrowLeft size={16} />
        {c.back}
      </Link>
      <header>
        <span className="journey-eyebrow">GlobalSite</span>
        <h1>{c.title}</h1>
        <p>{c.sub}</p>
      </header>
      <ol className="creation-steps" aria-label={c.title}>
        {[c.basics, c.products].map((label, i) => (
          <li key={label} aria-current={step === i ? "step" : undefined}>
            <span>{i < step ? <Check size={15} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {createdId ? (
        <div role="status">
          {c.saved}
          <Link to={"/sites/" + createdId + "?tab=guide"}>{c.resume}</Link>
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(submit)}>
          <fieldset disabled={busy}>
            {step === 0 ? (
              <section className="creation-surface">
                <h2 ref={heading} tabIndex={-1}>
                  {c.basics}
                </h2>
                <label>
                  {c.name}
                  <input
                    required
                    maxLength={120}
                    placeholder={c.nameHint}
                    {...form.register("name")}
                  />
                </label>
                <label>
                  {c.markets}
                  <input
                    required
                    maxLength={800}
                    {...form.register("targetMarkets")}
                  />
                  <small>{c.marketHint}</small>
                </label>
                <label>
                  {c.audience}
                  <input
                    required
                    maxLength={100}
                    placeholder={c.audienceHint}
                    {...form.register("audience")}
                  />
                </label>
                <label>
                  {c.needs}
                  <textarea
                    maxLength={160}
                    rows={3}
                    placeholder={c.needsHint}
                    {...form.register("needs")}
                  />
                </label>
                <div className="creation-layouts">
                  <h3>{c.look}</h3>
                  <p>{c.lookHint}</p>
                  <div>
                    {[
                      ["machinery", c.machinery],
                      ["building-hardware", c.hardware],
                      ["packaging-bags", c.bags],
                    ].map(([id, label]) => (
                      <label key={id}>
                        <input
                          type="radio"
                          value={id}
                          {...form.register("templateId")}
                        />
                        <span>
                          <Box size={20} />
                          {label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>
            ) : (
              <section className="creation-surface">
                <h2 ref={heading} tabIndex={-1}>
                  {c.pickTitle}
                </h2>
                <p>{c.pickSub}</p>
                <div className="creation-search">
                  <input
                    aria-label={c.search}
                    maxLength={120}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setCursor("");
                        setQuery(filter);
                        setOnlySelected(false);
                      }
                    }}
                    placeholder={c.search}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setCursor("");
                      setQuery(filter);
                      setOnlySelected(false);
                    }}
                  >
                    {c.searchButton}
                  </button>
                </div>
                <div className="creation-selection">
                  <strong>
                    {c.selected} {ids.length}/50
                  </strong>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setOnlySelected(!onlySelected)}
                  >
                    {onlySelected ? c.all : c.selectedOnly}
                  </button>
                </div>
                {Boolean(products.error) && (
                  <p role="alert">
                    {c.error}{" "}
                    <button type="button" onClick={products.reload}>
                      {c.retry}
                    </button>
                  </p>
                )}
                {onlySelected ? (
                  <div className="creation-product-list">
                    {ids.map((id) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked
                          onChange={() => setIds(ids.filter((x) => x !== id))}
                        />
                        <Box size={20} />
                        <span>{selected[id]}</span>
                      </label>
                    ))}
                  </div>
                ) : products.error ? null : !products.data ? (
                  <p role="status">{c.loading}</p>
                ) : products.data.items.length ? (
                  <div className="creation-product-list">
                    {products.data.items
                      .filter(
                        (p: Record<string, unknown>) => p.status !== "archived",
                      )
                      .map((p: { id: string; name: string; sku: string }) => (
                        <label key={p.id}>
                          <input
                            type="checkbox"
                            checked={ids.includes(p.id)}
                            disabled={!ids.includes(p.id) && ids.length >= 50}
                            onChange={(e) => {
                              setIds((old) =>
                                e.target.checked
                                  ? [...old, p.id]
                                  : old.filter((x) => x !== p.id),
                              );
                              setSelected((old) => ({
                                ...old,
                                [p.id]: p.name,
                              }));
                            }}
                          />
                          <Box size={20} />
                          <span>
                            {p.name}
                            <small>{p.sku}</small>
                          </span>
                        </label>
                      ))}
                  </div>
                ) : (
                  <div className="creation-empty">
                    <Box size={28} />
                    <p>{query ? c.none : c.noProducts}</p>
                    <Link
                      to="/products"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {c.addProducts}
                    </Link>
                  </div>
                )}
                {!onlySelected && (
                  <div className="creation-paging">
                    {cursor && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setCursor("")}
                      >
                        {c.first}
                      </button>
                    )}
                    {products.data?.hasMore && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setCursor(products.data.nextCursor)}
                      >
                        {c.more}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
            <footer className="creation-footer">
              {step === 1 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setStep(0)}
                >
                  {c.previous}
                </button>
              )}
              <button type="submit" className="primary">
                {busy ? c.creating : step === 0 ? c.next : c.create}
                <ArrowRight size={16} />
              </button>
            </footer>
          </fieldset>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      <aside className="creation-after">
        <Sparkles size={18} />
        <div>
          <strong>{c.nextTitle}</strong>
          <p>{c.nextSub}</p>
        </div>
      </aside>
    </div>
  );
}

export function SiteGuide({
  site,
  sources,
  pages,
  runs,
  locale,
  canEdit,
  busy,
  consent,
  setConsent,
  queue,
  setTab,
}: {
  site: Record<string, any>;
  sources?: Record<string, any>;
  pages?: Record<string, any>[];
  runs?: Record<string, any>[];
  locale: Locale;
  canEdit: boolean;
  busy: boolean;
  consent: boolean;
  setConsent: (v: boolean) => void;
  queue: (step: string) => Promise<void>;
  setTab: (tab: string) => void;
}) {
  const c = copy[locale],
    t = st(locale);
  if (!sources || !pages || !runs) return <p role="status">{c.wait}</p>;
  const hasSources = site.productIds.length > 0 || sources.facts.length > 0;
  const expected = site.plan?.nodes?.length ?? 0;
  const drafted = pages.filter((p) =>
    site.plan?.nodes.some((n: Record<string, any>) => n.key === p.nodeKey),
  );
  const approved = drafted.filter((p) => p.status === "approved").length;
  const stage = !hasSources
    ? 0
    : !site.planConfirmed
      ? 1
      : !expected || drafted.length < expected || approved < expected
        ? 2
        : 3;
  const pending = runs.find((r) => r.active);
  const last = runs[0];
  const actionable = last && ["failed", "paused"].includes(last.status);
  const planningDone = runs.some(
    (r) => r.step === "research" && r.status === "succeeded",
  );
  let action = c.start,
    target = "research";
  if (stage === 0) {
    action = c.settings;
    target = "settings";
  } else if (stage === 1 && planningDone) {
    action = c.viewPlan;
    target = "planning";
  } else if (stage === 2) {
    action = drafted.length < expected ? c.generate : c.review;
    target = drafted.length < expected ? "content" : "pages";
  } else if (stage === 3) {
    action = c.publish;
    target = "publishing";
  }
  if (pending) {
    action = c.working;
    target = "runs";
  } else if (actionable) {
    action = c.resumeRun;
    target = "runs";
  }
  const usesAi = ["research", "content"].includes(target);
  return (
    <section className="site-guide">
      <header>
        <span className="journey-eyebrow">
          <Sparkles size={15} />
          GlobalSite Agent
        </span>
        <h2>{c.guide}</h2>
        <p>{c.guideSub}</p>
      </header>
      <div className="guide-layout">
        <ol className="guide-steps">
          {[
            [c.prepare, c.prepareSub, "settings"],
            [c.planning, c.planningSub, "planning"],
            [c.writing, c.writingSub, "pages"],
            [c.preview, c.previewSub, "publishing"],
          ].map(([title, desc, tab], i) => (
            <li
              key={tab}
              className={
                i === stage ? "is-current" : i < stage ? "is-done" : ""
              }
            >
              <span className="guide-index">
                {i < stage ? <Check size={17} /> : i + 1}
              </span>
              <div>
                <span className="guide-step-state">
                  {i < stage ? c.done : i === stage ? c.current : c.later}
                </span>
                <h3>{title}</h3>
                <p>{desc}</p>
                <Link
                  to={
                    tab === "publishing"
                      ? "/sites/" + site.id + "/publishing"
                      : "?tab=" + tab
                  }
                >
                  {c.open}
                  <ArrowRight size={13} />
                </Link>
              </div>
            </li>
          ))}
        </ol>
        <aside className="guide-next">
          <Globe2 size={25} />
          <h3>{site.name}</h3>
          <p>{site.targetMarkets.join(", ")} · English</p>
          <dl>
            {[
              [c.data, site.productIds.length],
              [c.facts, sources.facts.length],
              [c.pages, drafted.length],
              [c.approved, approved],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {(pending || actionable) && (
            <p role="status">
              {t((pending ?? last).step)} · {t((pending ?? last).status)}
            </p>
          )}
          {canEdit && usesAi && (
            <label className="guide-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {c.consent}
            </label>
          )}
          {target === "publishing" ? (
            <Link
              className="button primary"
              to={"/sites/" + site.id + "/publishing"}
            >
              {action}
              <ArrowRight size={15} />
            </Link>
          ) : (
            <button
              disabled={busy || (usesAi && (!canEdit || !consent))}
              onClick={() => (usesAi ? void queue(target) : setTab(target))}
            >
              {action}
              <ArrowRight size={15} />
            </button>
          )}
          <p className="guide-hint">{pending ? c.taskHint : c.ready}</p>
          {actionable && (
            <div className="guide-sources">
              <Link to="/ai">{c.aiSettings}</Link>
              <Link to="/usage">{c.quota}</Link>
            </div>
          )}
          <div className="guide-sources">
            <Link to="?tab=business">{c.settings}</Link>
            <Link to="/facts?status=candidate">{c.confirmFacts}</Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
