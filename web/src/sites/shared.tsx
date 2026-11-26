import { useEffect, useState } from "react";
import type React from "react";
import { api, ApiError } from "../api";
import { st, siteMessages } from "../sites-i18n";
import type { Locale } from "../i18n";

export type Props = { locale: Locale; role: "admin" | "editor" | "viewer" };
export type Row = Record<string, any>;
export type T = ReturnType<typeof st>;

export function useLoad(path: string | null, poll = false) {
  const [state, setState] = useState<{ path: string; value: any }>(),
    [error, setError] = useState<unknown>(),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(undefined);
    const load = () =>
      api(path)
        .then((value) => {
          if (live) {
            setState({ path, value });
            setError(undefined);
          }
        })
        .catch((e) => {
          if (live) setError(e);
        })
        .finally(() => {
          if (live && poll) timer = setTimeout(load, 2000);
        });
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, poll, version]);
  return {
    data: state?.path === path ? state?.value : undefined,
    error,
    reload: () => setVersion((v) => v + 1),
    set: (value: any) => path && setState({ path, value }),
  };
}
export function useAgentRuns(siteId: string | null, cursor = "") {
  const path = siteId
    ? "/sites/" +
      siteId +
      "/agent-runs" +
      (cursor ? "?cursor=" + encodeURIComponent(cursor) : "")
    : null;
  const [fallbackPoll, setFallbackPoll] = useState(
    () => typeof EventSource === "undefined",
  );
  const canStream = Boolean(siteId && !cursor && !fallbackPoll);
  const loaded = useLoad(path, !canStream && Boolean(siteId));
  useEffect(() => {
    if (!siteId || cursor || typeof EventSource === "undefined") return;
    setFallbackPoll(false);
    let live = true;
    const source = new EventSource(
      "/api/v1/sites/" + encodeURIComponent(siteId) + "/agent-runs/stream",
      { withCredentials: true },
    );
    const onRuns = (event: MessageEvent) => {
      if (!live) return;
      try {
        loaded.set(JSON.parse(event.data));
      } catch {
        /* ignore malformed frame */
      }
    };
    source.addEventListener("runs", onRuns as EventListener);
    source.onerror = () => {
      if (!live) return;
      source.close();
      setFallbackPoll(true);
    };
    return () => {
      live = false;
      source.removeEventListener("runs", onRuns as EventListener);
      source.close();
    };
  }, [siteId, cursor]);
  return loaded;
}
export function useAction() {
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  return {
    error,
    busy,
    saved,
    run: async (fn: () => Promise<unknown>) => {
      setError(undefined);
      setSaved(false);
      setBusy(true);
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
export function Notice({
  error,
  saved,
  t,
}: {
  error?: unknown;
  saved?: boolean;
  t: T;
}) {
  return error ? (
    <p className="notice error" role="alert">
      {t(
        error instanceof ApiError && error.code in siteMessages
          ? error.code
          : "failedGeneric",
      )}
    </p>
  ) : saved ? (
    <p className="notice success" role="status">
      {t("saved")}
    </p>
  ) : null;
}
export function Badge({ status, t }: { status: string; t: T }) {
  return <span className={"catalog-badge " + status}>{t(status)}</span>;
}
export function Frame({
  title,
  sub,
  t,
  children,
  error,
  actions,
  banner = false,
}: {
  banner?: boolean;
  title: string;
  sub?: string;
  t: T;
  children: React.ReactNode;
  error?: unknown;
  actions?: React.ReactNode;
}) {
  return (
    <div className="catalog sites-workspace">
      <header
        className={"catalog-heading" + (banner ? " project-heading" : "")}
      >
        <div>
          <h1>{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        <div className="catalog-actions">{actions}</div>
      </header>
      <Notice t={t} error={error} />
      {children}
    </div>
  );
}
export const templateLabels: Record<string, [string, string]> = {
  adaptive: ["Agent 智能设计", "Agent-composed design"],
  machinery: ["机械设备", "Machinery & equipment"],
  "building-hardware": ["建材五金", "Building materials & hardware"],
  "packaging-bags": ["包装 / 箱包", "Packaging & bags"],
};
export const split = (s: string) =>
  s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);

export const languageLabels: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  ar: "العربية (RTL)",
  ru: "Русский",
  zh: "简体中文",
};
