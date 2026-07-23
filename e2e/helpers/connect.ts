/**
 * Connect the injected mock wallet through Privy and complete the automatic SIWE handshake.
 *
 * Flow: /sign-in → "Connect a wallet" → Privy modal → pick our EIP-6963 wallet ("E2E Mock Wallet") →
 * Privy connects → SIWE runs on its own (personal_sign, auto-signed by the shim) → redirect off
 * /sign-in. The whole attempt is retried: Privy's EIP-6963 detection can lose the first race and fall
 * back to a QR/deep-link screen instead of the injected connector; a retry (fresh modal) settles it.
 */
import { expect, type Page } from "@playwright/test";

export async function connectAndSignIn(page: Page, opts: { locale?: string } = {}): Promise<void> {
  const locale = opts.locale ?? "en";
  await page.goto(`/${locale}/sign-in`);

  // Dismiss the cookie-consent dialog if present — it overlays the auth actions.
  const accept = page.getByRole("button", { name: /^Accept$/ });
  if (await accept.isVisible().catch(() => false)) await accept.click().catch(() => {});

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByRole("button", { name: "Connect a wallet" }).click();

    // Privy's `#privy-dialog` wrapper stays visibility-hidden while its content is shown, so waiting on
    // the dialog's OWN visibility never resolves. Wait for the wallet BUTTON (which is visible) instead.
    const dialog = page.getByRole("dialog", { name: /log in or sign up/i });
    const mockWallet = dialog.getByRole("button", { name: /e2e mock wallet/i }).first();
    await mockWallet.waitFor({ state: "visible", timeout: 30_000 });
    await mockWallet.click({ timeout: 30_000 });

    // Success = we leave /sign-in (Privy connected + SIWE auto-signed). If the connect raced into the
    // QR/deep-link path it won't redirect — close the modal and retry.
    const signedIn = await page
      .waitForURL((url) => !url.pathname.includes("/sign-in"), { timeout: 40_000 })
      .then(() => true)
      .catch(() => false);
    if (signedIn) {
      await expect(page).not.toHaveURL(/sign-in/);
      return;
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(1_000);
  }
  throw new Error("connectAndSignIn: Privy wallet login did not complete after 3 attempts");
}
