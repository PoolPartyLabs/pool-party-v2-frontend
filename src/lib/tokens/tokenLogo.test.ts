/**
 * @id PP-CORE-LIB-021
 * @name tokenLogo tests
 * @implements-rules-version v1
 *
 * POO-482 R1: committed majors resolve by symbol (case-insensitive, no network needed); the
 * network token list is the fallback on an exact-symbol match; anything else is undefined so the
 * caller's initial-chip fallback renders.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveTokenLogo } from "./tokenLogo";

vi.mock("./tokenList", () => ({
  tokensForNetwork: vi.fn((network: string) =>
    network === "base"
      ? [
          {
            address: "0xaaa",
            name: "Aave Base WETH",
            symbol: "aBasWETH",
            iconUrl: "https://cdn.example/abasweth.png",
          },
          {
            address: "0xbbb",
            name: "Some Token",
            symbol: "XYZ",
            iconUrl: "https://cdn.example/xyz.png",
          },
          { address: "0xccc", name: "No Icon", symbol: "NOPIC" },
        ]
      : [],
  ),
}));

describe("resolveTokenLogo (POO-482 R1)", () => {
  it("resolves the committed majors by symbol, case-insensitive, without a network", () => {
    expect(resolveTokenLogo("ETH")).toBe("/tokens/eth.png");
    expect(resolveTokenLogo("usdc")).toBe("/tokens/usdc.png");
    expect(resolveTokenLogo("WBtc")).toBe("/tokens/wbtc.png");
    expect(resolveTokenLogo("WETH")).toBe("/tokens/weth.png");
  });

  it("aliases POL/MATIC to the WPOL asset", () => {
    expect(resolveTokenLogo("POL")).toBe("/tokens/wpol.png");
    expect(resolveTokenLogo("MATIC")).toBe("/tokens/wpol.png");
  });

  it("falls back to the network token list on an EXACT symbol match", () => {
    expect(resolveTokenLogo("XYZ", "base")).toBe("https://cdn.example/xyz.png");
    expect(resolveTokenLogo("xyz", "base")).toBe("https://cdn.example/xyz.png");
  });

  it("never partial-matches wrapper tokens (exact symbol only)", () => {
    expect(resolveTokenLogo("BASWETH", "base")).toBeUndefined();
  });

  it("returns undefined for unknown symbols or icon-less entries (initial chip renders)", () => {
    expect(resolveTokenLogo("NOPIC", "base")).toBeUndefined();
    expect(resolveTokenLogo("UNKNOWN")).toBeUndefined();
    expect(resolveTokenLogo("UNKNOWN", "polygon")).toBeUndefined();
  });
});
