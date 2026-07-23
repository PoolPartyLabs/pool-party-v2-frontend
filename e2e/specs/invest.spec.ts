/**
 * Write smoke: invest a tiny amount into a strategy end-to-end (the "1 cheap write" tier).
 * Skipped unless a funded E2E_PRIVATE_KEY is provided — this spends real USDC + gas on the target chain.
 * Wallet needs: a little USDC on E2E_CHAIN (arbitrum|base) + native gas. Amount defaults to $1 (dev min).
 */
import { hasFundedKey } from "../config";
import { test } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";
import { invest, openFirstStrategy } from "../helpers/operations";

const AMOUNT_USD = Number(process.env.E2E_INVEST_USD ?? 1);

test.describe("invest (add liquidity)", { tag: ["@write", "@invest"] }, () => {
  test.skip(!hasFundedKey(), "requires a funded E2E_PRIVATE_KEY (spends real USDC + gas)");
  test.slow();

  test("invest a small amount into a strategy", async ({ page, wallet }) => {
    await connectAndSignIn(page);

    let id = process.env.E2E_STRATEGY_ID ?? "";
    if (id) await page.goto(`/en/strategies/${id}`);
    else id = await openFirstStrategy(page);

    await invest(page, AMOUNT_USD);
    // biome-ignore lint/suspicious/noConsole: harness diagnostics
    console.log(`[e2e] invested $${AMOUNT_USD} into ${id} as ${wallet.address}`);
  });
});
