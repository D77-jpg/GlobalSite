import { useCatalogueQuery } from "./catalog-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { api, ApiError } from "./api";
import { crmMessages } from "./crm-i18n";
import type { Locale } from "./i18n";
import "./crm.css";
import "./operations.css";
type Row = Record<string, any>;
const translate = (locale: Locale) => (key: string) =>
  crmMessages[key as keyof typeof crmMessages]?.[locale === "zh" ? 0 : 1] ??
  crmMessages.error[locale === "zh" ? 0 : 1];
function Failure({ error, t }: { error: unknown; t: (key: string) => string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return error ? (
    <p ref={ref} tabIndex={-1} role="alert" className="notice error">
      {t(error instanceof ApiError ? error.code : "error")}
    </p>
  ) : null;
}
const when = (v: string | null, locale: Locale) =>
  v ? new Date(v).toLocaleString(locale === "zh" ? "zh-CN" : "en") : "—";
export function CrmConnectionPage({
  locale,
  role,
}: {
  locale: Locale;
  role: string;
}) {
  const t = translate(locale),
    connection = useCatalogueQuery(
      role === "admin" ? "/crm/connection" : null,
      5000,
    ),
    state = connection.data as Row | undefined,
    [error, setError] = useState<unknown>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [full, setFull] = useState(false),
    [candidates, setCandidates] = useState<Row[]>(),
    [candidateBusy, setCandidateBusy] = useState(false),
    [candidateError, setCandidateError] = useState<unknown>(),
    candidateRequest = useRef(0),
    [cursor, setCursor] = useState<string | null>(null);
  const form = useForm<{
    baseUrl: string;
    projectId: string;
    credential: string;
    revision: number;
  }>({
    defaultValues: { baseUrl: "", projectId: "", credential: "", revision: 0 },
  });
  const c = state?.connection;
  async function loadCandidates(next?: string) {
    const request = ++candidateRequest.current;
    setCandidateBusy(true);
    setCandidateError(undefined);
    try {
      const data = await api(
        "/crm/sync-candidates" +
          (next ? "?cursor=" + encodeURIComponent(next) : ""),
      );
      if (request !== candidateRequest.current) return;
      setCandidates((previous) =>
        next ? [...(previous ?? []), ...data.items] : data.items,
      );
      setCursor(data.nextCursor);
    } catch (error) {
      if (request === candidateRequest.current) setCandidateError(error);
    } finally {
      if (request === candidateRequest.current) setCandidateBusy(false);
    }
  }
  useEffect(() => {
    if (role !== "admin") return;
    void loadCandidates();
    return () => {
      candidateRequest.current++;
    };
  }, [role]);
  useEffect(() => {
    if (c)
      form.reset({
        baseUrl: c.baseUrl,
        projectId: c.projectId,
        credential: "",
        revision: c.revision,
      });
  }, [c?.id, c?.revision]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      await fn();
      setMessage(t("saved"));
    } catch (e) {
      setError(e);
    } finally {
      form.setValue("credential", "");
      connection.reload();
      setBusy(false);
    }
  }
  function readable(v: any) {
    if (v === null || v === undefined || v === "") return "—";
    if (Array.isArray(v))
      return v
        .map((x) =>
          typeof x === "object"
            ? x.name + ": " + x.value + (x.unit ? " " + x.unit : "")
            : x,
        )
        .join(" · ");
    return String(v);
  }
  if (role !== "admin") return <p>{t("adminOnly")}</p>;
  return (
    <div className="catalog crm ops-workspace">
      <header className="catalog-heading ops-header">
        <div>
          <h1>{t("title")}</h1>
          <p>{t("sub")}</p>
        </div>
      </header>
      <nav className="ops-section-nav" aria-label={t("sections")}>
        <a href="#crm-connection">{t("connection")}</a>
        {c?.active && <a href="#crm-sync">{t("resources")}</a>}
        <a href="#crm-candidates">{t("candidates")}</a>
        <a href="#crm-deliveries">{t("deliveries")}</a>
      </nav>
      <Failure error={error ?? connection.error} t={t} />
      {message ? (
        <p role="status" className="notice">
          {message}
        </p>
      ) : null}
      <section className="catalog-panel">
        <h2>{t("status")}</h2>
        {state ? (
          <p className={"catalog-badge " + (c?.status ?? "disconnected")}>
            {t(c?.status ?? "disconnected")}
          </p>
        ) : (
          !connection.error && <p role="status">{t("loading")}</p>
        )}
        {c?.lastErrorCode ? <p>{t(c.lastErrorCode)}</p> : null}
        <p>{t("disconnectedHint")}</p>
        <p>{t("privacyHint")}</p>
      </section>
      <form
        id="crm-connection"
        className="catalog-panel"
        onSubmit={form.handleSubmit((data) =>
          action(() =>
            api("/crm/connection", "POST", {
              ...data,
              revision:
                !c?.active &&
                (c?.baseUrl !== data.baseUrl || c?.projectId !== data.projectId)
                  ? 0
                  : data.revision,
            }),
          ),
        )}
      >
        <fieldset disabled={busy || !state}>
          <div className="catalog-grid">
            <label>
              {t("baseUrl")}
              <input
                type="url"
                readOnly={!!c?.active}
                autoComplete="off"
                placeholder="https://crm.example.com"
                aria-invalid={!!form.formState.errors.baseUrl}
                {...form.register("baseUrl", {
                  required: true,
                  maxLength: 500,
                })}
              />
            </label>
            <label>
              {t("projectId")}
              <input
                readOnly={!!c?.active}
                autoComplete="off"
                aria-invalid={!!form.formState.errors.projectId}
                {...form.register("projectId", {
                  required: true,
                  pattern: /^[a-f0-9]{24}$/,
                })}
              />
            </label>
          </div>
          <label>
            {t("credential")}
            <input
              type="password"
              autoComplete="new-password"
              aria-describedby="crm-credential-help"
              {...form.register("credential", {
                required: true,
                minLength: 20,
                maxLength: 512,
              })}
            />
          </label>
          <p id="crm-credential-help">{t("credentialHint")}</p>
          {Object.keys(form.formState.errors).length ? (
            <p role="alert">{t("invalid")}</p>
          ) : null}
          <button className="primary" type="submit">
            {t(c?.active ? "rotate" : "save")}
          </button>
        </fieldset>
      </form>
      {c?.active ? (
        <section className="catalog-panel">
          <div className="catalog-actions">
            <button
              disabled={busy}
              onClick={() =>
                void action(() => api("/crm/connection/test", "POST", {}))
              }
            >
              {t("test")}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(() =>
                  api("/crm/connection/disconnect", "POST", {
                    revision: c.revision,
                  }),
                )
              }
            >
              {t("disconnect")}
            </button>
          </div>
          <h2 id="crm-sync">{t("resources")}</h2>
          <p>{t("syncHint")}</p>
          <label className="inquiry-check">
            <input
              type="checkbox"
              checked={full}
              onChange={(e) => setFull(e.target.checked)}
            />
            {t("full")}
          </label>
          <button
            disabled={busy || !["connected", "degraded"].includes(c.status)}
            onClick={() =>
              void action(async () => {
                await api("/crm/connection/sync", "POST", { full });
                await loadCandidates();
              })
            }
          >
            {t("sync")}
          </button>
          <div className="crm-table">
            <table>
              <thead>
                <tr>
                  {["resource", "status", "lastSync", "processed"].map((k) => (
                    <th key={k}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state?.syncStates.map((s: Row) => (
                  <tr key={s.id}>
                    <td>{t(s.resource)}</td>
                    <td>
                      {t(s.status)}
                      {s.lastErrorCode ? <p>{t(s.lastErrorCode)}</p> : null}
                    </td>
                    <td>{when(s.lastSuccessAt, locale)}</td>
                    <td>{s.imported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <section className="catalog-panel">
        <h2 id="crm-candidates">{t("candidates")}</h2>
        <p>{t("candidateHint")}</p>
        <Link to="/facts">{t("facts")}</Link>{" "}
        <button
          className="secondary"
          disabled={candidateBusy || busy}
          onClick={() => void loadCandidates()}
        >
          {t("details")}
        </button>
        <Failure error={candidateError} t={t} />
        {!candidates && !candidateError && <p role="status">{t("loading")}</p>}
        {candidates?.length === 0 && <p>{t("noCandidates")}</p>}
        {candidates?.map((p) => (
          <article key={p.id} className="crm-candidate">
            <h3>{p.localName}</h3>
            <p>
              {t("remoteName")}: {p.remoteName ?? "—"}
            </p>
            {p.sourceStatus !== "active" ? (
              <p className="notice error">{t("sourceWithdrawn")}</p>
            ) : null}
            {p.data ? (
              <details>
                <summary>{t("details")}</summary>
                <dl className="crm-fields">
                  {[
                    "name",
                    "category",
                    "material",
                    "application",
                    "certifications",
                    "moq",
                    "leadTime",
                    "description",
                    "specs",
                  ].map((key) => (
                    <div key={key}>
                      <dt>{t("field_" + key)}</dt>
                      <dd>{readable(p.data[key])}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
            {p.candidateHash ? (
              <div className="catalog-actions">
                {["accept", "reject"].map((decision) => (
                  <button
                    key={decision}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(
                          "/crm/sync-candidates/" + p.id + "/review",
                          "POST",
                          {
                            revision: p.revision,
                            candidateHash: p.candidateHash,
                            decision,
                          },
                        );
                        await loadCandidates();
                      })
                    }
                  >
                    {t(decision)}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        {cursor ? (
          <button
            disabled={candidateBusy || busy}
            onClick={() => void loadCandidates(cursor)}
          >
            {t("more")}
          </button>
        ) : null}
      </section>
      <section className="catalog-panel">
        <h2 id="crm-deliveries">{t("deliveries")}</h2>
        {state && !state.deliveries.length ? <p>{t("noDeliveries")}</p> : null}
        {state?.deliveries.map((d: Row) => (
          <article key={d.id} className="crm-candidate">
            <Link to={"/inquiries/" + d.inquiryId}>{t("openInquiry")}</Link>
            <p>
              {t(d.status)} · {t("attempts")}: {d.attempts}
            </p>
            {d.lastErrorCode ? <p>{t(d.lastErrorCode)}</p> : null}
            {d.customerUrl ? (
              <a href={d.customerUrl} target="_blank" rel="noreferrer">
                {t("openCrm")}
              </a>
            ) : null}
            {["failed", "retry", "paused"].includes(d.status) ? (
              <button
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    api("/crm/deliveries/" + d.id + "/retry", "POST", {}),
                  )
                }
              >
                {t("retryButton")}
              </button>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
export function CrmInquiryPanel({
  crm,
  locale,
  role,
  inquiryId,
  onChange,
}: {
  crm: Row | null;
  locale: Locale;
  role: string;
  inquiryId: string;
  onChange: () => void;
}) {
  const t = translate(locale),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    setError(undefined);
    try {
      await api("/inquiries/" + inquiryId + "/crm/retry", "POST", {});
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="catalog-panel crm">
      <h2>{t("crmInquiry")}</h2>
      <p>{crm ? t(crm.status) : t("noConnection")}</p>
      {crm?.lastErrorCode ? <p>{t(crm.lastErrorCode)}</p> : null}
      {crm?.customerUrl ? (
        <a href={crm.customerUrl} target="_blank" rel="noreferrer">
          {t("openCrm")}
        </a>
      ) : null}
      {crm?.outcome ? (
        <p>
          {t(crm.outcome.toStatus)} · {when(crm.outcome.occurredAt, locale)}
          <br />
          {t("outcomeHint")}
        </p>
      ) : null}
      <Failure error={error} t={t} />
      {role === "admin" &&
      !["sent", "sending", "blocked"].includes(crm?.status) ? (
        <button disabled={busy} onClick={() => void retry()}>
          {t(crm ? "retryButton" : "push")}
        </button>
      ) : null}
      {role === "admin" ? (
        <p>
          <Link to="/crm">{t("title")}</Link>
        </p>
      ) : null}
    </section>
  );
}
