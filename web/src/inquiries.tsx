import { useCatalogueQuery as useLoad } from "./catalog-query";
import { CrmInquiryPanel } from "./crm";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { api, ApiError } from "./api";
import { inquiryMessages } from "./inquiry-i18n";
import type { Locale } from "./i18n";
import "./inquiries.css";
import "./operations.css";
type Row = Record<string, any>;
type Props = { locale: Locale; role: string };
const translator = (locale: Locale) => (key: string) =>
  inquiryMessages[key as keyof typeof inquiryMessages]?.[
    locale === "zh" ? 0 : 1
  ] ?? inquiryMessages.error[locale === "zh" ? 0 : 1];
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
export function InquiriesPage({ locale }: Props) {
  const [params] = useSearchParams();
  const initialSiteId = params.get("siteId") ?? "";
  return (
    <InquiryInbox
      key={initialSiteId}
      locale={locale}
      initialSiteId={initialSiteId}
    />
  );
}
type SiteChoice = { id: string; name: string };
function InquirySitePicker({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (id: string) => void;
  t: (key: string) => string;
}) {
  const [sites, setSites] = useState<SiteChoice[]>([]);
  const [request, setRequest] = useState({ cursor: "", attempt: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ limit: "100" });
    if (request.cursor) query.set("cursor", request.cursor);
    api<{ items: SiteChoice[]; nextCursor: string | null }>("/sites?" + query)
      .then((page) => {
        if (!active) return;
        setSites((previous) => {
          const merged = new Map(previous.map((site) => [site.id, site]));
          for (const site of page.items) merged.set(site.id, site);
          return [...merged.values()];
        });
        setNextCursor(
          page.nextCursor === request.cursor ? null : page.nextCursor,
        );
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [request]);

  function loadPage(cursor: string) {
    setState("loading");
    setRequest((previous) => ({ cursor, attempt: previous.attempt + 1 }));
  }

  return (
    <div>
      <label>
        {t("site")}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t("allSites")}</option>
          {value && !sites.some((site) => site.id === value) && (
            <option value={value}>{t("selectedSite")}</option>
          )}
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </label>
      {state === "loading" && (
        <span className="ops-caption" role="status">
          {t("loadingSites")}
        </span>
      )}
      {state === "error" && (
        <>
          <p className="ops-caption" role="alert">
            {t("sitesFailed")}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => loadPage(request.cursor)}
          >
            {t("retrySites")}
          </button>
        </>
      )}
      {state === "ready" && nextCursor && (
        <button
          type="button"
          className="secondary"
          onClick={() => loadPage(nextCursor)}
        >
          {t("moreSites")}
        </button>
      )}
    </div>
  );
}
function InquiryInbox({
  locale,
  initialSiteId,
}: {
  locale: Locale;
  initialSiteId: string;
}) {
  const t = translator(locale),
    [filters, setFilters] = useState<Row>({
      siteId: initialSiteId,
      status: "",
      minSpamScore: "",
      maxSpamScore: "",
      from: "",
      to: "",
      includeDuplicates: false,
    }),
    [query, setQuery] = useState(() =>
      initialSiteId
        ? new URLSearchParams({ siteId: initialSiteId }).toString()
        : "",
    ),
    [cursor, setCursor] = useState(""),
    form = useForm<Row>({ defaultValues: filters }),
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
    <div className="catalog inquiries ops-workspace">
      <header className="catalog-heading ops-header">
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
      </header>
      <Notice error={load.error} t={t} />
      <form
        className="catalog-panel inquiry-filters"
        onSubmit={form.handleSubmit(filter)}
      >
        <div className="catalog-grid">
          <InquirySitePicker
            t={t}
            value={form.watch("siteId")}
            onChange={(siteId) => form.setValue("siteId", siteId)}
          />
        </div>
        <div className="ops-status-tabs" role="group" aria-label={t("status")}>
          {["", "new", "following", "resolved", "spam"].map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={filters.status === status}
              onClick={() => {
                form.setValue("status", status);
                filter(form.getValues());
              }}
            >
              {t(status || "allStatuses")}
            </button>
          ))}
        </div>
        <details className="ops-advanced">
          <summary>
            {t("advancedFilters")}
            {[
              filters.minSpamScore,
              filters.maxSpamScore,
              filters.from,
              filters.to,
              filters.includeDuplicates,
            ].some(Boolean) && " · " + t("activeFilters")}
          </summary>
          <div className="catalog-grid">
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
              <input
                type="date"
                aria-label={t("to")}
                {...form.register("to")}
              />
            </label>
          </div>
          <label className="inquiry-check">
            <input type="checkbox" {...form.register("includeDuplicates")} />
            {t("duplicates")}
          </label>
          <p className="ops-caption">
            {t("scoreHint")} {t("duplicateHint")}
          </p>
        </details>
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
      <section className="catalog-panel inquiry-table">
        <div className="ops-panel-title">
          <h2>{t("inbox")}</h2>
          {load.data && (
            <span>
              {load.data.items.length} {t("thisPage")}
            </span>
          )}
        </div>
        {!load.data && !load.error && (
          <p role="status" className="ops-loading">
            {t("loading")}
          </p>
        )}
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
                <td data-label={t("received")}>{fmt(r.receivedAt, locale)}</td>
                <td data-label={t("contact")}>
                  <Link to={"/inquiries/" + r.id}>{r.contact.name}</Link>
                  <div>{r.contact.company}</div>
                  <div>{r.contact.email}</div>
                </td>
                <td data-label={t("status")}>
                  <Status value={r.status} t={t} />
                  {r.duplicateOf && (
                    <p>
                      <Link to={"/inquiries/" + r.duplicateOf}>
                        {t("duplicateOf")}
                      </Link>
                    </p>
                  )}
                </td>
                <td data-label={t("score")}>
                  {r.spamScore ?? "—"}
                  <div>
                    {t(
                      r.classification === "ai" ? "aiState" : r.classification,
                    )}
                  </div>
                </td>
                <td data-label={t("notification")}>
                  {t(r.notificationStatus)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {load.data && !load.data.items.length && (
          <p className="catalog-empty">{t("empty")}</p>
        )}
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
export function InquiryDetailPage(props: Props) {
  const { id } = useParams();
  return <InquiryDetailPageBody key={id} {...props} id={id!} />;
}
function InquiryDetailPageBody({ locale, role, id }: Props & { id: string }) {
  const t = translator(locale),
    load = useLoad("/inquiries/" + id, 5000),
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
    <div className="catalog inquiries ops-workspace">
      <header className="catalog-heading ops-header">
        <div>
          <h1>{t("details")}</h1>
          {d && (
            <p>
              {d.contact.company} · {fmt(d.receivedAt, locale)}
            </p>
          )}
        </div>
        <Link className="button secondary" to="/inquiries">
          {t("back")}
        </Link>
      </header>
      {!d && !load.error && (
        <p role="status" className="ops-loading">
          {t("loading")}
        </p>
      )}
      <Notice error={error ?? load.error} t={t} />
      {d && (
        <>
          <nav className="ops-section-nav" aria-label={t("sections")}>
            <a href="#inquiry-contact">{t("contact")}</a>
            <a href="#inquiry-message">{t("message")}</a>
            <a href="#inquiry-notes">{t("followUp")}</a>
            <a href="#inquiry-delivery">{t("delivery")}</a>
          </nav>
          <div id="inquiry-contact" className="catalog-panel">
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
          <section id="inquiry-message" className="catalog-panel">
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
          <section id="inquiry-notes" className="catalog-panel">
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
          <section id="inquiry-delivery" className="catalog-panel">
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
export function InquirySettingsPage(props: Props) {
  const { id } = useParams();
  return <InquirySettingsPageBody key={id} {...props} id={id!} />;
}
function InquirySettingsPageBody({ locale, role, id }: Props & { id: string }) {
  const t = translator(locale),
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
    <div className="catalog inquiries ops-workspace">
      <header className="catalog-heading ops-header">
        <div>
          <h1>{t("settings")}</h1>
          <p>{site?.name}</p>
        </div>
        <Link className="button secondary" to={"/inquiries?siteId=" + id}>
          {t("back")}
        </Link>
      </header>
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
