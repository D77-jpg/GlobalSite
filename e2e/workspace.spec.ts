import { test, expect } from "@playwright/test";
import { login } from "./helpers/site-login";

test("workspace navigation, agent handoff and responsive screens", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Other suites use the same IP. Exercise the sweep inside a fresh rate window.
  await page.waitForTimeout(60000 - (Date.now() % 60000) + 250);
  await login(page, request);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  await palette.getByRole("textbox").fill("/agent");
  await palette.getByRole("textbox").press("Enter");
  await expect(page).toHaveURL(/\/agent$/);
  await expect(
    page.getByRole("heading", { name: "建站 Agent", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main a[href='/sites']")).toBeVisible();
  const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080";
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "gs_csrf",
  )!.value;
  const headers = { Origin: origin, "X-CSRF-Token": csrf };
  const product = await page.request.post("/api/v1/products", {
    headers,
    data: { name: "Canvas weekender", status: "draft" },
  });
  expect(product.ok()).toBe(true);
  const created = await page.request.post("/api/v1/sites", {
    headers,
    data: {
      name: "Atlas Supply",
      templateId: "packaging-bags",
      targetMarkets: ["UK"],
      language: "en",
      brandColor: "#174a39",
      logoId: null,
      productIds: [(await product.json()).data.id],
    },
  });
  expect(created.ok()).toBe(true);
  const siteId = (await created.json()).data.id;
  await page.reload();
  await expect(page.locator(".agent-picker select")).toHaveValue(siteId);
  await page.locator(".agent-handoffs a").first().click();
  await expect(page).toHaveURL(new RegExp(siteId + "\\?tab=planning"));

  await page.getByRole("button", { name: "保存站点地图", exact: true }).click();
  await page.getByRole("button", { name: "确认站点地图", exact: true }).click();
  await expect(page.getByText("站点地图已确认", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "内容与审核", exact: true }).click();
  await page
    .getByRole("button", { name: "手工创建页面", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "编辑与审核", exact: true }).first(),
  ).toBeVisible();
  const run = await page.request.post(
    "/api/v1/sites/" + siteId + "/agent-runs",
    {
      headers: { ...headers, "Idempotency-Key": "workspace-review-" + siteId },
      data: { step: "research", consent: true },
    },
  );
  expect(run.status()).toBe(202);
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("textbox").fill("zzzzzzz");
  await expect(page.getByRole("dialog").getByRole("status")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const apiErrors: string[] = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/api/v1/") && response.status() >= 400) {
      apiErrors.push(response.status() + " " + pathname);
    }
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 940 });
    for (const path of [
      "/",
      "/agent",
      "/sites",
      "/products",
      "/products/new",
      "/products/imports",
      "/assets",
      "/facts",
      "/website-reads",
      "/inquiries",
      "/organization",
      "/members",
      "/security",
      "/usage",
      "/ai",
      "/crm",
    ]) {
      await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog");
      await dialog.locator('a[href="' + path + '"]').click();
      await expect(page).toHaveURL((url) => url.pathname === path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(apiErrors, path + " at " + width).toEqual([]);
      if (path === "/") {
        await expect(page.locator(".mission-context select")).toHaveValue(
          siteId,
        );
        await expect(page.locator(".mission-jobs li").first()).toBeVisible();
      }
      if (path === "/agent") {
        await expect(page.locator(".agent-picker select")).toHaveValue(siteId);
        await expect(page.locator(".studio-run").first()).toBeVisible();
      }
      if (path === "/inquiries") {
        await expect(
          page
            .locator("main select option")
            .filter({ hasText: "Atlas Supply" }),
        ).toHaveCount(1);
      }
      if (path === "/sites")
        await expect(
          page.getByRole("link", { name: "Atlas Supply", exact: true }),
        ).toBeVisible();
      if (path === "/products")
        await expect(
          page.getByRole("link", { name: "Canvas weekender", exact: true }),
        ).toBeVisible();
      if (path === "/members")
        await expect(page.locator("main tbody tr").first()).toBeVisible();
      if (path === "/security")
        await expect(
          page.locator("main .session-list .session").first(),
        ).toBeVisible();
      if (path === "/usage")
        await expect(page.locator("main .usage-card").first()).toBeVisible();
      if (path === "/ai")
        await expect(
          page.locator(".account-provider form").first(),
        ).toBeVisible();
      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(overflowing, path + " at " + width).toBe(false);
      if (["/", "/agent", "/products", "/inquiries"].includes(path)) {
        await page.screenshot({
          path:
            "test-results/s15-" +
            (path.slice(1) || "overview") +
            "-" +
            width +
            ".png",
        });
      }
    }
  }
  expect(apiErrors).toEqual([]);
  expect(errors).toEqual([]);
});
