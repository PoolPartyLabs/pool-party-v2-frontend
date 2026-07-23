import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Pool Party v2 frontend against a LOCAL real-mode stack.
 *
 * Runs on port 3000 by default — the Privy dev app's origin allowlist only includes localhost:3000,
 * so login fails on any other port unless that origin is added in the Privy dashboard. This is also
 * the port the run-local-env frontend uses, so the harness drives the same local app (reuses it if
 * it's already up). Serial + single worker because on-chain write specs share one wallet and are
 * stateful. The dev server reads the worktree's `.env.local` (NEXT_PUBLIC_MOCK_MODE=false); the
 * backend (pp_api :5001, analytics :3069) must already be up (see the run-local-env skill).
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000, // connect retries can take a while; write specs raise this further via test.slow()
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    headless: process.env.HEADED !== "1",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
