/**
 * @id PP-MGR-SCR-004 (POO-537)
 * @name synthesizeApiPoolFromPosition tests
 * @implements-rules-version v1
 *
 * Builds a minimal ApiPool from a held position's synth descriptor so a manager's closed strategy
 * resolves a read-only manage detail; returns null when the position lacks the descriptor.
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { synthesizeApiPoolFromPosition } from "./synthesizeApiPoolFromPosition";

// Only the fields the synth reads matter; cast keeps the fixtures free of unrelated schema coupling.
const descriptor = {
  id: "0xclosed",
  name: "ETH/USDC LP",
  manager: "0x1234…abcd",
  tvl: 0,
  investors: 3,
  estReturn: 12.5,
  rateType: "APR",
  status: "closed",
  network: "arbitrum",
  poolPair: { token0: "WETH", token1: "USDC" },
} as unknown as Strategy;

function position(over: Partial<Position> = {}): Position {
  return {
    strategyId: "0xclosed",
    decimals0: 18,
    decimals1: 6,
    tickCurrent: 12345,
    fallbackStrategy: descriptor,
    ...over,
  } as unknown as Position;
}

describe("synthesizeApiPoolFromPosition", () => {
  it("builds an ApiPool from the held position's synth descriptor (POO-537)", () => {
    expect(synthesizeApiPoolFromPosition(position())).toMatchObject({
      positionId: "0xclosed",
      name: "ETH/USDC LP",
      closed: true,
      network: "arbitrum",
      poolTvlUsd: 0,
      feesApr: 12.5,
      totalInvestors: 3,
      currency0: { symbol: "WETH", decimals: 18 },
      currency1: { symbol: "USDC", decimals: 6 },
      tickCurrent: 12345,
    });
  });

  it("returns null when the position carries no synth descriptor (can't resolve)", () => {
    expect(synthesizeApiPoolFromPosition(position({ fallbackStrategy: undefined }))).toBeNull();
  });

  it("reflects an active descriptor as closed=false", () => {
    const active = { ...(descriptor as object), status: "active" } as unknown as Strategy;
    expect(synthesizeApiPoolFromPosition(position({ fallbackStrategy: active }))?.closed).toBe(
      false,
    );
  });

  it("omits enrichment-only fields with no source on a wound-down pool (degrade, never fabricate)", () => {
    const pool = synthesizeApiPoolFromPosition(position());
    expect(pool?.poolFeeTier).toBeUndefined();
    expect(pool?.dexPoolAddress).toBeUndefined();
    expect(pool?.tickLower).toBeUndefined();
    expect(pool?.totalFeesInUsd).toBeUndefined();
  });
});
