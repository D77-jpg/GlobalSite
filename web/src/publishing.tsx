import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { api, ApiError } from "./api";
import type { Locale } from "./i18n";
import "./sites.css";
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
    [colors, setColors] = useState<string[]>([]),
    [domain, setDomain] = useState<Row>(),
    [clear, setClear] = useState(false);
  const form = useForm<Row>(),
    edit = role !== "viewer",
    admin = role === "admin";
  useEffect(() => {
    let live = true;
    void Promise.all([
      api(base),
      api(base + "/publishing-settings"),
      api(base + "/preflight"),
    ])
      .then(([s, c, r]) => {
        if (!live) return;
        setSite(s);
        setCfg(c);
        setReport(r);
        form.reset({ ...c, token: "" });
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
    <div className="catalog sites publish">
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
      <section className="catalog-panel">
        <h2>{t("settings")}</h2>
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
                ...(clear
                  ? { token: null }
                  : d.token
                    ? { token: d.token }
                    : {}),
              });
              setCfg(next);
              form.reset({ ...next, token: "" });
              setClear(false);
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
        {domain && <p role="status">{t(domain.status)}</p>}
        {edit && (
          <>
            <p>{t("paletteHint")}</p>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setColors(
                    (await api(base + "/brand-palette", "POST", {})).colors,
                  ),
                )
              }
            >
              {t("palette")}
            </button>
            <div className="publish-colors">
              {colors.map((c) => (
                <button
                  key={c}
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const s = await api(base);
                      const {
                        name,
                        templateId,
                        targetMarkets,
                        language,
                        logoId,
                        productIds,
                        status,
                      } = s;
                      setSite(
                        await api(base, "PATCH", {
                          revision: s.revision,
                          data: {
                            name,
                            templateId,
                            targetMarkets,
                            language,
                            logoId,
                            productIds,
                            status,
                            brandColor: c,
                          },
                        }),
                      );
                    })
                  }
                >
                  <svg width="28" height="18" aria-hidden="true">
                    <rect width="28" height="18" rx="3" fill={c} />
                  </svg>{" "}
                  {c}
                </button>
              ))}
            </div>
          </>
        )}
        {!edit && <p>{t("readonly")}</p>}
      </section>
      <section className="catalog-panel">
        <h2>{t("check")}</h2>
        <p>{t(report?.ready ? "ready" : "blocked")}</p>
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
              void action(async () => setReport(await api(base + "/preflight")))
            }
          >
            {t("check")}
          </button>
          {edit && (
            <>
              <button
                disabled={busy || !report?.issues?.some((i: Row) => i.fixable)}
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
      <section className="catalog-panel">
        <h2>{t("versions")}</h2>
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
                            href={"/api/v1/site-versions/" + v.id + "/preview/"}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("preview")}
                          </a>
                          <a href={"/api/v1/site-versions/" + v.id + "/export"}>
                            {t("download")}
                          </a>
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
                                  d.versionId === v.id && d.status === "live",
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
      <section className="catalog-panel">
        <h2>{t("deployments")}</h2>
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
  );
}
