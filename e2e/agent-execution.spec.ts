import { test, expect } from "@playwright/test";
import { login } from "./helpers/site-login";
test("agent work panel queues, pauses and cancels a real Worker task with explicit consent", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, request);
  const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080",
    csrf = (await page.context().cookies()).find(
      (c) => c.name === "gs_csrf",
    )!.value,
    headers = { Origin: origin, "X-CSRF-Token": csrf };
  const p = await page.request.post("/api/v1/products", {
    headers,
    data: { name: "Fixture travel collection", status: "draft" },
  });
  expect(p.status()).toBe(201);
  const s = await page.request.post("/api/v1/sites", {
    headers,
    data: {
      name: "Atlas Workbench",
      templateId: "adaptive",
      businessBrief: "Travel accessories for wholesale importers.",
      targetMarkets: ["UK"],
      language: "en",
      brandColor: "#126a54",
      logoId: null,
      productIds: [(await p.json()).data.id],
    },
  });
  expect(s.status()).toBe(201);
  const siteId = (await s.json()).data.id;
  await page.goto("/agent?site=" + siteId);
  const controls = page.locator(".task-control"),
    detail = page.locator(".task-detail");
  await expect(controls).toBeVisible();
  await expect(
    controls.getByRole("button", { name: "开始执行", exact: true }),
  ).toBeDisabled();
  await controls
    .getByLabel("任务类型", { exact: true })
    .selectOption("research");
  await controls
    .getByLabel("补充要求", { exact: true })
    .fill("Prioritize product discovery and the wholesale inquiry path.");
  await controls.getByRole("checkbox").check();
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith("/sites/" + siteId + "/agent-runs"),
    ),
    controls.getByRole("button", { name: "开始执行", exact: true }).click(),
  ]);
  expect(response.status()).toBe(202);
  await expect(
    detail.getByRole("heading", { name: "规划网站结构", exact: true }),
  ).toBeVisible();
  await expect(
    controls.getByText("请先由管理员配置 AI 服务商，再恢复任务", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    controls.getByRole("link", { name: "配置 AI 服务", exact: true }),
  ).toHaveAttribute("href", "/ai");
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-nav-collapsed",
    "true",
  );
  await page.getByRole("button", { name: "展开主导航", exact: true }).click();
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-nav-collapsed",
    "false",
  );
  await page.getByRole("button", { name: "收起主导航", exact: true }).click();
  await page.screenshot({ path: "test-results/s20-agent-live-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".task-mobile-switch")
    .getByRole("button", { name: "操作", exact: true })
    .click();
  await expect(controls).toBeVisible();
  await expect(detail).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await controls.getByRole("button", { name: "取消任务", exact: true }).click();
  await page
    .locator(".task-mobile-switch")
    .getByRole("button", { name: "成果", exact: true })
    .click();
  await expect(
    detail.locator("header").getByText("已取消", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const me = (await (await page.request.get("/api/v1/auth/me")).json()).data;
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ json: { success: true, data: { ...me, role: "viewer" } } }),
  );
  await page.reload();
  await expect(controls.getByText(/你当前为只读成员/)).toBeVisible();
  await expect(
    controls.getByRole("button", { name: "开始执行", exact: true }),
  ).toHaveCount(0);
  await expect(
    controls.getByRole("button", { name: "重试 / 恢复", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
