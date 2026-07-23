/**
 * @id PP-CORE-LIB-INITIALS (POO-713)
 * @name initialsFor tests
 * @implements-rules-version v1
 *
 * Locks the avatar-initials rule: one word → first two letters; multi-word → first letter of the
 * first two words; blank → "?"; always upper-cased and whitespace-tolerant.
 */
import { describe, expect, it } from "vitest";
import { initialsFor } from "./initials";

describe("initialsFor", () => {
  it("takes the first letter of the first two words for a multi-word name", () => {
    expect(initialsFor("ETH Steady")).toBe("ES");
    expect(initialsFor("Delta Neutral Vault")).toBe("DN");
  });

  it("takes the first two letters of a single-word name", () => {
    expect(initialsFor("Aerodrome")).toBe("AE");
    expect(initialsFor("A")).toBe("A");
  });

  it("upper-cases the result", () => {
    expect(initialsFor("steady eddie")).toBe("SE");
    expect(initialsFor("aave")).toBe("AA");
  });

  it("tolerates surrounding and internal whitespace", () => {
    expect(initialsFor("  ETH   USDC  ")).toBe("EU");
  });

  it("returns '?' for an empty or blank name", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });
});
