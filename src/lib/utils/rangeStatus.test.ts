/**
 * @id PP-MGR-SCR-002
 * @name getRangeStatus tests
 * @implements-rules-version v1
 *
 * POO-278 [R6] / POO-236: shared range-status util. inRange = min <= current <= max (inclusive);
 * out of range distinguishes below (current < min) vs above (current > max); full range is always
 * in range.
 */
import { describe, expect, it } from "vitest";
import { getRangeStatus } from "./rangeStatus";

describe("getRangeStatus", () => {
  it("returns in when the current price sits inside the range", () => {
    expect(getRangeStatus(3050, { full: false, minPrice: 2800, maxPrice: 3400 })).toBe("in");
  });

  it("treats the bounds as inclusive", () => {
    expect(getRangeStatus(2800, { full: false, minPrice: 2800, maxPrice: 3400 })).toBe("in");
    expect(getRangeStatus(3400, { full: false, minPrice: 2800, maxPrice: 3400 })).toBe("in");
  });

  it("returns below when the current price is under the min", () => {
    expect(getRangeStatus(2650, { full: false, minPrice: 2800, maxPrice: 3400 })).toBe("below");
  });

  it("returns above when the current price is over the max", () => {
    expect(getRangeStatus(3520, { full: false, minPrice: 2800, maxPrice: 3400 })).toBe("above");
  });

  it("full range is always in range", () => {
    expect(getRangeStatus(0.000001, { full: true, minPrice: null, maxPrice: null })).toBe("in");
    expect(getRangeStatus(9999999, { full: true, minPrice: null, maxPrice: null })).toBe("in");
  });

  it("returns null while the range is incomplete or invalid", () => {
    expect(getRangeStatus(3050, { full: false, minPrice: null, maxPrice: 3400 })).toBeNull();
    expect(getRangeStatus(3050, { full: false, minPrice: 2800, maxPrice: null })).toBeNull();
    expect(getRangeStatus(3050, { full: false, minPrice: Number.NaN, maxPrice: 3400 })).toBeNull();
    // Inverted bounds are not a decidable range.
    expect(getRangeStatus(3050, { full: false, minPrice: 3400, maxPrice: 2800 })).toBeNull();
  });

  it("returns null when the current price itself is not finite", () => {
    expect(getRangeStatus(Number.NaN, { full: false, minPrice: 2800, maxPrice: 3400 })).toBeNull();
  });
});
