import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  Building2,
  ChartNoAxesCombined,
  Plug,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { messages, type Locale, type Key } from "./i18n";

export function SettingsShell({
  locale,
  role,
  children,
}: {
  locale: Locale;
  role: "admin" | "editor" | "viewer";
  children: ReactNode;
}) {
  const t = (key: Key) => messages[locale][key];
  const items = [
    ...(role === "admin"
      ? [
          { path: "/ai", label: t("ai"), Icon: Sparkles },
          { path: "/crm", label: t("crm"), Icon: Plug },
        ]
      : []),
    { path: "/organization", label: t("organization"), Icon: Building2 },
    { path: "/members", label: t("members"), Icon: Users },
    { path: "/usage", label: t("usage"), Icon: ChartNoAxesCombined },
    { path: "/security", label: t("security"), Icon: ShieldCheck },
  ];
  return (
    <div className="gs-hub-shell">
      <nav className="gs-subnav" aria-label={t("settings")}>
        <span className="gs-subnav-title">{t("settings")}</span>
        {items.map(({ path, label, Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="gs-hub-content">{children}</div>
    </div>
  );
}
