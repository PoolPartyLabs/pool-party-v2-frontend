/**
 * @id PP-CORE-LIB-062 - tests
 * @name native reserve tests
 * @implements-rules-version v4 (POO-1801 rules v1) · v3 (POO-1155 / POO-1129 rules v3) · v2 (POO-1131 / POO-1129 rules v2)
 * @analytics-events none, a build-time constant emits nothing.
 *
 * The env value is baked at import, so the directly testable surface is the exported constant's
 * default and the parsing contract this module leans on. The contract is what the rules v2 decision
 * rests on: an ETH-denominated floor is a small non-negative decimal, and `0` is a kill switch.
 *
 * POO-1801 [R5] renames the constant off a dead vendor and adds the env fallback, so the PRECEDENCE
 * between the two names gets its own surface ({@link firstConfigured}) rather than being untestable
 * behind a baked-in read.
 */
import { describe, expect, it } from "vitest";
import { readUsdMinimum } from "@/lib/config/operationMinimums";
import { firstConfigured, NATIVE_RESERVE_ETH } from "./nativeReserve";

describe("NATIVE_RESERVE_ETH", () => {
  it("[R1] defaults to 0.001 ETH when the env override is unset (the test env)", () => {
    expect(NATIVE_RESERVE_ETH).toBe(0.001);
  });

  it("is a finite, non-negative number", () => {
    expect(Number.isFinite(NATIVE_RESERVE_ETH)).toBe(true);
    expect(NATIVE_RESERVE_ETH).toBeGreaterThanOrEqual(0);
  });
});

// @rule R5
describe("firstConfigured, the two env names during the rename", () => {
  // The rename cannot be a flag day: Rafael's env rename is POO-1815, so a deploy will exist that
  // still sets only the old name, and one that sets only the new. Both must work, and the NEW name
  // must win where both are present, or the migration's own variable is the one that gets ignored.
  it("[R5] prefers the new name when both are set", () => {
    expect(firstConfigured("0.002", "0.5")).toBe("0.002");
  });

  it("[R5] falls back to the deprecated name while it is the only one set", () => {
    expect(firstConfigured(undefined, "0.5")).toBe("0.5");
  });

  it("[R5] treats a blank value as unset, not as an override", () => {
    // An unset NEXT_PUBLIC_* can inline as `undefined` or as `""` depending on how the image was
    // built, and `""` reaching `readUsdMinimum` would silently take the default while SHADOWING a
    // perfectly good deprecated value.
    expect(firstConfigured("", "0.5")).toBe("0.5");
    expect(firstConfigured("   ", "0.5")).toBe("0.5");
    expect(firstConfigured(undefined, undefined)).toBeUndefined();
    expect(firstConfigured("", "")).toBeUndefined();
  });

  it("[R5] passes a kill switch through rather than treating it as blank", () => {
    // "0" is the documented disable for BOTH consumers and must not be mistaken for "unset".
    expect(firstConfigured("0", "0.5")).toBe("0");
    expect(firstConfigured(undefined, "0")).toBe("0");
  });
});

// The env parser is reused verbatim from `operationMinimums` (POO-1131: do not hand-roll a second
// one). Its USD-shaped name is historical; the behaviour is generic non-negative-number parsing,
// which is exactly what an ETH floor needs. These cases pin the two properties this module depends
// on: it reads a sub-1 decimal without rounding, and `0` reaches the caller as a disable switch.
describe("readUsdMinimum, as reused for an ETH-denominated floor", () => {
  it("parses a small sub-1 decimal without loss", () => {
    expect(readUsdMinimum("0.001", 0.001)).toBe(0.001);
    expect(readUsdMinimum("0.0005", 0.001)).toBe(0.0005);
  });

  it('lets "0" through as an explicit disable, not a fallback', () => {
    // native ETH < 0 is never true, so a standalone buy never adds a gas top-up: the kill switch.
    expect(readUsdMinimum("0", 0.001)).toBe(0);
  });

  it("falls back to the default on a malformed or negative override", () => {
    expect(readUsdMinimum("abc", 0.001)).toBe(0.001);
    expect(readUsdMinimum("-1", 0.001)).toBe(0.001);
    expect(readUsdMinimum(undefined, 0.001)).toBe(0.001);
  });
});
