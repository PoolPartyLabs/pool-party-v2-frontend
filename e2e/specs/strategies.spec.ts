/** Read spec: the strategy catalog renders for a signed-in wallet (no funds needed). */
import { expect, test } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";

test.describe("strategies catalog (read)", { tag: "@read" }, () => {
  // `wallet` is destructured so Playwright sets up the LAZY wallet fixture (e2e/fixtures.ts):
  // it installs the EIP-6963 mock wallet on the page BEFORE navigation, so Privy can discover it
  // and connectAndSignIn's `waitFor(mockWallet)` resolves. Without it the wallet never installs and
  // the connect times out (the portfolio spec works because it destructures `wallet` too).
  test("catalog renders for a signed-in wallet", async ({ page, wallet }) => {
    await connectAndSignIn(page);
    await page.goto("/en/strategies");

    await expect(page).toHaveURL(/\/en\/strategies/);
    await expect(page).not.toHaveURL(/sign-in/);
    // At least one strategy links to its detail page — proves the catalog loaded from the backend.
    // The screen renders BOTH responsive branches into the DOM at once (mobile StrategyCard list +
    // the `hidden lg:block` desktop table), so the OTHER branch's `/strategies/<id>` anchors exist but
    // are display:none at the current viewport. Plain `.first()` resolves to the first DOM match, which
    // is a HIDDEN mobile-card anchor at the Desktop Chrome width, so it never turns visible. `:visible`
    // scopes the locator to the branch actually shown, so the assertion tracks a real, rendered link.
    await expect(page.locator('a[href*="/strategies/"]:visible').first()).toBeVisible({
      timeout: 30_000,
    });

    // eslint-disable-next-line no-console
    console.log(
      `[e2e] catalog rendered for ${wallet.address} on ${process.env.E2E_CHAIN ?? "arbitrum"}`,
    );
  });
});
