import { test, expect } from "@playwright/test";
import { login } from "./helpers/site-login";
import { randomUUID } from "node:crypto";
test("S5 build, private preview, zip export, settings and mobile publishing", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
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
  let s = await call("POST", "/sites", {
    name: "Atlas Works",
    templateId: "machinery",
    targetMarkets: ["UK"],
    language: "en",
    brandColor: "#16634a",
    logoId: null,
    productIds: [],
  });
  const node = {
    key: "home",
    path: "/",
    title: "Industrial sourcing",
    type: "home",
    parentKey: null,
    productId: null,
    keywords: [],
    intent: "source",
  };
  s = await call("PUT", "/sites/" + s.id + "/plan", {
    revision: s.planRevision,
    nodes: [node],
    keywords: [],
    clusters: [],
  });
  s = await call("POST", "/sites/" + s.id + "/plan/confirm", {
    revision: s.planRevision,
  });
  let p = await call("POST", "/sites/" + s.id + "/pages", { nodeKey: "home" });
  const text =
    "Our team helps buyers explore product options and prepare a clear purchasing brief. Share your application, preferred materials, packaging requirements and intended market with our team. We will discuss the details with you before preparing a proposal. Browse the information below to learn about our approach and find the right contact for your project. Product details are reviewed by our team before publication.";
  p = await call("PATCH", "/pages/" + p.id, {
    revision: p.revision,
    data: {
      title: "Industrial sourcing",
      metaDescription:
        "Explore our product information and discuss your purchasing requirements with our team.",
      refs: [],
      blocks: [
        {
          key: "overview",
          type: "text",
          heading: "Purchasing support",
          body: text,
          table: null,
          faq: [],
          assetId: null,
          alt: "",
          refs: [],
        },
      ],
    },
  });
  await call("POST", "/pages/" + p.id + "/approve", { revision: p.revision });
  await page.goto("/sites/" + s.id);
  await page.getByRole("link", { name: "构建与发布", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "构建与发布", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("正式网址（HTTPS）", { exact: true })
    .fill("https://atlas.example.invalid");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("体检通过", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "构建新版本", exact: true }).click();
  for (let attempt = 0; attempt < 55; attempt++) {
    const v = (await call("GET", "/sites/" + s.id + "/versions"))[0];
    if (v?.status === "failed")
      throw Error("Static build failed: " + v.errorCode);
    if (v?.status === "ready") break;
    await page.waitForTimeout(2000);
  }
  await expect(
    page.getByRole("link", { name: "登录预览", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const preview = page.getByRole("link", { name: "登录预览", exact: true });
  const [tab] = await Promise.all([
    page.waitForEvent("popup"),
    preview.click(),
  ]);
  await tab.waitForLoadState("networkidle");
  await expect(
    tab.getByRole("heading", { name: "Industrial sourcing", exact: true }),
  ).toBeVisible();
  expect(await tab.locator('meta[name="robots"]').getAttribute("content")).toBe(
    "noindex,nofollow",
  );
  const response = await page.request.get(
    (await preview.getAttribute("href"))!,
  );
  expect(response.headers()["x-robots-tag"]).toContain("noindex");
  expect(await tab.locator("form button").isDisabled()).toBeTruthy();
  await tab.screenshot({
    path: "test-results/s5-private-preview.png",
    fullPage: true,
  });
  await tab.close();
  const exportUrl = (await page
      .getByRole("link", { name: "导出 zip", exact: true })
      .getAttribute("href"))!,
    zip = await page.request.get(exportUrl);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toContain("application/zip");
  expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
  await page.screenshot({
    path: "test-results/s5-publishing-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/s5-publishing-mobile.png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
});
