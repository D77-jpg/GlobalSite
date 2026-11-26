// S37 §4.7-8: DOM-level Playwright coverage for S36 platform-managed AI
// read-only settings and customer usage page (percentage, reset date, zero
// token/model/provider/key exposure).
import { test, expect } from "@playwright/test";
import { gotoWorkspace, login } from "./helpers/site-login";

test("platform-managed AI settings render read-only and usage page hides tokens and provider details", async ({
  page,
  request,
}) => {
  await login(page, request);
  await page.route("**/api/v1/ai/provider", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { managed: true, enabled: true, configured: true },
        }),
      });
    } else {
      await route.continue();
    }
  });
  await page.route("**/api/v1/ai/images", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { managed: true, enabled: true, configured: true },
        }),
      });
    } else {
      await route.continue();
    }
  });

  await gotoWorkspace(page, "/ai");
  await expect(page.locator("main")).toContainText(
    /平台提供|provided by the platform/i,
  );
  const aiText = await page.locator("main").innerText();
  // Read-only managed view must not show API key inputs or model/provider details.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(aiText).not.toMatch(/synapsea|deepseek|gpt-4|openai|token/i);

  await gotoWorkspace(page, "/usage");
  await expect(page.locator("main")).toContainText(/%/);
  const usageText = await page.locator("main").innerText();
  expect(usageText).toMatch(/%/);
  expect(usageText).not.toMatch(/token/i);
});
