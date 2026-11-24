import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  BookOpenCheck,
  Boxes,
  FileSpreadsheet,
  FileStack,
  Globe2,
  Plus,
} from "lucide-react";
import { messages, type Locale, type Key } from "./i18n";

export function KnowledgeShell({
  locale,
  role,
  children,
}: {
  locale: Locale;
  role: "admin" | "editor" | "viewer";
  children: ReactNode;
}) {
  const t = (key: Key) => messages[locale][key];
  const zh = locale === "zh";
  const { pathname } = useLocation();
  // /assets and /facts now render their own full-bleed 3-column StudioMasthead layouts.
  if (pathname === "/assets" || pathname === "/facts") {
    return <>{children}</>;
  }
  const onProductsList = pathname === "/products";
  const tabs = [
    { path: "/products", label: t("products"), Icon: Boxes },
    { path: "/assets", label: t("assets"), Icon: FileStack },
    { path: "/facts", label: t("facts"), Icon: BookOpenCheck },
    { path: "/website-reads", label: t("website"), Icon: Globe2 },
  ];
  return (
    <div className="gs-stack">
      <div className="gs-row-between">
        <nav
          className="gs-segmented"
          aria-label={zh ? "外贸资料中心" : "Knowledge hub"}
        >
          {tabs.map(({ path, label, Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {role !== "viewer" && !onProductsList && (
          <div className="gs-row">
            <Link className="gs-btn gs-btn-sm" to="/products/imports">
              <FileSpreadsheet size={14} aria-hidden="true" />
              {zh ? "导入 Excel" : "Import Excel"}
            </Link>
            <Link className="gs-btn gs-btn-sm gs-btn-primary" to="/products/new">
              <Plus size={14} aria-hidden="true" />
              {zh ? "新建产品" : "New product"}
            </Link>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
