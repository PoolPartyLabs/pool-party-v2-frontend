/**
 * @id PP-PORT-LIB-004 (POO-668)
 * @name computeApyAndAllocation tests
 * @implements-rules-version v2
 *
 * The shared pure helper for the two Portfolio figures the backend has no grand aggregate for yet
 * (POO-696): the value-weighted average APY and the allocation-by-risk split. Extracted from the
 * inline math in buildPortfolioViewModel so the mock SSR path and the real active-drain path compute
 * them IDENTICALLY (no divergence). Client-safe + pure (no server-only import).
 *
 * v2 (POO-668): [R3] avgApy + allocation are computed client-side over the wallet's holdings until
 * POO-696 serves them as backend grand aggregates.
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { computeApyAndAllocation } from "./computeApyAndAllocation";
import type { PortfolioViewPosition } from "./PortfolioView";

const strategy = (id: string, riskLevel: number, estReturn: number): Strategy => ({
  id,
  name: `Strategy ${id}`,
  manager: "Pool Party Labs",
  riskLevel,
  minInvestment: 100,
  tvl: 1_000_000,
  investors: 100,
  estReturn,
  rateType: "APY",
  status: "active",
});

const entry = (
  id: string,
  currentValue: number,
  riskLevel: number,
  estReturn: number,
  status: Position["status"] = "active",
): PortfolioViewPosition => ({
  position: {
    id,
    strategyId: id,
    invested: currentValue,
    currentValue,
    totalYield: 0,
    available: currentValue,
    reinvestment: "manual-payout",
    status,
  },
  strategy: strategy(id, riskLevel, estReturn),
});

describe("computeApyAndAllocation", () => {
  // @rule R3: value-weighted average APY = Σ(estReturn × currentValue) / Σ(currentValue).
  it("[R3] computes the value-weighted average APY", () => {
    // 1000 @ 10% + 3000 @ 6% = (100 + 180) / 4000 = 7% weighted.
    const { avgApy } = computeApyAndAllocation([entry("a", 1000, 2, 10), entry("b", 3000, 4, 6)]);
    expect(avgApy).toBeCloseTo(7, 10);
  });

  // @rule R3: allocation-by-risk sums the current value per risk band.
  it("[R3] splits the allocation by risk band (weighted by current value)", () => {
    const { allocation } = computeApyAndAllocation([
      entry("a", 1000, 2, 10),
      entry("b", 3000, 4, 6),
      entry("c", 500, 2, 8),
    ]);
    // Band 2 = 1000 + 500 = 1500; band 4 = 3000 (insertion order preserved from the input).
    expect(allocation).toEqual([
      { level: 2, value: 1500 },
      { level: 4, value: 3000 },
    ]);
  });

  // @rule R3: both figures are non-zero / non-empty when holdings exist (kills the 0%/flat regression).
  it("[R3] yields a non-zero APY and a non-empty allocation for a funded wallet", () => {
    const { avgApy, allocation } = computeApyAndAllocation([entry("a", 1000, 3, 8)]);
    expect(avgApy).toBeGreaterThan(0);
    expect(allocation.length).toBeGreaterThan(0);
  });

  // @rule R3: an empty holdings set degrades to 0 / [] (never NaN from a divide-by-zero).
  it("[R3] degrades to avgApy 0 + empty allocation when there are no positions", () => {
    const { avgApy, allocation } = computeApyAndAllocation([]);
    expect(avgApy).toBe(0);
    expect(allocation).toEqual([]);
  });

  // A zero-total set (all positions worth 0) also degrades safely to 0 rather than dividing by 0.
  it("[R3] degrades to avgApy 0 when the total current value is zero", () => {
    const { avgApy } = computeApyAndAllocation([entry("a", 0, 2, 10)]);
    expect(avgApy).toBe(0);
  });
});
