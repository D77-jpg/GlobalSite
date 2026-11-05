import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080";
async function seed(request: APIRequestContext) {
  const password = "Fixture-" + randomBytes(20).toString("hex"),
    email = "browser-" + randomBytes(8).toString("hex") + "@example.invalid";
  const signup = await request.post("/api/v1/auth/register", {
    headers: { Origin: origin },
    data: {
      email,
      password,
      name: "Demo User",
      organizationName: "Demo Export Studio",
      locale: "en",
    },
  });
  expect(signup.status()).toBe(202);
  const info = await signup.json();
  const mail = await request.get("/api/v1/dev/mail/" + info.data.devReceipt);
  const text = (await mail.json()).data.text;
  const token = new URL(text).searchParams.get("token");
  expect(
    (
      await request.post("/api/v1/auth/verify-email", {
        headers: { Origin: origin },
        data: { token },
      })
    ).ok(),
  ).toBeTruthy();
  return { email, password };
}
test("desktop: register, verify, sign in, organization, invitation, usage and two-step verification", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const password = "Fixture-" + randomBytes(20).toString("hex"),
    email = "ui-" + randomBytes(8).toString("hex") + "@example.invalid";
  await page.goto("/register");
  await page.getByLabel("姓名", { exact: true }).fill("Demo User");
  await page
    .getByLabel("企业 / 组织名称", { exact: true })
    .fill("Demo Export Studio");
  await page.getByLabel("工作邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByText("请查看邮箱，完成验证后再登录。")).toBeVisible();
  await page.getByRole("link", { name: "返回登录" }).click();
  await page.getByRole("link", { name: "重新发送验证邮件" }).click();
  await page.getByLabel("工作邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "查看开发邮件" }).click();
  await page.locator(".mail-body a").click();
  await expect(page.getByText("邮箱已验证，可以登录了。")).toBeVisible();
  await page.getByRole("link", { name: "返回登录" }).click();
  await page.getByLabel("工作邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Demo Export Studio", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/desktop-workspace.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "组织设置" })
    .click();
  await page
    .getByLabel("企业 / 组织名称", { exact: true })
    .fill("Demo Export Team");
  await page.getByRole("button", { name: "保存更改" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "成员管理" })
    .click();
  await page
    .getByLabel("工作邮箱", { exact: true })
    .fill("invite-" + randomBytes(6).toString("hex") + "@example.invalid");
  await page.getByRole("button", { name: "邀请成员", exact: true }).click();
  await expect(page.getByText("邀请已发送", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "套餐与用量" })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "AI Tokens", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换语言" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan & usage", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Change language" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "个人安全" })
    .click();
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await page.getByRole("button", { name: "查看开发邮件" }).click();
  const code = (await page.locator(".mail-body").innerText()).match(
    /[0-9]{6}/,
  )![0];
  await page.getByLabel("六位验证码").fill(code);
  await page.getByRole("button", { name: "启用", exact: true }).click();
  await expect(page.getByText("已启用", { exact: true })).toBeVisible();
  await expect(page.getByText("当前会话", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByLabel("工作邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "检查你的邮箱" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看开发邮件" }).click();
  const loginCode = (await page.locator(".mail-body").innerText()).match(
    /[0-9]{6}/,
  )![0];
  await page.getByLabel("六位验证码").fill(loginCode);
  await page.getByRole("button", { name: "验证并继续" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  expect(failures).toEqual([]);
});
test("mobile: sign in, navigate settings, switch language and avoid horizontal overflow", async ({
  page,
  request,
}) => {
  const user = await seed(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("工作邮箱", { exact: true }).fill(user.email);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Demo Export Studio", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/mobile-workspace.png",
    fullPage: true,
  });
  await page.locator(".mobile-menu").click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "个人安全" })
    .click();
  await expect(
    page.getByRole("heading", { name: "个人安全", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换语言" }).click();
  await expect(
    page.getByRole("heading", { name: "Personal security", exact: true }),
  ).toBeVisible();
});
