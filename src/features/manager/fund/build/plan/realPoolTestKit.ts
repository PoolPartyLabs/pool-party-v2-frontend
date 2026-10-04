/**
 * @id PP-MGR-LIB-026
 * @name realPoolTestKit
 * @implements-rules-version v1 (POO-2184 rules v1)
 * @analytics-events none, test support: it builds data and emits nothing.
 *
 * TEST SUPPORT for the bare PoolId contract (POO-2184, verification finding 2): a mandate draft whose
 * Arbitrum pool is a REAL-MODE row, produced by `mapV2Pool` from a v2 catalog pool exactly as the
 * Pools step stores it (`id` = `42161:<poolId>`, `poolId` = the bare bytes32). The mock rows of
 * `planTestKit` carry no `poolId`, so the two kits together cover both readers' branches. Nothing in
 * the app imports this file.
 */
import type { CatalogPool } from "@/lib/api/v2/schemas";
import type { MandateDraft, MandatePoolRef } from "../../mandateDraft";
import { mapV2Pool } from "../../mandatePoolSource";
import { makeTestDraft, TEST_ASSET_KEYS } from "./planTestKit";

/** The bare PoolId of the real-mode Arbitrum WETH / USDC pool (lowercase, as `mapV2Pool` keeps it). */
export const REAL_POOL_ID = `0x${"ab".repeat(32)}`;

/** Its tick spacing in the catalog's pool key: a fee of 500 on a spacing of 10. */
export const REAL_POOL_TICK_SPACING = 10;

const WETH = TEST_ASSET_KEYS.wethArbitrum.split(":")[1] ?? "";
const USDC = TEST_ASSET_KEYS.usdcArbitrum.split(":")[1] ?? "";

function catalogToken(address: string, symbol: string, name: string, decimals: number) {
  return {
    protocolVersion: "v2" as const,
    chainId: "42161" as const,
    address,
    symbol,
    name,
    decimals,
    logoUrl: null,
    hubPriced: true,
    priceUsd: null,
    priceUpdatedAt: null,
    priceSource: `0x${"00".repeat(20)}`,
    priceProvenance: "chainlink" as const,
    priceUnavailableReason: null,
  };
}

/** The v2 catalog's Arbitrum WETH / USDC pool, currencies in address order (WETH sorts first). */
export function realCatalogPool(): CatalogPool {
  return {
    protocolVersion: "v2",
    chainId: "42161",
    adapterKind: "uniswap-v4",
    poolId: REAL_POOL_ID,
    poolKey: {
      protocolVersion: "v2",
      currency0: WETH,
      currency1: USDC,
      fee: 500,
      tickSpacing: REAL_POOL_TICK_SPACING,
      hooks: `0x${"00".repeat(20)}`,
    },
    tokens: [
      catalogToken(WETH, "WETH", "Wrapped Ether", 18),
      catalogToken(USDC, "USDC", "USD Coin", 6),
    ],
    pairSymbols: ["WETH", "USDC"],
    hooked: false,
    currentTick: -197_375,
    sqrtPriceX96: "4377071981432557376766",
    currentPrice: { protocolVersion: "v2", token1PerToken0: "3050", token0PerToken1: "0.000328" },
    liquidity: "1000000000000",
    eligible: true,
    registration: "at-fund-creation",
    tvlUsd: null,
    feesApr: null,
    tvlUnavailableReason: "not indexed",
    feesAprUnavailableReason: "not indexed",
  };
}

/** The real-mode row of that pool, as the Pools step stores it. */
export function realPoolRow(): MandatePoolRef {
  return mapV2Pool(realCatalogPool());
}

/** `makeTestDraft` with its Arbitrum pool replaced by the real-mode row (Robinhood keeps its mock). */
export function makeRealModeDraft(): MandateDraft {
  const draft = makeTestDraft();
  return {
    ...draft,
    pools: [realPoolRow(), ...draft.pools.filter((pool) => pool.network !== "arbitrum")],
  };
}
