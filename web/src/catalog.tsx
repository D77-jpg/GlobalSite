import { AssetTile, AssetPreview } from "./asset-library";
import { useCatalogueQuery as useLoad } from "./catalog-query";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { api, ApiError } from "./api";
import {
  ArrowUpRight,
  Box,
  ClipboardList,
  FileCheck2,
  UploadCloud,
  LayoutGrid,
  List,
  Sparkles,
  X,
} from "lucide-react";
import "./operations.css";
import { catalogText, catalogMessages } from "./catalog-i18n";
import type { Locale } from "./i18n";
type Props = { locale: Locale; role: "admin" | "editor" | "viewer" };
type Item = Record<string, any>;
function useAction() {
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  return {
    error,
    busy,
    saved,
    clear: () => {
      setError(undefined);
      setSaved(false);
    },
    run: async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(undefined);
      setSaved(false);
      try {
        await fn();
        setSaved(true);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
  };
}
function Notice({
  error,
  saved,
  t,
}: {
  error?: unknown;
  saved?: boolean;
  t: ReturnType<typeof catalogText>;
}) {
  return error ? (
    <p className="notice error" role="alert">
      {t(
        error instanceof ApiError && error.code in catalogMessages
          ? error.code
          : "failed",
      )}
    </p>
  ) : saved ? (
    <p className="notice success" role="status">
      {t("saved")}
    </p>
  ) : null;
}
function Frame({
  title,
  sub,
  t,
  error,
  children,
  actions,
}: {
  title: string;
  sub?: string;
  t: ReturnType<typeof catalogText>;
  error?: unknown;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="catalog ops-workspace">
      <header className="catalog-heading ops-header">
        <div>
          <h1>{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        <div className="catalog-actions">{actions}</div>
      </header>
      <Notice error={error} t={t} />
      {children}
    </div>
  );
}
function Rows({
  items,
  t,
  error,
  children,
}: {
  items?: Item[];
  error?: unknown;
  t: ReturnType<typeof catalogText>;
  children: (r: Item) => React.ReactNode;
}) {
  if (error && !items) return null;
  return !items ? (
    <p className="ops-loading" role="status">
      {t("loading")}
    </p>
  ) : !items.length ? (
    <p className="catalog-empty">{t("empty")}</p>
  ) : (
    <>{items.map(children)}</>
  );
}
function useCursor() {
  const [trail, setTrail] = useState([""]);
  return {
    cursor: trail[trail.length - 1],
    page: trail.length,
    reset: () => setTrail([""]),
    next: (cursor: string) =>
      setTrail((previous) =>
        previous[previous.length - 1] === cursor
          ? previous
          : [...previous, cursor],
      ),
    previous: () =>
      setTrail((previous) =>
        previous.length > 1 ? previous.slice(0, -1) : previous,
      ),
  };
}
function Pager({
  list,
  pages,
  t,
}: {
  list?: Item;
  pages: ReturnType<typeof useCursor>;
  t: ReturnType<typeof catalogText>;
}) {
  if (!pages.cursor && !list?.hasMore) return null;
  return (
    <nav className="ops-pagination" aria-label={t("pagination")}>
      {pages.page > 1 && (
        <button className="secondary" onClick={pages.previous}>
          {t("prevPage")}
        </button>
      )}
      <span>
        {t("pageIndex")} {pages.page}
      </span>
      {list?.hasMore && (
        <button
          className="secondary"
          onClick={() => pages.next(list.nextCursor)}
        >
          {t("nextPage")}
        </button>
      )}
    </nav>
  );
}
const fieldNames = [
  "name",
  "sku",
  "category",
  "description",
  "material",
  "application",
  "certifications",
  "moq",
  "leadTime",
  "specs",
  "specTable",
] as const;
function Badge({
  value,
  t,
}: {
  value: string;
  t: ReturnType<typeof catalogText>;
}) {
  return <span className={"catalog-badge " + value}>{t(value)}</span>;
}
function ProductThumb({ assetId }: { assetId?: string }) {
  const [variant, setVariant] = useState<"thumb" | "original" | "missing">(
    "thumb",
  );
  return (
    <span className="ops-product-thumb">
      {assetId && variant !== "missing" ? (
        <img
          loading="lazy"
          alt=""
          src={
            "/api/v1/assets/" +
            assetId +
            (variant === "thumb" ? "?variant=thumb" : "")
          }
          onError={() =>
            setVariant(variant === "thumb" ? "original" : "missing")
          }
        />
      ) : (
        <Box size={20} aria-hidden="true" />
      )}
    </span>
  );
}
export function ProductsPage({ locale, role }: Props) {
  const t = catalogText(locale),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    pages = useCursor(),
    { cursor } = pages;
  const { data, error } = useLoad(
    "/products?" +
      new URLSearchParams({
        q: query,
        ...(status ? { status } : {}),
        ...(cursor ? { cursor } : {}),
      }),
  );
  const rows: Item[] = data?.items ?? [];
  const drafts = rows.filter((row) => row.status === "draft");
  const needsSpecs = rows.filter(
    (row) => !row.specs?.length && !row.specTable?.rows?.length,
  );
  return (
    <Frame
      title={t("products")}
      sub={t("productsSub")}
      t={t}
      error={error}
      actions={
        role !== "viewer" && (
          <>
            <Link className="button secondary" to="/products/imports">
              {t("importExcel")}
            </Link>
            <Link className="button" to="/products/new">
              {t("addProduct")}
            </Link>
          </>
        )
      }
    >
      <form
        className="catalog-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          pages.reset();
          setQuery(q);
        }}
      >
        <input
          aria-label={t("search")}
          placeholder={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label={t("status")}
          value={status}
          onChange={(e) => {
            pages.reset();
            setStatus(e.target.value);
          }}
        >
          <option value="">{t("all")}</option>
          {["draft", "active", "archived"].map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
        <button className="secondary">{t("search")}</button>
      </form>
      <div className="ops-columns">
        <section className="ops-table-panel" aria-label={t("products")}>
          <div className="ops-panel-title">
            <h2>{t("productList")}</h2>
            {data && (
              <span>
                {rows.length} {t("thisPage")}
              </span>
            )}
          </div>
          {rows.length > 0 && (
            <div className="ops-product-line ops-colheads" aria-hidden="true">
              <span>{t("name")}</span>
              <span>{t("category")}</span>
              <span>{t("source")}</span>
              <span>{t("status")}</span>
            </div>
          )}
          {!error && (
            <Rows items={data?.items} error={error} t={t}>
              {(product) => (
                <article className="ops-product-line" key={product.id}>
                  <div className="ops-product-id">
                    <ProductThumb
                      key={product.assetIds?.[0]}
                      assetId={product.assetIds?.[0]}
                    />
                    <div>
                      <Link
                        className="catalog-name"
                        to={"/products/" + product.id}
                      >
                        {product.name}
                      </Link>
                      <small>{product.sku || "—"}</small>
                    </div>
                  </div>
                  <span className="ops-category">
                    {product.category || "—"}
                  </span>
                  <span>
                    <Badge value={product.source} t={t} />
                  </span>
                  <span>
                    <Badge value={product.status} t={t} />
                  </span>
                  <time className="ops-updated" dateTime={product.updatedAt}>
                    {t("updated")} ·{" "}
                    {new Date(product.updatedAt).toLocaleDateString(locale)}
                  </time>
                </article>
              )}
            </Rows>
          )}
          <Pager list={data} pages={pages} t={t} />
        </section>
        <aside className="ops-rail">
          <div className="ops-rail-title">
            <ClipboardList size={18} aria-hidden="true" />
            <h2>{t("catalogReview")}</h2>
          </div>
          {data && (
            <>
              <div className="ops-counts">
                <div>
                  <strong>{drafts.length}</strong>
                  <span>{t("draft")}</span>
                </div>
                <div>
                  <strong>{needsSpecs.length}</strong>
                  <span>{t("missingSpecs")}</span>
                </div>
              </div>
              <p className="ops-caption">{t("pageScope")}</p>
              {needsSpecs.slice(0, 3).map((row) => (
                <Link
                  key={row.id}
                  className="ops-task"
                  to={"/products/" + row.id}
                >
                  <span>
                    {row.name}
                    <small>{t("inspectSpecs")}</small>
                  </span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              ))}
            </>
          )}
          <Link
            className="ops-task ops-facts-link"
            to="/facts?status=candidate"
          >
            <FileCheck2 size={16} aria-hidden="true" />
            <span>{t("viewFacts")}</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </Frame>
  );
}
function Extraction({
  kind,
  id,
  t,
}: {
  kind: "product" | "asset";
  id: string;
  t: ReturnType<typeof catalogText>;
}) {
  const [consent, setConsent] = useState(false),
    [job, setJob] = useState<string>(),
    a = useAction();
  return (
    <section className="catalog-subpanel">
      <h3>{t("extract")}</h3>
      <p className="muted">{t("extractHint")}</p>
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
        className="secondary"
        disabled={!consent || a.busy}
        onClick={() =>
          void a.run(async () => {
            const r = await api("/facts/extractions", "POST", {
              kind,
              id,
              consent: true,
            });
            setJob(r.id);
          })
        }
      >
        {a.busy ? t("saving") : t("extract")}
      </button>
      <Notice error={a.error} t={t} />
      {job && <RunStatus id={job} t={t} />}
    </section>
  );
}
function RunStatus({
  id,
  t,
}: {
  id: string;
  t: ReturnType<typeof catalogText>;
}) {
  const { data, error } = useLoad("/facts/extractions/" + id, 2000);
  return (
    <div className="catalog-job" role="status">
      <strong>{t("run")}</strong> {data && <Badge value={data.status} t={t} />}
      <Notice
        error={
          error ??
          (data?.errorCode ? new ApiError(data.errorCode, 400) : undefined)
        }
        t={t}
      />
      {data?.status === "complete" && (
        <Link to="/facts?status=candidate">
          {t("viewFacts")} ({data.resultIds.length})
        </Link>
      )}
    </div>
  );
}
export function ProductEditor(props: Props) {
  const { id } = useParams(),
    t = catalogText(props.locale),
    load = useLoad(id ? "/products/" + id : null);
  if (!id && props.role === "viewer")
    return (
      <Frame
        title={t("products")}
        t={t}
        actions={
          <Link className="button secondary" to="/products">
            {t("back")}
          </Link>
        }
      >
        <p className="notice">{t("viewOnly")}</p>
      </Frame>
    );
  if (id && !load.data)
    return (
      <Frame
        title={t(id ? "editProduct" : "addProduct")}
        t={t}
        error={load.error}
      >
        {!load.error && (
          <p className="ops-loading" role="status">
            {t("loading")}
          </p>
        )}
      </Frame>
    );
  return (
    <ProductForm
      key={id ?? "new"}
      {...props}
      product={id ? load.data : undefined}
      onSaved={load.replace}
    />
  );
}
function ProductForm({
  locale,
  role,
  product,
  onSaved,
}: Props & { product?: Item; onSaved: (value: any) => void }) {
  const t = catalogText(locale),
    navigate = useNavigate(),
    a = useAction(),
    readOnly = role === "viewer";
  const defaults = product
    ? { ...product, certifications: product.certifications.join("\n") }
    : {
        name: "",
        sku: "",
        category: "",
        description: "",
        material: "",
        application: "",
        certifications: "",
        moq: "",
        leadTime: "",
        status: "draft",
        assetIds: [],
        specs: [],
      };
  const { register, control, handleSubmit, reset } = useForm<any>({
    defaultValues: defaults,
  });
  const specs = useFieldArray({ control, name: "specs" }),
    assets = useLoad("/assets?kind=image&limit=100"),
    [selected, setSelected] = useState<string[]>(product?.assetIds ?? []);
  const [columns, setColumns] = useState<string[]>(
      product?.specTable?.columns ?? [],
    ),
    [rows, setRows] = useState<string[][]>(product?.specTable?.rows ?? []),
    [headings, setHeadings] = useState(
      (product?.specTable?.columns ?? []).join(", "),
    );
  return (
    <Frame
      title={t(product ? "editProduct" : "addProduct")}
      t={t}
      error={assets.error}
      actions={
        <Link className="button secondary" to="/products">
          {t("back")}
        </Link>
      }
    >
      <nav className="ops-section-nav" aria-label={t("productSections")}>
        <a href="#product-basics">{t("productBasics")}</a>
        <a href="#product-specs">{t("specs")}</a>
        <a href="#product-images">{t("images")}</a>
      </nav>
      {readOnly && <p className="notice">{t("viewOnly")}</p>}
      <form
        className="catalog-panel"
        onSubmit={handleSubmit((values) =>
          a.run(async () => {
            const data = Object.fromEntries(
              fieldNames
                .filter((k) => !["certifications", "specTable"].includes(k))
                .map((k) => [k, values[k]]),
            );
            Object.assign(data, {
              sku: values.sku?.trim() || undefined,
              status: values.status,
              certifications: String(values.certifications ?? "")
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean),
              assetIds: selected,
              specTable: columns.length ? { columns, rows } : null,
            });
            const p = await api(
              product ? "/products/" + product.id : "/products",
              product ? "PATCH" : "POST",
              product ? { revision: product.revision, data } : data,
            );
            navigate("/products/" + p.id, { replace: true });
            onSaved(p);
            reset({ ...p, certifications: p.certifications.join("\n") });
          }),
        )}
      >
        <fieldset disabled={readOnly || a.busy}>
          <h2 id="product-basics">{t("productBasics")}</h2>
          <div className="catalog-grid">
            {(
              [
                "name",
                "sku",
                "category",
                "moq",
                "leadTime",
                "material",
                "application",
              ] as const
            ).map((key) => (
              <label key={key}>
                {t(key)}
                <input
                  {...register(key, {
                    required: key === "name",
                    maxLength:
                      key === "name"
                        ? 200
                        : key === "sku"
                          ? 80
                          : key === "category" ||
                              key === "moq" ||
                              key === "leadTime"
                            ? 120
                            : 2000,
                  })}
                />
              </label>
            ))}
            <label>
              {t("status")}
              <select aria-label={t("status")} {...register("status")}>
                {["draft", "active", "archived"].map((s) => (
                  <option key={s} value={s}>
                    {t(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t("description")}
            <textarea rows={4} maxLength={4000} {...register("description")} />
          </label>
          <label>
            {t("certifications")}
            <textarea rows={3} {...register("certifications")} />
          </label>
          <h2 id="product-specs">{t("specs")}</h2>
          <div className="catalog-specs">
            {specs.fields.map((f, i) => (
              <div className="catalog-spec-row" key={f.id}>
                {(["code", "name", "value", "unit"] as const).map((k) => (
                  <label key={k}>
                    {t(k === "name" ? "specName" : k)}
                    <input
                      {...register("specs." + i + "." + k, {
                        required: k !== "unit",
                      })}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => specs.remove(i)}
                >
                  {t("remove")}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="secondary"
            disabled={specs.fields.length >= 100}
            onClick={() =>
              specs.append({
                code: "SPEC_" + (specs.fields.length + 1),
                name: "",
                value: "",
                unit: "",
              })
            }
          >
            {t("addSpec")}
          </button>
          <section className="catalog-subpanel">
            <h2>{t("specTable")}</h2>
            <label>
              {t("columns")}
              <input
                value={headings}
                onChange={(e) => {
                  setHeadings(e.target.value);
                  const next = e.target.value
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 10);
                  setColumns(next);
                  setRows((old) =>
                    old.map((r) => next.map((_, i) => r[i] ?? "")),
                  );
                }}
              />
            </label>
            {columns.length > 0 && (
              <>
                <div className="catalog-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {columns.map((c, i) => (
                          <th key={i}>{c}</th>
                        ))}
                        <th>{t("remove")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {columns.map((c, j) => (
                            <td key={j}>
                              <input
                                aria-label={c + " " + (i + 1)}
                                maxLength={200}
                                value={r[j] ?? ""}
                                onChange={(e) =>
                                  setRows((prev) =>
                                    prev.map((row, k) =>
                                      k === i
                                        ? row.map((v, l) =>
                                            l === j ? e.target.value : v,
                                          )
                                        : row,
                                    ),
                                  )
                                }
                              />
                            </td>
                          ))}
                          <td>
                            <button
                              className="secondary"
                              type="button"
                              onClick={() =>
                                setRows((prev) =>
                                  prev.filter((_, k) => k !== i),
                                )
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
                  type="button"
                  className="secondary"
                  disabled={rows.length >= 50}
                  onClick={() => setRows((r) => [...r, columns.map(() => "")])}
                >
                  {t("addRow")}
                </button>
              </>
            )}
          </section>
          <h2 id="product-images">{t("images")}</h2>
          <p className="muted">
            {t("imageHint")} <Link to="/assets">{t("assets")}</Link>
          </p>
          <div className="catalog-picker">
            {assets.data?.items.map((file: Item) => (
              <label className="catalog-pick" key={file.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(file.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, file.id]
                        : old.filter((x) => x !== file.id),
                    )
                  }
                />
                <img src={file.thumbnailUrl ?? file.url} alt="" />
                <span>{file.fileName}</span>
              </label>
            ))}
          </div>
          {!readOnly && (
            <button type="submit" disabled={a.busy}>
              {a.busy ? t("saving") : t("save")}
            </button>
          )}
        </fieldset>
        <Notice error={a.error} saved={a.saved} t={t} />
      </form>
      {product && !readOnly && (
        <Extraction kind="product" id={product.id} t={t} />
      )}
    </Frame>
  );
}
export function ImportPage({ locale, role }: Props) {
  const t = catalogText(locale),
    [batch, setBatch] = useState<Item>(),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [file, setFile] = useState<File>(),
    a = useAction(),
    pages = useCursor(),
    { cursor } = pages,
    history = useLoad(
      "/products/imports" + (cursor ? "?cursor=" + cursor : ""),
    ),
    [pollError, setPollError] = useState<unknown>(),
    [pollVersion, setPollVersion] = useState(0);
  useEffect(() => {
    if (!batch || !["queued", "running"].includes(batch.status)) return;
    let live = true;
    const timer = setTimeout(
      () =>
        void api("/products/imports/" + batch.id)
          .then((r) => {
            if (!live) return;
            setPollError(undefined);
            setBatch(r);
            setPollVersion((v) => v + 1);
          })
          .catch((err) => {
            if (live) {
              setPollError(err);
              setPollVersion((v) => v + 1);
            }
          }),
      1500,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [batch, pollVersion]);
  const pick = (r: Item) => {
    setPollError(undefined);
    setBatch(r);
    setMapping(r.mapping);
  };
  return (
    <Frame
      title={t("importExcel")}
      sub={t("importSub")}
      t={t}
      error={history.error ?? pollError}
      actions={
        <Link to="/products" className="button secondary">
          {t("back")}
        </Link>
      }
    >
      <ol className="ops-steps" aria-label={t("importSteps")}>
        {[t("upload"), t("mapping"), t("importValid"), t("complete")].map(
          (step, index) => {
            const current = !batch
              ? 0
              : batch.status === "preview"
                ? 1
                : batch.status === "complete"
                  ? 3
                  : 2;
            return (
              <li
                key={step}
                aria-current={index === current ? "step" : undefined}
              >
                <span>{index + 1}</span>
                {step}
              </li>
            );
          },
        )}
      </ol>
      <section className="catalog-panel">
        <p>{t("importHint")}</p>
        <details>
          <summary>
            {t("specs")} / {t("specTable")}
          </summary>
          <pre>
            {
              '{"Voltage":"220 V"}\n{"columns":["Model","Weight"],"rows":[["A","10 kg"]]}'
            }
          </pre>
        </details>
        {role !== "viewer" && (
          <form
            className="catalog-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                if (!file) return;
                const form = new FormData();
                form.set("file", file);
                pick(await api("/products/imports", "POST", form));
                pages.reset();
                history.reload();
              });
            }}
          >
            <label>
              {t("file")}
              <input
                required
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            <button disabled={a.busy || !file}>{t("upload")}</button>
          </form>
        )}
        <Notice error={a.error} t={t} />
      </section>
      {batch && (
        <section className="catalog-panel">
          <div className="catalog-heading">
            <h2>{batch.fileName}</h2>
            <Badge value={batch.status} t={t} />
            <Notice
              error={
                batch.errorCode ? new ApiError(batch.errorCode, 400) : undefined
              }
              t={t}
            />
          </div>
          {batch.status === "preview" && role !== "viewer" && (
            <>
              <h3>{t("mapping")}</h3>
              <div className="catalog-grid">
                {fieldNames.map((f) => (
                  <label key={f}>
                    {t(f)}
                    <select
                      value={mapping[f] ?? ""}
                      onChange={(e) =>
                        setMapping((old) => {
                          const next = { ...old };
                          if (e.target.value) next[f] = e.target.value;
                          else delete next[f];
                          return next;
                        })
                      }
                    >
                      <option value="">{t("unmapped")}</option>
                      {batch.headers.map((h: string) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                className="secondary"
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () =>
                    pick(
                      await api("/products/imports/" + batch.id, "PATCH", {
                        revision: batch.revision,
                        mapping,
                      }),
                    ),
                  )
                }
              >
                {t("applyMapping")}
              </button>
            </>
          )}
          <p>
            {t("total")}: {batch.report.total} · {t("validRows")}:{" "}
            {batch.report.valid} · {t("errorRows")}: {batch.report.errorRows}
          </p>
          <div className="catalog-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("row")}</th>
                  <th>{t("name")}</th>
                  <th>{t("status")}</th>
                  <th>{t("errors")}</th>
                </tr>
              </thead>
              <tbody>
                {batch.report.items.map((r: Item) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.data?.name ?? "—"}</td>
                    <td>{t(r.errors.length ? "invalid" : "valid")}</td>
                    <td>
                      {r.errors.map((e: Item, i: number) => (
                        <div key={i}>
                          {t(e.field.split(".")[0])}: {t(e.code)}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="catalog-actions">
            <a
              className="button secondary"
              href={"/api/v1/products/imports/" + batch.id + "/report.csv"}
            >
              {t("errorReport")}
            </a>
            {role !== "viewer" && batch.status === "preview" && (
              <button
                disabled={a.busy || !batch.report.valid}
                onClick={() =>
                  void a.run(async () =>
                    setBatch(
                      await api(
                        "/products/imports/" + batch.id + "/confirm",
                        "POST",
                        { revision: batch.revision },
                      ),
                    ),
                  )
                }
              >
                {t("importValid")} ({batch.report.valid})
              </button>
            )}
          </div>
          {!!batch.results?.length && (
            <p>
              {t("imported")}:{" "}
              {
                batch.results.filter((r: Item) => r.status === "imported")
                  .length
              }{" "}
              / {batch.results.length}
            </p>
          )}
        </section>
      )}
      <section className="catalog-panel">
        <h2>{t("importHistory")}</h2>
        <Rows items={history.data?.items} error={history.error} t={t}>
          {(r) => (
            <div className="catalog-row" key={r.id}>
              <button className="secondary" onClick={() => pick(r)}>
                {r.fileName}
              </button>
              <Badge value={r.status} t={t} />
            </div>
          )}
        </Rows>
        <Pager list={history.data} pages={pages} t={t} />
      </section>
    </Frame>
  );
}
function ImageStudio({
  locale,
  role,
  onGenerated,
}: Props & { onGenerated: () => void }) {
  const t = catalogText(locale),
    status = useLoad("/assets/image-provider"),
    action = useAction();
  const [selectedModel, setSelectedModel] = useState(""),
    model = selectedModel || status.data?.model || "gemini-3.1-flash-image",
    [key, setKey] = useState(""),
    [subject, setSubject] = useState(""),
    [composition, setComposition] = useState("campaign"),
    [asset, setAsset] = useState("");
  return (
    <section className="catalog-panel">
      {role === "admin" && (
        <details open={status.data && !status.data.configured}>
          <summary>{t("imageConnection")}</summary>
          <p>codex789.com · {status.data?.model}</p>
          <label>
            {t("imageModel")}
            <select
              value={model}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {[
                "gemini-3.1-flash-image",
                "gpt-image-2",
                "gpt-image-2.5-sunburst",
                "gpt-image-2.6-sunburst",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            {t("imageKey")}
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <button
            disabled={!key.trim() || action.busy}
            onClick={() =>
              void action.run(async () => {
                status.replace(
                  await api("/assets/image-provider", "PUT", {
                    apiKey: key,
                    model,
                  }),
                );
                setKey("");
              })
            }
          >
            {t("save")}
          </button>
          {status.data?.configured && (
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  status.replace(
                    await api("/assets/image-provider", "PUT", { apiKey: "" }),
                  );
                  setKey("");
                })
              }
            >
              {t("disconnectImages")}
            </button>
          )}
        </details>
      )}
      {status.data?.configured ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const result = await api(
                "/assets/generate-image",
                "POST",
                { subject, composition },
                { "Idempotency-Key": crypto.randomUUID() },
              );
              setAsset(result.id);
              onGenerated();
            });
          }}
        >
          <label>
            {t("imageSubject")}
            <textarea
              required
              minLength={3}
              maxLength={600}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label>
            {t("imageComposition")}
            <select
              value={composition}
              onChange={(e) => setComposition(e.target.value)}
            >
              {["campaign", "still-life", "detail"].map((k) => (
                <option key={k} value={k}>
                  {t("shot-" + k)}
                </option>
              ))}
            </select>
          </label>
          <p>{t("imageConsent")}</p>
          <button disabled={action.busy || subject.trim().length < 3}>
            {t(action.busy ? "imageWorking" : "generateImage")}
          </button>
        </form>
      ) : (
        status.data && <p>{t("IMAGE_PROVIDER_MISSING")}</p>
      )}
      {asset && (
        <img
          src={"/api/v1/assets/" + asset + "?variant=thumb"}
          alt={t("imageResult")}
          width="240"
        />
      )}
      <Notice error={action.error ?? status.error} t={t} saved={action.saved} />
    </section>
  );
}
export function AssetsPage({ locale, role }: Props) {
  const t = catalogText(locale),
    [kind, setKind] = useState(""),
    pages = useCursor(),
    [file, setFile] = useState<File>(),
    [uploadKind, setUploadKind] = useState("image"),
    [uploadOpen, setUploadOpen] = useState(false),
    [studioOpen, setStudioOpen] = useState(false),
    [view, setView] = useState<"grid" | "list">("grid"),
    [selected, setSelected] = useState<Item>(),
    [dragging, setDragging] = useState(false),
    [fileError, setFileError] = useState(false),
    input = useRef<HTMLInputElement>(null),
    extractionPanel = useRef<HTMLElement>(null),
    a = useAction(),
    [extractId, setExtractId] = useState<string>();
  const load = useLoad(
    "/assets?" +
      new URLSearchParams({
        ...(kind ? { kind } : {}),
        ...(pages.cursor ? { cursor: pages.cursor } : {}),
      }),
  );
  useEffect(() => {
    if (extractId && extractionPanel.current) {
      extractionPanel.current.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      extractionPanel.current.focus({ preventScroll: true });
    }
  }, [extractId]);
  async function remove(asset: Item) {
    if (!window.confirm(t("deleteAsk"))) return;
    await a.run(async () => {
      await api("/assets/" + asset.id, "DELETE");
      setSelected(undefined);
      if (extractId === asset.id) setExtractId(undefined);
      load.reload();
    });
  }
  function pick(files: FileList | null) {
    if (a.busy) return;
    setFileError(!!files && files.length > 1);
    if (files?.length === 1) {
      setFile(files[0]);
      if (uploadKind !== "certificate")
        setUploadKind(
          files[0].type === "application/pdf" ? "document" : "image",
        );
    } else if (files && files.length > 1) {
      setFile(undefined);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <Frame
      title={t("assets")}
      sub={t("assetLibrarySub")}
      t={t}
      error={load.error}
      actions={
        role !== "viewer" && (
          <>
            <button
              className="secondary"
              aria-expanded={studioOpen}
              onClick={() => setStudioOpen(!studioOpen)}
            >
              <Sparkles size={16} />
              {t("imageStudio")}
            </button>
            <button
              aria-expanded={uploadOpen}
              onClick={() => setUploadOpen(!uploadOpen)}
            >
              <UploadCloud size={16} />
              {t("uploadAssets")}
            </button>
          </>
        )
      }
    >
      <div className="asset-library">
        {role !== "viewer" && studioOpen && (
          <ImageStudio
            locale={locale}
            role={role}
            onGenerated={() => {
              setKind("");
              pages.reset();
              load.reload();
            }}
          />
        )}
        {role !== "viewer" && uploadOpen && (
          <form
            className="asset-upload-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                if (!file) return;
                const body = new FormData();
                body.set("kind", uploadKind);
                body.set("file", file);
                await api("/assets", "POST", body);
                setFile(undefined);
                if (input.current) input.current.value = "";
                pages.reset();
                load.reload();
              });
            }}
          >
            <div
              className={"asset-dropzone" + (dragging ? " is-dragging" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files);
              }}
            >
              <UploadCloud size={26} />
              <div>
                <strong>{file ? file.name : t("assetDropTitle")}</strong>
                <p>{t("fileHint")}</p>
              </div>
              <label className="button secondary asset-file-label">
                {file ? t("replaceFile") : t("chooseFile")}
                <input
                  ref={input}
                  aria-label={t("file")}
                  type="file"
                  disabled={a.busy}
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(e) => pick(e.target.files)}
                />
              </label>
            </div>
            <div className="asset-upload-footer">
              <label>
                {t("kind")}
                <select
                  value={uploadKind}
                  disabled={a.busy}
                  onChange={(e) => setUploadKind(e.target.value)}
                >
                  {["image", "document", "certificate"].map((k) => (
                    <option key={k} value={k}>
                      {t(k)}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button
                  type="button"
                  className="secondary"
                  disabled={a.busy}
                  onClick={() => setUploadOpen(false)}
                >
                  {t("close")}
                </button>
                <button disabled={!file || a.busy}>
                  {a.busy ? t("saving") : t("upload")}
                </button>
              </div>
            </div>
            {fileError && (
              <p role="alert" className="notice error">
                {t("assetOneFile")}
              </p>
            )}
          </form>
        )}
        <Notice error={a.error} saved={a.saved} t={t} />
        <div className="asset-toolbar">
          <div className="asset-filters" role="group" aria-label={t("kind")}>
            {["", "image", "document", "certificate"].map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  pages.reset();
                  setKind(k);
                }}
              >
                {t(k || "all")}
              </button>
            ))}
          </div>
          <div className="asset-view-options">
            {load.data && (
              <span>
                {load.data.items.length} {t("assetsOnPage")}
              </span>
            )}
            <div role="group" aria-label={t("assetView")}>
              <button
                type="button"
                aria-label={t("gridView")}
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                <LayoutGrid size={17} />
              </button>
              <button
                type="button"
                aria-label={t("listView")}
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>
        {!load.data && !load.error && (
          <div className="asset-loading" role="status">
            {t("loading")}
          </div>
        )}
        {load.data?.items.length === 0 && (
          <div className="asset-empty">
            <UploadCloud size={32} />
            <h2>{t("noAssets")}</h2>
            <p>{t(role === "viewer" ? "noAssetsViewer" : "noAssetsHint")}</p>
            {role !== "viewer" && (
              <button onClick={() => setUploadOpen(true)}>
                {t("uploadAssets")}
              </button>
            )}
          </div>
        )}
        <div className={"asset-grid" + (view === "list" ? " asset-list" : "")}>
          {load.data?.items.map((r: Item) => (
            <AssetTile
              key={r.id}
              asset={r}
              t={t}
              canEdit={role !== "viewer"}
              busy={a.busy}
              onPreview={() => {
                a.clear();
                setSelected(r);
              }}
              onExtract={() => {
                setSelected(undefined);
                setExtractId(r.id);
              }}
              onDelete={() => void remove(r)}
            />
          ))}
        </div>
        <Pager list={load.data} pages={pages} t={t} />
        {selected && (
          <AssetPreview
            asset={selected}
            t={t}
            canEdit={role !== "viewer"}
            busy={a.busy}
            error={
              a.error instanceof ApiError
                ? t(a.error.code in catalogMessages ? a.error.code : "failed")
                : a.error
                  ? t("failed")
                  : undefined
            }
            onClose={() => setSelected(undefined)}
            onExtract={() => {
              setSelected(undefined);
              setExtractId(selected.id);
            }}
            onDelete={() => void remove(selected)}
          />
        )}
        {extractId && (
          <section
            className="asset-extraction"
            ref={extractionPanel}
            tabIndex={-1}
          >
            <div className="asset-extraction-heading">
              <h2>{t("extract")}</h2>
              <button
                className="secondary"
                aria-label={t("close")}
                onClick={() => setExtractId(undefined)}
              >
                <X size={18} />
              </button>
            </div>
            <Extraction key={extractId} kind="asset" id={extractId} t={t} />
          </section>
        )}
      </div>
    </Frame>
  );
}
export function FactsPage({ locale, role }: Props) {
  const t = catalogText(locale),
    [params] = useSearchParams(),
    [status, setStatus] = useState(params.get("status") ?? "candidate"),
    pages = useCursor(),
    { cursor } = pages,
    [editing, setEditing] = useState<Item | null | undefined>(),
    [historyId, setHistoryId] = useState<string>(),
    a = useAction();
  const load = useLoad(
    "/facts?" +
      new URLSearchParams({
        ...(status ? { status } : {}),
        ...(cursor ? { cursor } : {}),
      }),
  );
  return (
    <Frame
      title={t("facts")}
      sub={t("factsSub")}
      t={t}
      error={load.error}
      actions={
        role !== "viewer" && (
          <button onClick={() => setEditing(null)}>{t("addFact")}</button>
        )
      }
    >
      <Notice error={a.error} saved={a.saved} t={t} />
      <div className="ops-fact-tools">
        <label className="catalog-filter">
          {t("status")}
          <select
            aria-label={t("status")}
            value={status}
            onChange={(e) => {
              pages.reset();
              setStatus(e.target.value);
            }}
          >
            <option value="">{t("all")}</option>
            {["candidate", "confirmed", "rejected"].map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </label>
        <p className="ops-fact-guidance">
          <FileCheck2 size={18} aria-hidden="true" />
          {t("reviewHint")}
        </p>
      </div>
      {editing !== undefined && (
        <FactForm
          key={editing?.id ?? "new"}
          fact={editing}
          t={t}
          done={() => {
            setEditing(undefined);
            load.reload();
          }}
          close={() => setEditing(undefined)}
        />
      )}
      <div className="catalog-list">
        <Rows items={load.data?.items} error={load.error} t={t}>
          {(f) => (
            <article key={f.id} className="catalog-fact">
              <div className="catalog-heading">
                <div>
                  <small>
                    {f.type} · {t(f.subjectType)} · {t("revision")} {f.revision}
                  </small>
                  <h2>
                    {f.value}
                    {f.unit ? " " + f.unit : ""}
                  </h2>
                </div>
                <Badge value={f.status} t={t} />
              </div>
              <Source fact={f} t={t} />
              <div className="catalog-actions">
                {role === "admin" && (
                  <>
                    <button
                      disabled={a.busy || f.status === "confirmed"}
                      onClick={() =>
                        void a.run(async () => {
                          await api("/facts/" + f.id + "/confirm", "POST", {
                            revision: f.revision,
                          });
                          load.reload();
                        })
                      }
                    >
                      {t("confirm")}
                    </button>
                    <button
                      className="secondary"
                      disabled={a.busy || f.status === "rejected"}
                      onClick={() =>
                        void a.run(async () => {
                          await api("/facts/" + f.id + "/reject", "POST", {
                            revision: f.revision,
                          });
                          load.reload();
                        })
                      }
                    >
                      {t("reject")}
                    </button>
                  </>
                )}
                {role !== "viewer" && (
                  <button className="secondary" onClick={() => setEditing(f)}>
                    {t("edit")}
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() =>
                    setHistoryId(historyId === f.id ? undefined : f.id)
                  }
                >
                  {t("history")}
                </button>
              </div>
              {historyId === f.id && <FactHistory id={f.id} t={t} />}
            </article>
          )}
        </Rows>
      </div>
      <Pager list={load.data} pages={pages} t={t} />
    </Frame>
  );
}
function Source({
  fact: f,
  t,
}: {
  fact: Item;
  t: ReturnType<typeof catalogText>;
}) {
  const s = f.source;
  return (
    <div className="catalog-evidence">
      <p>
        <strong>
          {t("source")}: {t(s.kind)}
        </strong>
        {s.label ? " · " + s.label : ""}
      </p>
      <blockquote>{s.quote}</blockquote>
      {s.kind === "asset" && (
        <a href={"/api/v1/assets/" + s.refId + "/download"}>
          {t("openSource")}
        </a>
      )}
      {s.kind === "product" && (
        <Link to={"/products/" + s.refId}>{t("openSource")}</Link>
      )}
      {s.url && /^https?:\/\//i.test(s.url) && (
        <a href={s.url} target="_blank" rel="noreferrer">
          {t("openSource")}
        </a>
      )}
      {s.textVerified === false && <p className="muted">{t("machineRead")}</p>}
    </div>
  );
}
function FactHistory({
  id,
  t,
}: {
  id: string;
  t: ReturnType<typeof catalogText>;
}) {
  const { data, error } = useLoad("/facts/" + id + "/history");
  return (
    <div className="catalog-subpanel">
      <Notice error={error} t={t} />
      <Rows items={data?.items} error={error} t={t}>
        {(r) => (
          <div className="catalog-row" key={r.id}>
            <div>
              <strong>
                {t("revision")} {r.revision} · {t(r.after.status)}
              </strong>
              <p>{r.after.value}</p>
              <Source fact={r.after} t={t} />
              {r.before && (
                <details>
                  <summary>{t("history")}</summary>
                  <p>
                    {r.before.value} · {t(r.before.status)}
                  </p>
                </details>
              )}
            </div>
            <time>{new Date(r.createdAt).toLocaleString()}</time>
          </div>
        )}
      </Rows>
    </div>
  );
}
function FactForm({
  fact,
  t,
  done,
  close,
}: {
  fact: Item | null;
  t: ReturnType<typeof catalogText>;
  done: () => void;
  close: () => void;
}) {
  const a = useAction(),
    products = useLoad("/products?limit=100"),
    { register, handleSubmit, watch } = useForm<any>({
      defaultValues: fact ?? {
        subjectType: "organization",
        subjectId: "",
        type: "",
        value: "",
        unit: "",
        source: { kind: "manual", quote: "", label: "" },
      },
    });
  return (
    <form
      className="catalog-panel"
      onSubmit={handleSubmit((values) =>
        a.run(async () => {
          const data = {
            subjectType: values.subjectType,
            ...(values.subjectType === "product"
              ? { subjectId: values.subjectId }
              : {}),
            type: values.type,
            value: values.value,
            unit: values.unit || null,
            source: { ...values.source, revision: undefined },
          };
          await api(
            fact ? "/facts/" + fact.id : "/facts",
            fact ? "PATCH" : "POST",
            fact ? { revision: fact.revision, data } : data,
          );
          done();
        }),
      )}
    >
      <h2>{t(fact ? "editFact" : "addFact")}</h2>
      <fieldset disabled={a.busy}>
        <div className="catalog-grid">
          <label>
            {t("subject")}
            <select aria-label={t("subject")} {...register("subjectType")}>
              <option value="organization">{t("organization")}</option>
              <option value="product">{t("product")}</option>
            </select>
          </label>
          {watch("subjectType") === "product" && (
            <label>
              {t("product")}
              <select
                aria-label={t("product")}
                required
                {...register("subjectId")}
              >
                <option value="">{t("select")}</option>
                {products.data?.items.map((p: Item) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t("type")}
            <input
              required
              maxLength={80}
              placeholder={t("typeHint")}
              {...register("type")}
            />
          </label>
          <label>
            {t("value")}
            <input required maxLength={1200} {...register("value")} />
          </label>
          <label>
            {t("unit")}
            <input maxLength={40} {...register("unit")} />
          </label>
        </div>
        <label>
          {t("quote")}
          <textarea
            required
            rows={3}
            maxLength={1200}
            {...register("source.quote")}
          />
        </label>
        <label>
          {t("sourceLabel")}
          <input maxLength={200} {...register("source.label")} />
        </label>
        <p className="muted">{t("reviewHint")}</p>
        <div className="catalog-actions">
          <button>{t("save")}</button>
          <button type="button" className="secondary" onClick={close}>
            {t("close")}
          </button>
        </div>
      </fieldset>
      <Notice error={a.error} t={t} />
    </form>
  );
}
export function WebsitePage({ locale, role }: Props) {
  const t = catalogText(locale),
    { register, handleSubmit } = useForm({
      defaultValues: { url: "", maxPages: 5 },
    }),
    a = useAction(),
    [runId, setRunId] = useState(""),
    pages = useCursor(),
    { cursor } = pages,
    history = useLoad(
      "/website-reads" + (cursor ? "?cursor=" + cursor : ""),
      2000,
    ),
    detail = useLoad(runId ? "/website-reads/" + runId : null, 2000),
    run = runId ? detail.data : undefined;
  return (
    <Frame
      title={t("website")}
      sub={t("websiteSub")}
      t={t}
      error={history.error ?? detail.error}
    >
      {role !== "viewer" && (
        <form
          className="catalog-panel"
          onSubmit={handleSubmit((values) =>
            a.run(async () => {
              const r = await api("/website-reads", "POST", values);
              setRunId(r.id);
              pages.reset();
              history.reload();
            }),
          )}
        >
          <p>{t("readHint")}</p>
          <fieldset disabled={a.busy}>
            <div className="catalog-grid">
              <label>
                {t("url")}
                <input
                  required
                  type="url"
                  placeholder="https://example.com"
                  {...register("url", { required: true })}
                />
              </label>
              <label>
                {t("maxPages")}
                <input
                  required
                  type="number"
                  min={1}
                  max={8}
                  {...register("maxPages", {
                    valueAsNumber: true,
                    min: 1,
                    max: 8,
                  })}
                />
              </label>
            </div>
            <button>{a.busy ? t("saving") : t("read")}</button>
          </fieldset>
          <Notice error={a.error} t={t} />
        </form>
      )}
      <section className="catalog-panel">
        <h2>{t("history")}</h2>
        <Rows items={history.data?.items} error={history.error} t={t}>
          {(r) => (
            <div key={r.id} className="catalog-row">
              <button
                className="secondary catalog-url"
                onClick={() => setRunId(r.id)}
              >
                {r.url}
              </button>
              <Badge value={r.status} t={t} />
            </div>
          )}
        </Rows>
        <Pager list={history.data} pages={pages} t={t} />
      </section>
      {run && (
        <section className="catalog-panel">
          <div className="catalog-heading">
            <h2 className="catalog-url">{run.url}</h2>
            <Badge value={run.status} t={t} />
          </div>
          <Notice
            error={
              run.errorCode ? new ApiError(run.errorCode, 400) : detail.error
            }
            t={t}
          />
          <dl className="ops-output-counts">
            <div>
              <dt>{t("pages")}</dt>
              <dd>{run.pages.length}</dd>
            </div>
            <div>
              <dt>{t("newDrafts")}</dt>
              <dd>{run.resultIds.length}</dd>
            </div>
            <div>
              <dt>{t("newFacts")}</dt>
              <dd>{run.factIds.length}</dd>
            </div>
          </dl>
          {run.truncated && <p>{t("truncated")}</p>}
          <div className="catalog-actions">
            <a
              className="button secondary"
              href={"/api/v1/website-reads/" + run.id + "/migration.csv"}
            >
              {t("migration")}
            </a>
            <Link className="button secondary" to="/facts?status=candidate">
              {t("viewFacts")}
            </Link>
            <Link className="button secondary" to="/products">
              {t("products")}
            </Link>
          </div>
          <h3>{t("pages")}</h3>
          {run.pages.map((p: Item) => (
            <article key={p.url} className="catalog-subpanel">
              <strong>{p.title || "—"}</strong>
              <p className="catalog-url">{p.url}</p>
              <Badge
                value={p.status === "read" ? "readStatus" : p.status}
                t={t}
              />
              {p.headings?.length > 0 && (
                <ul>
                  {p.headings.map((h: any, i: number) => (
                    <li key={i}>{typeof h === "string" ? h : h.text}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>
      )}
    </Frame>
  );
}
