import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080";
async function login(page: Page, request: APIRequestContext) {
  const email = "s3-" + randomBytes(8).toString("hex") + "@example.invalid",
    password = "Fixture-" + randomBytes(20).toString("hex");
  const reg = await request.post("/api/v1/auth/register", {
    headers: { Origin: origin },
    data: {
      name: "Catalog Demo",
      organizationName: "Catalog Demo",
      email,
      password,
      locale: "en",
    },
  });
  expect(reg.status()).toBe(202);
  const mail = await request.get(
      "/api/v1/dev/mail/" + (await reg.json()).data.devReceipt,
    ),
    token = new URL((await mail.json()).data.text).searchParams.get("token");
  expect(
    (
      await request.post("/api/v1/auth/verify-email", {
        headers: { Origin: origin },
        data: { token },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("工作邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Catalog Demo", exact: true }),
  ).toBeVisible();
}
test("catalog desktop: image upload, product/spec/table editing, import worker, facts/review/history, website safety and translations", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, request);
  await page.goto("/assets");
  // Valid one-pixel PNG fixture, re-encoded and checked by the image pipeline.
  await page
    .getByLabel("文件", { exact: true })
    .setInputFiles({
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
  await page
    .getByLabel("文件", { exact: true })
    .setInputFiles({
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
