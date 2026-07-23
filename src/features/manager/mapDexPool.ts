/**
 * @id PP-MGR (POO-305)
 * @name mapDexPool
 * @implements-rules-version v1
 *
 * Maps a pool-party-api dex pool to the builder's UniswapPool. Fee tier (hundredths of a bip) →
 * bps; current price from `baseTokenPriceQuoteToken`; APR estimated from trailing volume × fee rate.
 */

import type { DexPool } from "@/lib/manager/dexPoolsSchema";
import type { UniswapPool } from "@/lib/schemas";
import { canonicalTokenSymbol } from "@/lib/tokens/tokenList";

/** Display label per API network slug. */
const NETWORK_LABEL: Record<string, string> = {
  arbitrum: "Arbitrum",
  base: "Base",
  polygon: "Polygon",
};

/** Coerce a string|number to a finite number (0 on failure). */
function num(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Map one dex pool to a builder UniswapPool. */
export function mapDexPool(pool: DexPool, network: string): UniswapPool {
  const tvlUsd = num(pool.tvlInUsd);
  const feeRate = pool.feeTier / 1_000_000; // 500 → 0.0005 (0.05%)
  const volume24h = num(pool.volumeUsd?.h24);
  // Annualized fee APR ≈ daily fees × 365 / TVL.
  const aprPct = tvlUsd > 0 ? Math.max(0, ((volume24h * feeRate * 365) / tvlUsd) * 100) : 0;
  // currentPrice must be positive; fall back to a tiny value when the API omits it.
  const currentPrice = Math.max(num(pool.baseTokenPriceQuoteToken), Number.MIN_VALUE);

  // Per-token USD prices: the API tags one currency as the base, the other as the quote, and prices
  // each side. Map them onto token0/token1 (undefined when the API omits a price → no USD floor check).
  const baseUsd = num(pool.baseTokenPriceUsd);
  const quoteUsd = num(pool.quoteTokenPriceUsd);
  const priceFor = (isBase: boolean | undefined): number | undefined => {
    const value = isBase ? baseUsd : quoteUsd;
    return value > 0 ? value : undefined;
  };
  const token0PriceUsd = priceFor(pool.currency0.isBaseToken);
  const token1PriceUsd = priceFor(pool.currency1.isBaseToken);

  return {
    id: pool.address,
    network,
    networkName: NETWORK_LABEL[network] ?? network,
    // POO-589 R1: pool-pair labels show the wrapped-ether as "ETH" (address-keyed), matching the
    // token picker; the on-chain token (token0Address/token1Address) is unchanged.
    token0: canonicalTokenSymbol(pool.currency0.address, pool.currency0.symbol),
    token1: canonicalTokenSymbol(pool.currency1.address, pool.currency1.symbol),
    feeBps: Math.max(1, Math.round(pool.feeTier / 100)),
    // Keep the raw fee tier for create-pool (avoids the lossy feeBps round-trip).
    feeTier: pool.feeTier,
    tvlUsd,
    aprPct,
    currentPrice,
    address: pool.address,
    token0Address: pool.currency0.address,
    token1Address: pool.currency1.address,
    token0PriceUsd,
    token1PriceUsd,
    // Token decimals enable the exact (on-chain) tick snap in the builder range UI (POO-408). The
    // API marks them optional; left undefined when omitted (the snap then uses the relative grid).
    decimals0: pool.currency0.decimals,
    decimals1: pool.currency1.decimals,
  };
}
