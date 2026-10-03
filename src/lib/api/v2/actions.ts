/**
 * @id PP-CORE-LIB-115 (POO-2133)
 * @name v2CatalogActions
 * @implements-rules-version v1
 * Serializable server-action boundary; no secret or upstream message leaves the server.
 */
"use server";
import { ApiError } from "../errors";
import {
  getCatalogPool,
  getCatalogPools,
  getCatalogReserves,
  getCatalogTokens,
  getFund,
  getFundLimits,
  getFunds,
} from "./catalog";
import type { V2ChainId } from "./schemas";

async function resultOf<ResponseData>(read: () => Promise<ResponseData>) {
  try {
    return { ok: true as const, data: await read() };
  } catch (error) {
    return {
      ok: false as const,
      error: {
        status: error instanceof ApiError ? error.status : 502,
        code: error instanceof ApiError ? error.code : "V2_INVALID_RESPONSE",
      },
    };
  }
}
export async function getCatalogTokensAction(chainId: V2ChainId) {
  return resultOf(() => getCatalogTokens(chainId));
}
export async function getCatalogPoolsAction(
  chainId: V2ChainId,
  filters: { tokenAddress?: string; secondTokenAddress?: string } = {},
) {
  return resultOf(() => getCatalogPools(chainId, filters));
}
export async function getCatalogPoolAction(chainId: V2ChainId, poolId: string) {
  return resultOf(() => getCatalogPool(chainId, poolId));
}
export async function getCatalogReservesAction() {
  return resultOf(getCatalogReserves);
}
export async function getFundsAction() {
  return resultOf(getFunds);
}
export async function getFundAction(core: string) {
  return resultOf(() => getFund(core));
}
export async function getFundLimitsAction(core: string) {
  return resultOf(() => getFundLimits(core));
}
