/** @id PP-CP-LIB-003 @name Cash+ comparison rules @implements-rules-version v1 */
import { describe, expect, it } from "vitest";
import { calculateCashPlusComparison, DEFAULT_COMPARISON } from "./comparison";

describe("Cash+ illustrative comparison", () => {
  // @rule R5: fee is charged only on positive excess over the benchmark.
  it("reconciles the disclosed $1m example without claiming 12% APY", () => {
    const result = calculateCashPlusComparison(DEFAULT_COMPARISON);
    expect(result).toMatchObject({
      interest: "38000",
      conversionNet: "12000",
      prePerformanceResult: "46000",
      performanceFeeAmount: "1200",
      investorResult: "44800",
      investorRate: "4.48",
      benchmarkResult: "40000",
      benchmarkRate: "4",
      excessPercentagePoints: "0.48",
      additionalReturnPercent: "12",
    });
  });
  // @rule R6: lower demand can underperform and must not produce a performance fee.
  it.each([
    ["0", "3.4"],
    ["10000000", "3.7"],
    ["20000000", "4"],
  ])("models volume %s honestly", (annualVolume, investorRate) => {
    const result = calculateCashPlusComparison({ ...DEFAULT_COMPARISON, annualVolume });
    expect(result.investorRate).toBe(investorRate);
    expect(result.performanceFeeAmount).toBe("0");
  });
  it("does not divide by a zero benchmark", () => {
    expect(
      calculateCashPlusComparison({ ...DEFAULT_COMPARISON, benchmarkRate: "0" })
        .additionalReturnPercent,
    ).toBeNull();
  });
  it("allows a negative investment result and rejects invalid assumptions", () => {
    expect(
      calculateCashPlusComparison({ ...DEFAULT_COMPARISON, fixedCosts: "100000" }).investorResult,
    ).toBe("-50000");
    expect(() => calculateCashPlusComparison({ ...DEFAULT_COMPARISON, nav: "0" })).toThrow();
    expect(() =>
      calculateCashPlusComparison({ ...DEFAULT_COMPARISON, lendingAllocation: "101" }),
    ).toThrow();
    expect(() =>
      calculateCashPlusComparison({ ...DEFAULT_COMPARISON, annualVolume: "-1" }),
    ).toThrow();
  });
});
