/**
 * @id PP-PORT-SCR-001 (POO-299)
 * @name buildPortfolioViewModel tests
 * @implements-rules-version v3 (POO-898 rules v1)
 *
 * [R3] join + summary + allocation-by-risk; [R4] empty positions → zero summary.
 * POO-898 (rules v1): the "unclaimed fees" pill (totalEarned) is claimable-only, de-mirrored from
 * the lifetime totalYield (partially supersedes POO-714 R5).
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { buildPortfolioViewModel } from "./portfolioViewModel";

function strategy(id: string, riskLevel: 1 | 3 | 5, estReturn: number): Strategy {
  return {
    id,
    name: `Strategy ${id}`,
    manager: "0xabc…def",
    riskLevel,
    minInvestment: 10,
    tvl: 1000,
    investors: 5,
    estReturn,
    rateType: "APR",
    status: "active",
  };
}

function position(strategyId: string, currentValue: number): Position {
  return {
    id: `pos-${strategyId}`,
    strategyId,
    invested: currentValue,
    currentValue,
    totalYield: 10,
    available: currentValue,
    reinvestment: "auto-compound",
    status: "active",
  };
}

const strategies = [strategy("s1", 1, 5), strategy("s2", 3, 15), strategy("s3", 1, 8)];

describe("buildPortfolioViewModel", () => {
  it("[R3] sums the summary and mirrors currentValue into totalValue/totalEarned", () => {
    const vm = buildPortfolioViewModel(
      [position("s1", 100), position("s2", 300)],
      strategies,
      "en",
    );
    expect(vm.currentValue).toBe(400);
    expect(vm.totalValue).toBe(400);
    expect(vm.totalEarned).toBe(20); // 2 positions × yield 10
  });

  it("[R3] aggregates allocation by risk band weighted by current value", () => {
    const vm = buildPortfolioViewModel(
      [position("s1", 100), position("s3", 50), position("s2", 300)],
      strategies,
      "en",
    );
    const byLevel = Object.fromEntries(vm.allocation.map((a) => [a.level, a.value]));
    expect(byLevel[1]).toBe(150); // s1 (100) + s3 (50), both risk 1
    expect(byLevel[3]).toBe(300); // s2
  });

  it("[R4] empty positions → zero summary and empty allocation", () => {
    const vm = buildPortfolioViewModel([], strategies, "en");
    expect(vm.totalValue).toBe(0);
    expect(vm.avgApy).toBe(0);
    expect(vm.allocation).toHaveLength(0);
  });

  it("[R6] pins closed positions to the top of the list (pending withdraw surfaces first)", () => {
    const active = position("s1", 100);
    const closed: Position = { ...position("s2", 50), status: "closed" };
    const vm = buildPortfolioViewModel([active, closed], strategies, "en");
    expect(vm.positions.map((entry) => entry.position.id)).toEqual(["pos-s2", "pos-s1"]);
  });

  it("[POO-455] renders a closed position when its strategy is in the holdings catalog", () => {
    // The caller passes the all-status holdings catalog (which includes closed), so a closed
    // holding resolves and is counted — this is the fix for the vanishing closed position.
    const closedStrategy: Strategy = { ...strategy("s-closed", 1, 5), status: "closed" };
    const closedPosition: Position = { ...position("s-closed", 250), status: "closed" };
    const vm = buildPortfolioViewModel([closedPosition], [...strategies, closedStrategy], "en");

    expect(vm.positions).toHaveLength(1);
    expect(vm.positions[0]?.strategy.status).toBe("closed");
    expect(vm.currentValue).toBe(250);
  });

  it("drops a catalog-absent position that has no fallbackStrategy either (never fabricated)", () => {
    // No catalog match AND no real-data fallback → dropped; missing real data hides, never faked.
    const orphan: Position = { ...position("s-gone", 250), status: "closed" };
    const vm = buildPortfolioViewModel([orphan], strategies, "en"); // strategies has no "s-gone"
    expect(vm.positions).toHaveLength(0);
  });

  it("[POO-526 R1] renders a catalog-absent closed position via its fallbackStrategy, pinned top", () => {
    // The closed pool is absent from /pools (holdings catalog), so the position resolves via the
    // real-data Strategy synthesized from its own payload — and stays pinned above active holdings.
    const synth: Strategy = {
      ...strategy("s-gone", 5, 12),
      status: "closed",
      name: "Pool de teste",
    };
    const orphanClosed: Position = {
      ...position("s-gone", 250),
      status: "closed",
      fallbackStrategy: synth,
    };
    const vm = buildPortfolioViewModel([position("s1", 100), orphanClosed], strategies, "en");
    expect(vm.positions).toHaveLength(2);
    expect(vm.positions[0]?.position.id).toBe("pos-s-gone");
    expect(vm.positions[0]?.strategy.status).toBe("closed");
    expect(vm.positions[0]?.strategy.name).toBe("Pool de teste");
    expect(vm.currentValue).toBe(350);
  });

  it("[POO-526 R1] a resolvable catalog strategy wins over the fallbackStrategy (enrichment first)", () => {
    const synth: Strategy = { ...strategy("s1", 5, 99), name: "Synth Should Not Win" };
    const pos: Position = { ...position("s1", 100), fallbackStrategy: synth };
    const vm = buildPortfolioViewModel([pos], strategies, "en");
    expect(vm.positions[0]?.strategy.name).toBe("Strategy s1"); // catalog, not the fallback
    expect(vm.positions[0]?.strategy.estReturn).toBe(5);
  });

  // POO-714 (rules v1) [R5]: the Portfolio "Total yield" KPI uses the same corrected LIFETIME
  // formula as Home: all-time COLLECTED fees (over ALL collected-map keys, incl. fully-exited
  // positions) + currently AVAILABLE (claimable) fees. POO-898 partially supersedes R5: the
  // "unclaimed fees" pill (totalEarned) no longer mirrors this figure (see the POO-898 block).
  describe("[POO-714 R5] Total yield = lifetime collected + available", () => {
    it("[R1][R5] adds lifetime collected (incl. exited keys) to the claimable sum", () => {
      const vm = buildPortfolioViewModel(
        [position("s1", 100), position("s2", 300)],
        strategies,
        "en",
        undefined,
        [],
        { "pos-s1": 5, "pos-gone": 40 }, // pos-gone: fully exited, still lifetime yield
      );
      expect(vm.totalYield).toBe(65); // (10 + 10) available + (5 + 40) collected
    });

    it("[R2] Total yield is stable across a collect (available moves into collected)", () => {
      const before = buildPortfolioViewModel(
        [position("s1", 100)],
        strategies,
        "en",
        undefined,
        [],
        {
          "pos-s1": 30,
        },
      );
      // Collect the 10 available: the claimable leg zeroes, collected grows by exactly +10.
      const collected: Position = { ...position("s1", 100), totalYield: 0 };
      const after = buildPortfolioViewModel([collected], strategies, "en", undefined, [], {
        "pos-s1": 40,
      });
      expect(before.totalYield).toBe(40);
      expect(after.totalYield).toBe(before.totalYield);
    });

    it("[R4] an omitted collected map degrades to the claimable-only figure (never NaN)", () => {
      const vm = buildPortfolioViewModel([position("s1", 100)], strategies, "en");
      expect(vm.totalYield).toBe(10);
      expect(Number.isNaN(vm.totalYield)).toBe(false);
    });
  });

  // POO-898 (rules v1, partially supersedes POO-714 R5): the hero "unclaimed fees" pill
  // (totalEarned) is the CLAIMABLE-ONLY sum (per-position totalYield), no lifetime-collected leg,
  // so the pill agrees with its own label and with the per-position Yield column.
  describe("[POO-898] unclaimed-fees pill (totalEarned) is claimable-only", () => {
    it("[R1] totalEarned excludes the lifetime-collected leg (claimable sum only)", () => {
      const vm = buildPortfolioViewModel(
        [position("s1", 100), position("s2", 300)],
        strategies,
        "en",
        undefined,
        [],
        { "pos-s1": 5, "pos-gone": 40 }, // lifetime collected: must NOT join the pill
      );
      expect(vm.totalEarned).toBe(20); // 10 + 10 claimable only
      expect(vm.totalYield).toBe(65); // the lifetime KPI keeps the collected leg ([R2], POO-714)
    });

    it("[R3] a collect DECREASES the pill by the collected amount while Total yield stays stable", () => {
      const before = buildPortfolioViewModel(
        [position("s1", 100)],
        strategies,
        "en",
        undefined,
        [],
        { "pos-s1": 30 },
      );
      // Collect the 10 available: the claimable leg zeroes, collected grows by exactly +10.
      const collected: Position = { ...position("s1", 100), totalYield: 0 };
      const after = buildPortfolioViewModel([collected], strategies, "en", undefined, [], {
        "pos-s1": 40,
      });
      expect(before.totalEarned).toBe(10);
      expect(after.totalEarned).toBe(0); // pill down by the 10 collected (tracks availability)
      expect(after.totalYield).toBe(before.totalYield); // 40, stable across the collect
    });

    it("[R5] empty positions + empty collected map degrade to $0 (never NaN)", () => {
      const vm = buildPortfolioViewModel([], strategies, "en");
      expect(vm.totalEarned).toBe(0);
      expect(Number.isNaN(vm.totalEarned)).toBe(false);
    });

    it("[R6] the pill equals the sum of the rows' claimable yields (same data family)", () => {
      const vm = buildPortfolioViewModel(
        [position("s1", 100), position("s2", 300)],
        strategies,
        "en",
        undefined,
        [],
        { "pos-s1": 99 }, // a large collected figure must not skew the pill off the rows
      );
      const rowsClaimable = vm.positions.reduce((sum, e) => sum + e.position.totalYield, 0);
      expect(vm.totalEarned).toBe(rowsClaimable);
    });
  });

  // POO-556 [R1] — de-fabricate the hero value series in REAL mode. The 8 hardcoded points
  // [3920..4460] + the live totalValue are a mock design curve; real mode has no per-investor
  // portfolio timeseries yet (analytics `investor_portfolio` is a pending stub, POO-368), so it must
  // render an honest-empty chart (chartData empty → PerformanceChart renders nothing).
  describe("[POO-556 R1] real-mode hero series is honest-empty (never the hardcoded array)", () => {
    it("emits an empty chartData in real mode (mock=false)", () => {
      const vm = buildPortfolioViewModel(
        [position("s1", 100), position("s2", 300)],
        strategies,
        "en",
        false,
      );
      expect(vm.chartData).toEqual([]);
    });

    it("never emits the hardcoded [3920..4460] seed values in real mode (regression lock)", () => {
      const vm = buildPortfolioViewModel([position("s1", 4000)], strategies, "en", false);
      const values = vm.chartData.map((point) => point.value);
      for (const seed of [3920, 3990, 4060, 4010, 4180, 4320, 4290, 4460]) {
        expect(values).not.toContain(seed);
      }
      expect(vm.chartData).toHaveLength(0);
    });

    it("[R2] still fabricates the design-harness series in mock mode (mock=true)", () => {
      const vm = buildPortfolioViewModel([position("s1", 100)], strategies, "en", true);
      // 8 seed points + the live totalValue = 9 plottable points.
      expect(vm.chartData).toHaveLength(9);
      expect(vm.chartData.at(-1)?.value).toBe(100);
    });
  });

  // POO-367 (rules v1): real mode now plots the real per-investor value series (POO-368).
  describe("[POO-367 R1/R3] real-mode hero plots the live investor series", () => {
    const investorSeries = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.parse("2026-06-30T00:00:00.000Z") - (29 - i) * 86_400_000).toISOString(),
      value_usd: 1000 + i,
    }));

    it("[R1] plots the real series (last point = the real series' last value, not totalValue)", () => {
      const vm = buildPortfolioViewModel(
        [position("s1", 4000)],
        strategies,
        "en",
        false,
        investorSeries,
      );
      expect(vm.chartData.length).toBeGreaterThanOrEqual(2);
      expect(vm.chartData.at(-1)?.value).toBe(1029);
      // Never the fabricated seed curve.
      for (const seed of [3920, 3990, 4060, 4010, 4180, 4320, 4290, 4460]) {
        expect(vm.chartData.map((p) => p.value)).not.toContain(seed);
      }
    });

    it("[R3] degrades to honest-empty when the real series has <2 points", () => {
      const single = [{ date: "2026-06-30T00:00:00.000Z", value_usd: 1000 }];
      expect(
        buildPortfolioViewModel([position("s1", 100)], strategies, "en", false, single).chartData,
      ).toEqual([]);
      expect(
        buildPortfolioViewModel([position("s1", 100)], strategies, "en", false, []).chartData,
      ).toEqual([]);
    });

    it("[R5] ignores the investor series in mock mode (harness wins)", () => {
      const vm = buildPortfolioViewModel(
        [position("s1", 100)],
        strategies,
        "en",
        true,
        investorSeries,
      );
      expect(vm.chartData).toHaveLength(9);
      expect(vm.chartData.at(-1)?.value).toBe(100);
    });
  });
});
