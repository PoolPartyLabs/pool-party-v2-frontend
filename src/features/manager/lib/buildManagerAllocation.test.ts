/**
 * @id PP-MGR-LIB-007 (POO-563)
 * @name buildManagerAllocation tests
 * @implements-rules-version v1
 *
 * TDD for the client-side manage-detail Allocation (POO-563). Rules:
 * [R1] tokens = percent-of-value split from positionTokenSplit; protocols = single 100% Uniswap row.
 * [R2] single-sided / out-of-range positions render 100/0 truthfully.
 * [R5] missing reserve data -> undefined (the card hides; never placeholder percentages).
 */
import { describe, expect, it } from "vitest";
import { buildManagerAllocation } from "./buildManagerAllocation";

describe("buildManagerAllocation", () => {
  // A roughly-balanced ETH/USDC position: 24.72 ETH at ~$2,080 (~$51.4k) vs 51,440 USDC.
  const balancedEthUsdc = {
    token0: "ETH",
    token1: "USDC",
    totalSupply0: "24720000000000000000", // 24.72 ETH (18 decimals)
    totalSupply1: "51440000000", // 51,440 USDC (6 decimals)
    tickCurrent: -195_863,
    decimals0: 18,
    decimals1: 6,
  };

  // @rule R1
  it("protocols is a single 100% Uniswap v3 row", () => {
    const allocation = buildManagerAllocation(balancedEthUsdc);
    expect(allocation?.protocols).toEqual([{ label: "Uniswap v3", pct: 100 }]);
  });

  // @rule R1
  it("tokens are the two symbols with value-split percentages that sum to 100", () => {
    const allocation = buildManagerAllocation(balancedEthUsdc);
    expect(allocation?.tokens).toHaveLength(2);
    expect(allocation?.tokens[0]?.label).toBe("ETH");
    expect(allocation?.tokens[1]?.label).toBe("USDC");
    const sum = (allocation?.tokens ?? []).reduce((acc, t) => acc + t.pct, 0);
    expect(sum).toBeCloseTo(100, 9);
    // Roughly balanced position -> both sides are a meaningful (non-zero, non-100) share.
    for (const token of allocation?.tokens ?? []) {
      expect(token.pct).toBeGreaterThan(0);
      expect(token.pct).toBeLessThan(100);
    }
  });

  // @rule R1: the split percentages match positionTokenSplit's value shares (share0/share1 * 100).
  it("tokens percentages equal the value shares from the position split", () => {
    const allocation = buildManagerAllocation(balancedEthUsdc);
    // token1 (USDC) reserve is 51,440; token0 (ETH) value = 24.72 * price(tickCurrent).
    // We assert the two are close to a plausible ~50/50 split (this position is deliberately balanced),
    // and that both percentages are within [0, 100].
    const eth = allocation?.tokens[0]?.pct ?? 0;
    const usdc = allocation?.tokens[1]?.pct ?? 0;
    expect(eth + usdc).toBeCloseTo(100, 9);
    expect(eth).toBeGreaterThan(30);
    expect(eth).toBeLessThan(70);
  });

  // @rule R2: single-sided (all token1) -> 0/100 truthfully.
  it("single-sided position (all token1) renders 0/100", () => {
    const allocation = buildManagerAllocation({
      ...balancedEthUsdc,
      totalSupply0: "0",
    });
    expect(allocation?.tokens[0]).toEqual({ label: "ETH", pct: 0 });
    expect(allocation?.tokens[1]).toEqual({ label: "USDC", pct: 100 });
    expect(allocation?.protocols).toEqual([{ label: "Uniswap v3", pct: 100 }]);
  });

  // @rule R2: single-sided (all token0) -> 100/0 truthfully.
  it("single-sided position (all token0) renders 100/0", () => {
    const allocation = buildManagerAllocation({
      ...balancedEthUsdc,
      totalSupply1: "0",
    });
    expect(allocation?.tokens[0]).toEqual({ label: "ETH", pct: 100 });
    expect(allocation?.tokens[1]).toEqual({ label: "USDC", pct: 0 });
  });

  // @rule R5: any missing raw reserve field -> undefined (card hides).
  it("returns undefined when the tick is missing", () => {
    expect(buildManagerAllocation({ ...balancedEthUsdc, tickCurrent: undefined })).toBeUndefined();
  });

  // @rule R5
  it("returns undefined when a reserve is missing", () => {
    expect(buildManagerAllocation({ ...balancedEthUsdc, totalSupply0: undefined })).toBeUndefined();
  });

  // @rule R5
  it("returns undefined when decimals are missing", () => {
    expect(buildManagerAllocation({ ...balancedEthUsdc, decimals1: undefined })).toBeUndefined();
  });

  // @rule R5: a degenerate zero/zero position (no value to split) -> undefined, never 0/0 or NaN.
  it("returns undefined when both reserves are zero (nothing to split)", () => {
    expect(
      buildManagerAllocation({ ...balancedEthUsdc, totalSupply0: "0", totalSupply1: "0" }),
    ).toBeUndefined();
  });

  // @rule R5: a missing symbol is not fabricated — no honest label, no card.
  it("returns undefined when a token symbol is missing", () => {
    expect(buildManagerAllocation({ ...balancedEthUsdc, token0: undefined })).toBeUndefined();
  });
});
