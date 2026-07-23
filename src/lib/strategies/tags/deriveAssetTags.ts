/**
 * @id PP-STR-LIB-013
 * @name deriveAssetTags
 * @description Derives the canonical ASSET tags of a two-sided strategy pair from its two token
 *   classes, with the `unverified` flag, plus the pair-resolving wiring convenience.
 * @linear https://linear.app/yeildbay/issue/POO-830
 * @owner core-team
 * @since 2026-07-11
 * @implements-rules-version v1
 *
 * @notes
 * [R2] Class → tag: stablecoin→stablecoins, bitcoin→bitcoin, ethereum→ethereum, meme→meme,
 * altcoin→altcoins, unverified→altcoins.
 *  - both stablecoin → ['stablecoins']
 *  - one stablecoin + one non-stable → [tag(non-stable)]
 *  - both non-stable → [tag(c0), tag(c1)] deduped
 * `unverified` = true when either class is 'unverified'.
 *
 * Note (POO-830): for SINGLE-SIDED positions the asset tags come from R4 (source/target), NOT this
 * function — see `deriveStrategyTags`. This module only covers the two-sided R2 case.
 */
import type { AssetTag } from "@/lib/schemas";
import { resolveTokenClass, type TokenClass, type TokenClassInput } from "./tokenClassRegistry";

/** Map a token class to its canonical asset tag (R2). `unverified` folds into `altcoins`. */
export function classToAssetTag(tokenClass: TokenClass): AssetTag {
  switch (tokenClass) {
    case "stablecoin":
      return "stablecoins";
    case "bitcoin":
      return "bitcoin";
    case "ethereum":
      return "ethereum";
    case "meme":
      return "meme";
    default:
      // altcoin AND unverified fold to altcoins (R2).
      return "altcoins";
  }
}

/** Whether a class is "cash" (a stablecoin). Every other class (incl. unverified) is non-stable. */
function isStable(tokenClass: TokenClass): boolean {
  return tokenClass === "stablecoin";
}

/** The result of an asset-tag derivation: the deduped tags plus the unverified-token flag. */
export interface AssetTagResult {
  /** Canonical asset tags for the pair, in `[c0, c1]` order, deduped. */
  assetTags: AssetTag[];
  /** True when either token class is `unverified`. */
  unverified: boolean;
}

/**
 * Derive the asset tags for a TWO-SIDED pair from its two token classes (R2).
 * @param c0 - class of the first pool token.
 * @param c1 - class of the second pool token.
 */
export function deriveAssetTags(c0: TokenClass, c1: TokenClass): AssetTagResult {
  const unverified = c0 === "unverified" || c1 === "unverified";
  const stable0 = isStable(c0);
  const stable1 = isStable(c1);

  if (stable0 && stable1) {
    return { assetTags: ["stablecoins"], unverified };
  }
  if (stable0 !== stable1) {
    // Exactly one stablecoin: tag only the non-stable side.
    const nonStable = stable0 ? c1 : c0;
    return { assetTags: [classToAssetTag(nonStable)], unverified };
  }
  // Both non-stable: both tags in [c0, c1] order, deduped.
  return { assetTags: dedupeTags([classToAssetTag(c0), classToAssetTag(c1)]), unverified };
}

/** Dedupe asset tags while preserving first-seen order. */
export function dedupeTags(tags: AssetTag[]): AssetTag[] {
  return [...new Set(tags)];
}

/**
 * Wiring convenience: resolve each token descriptor to a class (address-first, symbol fallback via
 * {@link resolveTokenClass}) then derive the two-sided asset tags. Used by the mappers and the mock
 * strategy service to populate `Strategy.assetTags` from the pool pair (R7).
 */
export function deriveAssetTagsForPair(
  token0: TokenClassInput,
  token1: TokenClassInput,
): AssetTagResult {
  return deriveAssetTags(resolveTokenClass(token0), resolveTokenClass(token1));
}
