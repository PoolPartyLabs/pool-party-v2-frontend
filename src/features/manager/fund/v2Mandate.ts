/**
 * @id PP-MGR-LIB-025 (POO-2133)
 * @name v2Mandate
 * @implements-rules-version v1
 * Real catalog provenance, canonical provisioning selections and validation.
 */

import { z } from "zod";
import {
  addressSchema,
  type CatalogReserve,
  type CatalogToken,
  chainIdSchema,
  poolIdSchema,
  spokeCapPercentSchema,
} from "@/lib/api/v2/schemas";
import type { MandateCatalog } from "./mandateCatalog";
import { buildMandateCatalog } from "./mandateCatalog";
import { depositTokenRefFor, type MandateDraft, type NetworkId, tokenKey } from "./mandateDraft";

export const v2MandateSelectionSchema = z.object({
  chains: z
    .array(
      z.object({
        chainId: chainIdSchema,
        tokens: z.array(addressSchema).min(1).max(16),
        uniswapV4PoolIds: z.array(poolIdSchema).max(8),
      }),
    )
    .min(1)
    .max(2),
  aaveV3Reserves: z.array(addressSchema).max(1),
  spokeCapPercent: spokeCapPercentSchema,
});

export function buildRealCatalog(
  tokens: CatalogToken[],
  reserves: CatalogReserve[],
): MandateCatalog {
  const base = buildMandateCatalog();
  const entries = tokens.map((token) => ({
    address: token.address.toLowerCase(),
    symbol: token.symbol,
    name: token.name,
    network: (token.chainId === "42161" ? "arbitrum" : "robinhood") as NetworkId,
    logoUrl: token.logoUrl,
    priced: token.hubPriced,
  }));
  const catalog: MandateCatalog = {
    ...base,
    dataMode: "real",
    reserves,
    protocols: base.protocols.map((entry) => ({
      ...entry,
      available:
        entry.id === "uniswap-v3"
          ? false
          : entry.id === "aave-v3"
            ? reserves.some((reserve) => reserve.available)
            : entry.available,
    })),
    tokensFor: (networks) =>
      entries.filter(
        (entry) =>
          networks.includes(entry.network) &&
          entry.address !== depositTokenRefFor(entry.network)?.address,
      ),
    depositTokenFor: (network) =>
      entries.find(
        (entry) =>
          entry.network === network && entry.address === depositTokenRefFor(network)?.address,
      ) ?? null,
  };
  catalog.validateDraft = (draft) => {
    try {
      toV2MandateSelection(draft, catalog);
      return true;
    } catch {
      return false;
    }
  };
  return catalog;
}

export function toV2MandateSelection(draft: MandateDraft, catalog: MandateCatalog) {
  if (
    draft.dataMode !== "real" ||
    draft.catalogVersion !== "v2-catalog-v1" ||
    catalog.loading ||
    catalog.error
  )
    throw new Error("stale catalog draft");
  if (
    draft.networks[0] !== "arbitrum" ||
    new Set(draft.networks).size !== draft.networks.length ||
    draft.networks.some((network) => network !== "arbitrum" && network !== "robinhood")
  )
    throw new Error("invalid chains");
  if (
    draft.protocols.some(
      (id) => !["uniswap-v3-swap", "across", "uniswap-v4", "aave-v3"].includes(id),
    )
  )
    throw new Error("unsupported position protocol");
  if (
    draft.tokens.length > 16 ||
    new Set(draft.tokens.map(tokenKey)).size !== draft.tokens.length ||
    draft.tokens.some((entry) => !draft.networks.includes(entry.network))
  )
    throw new Error("invalid token slots");
  const chains = draft.networks.map((network) => {
    const base = catalog.depositTokenFor(network);
    const selectedTokens = draft.tokens.filter((entry) => entry.network === network);
    const allowed = [...catalog.tokensFor([network], draft.protocols), ...(base ? [base] : [])];
    if (
      !base ||
      !selectedTokens.some((entry) => entry.address.toLowerCase() === base.address) ||
      selectedTokens.some(
        (entry) =>
          !allowed.some((token) => token.priced && token.address === entry.address.toLowerCase()),
      )
    )
      throw new Error("tokens must be catalog priced and include base");
    const pools = draft.pools.filter((pool) => pool.network === network);
    const protocols =
      draft.positionProtocolsByChain?.[network] ??
      (draft.protocols.includes("uniswap-v4") ? ["uniswap-v4"] : []);
    if (
      protocols.some(
        (protocol) =>
          !draft.protocols.includes(protocol) ||
          (protocol !== "uniswap-v4" && !(protocol === "aave-v3" && network === "arbitrum")),
      ) ||
      new Set(pools.map((pool) => pool.poolId?.toLowerCase())).size !== pools.length
    )
      throw new Error("invalid position selection");
    if (protocols.includes("uniswap-v4") && pools.length === 0)
      throw new Error("selected v4 chain requires a pool");
    for (const pool of pools) {
      if (
        pool.protocol !== "uniswap-v4" ||
        !protocols.includes("uniswap-v4") ||
        !pool.poolId ||
        !pool.poolKey ||
        !Number.isInteger(pool.poolKey.fee) ||
        pool.poolKey.fee < 0 ||
        pool.poolKey.fee > 10000 ||
        !Number.isInteger(pool.poolKey.tickSpacing) ||
        pool.poolKey.tickSpacing <= 0 ||
        pool.poolKey.currency0.toLowerCase() >= pool.poolKey.currency1.toLowerCase() ||
        pool.hasHook ||
        !/^0x0{40}$/.test(pool.poolKey.hooks) ||
        [pool.poolKey.currency0, pool.poolKey.currency1].some(
          (currency) =>
            /^0x0{40}$/.test(currency) ||
            !selectedTokens.some((entry) => entry.address.toLowerCase() === currency.toLowerCase()),
        )
      )
        throw new Error("invalid pool currencies or key");
    }
    return {
      chainId: network === "arbitrum" ? (42161 as const) : (4663 as const),
      tokens: [
        base.address,
        ...selectedTokens
          .filter((entry) => entry.address.toLowerCase() !== base.address)
          .map((entry) => entry.address.toLowerCase()),
      ],
      uniswapV4PoolIds: pools.map((pool) => {
        if (!pool.poolId) throw new Error("missing pool id");
        return pool.poolId;
      }),
    };
  });
  if (draft.pools.some((pool) => !draft.networks.includes(pool.network)))
    throw new Error("pool chain not selected");
  const aaveV3Reserves = draft.protocols.includes("aave-v3")
    ? (draft.aaveV3Reserves ??
      catalog.reserves
        ?.filter((reserve) => reserve.available)
        .map((reserve) => reserve.token.address.toLowerCase()) ??
      [])
    : [];
  if (
    aaveV3Reserves.some(
      (address) =>
        !catalog.reserves?.some(
          (reserve) =>
            reserve.available &&
            reserve.active &&
            !reserve.frozen &&
            !reserve.paused &&
            !reserve.supplyCapReached &&
            reserve.token.address.toLowerCase() === address.toLowerCase() &&
            draft.tokens.some(
              (token) =>
                token.network === "arbitrum" &&
                token.address.toLowerCase() === address.toLowerCase(),
            ),
        ),
    )
  )
    throw new Error("Aave reserve unavailable");
  if (!draft.pools.length && !aaveV3Reserves.length) throw new Error("position required");
  if (draft.protocols.includes("aave-v3") && aaveV3Reserves.length === 0)
    throw new Error("selected Aave requires a reserve");
  const cap = draft.caps.networks.robinhood;
  if (draft.networks.includes("robinhood") && !cap) throw new Error("spoke cap missing");
  return v2MandateSelectionSchema.parse({
    chains,
    aaveV3Reserves,
    spokeCapPercent: cap && !cap.noCap ? cap.pct : null,
  });
}
