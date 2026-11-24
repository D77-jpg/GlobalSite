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
  Cpu,
  FileStack,
  Globe2,
  Inbox,
  Layers3,
  LayoutDashboard,
  LayoutGrid,
  Network,
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
import { rememberSite, readPage, readSite } from "./current-site";
import { messages, type Locale, type Key } from "./i18n";

type Item = {
  path: string;
  label: string;
  sublabel: string;
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
    work: "工作空间",
    studio: "视觉策略工作室",
    studioSub: "Visual Strategy Studio",
    blueprint: "结构蓝图",
    blueprintSub: "Site Blueprint",
    refine: "页面精修",
    refineSub: "Page Studio",
    currentSite: "当前站点",
    allSites: "全部项目",
    hub: "项目看板",
    hubSub: "Launch Cockpit",
    products: "产品资产",
    productsSub: "Product Library",
    facts: "品牌知识与事实库",
    factsSub: "Brand Facts & Knowledge",
    leads: "询盘与线索",
    leadsSub: "Inquiries & Leads",
    ai: "AI 服务商",
    aiSub: "AI Providers",
    team: "团队与协作",
    teamSub: "Team & Access",
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
    studio: "Visual Strategy Studio",
    studioSub: "Site Architecture & AI",
    blueprint: "Site Blueprint",
    blueprintSub: "Structure & Pages",
    refine: "Page Studio",
    refineSub: "Canvas & Inspector",
    currentSite: "Current site",
    allSites: "All projects",
    hub: "Launch Cockpit",
    hubSub: "Overview & KPIs",
    products: "Product Library",
    productsSub: "Catalog & Assets",
    facts: "Brand Knowledge",
    factsSub: "Verified Facts",
    leads: "Inquiries & Leads",
    leadsSub: "Buyer Inbox",
    ai: "AI Providers",
    aiSub: "Models & Vision",
    team: "Team & Access",
    teamSub: "Org & Billing",
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
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);
  const routeSite =
    location.pathname.match(/^\/sites\/([a-f0-9]{24})(?:\/|$)/)?.[1] ?? "";
  const storedSite = readSite();
  const knownStored = sites.some((site) => site.id === storedSite);
  const currentSiteId =
    routeSite || (knownStored ? storedSite : "") || sites[0]?.id || "";
  const [navPreference, setNavPreference] = useState<boolean | null>(null);
  const collapsed =
    navPreference ??
    (location.pathname === "/agent" || location.pathname.startsWith("/pages/"));

  // Bilingual 2-line luxury studio sidebar matching all 5 reference views.
  const navItems = useMemo<Item[]>(() => {
    const tab = new URLSearchParams(location.search).get("tab") ?? "guide";
    const sitePath = (nextTab: string) =>
      currentSiteId ? `/sites/${currentSiteId}?tab=${nextTab}` : "/sites";
    const refinePath = currentSiteId
      ? readPage(currentSiteId)
        ? `/pages/${readPage(currentSiteId)}`
        : sitePath("pages")
      : "/sites";
    const onSite =
      location.pathname.startsWith("/sites/") &&
      !location.pathname.startsWith("/sites/new");
    const base: Item[] = [
      {
        path: sitePath("guide"),
        label: c.studio,
        sublabel: c.studioSub,
        icon: LayoutGrid,
        match: (p) =>
          onSite &&
          !["planning", "pages"].includes(tab) &&
          !p.startsWith("/pages"),
      },
      {
        path: sitePath("planning"),
        label: c.blueprint,
        sublabel: c.blueprintSub,
        icon: Network,
        match: () => onSite && tab === "planning",
      },
      {
        path: refinePath,
        label: c.refine,
        sublabel: c.refineSub,
        icon: Layers3,
        match: (p) => p.startsWith("/pages/") || (onSite && tab === "pages"),
      },
      {
        path: "/",
        label: c.hub,
        sublabel: c.hubSub,
        icon: LayoutDashboard,
        match: (p) => p === "/",
      },
      {
        path: "/assets",
        label: c.products,
        sublabel: c.productsSub,
        icon: Boxes,
        match: (p) => p.startsWith("/assets") || p.startsWith("/products") || p === "/knowledge",
      },
      {
        path: "/facts",
        label: c.facts,
        sublabel: c.factsSub,
        icon: BookOpenCheck,
        match: (p) => p.startsWith("/facts") || p.startsWith("/website-reads"),
      },
      {
        path: "/inquiries",
        label: c.leads,
        sublabel: c.leadsSub,
        icon: Inbox,
        match: (p) => p.startsWith("/inquiries"),
      },
    ];
    if (role === "admin") {
      base.push({
        path: "/ai",
        label: c.ai,
        sublabel: c.aiSub,
        icon: Cpu,
        match: (p) => p.startsWith("/ai"),
      });
    }
    base.push({
      path: "/organization",
      label: c.team,
      sublabel: c.teamSub,
      icon: Users,
      match: (p) =>
        ["/organization", "/members", "/usage", "/security", "/crm", "/settings"].some(
          (prefix) => p.startsWith(prefix),
        ),
    });
    return base;
  }, [c, role, location.pathname, location.search, currentSiteId]);

  // Full deep-link directory preserved inside Ctrl+K Command Palette.
  const paletteItems = useMemo(() => {
    const items: Array<{ path: string; label: string; icon: LucideIcon }> = [
      { path: "/", label: c.hub, icon: LayoutDashboard },
      ...(currentSiteId
        ? [
            {
              path: `/sites/${currentSiteId}?tab=guide`,
              label: c.studio,
              icon: LayoutGrid,
            },
            {
              path: `/sites/${currentSiteId}?tab=planning`,
              label: c.blueprint,
              icon: Network,
            },
            {
              path: readPage(currentSiteId)
                ? `/pages/${readPage(currentSiteId)}`
                : `/sites/${currentSiteId}?tab=pages`,
              label: c.refine,
              icon: Layers3,
            },
          ]
        : [{ path: "/sites", label: c.studio, icon: LayoutGrid }]),
      ...(role !== "viewer"
        ? [{ path: "/sites/new", label: c.newSite, icon: Plus }]
        : []),
      { path: "/agent", label: c.agent, icon: Activity },
      { path: "/products", label: t("products"), icon: Boxes },
      { path: "/assets", label: t("assets"), icon: FileStack },
      { path: "/facts", label: t("facts"), icon: BookOpenCheck },
      { path: "/website-reads", label: t("website"), icon: Globe2 },
      { path: "/inquiries", label: t("inquiries"), icon: Inbox },
      { path: "/organization", label: t("organization"), icon: Building2 },
      { path: "/members", label: t("members"), icon: Users },
      { path: "/security", label: t("security"), icon: ShieldCheck },
      { path: "/usage", label: t("usage"), icon: ChartNoAxesCombined },
      ...(role === "admin"
        ? [
            { path: "/ai", label: t("ai"), icon: Sparkles },
            { path: "/crm", label: t("crm"), icon: Plug },
          ]
        : []),
    ];
    return items;
  }, [c, role, locale, t, currentSiteId]);

  const activeNav =
    navItems.find((item) => item.match?.(location.pathname)) ?? navItems[0];

  const results = paletteItems.filter(
    (item) =>
      !query.trim() ||
      item.label.toLowerCase().includes(query.trim().toLowerCase()) ||
      item.path.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (routeSite) rememberSite(routeSite);
  }, [routeSite]);

  useEffect(() => {
    let alive = true;
    api<{ items: Array<{ id: string; name: string }> }>("/sites?limit=50")
      .then((res) => {
        if (alive) setSites(res.items ?? []);
      })
      .catch(() => {
        if (alive) setSites([]);
      });
    return () => {
      alive = false;
    };
  }, [location.pathname]);

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
          <Globe2 size={16} />
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
          <Building2 size={15} />
        </span>
        <div>
          <small>{c.work}</small>
          <strong>{organizationName || userName}</strong>
        </div>
        <ChevronRight size={14} />
      </Link>
      {sites.length > 0 && (
        <label className="site-switcher">
          <small>{c.currentSite}</small>
          <select
            aria-label={c.currentSite}
            value={currentSiteId}
            onChange={(event) => {
              const next = event.target.value;
              rememberSite(next);
              const tab = new URLSearchParams(location.search).get("tab");
              const keep =
                location.pathname.startsWith("/pages/")
                  ? "pages"
                  : tab === "planning" || tab === "pages"
                    ? tab
                    : "guide";
              navigate(`/sites/${next}?tab=${keep}`);
              setPopup(null);
            }}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <Link to="/sites" onClick={() => setPopup(null)}>
            {c.allSites}
          </Link>
        </label>
      )}
      <nav aria-label={t("workspace")}>
        <div className="ws-group">
          {navItems.map(({ path, icon: Icon, label, sublabel, match }) => (
            <NavLink
              key={label}
              to={path}
              title={label}
              end={path === "/"}
              className={() => (match?.(location.pathname) ? "active" : "")}
              onClick={() => setPopup(null)}
            >
              <Icon size={17} aria-hidden="true" />
              <span className="nav-item-text">
                <span className="nav-item-label">{label}</span>
                <span className="nav-item-sub">{sublabel}</span>
              </span>
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
        <Link
          to="/security"
          className="gs-icon-link"
          aria-label={t("security")}
          title={t("security")}
        >
          <Settings size={15} />
        </Link>
        <button
          aria-label={t("signOut")}
          title={t("signOut")}
          onClick={() =>
            void api("/auth/logout", "POST")
              .then(() => navigate("/login"))
              .catch(() => setLogoutError(true))
          }
        >
          <LogOut size={15} />
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
            <Menu size={19} />
          </button>
          <div className="breadcrumb" aria-label={activeNav.label}>
            <strong>{activeNav.label}</strong>
            <span className="breadcrumb-en">{activeNav.sublabel}</span>
          </div>
          <div className="topbar-right">
            <button
              className="ws-search"
              onClick={() => {
                setQuery("");
                setPopup("search");
              }}
            >
              <Search size={15} />
              <span>{c.search}</span>
              <kbd>Ctrl K</kbd>
            </button>
            {role !== "viewer" && (
              <Link to="/sites/new" className="gs-btn gs-btn-sm">
                <Plus size={14} aria-hidden="true" />
                <span>{c.newSite}</span>
              </Link>
            )}
            {themeButton}
            {languageButton}
          </div>
        </header>
        <main className="content" id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      {popup === "menu" && (
        <Modal label={t("workspace")} close={() => setPopup(null)} drawer>
          <div className="sidebar">
            <button
              className="ws-close"
              aria-label={c.close}
              onClick={() => setPopup(null)}
            >
              <X size={18} />
            </button>
            {sidebar}
          </div>
        </Modal>
      )}
      {popup === "search" && (
        <Modal label={c.searchLabel} close={() => setPopup(null)}>
          <div className="ws-search-field">
            <Search size={16} />
            <input
              autoFocus
              aria-label={c.searchLabel}
              placeholder={c.searchLabel}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button aria-label={c.close} onClick={() => setPopup(null)}>
              <X size={16} />
            </button>
          </div>
          <ul className="ws-results">
            {results.map(({ path, label, icon: Icon }) => (
              <li key={path}>
                <button
                  onClick={() => {
                    setPopup(null);
                    navigate(path);
                  }}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  <ArrowUpRight size={14} />
                </button>
              </li>
            ))}
            {!results.length && <li className="ws-empty">{c.noResults}</li>}
          </ul>
        </Modal>
      )}
    </div>
  );
}
