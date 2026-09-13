/** Cash+ uses the local fork directly and needs no backend services. */
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/cash-plus",
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "../../outputs/cash-plus-evidence/e2e-results.json" }],
  ],
  use: {
    baseURL: process.env.CASH_PLUS_UI_URL ?? "http://localhost:3049",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  outputDir: "../../outputs/cash-plus-evidence/playwright",
});
