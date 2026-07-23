/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswapPrice
 * @implements-rules-version v1
 *
 * Current price (token1 per token0) from the pool's on-chain `sqrtPriceX96` (the Uniswap v3 Q64.96
 * square-root price). The raw price token1/token0 in smallest units is `(sqrtPriceX96 / 2^96)^2`;
 * multiplying by `10^(decimals0 - decimals1)` shifts it into human units, matching {@link
 * tickToPrice}. Used by the "current price" surfaces and as the live anchor for move-range, where the
 * pool exposes `sqrtPriceX96` rather than a tick.
 *
 * Float (not BigInt) is deliberate and sufficient: a price for DISPLAY only needs ~15 significant
 * digits, the same tolerance as `tickToPrice`'s `1.0001^tick`. `sqrtPriceX96` is at most ~2^160,
 * which is representable as a double; the relative error of the `Number()` conversion is ~2^-52, far
 * below display tolerance. For exact tick math use {@link priceToTick} on this value instead.
 */

/** 2^96, the Uniswap Q64.96 fixed-point scaling factor for sqrtPriceX96. */
const Q96 = 2 ** 96;

/**
 * The price (token1 per 1 token0) implied by a pool's `sqrtPriceX96`, adjusted for token decimals.
 *
 * @param sqrtPriceX96 The pool's sqrt price, as a bigint or a decimal string (the API shape).
 * @param decimals0    token0 decimals.
 * @param decimals1    token1 decimals.
 */
export function priceFromSqrtPriceX96(
  sqrtPriceX96: bigint | string,
  decimals0: number,
  decimals1: number,
): number {
  const sqrt = Number(typeof sqrtPriceX96 === "string" ? BigInt(sqrtPriceX96) : sqrtPriceX96);
  const ratio = sqrt / Q96;
  return ratio * ratio * 10 ** (decimals0 - decimals1);
}
