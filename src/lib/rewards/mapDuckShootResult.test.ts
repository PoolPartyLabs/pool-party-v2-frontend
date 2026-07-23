/**
 * @id PP-REW (POO-210)
 * @name mapDuckShootResult tests
 * @implements-rules-version v1
 *
 * [R3][R4] Maps the P5 play response to the FE DuckShootResult, deriving
 * hitIndex from the 6-tier board so the animated duck matches the won multiplier.
 */
import { describe, expect, it } from "vitest";
import { mapDuckShootResult } from "./mapDuckShootResult";
import { DUCK_SHOOT_TARGETS } from "./mapRubberRush";

const res = (value: number, quacksAwarded = 1200, triesRemaining = 3) => ({
  outcome: { value, label: `${value}%` },
  quacksAwarded,
  triesRemaining,
});

describe("mapDuckShootResult", () => {
  it("[R3] maps outcome.value, quacksAwarded and triesRemaining", () => {
    const result = mapDuckShootResult(res(300, 1500, 2));
    expect(result.multiplierPct).toBe(300);
    expect(result.quacksWon).toBe(1500);
    expect(result.triesLeft).toBe(2);
  });

  it("[R4] derives hitIndex from the board for each tier", () => {
    expect(mapDuckShootResult(res(10)).hitIndex).toBe(0);
    expect(mapDuckShootResult(res(50)).hitIndex).toBe(1);
    expect(mapDuckShootResult(res(100)).hitIndex).toBe(2);
    expect(mapDuckShootResult(res(150)).hitIndex).toBe(3);
    expect(mapDuckShootResult(res(300)).hitIndex).toBe(4);
    expect(mapDuckShootResult(res(1000)).hitIndex).toBe(5);
  });

  it("[R4] every backend tier has an exact board match", () => {
    for (const value of [10, 50, 100, 150, 300, 1000]) {
      const idx = mapDuckShootResult(res(value)).hitIndex;
      expect(DUCK_SHOOT_TARGETS[idx]?.multiplierPct).toBe(value);
    }
  });

  it("[R4] falls back to hitIndex 0 for an unknown outcome value", () => {
    expect(mapDuckShootResult(res(777)).hitIndex).toBe(0);
  });
});
