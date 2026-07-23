import { describe, expect, it } from "vitest";
import { strategySchema } from "@/lib/schemas";
import { strategies } from "./strategies";

describe("strategies mock data", () => {
  it("has every entry pass the Strategy schema parse", () => {
    for (const strategy of strategies) {
      expect(() => strategySchema.parse(strategy)).not.toThrow();
    }
  });

  it("has unique ids across all entries", () => {
    const ids = strategies.map((strategy) => strategy.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("spans every risk band 1 through 5", () => {
    const riskLevels = new Set(strategies.map((strategy) => strategy.riskLevel));
    expect(riskLevels).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("includes at least one paused strategy to exercise that state", () => {
    expect(strategies.some((strategy) => strategy.status === "paused")).toBe(true);
  });

  // POO-905 R2: mock rows serve the realistic protocol fee rate (0.25%, the live PROTOCOL_FEE
  // constant), so mock mode exercises the exact pre-build estimate path real mode renders.
  it("[POO-905 R2] serves protocolFeePct 0.25 on every entry", () => {
    for (const strategy of strategies) {
      expect(strategy.protocolFeePct).toBe(0.25);
    }
  });
});
