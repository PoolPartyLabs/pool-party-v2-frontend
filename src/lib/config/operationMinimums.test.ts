/**
 * @id PP-CORE
 * @name Operation minimums tests
 * @implements-rules-version v1
 *
 * The env constants are baked at import, so the testable surface is the pure parser `readUsdMinimum`.
 */
import { describe, expect, it } from "vitest";
import { readUsdMinimum } from "./operationMinimums";

describe("readUsdMinimum", () => {
  it("returns the parsed override when it is a valid non-negative number", () => {
    expect(readUsdMinimum("1", 10)).toBe(1);
    expect(readUsdMinimum("2.5", 10)).toBe(2.5);
    expect(readUsdMinimum("0", 10)).toBe(0);
  });

  it("falls back when the override is unset or empty", () => {
    expect(readUsdMinimum(undefined, 10)).toBe(10);
    expect(readUsdMinimum("", 10)).toBe(10);
    expect(readUsdMinimum("   ", 10)).toBe(10);
  });

  it("falls back when the override is non-numeric or negative (never disables/inverts a floor)", () => {
    expect(readUsdMinimum("abc", 10)).toBe(10);
    expect(readUsdMinimum("-5", 10)).toBe(10);
    expect(readUsdMinimum("NaN", 10)).toBe(10);
  });
});
