import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileText,
  Globe2,
  Home,
  Inbox,
  Layers,
  Maximize2,
  Monitor,
  Package,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
} from "lucide-react";
import { api } from "./api";
import type { Locale } from "./i18n";
import { Badge } from "./ui/primitives";

type Row = Record<string, any>;

export function StudioMasthead({
  eyebrow,
  title,
  enTitle,
  subtitle,
  action,
  progress,
}: {
  eyebrow: string;
  title: string;
  enTitle: string;
  subtitle: string;
  action?: React.ReactNode;
  progress?: { label: string; pct: number };
}) {
  return (
    <header className="gs-studio-masthead">
      <div className="gs-studio-masthead-copy">
        <span className="gs-masthead-eyebrow">{eyebrow}</span>
        <h1>
          <span>{title}</span>
          <em>{enTitle}</em>
        </h1>
        <p>{subtitle}</p>
      </div>
      <div className="gs-studio-masthead-right">
        {progress && (
          <div className="gs-masthead-meter">
            <div className="gs-row-between">
              <span>
                <CheckCircle2 size={14} aria-hidden="true" /> {progress.label}
              </span>
              <strong>{progress.pct}%</strong>
            </div>
            <progress max={100} value={progress.pct} />
          </div>
        )}
        {action}
      </div>
    </header>
  );
}

const DEFAULT_BLUEPRINT = [
  {
    key: "home",
    titleZh: "首页",
    titleEn: "Home",
    descZh: "品牌价值主张 · 核心产品 · 解决方案",
    descEn: "Brand value proposition · Featured products",
    thumb: "/assets/studio/hero-arch.jpg",
  },
  {
    key: "products",
    titleZh: "产品中心",
    titleEn: "Products",
    descZh: "产品系列 · 规格参数 · 资料下载",
    descEn: "Catalog · Specs · Downloads",
    thumb: "/assets/studio/storefront-showcase.svg",
  },
  {
    key: "solutions",
    titleZh: "解决方案",
    titleEn: "Solutions",
    descZh: "商业空间 · 酒店 · 工程项目应用",
    descEn: "Hospitality · Commercial · OEM",
    thumb: "/assets/studio/hero-arch.jpg",
  },
  {
    key: "about",
    titleZh: "企业实力",
    titleEn: "About",
    descZh: "公司简介 · 资质认证 · 生产与定制",
    descEn: "Factory · Certifications · Quality",
    thumb: "/assets/studio/storefront-showcase.svg",
  },
  {
    key: "contact",
    titleZh: "联系我们",
    titleEn: "Contact",
    descZh: "询盘表单 · 获取资料 · 商务合作",
    descEn: "RFQ Form · Direct Channels",
    thumb: "/assets/studio/hero-arch.jpg",
  },
];

export function SiteBlueprintCanvas({
  site,
  pages,
  locale,
  mode,
  onSelectTab,
}: {
  site: Row;
  pages?: Row[];
  locale: Locale;
  mode: "strategy" | "tree";
  onSelectTab: (tab: string) => void;
}) {
  const zh = locale === "zh";
  const nodes: Row[] = site.plan?.nodes?.length
    ? site.plan.nodes
    : DEFAULT_BLUEPRINT.map((d) => ({
        key: d.key,
        title: zh ? d.titleZh : d.titleEn,
        path: d.key === "home" ? "/" : "/" + d.key,
        subtitle: zh ? d.descZh : d.descEn,
        enTitle: d.titleEn,
        thumb: d.thumb,
        isPreview: true,
      }));
  const [selectedKey, setSelectedKey] = useState(nodes[0]?.key ?? "home");
  const rootNode = nodes.find((n) => n.type === "home" || n.key === "home") ?? nodes[0];
  const childNodes = nodes.filter((n) => n.key !== rootNode?.key).slice(0, 6);
  const selectedNode = nodes.find((n) => n.key === selectedKey) ?? nodes[0];
  const matchedPage = (pages ?? []).find((p) => p.nodeKey === selectedNode?.key);

  if (mode === "tree") {
    return (
      <section className="gs-blueprint-card">
        <div className="gs-blueprint-tree">
          {/* Glowing Root Home Card */}
          <button
            type="button"
            className={
              "gs-tree-root" + (selectedNode?.key === rootNode?.key ? " is-selected" : "")
            }
            onClick={() => setSelectedKey(rootNode?.key ?? "home")}
          >
            <div className="gs-tree-root-visual">
              <img src="/assets/studio/hero-arch.jpg" alt="" />
            </div>
            <div className="gs-tree-root-meta">
              <Home size={14} aria-hidden="true" />
              <div>
                <strong>{rootNode?.title ?? (zh ? "首页" : "Home")}</strong>
                <span>{rootNode?.path ?? "/"}</span>
              </div>
            </div>
          </button>
          <div className="gs-tree-stem" aria-hidden="true" />
          <div className="gs-tree-children">
            {childNodes.map((n, idx) => {
              const p = (pages ?? []).find((x) => x.nodeKey === n.key);
              return (
                <button
                  key={n.key}
                  type="button"
                  className={
                    "gs-tree-child" + (selectedNode?.key === n.key ? " is-selected" : "")
                  }
                  onClick={() => setSelectedKey(n.key)}
                >
                  <div className="gs-tree-child-thumb">
                    <img
                      src={
                        idx % 2 === 0
                          ? "/assets/studio/hero-arch.jpg"
                          : "/assets/studio/storefront-showcase.svg"
                      }
                      alt=""
                    />
                  </div>
                  <div className="gs-tree-child-info">
                    <strong>{n.title}</strong>
                    <small>{n.path}</small>
                    {p && (
                      <span className={"gs-mini-dot " + (p.status === "approved" ? "is-ok" : "")} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Node Inspector */}
        {selectedNode && (
          <div className="gs-tree-inspector">
            <div className="gs-row-between">
              <div>
                <small className="muted">
                  {zh ? "当前选中页面" : "Selected node"} · {selectedNode.path}
                </small>
                <h3>{selectedNode.title}</h3>
              </div>
              <div className="gs-row">
                {matchedPage ? (
                  <Link className="gs-btn gs-btn-sm gs-btn-primary" to={"/pages/" + matchedPage.id}>
                    {zh ? "进入页面精修" : "Refine page"} <ArrowRight size={13} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="gs-btn gs-btn-sm"
                    onClick={() => onSelectTab("pages")}
                  >
                    {zh ? "去生成草稿" : "Go to pages"}
                  </button>
                )}
              </div>
            </div>
            <div className="gs-section-pills">
              {[
                ["Hero Banner", zh ? "品牌首屏与价值主张" : "Positioning & CTA"],
                ["Product Showcase", zh ? "核心产品与规格亮点" : "Products & Specs"],
                ["Evidence & Proof", zh ? "认证与企业事实背书" : "Facts & Certifications"],
                ["Inquiry CTA", zh ? "B2B 询盘转化入口" : "Buyer RFQ Conversion"],
              ].map(([code, label]) => (
                <div key={code} className="gs-section-row">
                  <Layers size={13} aria-hidden="true" />
                  <strong>{code}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="gs-stack">
      {/* Screen 1: Visual Site Architecture Timeline */}
      <section className="gs-card gs-arch-panel">
        <div className="gs-card-header">
          <h2 className="gs-card-title">
            {zh ? "网站结构规划" : "Site Architecture"}{" "}
            <em className="gs-inline-en">Site Architecture</em>
          </h2>
          <button
            type="button"
            className="gs-btn gs-btn-sm"
            onClick={() => onSelectTab("planning")}
          >
            <Check size={13} aria-hidden="true" />
            {site.planConfirmed
              ? zh
                ? "已确认结构"
                : "Plan confirmed"
              : zh
                ? "审阅结构"
                : "Review plan"}
          </button>
        </div>
        <ol className="gs-arch-list">
          {nodes.slice(0, 6).map((n, idx) => {
            const p = (pages ?? []).find((x) => x.nodeKey === n.key);
            const fallback = DEFAULT_BLUEPRINT[idx % DEFAULT_BLUEPRINT.length];
            return (
              <li key={n.key} className="gs-arch-row">
                <span className={"gs-arch-node-dot" + (p?.status === "approved" ? " is-done" : "")} />
                <div className="gs-arch-thumb">
                  <img
                    src={
                      idx % 2 === 0
                        ? "/assets/studio/hero-arch.jpg"
                        : "/assets/studio/storefront-showcase.svg"
                    }
                    alt=""
                  />
                </div>
                <div className="gs-arch-copy">
                  <strong>{n.title}</strong>
                  <small>{n.path}</small>
                  <span>
                    {n.subtitle ?? (zh ? fallback.descZh : fallback.descEn)}
                  </span>
                </div>
                {p ? (
                  <Link className="gs-btn gs-btn-sm" to={"/pages/" + p.id}>
                    {p.status === "approved"
                      ? zh
                        ? "已批准"
                        : "Approved"
                      : zh
                        ? "精修"
                        : "Edit"}
                  </Link>
                ) : (
                  <Badge tone="neutral">
                    {site.plan?.nodes?.length
                      ? zh
                        ? "待生成"
                        : "Planned"
                      : zh
                        ? "推荐节点"
                        : "Suggested"}
                  </Badge>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Screen 1 Bottom: Hero Concepts Strip */}
      <section className="gs-card gs-concepts-panel">
        <div className="gs-row-between">
          <h2 className="gs-card-title">
            {zh ? "首页 Hero 方案" : "Hero Concepts"}{" "}
            <em className="gs-inline-en">Hero Concepts</em>
          </h2>
          <button
            type="button"
            className="gs-btn gs-btn-sm gs-btn-ghost"
            onClick={() => onSelectTab("design")}
          >
            {zh ? "对比设计提案" : "Compare proposals"} <ArrowRight size={13} />
          </button>
        </div>
        <div className="gs-concepts-grid">
          {[
            {
              id: "A",
              label: zh ? "方案 A · 建筑空间 · 旗舰感" : "Concept A · Editorial Flagship",
              img: "/assets/studio/hero-arch.jpg",
              active: true,
            },
            {
              id: "B",
              label: zh ? "方案 B · 材质细节 · 专业感" : "Concept B · Material Craft",
              img: "/assets/studio/storefront-showcase.svg",
              active: false,
            },
            {
              id: "C",
              label: zh ? "方案 C · 应用场景 · 高转化" : "Concept C · Buyer Conversion",
              img: "/assets/studio/hero-arch.jpg",
              active: false,
            },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              className={"gs-concept-tile" + (c.active ? " is-active" : "")}
              onClick={() => onSelectTab("design")}
            >
              <div className="gs-concept-img">
                <img src={c.img} alt="" />
                {c.active && (
                  <span className="gs-concept-check" aria-hidden="true">
                    <Check size={12} />
                  </span>
                )}
              </div>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function SiteLiveInspector({
  site,
  sources,
  pages,
  runs,
  locale,
  mode,
}: {
  site: Row;
  sources?: Row;
  pages?: Row[];
  runs?: Row[];
  locale: Locale;
  mode: "strategy" | "tree";
}) {
  const zh = locale === "zh";
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [latestLead, setLatestLead] = useState<Row | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ items: Row[] }>(`/inquiries?siteId=${site.id}&limit=1`)
      .then((res) => {
        if (alive) setLatestLead(res.items?.[0] ?? null);
      })
      .catch(() => {
        if (alive) setLatestLead(null);
      });
    return () => {
      alive = false;
    };
  }, [site.id]);

  const products: Row[] = sources?.products ?? [];
  const facts: Row[] = sources?.facts ?? [];
  const planCount = site.plan?.nodes?.length ?? 0;
  const approvedCount = (pages ?? []).filter((p) => p.status === "approved").length;
  const completedSteps = [
    products.length > 0,
    Boolean(site.planConfirmed),
    (pages ?? []).length > 0,
    planCount > 0 && approvedCount === planCount,
    (runs ?? []).some((r) => r.step === "review" && r.status === "succeeded"),
  ].filter(Boolean).length;

  return (
    <aside className="gs-live-inspector">
      {/* Live Website Preview Card */}
      <section className="gs-card gs-live-preview-card">
        <div className="gs-row-between">
          <h2 className="gs-card-title">
            <Globe2 size={15} aria-hidden="true" />
            {zh ? "实时网站预览" : "Live Preview"}
            <em className="gs-inline-en">Live Preview</em>
          </h2>
          <div className="gs-viewport-bar">
            {(
              [
                ["desktop", Monitor, "Desktop"],
                ["tablet", Tablet, "Tablet"],
                ["mobile", Smartphone, "Mobile"],
              ] as const
            ).map(([k, Icon, label]) => (
              <button
                key={k}
                type="button"
                aria-label={label}
                aria-pressed={viewport === k}
                onClick={() => setViewport(k)}
              >
                <Icon size={13} />
              </button>
            ))}
            <Link
              to={"/sites/" + site.id + "/preview"}
              aria-label={zh ? "全屏预览" : "Full preview"}
              title={zh ? "全屏预览" : "Full preview"}
            >
              <Maximize2 size={13} />
            </Link>
          </div>
        </div>
        <div className={"gs-preview-stage is-" + viewport}>
          <div className="gs-preview-mock">
            <div className="gs-preview-nav">
              <strong>{site.name}</strong>
              <span>Products · Solutions · About · Contact</span>
            </div>
            <div className="gs-preview-hero">
              <h3>{site.name}</h3>
              <p>
                {site.businessBrief ||
                  (zh
                    ? "面向全球 B2B 买家的旗舰品牌独立站，结合企业事实与产品参数打造高转化采购体验。"
                    : "Flagship B2B export storefront crafted from verified company & product facts.")}
              </p>
              <div className="gs-preview-ctas">
                <span className="gs-mock-btn-light">Explore Products →</span>
                <span className="gs-mock-btn-ghost">Get a Quote</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {mode === "tree" ? (
        /* Screen 2 Right Bottom: Build Tasks Progress */
        <section className="gs-card">
          <div className="gs-row-between">
            <h2 className="gs-card-title">
              <Sparkles size={15} aria-hidden="true" />
              {zh ? "构建任务" : "Build Tasks"}
            </h2>
            <Badge tone="accent">{completedSteps} / 5</Badge>
          </div>
          <ol className="gs-build-tasks">
            {[
              { label: zh ? "企业与产品资料就绪" : "Products & facts ready", done: products.length > 0 },
              { label: zh ? "网站结构与栏目确认" : "Site blueprint confirmed", done: Boolean(site.planConfirmed) },
              { label: zh ? "页面内容草稿生成" : "Page content drafted", done: (pages ?? []).length > 0 },
              { label: zh ? "页面视觉精修与批准" : "Pages refined & approved", done: planCount > 0 && approvedCount === planCount },
              { label: zh ? "多端质检与上线准备" : "QA capture & launch", done: completedSteps === 5 },
            ].map((item, idx) => (
              <li key={item.label} className={item.done ? "is-done" : idx === completedSteps ? "is-active" : ""}>
                <span className="gs-task-bullet">
                  {item.done ? <Check size={11} /> : idx + 1}
                </span>
                <span>{item.label}</span>
                <small>
                  {item.done
                    ? zh
                      ? "已完成"
                      : "Done"
                    : idx === completedSteps
                      ? zh
                        ? "进行中"
                        : "Active"
                      : zh
                        ? "待执行"
                        : "Pending"}
                </small>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <>
          {/* Screen 1 Right Middle: Product Assets + Enterprise Facts Bento */}
          <div className="gs-grid-2">
            <section className="gs-card gs-card-tight">
              <div className="gs-row-between">
                <h3 className="gs-mini-title">
                  <Package size={14} aria-hidden="true" />
                  {zh ? "产品资产" : "Products"}
                </h3>
                <Link className="gs-mini-link" to="/products">
                  {zh ? "管理" : "Manage"} <ArrowUpRight size={12} />
                </Link>
              </div>
              <small className="muted">
                {zh ? `${products.length} 个产品已关联` : `${products.length} products linked`}
              </small>
              <div className="gs-mini-thumbs">
                {products.slice(0, 2).map((p) => (
                  <Link key={p.id} to={"/products/" + p.id} className="gs-mini-thumb-card">
                    <div className="gs-mini-thumb-art" />
                    <span>{p.name}</span>
                  </Link>
                ))}
                {!products.length && (
                  <Link to="/products/new" className="gs-mini-empty-link">
                    + {zh ? "添加首款产品" : "Add product"}
                  </Link>
                )}
              </div>
            </section>

            <section className="gs-card gs-card-tight">
              <div className="gs-row-between">
                <h3 className="gs-mini-title">
                  <ShieldCheck size={14} aria-hidden="true" />
                  {zh ? "企业事实" : "Facts"}
                </h3>
                <Link className="gs-mini-link" to="/facts">
                  {facts.length} <ArrowUpRight size={12} />
                </Link>
              </div>
              <ul className="gs-fact-checks">
                {facts.length ? (
                  facts.slice(0, 4).map((f) => (
                    <li key={f.id}>
                      <Check size={12} aria-hidden="true" />
                      <span>
                        {f.value}
                        {f.unit ? " " + f.unit : ""}
                      </span>
                    </li>
                  ))
                ) : (
                  <>
                    <li>
                      <Check size={12} aria-hidden="true" />
                      <span>{site.targetMarkets?.join(" · ") || "Global B2B"}</span>
                    </li>
                    <li>
                      <FileText size={12} aria-hidden="true" />
                      <Link to="/facts">{zh ? "去确认企业与产品事实" : "Confirm company facts"}</Link>
                    </li>
                  </>
                )}
              </ul>
            </section>
          </div>

          {/* Screen 1 Right Bottom: Inquiry Insights */}
          <section className="gs-card gs-card-tight gs-inquiry-insight">
            <div className="gs-row-between">
              <h3 className="gs-mini-title">
                <Inbox size={14} aria-hidden="true" />
                {zh ? "询盘洞察" : "Inquiry Insights"}
              </h3>
              <Link className="gs-btn gs-btn-sm" to="/inquiries">
                {zh ? "查看全部询盘" : "All leads"} <ArrowRight size={12} />
              </Link>
            </div>
            {latestLead ? (
              <Link to={"/inquiries/" + latestLead.id} className="gs-lead-pill-row">
                <span className="gs-lead-avatar">
                  {(latestLead.contact?.name ?? "B").slice(0, 1).toUpperCase()}
                </span>
                <div className="gs-lead-copy">
                  <strong>{latestLead.contact?.name}</strong>
                  <span>{latestLead.message}</span>
                </div>
              </Link>
            ) : (
              <p className="muted">
                {zh
                  ? "站点发布上线并启用询盘表单后，全球买家线索将实时同步至此。"
                  : "Buyer inquiries will stream here once your site is live."}
              </p>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

export function LaunchWorkflowDock({
  site,
  pages,
  locale,
  activeStageKey,
  onSelectStage,
}: {
  site: Row;
  pages?: Row[];
  locale: Locale;
  activeStageKey: string;
  onSelectStage: (stageKey: string) => void;
}) {
  const zh = locale === "zh";
  const planCount = site.plan?.nodes?.length ?? 0;
  const approvedCount = (pages ?? []).filter((p) => p.status === "approved").length;

  const steps = [
    {
      key: "prep",
      num: 1,
      zh: "策略规划",
      en: "Strategy",
      done: (site.productIds?.length ?? 0) > 0,
    },
    {
      key: "blueprint",
      num: 2,
      zh: "内容与结构",
      en: "Structure",
      done: Boolean(site.planConfirmed),
    },
    {
      key: "craft",
      num: 3,
      zh: "生成与优化",
      en: "Generate & Refine",
      done: planCount > 0 && approvedCount === planCount,
    },
    {
      key: "launch",
      num: 4,
      zh: "审阅与上线",
      en: "Review & Launch",
      done: false,
    },
  ];

  return (
    <footer className="gs-launch-dock" aria-label={zh ? "网站生成与上线流程" : "Launch workflow"}>
      <div className="gs-dock-brand">
        <strong>{zh ? "网站生成与上线流程" : "Launch Workflow"}</strong>
        <small>{zh ? "Launch Workflow" : "4-stage export launch"}</small>
      </div>
      <div className="gs-dock-steps">
        {steps.map((s) => {
          const isActive = activeStageKey === s.key;
          return (
            <button
              key={s.key}
              type="button"
              className={
                "gs-dock-step" +
                (isActive ? " is-active" : "") +
                (s.done ? " is-done" : "")
              }
              onClick={() => onSelectStage(s.key)}
            >
              <span className="gs-dock-badge">
                {s.done && !isActive ? <Check size={12} /> : s.num}
              </span>
              <span className="gs-dock-text">
                <strong>{zh ? s.zh : s.en}</strong>
                <small>{zh ? s.en : `Step ${s.num}`}</small>
              </span>
            </button>
          );
        })}
      </div>
      <Link
        className="gs-btn gs-btn-primary"
        to={"/sites/" + site.id + "/preview"}
      >
        {zh ? "预览上线版本" : "Preview site"}
        <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
    </footer>
  );
}
