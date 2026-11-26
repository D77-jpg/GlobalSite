import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, FileText, Network } from "lucide-react";
import { api } from "../api";
import { moveNode, orderedNodes } from "../site-plan";
import {
  Badge,
  Notice,
  split,
  useAction,
  type Props,
  type Row,
  type T,
} from "./shared";

export function PlanEditor({
  site,
  products,
  t,
  role,
  done,
}: {
  site: Row;
  products: Row[];
  t: T;
  role: Props["role"];
  done: (r: any) => void;
}) {
  const defaults = site.plan?.nodes ?? [
      {
        key: "home",
        path: "/",
        title: "Home",
        type: "home",
        parentKey: null,
        productId: null,
        keywords: [],
        intent: "source",
      },
    ],
    [nodes, setNodes] = useState<Row[]>(defaults),
    [strategy, setStrategy] = useState<Row | undefined>(site.plan?.strategy),
    [selectedNode, selectNode] = useState<string>(defaults[0]?.key),
    [dirty, setDirty] = useState(false),
    [drag, setDrag] = useState(""),
    a = useAction(),
    canEdit = role !== "viewer";
  const update = (key: string, patch: Row) => {
    setDirty(true);
    setNodes((old) => old.map((n) => (n.key === key ? { ...n, ...patch } : n)));
  };
  const move = (key: string, target: string) => {
    setDirty(true);
    setNodes((old) => moveNode(old, key, target));
  };
  const ordered = orderedNodes(nodes);
  const current = ordered.some((n) => n.key === selectedNode)
    ? selectedNode
    : ordered[0]?.key;
  return (
    <section className="catalog-panel">
      <div className="catalog-heading">
        <h2>{t("planning")}</h2>
        <Badge
          status={site.planConfirmed ? "confirmedPlan" : "unconfirmedPlan"}
          t={t}
        />
      </div>
      {strategy && (
        <details className="strategy-review" open>
          <summary>{t("businessStrategy")}</summary>
          <p className="muted">{t("strategyPilot")}</p>
          <label>
            {t("strategyOffering")}
            <textarea
              disabled={!canEdit}
              maxLength={240}
              value={strategy.offering}
              onChange={(e) => {
                setStrategy({ ...strategy, offering: e.target.value });
                setDirty(true);
              }}
            />
          </label>
          <div className="catalog-grid">
            <section>
              <h3>{t("strategyDecisions")}</h3>
              <ul>
                {strategy.decisionFactors.map((v: string) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </section>
            <section>
              <h3>{t("strategyVisual")}</h3>
              <ul>
                {strategy.visualPriorities.map((v: string) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </section>
          </div>
          <h3>{t("strategyNavigation")}</h3>
          <div className="catalog-grid">
            {strategy.navigation.map((g: Row, i: number) => (
              <label key={i}>
                {g.nodeKeys
                  .map((k: string) => nodes.find((n) => n.key === k)?.title)
                  .filter(Boolean)
                  .join(" / ")}
                <input
                  disabled={!canEdit}
                  value={g.label}
                  maxLength={24}
                  onChange={(e) => {
                    setStrategy({
                      ...strategy,
                      navigation: strategy.navigation.map(
                        (r: Row, j: number) =>
                          j === i ? { ...r, label: e.target.value } : r,
                      ),
                    });
                    setDirty(true);
                  }}
                />
              </label>
            ))}
          </div>
          {strategy.questions.length > 0 && (
            <>
              <h3>{t("strategyQuestions")}</h3>
              <ul>
                {strategy.questions.map((q: string) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <Link to="?tab=interview">{t("generateInterview")}</Link>
            </>
          )}
        </details>
      )}
      <p className="muted">{t("dragHint")}</p>
      {site.plan?.clusters?.length > 0 && (
        <details className="studio-clusters">
          <summary>
            {t("keywordClusters")} <span>{site.plan.clusters.length}</span>
          </summary>
          <div className="sites-keywords">
            {site.plan?.clusters.map((c: Row) => (
              <article className="catalog-subpanel" key={c.key}>
                <strong>{c.label}</strong>
                <small>{t(c.intent)}</small>
                <p>{c.keywords.join(" · ")}</p>
              </article>
            ))}
          </div>
        </details>
      )}
      <div className="studio-plan-layout">
        <nav aria-label={t("pageOutline")} className="studio-outline">
          <h3>
            <Network size={16} />
            {t("pageOutline")}
          </h3>
          {ordered.map((n) => (
            <button
              key={n.key}
              aria-pressed={n.key === current}
              onClick={() => selectNode(n.key)}
              draggable={canEdit && n.type !== "home"}
              onDragStart={() => setDrag(n.key)}
              onDragEnd={() => setDrag("")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (canEdit && drag) move(drag, n.key);
              }}
              style={{ paddingInlineStart: 12 + Math.min(n.depth, 3) * 10 }}
            >
              <FileText size={14} />
              <span>
                <strong>{n.title}</strong>
                <small>{n.path}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="sites-tree">
          {ordered.map((n) => (
            <article
              key={n.key}
              hidden={n.key !== current}
              className="sites-tree-node"
            >
              <div className="catalog-heading">
                <strong>{n.title}</strong>
                <div className="catalog-actions">
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={t("up") + " " + n.title}
                        onClick={() => {
                          const list = orderedNodes(nodes).filter(
                              (x) => x.parentKey === n.parentKey,
                            ),
                            i = list.findIndex((x) => x.key === n.key);
                          if (i > 0) move(n.key, list[i - 1].key);
                        }}
                      >
                        {t("up")}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={t("down") + " " + n.title}
                        onClick={() => {
                          const list = orderedNodes(nodes).filter(
                              (x) => x.parentKey === n.parentKey,
                            ),
                            i = list.findIndex((x) => x.key === n.key);
                          if (i >= 0 && i < list.length - 1)
                            move(list[i + 1].key, n.key);
                        }}
                      >
                        {t("down")}
                      </button>
                      {n.type !== "home" && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setDirty(true);
                            setNodes((old) =>
                              old
                                .filter((x) => x.key !== n.key)
                                .map((x) =>
                                  x.parentKey === n.key
                                    ? { ...x, parentKey: n.parentKey }
                                    : x,
                                ),
                            );
                          }}
                        >
                          {t("remove")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <fieldset disabled={!canEdit || a.busy}>
                <div className="catalog-grid">
                  <label>
                    {t("pageTitle")}
                    <input
                      maxLength={120}
                      value={n.title}
                      onChange={(e) => update(n.key, { title: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("path")}
                    <input
                      maxLength={160}
                      value={n.path}
                      onChange={(e) => update(n.key, { path: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("type")}
                    <select
                      aria-label={t("type") + " " + n.key}
                      value={n.type}
                      disabled={n.type === "home"}
                      onChange={(e) =>
                        update(n.key, { type: e.target.value, productId: null })
                      }
                    >
                      {[
                        "home",
                        "category",
                        "product",
                        "about",
                        "factory",
                        "certifications",
                        "faq",
                        "contact",
                        "customization",
                        "resources",
                        "solution",
                      ].map((k) => (
                        <option key={k} value={k}>
                          {t(k)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("parent")}
                    <select
                      aria-label={t("parent") + " " + n.key}
                      value={n.parentKey ?? ""}
                      disabled={n.type === "home"}
                      onChange={(e) =>
                        update(n.key, { parentKey: e.target.value || null })
                      }
                    >
                      <option value="">{t("none")}</option>
                      {nodes
                        .filter((x) => x.key !== n.key)
                        .map((x) => (
                          <option value={x.key} key={x.key}>
                            {x.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {t("keywords")}
                    <input
                      value={(n.keywords ?? []).join(", ")}
                      onChange={(e) =>
                        update(n.key, { keywords: split(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    {t("intent")}
                    <select
                      aria-label={t("intent") + " " + n.key}
                      value={n.intent}
                      onChange={(e) =>
                        update(n.key, { intent: e.target.value })
                      }
                    >
                      {["learn", "compare", "specify", "source", "buy"].map(
                        (k) => (
                          <option key={k} value={k}>
                            {t(k)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  {n.type === "product" && (
                    <label>
                      {t("product")}
                      <select
                        value={n.productId ?? ""}
                        aria-label={t("product") + " " + n.key}
                        onChange={(e) =>
                          update(n.key, { productId: e.target.value || null })
                        }
                      >
                        <option value="">{t("none")}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {n.brief ? (
                  <details open>
                    <summary>{t("pageBriefs")}</summary>
                    <label>
                      {t("briefPurpose")}
                      <textarea
                        maxLength={240}
                        value={n.brief.purpose}
                        onChange={(e) =>
                          update(n.key, {
                            brief: { ...n.brief, purpose: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      {t("briefQuestions")}
                      <textarea
                        rows={4}
                        value={n.brief.buyerQuestions.join("\n")}
                        onChange={(e) =>
                          update(n.key, {
                            brief: {
                              ...n.brief,
                              buyerQuestions: e.target.value.split("\n"),
                            },
                          })
                        }
                        onBlur={() =>
                          update(n.key, {
                            brief: {
                              ...n.brief,
                              buyerQuestions: n.brief.buyerQuestions
                                .map((v: string) => v.trim())
                                .filter(Boolean),
                            },
                          })
                        }
                      />
                    </label>
                    <fieldset>
                      <legend>{t("briefSections")}</legend>
                      <div className="catalog-grid">
                        {[
                          "text",
                          "image",
                          "category-grid",
                          "product-grid",
                          "split",
                          "features",
                          "specs",
                          "comparison",
                          "customization",
                          "process",
                          "evidence",
                          "case-study",
                          "downloads",
                          "gallery",
                          "metrics",
                          "certifications",
                          "showcase",
                          "faq",
                          "cta",
                        ].map((k) => (
                          <label key={k} className="catalog-check">
                            <input
                              type="checkbox"
                              checked={n.brief.sections.includes(k)}
                              onChange={(e) =>
                                update(n.key, {
                                  brief: {
                                    ...n.brief,
                                    sections: e.target.checked
                                      ? [...n.brief.sections, k]
                                      : n.brief.sections.filter(
                                          (v: string) => v !== k,
                                        ),
                                  },
                                })
                              }
                            />
                            {t(k)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </details>
                ) : (
                  canEdit && (
                    <button
                      className="secondary"
                      onClick={() =>
                        update(n.key, {
                          brief: {
                            purpose: "",
                            buyerQuestions: [],
                            requiredFactTypes: [],
                            sections: [],
                          },
                        })
                      }
                    >
                      {t("addPageBrief")}
                    </button>
                  )
                )}
              </fieldset>
            </article>
          ))}
        </div>
      </div>
      {canEdit && (
        <div className="catalog-actions">
          <button
            className="secondary"
            disabled={nodes.length >= 50}
            onClick={() => {
              const key = "page-" + crypto.randomUUID().slice(0, 8);
              selectNode(key);
              setDirty(true);
              setNodes((old) => [
                ...old,
                {
                  key,
                  path: "/" + key,
                  title: "New page",
                  type: "about",
                  parentKey: nodes.find((n) => n.type === "home")?.key ?? null,
                  productId: null,
                  keywords: [],
                  intent: "learn",
                },
              ]);
            }}
          >
            {t("addNode")}
          </button>
          <button
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                done(
                  await api("/sites/" + site.id + "/plan", "PUT", {
                    revision: site.planRevision,
                    nodes: nodes.map(({ depth: _depth, ...n }) => n),
                    ...(strategy
                      ? {
                          strategy: {
                            ...strategy,
                            navigation: strategy.navigation
                              .map((g: Row) => ({
                                ...g,
                                nodeKeys: g.nodeKeys.filter((k: string) =>
                                  nodes.some((n) => n.key === k),
                                ),
                              }))
                              .filter((g: Row) => g.nodeKeys.length),
                          },
                        }
                      : {}),
                    keywords: site.plan?.keywords ?? [],
                    clusters: site.plan?.clusters ?? [],
                  }),
                );
                setDirty(false);
              })
            }
          >
            {t("manualPlan")}
          </button>
          {role === "admin" && (
            <button
              className="secondary"
              disabled={a.busy || dirty || !site.plan || site.planConfirmed}
              onClick={() =>
                void a.run(async () =>
                  done(
                    await api("/sites/" + site.id + "/plan/confirm", "POST", {
                      revision: site.planRevision,
                    }),
                  ),
                )
              }
            >
              {t("confirmPlan")}
            </button>
          )}
        </div>
      )}
      <Notice t={t} error={a.error} saved={a.saved} />
    </section>
  );
}
