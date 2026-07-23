/**
 * @id PP-MGR
 * @name priceFormat.test
 * @implements-rules-version v2 (POO-900 rules v1)
 * Behavior: price precision scales with magnitude (cents for big pairs, more digits for sub-dollar
 * pairs), fmtPrice groups thousands, and roundPrice returns a bare numeric string at the ref's
 * precision (used to render canonical and inverted bounds identically across Build and Review).
 * POO-900 R8: roundPrice is tick-aware - one usable-tick step always changes the display string, and
 * the string round-recovers its tick, so the range editors' string state never aliases two ticks.
 */
import { describe, expect, it } from "vitest";
import { priceToNearestUsableTick, tickToPrice } from "@/lib/manager/tickPrice";
import { fmtPrice, priceDecimals, roundPrice } from "./priceFormat";

describe("priceDecimals", () => {
  it("scales precision with magnitude", () => {
    expect(priceDecimals(3050)).toBe(2); // high-value pair → cents
    expect(priceDecimals(12)).toBe(4); // dollar-ish
    expect(priceDecimals(0.0269)).toBe(7); // sub-dollar keeps ~5 sig figs past the zeros
    expect(priceDecimals(0)).toBe(6); // sentinel / empty
  });

  it("caps at 12 for ultra-tiny prices", () => {
    expect(priceDecimals(1e-20)).toBe(12);
  });
});

describe("fmtPrice", () => {
  it("groups thousands at the magnitude precision", () => {
    expect(fmtPrice(2500)).toBe("2,500");
    expect(fmtPrice(3049.7)).toBe("3,049.7");
  });
});

describe("roundPrice", () => {
  it("rounds to the ref's precision as a bare numeric string", () => {
    expect(roundPrice(2500.0001, 2500)).toBe("2500"); // ref ≥ 100 → 2 decimals
    expect(roundPrice(0.00032787, 0.0003)).toBe("0.00032787"); // tiny ref keeps the digits
  });

  it("kills float noise from an inverted bound", () => {
    // invert(0.0003278...) ≈ 3050 with trailing float noise; rounding at a ~3050 ref yields a clean
    // string (the same one BuildStep showed), so Review reproduces the manager's displayed value.
    expect(roundPrice(1 / (1 / 3050), 3050)).toBe("3050");
  });

  // @rule POO-900 R8 - tick-aware precision: a one-tick step (spacing 1, the tightest grid) always
  // changes the display string, and each string round-recovers its tick. The range editors hold the
  // range as DISPLAY STRINGS, so two adjacent ticks aliasing to one string makes the boundary state
  // ambiguous. The fragile zone is prices just below the ref's magnitude threshold (e.g. 0.99x at a
  // ~1 ref got only 4 decimals, where one tick is < 1e-4 absolute).
  it("[POO-900 R8] one tick step always changes the string on a spacing-1 stable pool (ref 1)", () => {
    // USDC/USDT-style grid (decimals 6/6): 4001 ticks around price 1, ref = the pool's current price.
    for (let t = -2000; t < 2000; t++) {
      const shown = roundPrice(tickToPrice(t, 6, 6), 1);
      expect(roundPrice(tickToPrice(t + 1, 6, 6), 1)).not.toBe(shown);
      expect(priceToNearestUsableTick(Number(shown), 6, 6, 1)).toBe(t);
    }
  });

  it("[POO-900 R8] one tick step always changes the string in the ~100 marginal zone", () => {
    // At a ~100 ref the magnitude precision is 2 decimals while one tick is ~1e-2 absolute - the
    // marginal zone where float slop aliased adjacent ticks (the 5/601 ambiguity in the sweep).
    for (let t = -300; t < 300; t++) {
      const shown = roundPrice(tickToPrice(t, 8, 6), 100);
      expect(roundPrice(tickToPrice(t + 1, 8, 6), 100)).not.toBe(shown);
      expect(priceToNearestUsableTick(Number(shown), 8, 6, 1)).toBe(t);
    }
  });
});
