import { test, expect } from "@playwright/test";
import { login } from "./helpers/site-login";
import { randomUUID } from "node:crypto";
test("S6 preview: privacy choices, multi-product inquiry with attachment, management, notes and CSV", async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, request);
  const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080",
    csrf = (await page.context().cookies()).find(
      (c) => c.name === "gs_csrf",
    )!.value;
  async function call(method: string, path: string, data?: unknown) {
    const r = await page.request.fetch("/api/v1" + path, {
      method,
      headers: {
        Origin: origin,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": randomUUID(),
      },
      data,
    });
    expect(r.ok(), path + " " + r.status()).toBeTruthy();
    return (await r.json()).data;
  }
  const products = [];
  for (const name of ["Sample pumps", "Sample equipment"])
    products.push(await call("POST", "/products", { name, status: "active" }));
  let site = await call("POST", "/sites", {
    name: "Atlas Inquiry",
    templateId: "machinery",
    targetMarkets: ["UK"],
    language: "en",
    brandColor: "#16634a",
    logoId: null,
    productIds: products.map((p) => p.id),
  });
  const nodes = [
    {
      key: "home",
      path: "/",
      title: "Industrial sourcing",
      type: "home",
      parentKey: null,
      productId: null,
      keywords: [],
      intent: "source",
    },
    ...products.map((p, i) => ({
      key: "product-" + i,
      path: "/products/sample-" + i,
      title: p.name,
      type: "product",
      parentKey: "home",
      productId: p.id,
      keywords: [],
      intent: "source",
    })),
  ];
  site = await call("PUT", "/sites/" + site.id + "/plan", {
    revision: site.planRevision,
    nodes,
    keywords: [],
    clusters: [],
  });
  site = await call("POST", "/sites/" + site.id + "/plan/confirm", {
    revision: site.planRevision,
  });
  const text =
    "Our team helps buyers explore product options and prepare a clear purchasing brief. Share your application, preferred materials, packaging requirements and intended market with our team. We will discuss the details with you before preparing a proposal. Browse the information below to learn about our approach and find the right contact for your project. Product details are reviewed by our team before publication.";
  for (const node of nodes) {
    let p = await call("POST", "/sites/" + site.id + "/pages", {
      nodeKey: node.key,
    });
    const blocks = p.blocks.filter((b: any) => b.key !== "overview");
    blocks.push({
      key: "overview",
      type: "text",
      heading: "Purchasing support",
      body: text,
      refs: [],
      table: null,
      faq: [],
      assetId: null,
      alt: "",
    });
    p = await call("PATCH", "/pages/" + p.id, {
      revision: p.revision,
      data: {
        title: p.title,
        metaDescription: p.metaDescription,
        refs: p.refs,
        blocks,
      },
    });
    await call("POST", "/pages/" + p.id + "/approve", { revision: p.revision });
  }
  await page.goto("/sites/" + site.id + "/inquiry-settings");
  await page
    .getByRole("checkbox", { name: "启用在线询盘", exact: true })
    .check();
  await page.getByRole("checkbox", { name: /我已审阅隐私政策模板/ }).check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await call("PUT", "/sites/" + site.id + "/publishing-settings", {
    revision: 0,
    canonicalBaseUrl: "https://s6.example.invalid",
    accountId: null,
    projectName: null,
    productionBranch: "main",
    domain: null,
  });
  const version = await call("POST", "/sites/" + site.id + "/builds", {});
  let ready = false;
  for (let i = 0; i < 55; i++) {
    const v = await call("GET", "/site-versions/" + version.id);
    if (v.status === "failed")
      throw Error("Static build failed: " + v.errorCode);
    if (v.status === "ready") {
      ready = true;
      break;
    }
    await page.waitForTimeout(2000);
  }
  expect(ready).toBeTruthy();
  const preview = await page.context().newPage();
  preview.on("pageerror", (e) => errors.push(e.message));
  await preview.goto(
    "/api/v1/site-versions/" + version.id + "/preview/?utm_source=fixture-s6",
  );
  await expect(
    preview.getByRole("heading", { name: "Your privacy choices", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Reject optional", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Your privacy choices", exact: true }),
  ).toBeHidden();
  expect(
    await preview.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith("gs-first-visit:")),
    ),
  ).toBeFalsy();
  await expect(preview.getByLabel("Your name", { exact: false })).toBeEnabled({
    timeout: 15000,
  });
  await preview.getByLabel("Your name", { exact: false }).fill("Fixture Buyer");
  await preview
    .getByLabel("Work email", { exact: false })
    .fill("fixture-buyer@example.invalid");
  await preview
    .getByLabel("Company", { exact: true })
    .fill("Synthetic Buyer Company");
  await preview.getByLabel("Country", { exact: true }).fill("Germany");
  await preview
    .getByLabel("Phone / WhatsApp", { exact: true })
    .fill("+000000000");
  await preview
    .getByRole("checkbox", { name: "Sample pumps", exact: true })
    .check();
  await preview
    .getByRole("checkbox", { name: "Sample equipment", exact: true })
    .check();
  await preview.getByLabel("Quantity", { exact: true }).fill("12");
  await preview
    .getByLabel("Your requirements", { exact: false })
    .fill("Please discuss the product options for our purchasing project.");
  await preview.getByLabel("Attachments", { exact: true }).setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nSynthetic fixture only\n%%EOF"),
  });
  await preview
    .getByRole("checkbox", { name: /I have read the Privacy Policy/ })
    .check();
  await preview
    .getByRole("button", { name: "Send inquiry", exact: true })
    .click();
  await expect(preview.locator("[data-form-status]")).toContainText(
    "Your inquiry has been saved",
    { timeout: 20000 },
  );
  await preview
    .getByRole("link", { name: "Privacy Policy", exact: true })
    .first()
    .click();
  await expect(
    preview.getByRole("heading", { name: "Privacy Policy", exact: true }),
  ).toBeVisible();
  expect(
    await preview.locator('meta[name="robots"]').getAttribute("content"),
  ).toContain("noindex");
  await preview.close();
  await test.step("Site filtering preserves the deep link and recovers after a failed second page", async () => {
    const pickerRoute = /\/api\/v1\/sites\?/;
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: (100 - index).toString(16).padStart(24, "0"),
      name: "Fixture site " + (index + 1),
    }));
    const cursor = firstPage[99].id;
    let nextPageRequests = 0;
    await page.route(pickerRoute, async (route) => {
      const params = new URL(route.request().url()).searchParams;
      expect(params.get("limit")).toBe("100");
      if (!params.has("cursor")) {
        const realResponse = await route.fetch();
        expect(realResponse.status()).toBe(200);
        return route.fulfill({
          json: {
            success: true,
            data: { items: firstPage, nextCursor: cursor, hasMore: true },
          },
        });
      }
      expect(params.get("cursor")).toBe(cursor);
      if (++nextPageRequests === 1)
        return route.fulfill({
          status: 503,
          json: { error: { code: "UNAVAILABLE" } },
        });
      return route.fulfill({
        json: {
          success: true,
          data: { items: [site], nextCursor: null, hasMore: false },
        },
      });
    });
    await page.goto("/inquiries?siteId=" + site.id);
    const picker = page.getByRole("combobox", { name: "站点", exact: true });
    await expect(picker).toHaveValue(site.id);
    const more = page.getByRole("button", { name: "加载更多站点" });
    await expect(more).toBeVisible();
    expect(nextPageRequests).toBe(0);
    await more.click();
    await expect(page.getByText("未能加载这批站点。")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Fixture Buyer", exact: true }),
    ).toBeVisible();
    await expect(picker.locator("option")).toHaveCount(102);
    await page.getByRole("button", { name: "重新加载站点" }).click();
    await expect(picker.locator("option:checked")).toHaveText(site.name);
    await expect(picker.locator("option")).toHaveCount(102);
    await expect(more).toBeHidden();
    expect(nextPageRequests).toBe(2);
    await picker.selectOption(firstPage[99].id);
    await page.getByRole("button", { name: "应用筛选" }).click();
    await expect(page.getByText("暂无符合条件的询盘。")).toBeVisible();
    await picker.selectOption(site.id);
    await page.getByRole("button", { name: "应用筛选" }).click();
    await expect(
      page.getByRole("link", { name: "Fixture Buyer", exact: true }),
    ).toBeVisible();
    await page.unroute(pickerRoute);
  });
  await page.getByRole("link", { name: "Fixture Buyer", exact: true }).click();
  await expect(
    page.getByText(
      "Please discuss the product options for our purchasing project.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sample pumps", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "synthetic.pdf", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("fixture-s6", { exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        const id = new URL(page.url()).pathname.split("/").pop();
        const r = await page.request.get("/api/v1/inquiries/" + id);
        return (await r.json()).data.classification;
      },
      { timeout: 20000 },
    )
    .not.toBe("pending");
  await page.reload();
  await page.getByLabel("状态", { exact: true }).selectOption("following");
  await expect(page.getByLabel("状态", { exact: true })).toHaveValue(
    "following",
  );
  await page
    .getByLabel("添加备注", { exact: true })
    .fill("Synthetic follow-up note");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(
    page.getByText("Synthetic follow-up note", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/s6-inquiry-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".mobile-menu")).toBeVisible();
  await expect(page.getByLabel("状态", { exact: true })).toBeVisible();
  await page.goto("/inquiries?siteId=" + site.id);
  await page.getByRole("button", { name: "跟进中", exact: true }).click();
  const buyer = page.getByRole("link", { name: "Fixture Buyer", exact: true });
  const record = page.locator("tr").filter({ has: buyer });
  await expect(record.getByText("跟进中", { exact: true })).toBeVisible();
  await expect(record).toHaveCSS("display", "grid");
  await buyer.click();
  await expect(page.getByLabel("状态", { exact: true })).toHaveValue(
    "following",
  );
  await expect(
    page.getByText("Synthetic follow-up note", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/s6-inquiry-mobile.png",
    fullPage: false,
  });
  const csv = await page.request.get(
    "/api/v1/inquiries/export?siteId=" + site.id,
  );
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("fixture-buyer@example.invalid");
  expect(errors).toEqual([]);
});
