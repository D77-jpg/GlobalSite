import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { api, ApiError } from "./api";
import type { Locale } from "./i18n";
import {
  ClipboardCheck,
  PackageCheck,
  Settings2,
  UploadCloud,
} from "lucide-react";
import { st } from "./sites-i18n";
import { publishingMessages } from "./publishing-i18n";

type Row = Record<string, any>;
export function PublishPage({
  locale,
  role,
}: {
  locale: Locale;
  role: string;
}) {
  const { id } = useParams(),
    base = "/sites/" + id,
    t = (key: string) =>
      publishingMessages[key as keyof typeof publishingMessages]?.[
        locale === "zh" ? 0 : 1
      ] ?? publishingMessages.error[locale === "zh" ? 0 : 1];
  const [site, setSite] = useState<Row>(),
    [cfg, setCfg] = useState<Row>(),
    [report, setReport] = useState<Row>(),
    [versions, setVersions] = useState<Row[]>([]),
    [deployments, setDeployments] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [historyLoaded, setHistoryLoaded] = useState(false),
    [domain, setDomain] = useState<Row>(),
    [clear, setClear] = useState(false),
    [clearWebhookSecret, setClearWebhookSecret] = useState(false),
    [assets, setAssets] = useState<Row[]>([]),
    [webhookMsg, setWebhookMsg] = useState("");
  const form = useForm<Row>(),
    edit = role !== "viewer",
    admin = role === "admin";
  function formatRedirects(list: Row[] | undefined) {
    return (list ?? []).map((r) => `${r.from} ${r.to} ${r.status}`).join("\n");
  }
  function parseRedirects(raw: string) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [from, to, code] = line.split(/\s+/);
        return {
          from: from || "",
          to: to || "",
          status: code === "302" ? 302 : 301,
        };
      });
  }
  useEffect(() => {
    let live = true;
    void Promise.all([
      api(base),
      api(base + "/publishing-settings"),
      api(base + "/preflight"),
      api<{ items: Row[] }>("/assets?limit=100").catch(() => ({ items: [] })),
    ])
      .then(([s, c, r, a]) => {
        if (!live) return;
        setSite(s);
        setCfg(c);
        setReport(r);
        setAssets(
          (a.items ?? []).filter((item: Row) =>
            String(item.mime || "").startsWith("image/"),
          ),
        );
        const seo = c.seoAnalytics ?? {};
        form.reset({
          ...c,
          token: "",
          webhookSecret: "",
          ga4MeasurementId: seo.ga4MeasurementId ?? "",
          gtmContainerId: seo.gtmContainerId ?? "",
          metaPixelId: seo.metaPixelId ?? "",
          googleSiteVerification: seo.googleSiteVerification ?? "",
          bingSiteVerification: seo.bingSiteVerification ?? "",
          ogImageAssetId: seo.ogImageAssetId ?? "",
          redirectsText: formatRedirects(seo.redirects),
        });
      })
      .catch((e) => {
        if (live) setError(e.code ?? "error");
      });
    return () => {
      live = false;
    };
  }, [base, form]);
  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all([api(base + "/versions"), api(base + "/deployments")])
        .then(([v, d]) => {
          if (live) {
            setHistoryLoaded(true);
            setVersions(v);
            setDeployments(d);
          }
        })
        .catch((e) => {
          if (live) setError(e.code ?? "error");
        });
    load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [base]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await fn();
      setSaved(true);
      setReport(await api(base + "/preflight"));
      setVersions(await api(base + "/versions"));
      setDeployments(await api(base + "/deployments"));
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "error");
    } finally {
      setBusy(false);
    }
  }
  async function deploy(v: Row, rollback = false) {
    if (!window.confirm(t("confirm"))) return;
    await action(() =>
      api(
        base + (rollback ? "/rollback" : "/deployments"),
        "POST",
        { versionId: v.id },
        { "Idempotency-Key": crypto.randomUUID() },
      ),
    );
  }
  return (
    <div className="catalog sites publish studio-publish">
      <div className="catalog-heading">
        <div>
          <Link to={base}>{t("back")}</Link>
          <h1>{t("title")}</h1>
          <p>{site?.name}</p>
          {versions.some((v) => v.status === "ready") && (
            <Link className="button primary" to={base + "/preview"}>
              {st(locale)("previewSite")}
            </Link>
          )}
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
      {saved && (
        <p className="notice success" role="status">
          {t("saved")}
        </p>
      )}
      {webhookMsg && (
        <p className="notice success" role="status">
          {webhookMsg}
        </p>
      )}
      <nav className="release-nav" aria-label={t("title")}>
        <a href="#release-versions">{t("versions")}</a>
        <a href="#release-preflight">{t("check")}</a>
        <a href="#release-settings">{t("settings")}</a>
        <a href="#release-deployments">{t("deployments")}</a>
      </nav>
      <div className="release-layout">
        <div className="release-main">
          <section className="catalog-panel" id="release-versions">
            <div className="studio-section-heading">
              <PackageCheck size={20} />
              <h2>{t("versions")}</h2>
            </div>
            <p>{t("previewHint")}</p>
            <p>{t("formHint")}</p>
            <div className="publish-table">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("created")}</th>
                    <th>{t("state")}</th>
                    <th>{t("label")}</th>
                  </tr>
                </thead>
                <tbody>
                  {!versions.length && (
                    <tr>
                      <td colSpan={4} className="studio-empty-line">
                        {t(historyLoaded ? "noVersions" : "loading")}
                      </td>
                    </tr>
                  )}
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <td>{v.number}</td>
                      <td>
                        {new Date(v.createdAt).toLocaleString(
                          locale === "zh" ? "zh-CN" : "en",
                        )}
                      </td>
                      <td>
                        {t(v.status === "ready" ? "versionReady" : v.status)}
                        {v.errorCode && <p role="status">{t(v.errorCode)}</p>}
                      </td>
                      <td>
                        <div className="catalog-actions">
                          {v.status === "ready" && (
                            <>
                              <a
                                href={
                                  "/api/v1/site-versions/" + v.id + "/preview/"
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {t("preview")}
                              </a>
                              <a
                                href={
                                  "/api/v1/site-versions/" + v.id + "/export"
                                }
                              >
                                {t("download")}
                              </a>
                              {admin && cfg?.deployWebhookUrl && (
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(async () => {
                                      setWebhookMsg("");
                                      await api(
                                        "/site-versions/" + v.id + "/webhook",
                                        "POST",
                                        {},
                                      );
                                      setWebhookMsg(t("webhookSent"));
                                    })
                                  }
                                >
                                  {t("triggerWebhook")}
                                </button>
                              )}
                              {admin && cfg?.configured && (
                                <>
                                  <button
                                    disabled={
                                      busy ||
                                      deployments.some((d) =>
                                        [
                                          "queued",
                                          "uploading",
                                          "verifying",
                                          "unknown",
                                        ].includes(d.status),
                                      )
                                    }
                                    onClick={() => void deploy(v)}
                                  >
                                    {t("publish")}
                                  </button>
                                  {deployments.some(
                                    (d) =>
                                      d.versionId === v.id &&
                                      d.status === "live",
                                  ) && (
                                    <button
                                      disabled={
                                        busy ||
                                        deployments.some((d) =>
                                          [
                                            "queued",
                                            "uploading",
                                            "verifying",
                                            "unknown",
                                          ].includes(d.status),
                                        )
                                      }
                                      onClick={() => void deploy(v, true)}
                                    >
                                      {t("rollback")}
                                    </button>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="catalog-panel" id="release-deployments">
            <div className="studio-section-heading">
              <UploadCloud size={20} />
              <h2>{t("deployments")}</h2>
            </div>
            {!deployments.length && (
              <p className="studio-empty-line">
                {t(historyLoaded ? "noDeployments" : "loading")}
              </p>
            )}
            <ul>
              {deployments.map((d) => (
                <li key={d.id}>
                  {new Date(d.createdAt).toLocaleString()} · {t(d.status)}
                  {d.errorCode && <p>{t(d.errorCode)}</p>}
                  {admin && ["unknown", "verifying"].includes(d.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          api(
                            "/site-deployments/" + d.id + "/reconcile",
                            "POST",
                            {},
                          ),
                        )
                      }
                    >
                      {t("reconcile")}
                    </button>
                  )}
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside className="release-rail">
          <section className="catalog-panel" id="release-preflight">
            <div className="studio-section-heading">
              <ClipboardCheck size={20} />
              <h2>{t("check")}</h2>
            </div>
            <p
              role="status"
              className={
                report
                  ? "studio-preflight " +
                    (report.ready ? "is-ready" : "is-blocked")
                  : ""
              }
            >
              {t(report ? (report.ready ? "ready" : "blocked") : "loading")}
            </p>
            <ul>
              {report?.issues?.map((i: Row, n: number) => (
                <li key={n}>
                  {i.pageId ? (
                    <Link to={"/pages/" + i.pageId}>{i.path}</Link>
                  ) : null}{" "}
                  {t(i.code)}
                </li>
              ))}
            </ul>
            <div className="catalog-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setReport(await api(base + "/preflight")),
                  )
                }
              >
                {t("check")}
              </button>
              {edit && (
                <>
                  <button
                    disabled={
                      busy || !report?.issues?.some((i: Row) => i.fixable)
                    }
                    onClick={() =>
                      void action(async () =>
                        setReport(
                          await api(base + "/preflight/repair", "POST", {}),
                        ),
                      )
                    }
                  >
                    {t("repair")}
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !report?.ready}
                    onClick={() =>
                      void action(() =>
                        api(
                          base + "/builds",
                          "POST",
                          {},
                          { "Idempotency-Key": crypto.randomUUID() },
                        ),
                      )
                    }
                  >
                    {t("build")}
                  </button>
                </>
              )}
            </div>
            <p>{t("repairHint")}</p>
          </section>
          <details
            className="catalog-panel studio-settings"
            id="release-settings"
            open={cfg && !cfg.canonicalBaseUrl ? true : undefined}
          >
            <summary>
              <Settings2 size={18} />
              {t("settings")}
            </summary>
            <p>{t(cfg?.configured ? "configured" : "offline")}</p>
            <form
              onSubmit={form.handleSubmit((d) =>
                action(async () => {
                  const next = await api(base + "/publishing-settings", "PUT", {
                    revision: cfg?.revision ?? 0,
                    canonicalBaseUrl: d.canonicalBaseUrl || null,
                    accountId: d.accountId || null,
                    projectName: d.projectName || null,
                    productionBranch: d.productionBranch || "main",
                    domain: d.domain || null,
                    deployWebhookUrl: d.deployWebhookUrl?.trim() || null,
                    ...(clear
                      ? { token: null }
                      : d.token
                        ? { token: d.token }
                        : {}),
                    ...(clearWebhookSecret
                      ? { webhookSecret: null }
                      : d.webhookSecret
                        ? { webhookSecret: d.webhookSecret }
                        : {}),
                    seoAnalytics: {
                      ga4MeasurementId: d.ga4MeasurementId?.trim() || null,
                      gtmContainerId: d.gtmContainerId?.trim() || null,
                      metaPixelId: d.metaPixelId?.trim() || null,
                      googleSiteVerification:
                        d.googleSiteVerification?.trim() || null,
                      bingSiteVerification:
                        d.bingSiteVerification?.trim() || null,
                      ogImageAssetId: d.ogImageAssetId || null,
                      redirects: parseRedirects(d.redirectsText || ""),
                    },
                  });
                  setCfg(next);
                  const seo = next.seoAnalytics ?? {};
                  form.reset({
                    ...next,
                    token: "",
                    webhookSecret: "",
                    ga4MeasurementId: seo.ga4MeasurementId ?? "",
                    gtmContainerId: seo.gtmContainerId ?? "",
                    metaPixelId: seo.metaPixelId ?? "",
                    googleSiteVerification: seo.googleSiteVerification ?? "",
                    bingSiteVerification: seo.bingSiteVerification ?? "",
                    ogImageAssetId: seo.ogImageAssetId ?? "",
                    redirectsText: formatRedirects(seo.redirects),
                  });
                  setClear(false);
                  setClearWebhookSecret(false);
                }),
              )}
            >
              <fieldset disabled={!admin || busy || !cfg}>
                <div className="catalog-grid">
                  {[
                    "canonicalBaseUrl",
                    "accountId",
                    "projectName",
                    "productionBranch",
                    "domain",
                  ].map((k, i) => (
                    <label key={k}>
                      {t(["base", "account", "project", "branch", "domain"][i])}
                      <input
                        aria-label={t(
                          ["base", "account", "project", "branch", "domain"][i],
                        )}
                        {...form.register(k)}
                        autoComplete="off"
                      />
                    </label>
                  ))}
                </div>
                <label>
                  {t("token")}
                  <input
                    type="password"
                    aria-label={t("token")}
                    {...form.register("token")}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={clear}
                    onChange={(e) => setClear(e.target.checked)}
                  />
                  {t("clear")}
                </label>
                <details className="studio-subdetails">
                  <summary>{t("seoSection")}</summary>
                  <p className="ops-caption">{t("seoHint")}</p>
                  <div className="catalog-grid">
                    <label>
                      {t("ga4")}
                      <input
                        {...form.register("ga4MeasurementId")}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      {t("gtm")}
                      <input
                        {...form.register("gtmContainerId")}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      {t("metaPixel")}
                      <input
                        {...form.register("metaPixelId")}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      {t("googleVerify")}
                      <input
                        {...form.register("googleSiteVerification")}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      {t("bingVerify")}
                      <input
                        {...form.register("bingSiteVerification")}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      {t("ogImage")}
                      <select {...form.register("ogImageAssetId")}>
                        <option value="">{t("ogImageAuto")}</option>
                        {assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.fileName}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    {t("redirects")}
                    <textarea
                      rows={3}
                      {...form.register("redirectsText")}
                      placeholder="/old-products /products 301"
                    />
                  </label>
                </details>
                <details className="studio-subdetails">
                  <summary>{t("webhookSection")}</summary>
                  <label>
                    {t("webhookUrl")}
                    <input
                      {...form.register("deployWebhookUrl")}
                      autoComplete="off"
                      placeholder="https://api.example.com/deploy-hook"
                    />
                  </label>
                  <label>
                    {t("webhookSecret")}
                    <input
                      type="password"
                      {...form.register("webhookSecret")}
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={clearWebhookSecret}
                      onChange={(e) => setClearWebhookSecret(e.target.checked)}
                    />
                    {t("clearWebhookSecret")}
                  </label>
                </details>
                <button className="primary" disabled={busy || !cfg}>
                  {t("save")}
                </button>
              </fieldset>
            </form>
            <p>{t("domainHint")}</p>
            {admin && (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setDomain(await api(base + "/domain-check", "POST", {})),
                  )
                }
              >
                {t("domainCheck")}
              </button>
            )}
            {domain && (
              <div className="diag-panel" role="status">
                <p>{t(domain.status)}</p>
                {domain.recommendedRecord && (
                  <p className="diag-record">
                    <strong>{t("recommendedDns")}:</strong>{" "}
                    <code>
                      {domain.recommendedRecord.type}{" "}
                      {domain.recommendedRecord.name} →{" "}
                      {domain.recommendedRecord.target}
                    </code>
                  </p>
                )}
                {!!domain.diagnostics?.length && (
                  <ul className="diag-list">
                    {domain.diagnostics.map((d: Row, idx: number) => (
                      <li key={idx} className={d.ok ? "is-ok" : "is-fail"}>
                        {d.step.toUpperCase()} · {t(d.detailCode)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </details>
        </aside>
      </div>
    </div>
  );
}
