import {
  expect,
  test,
  type Page,
  type APIRequestContext,
  type APIResponse,
  type Response,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080";
async function cooldown(page: Page, headers: Record<string, string>) {
  const seconds = Number(headers["retry-after"] ?? 60);
  const delay = Math.min(
    60000,
    Math.max(1000, Number.isFinite(seconds) ? seconds * 1000 : 60000),
  );
  // Only an actual 429 grants the time explicitly required by the server.
  test.setTimeout(test.info().timeout + delay + 5000);
  await page.waitForTimeout(delay);
}
async function limited(page: Page, action: () => Promise<APIResponse>) {
  let response = await action();
  if (response.status() === 429) {
    await cooldown(page, response.headers());
    response = await action();
  }
  return response;
}
export async function login(
  page: Page,
  request: APIRequestContext,
  name = "Site Demo",
) {
  const email = "s4-" + randomBytes(8).toString("hex") + "@example.invalid",
    password = "Fixture-" + randomBytes(20).toString("hex");
  const reg = await limited(page, () =>
    request.post("/api/v1/auth/register", {
      headers: { Origin: origin },
      data: { name, organizationName: name, email, password, locale: "en" },
    }),
  );
  expect(reg.status()).toBe(202);
  const registration = (await reg.json()).data;
  // Receipt and verification token stay in memory and are never logged.
  const mail = await limited(page, () =>
    request.get("/api/v1/dev/mail/" + registration.devReceipt),
  );
  expect(mail.status()).toBe(200);
  const token = new URL((await mail.json()).data.text).searchParams.get(
    "token",
  );
  const verified = await limited(page, () =>
    request.post("/api/v1/auth/verify-email", {
      headers: { Origin: origin },
      data: { token },
    }),
  );
  expect(verified.ok()).toBe(true);
  let rateHit: Response | undefined;
  const watch = (response: Response) => {
    if (
      response.status() === 429 &&
      new URL(response.url()).pathname.startsWith("/api/v1/auth/")
    )
      rateHit = response;
  };
  page.on("response", watch);
  try {
    await page.goto("/login");
    await page.getByLabel("工作邮箱", { exact: true }).fill(email);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await expect(
          page.getByRole("heading", { name, exact: true }),
        ).toBeVisible();
        return;
      } catch (error) {
        if (!rateHit || attempt === 1) throw error;
        await cooldown(page, await rateHit.allHeaders());
        rateHit = undefined;
        const retry = page.getByRole("button", { name: "重试", exact: true });
        if (await retry.isVisible()) await retry.click();
        else
          await page.getByRole("button", { name: "登录", exact: true }).click();
      }
    }
  } finally {
    page.off("response", watch);
  }
}

// Full navigations reload the session; honor the same auth bucket as a user.
export async function gotoWorkspace(page: Page, path: string) {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/auth/me",
  );
  const [, auth] = await Promise.all([page.goto(path), response]);
  if (auth.status() === 429) {
    await cooldown(page, await auth.allHeaders());
    await page.getByRole("button", { name: "重试", exact: true }).click();
  }
}
