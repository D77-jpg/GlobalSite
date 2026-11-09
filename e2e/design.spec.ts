import { test, expect } from "@playwright/test";
import { login } from "./helpers/site-login";

test("design proposal interface compares, retries previews, expands and selects simulated Worker results", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await login(page, request);
  const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080",
    csrf = (await page.context().cookies()).find(
      (c) => c.name === "gs_csrf",
    )!.value;
  const headers = { Origin: origin, "X-CSRF-Token": csrf };
  const create = await page.request.post("/api/v1/sites", {
    headers,
    data: {
      name: "Atlas Design",
      templateId: "adaptive",
      businessBrief: "Travel collections for wholesale buyers.",
      targetMarkets: ["UK"],
      language: "en",
      brandColor: "#126a54",
      logoId: null,
      productIds: [],
    },
  });
  expect(create.status()).toBe(201);
  const site = (await create.json()).data;
  const plan = await page.request.put("/api/v1/sites/" + site.id + "/plan", {
    headers,
    data: {
      revision: site.planRevision,
      nodes: [
        {
          key: "home",
          path: "/",
          title: "Home",
          type: "home",
          parentKey: null,
          productId: null,
          keywords: [],
          intent: "source",
        },
      ],
      keywords: [],
      clusters: [],
    },
  });
  expect(plan.status()).toBe(200);
  const confirmed = await page.request.post(
    "/api/v1/sites/" + site.id + "/plan/confirm",
    { headers, data: { revision: (await plan.json()).data.planRevision } },
  );
  expect(confirmed.status()).toBe(200);
  let current = (await confirmed.json()).data;
  const runId = "b".repeat(24),
    base = "/api/v1/sites/" + site.id;
  const directions = [
    {
      key: "primary",
      label: "Product-led showcase",
      rationale: "Prioritize product discovery.",
    },
    {
      key: "alternate",
      label: "Editorial collection",
      rationale: "Use a centered editorial composition.",
    },
  ];
  const result = {
    id: runId,
    siteId: site.id,
    step: "design",
    status: "succeeded",
    active: false,
    steps: [{ key: "design", output: { directions } }],
  };
  let hasRun = false,
    previewRequests = 0;
  // UI resilience fixture. Worker persistence, authority and transactions are covered by real HTTP server tests.
  await page.route("**" + base + "", (route) =>
    route.fulfill({ json: { success: true, data: current } }),
  );
  await page.route("**" + base + "/agent-runs", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      expect(input).toMatchObject({
        step: "design",
        consent: true,
        instructions: "Larger product images",
      });
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      hasRun = true;
      return route.fulfill({
        status: 202,
        json: { success: true, data: result },
      });
    }
    return route.fulfill({
      json: {
        success: true,
        data: {
          items: hasRun ? [result] : [],
          hasMore: false,
          nextCursor: null,
        },
      },
    });
  });
  await page.route(
    "**" + base + "/design-proposals/*/*/preview",
    async (route) => {
      const key = new URL(route.request().url()).pathname.split("/").at(-2)!;
      if (key === "alternate" && ++previewRequests === 1)
        return route.fulfill({
          status: 503,
          json: { error: { code: "UNAVAILABLE" } },
        });
      return route.fulfill({
        json: {
          success: true,
          data: {
            html:
              '<!doctype html><html lang="en"><head><meta name="robots" content="noindex"></head><body><h1>' +
              key +
              " collection</h1><p>Isolated UI preview fixture</p></body></html>",
            hash: "fixture",
            issues: [],
          },
        },
      });
    },
  );
  await page.route("**" + base + "/design-direction", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      revision: current.revision,
      runId,
      key: "primary",
    });
    current = {
      ...current,
      revision: current.revision + 1,
      designDirection: {
        runId,
        key: "primary",
        visualStyle: "organic",
        heroLayout: "split",
        density: "comfortable",
        rationale: directions[0].rationale,
      },
    };
    return route.fulfill({ json: { success: true, data: current } });
  });
  await page.goto("/sites/" + site.id + "?tab=design");
  const generate = page.getByRole("button", {
    name: "生成两种首页方案",
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await page
    .getByLabel("想调整哪些地方？", { exact: true })
    .fill("Larger product images");
  await page.locator(".design-consent input").check();
  await generate.click();
  await expect(page.locator(".proposal")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "重试预览", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试预览", exact: true }).click();
  await expect(page.locator(".proposal iframe")).toHaveCount(2);
  await page
    .getByRole("button", { name: "放大预览", exact: true })
    .first()
    .click();
  await expect(page.locator(".proposal.expanded")).toHaveCount(1);
  await page.getByRole("button", { name: "收起预览", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("button", { name: "采用这个方向", exact: true })
    .first()
    .click();
  await expect(page.getByText("已选定设计方向", { exact: true })).toBeVisible();
  await expect(page.locator(".proposal")).toHaveCount(0);
  await page.getByRole("button", { name: "切换语言", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Choose your website's design direction",
      exact: true,
    }),
  ).toBeVisible();
});
