import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Layers,
  Monitor,
  Plus,
  Redo2,
  RefreshCw,
  Smartphone,
  Sparkles,
  Tablet,
  Undo2,
} from "lucide-react";
import { api } from "../api";
import { trustedPreview } from "../trusted-preview";
import { rememberPage } from "../current-site";
import { diffPageDraft } from "../page-diff";
import { st, siteMessages } from "../sites-i18n";
import {
  Badge,
  Frame,
  Notice,
  split,
  useAction,
  useLoad,
  type Props,
  type Row,
  type T,
} from "./shared";
import { IssueList, RefPicker } from "./SiteHelpers";

export function PageReview({ locale, role }: Props) {
  const { id } = useParams(),
    load = useLoad("/pages/" + id),
    t = st(locale);
  if (!load.data)
    return (
      <Frame title={t("editPage")} t={t} error={load.error}>
        <p>{t("loading")}</p>
      </Frame>
    );
  return (
    <PageEditor
      key={load.data.revision}
      page={load.data}
      locale={locale}
      t={t}
      role={role}
      reload={load.reload}
    />
  );
}
function PageEditor({
  page,
  locale,
  t,
  role,
  reload,
}: {
  page: Row;
  locale: Props["locale"];
  t: T;
  role: Props["role"];
  reload: () => void;
}) {
  const [data, setData] = useState<Row>({
      title: page.title,
      metaDescription: page.metaDescription,
      ...(page.presentation ? { presentation: page.presentation } : {}),
      refs: page.refs,
      blocks: page.blocks,
    }),
    [history, setHistory] = useState<{ past: Row[]; future: Row[] }>({
      past: [],
      future: [],
    }),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(""),
    [splitOpen, setSplitOpen] = useState(true),
    [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop"),
    [liveHtml, setLiveHtml] = useState(""),
    [liveIssues, setLiveIssues] = useState<Row[] | null>(null),
    [previewSyncing, setPreviewSyncing] = useState(false),
    [previewNonce, setPreviewNonce] = useState(0),
    [dragKey, setDragKey] = useState<string | null>(null),
    [editingBlock, setEditingBlock] = useState<string>(
      page.blocks[0]?.key ?? "",
    ),
    [inspector, setInspector] = useState<"content" | "style" | "seo" | "review">(
      "content",
    ),
    siblings = useLoad("/sites/" + page.siteId + "/pages"),
    [shotBrief, setShotBrief] = useState(
      [
        page.presentation?.headline ?? page.title,
        page.presentation?.designNotes,
      ]
        .filter(Boolean)
        .join(". ")
        .slice(0, 600),
    ),
    [candidate, setCandidate] = useState(""),
    imageConnection = useLoad(
      role !== "viewer" ? "/assets/image-provider" : null,
    ),
    [mobile, setMobile] = useState(false),
    [consent, setConsent] = useState(false),
    [instructions, setInstructions] = useState(""),
    [reason, setReason] = useState(""),
    [job, setJob] = useState<string>(),
    sources = useLoad("/sites/" + page.siteId + "/sources"),
    assets = useLoad("/assets?limit=100"),
    run = useLoad(job ? "/agent-runs/" + job : null, true),
    a = useAction(),
    canEdit = role !== "viewer";
  useEffect(() => {
    rememberPage(page.siteId, page.id);
  }, [page.siteId]);
  useEffect(() => {
    if (
      run.data &&
      ["succeeded", "cancelled", "failed", "paused"].includes(run.data.status)
    ) {
      if (run.data.status === "succeeded") reload();
    }
  }, [run.data?.status]);
  useEffect(() => {
    let active = true;
    void api("/pages/" + page.id + "/preview")
      .then((res) => {
        if (active && res?.html) setLiveHtml((prev) => prev || res.html);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [page.id]);
  useEffect(() => {
    if (!splitOpen) return;
    let active = true;
    const timer = setTimeout(() => {
      setPreviewSyncing(true);
      const req = canEdit
        ? api("/pages/" + page.id + "/preview-draft", "POST", data)
        : api("/pages/" + page.id + "/preview");
      void req
        .then((res) => {
          if (!active) return;
          setLiveHtml(res.html);
          setLiveIssues(res.issues ?? []);
        })
        .catch(() => {
          if (!active) return;
          void api("/pages/" + page.id + "/preview")
            .then((fallback) => {
              if (active && fallback?.html) setLiveHtml((prev) => prev || fallback.html);
            })
            .catch(() => undefined);
        })
        .finally(() => {
          if (active) setPreviewSyncing(false);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [splitOpen, data, page.id, canEdit, previewNonce]);
  const update = (patch: Row) => {
    setDirty(true);
    setData((old: Row) => {
      setHistory((h) => ({ past: [...h.past.slice(-29), old], future: [] }));
      return { ...old, ...patch };
    });
  };
  const undo = () => {
    if (!history.past.length) return;
    const previous = history.past[history.past.length - 1];
    setHistory((h) => ({
      past: h.past.slice(0, -1),
      future: [data, ...h.future.slice(0, 29)],
    }));
    setData(previous);
    setDirty(true);
  };
  const redo = () => {
    if (!history.future.length) return;
    const next = history.future[0];
    setHistory((h) => ({
      past: [...h.past.slice(-29), data],
      future: h.future.slice(1),
    }));
    setData(next);
    setDirty(true);
  };
  const moveBlock = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex === toIndex ||
      toIndex < 0 ||
      toIndex >= data.blocks.length
    )
      return;
    const next = [...data.blocks];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    update({ blocks: next });
  };
  const blockUpdate = (key: string, patch: Row) =>
    update({
      blocks: data.blocks.map((b: Row) =>
        b.key === key ? { ...b, ...patch } : b,
      ),
    });
  const displayedIssues = liveIssues ?? page.issues;
  const draftChanges = diffPageDraft(
    {
      title: page.title,
      metaDescription: page.metaDescription,
      ...(page.presentation ? { presentation: page.presentation } : {}),
      refs: page.refs,
      blocks: page.blocks,
    },
    data,
  );
  const selectedBlock = data.blocks.some((b: Row) => b.key === editingBlock)
    ? editingBlock
    : data.blocks[0]?.key;
  const locked = a.busy || !!(job && run.data?.active);
  const zh = locale === "zh";
  const pageDisplayName =
    data.presentation?.navigationLabel || page.presentation?.navigationLabel || page.title;
  const aiPresets = [
    {
      title: zh ? "优化首屏主标题与价值主张" : "Sharpen hero headline & value",
      sub: zh ? "强化 B2B 专业表达与采购信任感" : "Elevate B2B buyer clarity",
      prompt: t("rewriteChipValue"),
    },
    {
      title: zh ? "精炼核心卖点与段落层次" : "Tighten section hierarchy",
      sub: zh ? "去除冗余套话，突出可验证优势" : "Remove fluff & surface proof",
      prompt: t("rewriteChipConcise"),
    },
    {
      title: zh ? "强化询盘引导与采购路径" : "Strengthen B2B inquiry guidance",
      sub: zh ? "清晰指引样本、规格核对与报价请求" : "Clarify sample & RFQ conversion",
      prompt: t("rewriteChipGuidance"),
    },
  ];
  const saveDraft = () =>
    void a.run(async () => {
      await api("/pages/" + page.id, "PATCH", {
        revision: page.revision,
        data,
      });
      reload();
    });
  const addNewBlock = () => {
    const key = "section-" + crypto.randomUUID().slice(0, 8);
    setEditingBlock(key);
    setInspector("content");
    update({
      blocks: [
        ...data.blocks,
        {
          key,
          type: "text",
          heading: "",
          body: "",
          table: null,
          faq: [],
          assetId: null,
          alt: "",
          refs: [],
        },
      ],
    });
  };
  return (
    <div className="catalog gs-refine-shell">
      {/* Screen 3: Framer / Webflow Dedicated Top Editor Bar */}
      <header className="gs-refine-bar">
        <div className="gs-refine-bar-left">
          <Link
            className="gs-refine-back"
            to={"/sites/" + page.siteId + "?tab=planning"}
            aria-label={t("sites")}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span>{zh ? "返回蓝图" : "Blueprint"}</span>
          </Link>
          <span className="gs-refine-sep" aria-hidden="true">/</span>
          <div className="gs-refine-crumbs">
            <strong>{zh ? "页面精修" : t("editPage")}</strong>
            <em className="gs-inline-en">Page Refinement</em>
            <span className="gs-refine-path">{page.path}</span>
          </div>
          <Badge status={page.status} t={t} />
        </div>
        <div className="gs-refine-bar-right">
          {draftChanges.length > 0 && (
            <span className="gs-badge gs-badge-warn">
              {t("unsavedChanges")} ({draftChanges.length})
            </span>
          )}
          {canEdit && (
            <div className="gs-refine-history">
              <button
                type="button"
                className="gs-icon-btn"
                title={t("undo")}
                aria-label={t("undo")}
                disabled={!history.past.length || locked}
                onClick={undo}
              >
                <Undo2 size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="gs-icon-btn"
                title={t("redo")}
                aria-label={t("redo")}
                disabled={!history.future.length || locked}
                onClick={redo}
              >
                <Redo2 size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          {canEdit && (
            <button
              type="button"
              className="gs-btn gs-btn-sm"
              disabled={locked || !dirty}
              onClick={saveDraft}
            >
              {dirty ? t("save") : t("saved")}
            </button>
          )}
          {role === "admin" ? (
            <button
              type="button"
              className="gs-btn gs-btn-sm gs-btn-primary"
              disabled={locked || dirty || page.issues.length > 0}
              title={
                dirty
                  ? t("saveBefore")
                  : page.issues.length > 0
                    ? t("needsEvidence")
                    : t("approve")
              }
              onClick={() =>
                void a.run(async () => {
                  await api("/pages/" + page.id + "/approve", "POST", {
                    revision: page.revision,
                    reason,
                  });
                  reload();
                })
              }
            >
              <Check size={14} aria-hidden="true" />
              {zh ? "批准页面" : t("approve")}
            </button>
          ) : (
            <button
              type="button"
              className="gs-btn gs-btn-sm gs-btn-primary"
              onClick={() => setInspector("review")}
            >
              {t("pageReview")}
            </button>
          )}
        </div>
      </header>

      <Notice t={t} error={sources.error ?? a.error} saved={a.saved} />
      {draftChanges.length > 0 && (
        <details className="studio-diff-box">
          <summary>
            {t("unsavedChanges")} ({draftChanges.length})
          </summary>
          <ul>
            {draftChanges.map((item, idx) => (
              <li key={idx}>
                <strong>
                  {t(
                    item.kind === "meta"
                      ? "diffMeta"
                      : item.kind === "presentation"
                        ? "diffPresentation"
                        : item.kind === "block-added"
                          ? "diffAdded"
                          : item.kind === "block-removed"
                            ? "diffRemoved"
                            : item.kind === "block-moved"
                              ? "diffMoved"
                              : "diffEdited",
                  )}
                </strong>
                <span>
                  {item.target}
                  {item.detail ? " · " + item.detail : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 3-Pane Framer Studio: Left AI+Layers | Center Live Hero Canvas | Right Properties */}
      <div className="gs-refine-3pane">
        {/* LEFT PANE: AI Suggestions + Layer Tree */}
        <aside className="gs-refine-left">
          <section className="gs-card gs-refine-ai">
            <div className="gs-row-between">
              <h2 className="gs-mini-title">
                <Sparkles size={14} aria-hidden="true" />
                {zh ? "AI 页面优化建议" : "AI Suggestions"}
              </h2>
              <span className="gs-badge gs-badge-accent">
                {displayedIssues.length > 0 ? displayedIssues.length : aiPresets.length}
              </span>
            </div>
            <div className="gs-refine-ai-list">
              {displayedIssues.length > 0
                ? displayedIssues.slice(0, 4).map((issue: Row, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      className="gs-refine-ai-item is-issue"
                      onClick={() => {
                        if (issue.blockKey) setEditingBlock(issue.blockKey);
                        setInspector("content");
                      }}
                    >
                      <span className="gs-refine-ai-dot" aria-hidden="true" />
                      <div>
                        <strong>{issue.blockKey || t("metaFields")}</strong>
                        <small>
                          {t(issue.code in siteMessages ? issue.code : "AGENT_FAILED")}
                          {issue.excerpt ? " · " + issue.excerpt : ""}
                        </small>
                      </div>
                    </button>
                  ))
                : aiPresets.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={
                        "gs-refine-ai-item" +
                        (instructions === preset.prompt ? " is-active" : "")
                      }
                      onClick={() => {
                        setInstructions(preset.prompt);
                        setInspector("content");
                      }}
                    >
                      <span className="gs-refine-ai-dot" aria-hidden="true" />
                      <div>
                        <strong>{preset.title}</strong>
                        <small>{preset.sub}</small>
                      </div>
                    </button>
                  ))}
            </div>
          </section>

          <nav
            id="editor-blocks"
            className="gs-card gs-refine-layers"
            aria-label={t("blockEditor")}
          >
            <div className="gs-row-between">
              <h2 className="gs-mini-title">
                <Layers size={14} aria-hidden="true" />
                {zh ? "页面结构" : t("blockEditor")}
                <small className="gs-layer-count">{data.blocks.length}</small>
              </h2>
              {canEdit && (
                <button
                  type="button"
                  className="gs-icon-btn"
                  title={t("addBlock")}
                  aria-label={t("addBlock")}
                  disabled={data.blocks.length >= 20 || locked}
                  onClick={addNewBlock}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="gs-layer-tree">
              <button
                type="button"
                className={
                  "gs-layer-row is-hero" + (inspector === "style" ? " is-active" : "")
                }
                onClick={() => setInspector("style")}
              >
                <span className="gs-layer-idx">H</span>
                <span className="gs-layer-meta">
                  <strong>{zh ? "Hero 首屏与展示" : "Hero & Presentation"}</strong>
                  <small>{data.presentation?.heroLayout ?? "split"}</small>
                </span>
              </button>
              {data.blocks.map((b: Row, i: number) => {
                const hasIssue = displayedIssues.some((v: Row) => v.blockKey === b.key);
                const isSelected = b.key === selectedBlock && inspector === "content";
                return (
                  <div
                    key={b.key}
                    className={
                      "gs-layer-item" +
                      (isSelected ? " is-active" : "") +
                      (hasIssue ? " has-issue" : "")
                    }
                    draggable={canEdit && !locked}
                    onDragStart={() => setDragKey(b.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (!dragKey || dragKey === b.key) return;
                      const from = data.blocks.findIndex((x: Row) => x.key === dragKey);
                      if (from >= 0) moveBlock(from, i);
                      setDragKey(null);
                    }}
                    onDragEnd={() => setDragKey(null)}
                  >
                    <button
                      type="button"
                      className="gs-layer-row"
                      aria-pressed={b.key === selectedBlock}
                      onClick={() => {
                        setEditingBlock(b.key);
                        setInspector("content");
                      }}
                    >
                      <span className="gs-layer-idx">{i + 1}</span>
                      <span className="gs-layer-meta">
                        <strong>{b.heading || t(b.type) || b.key}</strong>
                        <small>{t(b.type)}</small>
                      </span>
                      {hasIssue && (
                        <span className="gs-layer-issue-dot" title={t("needsEvidence")} />
                      )}
                    </button>
                    {canEdit && (
                      <div className="gs-layer-moves">
                        <button
                          type="button"
                          className="gs-layer-move"
                          aria-label={t("moveUp")}
                          disabled={locked || i === 0}
                          onClick={() => moveBlock(i, i - 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="gs-layer-move"
                          aria-label={t("moveDown")}
                          disabled={locked || i === data.blocks.length - 1}
                          onClick={() => moveBlock(i, i + 1)}
                        >
                          ↓
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {!data.blocks.length && (
                <p className="muted gs-layer-empty">{t("addBlock")}</p>
              )}
            </div>
            {canEdit && (
              <button
                type="button"
                className="gs-btn gs-btn-sm gs-layer-add"
                disabled={data.blocks.length >= 20 || locked}
                onClick={addNewBlock}
              >
                <Plus size={13} aria-hidden="true" />
                {t("addBlock")}
              </button>
            )}
          </nav>
        </aside>

        {/* CENTER HERO LIVE CANVAS */}
        <section
          className="gs-refine-canvas-col"
          aria-label={t("livePreview")}
        >
          <div className="gs-refine-canvas-bar">
            <div className="gs-refine-page-tab">
              <span className="gs-dot gs-dot-ok" aria-hidden="true" />
              <strong>{pageDisplayName}</strong>
              <small>{page.path}</small>
            </div>
            <div className="gs-refine-vp-group" role="group" aria-label={t("livePreview")}>
              {(
                [
                  ["desktop", Monitor, "1440 px"],
                  ["tablet", Tablet, "768 px"],
                  ["mobile", Smartphone, "390 px"],
                ] as const
              ).map(([mode, Icon, px]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewport === mode}
                  title={px}
                  onClick={() => setViewport(mode)}
                >
                  <Icon size={13} aria-hidden="true" />
                  <span>{px}</span>
                </button>
              ))}
            </div>
            <div className="gs-refine-canvas-actions">
              <span className="gs-refine-sync">
                {previewSyncing
                  ? t("previewSyncing")
                  : zh
                    ? "实时渲染"
                    : "Live synced"}
              </span>
              <button
                type="button"
                className="gs-icon-btn"
                title={t("refreshPreview")}
                aria-label={t("refreshPreview")}
                disabled={previewSyncing}
                onClick={() => {
                  setSplitOpen(true);
                  setPreviewNonce((n) => n + 1);
                }}
              >
                <RefreshCw size={13} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className={"gs-refine-stage is-" + viewport}>
            {liveHtml ? (
              <iframe
                title={t("livePreview")}
                sandbox="allow-same-origin"
                srcDoc={trustedPreview(liveHtml)}
                className={"gs-refine-iframe is-" + viewport}
              />
            ) : (
              <div className="gs-refine-stage-loading" role="status">
                <Sparkles size={20} aria-hidden="true" />
                <span>{t("previewSyncing")}</span>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANE: Properties Inspector (Content / Style / SEO / Review) */}
        <aside className="gs-card gs-refine-inspector">
          <div className="gs-row-between">
            <h2 className="gs-mini-title">
              {zh ? "属性设置" : "Properties"}
            </h2>
            <span className="gs-refine-rev">rev {page.revision}</span>
          </div>
          <div
            className="gs-refine-tabs"
            role="tablist"
            aria-label={t("blockEditor")}
          >
            {(
              [
                ["content", zh ? "内容" : t("blockEditor")],
                ["style", zh ? "样式" : t("brandPresentation")],
                ["seo", "SEO"],
                ["review", zh ? "审核" : t("pageReview")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={inspector === key}
                onClick={() => setInspector(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="gs-refine-inspector-body">
            <IssueList issues={displayedIssues} t={t} />
            {dirty && <p className="notice">{t("saveBefore")}</p>}

            {canEdit && (
              <details className="catalog-panel" hidden={inspector !== "style"}>
                <summary>{t("coverStudio")}</summary>
                {imageConnection.data?.configured ? (
                  <fieldset disabled={locked}>
                    <label>
                      {t("coverBrief")}
                      <textarea
                        value={shotBrief}
                        maxLength={600}
                        onChange={(e) => setShotBrief(e.target.value)}
                      />
                    </label>
                    <p>{t("coverConsent")}</p>
                    <button
                      disabled={shotBrief.trim().length < 3}
                      onClick={() =>
                        void a.run(async () => {
                          const result = await api(
                            "/assets/generate-image",
                            "POST",
                            {
                              subject: shotBrief,
                              composition:
                                page.type === "product" ? "still-life" : "campaign",
                            },
                            { "Idempotency-Key": crypto.randomUUID() },
                          );
                          setCandidate(result.id);
                          assets.reload();
                        })
                      }
                    >
                      {t(a.busy ? "coverGenerating" : "coverGenerate")}
                    </button>
                    {candidate && (
                      <figure>
                        <img
                          width="280"
                          src={"/api/v1/assets/" + candidate + "?variant=webp"}
                          alt={t("coverCandidate")}
                        />
                        <figcaption>
                          <button
                            disabled={
                              data.blocks.length >= 32 &&
                              !data.blocks.some((b: Row) => b.type === "image")
                            }
                            onClick={() => {
                              const imageIndex = data.blocks.findIndex(
                                (b: Row) => b.type === "image",
                              );
                              const alt =
                                "Concept illustration for " +
                                String(
                                  data.presentation?.navigationLabel || data.title,
                                ).slice(0, 140);
                              const next =
                                imageIndex < 0
                                  ? [
                                      {
                                        key:
                                          "visual-" + crypto.randomUUID().slice(0, 8),
                                        type: "image",
                                        heading: "",
                                        body: "",
                                        table: null,
                                        faq: [],
                                        assetId: candidate,
                                        alt,
                                        refs: [],
                                      },
                                      ...data.blocks,
                                    ]
                                  : data.blocks.map((b: Row, i: number) =>
                                      i === imageIndex
                                        ? { ...b, assetId: candidate, alt, refs: [] }
                                        : b,
                                    );
                              update({ blocks: next });
                              setCandidate("");
                            }}
                          >
                            {t("useCover")}
                          </button>
                        </figcaption>
                      </figure>
                    )}
                  </fieldset>
                ) : (
                  <Link to="/assets">{t("configureCover")}</Link>
                )}
              </details>
            )}

            <fieldset
              id="editor-meta"
              disabled={!canEdit || locked}
              className="catalog-panel"
              hidden={inspector !== "seo"}
            >
              <div className="gs-stack-sm">
                <label>
                  {t("seoTitle")}
                  <input
                    maxLength={100}
                    value={data.title}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </label>
                <label>
                  {t("metaDescription")}
                  <textarea
                    aria-label={t("metaDescription")}
                    rows={3}
                    maxLength={200}
                    value={data.metaDescription}
                    onChange={(e) => update({ metaDescription: e.target.value })}
                  />
                </label>
              </div>
              <RefPicker
                refs={data.refs}
                facts={sources.data?.facts ?? []}
                t={t}
                onChange={(refs) => update({ refs })}
                disabled={!canEdit || locked}
              />
            </fieldset>

            {data.presentation ? (
              <fieldset
                disabled={!canEdit || locked}
                className="catalog-panel"
                hidden={inspector !== "style"}
              >
                <h3>{t("brandPresentation")}</h3>
                <p className="hint">{t("presentationHint")}</p>
                <div className="gs-stack-sm">
                  {(
                    [
                      "navigationLabel",
                      "headline",
                      "summary",
                      "primaryActionLabel",
                    ] as const
                  ).map((field) => (
                    <label key={field}>
                      {t(field)}
                      <input
                        value={data.presentation[field]}
                        maxLength={
                          field === "navigationLabel"
                            ? 24
                            : field === "summary"
                              ? 240
                              : field === "primaryActionLabel"
                                ? 32
                                : 100
                        }
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              [field]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                  <div className="gs-refine-2col">
                    <label>
                      {t("visualStyle")}
                      <select
                        value={data.presentation.visualStyle}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              visualStyle: e.target.value,
                            },
                          })
                        }
                      >
                        {(["organic", "industrial", "minimal"] as const).map(
                          (value) => (
                            <option key={value} value={value}>
                              {t(value)}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      {t("heroLayout")}
                      <select
                        value={data.presentation.heroLayout}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              heroLayout: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="split">{t("split")}</option>
                        <option value="stacked">{t("stacked")}</option>
                        <option value="editorial">{t("heroEditorial")}</option>
                        <option value="panorama">{t("heroPanorama")}</option>
                      </select>
                    </label>
                    <label>
                      {t("primaryActionTarget")}
                      <select
                        value={data.presentation.primaryActionTarget ?? "collection"}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              primaryActionTarget: e.target.value,
                            },
                          })
                        }
                      >
                        {["collection", "inquiry", "catalogue"].map((v) => (
                          <option key={v} value={v}>
                            {t(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("density")}
                      <select
                        value={data.presentation.density ?? "comfortable"}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              density: e.target.value,
                            },
                          })
                        }
                      >
                        {["comfortable", "compact"].map((v) => (
                          <option key={v} value={v}>
                            {t(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    {t("designNotes")}
                    <textarea
                      rows={3}
                      value={data.presentation.designNotes}
                      maxLength={500}
                      onChange={(e) =>
                        update({
                          presentation: {
                            ...data.presentation,
                            designNotes: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </div>
                {data.presentation.composition && (
                  <div className="gs-refine-2col">
                    <label>
                      {t("palette")}
                      <select
                        value={data.presentation.composition.palette}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              composition: {
                                ...data.presentation.composition,
                                palette: e.target.value,
                              },
                            },
                          })
                        }
                      >
                        {[
                          "graphite",
                          "cobalt",
                          "clay",
                          "forest",
                          "violet",
                          "obsidian",
                          "ivory",
                          "ocean",
                          "brand",
                        ].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("typography")}
                      <select
                        value={data.presentation.composition.typography}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              composition: {
                                ...data.presentation.composition,
                                typography: e.target.value,
                              },
                            },
                          })
                        }
                      >
                        {["sans", "editorial", "technical", "luxury", "geometric"].map(
                          (v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      {t("surface")}
                      <select
                        value={data.presentation.composition.surface ?? "light"}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              composition: {
                                ...data.presentation.composition,
                                surface: e.target.value,
                              },
                            },
                          })
                        }
                      >
                        {["light", "warm", "contrast"].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("headerStyle")}
                      <select
                        value={data.presentation.composition.headerStyle ?? "classic"}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              composition: {
                                ...data.presentation.composition,
                                headerStyle: e.target.value,
                              },
                            },
                          })
                        }
                      >
                        {["classic", "editorial", "minimal"].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("radius")}
                      <select
                        value={data.presentation.composition.radius ?? "subtle"}
                        onChange={(e) =>
                          update({
                            presentation: {
                              ...data.presentation,
                              composition: {
                                ...data.presentation.composition,
                                radius: e.target.value,
                              },
                            },
                          })
                        }
                      >
                        {["sharp", "subtle", "rounded"].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </fieldset>
            ) : (
              canEdit && (
                <button
                  className="button secondary"
                  hidden={inspector !== "style"}
                  disabled={locked}
                  onClick={() =>
                    update({
                      presentation: {
                        navigationLabel:
                          page.type === "home"
                            ? "Home"
                            : page.title.split("|")[0].trim().slice(0, 24),
                        headline: page.title.split("|")[0].trim().slice(0, 100),
                        summary: page.metaDescription || "Explore the collection.",
                        primaryActionLabel: "Explore collection",
                        visualStyle: "organic",
                        heroLayout: "split",
                        designNotes: "",
                      },
                    })
                  }
                >
                  {t("addPresentation")}
                </button>
              )
            )}

            {data.blocks.map(
              (b: Row, index: number) =>
                b.key === selectedBlock && (
                  <section
                    className={
                      "catalog-panel sites-block " +
                      (page.issues.some((i: Row) => i.blockKey === b.key)
                        ? "sites-block-error"
                        : "")
                    }
                    key={b.key}
                    hidden={inspector !== "content"}
                  >
                    <div className="catalog-heading">
                      <h3>
                        #{index + 1} · {b.key}
                      </h3>
                      {canEdit && (
                        <div className="catalog-actions">
                          <button
                            type="button"
                            className="secondary"
                            disabled={locked || data.blocks.length >= 20}
                            onClick={() => {
                              const copyKey =
                                b.key.slice(0, 48) +
                                "-" +
                                crypto.randomUUID().slice(0, 6);
                              const clone = { ...structuredClone(b), key: copyKey };
                              const next = [...data.blocks];
                              next.splice(index + 1, 0, clone);
                              setEditingBlock(copyKey);
                              update({ blocks: next });
                            }}
                          >
                            {t("duplicateBlock")}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={locked}
                            onClick={() =>
                              update({
                                blocks: data.blocks.filter(
                                  (x: Row) => x.key !== b.key,
                                ),
                              })
                            }
                          >
                            {t("remove")}
                          </button>
                        </div>
                      )}
                    </div>
                    <IssueList
                      issues={page.issues.filter((i: Row) => i.blockKey === b.key)}
                      t={t}
                    />
                    <fieldset disabled={!canEdit || locked}>
                      <div className="gs-stack-sm">
                        <label>
                          {t("heading")}
                          <input
                            maxLength={160}
                            value={b.heading}
                            onChange={(e) =>
                              blockUpdate(b.key, { heading: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          {t("type")}
                          <select
                            aria-label={t("type") + " " + b.key}
                            value={b.type}
                            onChange={(e) =>
                              blockUpdate(b.key, {
                                type: e.target.value,
                                ...(["specs", "comparison"].includes(
                                  e.target.value,
                                ) && !b.table
                                  ? {
                                      table: {
                                        columns: ["Specification", "Value"],
                                        rows: [],
                                      },
                                    }
                                  : {}),
                              })
                            }
                          >
                            {[
                              "text",
                              "specs",
                              "faq",
                              "image",
                              "category-grid",
                              "product-grid",
                              "split",
                              "features",
                              "process",
                              "customization",
                              "evidence",
                              "case-study",
                              "downloads",
                              "cta",
                              "comparison",
                              "gallery",
                              "metrics",
                              "certifications",
                              "showcase",
                            ].map((k) => (
                              <option key={k} value={k}>
                                {t(k)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label>
                        {t("body")}
                        <textarea
                          aria-label={t("body")}
                          rows={4}
                          maxLength={6000}
                          value={b.body}
                          onChange={(e) =>
                            blockUpdate(b.key, { body: e.target.value })
                          }
                        />
                      </label>
                      {["specs", "comparison"].includes(b.type) && b.table && (
                        <>
                          <label>
                            {t("tableColumns")}
                            <input
                              value={b.table.columns.join(", ")}
                              onChange={(e) => {
                                const columns = split(e.target.value).slice(0, 10);
                                blockUpdate(b.key, {
                                  table: {
                                    columns,
                                    rows: b.table.rows.map((r: string[]) =>
                                      columns.map((_, i) => r[i] ?? ""),
                                    ),
                                  },
                                });
                              }}
                            />
                          </label>
                          <div className="catalog-table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  {b.table.columns.map((c: string, i: number) => (
                                    <th key={i}>{c}</th>
                                  ))}
                                  <th>{t("remove")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {b.table.rows.map((r: string[], i: number) => (
                                  <tr key={i}>
                                    {r.map((c: string, j: number) => (
                                      <td key={j}>
                                        <input
                                          aria-label={
                                            b.table.columns[j] + " " + (i + 1)
                                          }
                                          maxLength={300}
                                          value={c}
                                          onChange={(e) =>
                                            blockUpdate(b.key, {
                                              table: {
                                                ...b.table,
                                                rows: b.table.rows.map(
                                                  (r: string[], k: number) =>
                                                    k === i
                                                      ? r.map(
                                                          (c: string, l: number) =>
                                                            j === l
                                                              ? e.target.value
                                                              : c,
                                                        )
                                                      : r,
                                                ),
                                              },
                                            })
                                          }
                                        />
                                      </td>
                                    ))}
                                    <td>
                                      <button
                                        className="secondary"
                                        onClick={() =>
                                          blockUpdate(b.key, {
                                            table: {
                                              ...b.table,
                                              rows: b.table.rows.filter(
                                                (_: any, k: number) => i !== k,
                                              ),
                                            },
                                          })
                                        }
                                      >
                                        {t("remove")}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <button
                            className="secondary"
                            disabled={b.table.rows.length >= 50}
                            onClick={() =>
                              blockUpdate(b.key, {
                                table: {
                                  ...b.table,
                                  rows: [
                                    ...b.table.rows,
                                    b.table.columns.map(() => ""),
                                  ],
                                },
                              })
                            }
                          >
                            {t("addRow")}
                          </button>
                        </>
                      )}
                      {b.type === "faq" && (
                        <>
                          {b.faq.map((f: Row, i: number) => {
                            const patch = (p: Row) =>
                              blockUpdate(b.key, {
                                faq: b.faq.map((q: Row, k: number) =>
                                  k === i ? { ...q, ...p } : q,
                                ),
                              });
                            return (
                              <div className="catalog-subpanel" key={i}>
                                <label>
                                  {t("question")}
                                  <input
                                    value={f.question}
                                    maxLength={300}
                                    onChange={(e) =>
                                      patch({ question: e.target.value })
                                    }
                                  />
                                </label>
                                <label>
                                  {t("directAnswer")}
                                  <textarea
                                    aria-label={t("directAnswer")}
                                    rows={3}
                                    value={f.answer}
                                    maxLength={1800}
                                    onChange={(e) =>
                                      patch({ answer: e.target.value })
                                    }
                                  />
                                  <small>
                                    {
                                      f.answer.trim().split(/\s+/).filter(Boolean)
                                        .length
                                    }{" "}
                                    {t("words")}
                                  </small>
                                </label>
                                <label>
                                  {t("detail")}
                                  <textarea
                                    aria-label={t("detail")}
                                    value={f.detail}
                                    maxLength={2500}
                                    onChange={(e) =>
                                      patch({ detail: e.target.value })
                                    }
                                  />
                                </label>
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    blockUpdate(b.key, {
                                      faq: b.faq.filter(
                                        (_: any, k: number) => i !== k,
                                      ),
                                    })
                                  }
                                >
                                  {t("remove")}
                                </button>
                              </div>
                            );
                          })}
                          <button
                            className="secondary"
                            disabled={b.faq.length >= 20}
                            onClick={() =>
                              blockUpdate(b.key, {
                                faq: [
                                  ...b.faq,
                                  { question: "", answer: "", detail: "" },
                                ],
                              })
                            }
                          >
                            {t("addFaq")}
                          </button>
                        </>
                      )}
                      {["image", "split"].includes(b.type) && (
                        <div className="gs-stack-sm">
                          <label>
                            {t("image")}
                            <select
                              aria-label={t("image") + " " + b.key}
                              value={b.assetId ?? ""}
                              onChange={(e) =>
                                blockUpdate(b.key, {
                                  assetId: e.target.value || null,
                                })
                              }
                            >
                              <option value="">{t("none")}</option>
                              {assets.data?.items
                                .filter((a: Row) => a.mime.startsWith("image/"))
                                .map((a: Row) => (
                                  <option key={a.id} value={a.id}>
                                    {a.fileName}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            {t("alt")}
                            <input
                              maxLength={200}
                              value={b.alt}
                              onChange={(e) =>
                                blockUpdate(b.key, { alt: e.target.value })
                              }
                            />
                          </label>
                        </div>
                      )}
                      {!["text", "specs", "faq", "image"].includes(b.type) && (
                        <>
                          <div className="gs-refine-2col">
                            <label>
                              {t("blockLayout")}
                              <select
                                value={b.layout ?? "cards"}
                                onChange={(e) =>
                                  blockUpdate(b.key, { layout: e.target.value })
                                }
                              >
                                {["cards", "split", "reverse", "band", "compact"].map(
                                  (v) => (
                                    <option key={v} value={v}>
                                      {t(v)}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label>
                              {t("blockTone")}
                              <select
                                value={b.tone ?? "light"}
                                onChange={(e) =>
                                  blockUpdate(b.key, { tone: e.target.value })
                                }
                              >
                                {["light", "sage", "dark"].map((v) => (
                                  <option key={v} value={v}>
                                    {t(v)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          {(b.items ?? []).map((item: Row, i: number) => {
                            const change = (patch: Row) =>
                              blockUpdate(b.key, {
                                items: b.items.map((x: Row, j: number) =>
                                  j === i ? { ...x, ...patch } : x,
                                ),
                              });
                            return (
                              <fieldset className="catalog-panel" key={i}>
                                <legend>
                                  {t("blockItem")} {i + 1}
                                </legend>
                                <label>
                                  {t("heading")}
                                  <input
                                    maxLength={160}
                                    value={item.title}
                                    onChange={(e) =>
                                      change({ title: e.target.value })
                                    }
                                  />
                                </label>
                                <label>
                                  {t("body")}
                                  <textarea
                                    maxLength={1200}
                                    value={item.body}
                                    onChange={(e) => change({ body: e.target.value })}
                                  />
                                </label>
                                <label>
                                  {t("internalLink")}
                                  <input
                                    value={item.href ?? ""}
                                    onChange={(e) =>
                                      change({ href: e.target.value || null })
                                    }
                                  />
                                </label>
                                <label>
                                  {t("image")} / PDF
                                  <select
                                    value={item.assetId ?? ""}
                                    onChange={(e) =>
                                      change({ assetId: e.target.value || null })
                                    }
                                  >
                                    <option value="">{t("none")}</option>
                                    {(assets.data?.items ?? [])
                                      .filter((a: Row) =>
                                        b.type === "downloads"
                                          ? a.mime === "application/pdf"
                                          : a.mime.startsWith("image/"),
                                      )
                                      .map((a: Row) => (
                                        <option key={a.id} value={a.id}>
                                          {a.fileName}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                <label>
                                  {t("alt")}
                                  <input
                                    maxLength={200}
                                    value={item.alt}
                                    onChange={(e) => change({ alt: e.target.value })}
                                  />
                                </label>
                                <RefPicker
                                  refs={item.refs}
                                  facts={sources.data?.facts ?? []}
                                  t={t}
                                  onChange={(refs) => change({ refs })}
                                />
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() =>
                                    blockUpdate(b.key, {
                                      items: b.items.filter(
                                        (_: Row, j: number) => j !== i,
                                      ),
                                    })
                                  }
                                >
                                  {t("remove")}
                                </button>
                              </fieldset>
                            );
                          })}
                          <button
                            type="button"
                            className="secondary"
                            disabled={(b.items ?? []).length >= 12}
                            onClick={() =>
                              blockUpdate(b.key, {
                                items: [
                                  ...(b.items ?? []),
                                  {
                                    title: "",
                                    body: "",
                                    assetId: null,
                                    alt: "",
                                    href: null,
                                    refs: [],
                                  },
                                ],
                              })
                            }
                          >
                            {t("addBlockItem")}
                          </button>
                        </>
                      )}
                      <RefPicker
                        refs={b.refs}
                        facts={sources.data?.facts ?? []}
                        t={t}
                        onChange={(refs) => blockUpdate(b.key, { refs })}
                        disabled={!canEdit || locked}
                      />
                    </fieldset>
                    {canEdit && (
                      <div className="studio-rewrite-box">
                        <strong>{t("aiBlockRewrite")}</strong>
                        <div className="studio-chips">
                          {[
                            t("rewriteChipConcise"),
                            t("rewriteChipValue"),
                            t("rewriteChipGuidance"),
                          ].map((chip) => (
                            <button
                              key={chip}
                              type="button"
                              className="secondary"
                              disabled={locked}
                              onClick={() => setInstructions(chip)}
                            >
                              {chip}
                            </button>
                          ))}
                        </div>
                        <label>
                          {t("rewriteInstructions")}
                          <input
                            maxLength={1000}
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                          />
                        </label>
                        <label className="catalog-check">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          {t("consent")}
                        </label>
                        <button
                          type="button"
                          className="gs-btn gs-btn-sm gs-btn-primary"
                          disabled={locked || !consent}
                          onClick={() =>
                            void a.run(async () => {
                              if (dirty) {
                                await api("/pages/" + page.id, "PATCH", {
                                  revision: page.revision,
                                  data,
                                });
                                setDirty(false);
                              }
                              const r = await api(
                                "/sites/" + page.siteId + "/agent-runs",
                                "POST",
                                {
                                  step: "rewrite",
                                  consent: true,
                                  pageId: page.id,
                                  blockKey: b.key,
                                  instructions,
                                },
                                { "Idempotency-Key": crypto.randomUUID() },
                              );
                              setJob(r.id);
                            })
                          }
                        >
                          <Sparkles size={13} aria-hidden="true" />
                          {dirty ? t("saveAndRewrite") : t("rewrite")}
                        </button>
                      </div>
                    )}
                  </section>
                ),
            )}

            {job && (
              <section className="catalog-panel">
                <Badge status={run.data?.status ?? "queued"} t={t} />
                {run.data?.errorCode && (
                  <p className="notice error">
                    {t(
                      run.data.errorCode in siteMessages
                        ? run.data.errorCode
                        : "AGENT_FAILED",
                    )}
                  </p>
                )}
                {run.data?.active && (
                  <button
                    disabled={a.busy}
                    className="secondary"
                    onClick={() =>
                      void a.run(async () => {
                        await api("/agent-runs/" + job + "/cancel", "POST");
                        run.reload();
                      })
                    }
                  >
                    {t("cancel")}
                  </button>
                )}
              </section>
            )}

            <section
              className="catalog-panel"
              id="editor-review"
              hidden={inspector !== "review"}
            >
              <h3>{t("pageReview")}</h3>
              <div className="catalog-actions">
                <button
                  className="secondary"
                  disabled={dirty || a.busy}
                  onClick={() =>
                    void a.run(async () =>
                      setPreview((await api("/pages/" + page.id + "/preview")).html),
                    )
                  }
                >
                  {t("preview")}
                </button>
                {preview && (
                  <button className="secondary" onClick={() => setMobile(!mobile)}>
                    {t(mobile ? "desktop" : "mobile")}
                  </button>
                )}
              </div>
              {preview && (
                <iframe
                  title={t("preview")}
                  sandbox="allow-same-origin"
                  srcDoc={trustedPreview(preview)}
                  className={"sites-preview " + (mobile ? "mobile" : "")}
                />
              )}
              {role === "admin" && (
                <>
                  <label>
                    {t("reason")}
                    <textarea
                      aria-label={t("reason")}
                      rows={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <div className="catalog-actions">
                    <button
                      className="gs-btn gs-btn-sm gs-btn-primary"
                      disabled={dirty || locked || page.issues.length > 0}
                      onClick={() =>
                        void a.run(async () => {
                          await api("/pages/" + page.id + "/approve", "POST", {
                            revision: page.revision,
                            reason,
                          });
                          reload();
                        })
                      }
                    >
                      {t("approve")}
                    </button>
                    <button
                      className="secondary"
                      disabled={dirty || locked}
                      onClick={() =>
                        void a.run(async () => {
                          await api("/pages/" + page.id + "/reject", "POST", {
                            revision: page.revision,
                            reason,
                          });
                          reload();
                        })
                      }
                    >
                      {t("reject")}
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        </aside>
      </div>

      {/* Bottom Sticky Sibling Page Switcher Dock (Ref Image 3) */}
      <footer className="gs-refine-dock" aria-label={t("pages")}>
        <span className="gs-refine-dock-label">
          {zh ? "页面切换" : "Pages"}
        </span>
        <nav className="gs-refine-dock-pills">
          {(siblings.data?.items ?? []).map((item: Row) => (
            <Link
              key={item.id}
              to={"/pages/" + item.id}
              className={"gs-refine-dock-pill" + (item.id === page.id ? " is-active" : "")}
              aria-current={item.id === page.id ? "page" : undefined}
            >
              {item.presentation?.navigationLabel || item.title}
            </Link>
          ))}
        </nav>
        <Link
          className="gs-btn gs-btn-sm"
          to={"/sites/" + page.siteId + "?tab=planning"}
        >
          <Plus size={13} aria-hidden="true" />
          {zh ? "管理站点结构" : "Site blueprint"}
        </Link>
      </footer>
    </div>
  );
}

