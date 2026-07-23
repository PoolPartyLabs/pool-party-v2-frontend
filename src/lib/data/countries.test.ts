/**
 * @name countries.test
 * filterCountries ranks prefix matches first, ignores case + accents, returns all on empty, none on miss.
 */
import { describe, expect, it } from "vitest";
import { COUNTRIES, filterCountries } from "./countries";

describe("filterCountries", () => {
  it("ranks prefix matches before contains matches", () => {
    const result = filterCountries("ind");
    expect(result[0]).toBe("India"); // prefix, alphabetically before Indonesia
    expect(result).toContain("Indonesia");
  });

  it("is case- and accent-insensitive", () => {
    expect(filterCountries("cote")).toContain("Côte d'Ivoire");
    expect(filterCountries("UNITED")).toEqual(
      expect.arrayContaining(["United States", "United Kingdom", "United Arab Emirates"]),
    );
  });

  it("returns the full list (capped) for an empty query", () => {
    expect(filterCountries("").length).toBeGreaterThan(0);
    expect(filterCountries("   ")).toEqual(filterCountries(""));
  });

  it("returns nothing for a non-matching query", () => {
    expect(filterCountries("zzzzz")).toEqual([]);
  });

  it("every entry is unique", () => {
    expect(new Set(COUNTRIES).size).toBe(COUNTRIES.length);
  });
});
