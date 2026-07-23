/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswapAmount tests
 * @implements-rules-version v1
 *
 * RAW base-units (wei) → human token-units number, via viem formatUnits. Mirrors how the interface
 * read `amount0/1`, `fees0/1`, `tokensOwed0/1` off the API before display.
 */
import { describe, expect, it } from "vitest";
import { toTokenAmount } from "./amount";

describe("toTokenAmount", () => {
  // @rule R-AMOUNT raw base units → human number, decimal-shifted by `decimals`
  it("converts a bigint wei amount to a human number for the token's decimals", () => {
    expect(toTokenAmount(BigInt(1_000_000), 6)).toBe(1); // 1 USDC
    expect(toTokenAmount(BigInt(1_500_000), 6)).toBe(1.5);
    expect(toTokenAmount(BigInt(10) ** BigInt(18), 18)).toBe(1); // 1 WETH
  });

  // @rule R-AMOUNT accepts the API's wei bigint-STRING shape
  it("accepts a decimal wei string (the API returns amount0/1 as bigint strings)", () => {
    expect(toTokenAmount("1000000000000000000", 18)).toBe(1);
    expect(toTokenAmount("2500000", 6)).toBe(2.5);
  });

  // @rule R-AMOUNT zero and sub-unit fees translate without losing the fractional part
  it("handles zero and small fractional fee amounts", () => {
    expect(toTokenAmount(BigInt(0), 18)).toBe(0);
    expect(toTokenAmount("123456", 18)).toBeCloseTo(1.23456e-13, 25);
  });

  // @rule R-AMOUNT cross-check: USDC fee of 38.005424 (6dp) round-trips to the display value
  it("matches a known fee figure (38.005424 USDC)", () => {
    expect(toTokenAmount(BigInt(38_005_424), 6)).toBeCloseTo(38.005424, 10);
  });
});
