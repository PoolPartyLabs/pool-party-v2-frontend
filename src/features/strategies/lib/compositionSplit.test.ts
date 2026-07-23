/**
 * @id PP-STR-LIB-016 (POO-897)
 * @name compositionSplit tests
 * @implements-rules-version v1
 *
 * The Composition card's per-token split degrade chain (POO-897): [R2] reserve value split via
 * positionTokenSplit (invested position first, then the strategy's onchain block), [R3] out-of-range
 * renders 0/100 truthfully, [R4] reserves null -> range math from ticks when available -> null
 * (never fabricated), [R5] a zero-liquidity pool shows the split a new deposit would resolve into.
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { strategyCompositionSplit, tokenSplitFromTicks } from "./compositionSplit";

/** Minimal valid Strategy (no onchain block unless overridden). */
function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: "s1",
    name: "ETH Range",
    manager: "0x1234…abcd",
    riskLevel: 3,
    minInvestment: 10,
    tvl: 100_000,
    investors: 12,
    estReturn: 8.2,
    rateType: "APR",
    status: "active",
    poolPair: { token0: "ETH", token1: "USDC" },
    ...overrides,
  };
}

/** Minimal valid Position (no reserve block unless overridden). */
function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    strategyId: "s1",
    invested: 1000,
    currentValue: 1050,
    totalYield: 50,
    available: 20,
    reinvestment: "manual-payout",
    status: "active",
    ...overrides,
  };
}

// Equal-decimals pair at tick 0 (price 1): 100 units of token0 vs 300 of token1 -> 25/75 by value.
const reserves25_75 = {
  totalSupply0: "100000000",
  totalSupply1: "300000000",
  tickCurrent: 0,
  decimals0: 6,
  decimals1: 6,
};

describe("strategyCompositionSplit", () => {
  // @rule R2: the invested variant reads the position's own reserve block (positionTokenSplit).
  it("[R2] splits by reserve value at the current tick from the invested position", () => {
    const split = strategyCompositionSplit(makeStrategy(), makePosition(reserves25_75));
    expect(split).not.toBeNull();
    expect(split?.pct0).toBeCloseTo(25, 6);
    expect(split?.pct1).toBeCloseTo(75, 6);
  });

  // @rule R2: the non-invested variant reads the strategy's onchain block: the pool split equals
  // the position split, so both variants agree for the same strategy.
  it("[R2] splits from the strategy onchain block when there is no position", () => {
    const split = strategyCompositionSplit(makeStrategy({ onchain: reserves25_75 }), null);
    expect(split?.pct0).toBeCloseTo(25, 6);
    expect(split?.pct1).toBeCloseTo(75, 6);
  });

  // @rule R2: a position without the reserve block still resolves via the strategy's pool reserves.
  it("[R2] falls back to the strategy onchain block when the position carries no reserves", () => {
    const split = strategyCompositionSplit(
      makeStrategy({ onchain: reserves25_75 }),
      makePosition(),
    );
    expect(split?.pct0).toBeCloseTo(25, 6);
    expect(split?.pct1).toBeCloseTo(75, 6);
  });

  // @rule R3: an out-of-range position is single-sided; render 0/100 truthfully.
  it("[R3] renders 0/100 for a single-sided (out-of-range) position", () => {
    const split = strategyCompositionSplit(
      makeStrategy({ onchain: { ...reserves25_75, totalSupply0: "0" } }),
      null,
    );
    expect(split?.pct0).toBe(0);
    expect(split?.pct1).toBe(100);
  });

  // @rule R5: zero deposited liquidity -> the split a NEW deposit would resolve into (range math at
  // the current tick), not null.
  it("[R5] falls back to range math from ticks when both reserves are zero", () => {
    const split = strategyCompositionSplit(
      makeStrategy({
        onchain: {
          totalSupply0: "0",
          totalSupply1: "0",
          tickCurrent: 0,
          tickLower: -1000,
          tickUpper: 1000,
          decimals0: 6,
          decimals1: 6,
        },
      }),
      null,
    );
    // A range symmetric around the current tick splits ~50/50.
    expect(split).not.toBeNull();
    expect(split?.pct0).toBeCloseTo(50, 1);
    expect((split?.pct0 ?? 0) + (split?.pct1 ?? 0)).toBeCloseTo(100, 6);
  });

  // @rule R4: reserves absent -> range math from ticks when available.
  it("[R4] uses range math when the onchain block has ticks but no reserves", () => {
    const split = strategyCompositionSplit(
      makeStrategy({ onchain: { tickCurrent: 0, tickLower: -1000, tickUpper: 1000 } }),
      null,
    );
    expect(split?.pct0).toBeCloseTo(50, 1);
  });

  // @rule R4: nothing usable -> null (the card degrades to the single "Liquidity pool 100%" row).
  it("[R4] returns null when the strategy has no onchain block and no position reserves", () => {
    expect(strategyCompositionSplit(makeStrategy(), null)).toBeNull();
    expect(strategyCompositionSplit(makeStrategy(), makePosition())).toBeNull();
  });

  // @rule R4: a partial/degenerate tick set must NEVER fabricate a 50/50.
  it("[R4] returns null on missing or inverted ticks (never fabricates)", () => {
    expect(
      strategyCompositionSplit(
        makeStrategy({ onchain: { tickCurrent: 0, tickLower: -1000 } }),
        null,
      ),
    ).toBeNull();
    expect(
      strategyCompositionSplit(
        makeStrategy({ onchain: { tickCurrent: 0, tickLower: 1000, tickUpper: -1000 } }),
        null,
      ),
    ).toBeNull();
  });
});

describe("tokenSplitFromTicks", () => {
  // @rule R5: in-range -> the sqrt-price interpolation (decimals cancel in the value ratio).
  it("[R5] splits ~50/50 for a range symmetric around the current tick", () => {
    const split = tokenSplitFromTicks(-1000, 1000, 0);
    expect(split?.pct0).toBeCloseTo(50, 1);
    expect((split?.pct0 ?? 0) + (split?.pct1 ?? 0)).toBeCloseTo(100, 6);
  });

  // @rule R3: current tick outside the range -> single-sided, 100/0 or 0/100.
  it("[R3] is single-sided when the current tick sits outside the range", () => {
    // Price below the range -> a deposit is all token0.
    expect(tokenSplitFromTicks(-1000, 1000, -2000)).toEqual({ pct0: 100, pct1: 0 });
    // Price above the range -> all token1.
    expect(tokenSplitFromTicks(-1000, 1000, 2000)).toEqual({ pct0: 0, pct1: 100 });
  });

  // Full-range tick bounds stay finite in float math and split ~50/50 at tick 0.
  it("handles full-range tick bounds without overflow", () => {
    const split = tokenSplitFromTicks(-887272, 887272, 0);
    expect(split?.pct0).toBeCloseTo(50, 1);
  });

  // @rule R4: missing/invalid ticks -> null, never a fabricated 50/50.
  it("[R4] returns null on missing, non-finite or non-positive-width ticks", () => {
    expect(tokenSplitFromTicks(undefined, 1000, 0)).toBeNull();
    expect(tokenSplitFromTicks(-1000, undefined, 0)).toBeNull();
    expect(tokenSplitFromTicks(-1000, 1000, undefined)).toBeNull();
    expect(tokenSplitFromTicks(1000, 1000, 0)).toBeNull();
    expect(tokenSplitFromTicks(1000, -1000, 0)).toBeNull();
    expect(tokenSplitFromTicks(Number.NaN, 1000, 0)).toBeNull();
  });
});
