/**
 * @name phone - tests
 * @implements-rules-version v1
 * POO-699 [R4]: an optional phone is blank (clears the field) OR a real, country-code-qualified number
 * persisted as canonical E.164. These pure helpers back both the seed normalization and the save gate.
 */
import { describe, expect, it } from "vitest";
import { isAcceptablePhone, toE164 } from "./phone";

describe("toE164", () => {
  // @rule R4: blank (empty / whitespace) normalizes to "" — the clear-the-field case.
  it("returns '' for a blank value", () => {
    expect(toE164("")).toBe("");
    expect(toE164("   ")).toBe("");
  });

  // @rule R4: a valid number is normalized to canonical E.164 regardless of the entered formatting.
  it("canonicalizes a valid number to E.164", () => {
    expect(toE164("+55 11 90000-0000")).toBe("+5511900000000");
    expect(toE164("+1 213 373 4253")).toBe("+12133734253");
    expect(toE164("+12133734253")).toBe("+12133734253");
  });

  // @rule R4: an invalid non-blank value is returned trimmed and unchanged (never fabricated into E.164).
  it("returns the trimmed input unchanged when invalid", () => {
    expect(toE164("+1 555")).toBe("+1 555");
    expect(toE164("  +1 555  ")).toBe("+1 555");
  });

  // @rule R4: an unparseable value (parsePhoneNumber throws) is also returned trimmed and unchanged.
  it("returns the trimmed input unchanged when unparseable", () => {
    expect(toE164("abc")).toBe("abc");
    expect(toE164("+1")).toBe("+1");
  });
});

describe("isAcceptablePhone", () => {
  // @rule R4: blank is acceptable (the field is optional).
  it("accepts a blank value", () => {
    expect(isAcceptablePhone("")).toBe(true);
    expect(isAcceptablePhone("   ")).toBe(true);
  });

  // @rule R4: a real, country-code-qualified number is acceptable.
  it("accepts a valid number", () => {
    expect(isAcceptablePhone("+5511900000000")).toBe(true);
    expect(isAcceptablePhone("+1 213 373 4253")).toBe(true);
  });

  // @rule R4: a non-blank invalid number is rejected (blocks Save).
  it("rejects a non-blank invalid number", () => {
    expect(isAcceptablePhone("+1 555")).toBe(false);
    expect(isAcceptablePhone("12345")).toBe(false);
  });
});
