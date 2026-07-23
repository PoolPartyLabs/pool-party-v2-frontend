/**
 * @id PP-MGR (POO-315)
 * @name mintAmountsWithSlippage tests
 * @implements-rules-version v1
 *
 * Position-aware mint mins via the Uniswap SDK: never exceed the seed inputs, shrink as slippage
 * grows. Uses a tick-consistent sqrtPriceX96 so the SDK Pool constructs.
 */
import { TickMath } from "@uniswap/v3-sdk";
import { describe, expect, it } from "vitest";
import type { DexPoolState } from "./dexPoolState";
import { mintAmountsWithSlippage } from "./mintAmounts";

const ONE = "1000000000000000000"; // 1.0 at 18 decimals

function state(tickCurrent: number): DexPoolState {
  return {
    feeTier: 500,
    currency0: { address: "0x0000000000000000000000000000000000000001", decimals: 18 },
    currency1: { address: "0x0000000000000000000000000000000000000002", decimals: 18 },
    sqrtPriceX96: TickMath.getSqrtRatioAtTick(tickCurrent).toString(),
    liquidity: "1000000000000000000",
    tickCurrent,
  };
}

describe("mintAmountsWithSlippage", () => {
  it("returns mins at or below the seed inputs", () => {
    const { amount0Min, amount1Min } = mintAmountsWithSlippage(state(0), 1, -10, 10, ONE, ONE, 0.5);
    expect(BigInt(amount0Min) <= BigInt(ONE)).toBe(true);
    expect(BigInt(amount1Min) <= BigInt(ONE)).toBe(true);
  });

  it("shrinks (or holds) the mins as slippage grows", () => {
    const low = mintAmountsWithSlippage(state(0), 1, -10, 10, ONE, ONE, 0.1);
    const high = mintAmountsWithSlippage(state(0), 1, -10, 10, ONE, ONE, 5);
    expect(BigInt(high.amount0Min) <= BigInt(low.amount0Min)).toBe(true);
    expect(BigInt(high.amount1Min) <= BigInt(low.amount1Min)).toBe(true);
  });

  it("constructs for an off-center current tick (one side consumed more)", () => {
    // Current tick above the range center → token amounts consumed asymmetrically; must not throw.
    const { amount0Min, amount1Min } = mintAmountsWithSlippage(state(5), 1, -10, 10, ONE, ONE, 0.5);
    expect(BigInt(amount0Min) >= BigInt(0)).toBe(true);
    expect(BigInt(amount1Min) >= BigInt(0)).toBe(true);
  });

  // One-sided (mono-asset) seed: a range entirely on one side of the current price only consumes
  // one token, so the other leg is seeded with "0". The SDK must TOLERATE the zero leg (return a
  // valid min, not throw) so the create-pool tx can never blow up after the user has already signed
  // Permit2 (PP-MGR mono-asset seed, POO-309). The unneeded leg's min is always "0".
  it("tolerates a zero token1 leg when the range sits entirely above the current tick", () => {
    // current=0, range [100,1000] → price below the range → only token0 is consumed.
    const { amount0Min, amount1Min } = mintAmountsWithSlippage(
      state(0),
      1,
      100,
      1000,
      ONE,
      "0",
      0.5,
    );
    expect(BigInt(amount0Min) > BigInt(0)).toBe(true); // needed leg keeps a real min
    expect(amount1Min).toBe("0"); // unneeded leg is exactly zero
  });

  it("tolerates a zero token0 leg when the range sits entirely below the current tick", () => {
    // current=0, range [-1000,-100] → price above the range → only token1 is consumed.
    const { amount0Min, amount1Min } = mintAmountsWithSlippage(
      state(0),
      1,
      -1000,
      -100,
      "0",
      ONE,
      0.5,
    );
    expect(amount0Min).toBe("0"); // unneeded leg is exactly zero
    expect(BigInt(amount1Min) > BigInt(0)).toBe(true); // needed leg keeps a real min
  });
});
