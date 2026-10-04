/**
 * @id PP-CORE-LIB-114 (POO-2133)
 * @name v2CatalogReads
 * @implements-rules-version v1
 * Typed catalog and fund reads, with limits derived from the authoritative detail route.
 */
import "server-only";
import { v2Fetch } from "./client";
import {
  addressSchema,
  catalogPoolSchema,
  catalogPoolsSchema,
  catalogReservesSchema,
  catalogTokensSchema,
  chainIdSchema,
  fundDetailSchema,
  fundsSchema,
  poolIdSchema,
  type V2ChainId,
} from "./schemas";

export function getCatalogTokens(
  chainId: V2ChainId,
  filters: { address?: string; symbol?: string } = {},
) {
  const query = new URLSearchParams({ chainId: String(chainIdSchema.parse(chainId)) });
  if (filters.address) query.set("address", addressSchema.parse(filters.address));
  if (filters.symbol) query.set("symbol", filters.symbol);
  return v2Fetch(`/catalog/tokens?${query}`, catalogTokensSchema);
}
export function getCatalogPools(
  chainId: V2ChainId,
  filters: { tokenAddress?: string; secondTokenAddress?: string } = {},
) {
  const query = new URLSearchParams({ chainId: String(chainIdSchema.parse(chainId)) });
  if (filters.secondTokenAddress && !filters.tokenAddress)
    throw new Error("second token requires first token");
  for (const [name, address] of Object.entries(filters))
    if (address) query.set(name, addressSchema.parse(address));
  return v2Fetch(`/catalog/uniswap-v4/pools?${query}`, catalogPoolsSchema);
}
export function getCatalogPool(chainId: V2ChainId, poolId: string) {
  return v2Fetch(
    `/catalog/uniswap-v4/pools/${poolIdSchema.parse(poolId)}?chainId=${chainIdSchema.parse(chainId)}`,
    catalogPoolSchema,
  );
}
export function getCatalogReserves() {
  return v2Fetch("/catalog/aave-v3/reserves", catalogReservesSchema);
}
export function getFunds() {
  return v2Fetch("/funds", fundsSchema);
}
export function getFund(core: string) {
  return v2Fetch(`/funds/${addressSchema.parse(core)}`, fundDetailSchema);
}
export async function getFundLimits(core: string) {
  const fund = await getFund(core);
  return {
    protocolVersion: "v2" as const,
    spokes: fund.mandate.spokes,
    spokeCapPercent: fund.profile?.spokeCapPercent ?? null,
    spokeCapEnforcedOnChain: false as const,
  };
}
