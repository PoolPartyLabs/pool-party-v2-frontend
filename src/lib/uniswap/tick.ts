/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswapTick
 * @implements-rules-version v2 (POO-877 rules v1)
 *
 * POO-877 (rules v1, R1/R2): the ± range steppers resolve their starting tick by ROUNDING to the
 * nearest usable tick (priceToNearestUsableTick / offsetPriceByTicks / stepPriceByTick), NOT the
 * POO-319 FLOOR that priceToClosestUsableTick keeps for typed prices (R2). Flooring a display-rounded
 * bound dropped to the tick below, freezing the stepper on tickSpacing-1 pools; rounding recovers the
 * exact tick so each step moves by exactly one spacing.
 *
 * Uniswap v3 tick ⇄ price translation, the canonical home for the math ported from
 * pool-party-interface (`shared/utils/price.ts`). Kept to this repo's standard of raw math + viem
 * instead of pulling in `@uniswap/v3-sdk` + `sdk-core` + JSBI on the client (the same reason the
 * Permit2 helpers avoid the v3 SDK); the heavy SDK is reserved for the server-only position-sizing
 * in `lib/manager/pairedAmount.ts` where reimplementing the liquidity math would be error-prone.
 *
 * Orientation is fixed to the repo convention: a price is always **token1 per 1 token0** (the same
 * "currentPrice" used across the strategy/pool schemas), so there is no `inverted` flag. The raw
 * Uniswap price token1/token0 (in smallest units) is `1.0001^tick`; the human price multiplies by
 * `10^(decimals0 - decimals1)` to account for the tokens' decimals.
 *
 * Float precision is more than enough here: ranges are tick-discretized, so the only thing that has
 * to be exact is the integer tick (aligned to spacing), which `nearestUsableTick` guarantees.
 *
 * `lib/manager/tickPrice.ts` re-exports this module so its existing importers keep working.
 */

/** Uniswap v3 absolute tick bounds (price ≈ 1.0001^tick stays within uint160 sqrt range). */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/** Base of the Uniswap v3 tick→price exponent. */
const TICK_BASE = 1.0001;

/**
 * Minimum width of a concentrated position, expressed in usable-tick spacings (POO-860 R2/R3).
 * Shared across the manager range flows (create-pool tick resolution + the Build/Move-Range UI
 * guards) so the up-front validation and the pre-mint backstop enforce the same threshold. A range
 * narrower than this mints a degenerate position and, sitting next to the current price, flips
 * between one- and two-sided on a tiny price move.
 */
export const MIN_RANGE_SPACINGS = 2;

/** Tick spacing per fee tier (in bps: 1=0.01%, 5=0.05%, 30=0.30%, 100=1.00%). */
export function tickSpacing(feeBps: number): number {
  switch (feeBps) {
    case 1:
      return 1;
    case 5:
      return 10;
    case 30:
      return 60;
    case 100:
      return 200;
    default:
      return 60;
  }
}

/**
 * Round a tick to the nearest usable tick (multiple of `spacing`) within [MIN_TICK, MAX_TICK].
 * Mirrors `@uniswap/v3-sdk`'s `nearestUsableTick` (round-half-up, then pull inside the bounds).
 */
export function nearestUsableTick(tick: number, spacing: number): number {
  // Clamp into bounds first (matches the interface wrapper + the v3-sdk invariant), then round.
  const clamped = Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
  const rounded = Math.round(clamped / spacing) * spacing;
  if (rounded < MIN_TICK) return rounded + spacing;
  if (rounded > MAX_TICK) return rounded - spacing;
  return rounded;
}

/**
 * The price (token1 per 1 token0) at a given tick, adjusted for the two tokens' decimals.
 *
 * @example tickToPrice(0, 18, 6) === 1e12 (token0 has 12 more decimals than token1)
 */
export function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  return TICK_BASE ** tick * 10 ** (decimals0 - decimals1);
}

/**
 * The (unrounded) tick whose price equals `price` (token1 per 1 token0). Inverse of
 * {@link tickToPrice}. Returns `NaN` for a non-positive price.
 */
export function priceToTick(price: number, decimals0: number, decimals1: number): number {
  if (!(price > 0)) return Number.NaN;
  const raw = price * 10 ** (decimals1 - decimals0); // back to token1/token0 in smallest units
  return Math.log(raw) / Math.log(TICK_BASE);
}

/**
 * The usable tick (aligned to the fee tier's spacing, within bounds) for a manager-TYPED min/max
 * price, at the input-edge snap (`snapPriceToUsableTick`). Uses **floor** at the integer-tick step to
 * match the Uniswap SDK's `priceToClosestTick` (POO-319): `getTickAtSqrtRatio` returns the greatest
 * tick with `price(tick) <= price`, so a free-form off-grid price maps to the same tick the interface
 * would pick (round-to-nearest could pick the adjacent tick). `nearestUsableTick` then snaps to
 * spacing. NOT for re-deriving the tick of an already-snapped, display-rounded bound - that is tick
 * RECOVERY, which must round ({@link priceToNearestUsableTick}, POO-877/POO-900): flooring a
 * display-rounded exact-tick price drops one tick on spacing-1 pools.
 */
export function priceToClosestUsableTick(
  price: number,
  decimals0: number,
  decimals1: number,
  feeBps: number,
): number {
  return nearestUsableTick(
    Math.floor(priceToTick(price, decimals0, decimals1)),
    tickSpacing(feeBps),
  );
}

/**
 * The exact price (token1 per token0) of the usable tick nearest to `price` — i.e.
 * `tickToPrice(priceToClosestUsableTick(price))`. This is the price the on-chain position will be
 * minted / rebalanced at, so a manager input snapped through this reads back the value that actually
 * executes ("what you see is what you get"). Out-of-bounds prices clamp to the MIN/MAX usable tick
 * (via `nearestUsableTick`). A non-positive price is returned unchanged — the caller decides how to
 * treat empty/invalid input.
 */
export function snapPriceToUsableTick(
  price: number,
  decimals0: number,
  decimals1: number,
  feeBps: number,
): number {
  if (!(price > 0)) return price;
  return tickToPrice(
    priceToClosestUsableTick(price, decimals0, decimals1, feeBps),
    decimals0,
    decimals1,
  );
}

/**
 * The usable tick NEAREST to `price` (round-half to the closest spacing multiple, within bounds).
 * The tick-RECOVERY resolver (POO-877 steppers, POO-900 width gate + mint paths): unlike
 * {@link priceToClosestUsableTick} - which FLOORS the integer tick for POO-319 SDK parity on TYPED
 * prices - this rounds, so a bound the range editor rendered by rounding a usable-tick price DOWN
 * for display recovers the exact tick it sits on. The width gate (rangeSpacingsForPool) and the mint
 * paths (createPoolTicks, useMoveRange's build) resolve with this same function, so a gate-accepted
 * range mints at exactly the gated ticks (POO-900 gate/mint width contract). A non-positive price
 * returns NaN (via {@link priceToTick}); callers guard before stepping.
 */
export function priceToNearestUsableTick(
  price: number,
  decimals0: number,
  decimals1: number,
  feeBps: number,
): number {
  return nearestUsableTick(priceToTick(price, decimals0, decimals1), tickSpacing(feeBps));
}

/**
 * The price of the usable tick exactly one spacing step (`dir`) away from `price`, after resolving
 * `price` to its NEAREST usable tick. Used by the ± steppers so a nudge lands on a real adjacent
 * usable tick (not a linear price delta). Stays within [MIN_TICK, MAX_TICK].
 *
 * POO-877 R1/R3: the starting tick is resolved by ROUNDING ({@link priceToNearestUsableTick}), NOT the
 * POO-319 floor kept for typed prices (R2). The editor renders a usable-tick price rounded DOWN for
 * display; flooring it on the way back drops to the tick below, so `+1` re-derives the SAME tick (a
 * permanent fixed point on tickSpacing-1 pools, e.g. USDC/USDT 0.01%) and `-1` skips a tick. Rounding
 * recovers the exact tick, so the tick is the true source of truth and every step moves it by exactly
 * one spacing. A non-positive price is returned unchanged.
 */
export function stepPriceByTick(
  price: number,
  decimals0: number,
  decimals1: number,
  feeBps: number,
  dir: 1 | -1,
): number {
  if (!(price > 0)) return price;
  const spacing = tickSpacing(feeBps);
  const tick = priceToNearestUsableTick(price, decimals0, decimals1, feeBps);
  return tickToPrice(nearestUsableTick(tick + dir * spacing, spacing), decimals0, decimals1);
}
