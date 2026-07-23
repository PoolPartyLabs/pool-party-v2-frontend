import { describe, expect, it } from "vitest";
import { tokenSchema } from "@/lib/schemas";
import { tokens } from "./tokens";

describe("tokens mock data", () => {
  it("contains the expected core Base tokens", () => {
    const symbols = tokens.map((token) => token.symbol);
    expect(symbols).toEqual(
      expect.arrayContaining(["USDC", "WETH", "cbETH", "DAI", "USDbC", "AERO"]),
    );
  });

  it("has every entry pass the Token schema parse", () => {
    for (const token of tokens) {
      expect(() => tokenSchema.parse(token)).not.toThrow();
    }
  });

  it("has unique symbols across all entries", () => {
    const symbols = tokens.map((token) => token.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });
});
