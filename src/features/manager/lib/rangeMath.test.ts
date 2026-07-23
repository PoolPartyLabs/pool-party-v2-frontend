/**
 * @id PP-MGR (POO-278)
 * @name rangeMath.test
 * @implements-rules-version v1
 *
 * Value split is all-token0 below the range, all-token1 above, interpolated in range; tick-grid snap
 * lands on multiplicative usable-tick steps anchored at the current price.
 */
import { describe, expect, it } from "vitest";
import { snapToTickGrid, stepOnTickGrid, tokenSplit } from "./rangeMath";

describe("tokenSplit", () => {
  it("is all token0 when the price is at or below the range", () => {
    expect(tokenSplit(100, 100, 200)).toEqual({ pct0: 100, pct1: 0 });
    expect(tokenSplit(80, 100, 200)).toEqual({ pct0: 100, pct1: 0 });
  });

  it("is all token1 when the price is at or above the range", () => {
    expect(tokenSplit(200, 100, 200)).toEqual({ pct0: 0, pct1: 100 });
    expect(tokenSplit(250, 100, 200)).toEqual({ pct0: 0, pct1: 100 });
  });

  it("interpolates in range and the two halves sum to 100", () => {
    const split = tokenSplit(100, 81, 121); // sqrt 9 / 10 / 11
    expect(split.pct0 + split.pct1).toBeCloseTo(100, 6);
    expect(split.pct1).toBeGreaterThan(0);
    expect(split.pct0).toBeGreaterThan(0);
    // Near the bottom of the range → mostly token0.
    const low = tokenSplit(82, 81, 200);
    expect(low.pct0).toBeGreaterThan(low.pct1);
  });

  it("returns 50/50 for full range or degenerate inputs", () => {
    expect(tokenSplit(100, 50, 200, true)).toEqual({ pct0: 50, pct1: 50 });
    expect(tokenSplit(100, null, 200)).toEqual({ pct0: 50, pct1: 50 });
    expect(tokenSplit(100, 200, 100)).toEqual({ pct0: 50, pct1: 50 }); // inverted
  });
});

describe("snapToTickGrid / stepOnTickGrid", () => {
  it("leaves the current price itself on the grid", () => {
    expect(snapToTickGrid(1675.95, 1675.95, 5)).toBeCloseTo(1675.95, 6);
  });

  it("snaps an off-grid price to a nearby usable-tick price", () => {
    const snapped = snapToTickGrid(1700, 1675.95, 5);
    // Within one tick-spacing factor of the typed price (feeBps 5 → spacing 10 → ~0.10% per step).
    expect(Math.abs(snapped - 1700) / 1700).toBeLessThan(0.001);
  });

  it("steps up and down by exactly one usable tick (multiplicative, reversible)", () => {
    const up = stepOnTickGrid(1675.95, 1675.95, 5, 1);
    expect(up).toBeGreaterThan(1675.95);
    const back = stepOnTickGrid(up, 1675.95, 5, -1);
    expect(back).toBeCloseTo(1675.95, 6);
    // One 0.05% tier step ≈ 0.0001 × 10 = 0.10%.
    expect((up - 1675.95) / 1675.95).toBeCloseTo(1.0001 ** 10 - 1, 6);
  });
});
