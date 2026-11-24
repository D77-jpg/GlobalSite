import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  Boxes,
  Building2,
  ChartNoAxesCombined,
  ChevronRight,
  FileStack,
  FolderKanban,
  Globe2,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "./api";
import { messages, type Locale, type Key } from "./i18n";

type Item = {
  path: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

type Props = {
  locale: Locale;
  userName: string;
  role: "admin" | "editor" | "viewer";
  organizationName?: string;
  languageButton: ReactNode;
  themeButton?: ReactNode;
  children: ReactNode;
};

const copy = {
  zh: {
    work: "工作台",
    hub: "指挥台",
    studio: "建站工作台",
    knowledge: "外贸资料中心",
    leads: "询盘与获客",
    settings: "系统设置",
    newSite: "新建外贸站",
    agent: "AI 任务中心",
    search: "快速跳转",
    searchLabel: "搜索页面、站点功能或设置…",
    noResults: "没有匹配的功能",
    close: "关闭",
    skip: "跳到主要内容",
    menu: "打开导航",
    logoutError: "退出失败，请重试。",
    expandNav: "展开主导航",
    collapseNav: "收起主导航",
  },
  en: {
    work: "Workspace",
    hub: "Command Hub",
    studio: "Site Studio",
    knowledge: "Knowledge Hub",
    leads: "Leads & Inbox",
    settings: "Settings",
    newSite: "New website",
    agent: "AI Task Center",
    search: "Jump to…",
    searchLabel: "Search workspaces, tools, or settings…",
    noResults: "No matching pages",
    close: "Close",
    skip: "Skip to content",
    menu: "Open navigation",
    logoutError: "Could not sign out. Please retry.",
    expandNav: "Expand navigation",
    collapseNav: "Collapse navigation",
  },
};

const KNOWLEDGE_PATHS = ["/knowledge", "/products", "/assets", "/facts", "/website-reads"];
const SETTINGS_PATHS = ["/settings", "/organization", "/members", "/security", "/usage", "/ai", "/crm"];

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
  themeButton,
  children,
}: Props) {
  const t = (key: Key) => messages[locale][key];
  const c = copy[locale];
  const location = useLocation();
  const navigate = useNavigate();
  const [popup, setPopup] = useState<"menu" | "search" | null>(null);
  const [query, setQuery] = useState("");
  const [logoutError, setLogoutError] = useState(false);
  const [navPreference, setNavPreference] = useState<boolean | null>(null);
  const collapsed =
    navPreference ??
    (location.pathname === "/agent" || location.pathname.startsWith("/pages/"));

  // Clean 5-pillar sidebar tailored to foreign-trade workflows.
  const navItems = useMemo<Item[]>(
    () => [
      {
        path: "/",
        label: c.hub,
        icon: LayoutDashboard,
        match: (p) => p === "/",
      },
      {
        path: "/sites",
        label: c.studio,
        icon: Sparkles,
        match: (p) =>
          p.startsWith("/sites") || p.startsWith("/pages") || p === "/agent",
      },
      {
        path: "/products",
        label: c.knowledge,
        icon: FolderKanban,
        match: (p) => KNOWLEDGE_PATHS.some((prefix) => p.startsWith(prefix)),
      },
      {
        path: "/inquiries",
        label: c.leads,
        icon: Inbox,
        match: (p) => p.startsWith("/inquiries"),
      },
      {
        path: role === "admin" ? "/ai" : "/organization",
        label: c.settings,
        icon: Settings,
        match: (p) => SETTINGS_PATHS.some((prefix) => p.startsWith(prefix)),
      },
    ],
    [c, role],
  );

  // Full command-palette index (all 15+ deep destinations in one Ctrl+K).
  const paletteItems = useMemo<Item[]>(() => {
    const item = (path: string, key: Key, icon: LucideIcon): Item => ({
      path,
      label: messages[locale][key],
      icon,
    });
    return [
      { path: "/", label: c.hub, icon: LayoutDashboard },
      { path: "/sites", label: c.studio, icon: Sparkles },
      { path: "/agent", label: c.agent, icon: Activity },
      item("/inquiries", "inquiries", Inbox),
      item("/products", "products", Boxes),
      item("/assets", "assets", FileStack),
      item("/facts", "facts", BookOpenCheck),
      item("/website-reads", "website", Globe2),
      item("/organization", "organization", Building2),
      item("/members", "members", Users),
      item("/security", "security", ShieldCheck),
      item("/usage", "usage", ChartNoAxesCombined),
      ...(role === "admin"
        ? [item("/ai", "ai", Sparkles), item("/crm", "crm", Plug)]
        : []),
      ...(role !== "viewer"
        ? [
            { path: "/sites/new", label: c.newSite, icon: Plus },
            {
              path: "/products/new",
              label: locale === "zh" ? "新建产品" : "Create product",
              icon: Boxes,
            },
            {
              path: "/products/imports",
              label: locale === "zh" ? "批量导入产品 (Excel)" : "Import products (Excel)",
              icon: FileStack,
            },
          ]
        : []),
    ];
  }, [locale, role, c]);

  const matches = paletteItems.filter((i) =>
    (i.label + " " + i.path).toLowerCase().includes(query.toLowerCase().trim()),
  );

  const activeNav = navItems.find((i) => i.match?.(location.pathname));
  const deepLabel =
    paletteItems.find((i) =>
      i.path === "/" ? location.pathname === "/" : location.pathname === i.path,
    )?.label ?? activeNav?.label;

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
          <Globe2 size={18} />
        </span>
        <span className="brand-name">GlobalSite</span>
        <span className="brand-pill">STUDIO</span>
      </Link>
      <Link
        to="/organization"
        className="workspace-label"
        aria-label={t("workspace") + " " + (organizationName || userName)}
        title={organizationName || userName}
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
      {role !== "viewer" && (
        <Link
          to="/sites/new"
          className="gs-sidebar-cta"
          title={c.newSite}
          onClick={() => setPopup(null)}
        >
          <Plus size={16} aria-hidden="true" />
          <span>{c.newSite}</span>
        </Link>
      )}
      <nav aria-label={t("workspace")}>
        <div className="ws-group">
          <div className="nav-heading">{c.work}</div>
          {navItems.map(({ path, icon: Icon, label, match }) => (
            <NavLink
              key={path}
              to={path}
              title={label}
              end={path === "/"}
              className={() => (match?.(location.pathname) ? "active" : "")}
              onClick={() => setPopup(null)}
            >
              <Icon size={17} aria-hidden="true" />
              <span className="nav-item-label">{label}</span>
            </NavLink>
          ))}
        </div>
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
    <div
      className="workspace ws-shell product-shell"
      data-page={location.pathname.split("/")[1] || "overview"}
      data-nav-collapsed={collapsed}
    >
      <a className="skip-link" href="#main">
        {c.skip}
      </a>
      <aside className="sidebar">{sidebar}</aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="nav-collapse"
            aria-label={collapsed ? c.expandNav : c.collapseNav}
            aria-expanded={!collapsed}
            onClick={() => setNavPreference(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
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
            <strong>{deepLabel ?? t("acceptInvite")}</strong>
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
            {themeButton}
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
            />
            <button
              className="ws-x"
              aria-label={c.close}
              onClick={() => setPopup(null)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="ws-search-list">
            {matches.length ? (
              matches.map(({ path, label, icon: Icon }) => (
                <button
                  key={path}
                  onClick={() => {
                    navigate(path);
                    setPopup(null);
                  }}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))
            ) : (
              <p>{c.noResults}</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
