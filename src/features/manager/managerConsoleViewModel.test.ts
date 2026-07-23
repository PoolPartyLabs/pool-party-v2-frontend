/**
 * @id PP-MGR-SCR-001 (POO-224, POO-779, POO-991) · PP-CORE-LIB-049 (POO-991)
 * @name buildManagerConsole tests
 * @implements-rules-version v3 · v1 (POO-991: drop the legacy /analytics/wallets manager read)
 *
 * POO-779 R4 (v3): `strategies` is the already-resolved MANAGED list (the managerWallet-scoped read ∪
 * vanished-but-held recovery — see resolveManagedStrategies.test.ts), so it drives the rows directly.
 * The builder no longer filters by `isPoolManager` or joins a catalog; `positions` is retained ONLY to
 * left-join the claimable-yield sum into `yieldGenerated` (Q3). These tests exercise the KPI derivation,
 * row mapping, spark injection, and the investor-count split over that new contract.
 *
 * PP-CORE-LIB-049 (POO-991, rules-v1): the last v2 legacy `/analytics/wallets/:addr` read
 * (`fetchManagerSummary`, feeding `extras.netInflows30d` / `.perfEarnedUsd` / `.totalInvestorsAllTime`)
 * is removed. The three affected tiles now source from the C1 `/financials` payload (`fin`):
 * - [R1] netInflows30d ← fin.netInflows30d; earnings (total + performance) ← fin.performanceFees
 *   (the all-time field matching the card's "All-time" label, NOT the 30d performanceFees30d);
 *   totalInvestorsAllTime ← fin.totalInvestors.
 * - [R3] honest-NULL: netInflows30d + perfEarnedUsd have NO on-chain Σ, so a null `fin` (or a served
 *   null field) resolves to `null` (the view renders `common.unavailable`), never a fabricated 0 and
 *   never the removed legacy read. totalInvestorsAllTime HAS the on-chain Σ degrade (Σ strategy.investors).
 */
import { describe, expect, it } from "vitest";
import { managerStrategySchema, type Position, type Strategy } from "@/lib/schemas";
import { buildManagerConsole } from "./managerConsoleViewModel";

function strategy(id: string, over: Partial<Strategy> = {}): Strategy {
  return {
    id,
    name: over.name ?? `Strategy ${id}`,
    manager: "0xabc…def",
    riskLevel: over.riskLevel ?? 3,
    minInvestment: 10,
    tvl: over.tvl ?? 1000,
    investors: over.investors ?? 5,
    estReturn: over.estReturn ?? 12,
    rateType: "APR",
    status: over.status ?? "active",
    logoUrl: over.logoUrl,
    uniswapPoolTvlUsd: over.uniswapPoolTvlUsd,
  };
}

/** A held position, keyed to a strategy id, used ONLY for the yieldGenerated left-join now. */
function position(strategyId: string, over: Partial<Position> = {}): Position {
  return {
    id: `pos-${strategyId}`,
    strategyId,
    invested: 100,
    currentValue: 100,
    totalYield: over.totalYield ?? 0,
    available: 100,
    reinvestment: "manual-payout",
    status: over.status ?? "active",
    isPoolManager: over.isPoolManager,
  };
}

const strategies = [
  strategy("s1", { tvl: 1000, investors: 4, estReturn: 10 }),
  strategy("s2", { tvl: 3000, investors: 6, estReturn: 20 }),
];

describe("buildManagerConsole", () => {
  it("[R4] renders exactly the resolved managed strategies as rows", () => {
    const vm = buildManagerConsole([], strategies, "", "");
    expect(vm.strategies.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("[R4] derives the dashboard KPIs from the managed strategies + left-joined yield", () => {
    // yieldGenerated is the claimable-fee sum from the held positions, joined to the rows by id.
    const vm = buildManagerConsole(
      [
        position("s1", { isPoolManager: true, totalYield: 50 }),
        position("s2", { isPoolManager: true, totalYield: 150 }),
      ],
      strategies,
      "",
      "",
    );
    expect(vm.dashboard.aum).toBe(4000); // 1000 + 3000 (strategy tvl)
    expect(vm.dashboard.totalInvestors).toBe(10); // 4 + 6 (strategy investors)
    expect(vm.dashboard.yieldGenerated).toBe(200); // 50 + 150 (position yield, left-joined)
    // tvl-weighted APY: (10*1000 + 20*3000) / 4000
    expect(vm.dashboard.avgApy).toBeCloseTo((10 * 1000 + 20 * 3000) / 4000, 5);
  });

  it("[R4/Q3] a managed strategy with no held position contributes 0 yield, never dropped", () => {
    // Manager fully exited s2 (no position for it), but the scoped read still lists it: it stays a row
    // with 0 yield instead of vanishing.
    const vm = buildManagerConsole(
      [position("s1", { isPoolManager: true, totalYield: 90 })],
      strategies,
      "",
      "",
    );
    expect(vm.strategies.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(vm.dashboard.yieldGenerated).toBe(90); // only s1's position yield; s2 contributes 0
  });

  it("[R4/Q3] sums yield across multiple positions on the same strategy", () => {
    const vm = buildManagerConsole(
      [position("s1", { totalYield: 30 }), position("s1", { totalYield: 20 })],
      [strategy("s1")],
      "",
      "",
    );
    expect(vm.dashboard.yieldGenerated).toBe(50);
  });

  it("[R4] never counts negative yield toward yieldGenerated", () => {
    const vm = buildManagerConsole([position("s1", { totalYield: -25 })], [strategy("s1")], "", "");
    expect(vm.dashboard.yieldGenerated).toBe(0);
  });

  it("maps a manager row and stays schema-valid", () => {
    const vm = buildManagerConsole(
      [],
      [strategy("s2", { tvl: 3000, investors: 6, estReturn: 20 })],
      "",
      "",
    );
    const row = vm.strategies[0];
    expect(row).toMatchObject({ id: "s2", aum: 3000, investors: 6, apy: 20 });
    expect(managerStrategySchema.safeParse(row).success).toBe(true);
  });

  it("carries the manager-uploaded logoUrl from the managed strategy (POO-715)", () => {
    const withLogo = strategy("s-logo", { logoUrl: "https://cdn.example/logo.png" });
    const vm = buildManagerConsole([], [withLogo], "", "");
    expect(vm.strategies[0]?.logoUrl).toBe("https://cdn.example/logo.png");
    // No logo on the strategy → undefined so the card shows the initials monogram.
    const noLogo = buildManagerConsole([], [strategy("s2")], "", "");
    expect(noLogo.strategies[0]?.logoUrl).toBeUndefined();
  });

  it("[R4] yields an empty console for a manager with no strategies (first-run)", () => {
    const vm = buildManagerConsole([], [], "C", "c");
    expect(vm.strategies).toHaveLength(0);
    expect(vm.dashboard.aum).toBe(0);
    expect(vm.dashboard.avgApy).toBe(0);
  });

  it("[POO-455] renders a managed closed strategy in the list", () => {
    // A manager's closed strategy is part of the resolved managed set (scoped read keeps closed rows,
    // or it is recovered via the position fallback upstream), so it still yields a row and the console
    // does not collapse to the first-run empty state.
    const closedStrategy = strategy("s-closed", { status: "closed" });
    const vm = buildManagerConsole([], [...strategies, closedStrategy], "", "");
    expect(vm.strategies.map((s) => s.id)).toEqual(["s1", "s2", "s-closed"]);
    expect(vm.strategies[2]?.status).toBe("closed");
    expect(managerStrategySchema.safeParse(vm.strategies[2]).success).toBe(true);
  });

  it("[POO-390 R3] derives AUM from the managed value (tvl), never the investor pool TVL", () => {
    // Fitness guard: Pool TVL (investor `uniswapPoolTvlUsd`) and AUM (manager) are two distinct numbers
    // and must never re-merge. Even when a strategy carries a much larger pool TVL, the manager console
    // AUM/sparkline/weighted-APY stay bound to `tvl` (the managed position value).
    const withPoolTvl = strategy("s-split", { tvl: 1000, uniswapPoolTvlUsd: 18_300_000 });
    const vm = buildManagerConsole([], [withPoolTvl], "", "");
    expect(vm.dashboard.aum).toBe(1000);
    expect(vm.strategies[0]?.aum).toBe(1000);
    expect(vm.strategies[0]?.spark).toEqual([1000, 1000]);
  });

  // PP-CORE-LIB-049 [R3]: with no financials payload (mock mode / unavailable) the honest-NULL tiles
  // resolve to null (the view renders "not available yet"), NEVER a fabricated 0 and never the removed
  // legacy read. The chart + change % stay their empty/zero defaults; totalInvestorsAllTime degrades
  // to the on-chain Σ (never null).
  it("[R3] leaves netInflows30d + earnings null when no financials payload exists (POO-366/POO-991)", () => {
    const { dashboard } = buildManagerConsole([], strategies, "C", "c");
    expect(dashboard.chart).toEqual([]);
    expect(dashboard.aumChangePct).toBe(0);
    // [R3] honest-NULL: no on-chain Σ for these, so null (never 0, never the removed legacy read).
    expect(dashboard.netInflows30d).toBeNull();
    expect(dashboard.earnings).toEqual({
      totalUsd: null,
      performanceUsd: null,
      entryUsd: 0,
      exitUsd: 0,
    });
    // totalInvestorsAllTime HAS the on-chain Σ degrade (4 + 6), never null.
    expect(dashboard.totalInvestorsAllTime).toBe(10);
  });

  it("[POO-560 R1] sets activeWoWPct to null in real mode (no weekly-active source)", () => {
    const { dashboard } = buildManagerConsole([], strategies, "", "");
    expect(dashboard.activeWoWPct).toBeNull();
  });

  it("[POO-559 R1] injects a real per-row value spark from the sparks map", () => {
    const vm = buildManagerConsole([], [strategy("s2", { tvl: 3000 })], "", "", undefined, {
      sparksById: { s2: { points: [10, 12, 9, 14], measured: true } },
    });
    const row = vm.strategies[0];
    expect(row?.spark).toEqual([10, 12, 9, 14]);
    expect(row?.sparkMeasured).toBe(true);
    expect(managerStrategySchema.safeParse(row).success).toBe(true);
  });

  it("[POO-559 R2] falls back to a not-measured flat placeholder when no real spark exists", () => {
    const vm = buildManagerConsole([], [strategy("s2", { tvl: 3000 })], "", "", undefined, {
      sparksById: {},
    });
    const row = vm.strategies[0];
    expect(row?.spark).toEqual([3000, 3000]);
    expect(row?.sparkMeasured).toBe(false);
    expect(managerStrategySchema.safeParse(row).success).toBe(true);
  });

  it("[POO-559 R2] a measured:false entry is treated as no real spark (flat placeholder)", () => {
    const vm = buildManagerConsole([], [strategy("s2", { tvl: 3000 })], "", "", undefined, {
      sparksById: { s2: { points: [], measured: false } },
    });
    const row = vm.strategies[0];
    expect(row?.spark).toEqual([3000, 3000]);
    expect(row?.sparkMeasured).toBe(false);
  });

  it("[POO-559 R4] keeps fees30d and flows30d at 0 (no windowable source yet)", () => {
    const vm = buildManagerConsole([], [strategy("s2", { tvl: 3000 })], "", "", undefined, {
      sparksById: { s2: { points: [10, 20], measured: true } },
    });
    const row = vm.strategies[0];
    expect(row?.fees30d).toBe(0);
    expect(row?.flows30d).toBe(0);
  });

  // [POO-743 R3/R4] The all-time tile dedups a wallet across strategies and, absent a financials
  // count, degrades to the on-chain current sum (never blanks to 0/null — the visible-regression guard).
  it("[POO-743 R4] degrades the all-time count to the on-chain sum when financials is absent", () => {
    const vm = buildManagerConsole([], strategies, "", "");
    // No financials → falls back to the on-chain Σ (4 + 6 = 10), not 0/null.
    expect(vm.dashboard.totalInvestorsAllTime).toBe(10);
    expect(vm.dashboard.totalInvestors).toBe(10);
  });

  describe("C1 /financials money tiles (PP-CORE-LIB-048 / PP-CORE-LIB-049)", () => {
    function financials(
      overrides: Partial<import("@/lib/financials/financialsSchema").ManagerFinancials> = {},
    ) {
      return {
        address: "0xmgr",
        aum: 500_000,
        aumChange30dPct: 6.5,
        aumCoverage: 1,
        netInflows30d: 12_345,
        yieldGenerated: 67_890,
        performanceFees: 8_900,
        performanceFees30d: 700,
        activeInvestors: 321,
        totalInvestors: 654,
        charts: { aumSeries: [], flowsDaily: [] },
        last_updated: {},
        ...overrides,
      } as import("@/lib/financials/financialsSchema").ManagerFinancials;
    }

    // PP-CORE-LIB-049 [R1]: the three tiles the removed legacy read used to feed now read `fin`:
    // netInflows30d ← fin.netInflows30d; earnings (total + performance) ← fin.performanceFees (the
    // all-time field matching the card's "All-time" label, NOT the 30d performanceFees30d);
    // totalInvestorsAllTime ← fin.totalInvestors. AUM/change %/active investors/yield keep their
    // PP-CORE-LIB-048 wiring.
    it("[R1] sources the three money tiles from fin (netInflows30d / performanceFees / totalInvestors)", () => {
      const vm = buildManagerConsole(
        [position("s1", { totalYield: 999 })],
        strategies,
        "",
        "",
        "0x",
        {
          financials: financials(),
          // The served AUM series plotted (>= 2 points), so the AUM headline + change % read served.
          aumChartFromFinancials: true,
        },
      );
      expect(vm.dashboard.aum).toBe(500_000);
      expect(vm.dashboard.aumChangePct).toBe(6.5);
      // [R1] net inflows from the 30d field.
      expect(vm.dashboard.netInflows30d).toBe(12_345);
      expect(vm.dashboard.yieldGenerated).toBe(67_890);
      // [R1] earnings from the all-time performanceFees (8_900) to match the "All-time" label, NOT the
      // 30d performanceFees30d (700).
      expect(vm.dashboard.earnings.performanceUsd).toBe(8_900);
      expect(vm.dashboard.earnings.totalUsd).toBe(8_900);
      expect(vm.dashboard.totalInvestors).toBe(321); // active (13)
      // [R1] all-time from fin.totalInvestors (14).
      expect(vm.dashboard.totalInvestorsAllTime).toBe(654);
    });

    // POO-936 [R4]: the AUM headline, the 30d change %, and the plotted chart must read the SAME
    // source. The action plots the served series only when it holds >= 2 non-null points; when it is
    // too sparse it plots the LEGACY manager_aum series, so the AUM headline + change % must ALSO fall
    // back to legacy (never a served AUM over a legacy trend line). The view model follows the single
    // `aumChartFromFinancials` decision the action passes.
    describe("[R4] AUM headline + change % follow the plotted chart source", () => {
      it("served chart plots (aumChartFromFinancials true) → AUM + change % read the payload", () => {
        const vm = buildManagerConsole([], strategies, "", "", "0x", {
          financials: financials({ aum: 500_000, aumChange30dPct: 6.5 }),
          aumChartFromFinancials: true,
        });
        expect(vm.dashboard.aum).toBe(500_000);
        expect(vm.dashboard.aumChangePct).toBe(6.5);
      });

      it("served chart too sparse to plot (aumChartFromFinancials false) → AUM + change % fall to legacy", () => {
        // The served payload carries an AUM + change %, but the action could not plot its series (< 2
        // points), so it plotted the legacy manager_aum series. The headline + change % must match it:
        // legacy Σ tvl (1000 + 3000 = 4000) and the legacy `aumChangePct` (not the served 6.5).
        const vm = buildManagerConsole([], strategies, "", "", "0x", {
          aumChangePct: 3, // legacy change % — this is what the legacy chart implies
          financials: financials({ aum: 500_000, aumChange30dPct: 6.5 }),
          aumChartFromFinancials: false,
        });
        expect(vm.dashboard.aum).toBe(4000); // legacy Σ tvl, matches the plotted legacy chart
        expect(vm.dashboard.aumChangePct).toBe(3); // legacy change %, not the served 6.5
      });

      it("[R4] defaulting aumChartFromFinancials (omitted) keeps the AUM headline on legacy", () => {
        // A safety default: without the explicit signal the AUM never assumes the served value over a
        // possibly-legacy chart.
        const vm = buildManagerConsole([], strategies, "", "", "0x", {
          financials: financials({ aum: 500_000 }),
        });
        expect(vm.dashboard.aum).toBe(4000);
      });

      it("the OTHER served money tiles stay served regardless of the chart source", () => {
        // Yield/perf-fees/inflows/investors are independent of the AUM chart, so a sparse AUM series
        // (legacy chart + legacy AUM) does NOT drag them back to legacy.
        const vm = buildManagerConsole([], strategies, "", "", "0x", {
          financials: financials(),
          aumChartFromFinancials: false, // AUM chart on legacy...
        });
        expect(vm.dashboard.aum).toBe(4000); // ...so AUM is legacy
        expect(vm.dashboard.netInflows30d).toBe(12_345); // ...but inflows stay served
        expect(vm.dashboard.yieldGenerated).toBe(67_890); // ...and yield stays served
        expect(vm.dashboard.earnings.performanceUsd).toBe(8_900); // ...and all-time perf fees stay served
      });
    });

    // PP-CORE-LIB-049 [R3]: a served NULL on a tile WITH an on-chain Σ (aum, totalInvestors) degrades
    // to that Σ; a served NULL on netInflows30d / performanceFees (all-time) — which have NO on-chain Σ —
    // resolves to `null` (honest-unavailable), NEVER a fabricated 0 and never the removed legacy read.
    it("[R3] a served NULL degrades to the on-chain Σ where one exists, else to honest null", () => {
      const vm = buildManagerConsole([], strategies, "", "", "0x", {
        financials: financials({
          aum: null,
          netInflows30d: null,
          yieldGenerated: null,
          performanceFees: null,
          performanceFees30d: null,
          aumChange30dPct: null,
          activeInvestors: 0,
          totalInvestors: 0,
        }),
      });
      // aum null → the legacy Σ tvl (1000 + 3000 = 4000); change % null → 0.
      expect(vm.dashboard.aum).toBe(4000);
      expect(vm.dashboard.aumChangePct).toBe(0);
      // [R3] no on-chain Σ for these → honest null (NOT 0).
      expect(vm.dashboard.netInflows30d).toBeNull();
      expect(vm.dashboard.earnings.totalUsd).toBeNull();
      expect(vm.dashboard.earnings.performanceUsd).toBeNull();
      // totalInvestors served 0 (a real count) stays 0; totalInvestorsAllTime served 0 stays 0
      // (a served 0 is a real value, only a served NULL would degrade to the on-chain Σ).
      expect(vm.dashboard.totalInvestors).toBe(0);
      expect(vm.dashboard.totalInvestorsAllTime).toBe(0);
    });

    // PP-CORE-LIB-049 [R3]: with the financials payload absent (null: mock mode / unavailable) the
    // honest-NULL tiles resolve to null and totalInvestorsAllTime degrades to the on-chain Σ — the
    // legacy `extras.netInflows30d`/`.perfEarnedUsd`/`.totalInvestorsAllTime` inputs are GONE.
    it("[R3] no financials payload (null) → honest-null tiles + on-chain-Σ totalInvestorsAllTime", () => {
      const vm = buildManagerConsole([], strategies, "", "", "0x", { financials: null });
      expect(vm.dashboard.netInflows30d).toBeNull();
      expect(vm.dashboard.earnings.totalUsd).toBeNull();
      expect(vm.dashboard.earnings.performanceUsd).toBeNull();
      expect(vm.dashboard.totalInvestorsAllTime).toBe(10); // on-chain Σ (4 + 6)
    });

    // PP-CORE-LIB-049 [R3]: totalInvestorsAllTime degrades to the on-chain Σ when the payload is null
    // OR fin.totalInvestors is served null.
    it("[R3] totalInvestorsAllTime degrades to the on-chain Σ when fin.totalInvestors is served null", () => {
      const vm = buildManagerConsole([], strategies, "", "", "0x", {
        // @ts-expect-error the schema types totalInvestors as a number; a served null models the
        // absent-source degrade the FE must tolerate (the wire is null-tolerant per field).
        financials: financials({ totalInvestors: null }),
      });
      expect(vm.dashboard.totalInvestorsAllTime).toBe(10); // Σ strategy.investors (4 + 6)
    });
  });
});
