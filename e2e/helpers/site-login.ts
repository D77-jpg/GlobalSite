import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080";
export async function login(page: Page, request: APIRequestContext) {
  const email = "s4-" + randomBytes(8).toString("hex") + "@example.invalid",
    password = "Fixture-" + randomBytes(20).toString("hex");
  let reg = await request.post("/api/v1/auth/register", {
    headers: { Origin: origin },
    data: {
      name: "Site Demo",
      organizationName: "Site Demo",
      email,
      password,
      locale: "en",
    },
  });
  if (reg.status() === 429) {
    await page.waitForTimeout(
      Math.min(60000, Number(reg.headers()["retry-after"] ?? 60) * 1000),
    );
    reg = await request.post("/api/v1/auth/register", {
      headers: { Origin: origin },
      data: {
        name: "Site Demo",
        organizationName: "Site Demo",
        email,
        password,
        locale: "en",
      },
    });
  }
  expect(reg.status()).toBe(202);
  const mail = await request.get(
    "/api/v1/dev/mail/" + (await reg.json()).data.devReceipt,
  );
  expect(
    (
      await request.post("/api/v1/auth/verify-email", {
        headers: { Origin: origin },
        data: {
          token: new URL((await mail.json()).data.text).searchParams.get(
            "token",
          ),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("工作邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Site Demo", exact: true }),
  ).toBeVisible();
}
