import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  applyKeypadKey,
  clampToRange,
  numericAmountSchema,
  parseNumericInput,
  sanitizeNumericInput,
} from "./numericInput";

describe("numericInput helper", () => {
  describe("sanitizeNumericInput", () => {
    // @rule R9: whitelist [0-9] + a single separator; strip everything else.
    it("strips non-numeric characters", () => {
      expect(sanitizeNumericInput("12a3")).toBe("123");
      expect(sanitizeNumericInput(" 4 5 ")).toBe("45");
      expect(sanitizeNumericInput("$1,234")).toBe("1234");
    });

    // @rule R10: collapse to a single decimal separator.
    it("keeps only the first decimal point", () => {
      expect(sanitizeNumericInput("1.2.3")).toBe("1.23");
      expect(sanitizeNumericInput("1..2")).toBe("1.2");
      expect(sanitizeNumericInput("12.")).toBe("12.");
    });

    // @rule R10: bound the fractional part to the field's max decimals.
    it("bounds the fractional digits to maxDecimals", () => {
      expect(sanitizeNumericInput("1.23456", { maxDecimals: 2 })).toBe("1.23");
      expect(sanitizeNumericInput("0.123456", { maxDecimals: 6 })).toBe("0.123456");
      expect(sanitizeNumericInput("0.1234567", { maxDecimals: 6 })).toBe("0.123456");
    });

    // @rule R10: maxDecimals 0 drops the separator entirely (integer-only field).
    it("drops the decimal when maxDecimals is 0", () => {
      expect(sanitizeNumericInput("12.34", { maxDecimals: 0 })).toBe("12");
    });

    // @rule R9: a leading minus is only kept when explicitly allowed.
    it("strips the sign unless allowNegative is set", () => {
      expect(sanitizeNumericInput("-5")).toBe("5");
      expect(sanitizeNumericInput("-5", { allowNegative: true })).toBe("-5");
      expect(sanitizeNumericInput("5-3", { allowNegative: true })).toBe("53");
    });

    // @rule R11: accept the locale decimal separator, normalize to "." internally.
    it("normalizes a locale decimal separator to a dot", () => {
      expect(sanitizeNumericInput("1,5", { decimalSeparator: "," })).toBe("1.5");
      // In comma-locales a literal dot is grouping noise and is dropped.
      expect(sanitizeNumericInput("1.234,5", { decimalSeparator: "," })).toBe("1234.5");
      // In dot-locales a comma is grouping noise and is dropped.
      expect(sanitizeNumericInput("1,234.5")).toBe("1234.5");
    });
  });

  describe("applyKeypadKey", () => {
    // @rule R9: a digit appends; a leading "0" is replaced.
    it("appends digits and replaces a lone leading zero", () => {
      expect(applyKeypadKey("", "5")).toBe("5");
      expect(applyKeypadKey("0", "5")).toBe("5");
      expect(applyKeypadKey("12", "3")).toBe("123");
    });

    // @rule R10: a single decimal separator; empty becomes "0.".
    it("inserts a single decimal point", () => {
      expect(applyKeypadKey("", ".")).toBe("0.");
      expect(applyKeypadKey("12", ".")).toBe("12.");
      expect(applyKeypadKey("12.5", ".")).toBe("12.5");
    });

    // @rule R10: never exceed maxDecimals (default 2).
    it("rejects a digit that would exceed maxDecimals", () => {
      expect(applyKeypadKey("12.34", "5")).toBe("12.34");
      expect(applyKeypadKey("12.3", "4", { maxDecimals: 4 })).toBe("12.34");
    });

    it("removes the last character on backspace", () => {
      expect(applyKeypadKey("125", "backspace")).toBe("12");
      expect(applyKeypadKey("", "backspace")).toBe("");
    });
  });

  describe("parseNumericInput", () => {
    // @rule R1 (precision): parse to a Decimal, never a float.
    it("parses a valid string to a Decimal", () => {
      expect(parseNumericInput("1.5")?.toString()).toBe("1.5");
      expect(parseNumericInput("100")?.equals(new Decimal(100))).toBe(true);
    });

    // @rule R11: a locale separator is normalized before parsing.
    it("parses a locale-separated value", () => {
      expect(parseNumericInput("1,5", { decimalSeparator: "," })?.toString()).toBe("1.5");
    });

    // @rule R12: empty / invalid / dot-only return null (not 0, not NaN).
    it("returns null for empty or invalid input", () => {
      expect(parseNumericInput("")).toBeNull();
      expect(parseNumericInput(".")).toBeNull();
      expect(parseNumericInput("abc")).toBeNull();
    });
  });

  describe("clampToRange", () => {
    // @rule R12: clamp below min and above max.
    it("clamps a value into the inclusive range", () => {
      expect(clampToRange(new Decimal(3), { min: 5, max: 90 }).toString()).toBe("5");
      expect(clampToRange(new Decimal(120), { min: 5, max: 90 }).toString()).toBe("90");
      expect(clampToRange(new Decimal(42), { min: 5, max: 90 }).toString()).toBe("42");
    });

    it("clamps a negative amount up to zero", () => {
      expect(clampToRange(new Decimal(-4), { min: 0 }).toString()).toBe("0");
    });
  });

  describe("numericAmountSchema", () => {
    // @rule R12: coerce + bound at the boundary; reject out-of-range and non-finite.
    it("accepts an in-range value and coerces to number", () => {
      const schema = numericAmountSchema({ min: 5, max: 90 });
      expect(schema.parse("42")).toBe(42);
      expect(schema.parse(5)).toBe(5);
    });

    it("rejects out-of-range, NaN and Infinity", () => {
      const schema = numericAmountSchema({ min: 0, max: 100 });
      expect(schema.safeParse("120").success).toBe(false);
      expect(schema.safeParse("-1").success).toBe(false);
      expect(schema.safeParse("abc").success).toBe(false);
      expect(schema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
      expect(schema.safeParse(Number.NaN).success).toBe(false);
    });
  });
});
