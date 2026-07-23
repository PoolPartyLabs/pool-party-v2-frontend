/**
 * @id PP-MGR
 * @name invertPrice.test
 * Behavior: reciprocal price inversion is an involution that swaps a band's bounds (so displayed
 * min<max), is the identity when not inverted, and leaves non-positive sentinel bounds untouched.
 */
import { describe, expect, it } from "vitest";
import { type Bounds, invert, toCanonicalBounds, toDisplayBounds } from "./invertPrice";

describe("invert", () => {
  it("reciprocates positive prices", () => {
    expect(invert(2)).toBe(0.5);
    expect(invert(0.5)).toBe(2);
    expect(invert(1)).toBe(1);
    expect(invert(3050)).toBeCloseTo(1 / 3050, 12);
  });

  it("leaves non-positive (empty/sentinel) values unchanged", () => {
    expect(invert(0)).toBe(0);
    expect(invert(-3)).toBe(-3);
    expect(invert(Number.NaN)).toBeNaN();
  });
});

describe("toDisplayBounds / toCanonicalBounds", () => {
  it("are the identity when not inverted", () => {
    expect(toDisplayBounds(2745, 3355, false)).toEqual({ min: 2745, max: 3355 });
    expect(toCanonicalBounds(2745, 3355, false)).toEqual({ min: 2745, max: 3355 });
  });

  it("reciprocate AND swap when inverted, keeping displayed min < max", () => {
    // Canonical band [0.0002, 0.0004] (token1/token0) reads as [2500, 5000] in the flipped orientation.
    const disp = toDisplayBounds(0.0002, 0.0004, true);
    expect(disp.min).toBeCloseTo(2500, 6);
    expect(disp.max).toBeCloseTo(5000, 6);
    expect(disp.min).toBeLessThan(disp.max);

    // …and back the other way: displayed [2500, 5000] → canonical [0.0002, 0.0004].
    const canon = toCanonicalBounds(2500, 5000, true);
    expect(canon.min).toBeCloseTo(0.0002, 12);
    expect(canon.max).toBeCloseTo(0.0004, 12);
  });

  it("maps the displayed bound onto the OPPOSITE canonical bound (the swap)", () => {
    // Editing displayed-min must move canonical-max; displayed-max must move canonical-min.
    const canon = toCanonicalBounds(2500, 5000, true);
    expect(canon.max).toBeCloseTo(invert(2500), 12); // displayed min → canonical max
    expect(canon.min).toBeCloseTo(invert(5000), 12); // displayed max → canonical min
  });

  it("round-trips canonical → display → canonical (involution)", () => {
    const cases: Bounds[] = [
      { min: 2745, max: 3355 },
      { min: 0.0242, max: 0.0296 },
      { min: 0.00032787, max: 0.00045 },
    ];
    for (const { min, max } of cases) {
      const d = toDisplayBounds(min, max, true);
      const back = toCanonicalBounds(d.min, d.max, true);
      expect(back.min).toBeCloseTo(min, 10);
      expect(back.max).toBeCloseTo(max, 10);
    }
  });

  it("passes non-positive bounds through (no Infinity from an empty bound)", () => {
    // A not-yet-typed bound (NaN) and a zero bound survive inversion as themselves.
    const d = toDisplayBounds(0, 0.0004, true);
    expect(d.max).toBe(invert(0)); // 0 stays 0
    expect(Number.isFinite(d.min)).toBe(true); // invert(0.0004) is finite
    expect(toCanonicalBounds(Number.NaN, 5000, true).max).toBeNaN();
  });
});
