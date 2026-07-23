/**
 * @id PP-PORT-LIB-002 (POO-668)
 * @name joinPositionsToStrategies tests
 * @implements-rules-version v1
 *
 * The shared position→strategy join used by the paged Portfolio reads (active + closed). It resolves
 * each position to a strategy via the holdings catalog, then the position's own synthesized
 * fallbackStrategy (POO-526), and PRESERVES the incoming order (no re-sort — the backend order is
 * authoritative, POO-668 R2). A position with neither match is dropped (never fabricated data).
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { joinPositionsToStrategies } from "./joinPositionsToStrategies";

const strategy = (id: string, over: Partial<Strategy> = {}): Strategy => ({
  id,
  name: `Strategy ${id}`,
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 7,
  rateType: "APY",
  status: "active",
  ...over,
});

const position = (id: string, strategyId: string, over: Partial<Position> = {}): Position => ({
  id,
  strategyId,
  invested: 100,
  currentValue: 100,
  totalYield: 1,
  available: 100,
  reinvestment: "manual-payout",
  status: "closed",
  ...over,
});

describe("joinPositionsToStrategies", () => {
  it("joins each position to its holdings-catalog strategy", () => {
    const positions = [position("p1", "s1")];
    const result = joinPositionsToStrategies(positions, [strategy("s1")]);
    expect(result).toEqual([{ position: positions[0], strategy: strategy("s1") }]);
  });

  it("[R2] preserves the incoming order (no re-sort)", () => {
    const positions = [position("p1", "s1"), position("p2", "s2"), position("p3", "s3")];
    const result = joinPositionsToStrategies(positions, [
      strategy("s1"),
      strategy("s2"),
      strategy("s3"),
    ]);
    expect(result.map((e) => e.position.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("[POO-526] falls back to the position's own fallbackStrategy when the catalog misses", () => {
    const synth = strategy("s-gone", { status: "closed" });
    const orphan = position("p1", "s-gone", { fallbackStrategy: synth });
    const result = joinPositionsToStrategies([orphan], []);
    expect(result).toEqual([{ position: orphan, strategy: synth }]);
  });

  it("drops a position with neither a catalog match nor a fallback (no fabricated data)", () => {
    const ghost = position("p1", "s-missing");
    const result = joinPositionsToStrategies([ghost], []);
    expect(result).toEqual([]);
  });
});
