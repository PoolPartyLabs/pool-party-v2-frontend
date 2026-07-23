/**
 * @id PP-MGR-LIB-016
 * @name deriveBuilderStrategyTags
 * @implements-rules-version v1
 *
 * POO-830 R3/R4/R5: the Build-step ADAPTER that maps the manager's live range selection into the
 * canonical {@link deriveStrategyTags} input, so the builder can preview the auto-derived asset +
 * objective tags (read-only) and the Review step can persist the derived objective.
 *
 * The mint composition is built from {@link tokenSplit} (NOT hand-rolled price orientation, POO-770
 * regression class): the value split for the chosen range at the current price already resolves the
 * token0/token1 orientation from the canonical bounds. Two-sided (range covers current) → both legs
 * are held (> 0) → R3 income; single-sided (range entirely on one side) → the held token is 100% and
 * the other 0 → R4 direction. Only zero-vs-nonzero matters to `deriveStrategyTags` (R3), so the raw
 * percentages are handed straight through as the mint amounts.
 *
 * Token classes resolve via {@link resolveTokenClass} (address-first per R1, symbol fallback), so the
 * pure adapter is orientation- and mode-agnostic; the {@link deriveBuilderStrategyTagsForPool} wiring
 * convenience below feeds it the pool's descriptors, preferring the trusted address in real mode.
 */
import { networkToChainId } from "@/lib/chains/config";
import type { UniswapPool } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { deriveStrategyTags, type StrategyTags } from "@/lib/strategies/tags/deriveStrategyTags";
import { resolveTokenClass, type TokenClassInput } from "@/lib/strategies/tags/tokenClassRegistry";
import { tokenSplit } from "./rangeMath";

/** The chosen range in CANONICAL price space (token1 per token0), same shape `tokenSplit` consumes. */
export interface BuilderTagRange {
  /** Full-range liquidity (≈50/50 → two-sided). */
  full: boolean;
  /** Lower bound (canonical), or null when unset. */
  minPrice: number | null;
  /** Upper bound (canonical), or null when unset. */
  maxPrice: number | null;
}

/** Input to {@link deriveBuilderStrategyTags}: the two token descriptors + current price + range. */
export interface BuilderStrategyTagsInput {
  /** Descriptor for the first pool token (aligned with the range's token0/base leg). */
  token0: TokenClassInput;
  /** Descriptor for the second pool token (aligned with the range's token1/quote leg). */
  token1: TokenClassInput;
  /** Current pool price (token1 per token0) the range centers on. */
  currentPrice: number;
  /** The chosen range, in canonical price space. */
  range: BuilderTagRange;
}

/**
 * Derive a strategy's asset + objective tags from the builder's pool pair, current price and range
 * (R3 routing → R2/R4). Pure: the caller supplies the token descriptors.
 */
export function deriveBuilderStrategyTags(input: BuilderStrategyTagsInput): StrategyTags {
  const { token0, token1, currentPrice, range } = input;
  // tokenSplit resolves the orientation from the canonical bounds: pct0/pct1 are the value share of
  // token0/token1. Only zero-vs-nonzero matters (R3), so the percentages ARE the mint composition.
  const split = tokenSplit(currentPrice, range.minPrice, range.maxPrice, range.full);
  return deriveStrategyTags({
    pair: { c0: resolveTokenClass(token0), c1: resolveTokenClass(token1) },
    mint: { amount0: split.pct0, amount1: split.pct1 },
  });
}

/**
 * Wiring convenience: derive the builder tags straight from a {@link UniswapPool} + the range.
 *
 * The token-class resolution mirrors the two strategy mappers' mode split (POO-830 R7): real pools
 * carry the production-trusted token ADDRESS (address-first per R1), while mock pools carry SYNTHETIC
 * addresses that must NOT be trusted — so mock mode omits the chainId, which forces `resolveTokenClass`
 * onto the symbol fallback (the pool's real symbol) instead of poisoning every token to `unverified`.
 */
export function deriveBuilderStrategyTagsForPool(
  pool: UniswapPool,
  range: BuilderTagRange,
): StrategyTags {
  // PP-INTEGRATION-POINT (POO-830 R7): in real mode the trusted (chainId, address) is the class key;
  // mock pools have no real chain id/address, so they fall back to the symbol (see resolveTokenClass).
  const chainId = isMockMode ? undefined : networkToChainId(pool.network);
  return deriveBuilderStrategyTags({
    token0: { chainId, address: pool.token0Address, symbol: pool.token0 },
    token1: { chainId, address: pool.token1Address, symbol: pool.token1 },
    currentPrice: pool.currentPrice,
    range,
  });
}
