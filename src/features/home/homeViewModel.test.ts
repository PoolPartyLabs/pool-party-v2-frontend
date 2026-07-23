/**
 * @id PP-DASH-SCR-001 (POO-299)
 * @name buildHomeViewModel tests
 * @implements-rules-version v1
 *
 * [R3] join + summary; [R4] empty positions → zero summary; dropped-when-unmatched.
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { positions as mockPositions, positionFeesEarned } from "@/mocks/data/positions";
import { strategies as mockStrategies } from "@/mocks/data/strategies";
import { buildHomeViewModel } from "./homeViewModel";

function strategy(id: string, estReturn: number): Strategy {
  return {
    id,
    name: `Strategy ${id}`,
    manager: "0xabc…def",
    riskLevel: 3,
    minInvestment: 10,
    tvl: 1000,
    investors: 5,
    estReturn,
    rateType: "APR",
    status: "active",
  };
}

function position(
  strategyId: string,
  invested: number,
  currentValue: number,
  yield_: number,
): Position {
  return {
    id: `pos-${strategyId}`,
    strategyId,
    invested,
    currentValue,
    totalYield: yield_,
    available: currentValue,
    reinvestment: "auto-compound",
    status: "active",
  };
}

const strategies = [strategy("s1", 10), strategy("s2", 20), strategy("s3", 30)];

describe("buildHomeViewModel", () => {
  it("[R3] joins positions to strategies and sums the summary", () => {
    const vm = buildHomeViewModel(
      [position("s1", 100, 120, 20), position("s2", 200, 230, 30)],
      strategies,
      "en",
    );
    expect(vm.positions).toHaveLength(2);
    expect(vm.totalValue).toBe(350);
    expect(vm.invested).toBe(300);
    expect(vm.totalYield).toBe(50);
    // value-weighted APY: (10*120 + 20*230) / 350
    expect(vm.avgApy).toBeCloseTo((10 * 120 + 20 * 230) / 350, 5);
  });

  it("[POO-832 R6] Invested is the Σ of per-position cost basis, DISTINCT from Current value (never mirrors)", () => {
    // Home computes both KPIs client-side over the full position set, so — unlike the Portfolio KPI
    // header (POO-832) — its Invested has always summed the per-position `invested`, not the balance.
    // Lock it: Invested must equal the invested column exactly and differ from Current value.
    const vm = buildHomeViewModel(
      [position("s1", 100, 120, 20), position("s2", 200, 230, 30)],
      strategies,
      "en",
    );
    expect(vm.invested).toBe(300); // 100 + 200 (cost basis), NOT 350 (Σ current value)
    expect(vm.totalValue).toBe(350); // Home's Current value = Σ per-position currentValue
    expect(vm.invested).not.toBe(vm.totalValue);
  });

  it("[R3] drops positions whose strategy is not in the catalog and have no fallback", () => {
    const vm = buildHomeViewModel([position("missing", 100, 120, 20)], strategies, "en");
    expect(vm.positions).toHaveLength(0);
    expect(vm.totalValue).toBe(0);
  });

  it("[POO-526 R1] resolves a catalog-absent closed holding via its fallbackStrategy (no undercount)", () => {
    // A closed pool is absent from /pools, so without the fallback the holding — and its value — would
    // silently drop out of the Home summary.
    const synth: Strategy = { ...strategy("s-gone", 12), status: "closed", name: "Pool de teste" };
    const closed: Position = {
      ...position("s-gone", 100, 250, 8),
      status: "closed",
      fallbackStrategy: synth,
    };
    const vm = buildHomeViewModel([position("s1", 100, 120, 20), closed], strategies, "en");
    expect(vm.positions).toHaveLength(2);
    expect(vm.totalValue).toBe(370); // 120 + 250, the closed holding is counted
    expect(vm.positions.some((e) => e.strategy.name === "Pool de teste")).toBe(true);
    // A synthesized closed strategy must never leak into the investable discovery feed.
    expect(vm.discover.map((s) => s.id)).not.toContain("s-gone");
  });

  it("[R3] discover excludes owned strategies", () => {
    const vm = buildHomeViewModel([position("s1", 100, 120, 20)], strategies, "en");
    expect(vm.discover.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("[POO-455] discover excludes closed strategies (holdings catalog includes them)", () => {
    // Home now resolves positions against the all-status holdings catalog, so closed strategies
    // reach the view model; they must never appear as investable in the discovery feed.
    const withClosed: Strategy[] = [
      strategy("s1", 10),
      { ...strategy("s2", 20), status: "closed" },
      strategy("s3", 30),
    ];
    const vm = buildHomeViewModel([], withClosed, "en");
    expect(vm.discover.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("[R4] empty positions → zero summary, all strategies in discover", () => {
    const vm = buildHomeViewModel([], strategies, "en");
    expect(vm.totalValue).toBe(0);
    expect(vm.avgApy).toBe(0);
    expect(vm.positions).toHaveLength(0);
    expect(vm.discover).toHaveLength(3);
  });

  it("[POO-345] sums position earnings for earnedToday (24h) and thisMonth (30d)", () => {
    const vm = buildHomeViewModel(
      [position("s1", 100, 120, 20), position("s2", 200, 230, 30)],
      strategies,
      "en",
      {
        "pos-s1": { "24h": 1.5, "7d": 8, "30d": 40 },
        "pos-s2": { "24h": -0.5, "7d": 2, "30d": 12 },
      },
    );
    expect(vm.earnedToday).toBeCloseTo(1, 5); // 1.5 + (-0.5)
    expect(vm.thisMonth).toBeCloseTo(52, 5); // 40 + 12
  });

  it("[POO-345] empty positions → earnedToday and thisMonth are 0", () => {
    const vm = buildHomeViewModel([], strategies, "en", {});
    expect(vm.earnedToday).toBe(0);
    expect(vm.thisMonth).toBe(0);
  });

  it("[POO-345] a position with no earnings entry contributes 0 (?? 0 fallback)", () => {
    const vm = buildHomeViewModel([position("s1", 100, 120, 20)], strategies, "en", {});
    expect(vm.positions).toHaveLength(1);
    expect(vm.earnedToday).toBe(0);
    expect(vm.thisMonth).toBe(0);
  });

  // POO-430 rules-v3: Home consumes the accrued-value delta, whose windows can be NULL (no 24h-ago
  // reference yet). A null window must contribute 0 (honest-empty), never be counted or crash.
  it("[POO-430 R3'] a null 24h/30d window contributes 0 (null coalesces like a missing entry)", () => {
    const vm = buildHomeViewModel([position("s1", 100, 120, 20)], strategies, "en", {
      "pos-s1": { "24h": null, "7d": 5, "30d": null },
    });
    expect(vm.earnedToday).toBe(0);
    expect(vm.thisMonth).toBe(0);
  });

  it("[POO-430 R1'] sums only the non-null accrued windows across positions", () => {
    const vm = buildHomeViewModel(
      [position("s1", 100, 120, 20), position("s2", 200, 230, 30)],
      strategies,
      "en",
      {
        "pos-s1": { "24h": 2.5, "7d": 8, "30d": 40 },
        "pos-s2": { "24h": null, "7d": 2, "30d": 12 }, // pos-s2 has no 24h reference yet
      },
    );
    expect(vm.earnedToday).toBeCloseTo(2.5, 5); // 2.5 + 0 (null)
    expect(vm.thisMonth).toBeCloseTo(52, 5); // 40 + 12
  });

  // POO-896 (rules v1) + PP-CORE-LIB-048 (POO-990): "Earned today" / "Last 30 days" in the MOCK harness
  // sum the non-negative mock feesEarned table. The legacy FE `Math.max` clamp was REMOVED: real mode
  // reads the C1 /financials payload, whose serving layer already floors these ≥ 0 (financialsSchema
  // D5/A4), and the mock table is non-negative by construction — so there is nothing left to clamp on
  // the mock path.
  describe("[POO-896] mock Earned today / Last 30 days sum the non-negative mock table", () => {
    it("[R3] missing entries and null windows still sum to an honest 0 for BOTH windows", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20), position("s2", 200, 230, 30)],
        strategies,
        "en",
        { "pos-s1": { "24h": null, "7d": null, "30d": null } }, // pos-s2 entirely missing
      );
      expect(vm.earnedToday).toBe(0);
      expect(vm.thisMonth).toBe(0);
    });

    it("sums the per-position windows (no FE clamp — the mock table is non-negative)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20), position("s2", 200, 230, 30)],
        strategies,
        "en",
        {
          "pos-s1": { "24h": 0.5, "7d": 1, "30d": 10 },
          "pos-s2": { "24h": 1.5, "7d": 2, "30d": 12 },
        },
      );
      expect(vm.earnedToday).toBeCloseTo(2, 5); // 0.5 + 1.5
      expect(vm.thisMonth).toBeCloseTo(22, 5); // 10 + 12
    });

    it("[R6] the mock default is the fee-plausible feesEarned table (non-negative KPIs)", () => {
      // No earningsById argument → the builder must default to positionFeesEarned (fees semantics),
      // not the legacy share-card earnings table (which deliberately runs a negative 24h window).
      const vm = buildHomeViewModel(mockPositions, mockStrategies, "en");
      const expected24h = mockPositions.reduce(
        (sum, p) => sum + (positionFeesEarned[p.id]?.["24h"] ?? 0),
        0,
      );
      const expected30d = mockPositions.reduce(
        (sum, p) => sum + (positionFeesEarned[p.id]?.["30d"] ?? 0),
        0,
      );
      expect(vm.earnedToday).toBeCloseTo(expected24h, 5);
      expect(vm.thisMonth).toBeCloseTo(expected30d, 5);
      expect(vm.earnedToday).toBeGreaterThan(0);
      expect(vm.thisMonth).toBeGreaterThan(0);
    });
  });

  // POO-714 (rules v1): the "Total Yield" KPI is a LIFETIME figure — all-time COLLECTED fees
  // (investor-net, from the analytics metrics map) + currently AVAILABLE (claimable) fees — not the
  // claimable-only figure that shrank on every collect. The collected map is summed over ALL its
  // keys, so positions the wallet fully exited still count (decision 2026-07-14).
  describe("[POO-714] Total Yield = lifetime collected + available", () => {
    it("[R1] adds the lifetime collected fees to the claimable sum", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20), position("s2", 200, 230, 30)],
        strategies,
        "en",
        {},
        undefined,
        [],
        { "pos-s1": 15, "pos-s2": 5 },
      );
      // (20 + 30) available + (15 + 5) collected all-time.
      expect(vm.totalYield).toBeCloseTo(70, 5);
    });

    it("[R1] includes collected fees of EXITED positions (map keys not in the current portfolio)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        {},
        undefined,
        [],
        // pos-gone: a position the wallet fully exited — absent from the portfolio read, but its
        // lifetime collected fees are still yield the wallet earned.
        { "pos-s1": 15, "pos-gone": 40 },
      );
      expect(vm.totalYield).toBeCloseTo(75, 5); // 20 + 15 + 40
    });

    it("[R2] a collect moves value between legs and leaves Total Yield unchanged (invariant)", () => {
      const before = buildHomeViewModel(
        [position("s1", 100, 120, 12.5)],
        strategies,
        "en",
        {},
        undefined,
        [],
        { "pos-s1": 30 },
      );
      // Simulate the collect: the available leg zeroes (-12.5), collected grows by exactly +12.5.
      const after = buildHomeViewModel(
        [position("s1", 100, 120, 0)],
        strategies,
        "en",
        {},
        undefined,
        [],
        { "pos-s1": 42.5 },
      );
      expect(before.totalYield).toBeCloseTo(42.5, 5);
      expect(after.totalYield).toBeCloseTo(before.totalYield ?? Number.NaN, 5);
    });

    it("[R4] an omitted/empty collected map degrades to the claimable-only figure (never NaN)", () => {
      const omitted = buildHomeViewModel([position("s1", 100, 120, 20)], strategies, "en");
      expect(omitted.totalYield).toBe(20);
      expect(Number.isNaN(omitted.totalYield)).toBe(false);
      const empty = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        {},
        undefined,
        [],
        {},
      );
      expect(empty.totalYield).toBe(20);
    });
  });

  // POO-556 [R1] — de-fabricate the hero value series in REAL mode. The per-investor portfolio
  // timeseries does not exist yet (analytics `investor_portfolio` is a `{ note: pending }` stub,
  // POO-368), so real mode must render an honest-empty chart (every period an empty series →
  // PerformanceChart renders nothing), NOT a fabricated sine/derived curve.
  describe("[POO-556 R1] real-mode hero series is honest-empty (never fabricated)", () => {
    it("emits an empty series for every period in real mode (mock=false)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20), position("s2", 200, 230, 30)],
        strategies,
        "en",
        undefined,
        false,
      );
      // Every selectable period is present but empty (< 2 points → chart renders nothing).
      const periods = Object.values(vm.seriesByPeriod);
      expect(periods.length).toBeGreaterThan(0);
      for (const series of periods) {
        expect(series).toEqual([]);
      }
    });

    it("does not derive any point from totalValue in real mode (no last-point leak)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        undefined,
        false,
      );
      const allValues = Object.values(vm.seriesByPeriod).flat();
      expect(allValues).toHaveLength(0);
    });

    it("[R2] still fabricates the design-harness series in mock mode (mock=true)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        undefined,
        true,
      );
      // The mock harness keeps a plottable series per period (>= 2 points), ending at totalValue.
      for (const series of Object.values(vm.seriesByPeriod)) {
        expect(series.length).toBeGreaterThanOrEqual(2);
      }
      const monthSeries = vm.seriesByPeriod.month;
      expect(monthSeries.at(-1)?.value).toBe(120);
    });
  });

  // POO-367 (rules v1): real mode wires the per-investor value series (POO-368) into the hero.
  describe("[POO-367 R1/R4] real-mode hero series from the live investor timeseries", () => {
    const investorSeries = Array.from({ length: 40 }, (_, i) => ({
      date: new Date(Date.parse("2026-06-30T00:00:00.000Z") - (39 - i) * 86_400_000).toISOString(),
      value_usd: 100 + i,
    }));

    it("[R1] plots the real per-investor series, tipped with the live total (POO-716)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        undefined,
        false,
        investorSeries,
      );
      // The month period plots the REAL points, then a synthetic "now" tip == totalValue (120) so the
      // chart ends at the big number (POO-716). The real points are preserved (append, no mutation):
      // the last real value (139) sits just before the tip.
      expect(vm.seriesByPeriod.month.length).toBeGreaterThanOrEqual(2);
      expect(vm.seriesByPeriod.month.at(-1)?.value).toBe(120);
      expect(vm.seriesByPeriod.month.at(-2)?.value).toBe(139);
    });

    it("[R4] leaves the day (1D) period empty (no hourly grain from a daily series)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        undefined,
        false,
        investorSeries,
      );
      expect(vm.seriesByPeriod.day).toEqual([]);
      // The wider periods are plottable.
      expect(vm.seriesByPeriod.all.length).toBeGreaterThanOrEqual(2);
    });

    it("[R3] falls back to honest-empty when the real series is empty (no history yet)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        undefined,
        false,
        [],
      );
      for (const series of Object.values(vm.seriesByPeriod)) {
        expect(series).toEqual([]);
      }
    });

    it("[R5] ignores the investor series in mock mode (mock harness wins)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        undefined,
        true,
        investorSeries,
      );
      // Mock harness: every period plottable and month ends at totalValue, not the real series.
      expect(vm.seriesByPeriod.month.at(-1)?.value).toBe(120);
    });
  });

  describe("Home previews (POO-671)", () => {
    const closedPos = (id: string): Position => ({
      ...position(id, 10, 10, 0),
      status: "closed",
    });

    it("[R1] caps the discovery preview at 3 (non-closed, non-owned)", () => {
      const many = Array.from({ length: 8 }, (_, i) => strategy(`d${i}`, 10));
      const vm = buildHomeViewModel([], many, "en");
      expect(vm.discover).toHaveLength(3);
    });

    it("[R2] caps positions at 3, CLOSED first (stable); KPIs stay over the FULL set", () => {
      const strats = Array.from({ length: 7 }, (_, i) => strategy(`p${i}`, 10));
      // 2 closed (p2, p4) interleaved among 5 active, in this order.
      const raw = [
        position("p0", 10, 10, 0),
        position("p1", 10, 10, 0),
        closedPos("p2"),
        position("p3", 10, 10, 0),
        closedPos("p4"),
        position("p5", 10, 10, 0),
        position("p6", 10, 10, 0),
      ];
      const vm = buildHomeViewModel(raw, strats, "en");
      expect(vm.positions).toHaveLength(3);
      // Closed first in their original relative order (p2, p4), then the first active (p0).
      expect(vm.positions.map((e) => e.position.id)).toEqual(["pos-p2", "pos-p4", "pos-p0"]);
      // KPIs aggregate all 7, not the sliced 3.
      expect(vm.totalValue).toBe(70);
      expect(vm.invested).toBe(70);
    });

    it("[R2] 5 closed positions → 3 closed", () => {
      const strats = Array.from({ length: 5 }, (_, i) => strategy(`c${i}`, 10));
      const raw = [0, 1, 2, 3, 4].map((i) => closedPos(`c${i}`));
      const vm = buildHomeViewModel(raw, strats, "en");
      expect(vm.positions).toHaveLength(3);
      expect(vm.positions.every((e) => e.position.status === "closed")).toBe(true);
    });

    it("[R3] fewer than 3 available → shows what exists (no padding)", () => {
      const vm = buildHomeViewModel([position("s1", 10, 10, 0)], strategies, "en");
      expect(vm.positions).toHaveLength(1);
    });
  });

  // PP-CORE-LIB-048 (POO-990): in REAL mode (mock=false) the money KPIs read the C1 /financials payload
  // EXCLUSIVELY — no per-position earnings sum, no cross-backend collected join, no wallet-level totals.
  // A served NULL (or a NULL payload = financials unavailable) threads through as null so the tile
  // renders "not available yet", never $0 and never a legacy figure. The mock-only earnings/collected
  // args are IGNORED on the real path.
  describe("[PP-CORE-LIB-048] real mode reads the C1 /financials payload exclusively", () => {
    function financials(
      overrides: Partial<import("@/lib/financials/financialsSchema").WalletFinancials> = {},
    ) {
      return {
        address: "0xabc",
        earnedToday: 5,
        feesEarned: { "24h": 5, "7d": 40, "30d": 100 },
        invested: 9000,
        totalYield: 777,
        portfolioValue: 9777,
        claimableGross: 42,
        coverage: 1,
        provisional: false,
        byStrategy: {},
        last_updated: {},
        ...overrides,
      } as import("@/lib/financials/financialsSchema").WalletFinancials;
    }

    it("sources Invested/yield/fees from the payload; Current Value from the pp_api position sum", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        { "pos-s1": { "24h": 1, "30d": 2 } }, // mock earnings — MUST be ignored in real mode
        false, // REAL mode
        [],
        { "pos-s1": 999 }, // mock collected leg — MUST be ignored in real mode
        financials(),
      );
      expect(vm.invested).toBe(9000);
      expect(vm.totalYield).toBe(777); // the SAME field Portfolio reads (identical values)
      expect(vm.earnedToday).toBe(5);
      expect(vm.thisMonth).toBe(100);
      // Current Value = pp_api Σ currentValue (source of truth), NOT financials.portfolioValue (9777).
      expect(vm.totalValue).toBe(120);
    });

    it("[R5] threads a served NULL through as null (the tile renders unavailable, never $0)", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        {},
        false,
        [],
        {},
        financials({
          earnedToday: null,
          invested: null,
          totalYield: null,
          feesEarned: { "24h": null, "7d": null, "30d": null },
        }),
      );
      expect(vm.earnedToday).toBeNull();
      expect(vm.invested).toBeNull();
      expect(vm.totalYield).toBeNull();
      expect(vm.thisMonth).toBeNull();
    });

    it("an UNAVAILABLE financials read (null payload) renders the money KPIs as null, never a legacy figure", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 120, 20)],
        strategies,
        "en",
        { "pos-s1": { "24h": 1, "30d": 2 } }, // mock args present — MUST NOT leak into real KPIs
        false, // REAL mode
        [],
        { "pos-s1": 50 },
        null, // financials unavailable (outage / not-signed-in)
      );
      expect(vm.earnedToday).toBeNull();
      expect(vm.invested).toBeNull();
      expect(vm.totalYield).toBeNull();
      expect(vm.thisMonth).toBeNull();
    });

    it("[R2] Current Value is ALWAYS the pp_api position sum, ignoring financials.portfolioValue", () => {
      const vm = buildHomeViewModel(
        [position("s1", 100, 300, 20)],
        strategies,
        "en",
        {},
        false,
        [],
        {},
        financials({ portfolioValue: 9777 }), // a DIFFERENT analytics value — must be IGNORED for Current Value
      );
      expect(vm.totalValue).toBe(300); // Σ currentValue (pp_api sum), NOT portfolioValue
    });
  });
});
