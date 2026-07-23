/**
 * @id PP-STR-LIB-015
 * @name filterByAssetTags
 * @description Pure OR-semantics predicate + list filter for the investor asset-category filter
 *   (POO-830 R6): a strategy matches when its `assetTags` includes ANY selected category; an empty
 *   selection is no filter (returns every strategy).
 * @linear https://linear.app/yeildbay/issue/POO-830
 * @owner core-team
 * @since 2026-07-11
 * @implements-rules-version v1
 *
 * @notes
 * [R6] Multi-select category filter, OR semantics, no-selection = no filter. Client-side over the
 * strategies already loaded on the Explore screen (the asset tags are FE-derived from the pair, not a
 * backend query param). A strategy with no `assetTags` (undefined / empty) never matches while a
 * selection is active. Additive; separate from `type` (StrategyType) and the risk classifier.
 */
import type { AssetTag, Strategy } from "@/lib/schemas";

/**
 * Whether a strategy matches the selected asset categories under OR semantics (R6).
 * @param strategy - the strategy to test.
 * @param selected - the selected categories; an EMPTY array is "no filter" (always matches).
 * @returns true when `selected` is empty, or when the strategy's `assetTags` includes ANY selected
 *   category. A strategy with no `assetTags` never matches while a selection is active.
 */
export function matchesAssetTags(strategy: Strategy, selected: readonly AssetTag[]): boolean {
  if (selected.length === 0) return true;
  const tags = strategy.assetTags;
  if (tags === undefined || tags.length === 0) return false;
  return tags.some((tag) => selected.includes(tag));
}

/**
 * Filter a strategy list by the selected asset categories (R6), preserving input order. An empty
 * selection returns the list unchanged (a new array; the input is never mutated). Pure — the caller
 * (Explore screen) applies it CLIENT-SIDE over the strategies it already holds; a future backend
 * category param would replace it (see the screen's PP-INTEGRATION-POINT).
 */
export function filterStrategiesByAssetTags(
  strategies: readonly Strategy[],
  selected: readonly AssetTag[],
): Strategy[] {
  if (selected.length === 0) return [...strategies];
  return strategies.filter((strategy) => matchesAssetTags(strategy, selected));
}
