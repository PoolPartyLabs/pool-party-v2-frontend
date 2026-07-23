/**
 * @id PP-CORE-LIB-022 — tests
 * @name positionTokenSplit / splitUsdAmount — tests
 *
 * Pure value-split of a Uniswap v3 position's raw reserves (POO-498 / POO-483 rules v2 R1, R6).
 * TDD: written before the implementation. Fixtures anchor by a KNOWN price (via priceToTick) so the
 * value shares are exact, not tick-derived by hand.
 */
import { describe, expect, it } from "vitest";
import { positionTokenSplit, splitUsdAmount } from "./positionSplit";
import { priceToTick } from "./tick";

/** The integer tick whose token1/token0 price equals `price`, for building exact fixtures. */
function tickForPrice(price: number, decimals0: number, decimals1: number): number {
  return Math.round(priceToTick(price, decimals0, decimals1));
}

/** Raw base-unit string for a human amount at `decimals` (fixture helper, avoids float in the string). */
function raw(amount: number, decimals: number): string {
  // Build from a fixed-decimal string so 1 WETH is exactly "1000000000000000000", not 1e18 rounding.
  const [int, frac = ""] = amount.toFixed(decimals).split(".");
  return `${int}${frac.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

describe("positionTokenSplit", () => {
  // @rule R1 (POO-483 v2)
  it("computes value shares from reserves + current tick (in-range 18/6 pool)", () => {
    // 1 WETH (18d) + 3000 USDC (6d) at price 3000 USDC/WETH → each leg is worth 3000, so a 50/50 split.
    const tick = tickForPrice(3000, 18, 6);
    const split = positionTokenSplit({
      totalSupply0: raw(1, 18),
      totalSupply1: raw(3000, 6),
      tickCurrent: tick,
      decimals0: 18,
      decimals1: 6,
    });
    expect(split).not.toBeNull();
    if (!split) return;
    expect(split.reserve0).toBeCloseTo(1, 6);
    expect(split.reserve1).toBeCloseTo(3000, 3);
    expect(split.price).toBeCloseTo(3000, 0);
    expect(split.share0).toBeCloseTo(0.5, 4);
    expect(split.share1).toBeCloseTo(0.5, 4);
    expect(split.share0 + split.share1).toBeCloseTo(1, 10);
  });

  // @rule R1 — decimal asymmetry must not shift the value by orders of magnitude.
  it("handles decimal asymmetry (18 vs 6) without magnitude errors", () => {
    // 2 WETH + 1500 USDC at price 3000 → value0 = 6000, value1 = 1500 → share0 = 0.8.
    const tick = tickForPrice(3000, 18, 6);
    const split = positionTokenSplit({
      totalSupply0: raw(2, 18),
      totalSupply1: raw(1500, 6),
      tickCurrent: tick,
      decimals0: 18,
      decimals1: 6,
    });
    expect(split).not.toBeNull();
    if (!split) return;
    expect(split.reserve0).toBeCloseTo(2, 6);
    expect(split.reserve1).toBeCloseTo(1500, 3);
    expect(split.share0).toBeCloseTo(0.8, 4);
    expect(split.share1).toBeCloseTo(0.2, 4);
  });

  // @rule R1 — extreme ticks near the bounds stay finite.
  it("handles extreme ticks near the tick bounds without NaN/Infinity", () => {
    for (const tick of [-887272, 887272, -800000, 800000]) {
      const split = positionTokenSplit({
        totalSupply0: raw(1, 18),
        totalSupply1: raw(1, 6),
        tickCurrent: tick,
        decimals0: 18,
        decimals1: 6,
      });
      // Either a finite, in-[0,1] split, or null — never NaN/Infinity leaking into a share.
      if (split) {
        expect(Number.isFinite(split.share0)).toBe(true);
        expect(Number.isFinite(split.share1)).toBe(true);
        expect(split.share0).toBeGreaterThanOrEqual(0);
        expect(split.share0).toBeLessThanOrEqual(1);
        expect(split.share0 + split.share1).toBeCloseTo(1, 8);
      }
    }
  });

  // @rule R1 — single-sided position: all value in the non-zero leg.
  it("puts 100% in the non-zero token for a single-sided position (one reserve = 0)", () => {
    const tick = tickForPrice(3000, 18, 6);
    const only0 = positionTokenSplit({
      totalSupply0: raw(1, 18),
      totalSupply1: "0",
      tickCurrent: tick,
      decimals0: 18,
      decimals1: 6,
    });
    expect(only0?.share0).toBeCloseTo(1, 10);
    expect(only0?.share1).toBeCloseTo(0, 10);

    const only1 = positionTokenSplit({
      totalSupply0: "0",
      totalSupply1: raw(500, 6),
      tickCurrent: tick,
      decimals0: 18,
      decimals1: 6,
    });
    expect(only1?.share0).toBeCloseTo(0, 10);
    expect(only1?.share1).toBeCloseTo(1, 10);
  });

  // @rule R1 — null on any missing raw field (each of the five).
  it("returns null when any raw field is missing", () => {
    const base = {
      totalSupply0: raw(1, 18),
      totalSupply1: raw(3000, 6),
      tickCurrent: tickForPrice(3000, 18, 6),
      decimals0: 18,
      decimals1: 6,
    };
    expect(positionTokenSplit({ ...base, totalSupply0: undefined })).toBeNull();
    expect(positionTokenSplit({ ...base, totalSupply1: undefined })).toBeNull();
    expect(positionTokenSplit({ ...base, tickCurrent: undefined })).toBeNull();
    expect(positionTokenSplit({ ...base, decimals0: undefined })).toBeNull();
    expect(positionTokenSplit({ ...base, decimals1: undefined })).toBeNull();
  });

  // @rule R1 — null on a non-finite tick/decimals (guards NaN propagating into a price).
  it("returns null when the tick or a decimal is non-finite", () => {
    const base = {
      totalSupply0: raw(1, 18),
      totalSupply1: raw(3000, 6),
      tickCurrent: 0,
      decimals0: 18,
      decimals1: 6,
    };
    expect(positionTokenSplit({ ...base, tickCurrent: Number.NaN })).toBeNull();
    expect(positionTokenSplit({ ...base, decimals0: Number.POSITIVE_INFINITY })).toBeNull();
  });

  // @rule R1 — null when both reserves are zero (no value to split).
  it("returns null when both reserves are zero", () => {
    const split = positionTokenSplit({
      totalSupply0: "0",
      totalSupply1: "0",
      tickCurrent: tickForPrice(3000, 18, 6),
      decimals0: 18,
      decimals1: 6,
    });
    expect(split).toBeNull();
  });
});

describe("splitUsdAmount", () => {
  const tick = tickForPrice(3000, 18, 6);
  // 1 WETH + 3000 USDC → 50/50, poolValueUsd anchor = 6000.
  const split = positionTokenSplit({
    totalSupply0: raw(1, 18),
    totalSupply1: raw(3000, 6),
    tickCurrent: tick,
    decimals0: 18,
    decimals1: 6,
  });

  // @rule R1 — amounts pro-rata; the USD legs sum back to the input.
  it("allocates amounts pro-rata and its usd0+usd1 sum back to the input", () => {
    if (!split) throw new Error("fixture split is null");
    // Withdraw $3000 of a $6000 position → f = 0.5 → half of each reserve.
    const out = splitUsdAmount(split, 3000, 6000);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.amount0).toBeCloseTo(0.5, 6); // 0.5 WETH
    expect(out.amount1).toBeCloseTo(1500, 3); // 1500 USDC
    // The USD legs sum EXACTLY back to the input (this is the pro-rata invariant); the per-leg
    // figures sit ~$1500 within tick-discretization drift (the integer tick makes p ≈ 3000, not
    // exactly 3000, so a fixture with 0-decimal per-leg tolerance is the honest assertion).
    expect(out.usd0 + out.usd1).toBeCloseTo(3000, 6);
    expect(out.usd0).toBeCloseTo(1500, 0);
    expect(out.usd1).toBeCloseTo(1500, 0);
  });

  // @rule R6 (POO-483 v2) — overdraw CLAMPS at f = 1 (never display more than the position holds).
  it("clamps a withdrawal larger than the pool value anchor (f > 1)", () => {
    if (!split) throw new Error("fixture split is null");
    // Ask for $9000 against a $6000 anchor → f clamps to 1 → the full reserves, not 1.5x.
    const out = splitUsdAmount(split, 9000, 6000);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.amount0).toBeCloseTo(1, 6); // full 1 WETH, not 1.5
    expect(out.amount1).toBeCloseTo(3000, 3); // full 3000 USDC, not 4500
    // USD legs still follow the value shares of the (clamped) full position.
    expect(out.usd0 + out.usd1).toBeCloseTo(6000, 3);
  });

  // @rule R1 — degenerate anchors/amounts return null (caller degrades to a USD total).
  it("returns null when poolValueUsd <= 0 or usdAmount < 0 or split is null", () => {
    if (!split) throw new Error("fixture split is null");
    expect(splitUsdAmount(split, 100, 0)).toBeNull();
    expect(splitUsdAmount(split, 100, -1)).toBeNull();
    expect(splitUsdAmount(split, -1, 6000)).toBeNull();
    expect(splitUsdAmount(null, 100, 6000)).toBeNull();
  });
});
