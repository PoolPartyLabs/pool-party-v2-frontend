/** @id PP-CP-LIB-003 @name Cash+ illustrative economics @implements-rules-version v1 */
import Decimal from "decimal.js";

const Money = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN });
export const DEFAULT_COMPARISON = {
  nav: "1000000",
  lendingAllocation: "95",
  lendingRate: "4",
  annualVolume: "40000000",
  grossMarginBps: "5",
  variableCostBps: "2",
  fixedCosts: "4000",
  performanceFee: "20",
  benchmarkRate: "4",
};
export type CashPlusComparisonInput = typeof DEFAULT_COMPARISON;
export function calculateCashPlusComparison(input: CashPlusComparisonInput) {
  const number = (key: keyof CashPlusComparisonInput, max?: number) => {
    const raw = input[key];
    if (raw.length > 100 || !/^\d+(\.\d+)?$/.test(raw)) throw new Error("ASSUMPTION_INVALID");
    const value = new Money(raw);
    if (!value.isFinite() || value.isNegative() || (max !== undefined && value.gt(max)))
      throw new Error("ASSUMPTION_INVALID");
    return value;
  };
  const nav = number("nav");
  if (nav.isZero()) throw new Error("ASSUMPTION_INVALID");
  const allocation = number("lendingAllocation", 100).div(100);
  const lendingRate = number("lendingRate", 100).div(100);
  const benchmarkRate = number("benchmarkRate", 100);
  const performanceRate = number("performanceFee", 100).div(100);
  const volume = number("annualVolume");
  const margin = number("grossMarginBps", 10000).minus(number("variableCostBps", 10000)).div(10000);
  const interest = nav.mul(allocation).mul(lendingRate);
  const conversionNet = volume.mul(margin);
  const prePerformanceResult = interest.plus(conversionNet).minus(number("fixedCosts"));
  const benchmarkResult = nav.mul(benchmarkRate).div(100);
  const performanceFeeAmount = Money.max(0, prePerformanceResult.minus(benchmarkResult)).mul(
    performanceRate,
  );
  const investorResult = prePerformanceResult.minus(performanceFeeAmount);
  const investorRate = investorResult.div(nav).mul(100);
  const plain = (value: Decimal) => value.toDecimalPlaces(12).toFixed();
  return {
    interest: plain(interest),
    conversionNet: plain(conversionNet),
    prePerformanceResult: plain(prePerformanceResult),
    performanceFeeAmount: plain(performanceFeeAmount),
    investorResult: plain(investorResult),
    investorRate: plain(investorRate),
    benchmarkResult: plain(benchmarkResult),
    benchmarkRate: plain(benchmarkRate),
    excessPercentagePoints: plain(investorRate.minus(benchmarkRate)),
    additionalReturnPercent: benchmarkResult.isZero()
      ? null
      : plain(investorResult.minus(benchmarkResult).div(benchmarkResult).mul(100)),
  };
}
