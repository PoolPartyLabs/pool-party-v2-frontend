/**
 * Create pool — and the "seed in-range strategy" fixture.
 *
 * Two uses:
 *   1) regression of the create flow (tag @create), and
 *   2) SEED (tag @seed): create one strategy positioned IN RANGE and leave it, so later runs have a
 *      live position accruing fees to exercise `collect fees`. After a seed run, capture the new
 *      strategy id (URL becomes /manager?created=1 → open it) and pass it back as E2E_STRATEGY_ID.
 *
 * The create wizard is Mandate → Build → Review; launch is in ReviewStep ("Launch" → confirm), then
 * up to 2 ERC-20 approves + a Permit2 batch signature + the create tx — all auto-signed by the shim.
 * Requires a funded E2E_PRIVATE_KEY with BOTH seed tokens (+ gas) on E2E_CHAIN.
 *
 * VALIDATE: token pick + seed amounts + fee/name inputs vary by pool and have no test ids — finish
 * wiring this against a funded run (and add data-testids to the wizard for stable selectors).
 */
import { hasFundedKey } from "../config";
import { expect, test } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";
import { waitForWriteSuccess } from "../helpers/operations";

const SEED_USD = Number(process.env.E2E_CREATE_USD ?? 2); // dev min for create-pool

test.describe("create pool", { tag: ["@write", "@create"] }, () => {
  test.skip(!hasFundedKey(), "requires a funded E2E_PRIVATE_KEY with both seed tokens + gas");
  test.slow();

  test("open the create wizard", { tag: "@seed" }, async ({ page }) => {
    await connectAndSignIn(page);
    await page.goto("/en/manager/new");
    // The wizard mounts (authed manager surface). Full fill+launch is completed on a funded run.
    await expect(page).toHaveURL(/\/en\/manager\/new/);
    await expect(page).not.toHaveURL(/sign-in/);

    // VALIDATE (funded): drive Mandate (pick pair) → Build (set seed amounts to ~$SEED_USD, centered
    // range so it starts IN RANGE) → Review (name 10–50 chars, fee 10–90%) → "Launch" → confirm.
    // await page.getByRole("button", { name: /launch/i }).click();
    // await page.getByRole("button", { name: /confirm|launch/i }).last().click();
    // await waitForWriteSuccess(page);
    // await page.waitForURL(/\/manager\?created=1/);
    void SEED_USD;
    void waitForWriteSuccess;
  });
});
