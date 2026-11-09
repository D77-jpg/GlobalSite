import { test, expect } from "@playwright/test";
import { login } from "./helpers/site-login";

test("task center prioritizes outcomes, recovery, history and responsive diagnostics", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, request);
  const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080";
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "gs_csrf",
  )!.value;
  const created = await page.request.post("/api/v1/sites", {
    headers: { Origin: origin, "X-CSRF-Token": csrf },
    data: {
      name: "Atlas Supply",
      templateId: "adaptive",
      businessBrief: "Wholesale travel products for importers.",
      targetMarkets: ["UK"],
      language: "en",
      brandColor: "#126a54",
      logoId: null,
      productIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const siteId = (await created.json()).data.id;
  const titles = [
    "Wholesale travel essentials",
    "Travel collection",
    "Canvas weekender",
    "Commuter backpack",
    "Packing accessories",
    "Request a quote",
  ];
  const recorded = {
    createdAt: "2026-11-09T01:00:00Z",
    updatedAt: "2026-11-09T01:10:00Z",
    siteId,
    tokens: 117774,
    elapsedMs: 390600,
    inputSummary: { products: 3, confirmedFacts: 8, pages: 6 },
  };
  let paused = {
    ...recorded,
    id: "a".repeat(24),
    step: "design",
    status: "paused",
    active: true,
    errorCode: "AI_UNCONFIGURED",
    steps: [{ key: "design", status: "paused", attempts: 1, tokens: 0 }],
  };
  const review = {
    ...recorded,
    id: "b".repeat(24),
    step: "review",
    status: "succeeded",
    active: false,
    steps: titles.map((pageTitle, i) => ({
      key: "page-" + i,
      status: "succeeded",
      attempts: i === 0 ? 2 : 1,
      tokens: 19629,
      inputSummary: { pageTitle },
      output: {
        reviewMode: "browser",
        findings: i === 0 ? [{ message: "Check mobile image crop" }] : [],
        metrics: [{ width: 390, overflow: false, brokenImages: 0 }],
      },
    })),
  };
  let content = {
    ...recorded,
    id: "c".repeat(24),
    step: "content",
    status: "running",
    active: true,
    steps: titles.map((pageTitle, i) => ({
      key: "page-" + i,
      status: i < 3 ? "succeeded" : "queued",
      attempts: i < 3 ? 1 : 0,
      inputSummary: { pageTitle },
      output: i < 3 ? { pageId: (i + 1).toString().repeat(24) } : undefined,
    })),
  };
  const old = {
    ...recorded,
    id: "d".repeat(24),
    step: "research",
    status: "cancelled",
    active: false,
    steps: [],
  };
  let historyRequests = 0,
    retryCalls = 0;
  // Recorded UI states only. Real retry/cancel and Worker persistence are covered by sites/server tests.
  await page.route("**/api/v1/sites/" + siteId + "/agent-runs*", (route) => {
    const older = new URL(route.request().url()).searchParams.has("cursor");
    if (older) historyRequests++;
    return route.fulfill({
      json: {
        success: true,
        data: {
          items: older ? [old] : [review, paused, content],
          hasMore: !older,
          nextCursor: older ? null : review.id,
        },
      },
    });
  });
  await page.route("**/api/v1/agent-runs/" + paused.id + "/retry", (route) => {
    expect(route.request().method()).toBe("POST");
    if (++retryCalls === 1)
      return route.fulfill({
        status: 503,
        json: { success: false, error: { code: "INTERNAL_ERROR" } },
      });
    paused = { ...paused, status: "queued", errorCode: "" };
    return route.fulfill({ json: { success: true, data: paused } });
  });
  await page.route(
    "**/api/v1/agent-runs/" + content.id + "/cancel",
    (route) => {
      expect(route.request().method()).toBe("POST");
      content = { ...content, status: "cancelled", active: false };
      return route.fulfill({ json: { success: true, data: content } });
    },
  );
  await page.goto("/agent");
  const detail = page.locator(".task-detail");
  await expect(
    detail.getByRole("heading", { name: "生成首页设计方案", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByText("请先由管理员配置 AI 服务商，再恢复任务", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("link", { name: "配置 AI 服务", exact: true }),
  ).toHaveAttribute("href", "/ai");
  await expect(detail.getByText("117,774", { exact: true })).not.toBeVisible();
  await detail
    .getByRole("button", { name: "重试 / 恢复", exact: true })
    .click();
  await expect(detail.getByRole("alert")).toHaveText("操作未完成，请重试。");
  await detail
    .getByRole("button", { name: "重试 / 恢复", exact: true })
    .click();
  await expect(
    detail.locator("header").getByText("排队中", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".task-index-item")
    .filter({ hasText: "检查网站质量" })
    .click();
  await expect(
    detail.getByRole("link", { name: "查看审查报告", exact: true }).first(),
  ).toHaveAttribute("href", "/sites/" + siteId + "?tab=quality");
  await expect(detail.locator(".task-findings")).toContainText("1");
  await expect(detail.locator(".task-items li")).toHaveCount(6);
  await page.screenshot({
    path: "test-results/s19-tasks-desktop.png",
    fullPage: true,
  });
  await detail.getByText("执行详情与用量", { exact: true }).click();
  await expect(detail.getByText("117,774", { exact: true })).toBeVisible();
  await detail
    .locator(".task-diagnostics > details")
    .first()
    .locator("summary")
    .click();
  await expect(
    detail.getByText("390px", { exact: false }).first(),
  ).toBeVisible();
  await page
    .locator(".task-index-item")
    .filter({ hasText: "生成网站内容" })
    .click();
  await expect(detail.getByText("117,774", { exact: true })).not.toBeVisible();
  await expect(detail.locator("progress")).toHaveAttribute("value", "3");
  await expect(detail.locator("progress")).toHaveAttribute("max", "6");
  await detail.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(
    detail.locator("header").getByText("已取消", { exact: true }),
  ).toBeVisible();
  await expect(detail.getByText("未继续处理", { exact: true })).toHaveCount(3);
  await page
    .locator(".task-toolbar")
    .getByRole("button", { name: /需处理/ })
    .click();
  await expect(
    page.getByText("当前页没有这类任务", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".task-toolbar")
    .getByRole("button", { name: /全部/ })
    .click();
  await page
    .locator(".task-pagination")
    .getByRole("button", { name: "下一页", exact: true })
    .click();
  await expect(
    detail.getByRole("heading", { name: "规划网站结构", exact: true }),
  ).toBeVisible();
  expect(historyRequests).toBeGreaterThan(0);
  await page
    .locator(".task-pagination")
    .getByRole("button", { name: "上一页", exact: true })
    .click();
  await page
    .locator(".task-index-item")
    .filter({ hasText: "检查网站质量" })
    .click();
  for (const width of [768, 390, 375]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      detail.getByRole("heading", { name: "检查网站质量", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/s19-tasks-" + width + ".png",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/sites/" + siteId + "?tab=runs");
  await expect(page.locator(".task-center")).toBeVisible();
  await expect(page.locator(".studio-metrics")).toHaveCount(0);
  await page
    .getByRole("button", { name: "切换语言", exact: true })
    .first()
    .click();
  await expect(
    page
      .locator(".task-center")
      .getByRole("heading", { name: "Task center", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".task-detail").getByRole("heading", {
      name: "Generate homepage proposals",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
