import { CrmConnectionPage } from "./crm";
import {
  InquiriesPage,
  InquiryDetailPage,
  InquirySettingsPage,
} from "./inquiries";
import { PublishPage } from "./publishing";
import { SitesPage, SiteWorkspace, PageReview } from "./sites";
import {
  ProductsPage,
  ProductEditor,
  ImportPage,
  AssetsPage,
  FactsPage,
  WebsitePage,
} from "./catalog";
import "./catalog.css";
import { safeReturnTo } from "./navigation";
import React, { createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  Link,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { useForm } from "react-hook-form";
import {
  Globe2,
  LayoutDashboard,
  Building2,
  Users,
  ShieldCheck,
  ChartNoAxesCombined,
  Sparkles,
  ArrowUpRight,
  ArrowRight,
  Check,
  LogOut,
  Languages,
  Mail,
  Plug,
  Monitor,
  KeyRound,
  Menu,
  X,
} from "lucide-react";
import { api, ApiError } from "./api";
import { messages, errors, type Locale, type Key } from "./i18n";
import "./style.css";
type Me = {
  user: { id: string; name: string; email: string; twoFactorEnabled: boolean };
  organizationId: string;
  role: "admin" | "editor" | "viewer";
};
const I18n = createContext<{
  locale: Locale;
  t: (key: Key) => string;
  setLocale: (value: Locale) => void;
}>({ locale: "zh", t: (key) => key, setLocale: () => {} });
const useI18n = () => useContext(I18n);
const Auth = createContext<{ me: Me; reload: () => Promise<void> }>({
  me: null as unknown as Me,
  reload: async () => {},
});
function Notice({ error, success }: { error?: unknown; success?: string }) {
  const { locale, t } = useI18n();
  if (error) {
    const code = error instanceof ApiError ? error.code : "";
    return (
      <div className="notice error" role="alert">
        {errors[code]?.[locale === "zh" ? 0 : 1] ?? t("failed")}
      </div>
    );
  }
  return success ? (
    <div className="notice success" role="status">
      <Check size={18} aria-hidden="true" />
      {success}
    </div>
  ) : null;
}
type Field = {
  key: string;
  label: Key;
  type?: string;
  optional?: boolean;
  minLength?: number;
  readOnly?: boolean;
  placeholder?: string;
  options?: Array<[string, Key]>;
};
function Form({
  fields,
  onSubmit,
  submit = "save",
  initial = {},
  children,
}: {
  fields: Field[];
  onSubmit: (values: Record<string, string>) => Promise<void>;
  submit?: Key;
  initial?: Record<string, string>;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    formState: { errors: formErrors, isSubmitting },
  } = useForm<Record<string, string>>({ defaultValues: initial });
  const [error, setError] = useState<unknown>();
  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        setError(undefined);
        try {
          await onSubmit(values);
        } catch (e) {
          setError(e);
        }
      })}
    >
      <Notice error={error} />
      {fields.map((field) => (
        <div className="field" key={field.key}>
          <label htmlFor={field.key}>
            {t(field.label)}
            {field.optional && (
              <span className="optional">{t("optional")}</span>
            )}
          </label>
          {field.options ? (
            <select
              id={field.key}
              {...register(field.key, { required: !field.optional })}
            >
              {field.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={field.key}
              type={field.type ?? "text"}
              readOnly={field.readOnly}
              aria-invalid={!!formErrors[field.key]}
              aria-describedby={
                formErrors[field.key]
                  ? field.key + "-error"
                  : field.minLength
                    ? field.key + "-help"
                    : undefined
              }
              autoComplete={
                field.key === "apiKey"
                  ? "off"
                  : field.type === "password"
                    ? field.minLength
                      ? "new-password"
                      : "current-password"
                    : field.type === "email"
                      ? "email"
                      : field.key === "code"
                        ? "one-time-code"
                        : undefined
              }
              placeholder={field.placeholder}
              {...register(field.key, {
                required: !field.optional,
                minLength: field.minLength,
              })}
            />
          )}
          {formErrors[field.key] && (
            <span id={field.key + "-error"} className="field-error">
              {field.minLength ? t("passwordHelp") : t("required")}
            </span>
          )}
          {field.minLength && !formErrors[field.key] && (
            <small id={field.key + "-help"}>{t("passwordHelp")}</small>
          )}
        </div>
      ))}
      {children}
      <button className="button primary" disabled={isSubmitting} type="submit">
        {t(isSubmitting ? "saving" : submit)}
        {!isSubmitting && <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>
  );
}
function DevMail({ receipt }: { receipt?: string }) {
  const { t } = useI18n();
  const [mail, setMail] = useState<{ text: string; subject: string }>();
  const [error, setError] = useState<unknown>();
  if (!receipt) return null;
  return (
    <aside className="dev-mail">
      <h3>
        <Mail size={18} aria-hidden="true" />
        {t("devMail")}
      </h3>
      <p>{t("devMailHelp")}</p>
      <button
        className="button secondary"
        onClick={() => {
          void api<{ text: string; subject: string }>("/dev/mail/" + receipt)
            .then(setMail)
            .catch(setError);
        }}
      >
        {t("openMail")}
      </button>
      <Notice error={error} />
      {mail && (
        <div className="mail-body" role="status">
          <strong>{mail.subject}</strong>
          {mail.text.startsWith("http") ? (
            <a href={mail.text}>
              {t("continue")} <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          ) : (
            <p>{mail.text}</p>
          )}
        </div>
      )}
    </aside>
  );
}
function LocaleButton() {
  const { locale, setLocale, t } = useI18n();
  return (
    <button
      className="language"
      aria-label={t("language")}
      onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
    >
      <Languages size={17} aria-hidden="true" />
      {locale === "zh" ? "English" : "中文"}
    </button>
  );
}
function AuthFrame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Link to="/login" className="brand">
          <span className="brand-icon">
            <Globe2 size={25} aria-hidden="true" />
          </span>
          GlobalSite
          <span className="brand-dot" aria-hidden="true">
            ●
          </span>
        </Link>
        <div className="story-content">
          <span className="eyebrow">{t("builtForGlobal")}</span>
          <h1>{t("tagline")}</h1>
          <p>{t("workspaceSub")}</p>
          <div className="orbit" aria-hidden="true">
            <Globe2 />
            <span className="orbit-label">{t("nextChapter")}</span>
          </div>
        </div>
        <p className="story-footer">{t("independentSub")}</p>
      </section>
      <main className="auth-main">
        <LocaleButton />
        <div className="auth-form">{children}</div>
        <footer>© {new Date().getFullYear()} GlobalSite</footer>
      </main>
    </div>
  );
}
function Login() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const next = query.get("next");
  const target = safeReturnTo(next, window.location.origin);
  const [challenge, setChallenge] = useState<any>();
  return (
    <AuthFrame>
      <span className="kicker">{t("independent")}</span>
      <h1>{t(challenge ? "challengeTitle" : "welcome")}</h1>
      <p className="sub">{t(challenge ? "challengeSub" : "loginSub")}</p>
      {challenge ? (
        <>
          <Form
            fields={[{ key: "code", label: "code" }]}
            submit="confirmCode"
            onSubmit={async (values) => {
              await api("/auth/2fa/verify", "POST", {
                challengeId: challenge.challengeId,
                code: values.code,
              });
              navigate(target);
            }}
          />
          <DevMail receipt={challenge.devReceipt} />
        </>
      ) : (
        <>
          <Form
            fields={[
              { key: "email", label: "email", type: "email" },
              { key: "password", label: "password", type: "password" },
            ]}
            submit="signIn"
            onSubmit={async (values) => {
              const result = await api("/auth/login", "POST", values);
              if (result.challengeId) setChallenge(result);
              else navigate(target);
            }}
          >
            <Link className="forgot-link" to="/forgot-password">
              {t("forgot")}
            </Link>
          </Form>
          <Link className="text-link" to="/resend-verification">
            {t("resendVerification")}
          </Link>
          <p className="auth-switch">
            {t("noAccount")}{" "}
            <Link
              to={
                "/register" + (next ? "?next=" + encodeURIComponent(next) : "")
              }
            >
              {t("signUp")}
            </Link>
          </p>
        </>
      )}
    </AuthFrame>
  );
}
function Register() {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<any>();
  return (
    <AuthFrame>
      <span className="kicker">{t("independent")}</span>
      <h1>{t("registerTitle")}</h1>
      <p className="sub">{t("registerSub")}</p>
      {result ? (
        <>
          <Notice success={t("verificationSent")} />
          <DevMail receipt={result.devReceipt} />
          <Link className="text-link" to="/login">
            {t("backLogin")} <ArrowRight size={16} />
          </Link>
        </>
      ) : (
        <Form
          fields={[
            { key: "name", label: "name" },
            { key: "organizationName", label: "organizationName" },
            { key: "email", label: "email", type: "email" },
            {
              key: "password",
              label: "password",
              type: "password",
              minLength: 12,
            },
          ]}
          submit="signUp"
          onSubmit={async (values) =>
            setResult(
              await api("/auth/register", "POST", { ...values, locale }),
            )
          }
        />
      )}
      <p className="auth-switch">
        {t("haveAccount")} <Link to="/login">{t("signIn")}</Link>
      </p>
    </AuthFrame>
  );
}
function Verify() {
  const { t } = useI18n();
  const [query] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    void api("/auth/verify-email", "POST", { token: query.get("token") })
      .then(() => setStatus("done"))
      .catch((e) => {
        setError(e);
        setStatus("error");
      });
  }, [query]);
  return (
    <AuthFrame>
      <h1>{t("verify")}</h1>
      {status === "loading" ? (
        <p>{t("loading")}</p>
      ) : (
        <Notice
          success={status === "done" ? t("verifySuccess") : undefined}
          error={error}
        />
      )}
      <Link to="/login">{t("backLogin")}</Link>
    </AuthFrame>
  );
}
function ResendVerification() {
  const { t } = useI18n();
  const [result, setResult] = useState<any>();
  return (
    <AuthFrame>
      <h1>{t("resendVerification")}</h1>
      <p className="sub">{t("resendVerificationHelp")}</p>
      {result ? (
        <>
          <Notice success={t("verificationSent")} />
          <DevMail receipt={result.devReceipt} />
        </>
      ) : (
        <Form
          fields={[{ key: "email", label: "email", type: "email" }]}
          submit="continue"
          onSubmit={async (value) =>
            setResult(await api("/auth/resend-verification", "POST", value))
          }
        />
      )}
      <Link className="text-link" to="/login">
        {t("backLogin")}
      </Link>
    </AuthFrame>
  );
}
function PasswordPage({ reset = false }: { reset?: boolean }) {
  const { t } = useI18n();
  const [query] = useSearchParams();
  const [result, setResult] = useState<any>();
  return (
    <AuthFrame>
      <h1>{t(reset ? "reset" : "forgot")}</h1>
      <p className="sub">{t("forgotSub")}</p>
      {result ? (
        <>
          <Notice success={t(reset ? "resetSuccess" : "verificationSent")} />
          <DevMail receipt={result.devReceipt} />
        </>
      ) : (
        <Form
          fields={
            reset
              ? [
                  {
                    key: "password",
                    label: "newPassword",
                    type: "password",
                    minLength: 12,
                  },
                ]
              : [{ key: "email", label: "email", type: "email" }]
          }
          submit={reset ? "reset" : "continue"}
          onSubmit={async (values) =>
            setResult(
              await api(
                reset ? "/auth/reset-password" : "/auth/forgot-password",
                "POST",
                reset ? { ...values, token: query.get("token") } : values,
              ),
            )
          }
        />
      )}
      <Link className="text-link" to="/login">
        {t("backLogin")}
      </Link>
    </AuthFrame>
  );
}
function PageHeader({
  title,
  sub,
  tag,
}: {
  title: Key;
  sub: Key;
  tag?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{t("settings")}</div>
        <h1>{t(title)}</h1>
        <p>{t(sub)}</p>
      </div>
      {tag}
    </header>
  );
}
function useData<T = any>(path: string, list = false) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const reload = async () => {
    setError(undefined);
    try {
      const value = await api(path);
      setData((list ? value.items : value) as T);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    void reload();
  }, [path, list]);
  return { data, error, reload };
}
function Loading({ error }: { error?: unknown }) {
  const { t } = useI18n();
  return error ? (
    <Notice error={error} />
  ) : (
    <p className="loading" role="status">
      {t("loading")}
    </p>
  );
}
function Overview() {
  const { t } = useI18n();
  const { me } = useContext(Auth);
  const { data: org } = useData("/organization");
  const { data: members } = useData<any[]>("/members", true);
  const cards = [
    {
      icon: Users,
      title: "teamReady" as Key,
      desc: "teamDesc" as Key,
      to: "/members",
    },
    {
      icon: ShieldCheck,
      title: "secureReady" as Key,
      desc: "secureDesc" as Key,
      to: "/security",
    },
    {
      icon: Sparkles,
      title: "aiReady" as Key,
      desc: "aiDesc" as Key,
      to: "/ai",
    },
  ];
  return (
    <>
      <PageHeader
        title="workspace"
        sub="workspaceSub"
        tag={
          <span className="status-pill">
            <span />
            {t("workspaceReady")}
          </span>
        }
      />
      <section className="welcome-panel">
        <div>
          <span className="eyebrow">{t("independent")}</span>
          <h2>{org?.name ?? me.user.name}</h2>
          <p>{t("independentSub")}</p>
          <Link className="button light" to="/organization">
            {t("organization")}
            <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="globe-art" aria-hidden="true">
          <Globe2 />
        </div>
      </section>
      <div className="stat-grid">
        <div className="stat">
          <span>{t("plan")}</span>
          <strong>{t((org?.plan ?? "trial") as Key)}</strong>
          <Link to="/usage">
            {t("viewUsage")}
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="stat">
          <span>{t("memberCount")}</span>
          <strong>
            {members?.filter((m) => m.status === "active").length ?? "—"}
          </strong>
          <small>{t("active")}</small>
        </div>
        <div className="stat">
          <span>{t("accountRole")}</span>
          <strong>{t(me.role)}</strong>
          <small>
            <Check size={14} />
            {t("emailVerified")}
          </small>
        </div>
      </div>
      <div className="section-heading">
        <h2>{t("setup")}</h2>
        <p>{t("setupSub")}</p>
      </div>
      <div className="setup-grid">
        {cards.map((c) => (
          <Link to={c.to} className="setup-card" key={c.title}>
            <c.icon className="tile-icon" size={25} />
            <ArrowUpRight className="corner-arrow" size={19} />
            <h3>{t(c.title)}</h3>
            <p>{t(c.desc)}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
function OrganizationPage() {
  const { t } = useI18n();
  const { me } = useContext(Auth);
  const { data, error, reload } = useData("/organization");
  const { data: orgs } = useData<any[]>("/organizations", true);
  const [success, setSuccess] = useState("");
  return (
    <>
      <PageHeader title="organization" sub="organizationSub" />
      {!data ? (
        <Loading error={error} />
      ) : (
        <section className="panel">
          <div className="panel-title">
            <Building2 size={20} />
            <h2>{t("organization")}</h2>
          </div>
          <Notice success={success} />
          {me.role === "admin" ? (
            <Form
              key={data.name}
              fields={[{ key: "name", label: "organizationName" }]}
              initial={{ name: data.name }}
              onSubmit={async (value) => {
                await api("/organization", "PATCH", value);
                setSuccess(t("saved"));
                await reload();
              }}
            />
          ) : (
            <p>
              {data.name} · {t("readOnly")}
            </p>
          )}
          <div className="detail-row">
            <span>{t("organizationId")}</span>
            <code>{data.id}</code>
          </div>
          <div className="detail-row">
            <span>{t("plan")}</span>
            <span className="badge">{t(data.plan as Key)}</span>
          </div>
          {orgs && orgs.length > 1 && (
            <div className="field">
              <label htmlFor="org-switch">{t("selectOrganization")}</label>
              <select
                id="org-switch"
                value={me.organizationId}
                onChange={(e) => {
                  void api(
                    "/organizations/" + e.target.value + "/select",
                    "POST",
                  ).then(() => window.location.assign("/"));
                }}
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
      )}
    </>
  );
}
function MembersPage() {
  const { t } = useI18n();
  const { me } = useContext(Auth);
  const { data, error, reload } = useData<any[]>("/members", true);
  const [receipt, setReceipt] = useState<string>();
  const [success, setSuccess] = useState("");
  const [actionError, setActionError] = useState<unknown>();
  return (
    <>
      <PageHeader title="members" sub="inviteSub" />
      <Notice error={actionError} success={success} />
      <section className="panel wide">
        <div className="panel-title">
          <Users size={20} />
          <h2>{t("members")}</h2>
          <span className="count">{data?.length ?? 0}</span>
        </div>
        {!data ? (
          <Loading error={error} />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("name")}</th>
                  <th>{t("email")}</th>
                  <th>{t("role")}</th>
                  <th>{t("status")}</th>
                  <th>
                    <span className="sr-only">{t("members")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className="avatar small">
                        {(m.name ?? m.email ?? "M").slice(0, 1).toUpperCase()}
                      </span>
                      {m.name ?? t("invited")}
                    </td>
                    <td>{m.email ?? "—"}</td>
                    <td>
                      {me.role === "admin" &&
                      m.userId !== me.user.id &&
                      m.status === "active" ? (
                        <select
                          aria-label={t("role")}
                          value={m.role}
                          onChange={(e) => {
                            setActionError(undefined);
                            void api("/members/" + m.id, "PATCH", {
                              role: e.target.value,
                            })
                              .then(reload)
                              .then(() => setSuccess(t("memberUpdated")))
                              .catch(setActionError);
                          }}
                        >
                          {(["admin", "editor", "viewer"] as const).map((r) => (
                            <option key={r} value={r}>
                              {t(r)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        t(m.role)
                      )}
                    </td>
                    <td>
                      <span className={"badge " + m.status}>{t(m.status)}</span>
                    </td>
                    <td>
                      {me.role === "admin" &&
                        m.userId !== me.user.id &&
                        m.status !== "revoked" && (
                          <button
                            className="text-danger"
                            onClick={() => {
                              setActionError(undefined);
                              void api("/members/" + m.id, "PATCH", {
                                status: "revoked",
                              })
                                .then(reload)
                                .catch(setActionError);
                            }}
                          >
                            {t("revokeMember")}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {me.role === "admin" && (
        <section className="panel">
          <div className="panel-title">
            <Mail size={20} />
            <h2>{t("invite")}</h2>
          </div>
          <Form
            fields={[
              { key: "email", label: "email", type: "email" },
              {
                key: "role",
                label: "role",
                options: [
                  ["editor", "editor"],
                  ["viewer", "viewer"],
                  ["admin", "admin"],
                ],
              },
            ]}
            submit="invite"
            initial={{ role: "editor" }}
            onSubmit={async (value) => {
              const result = await api("/invitations", "POST", value);
              setReceipt(result.devReceipt);
              setSuccess(t("inviteSent"));
              await reload();
            }}
          />
          <DevMail receipt={receipt} />
        </section>
      )}
    </>
  );
}
function SecurityPage() {
  const { t, locale } = useI18n();
  const { me, reload: reloadMe } = useContext(Auth);
  const { data, error, reload } = useData<any[]>("/auth/sessions", true);
  const [challenge, setChallenge] = useState<any>();
  const [success, setSuccess] = useState("");
  const [actionError, setActionError] = useState<unknown>();
  return (
    <>
      <PageHeader title="security" sub="safe" />
      <Notice success={success} error={actionError} />
      <section className="panel">
        <div className="panel-title">
          <KeyRound size={20} />
          <h2>{t("twoFactor")}</h2>
          <span className="badge active">
            {t(me.user.twoFactorEnabled ? "enabled" : "disabled")}
          </span>
        </div>
        <p>{t("twoFactorSub")}</p>
        <p className="muted">{t("logoutOthers")}</p>
        {challenge ? (
          <>
            <Form
              fields={[{ key: "code", label: "code" }]}
              submit={me.user.twoFactorEnabled ? "disable" : "enable"}
              onSubmit={async (value) => {
                await api("/auth/2fa", "PUT", {
                  challengeId: challenge.challengeId,
                  code: value.code,
                  enabled: !me.user.twoFactorEnabled,
                });
                await reloadMe();
                await reload();
                setChallenge(undefined);
                setSuccess(t("saved"));
              }}
            />
            <DevMail receipt={challenge.devReceipt} />
          </>
        ) : (
          <Form
            fields={[{ key: "password", label: "password", type: "password" }]}
            submit="sendCode"
            onSubmit={async (value) =>
              setChallenge(await api("/auth/2fa/challenge", "POST", value))
            }
          />
        )}
      </section>
      <section className="panel wide">
        <div className="panel-title">
          <Monitor size={20} />
          <h2>{t("sessions")}</h2>
        </div>
        <p>{t("sessionsSub")}</p>
        {!data ? (
          <Loading error={error} />
        ) : (
          <div className="session-list">
            {data.map((s) => (
              <div className="session" key={s.id}>
                <Monitor size={22} aria-hidden="true" />
                <div>
                  <strong>
                    {s.current
                      ? t("currentSession")
                      : s.userAgent || t("unknownDevice")}
                  </strong>
                  <p>
                    {t("created")}:{" "}
                    {new Date(s.createdAt).toLocaleString(
                      locale === "zh" ? "zh-CN" : "en-US",
                    )}
                  </p>
                  <small>
                    {t("expires")}:{" "}
                    {new Date(s.expiresAt).toLocaleDateString(
                      locale === "zh" ? "zh-CN" : "en-US",
                    )}
                  </small>
                </div>
                {s.current ? (
                  <span className="badge active">{t("active")}</span>
                ) : (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setActionError(undefined);
                      void api("/auth/sessions/" + s.id, "DELETE")
                        .then(reload)
                        .then(() => setSuccess(t("sessionRevoked")))
                        .catch(setActionError);
                    }}
                  >
                    {t("revoke")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
function UsagePage() {
  const { t, locale } = useI18n();
  const { data, error } = useData("/usage");
  const fmt = (n: number | null, key: string) =>
    n === null
      ? t("unlimited")
      : key === "storage_bytes"
        ? (n / 1073741824).toFixed(2) + " GiB"
        : new Intl.NumberFormat(locale).format(n);
  return (
    <>
      <PageHeader
        title="usage"
        sub="usageSub"
        tag={
          <Link className="button secondary" to="/organization">
            {t("organization")}
            <ArrowUpRight size={15} />
          </Link>
        }
      />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="section-heading">
            <h2>
              {t("currentPeriod")} · {data.period}
            </h2>
            <p>{t("quotaNotice")}</p>
          </div>
          <div className="usage-grid">
            {(
              [
                "ai_tokens",
                "builds",
                "publishes",
                "inquiries",
                "storage_bytes",
              ] as const
            ).map((key, index) => {
              const row = data.items.find((x: any) => x.metric === key) ?? {
                consumed: 0,
                reserved: 0,
              };
              const percent = Math.min(
                100,
                data.limits[key] === null
                  ? 0
                  : (100 * (row.consumed + row.reserved)) / data.limits[key],
              );
              return (
                <section className="panel usage-card" key={key}>
                  <span className="eyebrow">
                    0{index + 1} / {t(key)}
                  </span>
                  <h2>{fmt(row.consumed, key)}</h2>
                  <p>
                    {t("limit")} {fmt(data.limits[key], key)}
                  </p>
                  {data.limits[key] === null ? (
                    <p>{t("countOnly")}</p>
                  ) : (
                    <progress max={100} value={percent} aria-label={t(key)} />
                  )}
                  <div className="detail-row">
                    <span>{t("reserved")}</span>
                    <strong>{fmt(row.reserved, key)}</strong>
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
function AiPage() {
  const { t } = useI18n();
  const { me } = useContext(Auth);
  const { data, error, reload } = useData("/ai/provider");
  const [enabled, setEnabled] = useState(false);
  const [supportsVision, setSupportsVision] = useState(false);
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>();
  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setSupportsVision(!!data.supportsVision);
    }
  }, [data]);
  return (
    <>
      <PageHeader
        title="ai"
        sub="aiSub"
        tag={<span className="badge">{t("optional")}</span>}
      />
      {me.role !== "admin" ? (
        <Notice error={new ApiError("FORBIDDEN", 403)} />
      ) : !data ? (
        <Loading error={error} />
      ) : (
        <section className="panel">
          <div className="panel-title">
            <Sparkles size={20} />
            <h2>OpenAI</h2>
            <span className={"badge " + (data.configured ? "active" : "")}>
              {t(data.configured ? "configured" : "unconfigured")}
            </span>
          </div>
          <p>{t("aiNotice")}</p>
          <Notice error={actionError} success={success} />
          <Form
            key={data.modelName + data.configured}
            fields={[
              { key: "modelName", label: "modelName" },
              { key: "baseUrl", label: "baseUrl", readOnly: true },
              {
                key: "apiKey",
                label: "apiKey",
                type: "password",
                optional: true,
                placeholder: data.configured ? t("keepKey") : undefined,
              },
            ]}
            initial={{ modelName: data.modelName, baseUrl: data.baseUrl }}
            onSubmit={async (value) => {
              await api("/ai/provider", "PUT", {
                modelName: value.modelName,
                baseUrl: value.baseUrl,
                enabled,
                supportsVision,
                ...(value.apiKey ? { apiKey: value.apiKey } : {}),
              });
              setSuccess(t("saved"));
              await reload();
            }}
          >
            <label className="check-field">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              {t("aiEnabled")}
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={supportsVision}
                onChange={(e) => setSupportsVision(e.target.checked)}
              />
              {t("supportsVision")}
            </label>
          </Form>
          <button
            className="button secondary test-button"
            disabled={!data.enabled || busy}
            onClick={() => {
              setBusy(true);
              setActionError(undefined);
              void api("/ai/provider/test", "POST", undefined, {
                "Idempotency-Key": crypto.randomUUID(),
              })
                .then(() => setSuccess(t("testSuccess")))
                .catch(setActionError)
                .finally(() => setBusy(false));
            }}
          >
            {t(busy ? "saving" : "testConnection")}
          </button>
        </section>
      )}
    </>
  );
}
function AcceptInvite() {
  const { t } = useI18n();
  const [query] = useSearchParams();
  const [accepted, setAccepted] = useState<string>();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="acceptInvite" sub="acceptSub" />
      <section className="panel">
        {accepted ? (
          <>
            <Notice success={t("accepted")} />
            <button
              className="button primary"
              onClick={() => {
                void api("/organizations/" + accepted + "/select", "POST").then(
                  () => navigate(0),
                );
              }}
            >
              {t("openWorkspace")}
            </button>
          </>
        ) : (
          <Form
            fields={[]}
            submit="acceptInvite"
            onSubmit={async () => {
              const row = await api("/invitations/accept", "POST", {
                token: query.get("token"),
              });
              setAccepted(row.organizationId);
            }}
          />
        )}
      </section>
    </>
  );
}
function Workspace() {
  const { t, locale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState<unknown>();
  const [open, setOpen] = useState(false);
  const reload = async () => setMe(await api<Me>("/auth/me"));
  useEffect(() => {
    void reload().catch((e) => {
      if (e instanceof ApiError && e.status === 401)
        navigate(
          "/login?next=" +
            encodeURIComponent(location.pathname + location.search),
          { replace: true },
        );
      else setError(e);
    });
  }, []);
  if (!me)
    return (
      <main className="initial-loading">
        <Loading error={error} />
        <Link to="/login">{t("backLogin")}</Link>
      </main>
    );
  const nav: Array<[string, Key, typeof Globe2]> = [
    ["/", "overview", LayoutDashboard],
    ["/sites", "sites", Globe2],
    ["/inquiries", "inquiries", Mail],
    ["/products", "products", Building2],
    ["/assets", "assets", Building2],
    ["/facts", "facts", ShieldCheck],
    ["/website-reads", "website", Globe2],
    ["/organization", "organization", Building2],
    ["/members", "members", Users],
    ["/security", "security", ShieldCheck],
    ["/usage", "usage", ChartNoAxesCombined],
  ];
  if (me.role === "admin") {
    nav.push(["/ai", "ai", Sparkles]);
    nav.push(["/crm", "crm", Plug]);
  }
  return (
    <Auth.Provider value={{ me, reload }}>
      <div className={"workspace " + (open ? "nav-open" : "")}>
        <a href="#main" className="skip-link">
          {t("continue")}
        </a>
        <aside className="sidebar">
          <Link to="/" className="brand">
            <span className="brand-icon">
              <Globe2 size={24} />
            </span>
            GlobalSite
            <span className="brand-dot" aria-hidden="true">
              ●
            </span>
          </Link>
          <div className="workspace-label">
            <span className="workspace-avatar">
              {me.user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{t("workspace")}</strong>
              <small>{t("independent")}</small>
            </div>
          </div>
          <span className="nav-heading">{t("settings")}</span>
          <nav aria-label={t("settings")}>
            {nav.map(([to, label, Icon]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                onClick={() => setOpen(false)}
              >
                <Icon size={19} aria-hidden="true" />
                {t(label as Key)}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-note">
            <Globe2 size={24} />
            <strong>{t("tagline")}</strong>
            <p>{t("independentSub")}</p>
          </div>
          <div className="account-box">
            <span className="avatar">
              {me.user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{me.user.name}</strong>
              <small>{t(me.role)}</small>
            </div>
            <button
              aria-label={t("signOut")}
              onClick={() => {
                void api("/auth/logout", "POST").then(() => navigate("/login"));
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <button
              className="mobile-menu"
              onClick={() => setOpen(!open)}
              aria-label={t("settings")}
              aria-expanded={open}
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div className="breadcrumb">
              <span>GlobalSite</span>
              <span>/</span>
              <strong>
                {t(
                  (nav.find(
                    ([to]) =>
                      to === location.pathname ||
                      (to === "/inquiries" &&
                        location.pathname.startsWith("/inquiries/")) ||
                      (to === "/sites" &&
                        /^\/(sites|pages)\//.test(location.pathname)),
                  )?.[1] ?? "workspace") as Key,
                )}
              </strong>
            </div>
            <div className="topbar-right">
              <span className="verified">
                <Check size={14} />
                {t("emailVerified")}
              </span>
              <LocaleButton />
            </div>
          </header>
          <main id="main" className="content">
            <Routes>
              <Route index element={<Overview />} />
              <Route
                path="crm"
                element={<CrmConnectionPage locale={locale} role={me.role} />}
              />
              <Route
                path="inquiries"
                element={<InquiriesPage locale={locale} role={me.role} />}
              />
              <Route
                path="inquiries/:id"
                element={<InquiryDetailPage locale={locale} role={me.role} />}
              />
              <Route
                path="sites/:id/inquiry-settings"
                element={<InquirySettingsPage locale={locale} role={me.role} />}
              />
              <Route
                path="sites"
                element={<SitesPage locale={locale} role={me.role} />}
              />
              <Route
                path="sites/:id"
                element={<SiteWorkspace locale={locale} role={me.role} />}
              />
              <Route
                path="sites/:id/publishing"
                element={<PublishPage locale={locale} role={me.role} />}
              />
              <Route
                path="pages/:id"
                element={<PageReview locale={locale} role={me.role} />}
              />
              <Route
                path="products"
                element={<ProductsPage locale={locale} role={me.role} />}
              />
              <Route
                path="products/new"
                element={<ProductEditor locale={locale} role={me.role} />}
              />
              <Route
                path="products/imports"
                element={<ImportPage locale={locale} role={me.role} />}
              />
              <Route
                path="products/:id"
                element={<ProductEditor locale={locale} role={me.role} />}
              />
              <Route
                path="assets"
                element={<AssetsPage locale={locale} role={me.role} />}
              />
              <Route
                path="facts"
                element={<FactsPage locale={locale} role={me.role} />}
              />
              <Route
                path="website-reads"
                element={<WebsitePage locale={locale} role={me.role} />}
              />
              <Route path="organization" element={<OrganizationPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="security" element={<SecurityPage />} />
              <Route path="usage" element={<UsagePage />} />
              <Route path="ai" element={<AiPage />} />
              <Route path="accept-invitation" element={<AcceptInvite />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <footer className="workspace-footer">
            <span>© {new Date().getFullYear()} GlobalSite</span>
            <span>{t("independent")}</span>
          </footer>
        </div>
      </div>
    </Auth.Provider>
  );
}
function App() {
  const [locale, setLocaleState] = useState<Locale>(
    localStorage.getItem("globalsite_locale") === "en" ? "en" : "zh",
  );
  const setLocale = (next: Locale) => {
    setLocaleState(next);
    localStorage.setItem("globalsite_locale", next);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <I18n.Provider
      value={{ locale, setLocale, t: (key) => messages[locale][key] ?? key }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<Verify />} />
          <Route path="/resend-verification" element={<ResendVerification />} />
          <Route path="/forgot-password" element={<PasswordPage />} />
          <Route path="/reset-password" element={<PasswordPage reset />} />
          <Route path="/*" element={<Workspace />} />
        </Routes>
      </BrowserRouter>
    </I18n.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
