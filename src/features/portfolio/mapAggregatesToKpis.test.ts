/**
 * @id PP-PORT-LIB-003 (POO-668, POO-990)
 * @name mapAggregatesToKpis tests
 * @implements-rules-version v3 (POO-898 rules v1)
 *
 * The KPI-aggregate → PortfolioView scalar-props mapping (POO-668 R3). REAL-MODE ONLY. The hero /
 * pill / apy KPIs come from the pp_api GRAND aggregates (correctly incl. closed-with-funds), never over
 * the paged/loaded set; avgApy + allocation-by-risk fall back to a client-side computation over the
 * loaded active rows until POO-696 serves them as grand aggregates. POO-898: the "unclaimed fees" pill
 * (totalEarned) is claimable-only.
 *
 * PP-CORE-LIB-048 (POO-990): `invested` and `totalYield` come from the C1 `/financials` payload
 * EXCLUSIVELY (the 3rd, now-required arg). A null payload → both render null ("not available yet",
 * never $0, never a legacy figure); the legacy `invested ?? balance` fallback + the `collectedById`
 * cross-backend Total-Yield join were removed.
 */
import { describe, expect, it } from "vitest";
import type { WalletFinancials } from "@/lib/financials/financialsSchema";
import type { PortfolioAggregates } from "@/lib/portfolio/positionsSchema";
import type { ApyAndAllocation } from "./computeApyAndAllocation";
import { mapAggregatesToKpis } from "./mapAggregatesToKpis";

const agg: PortfolioAggregates = {
  totalBalanceUsd: 4532.5,
  claimableFeesUsd: 120.4,
  totalFeesInUsd: 612.5,
  totalPerformanceFeesInUsd: 88.2,
};

const computed: ApyAndAllocation = {
  avgApy: 7.4,
  allocation: [
    { level: 2, value: 1500 },
    { level: 4, value: 3032.5 },
  ],
};

/** A C1 investor financials payload; overrides let a test pin the served money fields. */
function financials(overrides: Partial<WalletFinancials> = {}): WalletFinancials {
  return {
    address: "0xabc",
    earnedToday: 5,
    feesEarned: { "24h": 5, "7d": 40, "30d": 100 },
    invested: 3000,
    totalYield: 777,
    portfolioValue: 5000,
    claimableGross: 42,
    coverage: 1,
    provisional: false,
    byStrategy: {},
    last_updated: {},
    ...overrides,
  } as WalletFinancials;
}

describe("mapAggregatesToKpis", () => {
  it("[R3] maps the pp_api grand balance onto totalValue + currentValue (pp_api = the source of truth)", () => {
    // Current Value is ALWAYS the pp_api on-chain sum of positions (the real value held now).
    const kpis = mapAggregatesToKpis(agg, computed, null);
    expect(kpis.totalValue).toBe(4532.5);
    expect(kpis.currentValue).toBe(4532.5);
  });

  it("[R3] maps claimable fees onto the hero pill (totalEarned)", () => {
    const kpis = mapAggregatesToKpis(agg, computed, null);
    expect(kpis.totalEarned).toBe(120.4);
  });

  it("[R3] the pill falls back to totalFeesInUsd when claimableFeesUsd is 0/absent (POO-569 alias)", () => {
    const kpis = mapAggregatesToKpis({ ...agg, claimableFeesUsd: 0 }, computed, null);
    expect(kpis.totalEarned).toBe(612.5);
  });

  it("[R3] carries the COMPUTED avgApy + allocation through (no more 0/[] hardcode — kills the regression)", () => {
    const kpis = mapAggregatesToKpis(agg, computed, null);
    expect(kpis.avgApy).toBe(7.4);
    expect(kpis.allocation).toEqual([
      { level: 2, value: 1500 },
      { level: 4, value: 3032.5 },
    ]);
  });

  it("[R3] a funded wallet with holdings shows a non-zero APY + a non-empty allocation", () => {
    const kpis = mapAggregatesToKpis(
      agg,
      { avgApy: 8.1, allocation: [{ level: 3, value: 4532.5 }] },
      null,
    );
    expect(kpis.avgApy).toBeGreaterThan(0);
    expect(kpis.allocation.length).toBeGreaterThan(0);
  });

  it("[R3] an empty-holdings computed input still degrades to 0 / [] (no positions)", () => {
    const kpis = mapAggregatesToKpis(agg, { avgApy: 0, allocation: [] }, null);
    expect(kpis.avgApy).toBe(0);
    expect(kpis.allocation).toEqual([]);
  });

  it("[R3] zeroed aggregates yield zeroed balance/fees KPIs (never NaN)", () => {
    const kpis = mapAggregatesToKpis(
      {
        totalBalanceUsd: 0,
        claimableFeesUsd: 0,
        totalFeesInUsd: 0,
        totalPerformanceFeesInUsd: 0,
      },
      { avgApy: 0, allocation: [] },
      null,
    );
    expect(kpis.totalValue).toBe(0);
    expect(kpis.totalEarned).toBe(0);
  });
});

/**
 * POO-696 (FE consumption): the backend serves the grand `avgApr` + `allocation` aggregates, so the
 * KPIs prefer them (read straight from the aggregate). The client-side active-holdings computation is
 * KEPT as the fallback (deploy-order-independent). A backend 0 / [] is a real value and must NOT trigger
 * fallback (nullish check). `aggregates.allocation` is already mapped to the internal {level,value} shape.
 */
describe("mapAggregatesToKpis: backend grand avgApr/allocation aggregates (POO-696)", () => {
  it("[R4] prefers the backend grand avgApr + allocation over the client-computed values", () => {
    const kpis = mapAggregatesToKpis(
      { ...agg, avgApr: 9.9, allocation: [{ level: 5, value: 4532.5 }] },
      computed, // 7.4 / [level 2, level 4] — must be IGNORED when the aggregate has them
      null,
    );
    expect(kpis.avgApy).toBe(9.9);
    expect(kpis.allocation).toEqual([{ level: 5, value: 4532.5 }]);
  });

  it("[R4] respects a backend avgApr of 0 / allocation of [] (a real value, not 'absent')", () => {
    const kpis = mapAggregatesToKpis({ ...agg, avgApr: 0, allocation: [] }, computed, null);
    expect(kpis.avgApy).toBe(0);
    expect(kpis.allocation).toEqual([]);
  });

  it("[R4] falls back to the client-computed avgApy + allocation when the aggregate omits them", () => {
    // `agg` carries no avgApr/allocation → the client-computed values flow through unchanged.
    const kpis = mapAggregatesToKpis(agg, computed, null);
    expect(kpis.avgApy).toBe(7.4);
    expect(kpis.allocation).toEqual(computed.allocation);
  });
});

/**
 * POO-898 (rules v1): the hero "unclaimed fees" pill (totalEarned) is the CLAIMABLE aggregate ONLY
 * (available to collect now, C1 served preferred, pp_api grand aggregate as the non-null fallback), with
 * no lifetime-collected leg, so the pill agrees with its label and with the per-position Yield column.
 */
describe("mapAggregatesToKpis: unclaimed-fees pill is claimable-only (POO-898)", () => {
  it("[R1] totalEarned = the claimable aggregate only (no collected leg joins it)", () => {
    const kpis = mapAggregatesToKpis(agg, computed, null);
    expect(kpis.totalEarned).toBe(120.4); // claimable only
  });

  it("[R1] the pill still falls back to the deprecated totalFeesInUsd alias (POO-569)", () => {
    const kpis = mapAggregatesToKpis({ ...agg, claimableFeesUsd: 0 }, computed, null);
    expect(kpis.totalEarned).toBe(612.5);
  });

  it("[R1] the C1 served claimable is preferred over the pp_api aggregate", () => {
    const kpis = mapAggregatesToKpis(agg, computed, financials({ claimableGross: 42 }));
    expect(kpis.totalEarned).toBe(42); // financials.claimableGross wins
  });

  it("[R5] zeroed aggregates + a null payload degrade the pill to $0 (never NaN)", () => {
    const kpis = mapAggregatesToKpis(
      {
        totalBalanceUsd: 0,
        claimableFeesUsd: 0,
        totalFeesInUsd: 0,
        totalPerformanceFeesInUsd: 0,
      },
      { avgApy: 0, allocation: [] },
      null,
    );
    expect(kpis.totalEarned).toBe(0);
    expect(Number.isNaN(kpis.totalEarned)).toBe(false);
  });
});

/**
 * PP-CORE-LIB-048 (POO-990): Invested + Total yield read the C1 `/financials` payload EXCLUSIVELY (the
 * SAME totalYield field Home reads). A served NULL — or a null payload (financials unavailable) — renders
 * the KPI as null ("not available yet"), never a legacy figure. The hero total + pill fall to the pp_api
 * grand aggregate (a non-legacy current-value source) when the C1 field is null, so they never blank.
 */
describe("mapAggregatesToKpis: Invested + Total yield from C1 /financials (PP-CORE-LIB-048)", () => {
  it("sources invested + totalYield + pill from the payload; Current Value from pp_api (source-of-truth split)", () => {
    const kpis = mapAggregatesToKpis(
      { ...agg, totalInvestedUsd: 111 }, // a pp_api cost-basis field — MUST NOT drive invested
      computed,
      financials(),
    );
    expect(kpis.invested).toBe(3000); // financials.invested (analytics ledger), not totalInvestedUsd nor the balance
    expect(kpis.totalYield).toBe(777); // financials.totalYield (analytics)
    // Current Value = pp_api on-chain sum (source of truth), NOT financials.portfolioValue (5000).
    expect(kpis.totalValue).toBe(4532.5); // agg.totalBalanceUsd
    expect(kpis.currentValue).toBe(4532.5); // agg.totalBalanceUsd
    expect(kpis.totalEarned).toBe(42); // financials.claimableGross (the pill, still C1-preferred)
  });

  it("Portfolio totalYield equals the field Home reads (identical served value)", () => {
    const served = financials({ totalYield: 654.32 });
    const kpis = mapAggregatesToKpis(agg, computed, served);
    expect(kpis.totalYield).toBe(served.totalYield);
  });

  it("[R5] threads a served NULL through as null (KPI renders unavailable, never $0)", () => {
    const kpis = mapAggregatesToKpis(
      agg,
      computed,
      financials({ invested: null, totalYield: null, portfolioValue: null, claimableGross: null }),
    );
    expect(kpis.invested).toBeNull();
    expect(kpis.totalYield).toBeNull();
    // A null hero/pill keeps the pp_api aggregate (a figure) so the hero + pill still render.
    expect(kpis.totalValue).toBe(agg.totalBalanceUsd);
    expect(kpis.totalEarned).toBe(agg.claimableFeesUsd);
  });

  it("an UNAVAILABLE financials read (null payload) renders invested + totalYield as null, never a legacy figure", () => {
    const kpis = mapAggregatesToKpis({ ...agg, totalInvestedUsd: 111 }, computed, null);
    expect(kpis.invested).toBeNull(); // NOT totalInvestedUsd, NOT the balance
    expect(kpis.totalYield).toBeNull(); // NOT the claimable aggregate
    // The non-nullable hero + pill still render off the pp_api aggregate (never blanked).
    expect(kpis.totalValue).toBe(agg.totalBalanceUsd);
    expect(kpis.totalEarned).toBe(agg.claimableFeesUsd);
  });
});
