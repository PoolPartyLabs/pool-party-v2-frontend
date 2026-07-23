/**
 * @id PP-STR (POO-216)
 * @name mapPosition tests
 * @implements-rules-version v2
 *
 * [R2] Maps a pool-party-api portfolio position to the FE Position (pool = strategy;
 * id = positionId; currentValue = totalBalanceUsd; totalYield = totalFeesInUsd). POO-719
 * (rules-v2): `invested` prefers the ledger cost basis `investedUsd`, falling back to the
 * displayed balance when null/absent (R10v2).
 */
import { describe, expect, it } from "vitest";
import { positionSchema } from "@/lib/schemas";
import { mapPosition } from "./mapPosition";

const row = (
  over: {
    totalBalanceUsd?: number;
    totalBalanceWithRefundUsd?: number;
    investedUsd?: number | null;
    totalFeesInUsd?: number;
    claimableFeesUsd?: number;
    uncollectedFeesUSD?: number;
    closed?: boolean;
    isPoolManager?: boolean;
    fees0?: string;
    fees1?: string;
    currency0?: { symbol: string; decimals: number };
    currency1?: { symbol: string; decimals: number };
    totalSupply0?: string;
    totalSupply1?: string;
    tickCurrent?: number;
    name?: string;
    poolManager?: string;
    feesApr?: number;
    poolTvlUsd?: number;
    totalInvestors?: string;
    network?: string;
  } = {},
) => ({
  totalBalanceUsd: over.totalBalanceUsd ?? 3.7566020969739045,
  totalBalanceWithRefundUsd: over.totalBalanceWithRefundUsd,
  investedUsd: over.investedUsd,
  totalFeesInUsd: over.totalFeesInUsd ?? 0.14937997372079542,
  claimableFeesUsd: over.claimableFeesUsd,
  feesInfo:
    over.uncollectedFeesUSD !== undefined
      ? { uncollectedFeesUSD: over.uncollectedFeesUSD }
      : undefined,
  isPoolManager: over.isPoolManager,
  fees0: over.fees0,
  fees1: over.fees1,
  poolPartyPosition: {
    positionId: "0x27df56f3182fd6714595b1ce108f5d14430bca4c23f9659a3dad0b951075faa7",
    closed: over.closed ?? false,
    currency0: over.currency0,
    currency1: over.currency1,
    totalSupply0: over.totalSupply0,
    totalSupply1: over.totalSupply1,
    tickCurrent: over.tickCurrent,
    name: over.name,
    poolManager: over.poolManager,
    feesApr: over.feesApr,
    poolTvlUsd: over.poolTvlUsd,
    totalInvestors: over.totalInvestors,
    network: over.network,
  },
});

/** Both per-token fee legs present (ETH/USDC pair) for the claimableFeeTokens cases. */
const pairOver = {
  fees0: "50000000000000000", // 0.05 ETH (18 decimals)
  currency0: { symbol: "ETH", decimals: 18 },
  fees1: "140400000", // 140.4 USDC (6 decimals)
  currency1: { symbol: "USDC", decimals: 6 },
};

describe("mapPosition", () => {
  it("[R2] maps id and strategyId to the positionId (pool = strategy)", () => {
    const p = mapPosition(row());
    expect(p.id).toBe("0x27df56f3182fd6714595b1ce108f5d14430bca4c23f9659a3dad0b951075faa7");
    expect(p.strategyId).toBe(p.id);
  });

  // @rule POO-719 rules-v2: invested = ledger cost basis when served; balance fallback per R10v2.
  it("[POO-719] maps invested to the ledger cost basis investedUsd when present", () => {
    const p = mapPosition(row({ totalBalanceUsd: 3.76, investedUsd: 2.5 }));
    expect(p.invested).toBe(2.5);
    expect(p.currentValue).toBe(3.76); // currentValue stays the displayed balance
  });

  it("[POO-719 R10v2] falls back to the balance when investedUsd is null (legacy pre-backfill)", () => {
    const p = mapPosition(row({ totalBalanceUsd: 3.76, investedUsd: null }));
    expect(p.invested).toBe(3.76);
  });

  it("[POO-719 R10v2] falls back to the balance when investedUsd is absent (older backend)", () => {
    const p = mapPosition(row({ totalBalanceUsd: 3.76 }));
    expect(p.invested).toBe(3.76);
    expect(p.currentValue).toBe(3.76);
  });

  it("[POO-719] a true ledger 0 (full exit) is served as 0, not swapped for the balance", () => {
    const p = mapPosition(row({ totalBalanceUsd: 3.76, investedUsd: 0 }));
    expect(p.invested).toBe(0);
  });

  it("[R2] maps totalYield and available", () => {
    const p = mapPosition(row({ totalBalanceUsd: 10, totalFeesInUsd: 0.15 }));
    expect(p.totalYield).toBe(0.15); // "Total fees"
    expect(p.available).toBe(10); // full balance withdrawable (flagged)
  });

  // @rule POO-367 R7 (POO-569 additive rename): prefer claimableFeesUsd, fall back to the deprecated
  // totalFeesInUsd alias — safe whether or not pp_api has been redeployed.
  it("[R7] prefers claimableFeesUsd for totalYield when present", () => {
    // A redeployed pp_api emits both (same value); an in-flight one might briefly differ — prefer new.
    const p = mapPosition(row({ totalFeesInUsd: 0.15, claimableFeesUsd: 0.42 }));
    expect(p.totalYield).toBe(0.42);
  });

  it("[R7] falls back to totalFeesInUsd when claimableFeesUsd is absent (pp_api not yet redeployed)", () => {
    const p = mapPosition(row({ totalFeesInUsd: 0.15 })); // no claimableFeesUsd
    expect(p.totalYield).toBe(0.15);
  });

  it("[R2] derives status from closed", () => {
    expect(mapPosition(row({ closed: false })).status).toBe("active");
    expect(mapPosition(row({ closed: true })).status).toBe("closed");
  });

  it("[R2] defaults reinvestment to manual-payout (flagged)", () => {
    expect(mapPosition(row()).reinvestment).toBe("manual-payout");
  });

  it("[POO-224] carries isPoolManager (defaults false when absent)", () => {
    expect(mapPosition(row({ isPoolManager: true })).isPoolManager).toBe(true);
    expect(mapPosition(row()).isPoolManager).toBe(false);
  });

  it("[POO-318] prefers totalBalanceWithRefundUsd for balance/value/available when present", () => {
    const p = mapPosition(row({ totalBalanceUsd: 10, totalBalanceWithRefundUsd: 12.5 }));
    expect(p.currentValue).toBe(12.5);
    // no investedUsd in this row -> invested falls back to the refund-aware balance (R10v2)
    expect(p.invested).toBe(12.5);
    expect(p.available).toBe(12.5);
  });

  it("[POO-318] falls back to totalBalanceUsd when the refund-aware balance is absent", () => {
    expect(mapPosition(row({ totalBalanceUsd: 10 })).currentValue).toBe(10);
  });

  it("[POO-318] maps uncollectedFeesUsd from feesInfo (absent → undefined)", () => {
    expect(mapPosition(row({ uncollectedFeesUSD: 0.42 })).uncollectedFeesUsd).toBe(0.42);
    expect(mapPosition(row()).uncollectedFeesUsd).toBeUndefined();
  });

  it("[POO-417 R3/R5] maps fees0/fees1 + currency decimals to claimableFeeTokens (raw / 10^decimals)", () => {
    const p = mapPosition(row(pairOver));
    expect(p.claimableFeeTokens).toEqual([
      { symbol: "ETH", amount: 0.05 },
      { symbol: "USDC", amount: 140.4 },
    ]);
  });

  it("[POO-417 R6c] leaves claimableFeeTokens undefined when per-token data is absent", () => {
    expect(mapPosition(row()).claimableFeeTokens).toBeUndefined();
    // Partial data (amount without its currency meta) is not enough → undefined, never NaN.
    expect(mapPosition(row({ fees0: "1", fees1: "1" })).claimableFeeTokens).toBeUndefined();
  });

  it("[POO-417 R6b] renders both legs with the zero side as 0 (one-sided fees)", () => {
    const p = mapPosition(row({ ...pairOver, fees1: "0" }));
    expect(p.claimableFeeTokens).toEqual([
      { symbol: "ETH", amount: 0.05 },
      { symbol: "USDC", amount: 0 },
    ]);
  });

  it("produces a schema-valid Position (with and without the per-token breakdown)", () => {
    expect(positionSchema.safeParse(mapPosition(row())).success).toBe(true);
    expect(positionSchema.safeParse(mapPosition(row(pairOver))).success).toBe(true);
  });

  it("[POO-437] carries the raw on-chain state for the legacy move-range (supplies, tick, decimals)", () => {
    const p = mapPosition(
      row({
        ...pairOver,
        totalSupply0: "46581381556109034188",
        totalSupply1: "1000000",
        tickCurrent: -301_500,
      }),
    );
    expect(p.totalSupply0).toBe("46581381556109034188");
    expect(p.totalSupply1).toBe("1000000");
    expect(p.tickCurrent).toBe(-301_500);
    expect(p.decimals0).toBe(18); // from currency0 (ETH in pairOver)
    expect(p.decimals1).toBe(6); // from currency1 (USDC)
  });

  it("[POO-437] leaves the legacy on-chain state undefined when the API omits it", () => {
    const p = mapPosition(row());
    expect(p.totalSupply0).toBeUndefined();
    expect(p.totalSupply1).toBeUndefined();
    expect(p.tickCurrent).toBeUndefined();
    expect(p.decimals0).toBeUndefined();
    expect(p.decimals1).toBeUndefined();
  });

  it("[POO-526] attaches a fallbackStrategy synthesized from the pool descriptor (closed holding)", () => {
    // The holdings catalog (/pools) excludes closed pools, so a closed holding needs its own
    // real-data fallback to survive the Portfolio join (R1/R2).
    const p = mapPosition(
      row({
        closed: true,
        name: "Pool de teste",
        poolManager: "0xBb7433F0F9EBc996Aa15269cA08a0De3cF1AFab1",
        currency0: { symbol: "ETH", decimals: 18 },
        currency1: { symbol: "USDC", decimals: 6 },
        feesApr: 12.5,
      }),
    );
    expect(p.fallbackStrategy).toMatchObject({
      id: p.strategyId,
      name: "Pool de teste",
      status: "closed",
      riskLevel: 3,
      estReturn: 12.5,
    });
  });

  it("[POO-526] leaves fallbackStrategy undefined on a lean row without a pool descriptor", () => {
    expect(mapPosition(row()).fallbackStrategy).toBeUndefined();
  });
});
