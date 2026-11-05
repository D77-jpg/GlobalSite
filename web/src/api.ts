let refresh: Promise<Response> | undefined;
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
const csrf = () =>
  document.cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("gs_csrf="))
    ?.slice(8) ?? "";
export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const run = () =>
    fetch("/api/v1" + path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(data && !(data instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        "X-CSRF-Token": csrf(),
        ...headers,
      },
      ...(data
        ? { body: data instanceof FormData ? data : JSON.stringify(data) }
        : {}),
    });
  let response = await run();
  if (
    response.status === 401 &&
    !["/auth/login", "/auth/refresh", "/auth/2fa/verify"].includes(path)
  ) {
    refresh ??= fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": csrf() },
    }).finally(() => {
      refresh = undefined;
    });
    if ((await refresh).ok) response = await run();
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(body.error?.code ?? "INTERNAL_ERROR", response.status);
  return body.data;
}
