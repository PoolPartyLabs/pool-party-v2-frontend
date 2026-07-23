/**
 * @id PP-STR-LIB-015
 * @name filterByAssetTags — tests
 *
 * The investor asset-category filter predicate (POO-830 R6). OR semantics, no-selection = no filter,
 * a strategy with no asset tags never matches while a selection is active. Pure — no React, no I/O.
 */
import { describe, expect, it } from "vitest";
import type { AssetTag, Strategy } from "@/lib/schemas";
import { filterStrategiesByAssetTags, matchesAssetTags } from "./filterByAssetTags";

const base = {
  manager: "Aave Labs",
  riskLevel: 1 as const,
  minInvestment: 100,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY" as const,
  status: "active" as const,
};

/** A strategy fixture carrying the given asset tags (undefined = lean row with no tags). */
function strat(id: string, assetTags?: AssetTag[]): Strategy {
  return { id, name: id, ...base, ...(assetTags ? { assetTags } : {}) };
}

const btc = strat("btc", ["bitcoin"]);
const eth = strat("eth", ["ethereum"]);
const stable = strat("stable", ["stablecoins"]);
const meme = strat("meme", ["meme"]);
// A two-sided non-stable pair carries BOTH tags (deriveAssetTags), so it must match either one.
const btcEth = strat("btcEth", ["bitcoin", "ethereum"]);
const lean = strat("lean"); // no assetTags at all

const all = [btc, eth, stable, meme, btcEth, lean];

describe("matchesAssetTags", () => {
  // @rule R6: no selection = no filter — every strategy matches, even a lean row with no tags.
  it("matches every strategy when the selection is empty", () => {
    for (const s of all) {
      expect(matchesAssetTags(s, [])).toBe(true);
    }
  });

  // @rule R6: a single selected category matches only strategies whose tags include it.
  it("matches a single category (OR of one)", () => {
    expect(matchesAssetTags(btc, ["bitcoin"])).toBe(true);
    expect(matchesAssetTags(eth, ["bitcoin"])).toBe(false);
  });

  // @rule R6: OR semantics — a strategy matches if ANY selected category is present.
  it("matches when ANY selected category is present (OR)", () => {
    expect(matchesAssetTags(eth, ["bitcoin", "ethereum"])).toBe(true);
    expect(matchesAssetTags(stable, ["bitcoin", "ethereum"])).toBe(false);
  });

  // @rule R6: a multi-tag strategy matches if any of its tags is selected.
  it("matches a multi-tag strategy on any of its tags", () => {
    expect(matchesAssetTags(btcEth, ["ethereum"])).toBe(true);
    expect(matchesAssetTags(btcEth, ["bitcoin"])).toBe(true);
    expect(matchesAssetTags(btcEth, ["stablecoins"])).toBe(false);
  });

  // @rule R6: a strategy with no asset tags never matches while a selection is active.
  it("never matches a tagless strategy when a selection is active", () => {
    expect(matchesAssetTags(lean, ["bitcoin"])).toBe(false);
    expect(matchesAssetTags(lean, ["bitcoin", "ethereum", "stablecoins"])).toBe(false);
    // ...but the empty selection still matches it (no filter).
    expect(matchesAssetTags(lean, [])).toBe(true);
  });
});

describe("filterStrategiesByAssetTags", () => {
  // @rule R6: empty selection returns the list unchanged (same order, all items).
  it("returns every strategy when the selection is empty", () => {
    expect(filterStrategiesByAssetTags(all, [])).toEqual(all);
  });

  // @rule R6: single category keeps only the matching strategies, preserving order.
  it("keeps only strategies matching a single category", () => {
    expect(filterStrategiesByAssetTags(all, ["stablecoins"])).toEqual([stable]);
  });

  // @rule R6: multiple categories union their matches (OR), preserving input order.
  it("unions matches across multiple categories (OR), preserving order", () => {
    expect(filterStrategiesByAssetTags(all, ["bitcoin", "meme"])).toEqual([btc, meme, btcEth]);
  });

  // @rule R6: a selection nothing matches yields an empty list (not a throw).
  it("returns an empty list when nothing matches", () => {
    const onlyStable = [stable, lean];
    expect(filterStrategiesByAssetTags(onlyStable, ["bitcoin"])).toEqual([]);
  });

  // @rule R6: the input array is never mutated.
  it("does not mutate the input array", () => {
    const input = [...all];
    filterStrategiesByAssetTags(input, ["bitcoin"]);
    expect(input).toEqual(all);
  });
});
