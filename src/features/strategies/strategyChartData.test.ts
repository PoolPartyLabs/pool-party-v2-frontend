/**
 * @id PP-STR-SCR-002 (POO-300)
 * @name buildStrategyChartData tests
 * @implements-rules-version v1
 *
 * Owned → invested→currentValue series; discovery → projection from estReturn.
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { buildStrategyChartData } from "./strategyChartData";

const strategy = {
  id: "s1",
  name: "S1",
  manager: "0xabc…def",
  riskLevel: 3,
  minInvestment: 10,
  tvl: 1000,
  investors: 5,
  estReturn: 10,
  rateType: "APR",
  status: "active",
} as Strategy;

const position = {
  id: "p1",
  strategyId: "s1",
  invested: 100,
  currentValue: 120,
  totalYield: 20,
  available: 120,
  reinvestment: "auto-compound",
  status: "active",
} as Position;

describe("buildStrategyChartData", () => {
  it("owned: series runs from invested to currentValue", () => {
    const data = buildStrategyChartData(position, strategy, "en");
    expect(data).toHaveLength(9);
    expect(data.at(0)?.value).toBe(100);
    expect(data.at(-1)?.value).toBe(120);
  });

  it("discovery (no position): projects from estReturn", () => {
    const data = buildStrategyChartData(null, strategy, "en");
    expect(data.at(0)?.value).toBe(100);
    expect(data.at(-1)?.value).toBe(110); // 100 * (1 + 10/100)
  });
});
