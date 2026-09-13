/** @id PP-CP-LIB-002 @name Cash+ amount rules @implements-rules-version v1 */
import { describe, expect, it } from "vitest";
import {
  canonicalCashPlusAmount,
  minimumAfterSlippage,
  parseCashPlusAmount,
  sharesForAssets,
} from "./amounts";

describe("Cash+ exact amounts", () => {
  // @rule R1: amounts never pass through a floating point representation.
  it("preserves raw precision beyond safe JS integers", () => {
    expect(parseCashPlusAmount("9007199254740993.123456")).toBe(BigInt("9007199254740993123456"));
    expect(parseCashPlusAmount("0.000001")).toBe(BigInt("1"));
    expect(parseCashPlusAmount("1.000000000000000001", 18)).toBe(BigInt("1000000000000000001"));
  });
  // @rule R2: invalid, zero, signed, exponent or overprecision amounts cannot become calldata.
  it.each([
    "",
    "0",
    "0.000000",
    "-1",
    "+1",
    "1e6",
    "NaN",
    "1.1234567",
    "1,000",
    " 1",
    "1 ",
    "01.0",
    ".5",
    "1.",
  ])("rejects %s", (value) => {
    expect(() => parseCashPlusAmount(value)).toThrow();
  });
  it("rejects uint256 overflow and unsupported precision", () => {
    expect(() => parseCashPlusAmount((BigInt("2") ** BigInt("256")).toString(), 0)).toThrow();
    expect(() => parseCashPlusAmount("1", -1)).toThrow();
    expect(() => parseCashPlusAmount("1", 256)).toThrow();
  });
  // @rule R3: locale normalization validates separators rather than guessing magnitude.
  it("normalizes Brazilian and English grouped decimals", () => {
    expect(canonicalCashPlusAmount("1.234,56", "pt-BR")).toBe("1234.56");
    expect(canonicalCashPlusAmount("1,234.56", "en")).toBe("1234.56");
    expect(canonicalCashPlusAmount("1234,56", "pt-BR")).toBe("1234.56");
    expect(() => canonicalCashPlusAmount("1.23,56", "pt-BR")).toThrow();
    expect(() => canonicalCashPlusAmount("1,23.56", "en")).toThrow();
  });
  // @rule R4: requested assets round share input upward and slippage output downward.
  it("rounds without understating the requested share amount", () => {
    expect(sharesForAssets(BigInt("10"), BigInt("3"), BigInt("2"))).toBe(BigInt("7"));
    expect(minimumAfterSlippage(BigInt("10001"), 10)).toBe(BigInt("9990"));
    expect(() => sharesForAssets(BigInt("1"), BigInt("0"), BigInt("1"))).toThrow();
    expect(() => minimumAfterSlippage(BigInt("1"), 10001)).toThrow();
  });
});
