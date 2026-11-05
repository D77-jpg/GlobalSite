import { test, expect } from "@playwright/test";
import { login } from "./helpers/site-login";

test("site desktop: create, edit and confirm map, blocked facts, safe preview, approval invalidation and paused AI", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, request);
  await page.goto("/sites");
  await page.getByRole("button", { name: "创建站点", exact: true }).click();
  await page.getByLabel("站点名称", { exact: true }).fill("Fixture Export");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("link", { name: "Fixture Export", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Fixture Export", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加页面", exact: true }).click();
  const node = page.locator(".sites-tree-node").last();
  await node.getByLabel("页面标题", { exact: true }).fill("About");
  await node.getByLabel("网址路径", { exact: true }).fill("/about");
  await page.getByRole("button", { name: "保存站点地图", exact: true }).click();
  await expect(page.locator(".sites-tree-node")).toHaveCount(2);
  await page.getByRole("button", { name: "确认站点地图", exact: true }).click();
  await expect(page.getByText("站点地图已确认", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".catalog h1").click();
  await page.screenshot({
    path: "test-results/s4-sitemap-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "内容与审核", exact: true }).click();
  await page
    .getByRole("button", { name: "手工创建页面", exact: true })
    .first()
    .click();
  await page
    .getByRole("link", { name: "编辑与审核", exact: true })
    .first()
    .click();
  await page.getByLabel("段落正文", { exact: true }).fill("Founded in 1998.");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByText("数字缺少匹配的已确认依据 · 1998").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "批准整页", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/s4-blocked-review-desktop.png",
    fullPage: true,
  });
  await page
    .getByLabel("段落正文", { exact: true })
    .fill("Contact our team to discuss your project.");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "批准整页", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "查看已保存的预览", exact: true })
    .click();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "批准整页", exact: true }).click();
  await expect(page.getByText("已批准", { exact: true })).toBeVisible();
  await page
    .getByLabel("段落正文", { exact: true })
    .fill("Contact our team for application guidance.");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("待审核", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "站点", exact: true }).last().click();
  await page.getByRole("checkbox").first().check();
  await page
    .getByRole("button", { name: "生成关键词与规划建议", exact: true })
    .click();
  await expect(page.getByText("已暂停", { exact: true }).first()).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByText("请先由管理员配置 AI 服务商，再恢复任务", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(page.getByText("已取消", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "切换语言", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Agent jobs", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Change language", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "添加页面", exact: true }).click();
  await page.getByRole("button", { name: "添加页面", exact: true }).click();
  await page
    .getByRole("button", { name: /上移 New page/ })
    .last()
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/s4-sitemap-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
