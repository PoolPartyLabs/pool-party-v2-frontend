/**
 * @id PP-STR-LIB-003 (POO-403)
 * @name slippage.test
 * @implements-rules-version v3
 *
 * R6: the custom slippage input accepts 0-100 with at most one decimal place (no "000" artifacts),
 * and the value drives a "High slippage" (> 5%) / "Very high slippage" (> 20%) warning.
 * POO-513 R3: a comma decimal separator reads as the decimal point.
 */
import { describe, expect, it } from "vitest";
import {
  CREATE_POOL_DEFAULT_SLIPPAGE_PCT,
  DEFAULT_SLIPPAGE_PCT,
  floorSlippage,
  MANAGER_DEFAULT_SLIPPAGE_PCT,
  SLIPPAGE_MIN,
  SLIPPAGE_PRESETS,
  sanitizeSlippageInput,
  slippageSeverity,
} from "./slippage";

// POO-463 R1/R2: presets are 0.5 / 1 / 2 (+ Custom); investor flows default to 2%, the
// manager-only flows (Move Range / Close) default to 5% (their existing cap).
// POO-525 R1: the create-pool (Launch strategy) flow defaults to 2% under the 5% manager cap.
describe("slippage constants (POO-463)", () => {
  it("offers the 0.5 / 1 / 2 presets", () => {
    expect(SLIPPAGE_PRESETS).toEqual([0.5, 1, 2]);
  });

  it("defaults investor flows to 2% and manager flows to 5%", () => {
    expect(DEFAULT_SLIPPAGE_PCT).toBe(2);
    expect(MANAGER_DEFAULT_SLIPPAGE_PCT).toBe(5);
  });

  // @rule POO-525 R1 — create-pool defaults to 2% (gear seed, client default and server fallback
  // all read this one constant), staying under the manager 5% cap.
  it("[POO-525 R1] defaults the create-pool flow to 2%", () => {
    expect(CREATE_POOL_DEFAULT_SLIPPAGE_PCT).toBe(2);
  });

  it("keeps both defaults inside the severity-safe band (no warning at default)", () => {
    expect(slippageSeverity(DEFAULT_SLIPPAGE_PCT)).toBe("none");
    expect(slippageSeverity(MANAGER_DEFAULT_SLIPPAGE_PCT)).toBe("none");
    expect(slippageSeverity(CREATE_POOL_DEFAULT_SLIPPAGE_PCT)).toBe("none");
  });
});

describe("sanitizeSlippageInput", () => {
  it("strips leading zeros so '000' renders as '0' (the reported bug)", () => {
    expect(sanitizeSlippageInput("000")).toBe("0");
    expect(sanitizeSlippageInput("007")).toBe("7");
    expect(sanitizeSlippageInput("05")).toBe("5");
  });

  it("keeps at most one decimal place", () => {
    expect(sanitizeSlippageInput("5.55")).toBe("5.5");
    expect(sanitizeSlippageInput("12.34")).toBe("12.3");
    expect(sanitizeSlippageInput("0.5")).toBe("0.5");
  });

  it("allows a single decimal point only", () => {
    expect(sanitizeSlippageInput("5.5.5")).toBe("5.5");
    expect(sanitizeSlippageInput("1..2")).toBe("1.2");
  });

  it("drops any non-numeric characters", () => {
    expect(sanitizeSlippageInput("1a2")).toBe("12");
    expect(sanitizeSlippageInput("abc")).toBe("");
    expect(sanitizeSlippageInput("-5")).toBe("5");
  });

  it("clamps to the 0-100 range (default max 100)", () => {
    expect(sanitizeSlippageInput("150")).toBe("100");
    expect(sanitizeSlippageInput("1000")).toBe("100");
    expect(sanitizeSlippageInput("100")).toBe("100");
    expect(sanitizeSlippageInput("100.5")).toBe("100");
  });

  it("honours a lower max when a flow caps slippage (e.g. manager cap)", () => {
    expect(sanitizeSlippageInput("9", 5)).toBe("5");
    expect(sanitizeSlippageInput("3", 5)).toBe("3");
  });

  it("preserves intermediate typing states ('10.' while entering a decimal)", () => {
    expect(sanitizeSlippageInput("10.")).toBe("10.");
    expect(sanitizeSlippageInput("")).toBe("");
  });

  // @rule POO-513 R3: a comma decimal separator (pt-BR and most EU keyboard layouts) reads as the
  // decimal point instead of being dropped ("1,7" used to collapse to "17", clamped to the cap).
  it("accepts a comma as the decimal separator (POO-513 R3)", () => {
    expect(sanitizeSlippageInput("1,7")).toBe("1.7");
    expect(sanitizeSlippageInput("0,5")).toBe("0.5");
    expect(sanitizeSlippageInput("1,7", 5)).toBe("1.7");
    expect(sanitizeSlippageInput("1,")).toBe("1.");
  });
});

describe("slippageSeverity", () => {
  it("is 'none' at or below 5%", () => {
    expect(slippageSeverity(0)).toBe("none");
    expect(slippageSeverity(1)).toBe("none");
    expect(slippageSeverity(5)).toBe("none");
  });

  it("is 'high' above 5% and at or below 20%", () => {
    expect(slippageSeverity(5.1)).toBe("high");
    expect(slippageSeverity(10)).toBe("high");
    expect(slippageSeverity(20)).toBe("high");
  });

  it("is 'veryHigh' above 20%", () => {
    expect(slippageSeverity(20.1)).toBe("veryHigh");
    expect(slippageSeverity(100)).toBe("veryHigh");
  });

  it("is 'none' for a non-finite value", () => {
    expect(slippageSeverity(Number.NaN)).toBe("none");
  });
});

// POO-547 R4: the floor is 0.1%; a positive value under it normalizes up to the floor. The floor is
// applied on commit (the settings-dialog custom input's onBlur), NOT per keystroke, so intermediate
// typing like "0." stays typeable — `sanitizeSlippageInput` (display clamp) is intentionally
// unchanged and has no floor.
describe("SLIPPAGE_MIN (POO-547 R4)", () => {
  it("is 0.1", () => {
    expect(SLIPPAGE_MIN).toBe(0.1);
  });
});

describe("floorSlippage (POO-547 R4)", () => {
  it("raises a positive value below the floor up to the floor", () => {
    expect(floorSlippage(0.05)).toBe(0.1);
    expect(floorSlippage(0.09)).toBe(0.1);
    expect(floorSlippage(0.01)).toBe(0.1);
  });

  it("leaves a value at or above the floor unchanged", () => {
    expect(floorSlippage(0.1)).toBe(0.1);
    expect(floorSlippage(0.5)).toBe(0.5);
    expect(floorSlippage(2)).toBe(2);
    expect(floorSlippage(100)).toBe(100);
  });

  it("leaves zero unchanged (empty/no-op entries fall back to the seed elsewhere)", () => {
    expect(floorSlippage(0)).toBe(0);
  });

  it("leaves a non-finite value unchanged", () => {
    expect(floorSlippage(Number.NaN)).toBeNaN();
    expect(floorSlippage(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it("honours a custom minimum when supplied", () => {
    expect(floorSlippage(0.3, 0.5)).toBe(0.5);
    expect(floorSlippage(0.6, 0.5)).toBe(0.6);
  });
});
