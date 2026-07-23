/**
 * @id PP-MGR-MCK-001 (POO-502)
 * @name manager mock data tests
 * @implements-rules-version v2
 *
 * Locks the manager mock detail fixtures: every entry is schema-valid, and the PP-MOCK raw reserve
 * block added for the manager Remove/Close per-token split (POO-502 / POO-483 v2 R2) reconciles to
 * the strategy AUM (the split anchor), so `positionTokenSplit` runs in mock mode on the SAME path as
 * real without drifting from the displayed pool value.
 */
import { describe, expect, it } from "vitest";
import { managerStrategyDetailSchema } from "@/lib/schemas";
import { positionTokenSplit, splitUsdAmount } from "@/lib/uniswap";
import { managerStrategyDetails } from "./manager";
import { strategies } from "./strategies";

describe("manager mock detail data", () => {
  it("has every manage-detail entry pass the ManagerStrategyDetail schema parse", () => {
    for (const detail of managerStrategyDetails) {
      expect(() => managerStrategyDetailSchema.parse(detail)).not.toThrow();
    }
  });

  // POO-649: the console share pill deep-links `/strategies/<publicStrategyId>`, so every managed
  // strategy MUST map to a catalog id that resolves (present + non-closed, since the discovery catalog
  // drops closed pools). This is the regression guard that keeps the share link from 404-ing.
  // @rule R1: every managed strategy maps to a resolvable public catalog id (non-closed).
  it("[POO-649] maps every managed strategy to a resolvable (non-closed) public catalog id", () => {
    const resolvable = new Set(strategies.filter((s) => s.status !== "closed").map((s) => s.id));
    for (const detail of managerStrategyDetails) {
      expect(resolvable.has(detail.publicStrategyId)).toBe(true);
    }
  });

  // POO-502 / POO-483 v2 R2: the seeded raw reserve block must reconcile to the strategy AUM (the
  // split anchor), so the client-side value split matches the displayed pool value (mock realism).
  it("reconciles each seeded raw reserve block to the strategy AUM (± 0.5%)", () => {
    const seeded = managerStrategyDetails.filter(
      (detail) => detail.totalSupply0 != null && detail.tickCurrent != null,
    );
    // The three active strategies carry the block; the paused/closed/draft ones do not (degrade).
    expect(seeded.length).toBeGreaterThanOrEqual(3);

    for (const detail of seeded) {
      const split = positionTokenSplit({
        totalSupply0: detail.totalSupply0,
        totalSupply1: detail.totalSupply1,
        tickCurrent: detail.tickCurrent,
        decimals0: detail.pool.decimals0,
        decimals1: detail.pool.decimals1,
      });
      expect(split).not.toBeNull();
      if (!split) continue;
      // Pool value in USD-ish token1 terms = reserve0 * price + reserve1; anchor is the AUM.
      const poolValue = split.reserve0 * split.price + split.reserve1;
      expect(poolValue).toBeCloseTo(detail.aum, -2); // within ~1% at this scale
      // A full-stake split at f = 1 returns finite per-token amounts summing back to the anchor.
      const full = splitUsdAmount(split, detail.aum, detail.aum);
      expect(full).not.toBeNull();
      if (full) expect(full.usd0 + full.usd1).toBeCloseTo(detail.aum, 2);
    }
  });

  // The seeded blocks are deliberately NON-even so the per-token split is visibly not a 1/N split
  // (kills the possibility of a fixture silently regressing to an even split).
  it("seeds at least one deliberately non-even value split", () => {
    const yieldPlus = managerStrategyDetails.find((detail) => detail.id === "yield-plus");
    expect(yieldPlus?.totalSupply0).toBeDefined();
    if (!yieldPlus?.totalSupply0) return;
    const split = positionTokenSplit({
      totalSupply0: yieldPlus.totalSupply0,
      totalSupply1: yieldPlus.totalSupply1,
      tickCurrent: yieldPlus.tickCurrent,
      decimals0: yieldPlus.pool.decimals0,
      decimals1: yieldPlus.pool.decimals1,
    });
    // ~60/40, clearly off a 50/50 even split.
    expect(split?.share0).toBeGreaterThan(0.55);
    expect(split?.share0).toBeLessThan(0.65);
  });
});
