import { login as fixtureLogin } from "./helpers/site-login";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080";
async function login(page: Page, request: APIRequestContext) {
  await fixtureLogin(page, request, "Catalog Demo");
}

test("catalog desktop: image upload, product/spec/table editing, import worker, facts/review/history, website safety and translations", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, request);
  await page.goto("/assets");
  await page
    .getByRole("button", { name: "上传资料", exact: true })
    .first()
    .click();
  // Valid one-pixel PNG fixture, re-encoded and checked by the image pipeline.
  await page.getByLabel("文件", { exact: true }).setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWMQygqBIwbiOABOIw0BkpnXJwAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "上传", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "fixture.png", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("文件", { exact: true })).toHaveValue("");
  const openAsset = page.getByRole("button", {
    name: "预览资料 fixture.png",
    exact: true,
  });
  await openAsset.click();
  const modal = page.getByRole("dialog", { name: "预览资料", exact: true });
  await expect(
    modal.getByRole("heading", { name: "fixture.png", exact: true }),
  ).toBeVisible();
  await expect(modal.locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  const menu = page.getByRole("button", {
    name: "文件操作 fixture.png",
    exact: true,
  });
  await menu.click();
  await expect(
    page
      .locator(".asset-menu-content")
      .getByRole("link", { name: "下载原件", exact: true }),
  ).toHaveAttribute("href", /\/api\/v1\/assets\/[a-f0-9]{24}\/download/);
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await expect(page.locator(".asset-list")).toBeVisible();
  await page.getByRole("button", { name: "网格视图", exact: true }).click();
  await page.getByRole("button", { name: "PDF 文档", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "这里还没有资料", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "图片", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "fixture.png", exact: true }),
  ).toBeVisible();
  await menu.click();
  await page
    .locator(".asset-menu-content")
    .getByRole("button", { name: "提取候选事实", exact: true })
    .click();
  await expect(page.locator(".asset-extraction")).toBeFocused();
  await page.locator(".asset-extraction-heading button").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/s18-assets-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await openAsset.click();
  await expect(modal).toBeVisible();
  expect(await modal.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/s18-assets-mobile-preview.png" });
  await modal.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/products/new");
  await page.getByLabel("产品名称", { exact: true }).fill("Fixture Pump");
  await page.getByLabel("产品编号", { exact: true }).fill("E2E-PUMP");
  await page.getByLabel("材质", { exact: true }).fill("Steel");
  await page.getByRole("button", { name: "添加参数", exact: true }).click();
  await page.getByLabel("参数名称", { exact: true }).fill("Power");
  await page.getByLabel("值", { exact: true }).fill("10");
  await page.getByLabel("单位", { exact: true }).fill("kW");
  await page
    .getByLabel("列标题（用逗号分隔）", { exact: true })
    .fill("Model, Weight");
  await page.getByRole("button", { name: "添加一行", exact: true }).click();
  await page.getByLabel("Model 1", { exact: true }).fill("A");
  await page.getByLabel("Weight 1", { exact: true }).fill("10 kg");
  await page.locator(".catalog-pick").getByRole("checkbox").check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/products\/[a-f0-9]{24}$/);
  await expect(page.getByLabel("产品名称", { exact: true })).toHaveValue(
    "Fixture Pump",
  );
  await page.getByLabel("交期", { exact: true }).fill("30 days");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByLabel("交期", { exact: true })).toHaveValue("30 days");
  await page.reload();
  await expect(page.getByLabel("交期", { exact: true })).toHaveValue("30 days");
  await page.screenshot({
    path: "test-results/s3-product-desktop.png",
    fullPage: true,
  });
  await page.goto("/products/imports");
  await page.getByLabel("文件", { exact: true }).setInputFiles({
    name: "catalog.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,sku,material\nImported Pump,IMPORT-E2E,Steel\n,INVALID-E2E,Steel",
    ),
  });
  await page.getByRole("button", { name: "上传", exact: true }).click();
  await expect(
    page.getByText("总行数: 2 · 有效行: 1 · 错误行: 1", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "导入所有有效行 (1)", exact: true })
    .click();
  await expect(
    page
      .locator(".catalog-panel")
      .filter({
        has: page.getByRole("heading", { name: "catalog.csv", exact: true }),
      })
      .getByText("已完成", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.goto("/products");
  await expect(
    page.getByRole("link", { name: "Imported Pump", exact: true }),
  ).toBeVisible();
  await page.goto("/facts");
  await page.getByRole("button", { name: "手工添加事实", exact: true }).click();
  await page.getByLabel("事实类型", { exact: true }).fill("company.founded");
  await page.getByLabel("值", { exact: true }).fill("1998");
  await page
    .getByLabel("原文或确认依据", { exact: true })
    .fill("Company founded in 1998");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "1998", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "1998", exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("状态", { exact: true }).selectOption("confirmed");
  await expect(page.getByText("已确认", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "历史记录", exact: true }).click();
  await expect(
    page.getByText("版本 2 · 已确认", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/s3-facts-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "切换语言", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Business facts", exact: true }),
  ).toBeVisible();
  await page.goto("/website-reads");
  await page
    .getByLabel("Website URL", { exact: true })
    .fill("http://127.0.0.1");
  await page.getByRole("button", { name: "Read website", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use a public website address. Private or local addresses are blocked.",
  );
  expect(errors).toEqual([]);
});
test("catalog mobile: usable source review and upload/import layout without horizontal overflow", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, request);
  for (const path of [
    "/products",
    "/products/new",
    "/products/imports",
    "/assets",
    "/facts",
    "/website-reads",
  ]) {
    await page.goto(path);
    await expect(page.locator(".catalog h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.goto("/facts");
  await page.getByRole("button", { name: "手工添加事实", exact: true }).click();
  await page.getByLabel("事实类型", { exact: true }).fill("company.capacity");
  await page.getByLabel("值", { exact: true }).fill("100 units");
  await page
    .getByLabel("原文或确认依据", { exact: true })
    .fill("Capacity 100 units");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "100 units", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/s3-facts-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
