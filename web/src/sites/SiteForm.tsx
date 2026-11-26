import { useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "../api";
import type { Locale } from "../i18n";
import { Notice, languageLabels, split, useAction, useLoad, type Row, type T } from "./shared";

export function SiteForm({
  site,
  t,
  done,
}: {
  site?: Row;
  locale: Locale;
  t: T;
  done: (r: any) => void;
}) {
  const a = useAction(),
    products = useLoad("/products?limit=100"),
    assets = useLoad("/assets?limit=100"),
    [ids, setIds] = useState<string[]>(site?.productIds ?? []),
    { register, handleSubmit } = useForm<any>({
      defaultValues: site
        ? {
            ...site,
            targetMarkets: site.targetMarkets.join(", "),
            language: site.language ?? "en",
            channelWhatsapp: site.brandChannels?.whatsapp ?? "",
            channelPhone: site.brandChannels?.phone ?? "",
            channelEmail: site.brandChannels?.email ?? "",
            channelWechat: site.brandChannels?.wechat ?? "",
            channelLinkedin: site.brandChannels?.linkedin ?? "",
            channelYoutube: site.brandChannels?.youtube ?? "",
          }
        : {
            name: "",
            templateId: "machinery",
            targetMarkets: "United States",
            language: "en",
            brandColor: "#126a54",
            logoId: "",
            status: "draft",
            channelWhatsapp: "",
            channelPhone: "",
            channelEmail: "",
            channelWechat: "",
            channelLinkedin: "",
            channelYoutube: "",
          },
    });
  return (
    <form
      className="catalog-panel"
      onSubmit={handleSubmit((v) =>
        a.run(async () => {
          const channels = Object.fromEntries(
            Object.entries({
              whatsapp: (v.channelWhatsapp ?? "").trim(),
              phone: (v.channelPhone ?? "").trim(),
              email: (v.channelEmail ?? "").trim(),
              wechat: (v.channelWechat ?? "").trim(),
              linkedin: (v.channelLinkedin ?? "").trim(),
              youtube: (v.channelYoutube ?? "").trim(),
            }).filter(([, val]) => val.length > 0),
          );
          const data = {
            name: v.name,
            businessBrief: v.businessBrief ?? site?.businessBrief ?? "",
            templateId: v.templateId,
            targetMarkets: split(v.targetMarkets),
            language: v.language || site?.language || "en",
            brandColor: site?.brandColor ?? "#126a54",
            ...(site?.buyerProfile ? { buyerProfile: site.buyerProfile } : {}),
            ...(Object.keys(channels).length ? { brandChannels: channels } : {}),
            logoId: v.logoId || null,
            productIds: ids,
            status: v.status,
          };
          done(
            await api(
              site ? "/sites/" + site.id : "/sites",
              site ? "PATCH" : "POST",
              site ? { revision: site.revision, data } : data,
            ),
          );
        }),
      )}
    >
      <fieldset disabled={a.busy}>
        <div className="catalog-grid">
          <label>
            {t("name")}
            <input
              aria-label={t("name")}
              required
              maxLength={120}
              {...register("name")}
            />
            <small>{t("nameHint")}</small>
          </label>
          <label>
            {t("language")}
            <select aria-label={t("language")} {...register("language")}>
              {Object.entries(languageLabels).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("businessBrief")}
            <textarea
              rows={4}
              maxLength={2000}
              {...register("businessBrief")}
            />
          </label>
          <label>
            {t("markets")}
            <input required {...register("targetMarkets")} />
          </label>
          <label>
            {t("logo")}
            <select aria-label={t("logo")} {...register("logoId")}>
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
          {site && (
            <label>
              {t("type")}
              <select aria-label={t("type")} {...register("status")}>
                <option value="draft">{t("draft")}</option>
                <option value="archived">{t("archived")}</option>
              </select>
            </label>
          )}
        </div>
        <details>
          <summary>{t("brandChannels")}</summary>
          <p className="muted">{t("brandChannelsHint")}</p>
          <div className="catalog-grid">
            <label>
              {t("whatsapp")}
              <input maxLength={20} {...register("channelWhatsapp")} />
            </label>
            <label>
              {t("directPhone")}
              <input maxLength={32} {...register("channelPhone")} />
            </label>
            <label>
              {t("directEmail")}
              <input type="email" maxLength={160} {...register("channelEmail")} />
            </label>
            <label>
              {t("wechat")}
              <input maxLength={60} {...register("channelWechat")} />
            </label>
            <label>
              {t("linkedin")}
              <input type="url" maxLength={240} {...register("channelLinkedin")} />
            </label>
            <label>
              {t("youtube")}
              <input type="url" maxLength={240} {...register("channelYoutube")} />
            </label>
          </div>
        </details>
        <details open>
          <summary>
            {t("products")} ({ids.length}/50)
          </summary>
          <div className="sites-choice-list">
            {products.data?.items
              .filter((p: Row) => p.status !== "archived")
              .map((p: Row) => (
                <label key={p.id} className="catalog-check">
                  <input
                    type="checkbox"
                    checked={ids.includes(p.id)}
                    onChange={(e) =>
                      setIds((old) =>
                        e.target.checked
                          ? [...old, p.id]
                          : old.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.name} <small>{p.sku}</small>
                </label>
              ))}
          </div>
        </details>
        <button disabled={a.busy}>{a.busy ? t("working") : t("save")}</button>
      </fieldset>
      <Notice t={t} error={a.error} saved={a.saved} />
    </form>
  );
}
