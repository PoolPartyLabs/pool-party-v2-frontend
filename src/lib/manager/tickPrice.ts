/**
 * @name tickPrice (re-export shim, no own artifact id)
 * @implements-rules-version v1
 *
 * Re-export shim for the canonical `PP-CORE-LIB-020` uniswap value-translation module in
 * `@/lib/uniswap` (POO-282). This file owns no artifact id of its own; it only re-exports.
 *
 * The Uniswap v3 tick ⇄ price math moved to the canonical `@/lib/uniswap` module (POO-282): it is
 * generic Uniswap-domain math, not manager-specific, and is shared by positions / pools / move-range
 * / create-pool. This shim re-exports it so the existing `@/lib/manager/tickPrice` importers keep
 * working; new code should import from `@/lib/uniswap` directly.
 */
export {
  MAX_TICK,
  MIN_RANGE_SPACINGS,
  MIN_TICK,
  nearestUsableTick,
  priceToClosestUsableTick,
  priceToNearestUsableTick,
  priceToTick,
  snapPriceToUsableTick,
  stepPriceByTick,
  tickSpacing,
  tickToPrice,
} from "@/lib/uniswap/tick";
