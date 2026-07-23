/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswapPrice tests
 * @implements-rules-version v1
 *
 * Current price (token1 per token0) from the pool's on-chain `sqrtPriceX96`. Cross-checked against
 * the Uniswap v3 SDK's bit-exact `TickMath.getSqrtRatioAtTick` (an independent source from this
 * module's `1.0001^tick` math): `priceFromSqrtPriceX96(sqrtRatioAtTick(t)) ≈ tickToPrice(t)`.
 */
import { describe, expect, it } from "vitest";
import { priceFromSqrtPriceX96 } from "./price";
import { tickToPrice } from "./tick";

describe("priceFromSqrtPriceX96", () => {
  // @rule R-SQRT sqrtPriceX96 == 2^96 (tick 0) → raw price 1, decimal-shifted by 10^(d0-d1)
  it("is the decimal shift at the 2^96 reference price (tick 0)", () => {
    const q96 = BigInt("79228162514264337593543950336"); // 2^96
    expect(priceFromSqrtPriceX96(q96, 18, 18)).toBeCloseTo(1, 9);
    expect(priceFromSqrtPriceX96(q96, 18, 6)).toBeCloseTo(1e12, 0);
  });

  // @rule R-SQRT mirrors tickToPrice at a real WETH/USDC tick (SDK-derived sqrtPriceX96)
  it("matches tickToPrice at tick -196260 (≈ 2998.9 USDC per WETH)", () => {
    // sqrtRatioAtTick(-196260) from @uniswap/v3-sdk TickMath (bit-exact, not 1.0001 float).
    const sqrtPriceX96 = "4338712821394260318376764";
    const expected = tickToPrice(-196260, 18, 6); // 2998.9045486470845
    expect(priceFromSqrtPriceX96(sqrtPriceX96, 18, 6)).toBeCloseTo(expected, 0);
    // within ~0.01% of the SDK reference price
    expect(Math.abs(priceFromSqrtPriceX96(sqrtPriceX96, 18, 6) / expected - 1)).toBeLessThan(1e-4);
  });

  // @rule R-SQRT accepts a bigint as well as the API's string shape
  it("accepts both a bigint and a decimal string", () => {
    const sqrtPriceX96 = "79466191966197645195421774833"; // sqrtRatioAtTick(60)
    const asString = priceFromSqrtPriceX96(sqrtPriceX96, 18, 6);
    const asBigint = priceFromSqrtPriceX96(BigInt(sqrtPriceX96), 18, 6);
    expect(asString).toBe(asBigint);
    expect(asString).toBeCloseTo(tickToPrice(60, 18, 6), -3);
  });
});
