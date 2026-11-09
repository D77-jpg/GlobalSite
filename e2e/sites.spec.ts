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
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "gs_csrf",
  )!.value;
  const fixture = await page.request.post("/api/v1/products", {
    headers: {
      Origin: process.env.E2E_BASE_URL ?? "http://localhost:5080",
      "X-CSRF-Token": csrf,
    },
    data: { name: "Travel collection", status: "draft" },
  });
  expect(fixture.status()).toBe(201);
  const productId = (await fixture.json()).data.id;

  await page.goto("/sites");
  await page.getByRole("link", { name: "创建站点", exact: true }).click();
  await expect(page).toHaveURL(/\/sites\/new$/);
  await page.screenshot({ path: "test-results/s16-create-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "创建你的网站" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/s16-create-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByLabel("站点名称", { exact: true }).fill("Fixture Export");
  await page
    .getByLabel("面向哪些客户", { exact: true })
    .fill("Wholesale buyers");
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await expect(page.getByText("基础版式", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("描述你的业务与建站目标", { exact: true })
    .fill("We supply travel products for wholesale buyers.");

  await page
    .getByRole("button", { name: "下一步，选择产品", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /Travel collection/ }).check();
  await page.getByRole("button", { name: "上一步", exact: true }).click();
  await expect(page.getByLabel("站点名称", { exact: true })).toHaveValue(
    "Fixture Export",
  );
  await expect(page.getByLabel("面向哪些客户", { exact: true })).toHaveValue(
    "Wholesale buyers",
  );
  await page
    .getByRole("button", { name: "下一步，选择产品", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Travel collection/ }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "创建并进入建站向导", exact: true })
    .click();
  await expect(page).toHaveURL(/tab=guide/);
  const created = await page.request.get(
    "/api/v1/sites/" + new URL(page.url()).pathname.split("/")[2],
  );
  const siteData = (await created.json()).data;
  expect(siteData.productIds).toEqual([productId]);
  expect(siteData.templateId).toBe("adaptive");
  expect(siteData.businessBrief).toBe(
    "We supply travel products for wholesale buyers.",
  );
  expect(siteData.buyerProfile.audiences).toEqual(["Wholesale buyers"]);

  await expect(
    page.getByRole("heading", { name: "建站向导", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/s16-guide-desktop.png" });
  await page
    .getByRole("button", { name: "关键词与站点地图", exact: true })
    .click();
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
  await page.getByRole("button", { name: "添加品牌展示", exact: true }).click();
  await page
    .getByLabel("首屏标题", { exact: true })
    .fill("A clear product collection");
  await page
    .getByLabel("首屏简介", { exact: true })
    .fill("Explore our products and share your requirements.");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("首屏标题", { exact: true })).toHaveValue(
    "A clear product collection",
  );
  await expect(page.getByText("待审核", { exact: true }).first()).toBeVisible();
  await page
    .getByLabel("段落正文", { exact: true })
    .fill("Contact our team for application guidance.");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("待审核", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "站点", exact: true }).last().click();
  await expect(
    page.getByRole("heading", { name: "建站向导", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "预览并选择设计方案", exact: true })
    .click();
  await expect(page).toHaveURL(/tab=design/);
  const generate = page.getByRole("button", {
    name: "生成两种首页方案",
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await page.locator(".design-consent input").check();
  await generate.click();
  await page.getByRole("button", { name: "建站向导", exact: true }).click();
  await expect(page.locator(".guide-next [role=status]")).toContainText(
    "已暂停",
    { timeout: 20000 },
  );
  await page
    .getByRole("button", { name: "处理暂停或失败的任务", exact: true })
    .click();
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
  await expect(
    page.getByRole("button", { name: "Agent 任务", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "关键词与站点地图", exact: true })
    .click();
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
