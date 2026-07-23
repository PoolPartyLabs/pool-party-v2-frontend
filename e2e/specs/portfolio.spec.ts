/**
 * De-risk spec: prove the whole read path end-to-end with the headless wallet —
 * connect through Privy → automatic SIWE → the wallet-scoped portfolio loader resolves.
 * Runs with an ephemeral key (no funds needed): SIWE and portfolio reads cost nothing.
 */
import { expect, test } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";

test.describe("portfolio (read)", { tag: "@read" }, () => {
  test("connect → SIWE → portfolio loads for the wallet", async ({ page, wallet }) => {
    await connectAndSignIn(page);

    await page.goto("/en/portfolio");

    // Staying on /portfolio (not bounced to /sign-in) proves Privy auth succeeded (AuthGuard).
    await expect(page).toHaveURL(/\/en\/portfolio/);
    await expect(page).not.toHaveURL(/sign-in/);

    // Signed-in app chrome confirms we're past the pre-auth screens.
    await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible({
      timeout: 30_000,
    });

    // SIWE gates the positions loader — it resolves to positions OR the empty state only once
    // signed in. For a fresh wallet that's the empty state; either way the loader settling proves SIWE.
    await expect
      .poll(
        async () => {
          const main = page.locator("main");
          const text = (await main.innerText().catch(() => "")) ?? "";
          // settled = some portfolio content rendered and we're not stuck on a signing/loading state
          return text.length > 0 && !/signing you in|connecting your wallet/i.test(text);
        },
        { timeout: 45_000, message: "portfolio never settled (SIWE / positions loader)" },
      )
      .toBe(true);

    // eslint-disable-next-line no-console
    console.log(`[e2e] signed in as ${wallet.address} on ${process.env.E2E_CHAIN ?? "arbitrum"}`);
  });
});
