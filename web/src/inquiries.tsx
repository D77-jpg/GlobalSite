import { CrmInquiryPanel } from "./crm";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { api, ApiError } from "./api";
import { inquiryMessages } from "./inquiry-i18n";
import type { Locale } from "./i18n";
import "./inquiries.css";
type Row = Record<string, any>;
type Props = { locale: Locale; role: string };
const translator = (locale: Locale) => (key: string) =>
  inquiryMessages[key as keyof typeof inquiryMessages]?.[
    locale === "zh" ? 0 : 1
  ] ?? inquiryMessages.error[locale === "zh" ? 0 : 1];
function useLoad(path: string, poll = false) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () =>
      void api(path)
        .then((d) => {
          if (live) {
            setData(d);
            setError(undefined);
          }
        })
        .catch((e) => {
          if (live) setError(e);
        });
    setData(undefined);
    load();
    const timer = poll ? setInterval(load, 5000) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path, poll, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}
function Notice({ error, t }: { error: unknown; t: (key: string) => string }) {
  return error ? (
    <p className="notice error" role="alert">
      {t(error instanceof ApiError ? error.code : "error")}
    </p>
  ) : null;
}
function Status({ value, t }: { value: string; t: (key: string) => string }) {
  return (
    <span className={"catalog-badge " + value}>
      {t(value === "ai" ? "aiState" : value)}
    </span>
  );
}
const fmt = (s: string, locale: Locale) =>
  new Date(s).toLocaleString(locale === "zh" ? "zh-CN" : "en");
export function InquiriesPage({ locale, role: _role }: Props) {
  const t = translator(locale),
    [params] = useSearchParams(),
    [filters, setFilters] = useState<Row>({
      siteId: params.get("siteId") ?? "",
      status: "",
      minSpamScore: "",
      maxSpamScore: "",
      from: "",
      to: "",
      includeDuplicates: false,
    }),
    [query, setQuery] = useState(() =>
      params.get("siteId") ? "siteId=" + params.get("siteId") : "",
    ),
    [cursor, setCursor] = useState(""),
    form = useForm<Row>({ defaultValues: filters }),
    sites = useLoad("/sites?limit=200"),
    load = useLoad("/inquiries?" + query + (cursor ? "&cursor=" + cursor : ""));
  function filter(d: Row) {
    setFilters(d);
    setCursor("");
    const q = new URLSearchParams();
    for (const key of ["siteId", "status", "minSpamScore", "maxSpamScore"])
      if (String(d[key] ?? "")) q.set(key, String(d[key]));
    if (d.from) q.set("from", new Date(d.from + "T00:00:00").toISOString());
    if (d.to) q.set("to", new Date(d.to + "T23:59:59.999").toISOString());
    q.set("includeDuplicates", String(!!d.includeDuplicates));
    setQuery(q.toString());
  }
  return (
    <div className="catalog inquiries">
      <div className="catalog-heading">
        <div>
          <h1>{t("inquiries")}</h1>
          <p>{t("sub")}</p>
        </div>
        <a
          className="button secondary"
          href={"/api/v1/inquiries/export?" + query}
        >
          {t("export")}
        </a>
      </div>
      <Notice error={load.error} t={t} />
      <form
        className="catalog-panel inquiry-filters"
        onSubmit={form.handleSubmit(filter)}
      >
        <div className="catalog-grid">
          <label>
            {t("site")}
            <select aria-label={t("site")} {...form.register("siteId")}>
              <option value="">{t("allSites")}</option>
              {sites.data?.items.map((s: Row) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("status")}
            <select aria-label={t("status")} {...form.register("status")}>
              <option value="">{t("allStatuses")}</option>
              {["new", "following", "resolved", "spam"].map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
          {["minSpamScore", "maxSpamScore"].map((k) => (
            <label key={k}>
              {t(k === "minSpamScore" ? "minScore" : "maxScore")}
              <input
                type="number"
                min="0"
                max="100"
                aria-label={t(k === "minSpamScore" ? "minScore" : "maxScore")}
                {...form.register(k)}
              />
            </label>
          ))}
          <label>
            {t("from")}
            <input
              type="date"
              aria-label={t("from")}
              {...form.register("from")}
            />
          </label>
          <label>
            {t("to")}
            <input type="date" aria-label={t("to")} {...form.register("to")} />
          </label>
        </div>
        <label className="inquiry-check">
          <input type="checkbox" {...form.register("includeDuplicates")} />
          {t("duplicates")}
        </label>
        <div className="catalog-actions">
          <button className="primary">{t("filter")}</button>
          <button type="button" className="secondary" onClick={load.reload}>
            {t("refresh")}
          </button>
          {filters.siteId && (
            <Link
              className="button secondary"
              to={"/sites/" + filters.siteId + "/inquiry-settings"}
            >
              {t("configure")}
            </Link>
          )}
        </div>
      </form>
      <p>{t("scoreHint")}</p>
      <p>{t("duplicateHint")}</p>
      <section className="catalog-panel inquiry-table">
        <table>
          <thead>
            <tr>
              <th>{t("received")}</th>
              <th>{t("contact")}</th>
              <th>{t("status")}</th>
              <th>{t("score")}</th>
              <th>{t("notification")}</th>
            </tr>
          </thead>
          <tbody>
            {load.data?.items.map((r: Row) => (
              <tr key={r.id}>
                <td>{fmt(r.receivedAt, locale)}</td>
                <td>
                  <Link to={"/inquiries/" + r.id}>{r.contact.name}</Link>
                  <div>{r.contact.company}</div>
                  <div>{r.contact.email}</div>
                </td>
                <td>
                  <Status value={r.status} t={t} />
                  {r.duplicateOf && (
                    <p>
                      <Link to={"/inquiries/" + r.duplicateOf}>
                        {t("duplicateOf")}
                      </Link>
                    </p>
                  )}
                </td>
                <td>
                  {r.spamScore}
                  <div>
                    {t(
                      r.classification === "ai" ? "aiState" : r.classification,
                    )}
                  </div>
                </td>
                <td>{t(r.notificationStatus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {load.data && !load.data.items.length && <p>{t("empty")}</p>}
      </section>
      <div className="catalog-actions">
        {cursor && <button onClick={() => setCursor("")}>{t("latest")}</button>}
        {load.data?.hasMore && (
          <button onClick={() => setCursor(load.data.nextCursor)}>
            {t("older")}
          </button>
        )}
      </div>
    </div>
  );
}
export function InquiryDetailPage({ locale, role }: Props) {
  const { id } = useParams(),
    t = translator(locale),
    load = useLoad("/inquiries/" + id, true),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    edit = role !== "viewer",
    d = load.data;
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      load.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="catalog inquiries">
      <Link to="/inquiries">{t("back")}</Link>
      <h1>{t("inquiries")}</h1>
      <Notice error={error ?? load.error} t={t} />
      {d && (
        <>
          <div className="catalog-panel">
            <h2>{d.contact.name}</h2>
            <p>
              {fmt(d.receivedAt, locale)} · <Status value={d.status} t={t} />
            </p>
            <dl className="inquiry-details">
              {["company", "email", "country", "phone"].map((k) => (
                <div key={k}>
                  <dt>{t(k)}</dt>
                  <dd>{d.contact[k] || t("notAvailable")}</dd>
                </div>
              ))}
              <div>
                <dt>{t("quantity")}</dt>
                <dd>{d.quantity ?? t("notAvailable")}</dd>
              </div>
            </dl>
            <p>
              {t("score")}: {d.spamScore} ·{" "}
              {t(d.classification === "ai" ? "aiState" : d.classification)}
            </p>
            {d.classification === "pending" && <p>{t("processingHint")}</p>}
            {edit ? (
              <label>
                {t("status")}
                <select
                  aria-label={t("status")}
                  value={d.status}
                  disabled={busy}
                  onChange={(e) =>
                    void action(() =>
                      api("/inquiries/" + id, "PATCH", {
                        revision: d.revision,
                        status: e.target.value,
                      }),
                    )
                  }
                >
                  {["new", "following", "resolved", "spam"].map((s) => (
                    <option key={s} value={s}>
                      {t(s)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>{t("readonly")}</p>
            )}
          </div>
          <section className="catalog-panel">
            <h2>{t("message")}</h2>
            <p className="inquiry-message">{d.message}</p>
            {d.productIds.length > 0 && (
              <>
                <h3>{t("products")}</h3>
                <ul>
                  {d.products.map((p: Row) => (
                    <li key={p.id}>
                      <Link to={"/products/" + p.id}>{p.name}</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {d.duplicateOf && (
              <p>
                {t("duplicateOf")}{" "}
                <Link to={"/inquiries/" + d.duplicateOf}>{t("open")}</Link>
              </p>
            )}
            {d.duplicates.length > 0 && (
              <>
                <h3>{t("duplicates")}</h3>
                {d.duplicates.map((r: Row) => (
                  <article key={r.id}>
                    <p>
                      {fmt(r.receivedAt, locale)} ·{" "}
                      <Link to={"/inquiries/" + r.id}>{t("open")}</Link>
                    </p>
                    <p className="inquiry-message">{r.message}</p>
                  </article>
                ))}
              </>
            )}
          </section>
          <section className="catalog-panel">
            <h2>{t("attachments")}</h2>
            {d.attachments.length ? (
              <ul>
                {d.attachments.map((a: Row) => (
                  <li key={a.id}>
                    <a href={a.url}>{a.fileName}</a> ·{" "}
                    {(a.bytes / 1024).toFixed(1)} KB
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("notAvailable")}</p>
            )}
          </section>
          <section className="catalog-panel">
            <h2>{t("source")}</h2>
            <p>{t("sourceHint")}</p>
            <dl className="inquiry-details">
              {[
                ["page", d.source.pageUrl],
                ["referrer", d.source.referrer],
                ["country", d.source.country],
                [
                  "device",
                  t(
                    d.source.device === "unknown"
                      ? "deviceUnknown"
                      : d.source.device,
                  ),
                ],
                ["firstVisit", fmt(d.source.firstVisitAt, locale)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{t(k)}</dt>
                  <dd>{v || t("notAvailable")}</dd>
                </div>
              ))}
              {Object.entries(d.source.utm).map(([k, v]) => (
                <div key={k}>
                  <dt>{t("utm_" + k)}</dt>
                  <dd>{String(v ?? t("notAvailable"))}</dd>
                </div>
              ))}
            </dl>
            {d.source.preview && <p>{t("preview")}</p>}
          </section>
          <section className="catalog-panel">
            <h2>{t("notes")}</h2>
            {d.notes.map((n: Row) => (
              <article key={n.id}>
                <p>{fmt(n.createdAt, locale)}</p>
                <p className="inquiry-message">{n.text}</p>
              </article>
            ))}
            {edit && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await api("/inquiries/" + id + "/notes", "POST", {
                      revision: d.revision,
                      text: note,
                    });
                    setNote("");
                  });
                }}
              >
                <label>
                  {t("noteText")}
                  <textarea
                    aria-label={t("noteText")}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={4000}
                    required
                  />
                </label>
                <button disabled={busy || !note.trim()}>{t("addNote")}</button>
              </form>
            )}
          </section>
          <CrmInquiryPanel
            crm={d.crm}
            locale={locale}
            role={role}
            inquiryId={d.id}
            onChange={load.reload}
          />
          <section className="catalog-panel">
            <h2>{t("notification")}</h2>
            <p>{t(d.notificationStatus)}</p>
            {d.deliveries.map((r: Row) => (
              <p key={r.id}>
                {t(r.status)}
                {r.errorCode ? " · " + t(r.errorCode) : ""}
              </p>
            ))}
            {edit &&
              ["failed", "blocked", "development"].includes(
                d.notificationStatus,
              ) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      api(
                        "/inquiries/" + id + "/notifications/retry",
                        "POST",
                        {},
                      ),
                    )
                  }
                >
                  {t("retry")}
                </button>
              )}
          </section>
        </>
      )}
    </div>
  );
}
export function InquirySettingsPage({ locale, role }: Props) {
  const { id } = useParams(),
    t = translator(locale),
    form = useForm<Row>(),
    [data, setData] = useState<Row>(),
    [site, setSite] = useState<Row>(),
    [members, setMembers] = useState<Row[]>([]),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [disable, setDisable] = useState(false),
    admin = role === "admin";
  useEffect(() => {
    let live = true;
    void Promise.all([
      api("/sites/" + id),
      api("/sites/" + id + "/inquiry-settings"),
      admin ? api("/members?limit=200") : Promise.resolve({ items: [] }),
    ])
      .then(([s, d, m]) => {
        if (live) {
          setSite(s);
          setData(d);
          setMembers(
            m.items.filter((m: Row) => m.status === "active" && m.userId),
          );
          form.reset({ ...d, turnstileSecret: "" });
        }
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
    };
  }, [id, admin, form]);
  return (
    <div className="catalog inquiries">
      <Link to={"/inquiries?siteId=" + id}>{t("back")}</Link>
      <h1>{t("settings")}</h1>
      <p>{site?.name}</p>
      <Notice error={error} t={t} />
      {saved && (
        <p className="notice success" role="status">
          {t("saved")}
        </p>
      )}
      <form
        className="catalog-panel"
        onSubmit={form.handleSubmit(async (d) => {
          setBusy(true);
          setError(undefined);
          setSaved(false);
          try {
            const next = await api(
              "/sites/" + id + "/inquiry-settings",
              "PUT",
              {
                revision: data?.revision ?? 0,
                enabled: !!d.enabled,
                privacyReviewed: !!d.privacyReviewed,
                aiSpamEnabled: !!d.aiSpamEnabled,
                notificationUserIds: d.notificationUserIds ?? [],
                turnstileSiteKey: disable ? null : d.turnstileSiteKey || null,
                ...(disable
                  ? { turnstileSecret: null }
                  : d.turnstileSecret
                    ? { turnstileSecret: d.turnstileSecret }
                    : {}),
              },
            );
            setData(next);
            form.reset({ ...next, turnstileSecret: "" });
            setDisable(false);
            setSaved(true);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        })}
      >
        <fieldset disabled={!admin || busy || !data}>
          <legend>{t("settings")}</legend>
          <label className="inquiry-check">
            <input type="checkbox" {...form.register("enabled")} />
            {t("enable")}
          </label>
          <p>{t("privacyHint")}</p>
          <label className="inquiry-check">
            <input type="checkbox" {...form.register("privacyReviewed")} />
            {t("privacyReviewed")}
          </label>
          <label className="inquiry-check">
            <input type="checkbox" {...form.register("aiSpamEnabled")} />
            {t("ai")}
          </label>
          <p>{t("aiHint")}</p>
          <fieldset>
            <legend>{t("recipients")}</legend>
            <p>{t("ownerDefault")}</p>
            {members.map((m) => (
              <label key={m.id} className="inquiry-check">
                <input
                  type="checkbox"
                  value={m.userId}
                  {...form.register("notificationUserIds")}
                />
                {m.name || m.email}
              </label>
            ))}
          </fieldset>
          <h2>{t("turnstile")}</h2>
          <p>{t("turnstileHint")}</p>
          <label>
            {t("siteKey")}
            <input
              autoComplete="off"
              aria-label={t("siteKey")}
              {...form.register("turnstileSiteKey")}
            />
          </label>
          <label>
            {t("secret")}
            <input
              type="password"
              autoComplete="new-password"
              aria-label={t("secret")}
              {...form.register("turnstileSecret")}
            />
          </label>
          <label className="inquiry-check">
            <input
              type="checkbox"
              checked={disable}
              onChange={(e) => setDisable(e.target.checked)}
            />
            {t("disableTurnstile")}
          </label>
          <button disabled={busy || !data}>{t("save")}</button>
        </fieldset>
      </form>
      <p>{t("rebuild")}</p>
      <Link className="button secondary" to={"/sites/" + id + "/publishing"}>
        {t("build")}
      </Link>
    </div>
  );
}
