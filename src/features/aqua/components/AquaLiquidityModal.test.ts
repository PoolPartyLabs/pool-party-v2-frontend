// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sharesFor, toRawUsdc } from "./AquaLiquidityModal";

describe("toRawUsdc", () => {
  it("parses whole and fractional amounts", () => {
    expect(toRawUsdc("12.5")).toBe(BigInt(12_500_000));
    expect(toRawUsdc("1")).toBe(BigInt(1_000_000));
    expect(toRawUsdc("0.000001")).toBe(BigInt(1));
  });

  it("truncates past 6 decimals instead of rejecting a pasted number", () => {
    // USDC cannot represent sub-micro dust; rejecting would just confuse.
    expect(toRawUsdc("1.23456789")).toBe(BigInt(1_234_567));
  });

  it("rejects junk rather than guessing", () => {
    for (const bad of ["", ".", "abc", "-1", "1e6", "1.2.3"]) {
      expect(toRawUsdc(bad)).toBeNull();
    }
  });

  it("survives an amount larger than a JS number can hold exactly", () => {
    expect(toRawUsdc("9007199254740993.123456")).toBe(BigInt("9007199254740993123456"));
  });
});

describe("sharesFor", () => {
  const SHARES = "1000000000";
  const VALUE = "10000000"; // 10 USDC

  it("burns shares proportionally to the requested amount", () => {
    expect(sharesFor(BigInt(5_000_000), SHARES, VALUE)).toBe(BigInt(500_000_000));
  });

  /**
   * The reason this function exists. The share price moves every block as Aave accrues, so a
   * proportional figure for a full exit would leave dust and the investor could never reach
   * zero. A request at or above the position's value burns the EXACT balance.
   */
  it("burns the exact balance on a full exit, leaving no dust", () => {
    expect(sharesFor(BigInt(10_000_000), SHARES, VALUE)).toBe(BigInt(SHARES));
    expect(sharesFor(BigInt(99_000_000), SHARES, VALUE)).toBe(BigInt(SHARES));
  });

  it("is zero when there is no position", () => {
    expect(sharesFor(BigInt(1_000_000), null, null)).toBe(BigInt(0));
    expect(sharesFor(BigInt(1_000_000), "0", "0")).toBe(BigInt(0));
  });

  it("never returns more shares than are held", () => {
    const result = sharesFor(BigInt(9_999_999), SHARES, VALUE);
    expect(result).toBeLessThanOrEqual(BigInt(SHARES));
  });
});
