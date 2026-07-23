/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswap (value-translation module)
 * @implements-rules-version v1
 *
 * Canonical, pure, client-safe translation of RAW on-chain Uniswap v3 values into human
 * amounts / prices / ranges, for the detailed position / pool / move-range / create-pool views. The
 * pool-party-api returns raw values (LP `amount0/1` as wei bigint strings, ticks, `sqrtPriceX96`,
 * fee tiers); this module turns them into numbers the UI can render. No network, no React, no
 * `@uniswap/v3-sdk` on the client — raw math + viem only (the heavy SDK stays server-only in
 * `lib/manager/pairedAmount.ts`, where liquidity/position sizing earns it). Final DISPLAY formatting
 * is `format.ts` (`formatTokenAmount`, `formatUsd`), which consumes the numbers produced here.
 */

export { toTokenAmount } from "./amount";
export {
  type PositionSplit,
  type PositionSplitInput,
  positionTokenSplit,
  type SplitUsdAmount,
  splitUsdAmount,
} from "./positionSplit";
export { priceFromSqrtPriceX96 } from "./price";
export { inRange, type PriceRangeFromTicks, priceRangeFromTicks } from "./range";
export {
  MAX_TICK,
  MIN_TICK,
  nearestUsableTick,
  priceToClosestUsableTick,
  priceToTick,
  snapPriceToUsableTick,
  stepPriceByTick,
  tickSpacing,
  tickToPrice,
} from "./tick";
