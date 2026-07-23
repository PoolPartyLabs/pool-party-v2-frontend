import { describe, expect, it } from "vitest";
import { positionSchema } from "@/lib/schemas";
import { exitedPositions, positionCollectedFees, positionFeesEarned, positions } from "./positions";
import { strategies } from "./strategies";

describe("positions mock data", () => {
  it("has every entry pass the Position schema parse", () => {
    for (const position of positions) {
      expect(() => positionSchema.parse(position)).not.toThrow();
    }
  });

  // @rule R4 — mock fixtures provide openedAt (real mode leaves it undefined until POO-641).
  it("gives every position a positive-integer openedAt (epoch ms)", () => {
    for (const position of positions) {
      expect(position.openedAt).toBeDefined();
      expect(Number.isInteger(position.openedAt)).toBe(true);
      expect(position.openedAt).toBeGreaterThan(0);
    }
  });

  it("references only known strategy ids", () => {
    const strategyIds = new Set(strategies.map((strategy) => strategy.id));
    for (const position of positions) {
      expect(strategyIds.has(position.strategyId)).toBe(true);
    }
  });

  it("reconciles to the funded reference portfolio ($3,920 → $4,532.50, +$612.50)", () => {
    const sum = (key: "invested" | "currentValue" | "totalYield") =>
      positions.reduce((total, position) => total + position[key], 0);
    expect(sum("invested")).toBeCloseTo(3920, 2);
    expect(sum("currentValue")).toBeCloseTo(4532.5, 2);
    expect(sum("totalYield")).toBeCloseTo(612.5, 2);
    // current value == invested + yield
    expect(sum("currentValue")).toBeCloseTo(sum("invested") + sum("totalYield"), 2);
  });

  // POO-714 (rules v1): the mock metrics source models LIFETIME collected fees (investor-net) so the
  // mock "Total Yield" KPI behaves like real mode: collected + available, incl. exited positions.
  it("[POO-714 R1] models non-negative lifetime collected fees keyed by known position ids", () => {
    const knownIds = new Set([...positions, ...exitedPositions].map((position) => position.id));
    for (const [id, collected] of Object.entries(positionCollectedFees)) {
      expect(knownIds.has(id)).toBe(true);
      expect(collected).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(collected)).toBe(true);
    }
  });

  it("[POO-714 R1] covers the fully-exited position (its lifetime yield still counts)", () => {
    expect(positionCollectedFees["pos-eth-momentum-exited"]).toBeGreaterThan(0);
  });

  // POO-896 (rules v1): the mock feesEarned table feeds Home "Earned today" / "Last 30 days" in mock
  // mode. [R6] fees are non-negative by nature (unlike the share-card net-earnings table, which keeps
  // a deliberate negative for the LOSS variant) and fee-plausible against each position's scale.
  it("[POO-896 R6] models fee-plausible, NON-NEGATIVE feesEarned windows for every live position", () => {
    const liveIds = new Set(positions.map((position) => position.id));
    // Every live position has an entry (Home sums over held positions), and no unknown keys.
    for (const id of liveIds) expect(positionFeesEarned[id]).toBeDefined();
    for (const [id, windows] of Object.entries(positionFeesEarned)) {
      expect(liveIds.has(id)).toBe(true);
      for (const window of ["24h", "7d", "30d"] as const) {
        expect(Number.isFinite(windows[window])).toBe(true);
        expect(windows[window]).toBeGreaterThanOrEqual(0);
      }
      // Nested rolling windows of a non-negative fee stream are monotone: 24h <= 7d <= 30d.
      expect(windows["24h"]).toBeLessThanOrEqual(windows["7d"]);
      expect(windows["7d"]).toBeLessThanOrEqual(windows["30d"]);
    }
  });
});
