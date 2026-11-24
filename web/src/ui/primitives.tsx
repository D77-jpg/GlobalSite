import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="gs-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="gs-row">{actions}</div>}
    </header>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "info" | "danger" | "accent";
  children: ReactNode;
}) {
  return (
    <span className={"gs-badge" + (tone === "neutral" ? "" : " gs-badge-" + tone)}>
      {children}
    </span>
  );
}

export function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: string;
  to?: string;
}) {
  const inner = (
    <>
      <div className="gs-kpi-top">
        <span>{label}</span>
        <span className="gs-kpi-icon">
          <Icon size={16} aria-hidden="true" />
        </span>
      </div>
      <strong className="gs-kpi-value">{value}</strong>
      {sub && <span className="gs-kpi-sub">{sub}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="gs-kpi-card">
      {inner}
    </Link>
  ) : (
    <div className="gs-kpi-card">{inner}</div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="gs-empty">
      <span className="gs-empty-icon">
        <Icon size={22} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
