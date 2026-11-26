// S35: demo mode / AI illustration switches, AI fact suggestions and the logo
// studio for the site settings tab. Every action calls existing restricted
// endpoints; nothing here confirms facts, approves pages or publishes.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Locale } from "../i18n";
import { Notice, useAction, useLoad, type Row, type T } from "./shared";

const text = (zh: boolean, cn: string, en: string) => (zh ? cn : en);

export function DemoModeBanner({ site, locale }: { site: Row; locale: Locale }) {
  if (!site?.demoMode) return null;
  const zh = locale === "zh";
  return (
    <p className="notice warning" role="status">
      {text(
        zh,
        "演示模式已开启：页面可引用 AI 建议事实，演示内容未经企业确认，仅供预览，不能公开发布。",
        "Demo mode is on: pages may cite AI-suggested facts. Demo content is not confirmed by the company, is for preview only and cannot be published.",
      )}
    </p>
  );
}

export function SiteAiOptions({
  site,
  role,
  locale,
  t,
  onSaved,
}: {
  site: Row;
  role: "admin" | "editor" | "viewer";
  locale: Locale;
  t: T;
  onSaved: (site: Row) => void;
}) {
  const zh = locale === "zh",
    a = useAction(),
    s = useAction(),
    [consent, setConsent] = useState(false),
    [job, setJob] = useState<string>(),
    run = useLoad(job ? "/fact-suggestions/" + job : null, true),
    running = run.data && ["queued", "running"].includes(run.data.status);
  const save = (patch: Row) =>
    void a.run(async () =>
      onSaved(
        await api("/sites/" + site.id + "/options", "PATCH", {
          revision: site.revision,
          ...patch,
        }),
      ),
    );
  return (
    <section className="catalog-panel">
      <h2>{text(zh, "演示模式与 AI 配图", "Demo mode and AI images")}</h2>
      <DemoModeBanner site={site} locale={locale} />
      <fieldset disabled={role !== "admin" || a.busy}>
        <label className="catalog-check">
          <input
            type="checkbox"
            checked={!!site.demoMode}
            onChange={(e) => save({ demoMode: e.target.checked })}
          />
          {text(zh, "演示模式", "Demo mode")}
        </label>
        <p className="muted">
          {text(
            zh,
            "演示数据仅供预览，不能公开发布。开启后，生成与预览可引用 AI 建议事实；所有数字、年份、认证与措辞校验照常执行，含演示数据的页面不能批准或发布。关闭后只使用已确认事实。",
            "Demo data is for preview only and cannot be published. When on, generation and previews may cite AI-suggested facts; all number, year, certification and wording checks still apply, and pages with demo data cannot be approved or published. When off, only confirmed facts are used.",
          )}
        </p>
        <label className="catalog-check">
          <input
            type="checkbox"
            checked={!!site.autoImages}
            onChange={(e) => save({ autoImages: e.target.checked })}
          />
          {text(zh, "AI 自动配图", "AI illustrations")}
        </label>
        <p className="muted">
          {text(
            zh,
            "为缺图的首屏、机型卡、场景、工艺和配套区块生成示意图（按张计入图片额度，不覆盖已有图片）。需要管理员先配置 AI 图片服务；未配置或额度不足时自动跳过。生成图在网站上标注“示意图”。",
            "Generates illustrations for missing hero, product card, scene, craft and pairing images (billed per image, existing images are never replaced). Needs an AI image service; skipped when unconfigured or out of quota. Generated images are labelled “Illustrative” on the site.",
          )}
        </p>
        {role !== "admin" && (
          <p className="muted">{text(zh, "仅管理员可修改。", "Admins only.")}</p>
        )}
      </fieldset>
      <Notice t={t} error={a.error} saved={a.saved} />
      {role !== "viewer" && (
        <div className="gs-stack-sm">
          <h3>{text(zh, "AI 建议事实", "AI fact suggestions")}</h3>
          <p className="muted">
            {text(
              zh,
              "一次 AI 调用（计入 AI 额度）为缺失的数据带、参数、保修、产能、出口国家、客户案例等提出建议值，全部作为待确认候选写入事实库。",
              "One AI call (billed to your AI quota) proposes values for missing metrics, specifications, warranty, capacity, export countries and customer stories. All are stored as unconfirmed candidates in the fact library.",
            )}
          </p>
          <label className="catalog-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {text(zh, "我同意使用组织 AI 模型并计入用量", "I agree to use the organization AI model and its quota")}
          </label>
          <div className="catalog-actions">
            <button
              type="button"
              className="secondary"
              disabled={!consent || s.busy || !!running}
              onClick={() =>
                void s.run(async () => {
                  const r = await api(
                    "/sites/" + site.id + "/fact-suggestions",
                    "POST",
                    { consent: true },
                  );
                  setJob(r.id);
                })
              }
            >
              {running
                ? text(zh, "生成中…", "Generating…")
                : text(zh, "生成 AI 建议事实", "Suggest facts with AI")}
            </button>
            <Link className="button secondary" to="/facts?source=ai-suggested">
              {text(zh, "在事实库审核", "Review in fact library")}
            </Link>
          </div>
          {run.data && (
            <p className="muted" role="status">
              {run.data.status === "complete"
                ? text(
                    zh,
                    "已生成 " + run.data.resultIds.length + " 条建议，请在事实库确认、修改或拒绝。",
                    run.data.resultIds.length + " suggestions added. Confirm, edit or reject them in the fact library.",
                  )
                : run.data.status === "failed"
                  ? t(run.data.errorCode ?? "failedGeneric")
                  : text(zh, "正在生成…", "Generating…")}
            </p>
          )}
          <Notice t={t} error={s.error} />
        </div>
      )}
    </section>
  );
}

export function LogoStudio({
  site,
  role,
  locale,
  t,
  onChanged,
}: {
  site: Row;
  role: "admin" | "editor" | "viewer";
  locale: Locale;
  t: T;
  onChanged: () => void;
}) {
  const zh = locale === "zh",
    [poll, setPoll] = useState(false),
    view = useLoad("/sites/" + site.id + "/logo", poll),
    a = useAction(),
    [consent, setConsent] = useState(false),
    [file, setFile] = useState<File | null>(null),
    canEdit = role !== "viewer",
    data = view.data as Row | undefined,
    active = !!data?.runs?.some((r: Row) =>
      ["queued", "running"].includes(r.status),
    );
  // Poll only while a logo run is queued or running.
  useEffect(() => {
    setPoll(active);
  }, [active]);
  const select = (assetId: string | null) =>
    void a.run(async () => {
      await api("/sites/" + site.id + "/logo", "PUT", {
        revision: data?.revision ?? site.revision,
        assetId,
      });
      view.reload();
      onChanged();
    });
  return (
    <section className="catalog-panel">
      <h2>{text(zh, "品牌 Logo", "Brand logo")}</h2>
      <p className="muted">
        {text(
          zh,
          "已上传的真实 Logo 优先。未选定 Logo 时，网站使用按品牌名生成的 SVG 字标（拼写始终正确）。更换 Logo 会撤回已批准页面的审批。",
          "An uploaded real logo always takes priority. Without a selected logo the site uses an SVG wordmark generated from the brand name (always correctly spelled). Changing the logo withdraws page approvals.",
        )}
      </p>
      {data && (
        <div className="gs-stack-sm">
          <div className="catalog-grid">
            <figure>
              <figcaption>{text(zh, "当前", "Current")}</figcaption>
              {data.logoId ? (
                <img
                  src={"/api/v1/assets/" + data.logoId + "?variant=thumb"}
                  alt={text(zh, "当前 Logo", "Current logo")}
                />
              ) : (
                <img
                  src={"/api/v1/sites/" + site.id + "/logo/wordmark.svg"}
                  alt={text(zh, "SVG 字标", "SVG wordmark")}
                />
              )}
            </figure>
            <figure>
              <figcaption>{text(zh, "SVG 字标（兜底）", "SVG wordmark (fallback)")}</figcaption>
              <img
                src={"/api/v1/sites/" + site.id + "/logo/wordmark.svg"}
                alt={text(zh, "SVG 字标", "SVG wordmark")}
              />
              {canEdit && data.logoId && (
                <button
                  type="button"
                  className="secondary"
                  disabled={a.busy}
                  onClick={() => select(null)}
                >
                  {text(zh, "改用 SVG 字标", "Use the SVG wordmark")}
                </button>
              )}
            </figure>
          </div>
          {data.runs
            ?.flatMap((r: Row) => r.candidates ?? [])
            .slice(0, 6)
            .map((c: Row) => (
              <figure key={c.squareAssetId} className="catalog-row">
                <img
                  src={"/api/v1/assets/" + c.squareAssetId + "?variant=thumb"}
                  alt={text(zh, "AI Logo 候选", "AI logo candidate")}
                />
                <figcaption>
                  <strong>
                    {text(zh, "请核对拼写", "Check the spelling")}
                  </strong>{" "}
                  {text(
                    zh,
                    "AI 生成的文字常有错误，确认无误后再选用。",
                    "AI lettering is often wrong; select only after checking it.",
                  )}
                </figcaption>
                {canEdit && (
                  <div className="catalog-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={a.busy}
                      onClick={() => select(c.wideAssetId)}
                    >
                      {text(zh, "选用横版", "Use wide")}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={a.busy}
                      onClick={() => select(c.squareAssetId)}
                    >
                      {text(zh, "选用方形", "Use square")}
                    </button>
                  </div>
                )}
              </figure>
            ))}
          {canEdit && (
            <div className="gs-stack-sm">
              <label>
                {text(zh, "上传真实 Logo（PNG / JPEG / WebP）", "Upload your logo (PNG / JPEG / WebP)")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                className="secondary"
                disabled={!file || a.busy}
                onClick={() =>
                  void a.run(async () => {
                    const form = new FormData();
                    form.append("file", file!);
                    form.append("kind", "image");
                    const asset = await api("/assets", "POST", form);
                    await api("/sites/" + site.id + "/logo", "PUT", {
                      revision: data?.revision ?? site.revision,
                      assetId: asset.id,
                    });
                    setFile(null);
                    view.reload();
                    onChanged();
                  })
                }
              >
                {text(zh, "上传并选用", "Upload and use")}
              </button>
              {data.imagesConfigured ? (
                <>
                  <label className="catalog-check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    {text(
                      zh,
                      "生成 2 个 AI Logo 候选（按张计入图片额度）",
                      "Generate 2 AI logo candidates (billed per image)",
                    )}
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!consent || a.busy || active}
                    onClick={() =>
                      void a.run(async () => {
                        await api("/sites/" + site.id + "/logo/generate", "POST", {
                          consent: true,
                        });
                        view.reload();
                      })
                    }
                  >
                    {active
                      ? text(zh, "生成中…", "Generating…")
                      : text(zh, "生成 / 重新生成 Logo", "Generate / regenerate logos")}
                  </button>
                </>
              ) : (
                <p className="muted">{t("IMAGE_PROVIDER_MISSING")}</p>
              )}
            </div>
          )}
        </div>
      )}
      <Notice t={t} error={view.error ?? a.error} saved={a.saved} />
    </section>
  );
}
