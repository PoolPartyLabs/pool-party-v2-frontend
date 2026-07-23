/**
 * Playwright test extended with a `wallet` fixture: installs the headless viem wallet on the page
 * before the test navigates, so Privy discovers it via EIP-6963. One wallet per test worker.
 */
import { test as base, expect } from "@playwright/test";
import { chainKey, privateKey } from "./config";
import { installMockWallet, type MockWallet } from "./wallet/mockWallet";

export const test = base.extend<{ wallet: MockWallet }>({
  wallet: async ({ page }, use) => {
    if (process.env.E2E_DEBUG) {
      // biome-ignore lint/suspicious/noConsole: harness diagnostics
      page.on("console", (m) => console.error(`[browser:${m.type()}] ${m.text()}`));
      // biome-ignore lint/suspicious/noConsole: harness diagnostics
      page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
    }
    const wallet = await installMockWallet(page, {
      privateKey: privateKey(),
      chainKey: chainKey(),
    });
    await use(wallet);
  },
});

export { expect };
