import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "./api";
import { st } from "./sites-i18n";
import type { Locale } from "./i18n";
type Row = Record<string, any>;
export function BuyerWorkspace({
  site,
  products,
  locale,
  canEdit,
  onSave,
}: {
  site: Row;
  products: Row[];
  locale: Locale;
  canEdit: boolean;
  onSave: () => void;
}) {
  const t = st(locale),
    [profile, setProfile] = useState(
      site.buyerProfile ?? {
        businessModel: "wholesale",
        audiences: [],
        buyerNeeds: [],
        primaryAction: "quote",
        referenceUrls: [],
      },
    ),
    [coverage, setCoverage] = useState<Row>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    void api<Row>("/sites/" + site.id + "/buyer-readiness")
      .then(setCoverage)
      .catch(() => setError(t("failedGeneric")));
  }, [site.id, site.revision, site.planRevision]);
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const data = Object.fromEntries(
        [
          "name",
          "templateId",
          "targetMarkets",
          "language",
          "brandColor",
          "logoId",
          "productIds",
          "status",
        ].map((k) => [k, site[k]]),
      );
      await api("/sites/" + site.id, "PATCH", {
        revision: site.revision,
        data: {
          ...data,
          buyerProfile: {
            ...profile,
            ...Object.fromEntries(
              ["audiences", "buyerNeeds", "referenceUrls"].map((k) => [
                k,
                profile[k].map((v: string) => v.trim()).filter(Boolean),
              ]),
            ),
          },
        },
      });
      setSaved(true);
      onSave();
    } catch (e) {
      setError(t(e instanceof ApiError ? e.code : "failedGeneric"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="b2b-workspace">
      <section className="catalog-panel">
        <h2>{t("buyerProfile")}</h2>
        <p>{t("buyerProfileHint")}</p>
        <fieldset disabled={!canEdit || busy}>
          <div className="catalog-grid">
            <label>
              {t("businessModel")}
              <select
                value={profile.businessModel}
                onChange={(e) =>
                  setProfile({ ...profile, businessModel: e.target.value })
                }
              >
                {[
                  "wholesale",
                  "private_label",
                  "manufacturer",
                  "distributor",
                ].map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("primaryAction")}
              <select
                value={profile.primaryAction}
                onChange={(e) =>
                  setProfile({ ...profile, primaryAction: e.target.value })
                }
              >
                {["quote", "catalogue", "sample"].map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(["audiences", "buyerNeeds", "referenceUrls"] as const).map((k) => (
            <label key={k}>
              {t(k)}
              <textarea
                rows={k === "buyerNeeds" ? 4 : 3}
                value={profile[k].join("\n")}
                onChange={(e) =>
                  setProfile({ ...profile, [k]: e.target.value.split("\n") })
                }
              />
            </label>
          ))}
          {canEdit && (
            <button
              onClick={() => void save()}
              disabled={
                busy || !profile.audiences.some((v: string) => v.trim())
              }
            >
              {t("saveBuyerProfile")}
            </button>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {saved && <p role="status">{t("saved")}</p>}
      </section>
      <section className="catalog-panel">
        <h2>{t("procurementCoverage")}</h2>
        <p>{t("coverageHint")}</p>
        {coverage && (
          <>
            <strong className="b2b-coverage">{coverage.coverage}%</strong>
            <p>
              {t(
                coverage.canPublish ? "procurementReady" : "procurementMissing",
              )}
            </p>
            <div className="catalog-actions">
              <Link to="/facts">{t("facts")}</Link>
              <Link to="/products">{t("products")}</Link>
            </div>
            <ul className="b2b-gap-list">
              {coverage.gaps.map((g: Row, i: number) => (
                <li key={i}>
                  <span
                    className={
                      "catalog-badge " +
                      (g.severity === "required" ? "blocked" : "draft")
                    }
                  >
                    {t(g.severity)}
                  </span>
                  <strong>{t(g.type)}</strong>
                  <small>
                    {g.subjectId
                      ? (products.find((p) => p.id === g.subjectId)?.name ??
                        t("products"))
                      : t("organizationFact")}
                  </small>
                </li>
              ))}
            </ul>
            <h3>{t("pageBriefs")}</h3>
            {coverage.pageBriefs.map((b: Row) => (
              <details key={b.nodeKey}>
                <summary>
                  {site.plan.nodes.find((n: Row) => n.key === b.nodeKey)
                    ?.title ?? b.nodeKey}
                </summary>
                <ul>
                  {b.questions.map((q: string) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
                <p>{b.sections.map((s: string) => t(s)).join(" · ")}</p>
              </details>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
export function SiteQuality({
  site,
  locale,
  canEdit,
  canApprove,
  consent,
  runs,
  onRun,
}: {
  site: Row;
  locale: Locale;
  canEdit: boolean;
  canApprove: boolean;
  consent: boolean;
  runs: Row[];
  onRun: (step: string, instructions: string) => Promise<void>;
}) {
  const t = st(locale),
    [instructions, setInstructions] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reviews = runs.filter((r) => r.step === "review"),
    latest = reviews.find((r) => r.status === "succeeded"),
    refinement = runs.find((r) => r.step === "refine"),
    active = runs.some(
      (r) =>
        r.active && ["content", "rewrite", "refine", "review"].includes(r.step),
    );
  async function start(step: string) {
    setBusy(true);
    setError("");
    try {
      await onRun(step, instructions);
    } catch (e) {
      setError(t(e instanceof ApiError ? e.code : "failedGeneric"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="catalog-panel">
      <h2>{t("siteQuality")}</h2>
      <p>{t("siteQualityHint")}</p>
      <label>
        {t("refineInstructions")}
        <textarea
          value={instructions}
          maxLength={1000}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={!canEdit || busy}
        />
      </label>
      <div className="catalog-actions">
        <button
          disabled={
            !canEdit || !consent || !site.planConfirmed || busy || active
          }
          onClick={() => void start("review")}
        >
          {t("reviewSite")}
        </button>
        <button
          className="secondary"
          disabled={!canEdit || !consent || !latest || busy || active}
          onClick={() => void start("refine")}
        >
          {t("refineSite")}
        </button>
        <Link to={"/sites/" + site.id + "/publishing"}>
          {t("buildPublish")}
        </Link>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {refinement && (
        <div className="notice" role="status">
          <strong>
            {t("refine")} · {t(refinement.status)}
          </strong>
          <p>
            {t("refineProgress")}:{" "}
            {
              refinement.steps.filter((u: Row) => u.status === "succeeded")
                .length
            }
            /{refinement.steps.length}
          </p>
          {refinement.errorCode && <p>{t(refinement.errorCode)}</p>}
        </div>
      )}
      {!reviews.length ? (
        <p>{t("noQualityReview")}</p>
      ) : (
        reviews.map((r) => (
          <article className="b2b-review" key={r.id}>
            <h3>
              {new Date(r.createdAt).toLocaleString()} · {t(r.status)}
            </h3>
            {r.qualityAcceptedAt ? (
              <p role="status">{t("qualityAccepted")}</p>
            ) : (
              r.status === "succeeded" &&
              canApprove && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void api(
                      "/agent-runs/" + r.id + "/accept-review",
                      "POST",
                      {},
                    )
                      .then(() => {
                        r.qualityAcceptedAt = new Date().toISOString();
                      })
                      .catch((e) =>
                        setError(
                          t(e instanceof ApiError ? e.code : "failedGeneric"),
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  {t("acceptQuality")}
                </button>
              )
            )}
            {r.errorCode && <p role="alert">{t(r.errorCode)}</p>}
            {r.steps.map((u: Row) => (
              <details key={u.key} open={r.id === latest?.id}>
                <summary>
                  {site.plan.nodes.find((n: Row) => n.key === u.key)?.title ??
                    u.key}{" "}
                  · {t(u.status)}
                </summary>
                {u.output && (
                  <>
                    <p>
                      {u.output.reviewMode === "structural"
                        ? t("structuralReviewSummary")
                        : u.output.summary}
                    </p>
                    {u.output.reviewMode === "structural" && (
                      <p className="notice">{t("structuralReview")}</p>
                    )}
                    {u.output.requiresHumanVisualReview && (
                      <p className="notice">{t("humanVisualReview")}</p>
                    )}
                    <ul>
                      {u.output.findings?.map((f: Row, i: number) => (
                        <li key={i}>
                          <strong>{t(f.severity)}</strong> ·{" "}
                          {u.output.reviewMode === "structural"
                            ? t("structuralFinding_" + f.code)
                            : f.recommendation}
                        </li>
                      ))}
                    </ul>
                    <div className="b2b-screen-grid">
                      {u.output.screenshots?.map((s: Row) => (
                        <a
                          key={s.width}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span>{s.width}px</span>
                          <img
                            src={s.url}
                            alt={t("reviewScreenshot") + " " + s.width + "px"}
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                    <ul>
                      {u.output.metrics?.map((m: Row) => (
                        <li key={m.width}>
                          {m.width}px ·{" "}
                          {t(m.overflow ? "overflowDetected" : "noOverflow")} ·{" "}
                          {t("brokenImages")}: {m.brokenImages}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </details>
            ))}
          </article>
        ))
      )}
    </section>
  );
}
