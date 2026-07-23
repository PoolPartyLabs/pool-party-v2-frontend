import { describe, expect, it } from "vitest";
import type { UniswapPool } from "@/lib/schemas";
import { deriveMandate } from "./deriveMandate";

const pool = (token0: string, token1: string): UniswapPool => ({
  id: "x",
  network: "base",
  networkName: "Base",
  token0,
  token1,
  feeBps: 5,
  tvlUsd: 1,
  aprPct: 1,
  currentPrice: 1,
  address: "0x0000000000000000000000000000000000000000",
  token0Address: "0x0000000000000000000000000000000000000001",
  token1Address: "0x0000000000000000000000000000000000000002",
});

describe("deriveMandate", () => {
  it("rates a stablecoin pair very conservative", () => {
    expect(deriveMandate(pool("USDC", "USDT"), 20)).toEqual({
      riskLevel: 1,
      categoryKey: "stable",
    });
  });

  it("rates a stable + blue-chip pair moderate, adjusted by range width", () => {
    expect(deriveMandate(pool("ETH", "USDC"), 20)).toEqual({
      riskLevel: 3,
      categoryKey: "blueChip",
    });
    // A tight range raises the risk a notch; a full range lowers it.
    expect(deriveMandate(pool("ETH", "USDC"), 5).riskLevel).toBe(4);
    expect(deriveMandate(pool("ETH", "USDC"), null).riskLevel).toBe(2);
  });

  it("rates a non-major pair aggressive", () => {
    expect(deriveMandate(pool("ARB", "USDC"), 20)).toEqual({
      riskLevel: 4,
      categoryKey: "volatile",
    });
  });
});
