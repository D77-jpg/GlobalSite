const allowed = new Set([
  "/",
  "/agent",
  "/sites/new",
  "/organization",
  "/sites",
  "/inquiries",
  "/crm",
  "/products",
  "/products/new",
  "/products/imports",
  "/assets",
  "/facts",
  "/website-reads",
  "/members",
  "/security",
  "/usage",
  "/ai",
  "/accept-invitation",
]);
export function safeReturnTo(value: string | null, origin: string) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\\]|%5c/i.test(value)
  )
    return "/";
  try {
    const url = new URL(value, origin);
    return url.origin === origin &&
      (allowed.has(url.pathname) ||
        /^\/sites\/[a-f0-9]{24}\/(?:inquiry-settings|publishing|preview)$/.test(
          url.pathname,
        ) ||
        /^\/(?:products|sites|pages|inquiries)\/[a-f0-9]{24}$/.test(
          url.pathname,
        ))
      ? url.pathname + url.search
      : "/";
  } catch {
    return "/";
  }
}
