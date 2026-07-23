/**
 * @id PP-STR-LIB-014
 * @name deriveStrategyTags
 * @description Orchestrates the two-dimensional strategy tagging: routes a two-sided position to R2
 *   asset tags + `income`, and a single-sided position to the R4 direction (asset tags + objective).
 * @linear https://linear.app/yeildbay/issue/POO-830
 * @owner core-team
 * @since 2026-07-11
 * @implements-rules-version v1
 *
 * @notes
 * [R3] single-sided iff EXACTLY ONE of the two mint amounts is zero (range entirely on one side of
 * the current price). Two-sided → objective ['income'] + R2 asset tags. Single-sided → R4.
 *
 * [R4] Direction of a single-sided position. Source S = the deposited (nonzero) token, Target T = the
 * other. cash = stablecoin class; non-cash = bitcoin/ethereum/altcoin/meme (and unverified).
 *  - S cash, T non-cash → ['gradualBuy'];   assets [tag(T)]
 *  - S non-cash, T cash → ['gradualSell'];  assets [tag(S)]
 *  - S non-cash, T non-cash → ['gradualBuy','gradualSell']; assets [tag(S), tag(T)] deduped
 *  - S cash, T cash → ['income'];           assets ['stablecoins']
 *
 * A degenerate both-zero mint is NOT single-sided (R3: "exactly one"), so it routes to the two-sided
 * income path — the safe default when there is no directional signal.
 */
import type { AssetTag, ObjectiveTag } from "@/lib/schemas";
import { classToAssetTag, dedupeTags, deriveAssetTags } from "./deriveAssetTags";
import type { TokenClass } from "./tokenClassRegistry";

// The canonical OBJECTIVE tag union (the second tagging dimension) now lives on the schema
// (`objectiveTagSchema`) so the create payload + investor read validate the same keys. Re-exported
// here for the derivation's existing consumers.
export type { ObjectiveTag };

/** The two token classes of a strategy's pool pair, index-aligned with the mint amounts. */
export interface StrategyPairClasses {
  /** Class of the first pool token (aligned with `mint.amount0`). */
  c0: TokenClass;
  /** Class of the second pool token (aligned with `mint.amount1`). */
  c1: TokenClass;
}

/** The two mint amounts of the created position (raw or human — only zero vs nonzero matters, R3). */
export interface StrategyMint {
  /** Amount of the first pool token minted into the position. */
  amount0: number;
  /** Amount of the second pool token minted into the position. */
  amount1: number;
}

/** Input to {@link deriveStrategyTags}: the pair classes plus the mint composition. */
export interface DeriveStrategyTagsInput {
  /** The pair's two token classes, index-aligned with `mint`. */
  pair: StrategyPairClasses;
  /** The position's mint amounts. */
  mint: StrategyMint;
}

/** The full two-dimensional tagging of a strategy. */
export interface StrategyTags {
  /** Canonical asset tags (R2/R4). */
  assetTags: AssetTag[];
  /** Canonical objective tags (R3/R4). */
  objectiveTags: ObjectiveTag[];
  /** True when either pool token class is `unverified`. */
  unverified: boolean;
}

/** A leg is "deposited" when its mint amount is strictly positive. */
function isDeposited(amount: number): boolean {
  return amount > 0;
}

/** "cash" = stablecoin; every other class (incl. unverified) is non-cash (R4). */
function isCash(tokenClass: TokenClass): boolean {
  return tokenClass === "stablecoin";
}

/**
 * Derive the asset + objective tags of a strategy from its pair classes and mint composition
 * (R3 routing → R2 for two-sided, R4 for single-sided).
 */
export function deriveStrategyTags(input: DeriveStrategyTagsInput): StrategyTags {
  const { pair, mint } = input;
  const { c0, c1 } = pair;
  const unverified = c0 === "unverified" || c1 === "unverified";

  const deposited0 = isDeposited(mint.amount0);
  const deposited1 = isDeposited(mint.amount1);
  // R3: single-sided iff EXACTLY ONE leg is deposited (i.e. exactly one mint amount is zero).
  const singleSided = deposited0 !== deposited1;

  if (!singleSided) {
    // Two-sided (both deposited) OR degenerate both-zero → income + R2 asset tags.
    return { objectiveTags: ["income"], assetTags: deriveAssetTags(c0, c1).assetTags, unverified };
  }

  // R4: source = the deposited (nonzero) leg; target = the other.
  const sourceClass = deposited0 ? c0 : c1;
  const targetClass = deposited0 ? c1 : c0;
  const sourceIsCash = isCash(sourceClass);
  const targetIsCash = isCash(targetClass);

  if (sourceIsCash && !targetIsCash) {
    return { objectiveTags: ["gradualBuy"], assetTags: [classToAssetTag(targetClass)], unverified };
  }
  if (!sourceIsCash && targetIsCash) {
    return {
      objectiveTags: ["gradualSell"],
      assetTags: [classToAssetTag(sourceClass)],
      unverified,
    };
  }
  if (!sourceIsCash && !targetIsCash) {
    return {
      objectiveTags: ["gradualBuy", "gradualSell"],
      assetTags: dedupeTags([classToAssetTag(sourceClass), classToAssetTag(targetClass)]),
      unverified,
    };
  }
  // Both cash: dollar → dollar → income, stablecoins.
  return { objectiveTags: ["income"], assetTags: ["stablecoins"], unverified };
}
