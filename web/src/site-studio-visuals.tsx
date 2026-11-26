import { useEffect, useState } from "react";
import { trustedPreview } from "./trusted-preview";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileText,
  Globe2,
  GripVertical,
  Home,
  Inbox,
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
import { orderedNodes } from "./site-plan";
import { st } from "./sites-i18n";
import { Badge } from "./ui/primitives";

type Row = Record<string, any>;

function pageMark(page: Row | undefined, zh: boolean) {
  if (!page) return zh ? "待生成" : "Planned";
  if (page.status === "approved") return zh ? "已批准" : "Approved";
  if (page.status === "blocked") return zh ? "待补资料" : "Needs facts";
  return zh ? "草稿" : "Draft";
}

function pageState(page: Row | undefined) {
  if (!page) return "planned";
  if (page.status === "approved") return "approved";
  if (page.status === "blocked") return "blocked";
  return "draft";
}

function linkParents(nodes: Row[], homeKey: string) {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const links = new Map<string, string | null>();
  for (const node of nodes) {
    if (node.key === homeKey) {
      links.set(node.key, null);
      continue;
    }
    const explicit = node.parentKey ? byKey.get(node.parentKey) : undefined;
    if (explicit && explicit.key !== homeKey && explicit.key !== node.key) {
      links.set(node.key, explicit.key);
      continue;
    }
    const path = String(node.path || "/").replace(/\/$/, "") || "/";
    let best: Row | undefined;
    let bestLength = 0;
    for (const other of nodes) {
      if (other.key === node.key || other.key === homeKey) continue;
      const prefix = String(other.path || "/").replace(/\/$/, "");
      if (!prefix || prefix === "/" || !path.startsWith(prefix + "/")) continue;
      if (prefix.length > bestLength) {
        best = other;
        bestLength = prefix.length;
      }
    }
    links.set(node.key, best?.key ?? homeKey);
  }
  return links;
}

function pickNodeThumb(
  page: Row | undefined,
  assetById: Map<string, Row>,
  idx: number,
) {
  if (page?.blocks?.length) {
    for (const b of page.blocks) {
      if (b.assetId && assetById.has(b.assetId)) {
        const a = assetById.get(b.assetId)!;
        if (a.mime?.startsWith("image/")) return a.thumbnailUrl ?? a.url;
      }
      if (Array.isArray(b.items)) {
        for (const it of b.items) {
          if (it.assetId && assetById.has(it.assetId)) {
            const a = assetById.get(it.assetId)!;
            if (a.mime?.startsWith("image/")) return a.thumbnailUrl ?? a.url;
          }
        }
      }
    }
  }
  return idx % 2 === 0
    ? "/assets/studio/hero-arch.jpg"
    : "/assets/studio/storefront-showcase.svg";
}

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
  },
  {
    key: "products",
    titleZh: "产品中心",
    titleEn: "Products",
    descZh: "产品系列 · 规格参数 · 资料下载",
    descEn: "Catalog · Specs · Downloads",
  },
  {
    key: "solutions",
    titleZh: "解决方案",
    titleEn: "Solutions",
    descZh: "商业空间 · 酒店 · 工程项目应用",
    descEn: "Hospitality · Commercial · OEM",
  },
  {
    key: "about",
    titleZh: "企业实力",
    titleEn: "About",
    descZh: "公司简介 · 资质认证 · 生产与定制",
    descEn: "Factory · Certifications · Quality",
  },
  {
    key: "contact",
    titleZh: "联系我们",
    titleEn: "Contact",
    descZh: "询盘表单 · 获取资料 · 商务合作",
    descEn: "RFQ Form · Direct Channels",
  },
];

export function SiteBlueprintCanvas({
  site,
  pages,
  locale,
  mode,
  directions = [],
  selectedDirection,
  assets = [],
  onSelectTab,
  onFocus,
}: {
  site: Row;
  pages?: Row[];
  locale: Locale;
  mode: "strategy" | "tree";
  directions?: Row[];
  selectedDirection?: string;
  assets?: Row[];
  onSelectTab: (tab: string) => void;
  onFocus?: (pageId: string | null) => void;
}) {
  const zh = locale === "zh";
  const hasRealPlan = Boolean(site.plan?.nodes?.length);
  const rawNodes: Row[] = hasRealPlan
    ? site.plan.nodes
    : DEFAULT_BLUEPRINT.map((d) => ({
        key: d.key,
        title: zh ? d.titleZh : d.titleEn,
        path: d.key === "home" ? "/" : "/" + d.key,
        subtitle: zh ? d.descZh : d.descEn,
        isSuggested: true,
      }));
  const [selectedKey, setSelectedKey] = useState(rawNodes[0]?.key ?? "home");
  const rootNode =
    rawNodes.find((n) => n.type === "home" || n.key === "home" || n.path === "/") ??
    rawNodes[0];
  const ordered = hasRealPlan ? orderedNodes(rawNodes) : rawNodes;
  const links = linkParents(ordered, rootNode?.key ?? "");
  const topNodes = ordered.filter((node) => links.get(node.key) === rootNode?.key);
  const selectedNode =
    ordered.find((n) => n.key === selectedKey) ?? rootNode ?? ordered[0];
  const matchedPage = (pages ?? []).find((p) => p.nodeKey === selectedNode?.key);
  const sections: Row[] = matchedPage?.blocks ?? [];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  useEffect(() => {
    onFocus?.(matchedPage?.id ?? null);
  }, [matchedPage?.id, selectedNode?.key, onFocus]);

  if (mode === "tree") {
    const labelFor = (block: Row) => {
      const type = String(block.type || "");
      const named = st(locale)(type);
      if (named !== type) return named;
      const lower = st(locale)(type.toLowerCase());
      return lower !== type.toLowerCase() ? lower : type || String(block.key || "");
    };
    const rootPage = (pages ?? []).find((p) => p.nodeKey === rootNode?.key);
    const selectedIdx = Math.max(
      0,
      ordered.findIndex((n) => n.key === selectedNode?.key),
    );

    return (
      <section className="gs-blueprint-card">
        {/* Visual Org-Chart Blueprint Tree (Screen 2) */}
        <div className="gs-blueprint-tree">
          {rootNode && (
            <button
              type="button"
              className={
                "gs-tree-root" +
                (selectedNode?.key === rootNode.key ? " is-selected" : "")
              }
              aria-pressed={selectedNode?.key === rootNode.key}
              onClick={() => setSelectedKey(rootNode.key)}
            >
              <div className="gs-tree-root-visual">
                <img src={pickNodeThumb(rootPage, assetById, 0)} alt="" />
              </div>
              <div className="gs-tree-root-meta">
                <Home size={14} aria-hidden="true" />
                <div>
                  <strong>{rootNode.title}</strong>
                  <span>{rootNode.path}</span>
                </div>
                <span
                  className={"gs-sitemap-dot is-" + pageState(rootPage)}
                  title={pageMark(rootPage, zh)}
                />
              </div>
            </button>
          )}
          {topNodes.length > 0 && (
            <>
              <div className="gs-tree-stem" aria-hidden="true" />
              <div className="gs-tree-children">
                {topNodes.map((node, idx) => {
                  const p = (pages ?? []).find((x) => x.nodeKey === node.key);
                  const kids = ordered.filter(
                    (child) => links.get(child.key) === node.key,
                  );
                  const isBranchSelected =
                    selectedNode?.key === node.key ||
                    kids.some((k) => k.key === selectedNode?.key);
                  return (
                    <div
                      key={node.key}
                      className={
                        "gs-tree-pillar" + (isBranchSelected ? " is-selected" : "")
                      }
                    >
                      <button
                        type="button"
                        className="gs-tree-child"
                        aria-pressed={selectedNode?.key === node.key}
                        onClick={() => setSelectedKey(node.key)}
                      >
                        <div className="gs-tree-child-thumb">
                          <img src={pickNodeThumb(p, assetById, idx + 1)} alt="" />
                        </div>
                        <div className="gs-tree-child-info">
                          <div className="gs-row-between">
                            <strong>{node.title}</strong>
                            <span
                              className={"gs-sitemap-dot is-" + pageState(p)}
                              title={pageMark(p, zh)}
                            />
                          </div>
                          <small>{node.path}</small>
                        </div>
                      </button>
                      {kids.length > 0 && (
                        <div className="gs-tree-subchips">
                          {kids.map((kid) => {
                            const kp = (pages ?? []).find(
                              (x) => x.nodeKey === kid.key,
                            );
                            return (
                              <button
                                key={kid.key}
                                type="button"
                                className={
                                  "gs-tree-subchip" +
                                  (selectedNode?.key === kid.key
                                    ? " is-selected"
                                    : "")
                                }
                                onClick={() => setSelectedKey(kid.key)}
                              >
                                <span
                                  className={"gs-sitemap-dot is-" + pageState(kp)}
                                />
                                <span>{kid.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Selected Node Section Inspector (Screen 2 Bottom) */}
        {selectedNode && (
          <div className="gs-tree-inspector">
            <div className="gs-row-between">
              <div>
                <small className="muted">
                  {zh ? "当前页面" : "Current page"} · {selectedNode.path}
                </small>
                <h3>{selectedNode.title}</h3>
              </div>
              <div className="gs-row">
                {matchedPage ? (
                  <Link
                    className="gs-btn gs-btn-sm gs-btn-primary"
                    to={"/pages/" + matchedPage.id}
                  >
                    {zh ? "进入页面精修" : "Refine page"} <ArrowRight size={13} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="gs-btn gs-btn-sm"
                    onClick={() => onSelectTab("pages")}
                  >
                    {zh ? "去生成页面草稿" : "Generate page draft"}
                  </button>
                )}
              </div>
            </div>

            <div className="gs-inspector-split">
              <div className="gs-inspector-mini-card">
                <img
                  src={pickNodeThumb(matchedPage, assetById, selectedIdx)}
                  alt=""
                />
                <span>{pageMark(matchedPage, zh)}</span>
              </div>
              <div className="gs-stack-sm">
                <strong className="gs-sub-heading">
                  {zh ? "页面结构 (Section)" : "Page Sections"}
                </strong>
                {sections.length ? (
                  <div className="gs-section-stack">
                    {sections.map((block: Row, index: number) => {
                      const label = labelFor(block);
                      const heading = String(block.heading || "").trim();
                      return (
                        <div key={block.key ?? index} className="gs-section-row">
                          <GripVertical size={13} aria-hidden="true" />
                          <strong>{heading || label}</strong>
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted">
                    {matchedPage
                      ? zh
                        ? "当前页面尚未添加区块，进入「页面精修」后即可拖拽编排真实模块。"
                        : "No blocks yet. Open Page Studio to compose live sections."
                      : zh
                        ? "尚未生成该页草稿。请确认站点结构后运行「生成全站页面内容」。"
                        : "No page draft yet. Confirm the blueprint and run content generation."}
                  </p>
                )}
              </div>
              <div className="gs-highlights-box">
                <strong className="gs-sub-heading">
                  <Sparkles size={13} aria-hidden="true" />
                  {zh ? "页面要点" : "Page Highlights"}
                </strong>
                <ul className="gs-fact-checks">
                  <li>
                    <Check size={12} aria-hidden="true" />
                    <span>
                      {zh
                        ? `状态：${pageMark(matchedPage, true)}`
                        : `Status: ${pageMark(matchedPage, false)}`}
                    </span>
                  </li>
                  <li>
                    <Check size={12} aria-hidden="true" />
                    <span>
                      {zh
                        ? `真实区块：${sections.length} 个`
                        : `Live sections: ${sections.length}`}
                    </span>
                  </li>
                  <li>
                    <Check size={12} aria-hidden="true" />
                    <span>
                      {zh
                        ? `事实校验问题：${matchedPage?.issues?.length ?? 0} 项`
                        : `Fact issues: ${matchedPage?.issues?.length ?? 0}`}
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  // Screen 1: Visual Site Architecture Timeline + Hero Concepts
  return (
    <div className="gs-stack">
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
          {ordered.slice(0, 6).map((n, idx) => {
            const p = (pages ?? []).find((x) => x.nodeKey === n.key);
            return (
              <li
                key={n.key}
                className={
                  "gs-arch-row" +
                  (selectedNode?.key === n.key ? " is-selected" : "")
                }
                onClick={() => setSelectedKey(n.key)}
              >
                <span
                  className={
                    "gs-arch-node-dot" +
                    (p?.status === "approved" ? " is-done" : "")
                  }
                />
                <div className="gs-arch-thumb">
                  <img src={pickNodeThumb(p, assetById, idx)} alt="" />
                </div>
                <div className="gs-arch-copy">
                  <strong>{n.title}</strong>
                  <small>{n.path}</small>
                  <span>
                    {p
                      ? `${p.blocks?.length ?? 0} ${zh ? "个真实区块" : "blocks"} · ${pageMark(p, zh)}`
                      : n.subtitle || n.intent || (zh ? "待生成草稿" : "Planned")}
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
                        : "Refine"}
                  </Link>
                ) : (
                  <Badge tone="neutral">
                    {hasRealPlan
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

      {/* Screen 1 Bottom: Hero Concepts Visual Strip */}
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
          {directions.length ? (
            directions.slice(0, 3).map((direction, idx) => {
              const active = selectedDirection === direction.key;
              return (
                <button
                  key={direction.key}
                  type="button"
                  className={"gs-concept-tile" + (active ? " is-active" : "")}
                  onClick={() => onSelectTab("design")}
                >
                  <div className="gs-concept-img">
                    <img
                      src={
                        idx % 2 === 0
                          ? "/assets/studio/hero-arch.jpg"
                          : "/assets/studio/storefront-showcase.svg"
                      }
                      alt=""
                    />
                    {active && (
                      <span className="gs-concept-check" aria-hidden="true">
                        <Check size={12} />
                      </span>
                    )}
                  </div>
                  <span>{direction.label || direction.key}</span>
                </button>
              );
            })
          ) : (
            [
              {
                id: "A",
                label: zh ? "方案 A · 建筑空间 · 旗舰感" : "Concept A · Architectural Flagship",
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
            ))
          )}
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
  focusPageId,
  assets = [],
}: {
  site: Row;
  sources?: Row;
  pages?: Row[];
  runs?: Row[];
  locale: Locale;
  mode: "strategy" | "tree";
  focusPageId?: string | null;
  assets?: Row[];
}) {
  const zh = locale === "zh";
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [latestLead, setLatestLead] = useState<Row | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "empty" | "failed"
  >("idle");

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

  const previewPage =
    (focusPageId
      ? (pages ?? []).find((page) => page.id === focusPageId)
      : undefined) ??
    (pages ?? []).find((p) => p.type === "home" || p.path === "/") ??
    (pages ?? [])[0];

  useEffect(() => {
    if (!previewPage?.id) {
      setPreviewHtml("");
      setPreviewState("empty");
      return;
    }
    let alive = true;
    setPreviewState("loading");
    api<{ html?: string }>("/pages/" + previewPage.id + "/preview")
      .then((res) => {
        if (!alive) return;
        if (res.html) {
          setPreviewHtml(res.html);
          setPreviewState("ready");
        } else {
          setPreviewHtml("");
          setPreviewState("failed");
        }
      })
      .catch(() => {
        if (!alive) return;
        setPreviewHtml("");
        setPreviewState("failed");
      });
    return () => {
      alive = false;
    };
  }, [previewPage?.id]);

  const products: Row[] = sources?.products ?? [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
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
              to={
                previewPage
                  ? "/pages/" + previewPage.id
                  : "/sites/" + site.id + "/preview"
              }
              aria-label={zh ? "全屏精修预览" : "Open full preview"}
              title={zh ? "全屏精修预览" : "Open full preview"}
            >
              <Maximize2 size={13} />
            </Link>
          </div>
        </div>
        <div className={"gs-preview-stage is-" + viewport}>
          {previewState === "ready" && previewHtml ? (
            <div className={"gs-preview-scale-wrap is-" + viewport}>
              <iframe
                title={zh ? "当前页面预览" : "Current page preview"}
                sandbox="allow-same-origin"
                srcDoc={trustedPreview(previewHtml)}
                className="gs-live-frame"
              />
            </div>
          ) : (
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
          )}
        </div>
        {previewPage && (
          <div className="gs-row-between gs-preview-foot">
            <small className="muted">
              {previewPage.title} · {previewPage.path}
            </small>
            <Link className="gs-mini-link" to={"/pages/" + previewPage.id}>
              {zh ? "进入精修" : "Refine"} <ArrowUpRight size={12} />
            </Link>
          </div>
        )}
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
              {
                label: zh ? "企业与产品资料就绪" : "Products & facts ready",
                done: products.length > 0,
              },
              {
                label: zh ? "网站结构与栏目确认" : "Site blueprint confirmed",
                done: Boolean(site.planConfirmed),
              },
              {
                label: zh ? "页面内容草稿生成" : "Page content drafted",
                done: (pages ?? []).length > 0,
              },
              {
                label: zh ? "页面视觉精修与批准" : "Pages refined & approved",
                done: planCount > 0 && approvedCount === planCount,
              },
              {
                label: zh ? "多端质检与上线准备" : "QA capture & launch",
                done: completedSteps === 5,
              },
            ].map((item, idx) => (
              <li
                key={item.label}
                className={
                  item.done ? "is-done" : idx === completedSteps ? "is-active" : ""
                }
              >
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
                  {zh ? "同步" : "Sync"} <ArrowUpRight size={12} />
                </Link>
              </div>
              <small className="muted">
                {zh
                  ? `${products.length} 个产品已同步`
                  : `${products.length} products linked`}
              </small>
              <div className="gs-mini-thumbs">
                {products.slice(0, 2).map((p) => {
                  const asset = p.assetIds?.[0]
                    ? assetById.get(p.assetIds[0])
                    : undefined;
                  return (
                    <Link
                      key={p.id}
                      to={"/products/" + p.id}
                      className="gs-mini-thumb-card"
                    >
                      {asset?.thumbnailUrl || asset?.url ? (
                        <img
                          className="gs-mini-thumb-img"
                          src={asset.thumbnailUrl ?? asset.url}
                          alt=""
                        />
                      ) : (
                        <div className="gs-mini-thumb-art" />
                      )}
                      <span>{p.name}</span>
                    </Link>
                  );
                })}
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
                      <Link to="/facts">
                        {zh ? "去确认企业与产品事实" : "Confirm company facts"}
                      </Link>
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
                <svg
                  className="gs-lead-wave"
                  viewBox="0 0 80 28"
                  aria-hidden="true"
                >
                  <path
                    d="M2,18 Q14,4 26,16 T52,14 T78,10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
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
    <footer
      className="gs-launch-dock"
      aria-label={zh ? "网站生成与上线流程" : "Launch workflow"}
    >
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
