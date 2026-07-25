/**
 * @id PP-E2E-HELPER-002 (POO-1081)
 * @name Privy embedded (email) login
 * @implements-rules-version v1
 *
 * Log in with a Privy TEST ACCOUNT so the browser holds a REAL EMBEDDED wallet.
 *
 * Why this exists: `connectAndSignIn` injects a viem wallet over EIP-6963, which Privy treats as an
 * EXTERNAL wallet. Every wallet-facing defect that has reached a user in this repo (POO-1001,
 * POO-1003, POO-1077, POO-1078, POO-1079, POO-1081) is a case where an embedded wallet behaves
 * differently from an injected one, and the injected harness cannot see any of them. This closes
 * that hole.
 *
 * Test accounts are enabled in the Privy Dashboard under
 * User management > Authentication > Advanced, which hands out a fixed `test-XXXX@privy.io` address
 * and a fixed OTP. Both must be passed exactly; Privy rejects plus-addressing and arbitrary values.
 *
 *   E2E_PRIVY_TEST_EMAIL=test-1000@privy.io E2E_PRIVY_TEST_OTP=899882 \
 *     pnpm exec playwright test --grep @embedded
 */
import { expect, type Page } from "@playwright/test";

export interface EmbeddedLoginCredentials {
  email: string;
  otp: string;
}

/** Read the test-account credentials from the environment, failing loudly when absent. */
export function embeddedCredentials(): EmbeddedLoginCredentials {
  const email = process.env.E2E_PRIVY_TEST_EMAIL;
  const otp = process.env.E2E_PRIVY_TEST_OTP;
  if (!email || !otp) {
    throw new Error(
      "embeddedCredentials: set E2E_PRIVY_TEST_EMAIL and E2E_PRIVY_TEST_OTP (Privy Dashboard > " +
        "User management > Authentication > Advanced > Enable test accounts)",
    );
  }
  return { email, otp };
}

/**
 * Drive Privy's email flow to completion, leaving the page authenticated with an embedded wallet.
 *
 * Waits on the BUTTON's visibility rather than `#privy-dialog`'s: the wrapper stays
 * visibility-hidden while its content is on screen, which is the trap `connect.ts` documents.
 */
export async function loginWithEmbeddedWallet(
  page: Page,
  credentials: EmbeddedLoginCredentials = embeddedCredentials(),
  opts: { locale?: string } = {},
): Promise<void> {
  const locale = opts.locale ?? "en";
  await page.goto(`/${locale}`);

  // The app's own entry point; Privy's modal is what it opens.
  const connect = page.getByRole("button", { name: /connect|sign in|log in/i }).first();
  await connect.waitFor({ state: "visible", timeout: 30_000 });
  await connect.click();

  const emailField = page.getByPlaceholder(/email/i).first();
  await emailField.waitFor({ state: "visible", timeout: 30_000 });
  await emailField.fill(credentials.email);
  await page.keyboard.press("Enter");

  // Privy renders the OTP as separate single-character inputs; typing fills them in order.
  const firstOtpCell = page
    .locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]')
    .first();
  await firstOtpCell.waitFor({ state: "visible", timeout: 30_000 });
  await firstOtpCell.click();
  await page.keyboard.type(credentials.otp, { delay: 60 });

  // Authenticated when the connect affordance is gone; the app then runs SIWE on its own.
  await expect(connect).toBeHidden({ timeout: 60_000 });
}
