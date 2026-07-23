/**
 * @id PP-MGR (POO-306)
 * @name seedUsdValue
 * @implements-rules-version v1
 *
 * Total USD value of a create-pool seed (both token amounts), used to gate Launch against the
 * configurable create-pool minimum. Mirrors the v1 interface, which summed each token's fiat value
 * (`amount × priceUSD`) into `totalFiatDepositAmount`. Returns null when a USD price is unavailable,
 * in which case the minimum is not enforced (Launch is not blocked on a value we cannot compute).
 */
import { formatUnits } from "viem";

/**
 * @param amount0/amount1   Seed amounts in raw token units (wei), or null when empty.
 * @param decimals0/1       Token decimals (null until the on-chain reads resolve).
 * @param price0/1Usd       Per-token USD prices (undefined when the API omits them).
 * @returns The combined USD value, or null when it cannot be computed (missing decimals or a price).
 */
export function seedUsdValue(
  amount0: bigint | null,
  decimals0: number | null,
  price0Usd: number | undefined,
  amount1: bigint | null,
  decimals1: number | null,
  price1Usd: number | undefined,
): number | null {
  if (price0Usd == null || price1Usd == null) return null;
  if (decimals0 == null || decimals1 == null) return null;
  const value0 = amount0 != null ? Number(formatUnits(amount0, decimals0)) * price0Usd : 0;
  const value1 = amount1 != null ? Number(formatUnits(amount1, decimals1)) * price1Usd : 0;
  return value0 + value1;
}
