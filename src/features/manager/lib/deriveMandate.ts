/**
 * @id PP-MGR-LIB-001
 * @name deriveMandate
 *
 * Auto-derives a strategy's risk level (1–5) and category from its pool + chosen range — NOT a
 * manager input (V1 rule). Heuristic for the mock: a stablecoin pair is conservative; a stable +
 * blue-chip (ETH/BTC) pair is moderate; anything else is aggressive. A tight concentrated range
 * raises the risk a notch; a full range lowers it.
 *
 * PP-INTEGRATION-POINT: replace with the real risk model (volatility, correlation, range width…).
 */
import type { UniswapPool } from "@/lib/schemas";

const STABLES = new Set(["USDC", "USDT", "DAI", "GHO", "sDAI", "USDe", "FRAX"]);
const BLUE_CHIPS = new Set(["ETH", "WETH", "WBTC", "cbBTC", "BTC"]);

/** The auto-derived risk level (1–5) and category for a strategy. */
export interface DerivedMandate {
  /** 1 (very conservative) – 5 (very aggressive). */
  riskLevel: 1 | 2 | 3 | 4 | 5;
  /** Category key, translated by the UI. */
  categoryKey: "stable" | "blueChip" | "volatile";
}

/**
 * Derive {@link DerivedMandate} from a pool and the chosen range half-width in percent around the
 * current price (`null` = full range).
 */
export function deriveMandate(pool: UniswapPool, rangeWidthPct: number | null): DerivedMandate {
  const stable0 = STABLES.has(pool.token0);
  const stable1 = STABLES.has(pool.token1);
  const major0 = stable0 || BLUE_CHIPS.has(pool.token0);
  const major1 = stable1 || BLUE_CHIPS.has(pool.token1);

  let base: number;
  let categoryKey: DerivedMandate["categoryKey"];
  if (stable0 && stable1) {
    base = 1;
    categoryKey = "stable";
  } else if ((stable0 || stable1) && major0 && major1) {
    base = 3;
    categoryKey = "blueChip";
  } else {
    base = 4;
    categoryKey = "volatile";
  }

  // Concentration adjusts the risk: a tight range (≤ ±10%) is riskier; a full range is calmer.
  let adjust = 0;
  if (rangeWidthPct === null) adjust = -1;
  else if (rangeWidthPct <= 10) adjust = 1;

  const riskLevel = Math.min(5, Math.max(1, base + adjust)) as DerivedMandate["riskLevel"];
  return { riskLevel, categoryKey };
}
