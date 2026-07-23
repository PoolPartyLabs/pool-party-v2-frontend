/**
 * @id PP-STR-LIB-013
 * @name deriveAssetTags tests
 * @implements-rules-version v1
 *
 * [R2] Asset tags from a two-sided pair of token classes, plus the `unverified` flag, and the
 * pair-resolving wiring convenience `deriveAssetTagsForPair`.
 */
import { describe, expect, it } from "vitest";
import { classToAssetTag, deriveAssetTags, deriveAssetTagsForPair } from "./deriveAssetTags";

describe("classToAssetTag (R2 class → tag)", () => {
  // @rule R2 — the class→tag projection, including unverified → altcoins.
  it("maps each class to its asset tag", () => {
    expect(classToAssetTag("stablecoin")).toBe("stablecoins");
    expect(classToAssetTag("bitcoin")).toBe("bitcoin");
    expect(classToAssetTag("ethereum")).toBe("ethereum");
    expect(classToAssetTag("meme")).toBe("meme");
    expect(classToAssetTag("altcoin")).toBe("altcoins");
    expect(classToAssetTag("unverified")).toBe("altcoins");
  });
});

describe("deriveAssetTags (R2)", () => {
  // @rule R2 — both stablecoin → ['stablecoins'].
  it("both stablecoin → ['stablecoins']", () => {
    expect(deriveAssetTags("stablecoin", "stablecoin")).toEqual({
      assetTags: ["stablecoins"],
      unverified: false,
    });
  });

  // @rule R2 — one stablecoin + one non-stable → [tag(non-stable)] (both orders).
  it("one stablecoin + one non-stable → [tag(non-stable)]", () => {
    expect(deriveAssetTags("stablecoin", "ethereum").assetTags).toEqual(["ethereum"]);
    expect(deriveAssetTags("bitcoin", "stablecoin").assetTags).toEqual(["bitcoin"]);
    expect(deriveAssetTags("stablecoin", "meme").assetTags).toEqual(["meme"]);
    expect(deriveAssetTags("altcoin", "stablecoin").assetTags).toEqual(["altcoins"]);
  });

  // @rule R2 — both non-stable → [tag(c0), tag(c1)] deduped (WBTC/WETH → ['bitcoin','ethereum']).
  it("both non-stable → [tag(c0), tag(c1)] in order", () => {
    expect(deriveAssetTags("bitcoin", "ethereum").assetTags).toEqual(["bitcoin", "ethereum"]);
    expect(deriveAssetTags("ethereum", "bitcoin").assetTags).toEqual(["ethereum", "bitcoin"]);
    expect(deriveAssetTags("meme", "ethereum").assetTags).toEqual(["meme", "ethereum"]);
  });

  // @rule R2 — both non-stable of the SAME tag dedupe to a single entry.
  it("dedupes when both non-stable classes share a tag", () => {
    expect(deriveAssetTags("ethereum", "ethereum").assetTags).toEqual(["ethereum"]);
    expect(deriveAssetTags("altcoin", "altcoin").assetTags).toEqual(["altcoins"]);
  });

  // @rule R2 — unverified maps to altcoins and raises the flag.
  it("unverified → altcoins tag + unverified flag", () => {
    expect(deriveAssetTags("unverified", "stablecoin")).toEqual({
      assetTags: ["altcoins"],
      unverified: true,
    });
    expect(deriveAssetTags("ethereum", "unverified")).toEqual({
      assetTags: ["ethereum", "altcoins"],
      unverified: true,
    });
    expect(deriveAssetTags("unverified", "unverified")).toEqual({
      assetTags: ["altcoins"],
      unverified: true,
    });
  });
});

describe("deriveAssetTagsForPair (R2 wiring)", () => {
  // @rule R2 — resolves each token to a class (address-first, symbol fallback) then derives the tags.
  it("derives from symbol-only inputs (mock/legacy path)", () => {
    expect(deriveAssetTagsForPair({ symbol: "USDC" }, { symbol: "WETH" })).toEqual({
      assetTags: ["ethereum"],
      unverified: false,
    });
    expect(deriveAssetTagsForPair({ symbol: "WETH" }, { symbol: "WBTC" })).toEqual({
      assetTags: ["ethereum", "bitcoin"],
      unverified: false,
    });
  });

  // @rule R2 — an unknown token surfaces the unverified flag and folds to altcoins.
  it("flags an unverified token", () => {
    expect(deriveAssetTagsForPair({ symbol: "WETH" }, { symbol: "MYSTERYCOIN" })).toEqual({
      assetTags: ["ethereum", "altcoins"],
      unverified: true,
    });
  });

  // @rule R2 — the production address path resolves real tokens to their class.
  it("derives from real addresses (production path)", () => {
    expect(
      deriveAssetTagsForPair(
        { chainId: 42161, address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", symbol: "WETH" },
        { chainId: 42161, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC" },
      ),
    ).toEqual({ assetTags: ["ethereum"], unverified: false });
  });
});
