/**
 * @id PP-MGR (POO-437)
 * @name moveRangeSwap tests
 * @implements-rules-version v2
 *
 * Legacy (Arbitrum/Base) move-range swap-amount derivation [R2]. Mirrors v1's client-side
 * `calcRatio` + `getNewPositionProportions`: given the position's current pooled supplies and a new
 * tick range, how much of each token must be swapped to rebalance into the new range. The edge cases
 * (range entirely above / below the current price) have deterministic outputs; the in-range case
 * asserts the invariant that a rebalance never swaps in both directions.
 */
import { describe, expect, it } from "vitest";
import { computeLegacyMoveRangeSwap } from "./moveRangeSwap";

// 18/18 decimals + currentPrice 100 (token1 per token0) keeps the tick↔price arithmetic legible.
const D = 18;
const ONE = "1000000000000000000"; // 1 token, 18 decimals
const FIVE = "5000000000000000000"; // 5 tokens, 18 decimals

describe("computeLegacyMoveRangeSwap [R2]", () => {
  it("range entirely BELOW the current price → sell all token0 into token1", () => {
    // upper tick price (~50) < current (100) → all value belongs in token1: swap all of token0.
    const out = computeLegacyMoveRangeSwap({
      totalSupply0: ONE,
      totalSupply1: FIVE,
      decimals0: D,
      decimals1: D,
      currentPrice: 100,
      tickLower: 34_000, // ~1.0001^34000 ≈ 30
      tickUpper: 39_120, // ~50
    });
    expect(out.swapZeroForOneAmount).toBe(ONE);
    expect(out.swapOneForZeroAmount).toBe("0");
  });

  it("range entirely ABOVE the current price → sell all token1 into token0", () => {
    // lower tick price (~200) > current (100) → all value belongs in token0: swap all of token1.
    const out = computeLegacyMoveRangeSwap({
      totalSupply0: ONE,
      totalSupply1: FIVE,
      decimals0: D,
      decimals1: D,
      currentPrice: 100,
      tickLower: 53_000, // ~200
      tickUpper: 54_000, // ~221
    });
    expect(out.swapZeroForOneAmount).toBe("0");
    expect(out.swapOneForZeroAmount).toBe(FIVE);
  });

  it("zero supplies → nothing to swap", () => {
    const out = computeLegacyMoveRangeSwap({
      totalSupply0: "0",
      totalSupply1: "0",
      decimals0: D,
      decimals1: D,
      currentPrice: 100,
      tickLower: 39_120,
      tickUpper: 53_000,
    });
    expect(out.swapZeroForOneAmount).toBe("0");
    expect(out.swapOneForZeroAmount).toBe("0");
  });

  it("in-range → rebalances in a single direction (never both), bounded by supply", () => {
    const out = computeLegacyMoveRangeSwap({
      totalSupply0: ONE,
      totalSupply1: FIVE,
      decimals0: D,
      decimals1: D,
      currentPrice: 100,
      tickLower: 39_120, // ~50  < 100
      tickUpper: 53_000, // ~200 > 100
    });
    const s0 = BigInt(out.swapZeroForOneAmount);
    const s1 = BigInt(out.swapOneForZeroAmount);
    // A rebalance swaps at most one direction.
    expect(s0 === BigInt(0) || s1 === BigInt(0)).toBe(true);
    // Something is actually swapped (the pool is not already at the target split).
    expect(s0 + s1).toBeGreaterThan(BigInt(0));
    // Each swap can't exceed the token it draws from.
    expect(s0).toBeLessThanOrEqual(BigInt(ONE));
    expect(s1).toBeLessThanOrEqual(BigInt(FIVE));
  });

  it("preserves full raw precision for 18-decimal supplies (no float overflow)", () => {
    // A supply beyond Number.MAX_SAFE_INTEGER in raw units must round-trip exactly on a full swap.
    const bigSupply = "46581381556109034188"; // 46.58… ARB (from the real reported position)
    const out = computeLegacyMoveRangeSwap({
      totalSupply0: bigSupply,
      totalSupply1: "0",
      decimals0: D,
      decimals1: 6,
      currentPrice: 0.4, // ARB/USDC; range below → sell all token0
      tickLower: -302_490,
      tickUpper: -301_490,
    });
    expect(out.swapZeroForOneAmount).toBe(bigSupply);
    expect(out.swapOneForZeroAmount).toBe("0");
  });
});
