import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  Boxes,
  Building2,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  FileStack,
  Globe2,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  PanelsTopLeft,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "./api";
import { messages, type Locale, type Key } from "./i18n";

type Item = { path: string; label: string; icon: LucideIcon };
type Group = { title: string; items: Item[] };
type Props = {
  locale: Locale;
  userName: string;
  role: "admin" | "editor" | "viewer";
  organizationName?: string;
  languageButton: ReactNode;
  children: ReactNode;
};
const copy = {
  zh: {
    work: "工作台",
    content: "建站与内容",
    settings: "组织与设置",
    agent: "建站 Agent",
    search: "查找功能",
    searchLabel: "搜索页面名称或路径",
    noResults: "没有匹配的页面",
    close: "关闭",
    skip: "跳到主要内容",
    menu: "打开导航",
    logoutError: "退出失败，请重试。",
  },
  en: {
    work: "Workspace",
    content: "Sites & content",
    settings: "Organization & settings",
    agent: "Site agent",
    search: "Find a page",
    searchLabel: "Search by page name or path",
    noResults: "No matching pages",
    close: "Close",
    skip: "Skip to content",
    menu: "Open navigation",
    logoutError: "Could not sign out. Please retry.",
  },
};
function Modal({
  label,
  close,
  children,
  drawer = false,
}: {
  label: string;
  close: () => void;
  children: ReactNode;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={drawer ? "ws-drawer" : "ws-palette"}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div>{children}</div>
    </dialog>
  );
}
export function WorkspaceFrame({
  locale,
  userName,
  role,
  organizationName,
  languageButton,
  children,
}: Props) {
  const t = (key: Key) => messages[locale][key],
    c = copy[locale];
  const location = useLocation(),
    navigate = useNavigate(),
    [popup, setPopup] = useState<"menu" | "search" | null>(null),
    [query, setQuery] = useState(""),
    [logoutError, setLogoutError] = useState(false);
  const groups = useMemo<Group[]>(() => {
    const item = (path: string, key: Key, icon: LucideIcon): Item => ({
      path,
      label: messages[locale][key],
      icon,
    });
    return [
      {
        title: c.work,
        items: [
          item("/", "overview", LayoutDashboard),
          { path: "/agent", label: c.agent, icon: Activity },
        ],
      },
      {
        title: c.content,
        items: [
          item("/sites", "sites", PanelsTopLeft),
          item("/inquiries", "inquiries", Mail),
          item("/products", "products", Boxes),
          item("/assets", "assets", FileStack),
          item("/facts", "facts", BookOpenCheck),
          item("/website-reads", "website", Globe2),
        ],
      },
      {
        title: c.settings,
        items: [
          item("/organization", "organization", Building2),
          item("/members", "members", Users),
          item("/security", "security", ShieldCheck),
          item("/usage", "usage", ChartNoAxesCombined),
          ...(role === "admin"
            ? [item("/ai", "ai", Sparkles), item("/crm", "crm", Plug)]
            : []),
        ],
      },
    ];
  }, [locale, role, c]);
  const all = groups.flatMap((g) => g.items),
    actions: Item[] =
      role === "viewer"
        ? []
        : [
            {
              path: "/products/new",
              label: locale === "zh" ? "新建产品" : "Create product",
              icon: Boxes,
            },
            {
              path: "/products/imports",
              label: locale === "zh" ? "批量导入产品" : "Import products",
              icon: FileStack,
            },
          ],
    matches = [...all, ...actions].filter((i) =>
      (i.label + " " + i.path)
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
    );
  const parentPath = location.pathname.startsWith("/pages/")
    ? "/sites"
    : "/" + location.pathname.split("/")[1];
  const current = all.find((i) => i.path === parentPath);
  useEffect(() => {
    setPopup(null);
    setLogoutError(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
        setPopup((p) => (p === "search" ? null : "search"));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const sidebar = (
    <>
      <Link to="/" className="brand" onClick={() => setPopup(null)}>
        <span className="brand-icon">
          <Globe2 size={21} />
        </span>
        GlobalSite
      </Link>
      <Link
        to="/organization"
        className="workspace-label"
        onClick={() => setPopup(null)}
      >
        <span className="workspace-avatar">
          <Building2 size={16} />
        </span>
        <div>
          <small>{t("workspace")}</small>
          <strong>{organizationName || userName}</strong>
        </div>
        <ChevronRight size={14} />
      </Link>
      <nav aria-label={t("workspace")}>
        {groups.map((g) => (
          <div className="ws-group" key={g.title}>
            <div className="nav-heading">{g.title}</div>
            {g.items.map(({ path, icon: Icon, label }) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  isActive || current?.path === path ? "active" : ""
                }
                onClick={() => setPopup(null)}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="account-box">
        <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{userName}</strong>
          <small>{t(role)}</small>
        </div>
        <button
          aria-label={t("signOut")}
          onClick={() =>
            void api("/auth/logout", "POST")
              .then(() => navigate("/login"))
              .catch(() => setLogoutError(true))
          }
        >
          <LogOut size={17} />
        </button>
      </div>
      {logoutError && <p role="alert">{c.logoutError}</p>}
    </>
  );
  return (
    <div className="workspace ws-shell">
      <a className="skip-link" href="#main">
        {c.skip}
      </a>
      <aside className="sidebar">{sidebar}</aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-expanded={popup === "menu"}
            aria-label={c.menu}
            onClick={() => setPopup("menu")}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <Link to="/">{c.work}</Link>
            <ChevronRight size={13} />
            <strong>{current?.label ?? t("acceptInvite")}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="ws-search"
              aria-label={c.search}
              onClick={() => {
                setQuery("");
                setPopup("search");
              }}
            >
              <Search size={15} />
              <span>{c.search}</span>
              <kbd>Ctrl K</kbd>
            </button>
            {languageButton}
          </div>
        </header>
        <main id="main" tabIndex={-1} className="content">
          {children}
        </main>
      </div>
      {popup === "menu" && (
        <Modal label={c.menu} drawer close={() => setPopup(null)}>
          <aside className="sidebar">
            <button
              className="ws-x"
              aria-label={c.close}
              onClick={() => setPopup(null)}
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </Modal>
      )}
      {popup === "search" && (
        <Modal label={c.search} close={() => setPopup(null)}>
          <div className="ws-search-field">
            <Search size={18} />
            <input
              autoFocus
              value={query}
              aria-label={c.searchLabel}
              placeholder={c.searchLabel}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  navigate(matches[0].path);
                  setPopup(null);
                }
              }}
            />
            <button aria-label={c.close} onClick={() => setPopup(null)}>
              <X size={17} />
            </button>
          </div>
          <div className="ws-results">
            {matches.map(({ path, label, icon: Icon }) => (
              <Link key={path} to={path} onClick={() => setPopup(null)}>
                <Icon size={17} />
                {label}
                {current?.path === path ? (
                  <Check size={15} />
                ) : (
                  <ArrowUpRight size={15} />
                )}
              </Link>
            ))}
            {!matches.length && <p role="status">{c.noResults}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
