/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswapAmount
 * @implements-rules-version v1
 *
 * RAW on-chain amount translation: base units (wei) → human token-units NUMBER. The pool-party-api
 * returns `amount0/1`, `fees0/1`, `tokensOwed0/1` as wei bigint strings; this shifts them by the
 * token's `decimals` (via viem's `formatUnits`) so the detailed position/pool views can read them.
 *
 * This is VALUE translation, not DISPLAY: the result is a plain number to be formatted by
 * `format.ts` (`formatTokenAmount(value, symbol)` / `formatUsd`). For amounts that must stay exact
 * for signing (the wei you authorize), keep the raw bigint — a JS number loses precision beyond
 * ~15 significant digits, which is fine for display/UX math but not for re-deriving on-chain values.
 */
import { formatUnits } from "viem";

/**
 * RAW base units (wei) → human token-units number, decimal-shifted by `decimals`.
 *
 * @param raw      The amount in smallest units, as a bigint or a decimal string (the API shape).
 * @param decimals The token's decimals (e.g. 6 for USDC, 18 for WETH).
 */
export function toTokenAmount(raw: bigint | string, decimals: number): number {
  return Number(formatUnits(typeof raw === "string" ? BigInt(raw) : raw, decimals));
}
