import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5080",
    browserName: "chromium",
    headless: true,
    trace: "off",
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
});
