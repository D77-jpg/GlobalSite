import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { login } from "./helpers/site-login";
test("S8-S11 buyer brief, B2B catalogue, cross-page shortlist and real worker screenshots", async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  await login(page, request);
  const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080";
  const csrf = (await page.context().cookies()).find(
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
    expect(
      r.ok(),
      path + " " + r.status() + " " + (await r.text()),
    ).toBeTruthy();
    return (await r.json()).data;
  }
  const products = [];
  for (const name of ["Rest collection", "Play collection"])
    products.push(await call("POST", "/products", { name, status: "draft" }));
  let site = await call("POST", "/sites", {
    name: "Fixture Supply",
    templateId: "packaging-bags",
    targetMarkets: ["UK"],
    language: "en",
    brandColor: "#315c4b",
    logoId: null,
    productIds: products.map((p) => p.id),
  });
  await page.goto("/sites/" + site.id);
  await page.getByRole("button", { name: "采购定位", exact: true }).click();
  await page
    .getByLabel("目标采购商（每行一项，最多五项）")
    .fill("Retail buyers");
  await page.getByLabel("目标采购商（每行一项，最多五项）").press("Enter");
  await page
    .getByLabel("目标采购商（每行一项，最多五项）")
    .pressSequentially("Pet brands");
  await page
    .getByLabel("采购商需要解决的问题（每行一项）")
    .fill("Compare the collection");
  const savedProfile = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/sites/" + site.id) &&
      r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "保存采购定位", exact: true }).click();
  expect((await savedProfile).status()).toBe(200);
  await expect(
    page.getByText("仍有必需采购资料待确认", { exact: true }),
  ).toBeVisible();
  site = await call("GET", "/sites/" + site.id);
  expect(site.buyerProfile.audiences).toEqual(["Retail buyers", "Pet brands"]);
  const nodes = [
    {
      key: "home",
      path: "/",
      title: "Wholesale collection",
      type: "home",
      parentKey: null,
      productId: null,
      keywords: [],
      intent: "source",
    },
    {
      key: "range",
      path: "/range",
      title: "Collection",
      type: "category",
      parentKey: "home",
      productId: null,
      keywords: [],
      intent: "compare",
    },
    ...products.map((p, i) => ({
      key: "product-" + String.fromCharCode(97 + i),
      path: "/range/" + String.fromCharCode(97 + i),
      title: p.name,
      type: "product",
      parentKey: "range",
      productId: p.id,
      keywords: [],
      intent: "buy",
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
    "Explore the collection and prepare a purchasing brief for your intended market. Choose the product category that fits your store or brand, review the available information and tell our team what you need. Your product interest, preferred options and destination help us understand the request. Product terms need written confirmation before ordering. Use the inquiry list to keep your selected products together while browsing.";
  const block = (key: string, type = "text", body = text) => ({
    key,
    type,
    heading: "Prepare your buying brief",
    body,
    table: null,
    faq: [],
    assetId: null,
    alt: "",
    refs: [],
  });
  for (const node of nodes) {
    let p = await call("POST", "/sites/" + site.id + "/pages", {
      nodeKey: node.key,
    });
    const blocks: any[] = [block("overview")];
    if (node.type === "home" || node.type === "category")
      blocks.push(
        block(
          "range",
          "product-grid",
          "Browse products for your next purchasing brief.",
        ),
        {
          ...block(
            "resources",
            "downloads",
            "Save product information for your buying brief.",
          ),
          items: [],
        },
      );
    if (node.type === "product")
      for (const k of [
        "specs",
        "material",
        "application",
        "certifications",
        "oem",
        "moq",
        "samples",
        "packaging",
      ])
        blocks.push({
          ...block(
            k,
            k === "specs" ? "specs" : "text",
            "Contact our team for confirmed details.",
          ),
          table:
            k === "specs"
              ? { columns: ["Specification", "Confirmed details"], rows: [] }
              : null,
        });
    p = await call("PATCH", "/pages/" + p.id, {
      revision: p.revision,
      data: {
        title: node.title,
        metaDescription:
          "Explore the collection and prepare a useful product inquiry.",
        refs: [],
        presentation: {
          navigationLabel: node.title,
          headline: node.title,
          summary: "Explore products for your buying brief.",
          primaryActionLabel: "Request a quote",
          primaryActionTarget: "inquiry",
          visualStyle: "organic",
          heroLayout: "stacked",
          designNotes: "Fixture design rationale",
        },
        blocks,
      },
    });
    await call("POST", "/pages/" + p.id + "/approve", { revision: p.revision });
  }
  await call("PUT", "/sites/" + site.id + "/publishing-settings", {
    revision: 0,
    canonicalBaseUrl: "https://fixture.example.invalid",
    accountId: null,
    projectName: null,
    productionBranch: "main",
    domain: null,
  });
  const version = await call("POST", "/sites/" + site.id + "/builds", {});
  await expect
    .poll(
      async () => {
        const v = await call("GET", "/sites/" + site.id + "/versions");
        return v.find((x: any) => x.id === version.id)?.status;
      },
      { timeout: 90000 },
    )
    .toBe("ready");
  const preview = "/api/v1/site-versions/" + version.id + "/preview/";
  await page.goto(preview);
  await expect(page.locator(".gs-cookie")).toBeVisible();
  const cookieBox = await page.locator(".gs-cookie").boundingBox();
  const quoteBox = await page.locator(".quote-bar").boundingBox();
  expect(cookieBox!.y + cookieBox!.height).toBeLessThanOrEqual(quoteBox!.y);
  await page
    .getByRole("button", { name: "Reject optional", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add to inquiry", exact: true })
    .first()
    .click();
  await expect(page.locator("[data-quote-count]")).toHaveText("1");
  await page
    .getByRole("link", { name: "Play collection", exact: true })
    .click();
  await expect(page.locator("[data-quote-count]")).toHaveText("1");
  await page
    .getByRole("button", { name: "Add to inquiry", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review inquiry", exact: true })
    .click();
  await expect(page.locator("[data-quote-count]")).toHaveText("2");
  await expect(page.locator("[data-quote-list]")).toContainText(
    "Rest collection",
  );
  await expect(page.locator("[data-quote-list]")).toContainText(
    "Play collection",
  );
  const catalogue = await page.request.get(preview + "catalogue.html");
  expect(catalogue.status()).toBe(200);
  expect(await catalogue.text()).toContain("Play collection");
  await page.goto(preview);
  await page.getByLabel("Find a product").fill("Rest");
  await expect(page.locator("[data-product-card]:visible")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/s8-buyer-preview-mobile.png",
    fullPage: true,
  });
  await page.goto("/sites/" + site.id);
  await page.getByRole("button", { name: "质量审查", exact: true }).click();
  await page
    .getByLabel(
      "我同意将本站选用资料发送给组织配置的 AI 服务商，并计入 AI 额度。",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "生成截图并审查全站", exact: true })
    .click();
  await expect(page.getByRole("img", { name: /页面审查截图/ })).toHaveCount(
    12,
    { timeout: 120000 },
  );
  await expect(
    page
      .getByText("未配置 AI：本报告仅包含浏览器检查，请人工审查内容和截图。", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "确认已检查截图与采购内容", exact: true })
    .click();
  await expect(
    page.getByText("当前审查已由管理员确认", { exact: true }),
  ).toBeVisible();
  const gap = await call("GET", "/sites/" + site.id + "/buyer-readiness");
  expect(gap.canPublish).toBe(false);
  await page
    .getByRole("button", { name: "按最近审查改进全站", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "按审查改进 · 已暂停" }),
  ).toBeVisible({ timeout: 20000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/s10-worker-review-desktop.png",
    fullPage: false,
  });
});
