/**
 * Manager operations on an OWNED strategy: remove / move-range / collect / close. Each is tagged so
 * you can run just one for regression (e.g. `--grep @move-range`). They mutate the same position, so
 * the file order (remove → move → collect → close) is deliberate; close is last.
 *
 * Requires a funded E2E_PRIVATE_KEY AND E2E_STRATEGY_ID pointing at a strategy this wallet owns
 * (create one with the seed fixture — see create-pool.spec.ts). collect needs fees to have accrued.
 */
import { hasFundedKey } from "../config";
import { test } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";
import {
  closePosition,
  collectFees,
  moveRange,
  openManageDetail,
  removeLiquidity,
} from "../helpers/operations";

const STRATEGY_ID = process.env.E2E_STRATEGY_ID ?? "";

test.describe("manager operations", { tag: "@write" }, () => {
  test.skip(!hasFundedKey(), "requires a funded E2E_PRIVATE_KEY (spends real funds + gas)");
  test.skip(!STRATEGY_ID, "set E2E_STRATEGY_ID to an owned strategy to run manager ops");
  test.slow();

  test.beforeEach(async ({ page }) => {
    await connectAndSignIn(page);
    await openManageDetail(page, STRATEGY_ID);
  });

  test("remove 25% liquidity", { tag: "@remove" }, async ({ page }) => {
    await removeLiquidity(page, 25);
  });

  test("move range (recenter)", { tag: "@move-range" }, async ({ page }) => {
    await moveRange(page);
  });

  test("collect fees", { tag: "@collect" }, async ({ page }) => {
    await collectFees(page);
  });

  test("close position", { tag: "@close" }, async ({ page }) => {
    await closePosition(page);
  });
});
