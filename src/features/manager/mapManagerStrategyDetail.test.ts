/**
 * @id PP-MGR-SCR-004 (POO-304)
 * @name mapManagerStrategyDetail tests
 * @implements-rules-version v1
 *
 * Real core fields + real in/out-of-range; placeholder prices respect the inRange flag.
 */
import { describe, expect, it } from "vitest";
import { tickToPrice } from "@/lib/manager/tickPrice";
import { managerStrategyDetailSchema, type Position } from "@/lib/schemas";
import type { ApiPool } from "@/lib/strategies/poolsSchema";
import { mapManagerStrategyDetail } from "./mapManagerStrategyDetail";

function pool(over: Partial<ApiPool> = {}): ApiPool {
  return {
    positionId: "0xpos",
    name: "Arb USDC Range",
    poolManager: "0xmgr",
    poolTvlUsd: 1234.5,
    feesApr: 18.2,
    totalInvestors: "7",
    closed: false,
    currency0: { symbol: "ETH" },
    currency1: { symbol: "USDC" },
    network: "arbitrum",
    pool: "0xpool",
    poolFeeTier: "0.30%",
    inRange: true,
    totalFeesInUsd: 42,
    ...over,
  };
}

describe("mapManagerStrategyDetail", () => {
  it("maps the real core fields", () => {
    const d = mapManagerStrategyDetail(pool());
    expect(d).toMatchObject({
      id: "0xpos",
      name: "Arb USDC Range",
      aum: 1234.5,
      investors: 7,
      apy: 18.2,
      yieldGenerated: 42,
      feesAllTime: 42,
      status: "active",
    });
    expect(d.pool).toMatchObject({
      token0: "ETH",
      token1: "USDC",
      feeBps: 30,
      networkName: "Arbitrum",
    });
    expect(d.investorStats).toEqual({ total: 7, active: 7 });
  });

  it("never fabricates activity/comments in real mode (served by the backend, POO-380)", () => {
    const d = mapManagerStrategyDetail(pool());
    expect(d.activity).toEqual([]);
    expect(d.comments).toBeUndefined();
  });

  it("sets logoUrl from the threaded catalog logo, undefined when absent (POO-715)", () => {
    // The v1 pool-detail read has no logo, so the caller threads the catalog Strategy's logoUrl in.
    const withLogo = mapManagerStrategyDetail(
      pool(),
      null,
      undefined,
      "https://cdn.example/logo.png",
    );
    expect(withLogo.logoUrl).toBe("https://cdn.example/logo.png");
    // Synth/closed path (no catalog logo passed) → undefined so the header shows the initials monogram.
    expect(mapManagerStrategyDetail(pool()).logoUrl).toBeUndefined();
  });

  // @rule POO-750 R2: the caller threads the v2 catalog's Uniswap NFT token id into detail.pool.
  it("[POO-750] threads the Uniswap NFT token id (nftPositionId) into the pool, undefined when absent", () => {
    const withId = mapManagerStrategyDetail(pool(), null, undefined, undefined, "115990");
    expect(withId.pool.nftPositionId).toBe("115990");
    expect(mapManagerStrategyDetail(pool()).pool.nftPositionId).toBeUndefined();
  });

  it("[POO-820] uses the threaded v2 feesApr (Revert) for apy, falling back to pool.feesApr when absent", () => {
    // The manager loader threads the v2 catalog strategy's estReturn (Revert feesApr) so the detail
    // "Net APR" matches the strategies-list "Est. return" instead of the v1 on-chain pool read.
    const withOverride = mapManagerStrategyDetail(
      pool(),
      null,
      undefined,
      undefined,
      undefined,
      55.9,
    );
    expect(withOverride.apy).toBe(55.9);
    // absent (closed/synth-from-position path) -> falls back to the pool's own feesApr
    expect(mapManagerStrategyDetail(pool()).apy).toBe(18.2);
  });

  // @rule R5 (POO-563): a bare pool with no position (no raw reserve block) leaves allocation
  // undefined so the card hides — the honest behavior is preserved, never placeholder percentages.
  it("[POO-563 R5] leaves allocation undefined when the position lacks reserves (card hides)", () => {
    expect(mapManagerStrategyDetail(pool()).allocation).toBeUndefined();
    expect(
      mapManagerStrategyDetail(pool(), { totalYield: 0 } as Position).allocation,
    ).toBeUndefined();
  });

  // @rule R1 (POO-563): with a real reserve block the Allocation is REAL in V1 — protocols = a single
  // 100% Uniswap v3 row, tokens = the position's percent-of-value split (client-side, no backend).
  it("[POO-563 R1] builds a real single-Uniswap allocation from the position reserves", () => {
    const position = {
      totalSupply0: "24720000000000000000", // 24.72 ETH
      totalSupply1: "51440000000", // 51,440 USDC
      tickCurrent: -195_863,
    } as Position;
    const d = mapManagerStrategyDetail(
      pool({
        currency0: { symbol: "ETH", decimals: 18 },
        currency1: { symbol: "USDC", decimals: 6 },
      }),
      position,
    );
    expect(d.allocation?.protocols).toEqual([{ label: "Uniswap v3", pct: 100 }]);
    expect(d.allocation?.tokens.map((slice) => slice.label)).toEqual(["ETH", "USDC"]);
    const sum = (d.allocation?.tokens ?? []).reduce((acc, slice) => acc + slice.pct, 0);
    expect(sum).toBeCloseTo(100, 9);
    expect(managerStrategyDetailSchema.safeParse(d).success).toBe(true);
  });

  // @rule R2 (POO-563): a single-sided (out-of-range) position renders 100/0 truthfully.
  it("[POO-563 R2] a single-sided position renders 100/0", () => {
    const position = {
      totalSupply0: "24720000000000000000",
      totalSupply1: "0",
      tickCurrent: -195_863,
    } as Position;
    const d = mapManagerStrategyDetail(
      pool({
        currency0: { symbol: "ETH", decimals: 18 },
        currency1: { symbol: "USDC", decimals: 6 },
        inRange: false,
      }),
      position,
    );
    expect(d.allocation?.tokens).toEqual([
      { label: "ETH", pct: 100 },
      { label: "USDC", pct: 0 },
    ]);
  });

  it("[#8] sources the Uniswap link address from dexPoolAddress, not the PP position (`pool`)", () => {
    const d = mapManagerStrategyDetail(
      pool({ pool: "0xPPposition", dexPoolAddress: "0xUniswapPool" }),
    );
    expect(d.pool.address).toBe("0xUniswapPool");
    expect(d.pool.address).not.toBe("0xPPposition");
  });

  it("[#8] leaves the Uniswap link address undefined when dexPoolAddress is absent (mock)", () => {
    const d = mapManagerStrategyDetail(pool({ dexPoolAddress: undefined }));
    expect(d.pool.address).toBeUndefined();
  });

  it("reflects the real in-range flag in the placeholder range", () => {
    const inRange = mapManagerStrategyDetail(pool({ inRange: true }));
    expect(inRange.inRange).toBe(true);
    // current price inside [min, max]
    expect(inRange.range.currentPrice).toBeGreaterThan(inRange.range.minPrice ?? 0);
    expect(inRange.range.currentPrice).toBeLessThan(inRange.range.maxPrice ?? 0);

    const outOfRange = mapManagerStrategyDetail(pool({ inRange: false }));
    expect(outOfRange.inRange).toBe(false);
    // current price outside the band
    expect(outOfRange.range.currentPrice).toBeGreaterThan(outOfRange.range.maxPrice ?? 0);
  });

  it("computes real range prices from ticks + decimals (POO-282)", () => {
    const d = mapManagerStrategyDetail(
      pool({
        currency0: { symbol: "ETH", decimals: 18 },
        currency1: { symbol: "USDC", decimals: 6 },
        tickLower: -201_600,
        tickUpper: -196_200,
        tickCurrent: -198_000,
      }),
    );
    expect(d.range.minPrice).toBeCloseTo(tickToPrice(-201_600, 18, 6), 12);
    expect(d.range.maxPrice).toBeCloseTo(tickToPrice(-196_200, 18, 6), 12);
    expect(d.range.currentPrice).toBeCloseTo(tickToPrice(-198_000, 18, 6), 12);
    // Real on-chain identifiers for move-range (POO-310).
    expect(d.pool).toMatchObject({ network: "arbitrum", decimals0: 18, decimals1: 6 });
    // monotonic + current inside the band (these ticks are in-range)
    expect(d.range.minPrice ?? 0).toBeLessThan(d.range.currentPrice);
    expect(d.range.currentPrice).toBeLessThan(d.range.maxPrice ?? 0);
  });

  it("carries the manager's stake (position value) for the remove preview (POO-312)", () => {
    const d = mapManagerStrategyDetail(pool(), {
      currentValue: 1500,
      totalYield: 0,
    } as unknown as Position);
    expect(d.managerStakeUsd).toBe(1500);
  });

  it("uses the manager position's accrued fees as the claimable proxy", () => {
    const position = { totalYield: 3.5 } as Position;
    expect(mapManagerStrategyDetail(pool(), position).claimableFeesUsd).toBe(3.5);
    expect(mapManagerStrategyDetail(pool(), null).claimableFeesUsd).toBe(0);
  });

  it("[POO-549] claimable = totalYield, parity with the investor detail (ignores uncollectedFeesUsd)", () => {
    // The backend returns uncollectedFeesUSD: 0 for positions that DO have accrued fees, which zeroed
    // the manager "Available to collect" and disabled Collect while the investor showed the fee. The
    // manager now mirrors the investor and uses totalYield (= totalFeesInUsd), so the two never diverge.
    const position = { totalYield: 100, uncollectedFeesUsd: 0 } as Position;
    expect(mapManagerStrategyDetail(pool(), position).claimableFeesUsd).toBe(100);
    const accrued = { totalYield: 0.02, uncollectedFeesUsd: 0 } as Position;
    expect(mapManagerStrategyDetail(pool(), accrued).claimableFeesUsd).toBe(0.02);
  });

  it("produces a schema-valid manage-detail", () => {
    expect(managerStrategyDetailSchema.safeParse(mapManagerStrategyDetail(pool())).success).toBe(
      true,
    );
  });

  // @rule R2 (POO-483 v2 / POO-502): the position's raw reserve block (totalSupply0/1 + tickCurrent)
  // threads into the detail so the manager Remove/Close liquidity leg can split per token.
  it("[POO-502 R2] threads totalSupply0/1 + tickCurrent from the position into the detail", () => {
    const position = {
      totalSupply0: "24720000000000000000",
      totalSupply1: "51440000000",
      tickCurrent: -195_863,
      // decimals come from the pool's currency decimals, not the position (parity with move-range).
    } as Position;
    const d = mapManagerStrategyDetail(
      pool({
        currency0: { symbol: "ETH", decimals: 18 },
        currency1: { symbol: "USDC", decimals: 6 },
      }),
      position,
    );
    expect(d.totalSupply0).toBe("24720000000000000000");
    expect(d.totalSupply1).toBe("51440000000");
    expect(d.tickCurrent).toBe(-195_863);
  });

  // @rule R2 (POO-483 v2 / POO-502): a lean read (no raw block) leaves the fields undefined — never
  // fabricated, so the modal degrades to the honest USD figure (R4).
  it("[POO-502 R2] leaves the raw block undefined when the position lacks it (mock/lean)", () => {
    const withoutBlock = mapManagerStrategyDetail(pool(), { totalYield: 0 } as Position);
    expect(withoutBlock.totalSupply0).toBeUndefined();
    expect(withoutBlock.totalSupply1).toBeUndefined();
    expect(withoutBlock.tickCurrent).toBeUndefined();

    const noPosition = mapManagerStrategyDetail(pool(), null);
    expect(noPosition.totalSupply0).toBeUndefined();
    expect(noPosition.tickCurrent).toBeUndefined();
  });

  it("uses the real analytics performance series + 30d change when provided (POO-366)", () => {
    const performance = {
      "7d": [
        { value: 100, label: "a" },
        { value: 110, label: "b" },
      ],
      "30d": [
        { value: 90, label: "a" },
        { value: 110, label: "b" },
      ],
      "90d": [
        { value: 80, label: "a" },
        { value: 110, label: "b" },
      ],
      all: [
        { value: 50, label: "a" },
        { value: 110, label: "b" },
      ],
    };
    const d = mapManagerStrategyDetail(pool(), null, { performance, aumChangePct: 12.5 });
    expect(d.performance).toEqual(performance);
    expect(d.aumChangePct).toBe(12.5);
    expect(managerStrategyDetailSchema.safeParse(d).success).toBe(true);
  });

  // @rule R1 (POO-558): the real path no longer fabricates a flat 2-point series at current AUM —
  // without analytics the performance is left undefined so the view renders the no-history state
  // instead of a fake flat line indistinguishable from a real flat market.
  it("[POO-558 R1] leaves performance undefined without analytics (no flat mock on the real path)", () => {
    const d = mapManagerStrategyDetail(pool());
    expect(d.performance).toBeUndefined();
    expect(managerStrategyDetailSchema.safeParse(d).success).toBe(true);
  });

  // @rule R2 (POO-558): aumChangePct is number | undefined; absent analytics → undefined so the
  // view renders no pill (no coerced +0.0%).
  it("[POO-558 R2] leaves aumChangePct undefined without analytics (no coerced +0.0%)", () => {
    const d = mapManagerStrategyDetail(pool());
    expect(d.aumChangePct).toBeUndefined();
  });

  // @rule R2/R3: a provided undefined aumChangePct stays undefined (never coerced to 0).
  it("[POO-558 R2] threads aumChangePct through as number | undefined", () => {
    const withChange = mapManagerStrategyDetail(pool(), null, { aumChangePct: -3.1 });
    expect(withChange.aumChangePct).toBe(-3.1);
    const withoutChange = mapManagerStrategyDetail(pool(), null, { performance: undefined });
    expect(withoutChange.aumChangePct).toBeUndefined();
  });
});
