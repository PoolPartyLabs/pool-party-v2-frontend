/**
 * @id PP-MGR (POO-306)
 * @name pairedSeedAmounts tests
 * @implements-rules-version v1
 */
import { describe, expect, it } from "vitest";
import type { DexPoolState } from "./dexPoolState";
import { pairedSeedAmounts } from "./pairedAmount";

// USDC/USDT, both 6 decimals, price ~1 (token1 per token0). sqrtPriceX96 = sqrt(1) * 2^96 = 2^96.
const SQRT_PRICE_1 = (BigInt(2) ** BigInt(96)).toString();
const state: DexPoolState = {
  feeTier: 100, // 0.01% → spacing 1
  // Checksummed addresses (the API returns them this way; the v3-SDK Token rejects bad checksums).
  currency0: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
  currency1: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
  sqrtPriceX96: SQRT_PRICE_1,
  liquidity: "1000000000000000000",
  tickCurrent: 0,
};

const CHAIN_ID = 137;

describe("pairedSeedAmounts", () => {
  it("derives token1 from token0 for a symmetric in-range position (~equal at price 1)", () => {
    const res = pairedSeedAmounts(state, CHAIN_ID, -100, 100, 0, "1000000"); // 1 USDC
    expect(res.amount0).toBe("1000000"); // independent kept verbatim
    // symmetric range around the current price at price 1 → ~equal amounts.
    const amount1 = Number(res.amount1);
    expect(amount1).toBeGreaterThan(980_000);
    expect(amount1).toBeLessThan(1_020_000);
  });

  it("derives token0 from token1 (independent field 1)", () => {
    const res = pairedSeedAmounts(state, CHAIN_ID, -100, 100, 1, "1000000"); // 1 USDT
    expect(res.amount1).toBe("1000000");
    const amount0 = Number(res.amount0);
    expect(amount0).toBeGreaterThan(980_000);
    expect(amount0).toBeLessThan(1_020_000);
  });

  it("is single-sided (all token1) when the price is above the range", () => {
    // tickCurrent 0 is above an entirely-negative range.
    const res = pairedSeedAmounts(state, CHAIN_ID, -200, -100, 1, "1000000");
    expect(res).toEqual({ amount0: "0", amount1: "1000000" });
  });

  it("is single-sided (all token0) when the price is below the range", () => {
    // tickCurrent 0 is below an entirely-positive range.
    const res = pairedSeedAmounts(state, CHAIN_ID, 100, 200, 0, "1000000");
    expect(res).toEqual({ amount0: "1000000", amount1: "0" });
  });

  it("returns zeros for a non-positive or unparsable independent amount", () => {
    expect(pairedSeedAmounts(state, CHAIN_ID, -100, 100, 0, "0")).toEqual({
      amount0: "0",
      amount1: "0",
    });
    expect(pairedSeedAmounts(state, CHAIN_ID, -100, 100, 0, "abc")).toEqual({
      amount0: "0",
      amount1: "0",
    });
  });
});
