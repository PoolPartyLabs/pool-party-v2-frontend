/**
 * @id PP-MGR-LIB-078
 * @name chartContext
 * @description Exact selected-block pool or asset identity for the DEX Screener chart, without money fields.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8674-15508
 * @linear https://linear.app/yeildbay/issue/POO-2338
 * @implements-rules-version v1 (POO-2338); POO-2343 rules v1 (R8 Raydium pool chart)
 * @analytics-events none, private pure selection context; chart hosts own bounded events.
 *
 * Build and Manage map the selection to the same chartModel resolvers (R6). A Uniswap block gives
 * its exact pool (R2). A lending block gives the token of its asset (R3). Other blocks and mock
 * pools stay unavailable (R5). A Raydium block with a pool address gives that pool (R8 of POO-2343).
 */
import { apiNetworkForChain } from "@/lib/chains/config";
import type { PanelDraftTarget } from "../build/panel/usePanelDraft";
import { findMandatePool, poolRefKey } from "../build/plan/blockConfig";
import type { PanelConfig } from "../build/plan/buildPlan";
import type { ManagePosition } from "../manage/manageModel";
import {
  type MandateDraft,
  type MandatePoolRef,
  normalizeTokenIdentity,
  tokenKey,
} from "../mandateDraft";
import { SOLANA_LOCAL_CONFIGS } from "../solana-preview/solanaBuilderRuntime";
import { USDC_MINT } from "../solana-preview/solanaSchemas";
import {
  type ChartAvailability,
  type ChartBlockReason,
  type ChartPoolProtocol,
  resolvePoolChart,
  resolveTokenChart,
} from "./chartModel";

export interface ChartSelection {
  /** Private app context only. Never pass this identity into the remote widget or analytics. */
  identity: string | null;
  availability: ChartAvailability;
}

const unavailable = (reason: ChartBlockReason): ChartAvailability => ({
  status: "unavailable",
  reason,
});

/** Config identity deliberately omits range, slippage, allocation and other financial fields. */
function configIdentity(config: PanelConfig | null): unknown[] {
  if (!config) return [null];
  if ("assetKey" in config) return [config.assetKey];
  if ("catalogId" in config) {
    return "poolAddress" in config
      ? [config.catalogId, config.pair, config.poolAddress]
      : [config.catalogId, config.pair];
  }
  return [];
}

function pairLabel(symbols: readonly string[]): string {
  return symbols.filter(Boolean).join(" / ");
}

/**
 * The address that DEX Screener knows for a mandate pool row. v4 uses the bare PoolId. v3 uses the
 * pool contract, but only when the row key is that contract. A real v3 row has key = address
 * (`mapDexPool`, then `mapUniswapPoolToMandatePool`). A mock row has a slug key and a fake address,
 * and must not open a chart of an unrelated address.
 */
function chartPoolAddress(
  pool: MandatePoolRef,
  protocol: "uniswap-v3" | "uniswap-v4",
): string | null {
  if (protocol === "uniswap-v4") return pool.poolId ?? null;
  return poolRefKey(pool).toLowerCase() === pool.address.toLowerCase() ? pool.address : null;
}

/** Resolve current panel intent, independently from the applied plan and its financial fields. */
export function buildChartSelection(
  draft: MandateDraft,
  target: PanelDraftTarget | null,
  config: PanelConfig | null,
): ChartSelection {
  if (!target) return { identity: null, availability: unavailable("no_selection") };
  const owner = ["build", draft.id, target.blockId, target.kind, target.network];
  const selected = (details: unknown[], availability: ChartAvailability): ChartSelection => ({
    identity: JSON.stringify([...owner, ...details]),
    availability,
  });
  if (target.kind === "uniswapV4Pool" || target.kind === "uniswapV3Pool") {
    const poolId = config && "poolId" in config ? config.poolId : null;
    if (!poolId) return selected([null], unavailable("unconfigured"));
    const pool = findMandatePool(draft.pools, target.network, poolId);
    if (!pool) return selected([poolId.toLowerCase()], unavailable("unconfigured"));
    const protocol = target.kind === "uniswapV4Pool" ? "uniswap-v4" : "uniswap-v3";
    const address = chartPoolAddress(pool, protocol);
    const details = [poolId.toLowerCase(), pool.protocol, address?.toLowerCase() ?? null];
    if (pool.network === "solana" || pool.protocol !== protocol) {
      return selected(details, unavailable("unsupported_pair"));
    }
    return selected(
      details,
      resolvePoolChart({
        network: pool.network,
        protocol,
        poolAddress: address,
        label: pairLabel([pool.token0.symbol, pool.token1.symbol]),
      }),
    );
  }
  if (target.kind === "aaveSupply" || target.kind === "aaveBorrow") {
    const assetKey = config && "assetKey" in config ? config.assetKey : null;
    if (!assetKey) return selected([null], unavailable("unconfigured"));
    const wanted = normalizeTokenIdentity(target.network, assetKey);
    const token = draft.tokens.find(
      (row) => row.network === target.network && tokenKey(row) === wanted,
    );
    const details = [wanted];
    if (!token) return selected(details, unavailable("unconfigured"));
    return selected(
      details,
      resolveTokenChart({ network: token.network, address: token.address, label: token.symbol }),
    );
  }
  if (target.kind === "solanaKaminoSupply") {
    const details = configIdentity(config);
    const catalogId = config && "catalogId" in config ? config.catalogId : null;
    if (!catalogId) return selected(details, unavailable("unconfigured"));
    if (
      target.network !== "solana" ||
      catalogId !== SOLANA_LOCAL_CONFIGS.solanaKaminoSupply?.catalogId
    ) {
      return selected(details, unavailable("unsupported_pair"));
    }
    // The Kamino block supplies USDC, so its chart is the USDC mint. "USDC" is a proper name, not
    // copy.
    return selected(
      details,
      resolveTokenChart({ network: "solana", address: USDC_MINT, label: "USDC" }),
    );
  }
  if (target.kind === "solanaOrcaPool" || target.kind === "solanaRaydiumPool") {
    const details = configIdentity(config);
    const catalogId = config && "catalogId" in config ? config.catalogId : null;
    // R8 (POO-2343): a Raydium block with a pool address shows that pool on DEX Screener.
    const poolAddress = config && "poolAddress" in config ? config.poolAddress : undefined;
    if (target.kind === "solanaRaydiumPool" && target.network === "solana" && poolAddress) {
      return selected(
        details,
        resolvePoolChart({
          network: "solana",
          protocol: "raydium",
          poolAddress,
          label: config && "pair" in config ? config.pair : "",
        }),
      );
    }
    // Orca has no pool chart, and a Raydium block with no pool address has no exact pool.
    return selected(details, unavailable(catalogId ? "unsupported_pair" : "unconfigured"));
  }
  return selected(configIdentity(config), unavailable("unsupported_block"));
}

function manageProtocol(position: ManagePosition): ChartPoolProtocol | null {
  const kind = position.source.adapterKind;
  return kind === "uniswap-v4" || kind === "uniswap-v3" ? kind : null;
}

/** Current on-chain position identity owns drawings; values, ranges and drafts never do. */
export function manageChartSelection(position: ManagePosition | null): ChartSelection {
  if (!position) return { identity: null, availability: unavailable("no_selection") };
  const tokens = position.tokens.map((token) => ({
    network: apiNetworkForChain(token.chainId) ?? String(token.chainId),
    address: token.address?.toLowerCase() ?? "",
  }));
  const identity = JSON.stringify([
    "manage",
    position.core,
    position.id,
    position.kind,
    position.chainId,
    position.network,
    position.poolId,
    tokens,
  ]);
  const result = (availability: ChartAvailability): ChartSelection => ({ identity, availability });
  if (position.kind !== "supply" && position.kind !== "liquidity") {
    return result(unavailable("unsupported_block"));
  }
  if (
    position.network !== apiNetworkForChain(position.chainId) ||
    position.tokens.some((token) => token.chainId !== position.chainId)
  ) {
    return result(unavailable("unsupported_pair"));
  }
  if (position.kind === "supply") {
    const [asset] = position.tokens;
    if (!asset) return result(unavailable("unconfigured"));
    return result(
      resolveTokenChart({ network: position.network, address: asset.address, label: asset.symbol }),
    );
  }
  const protocol = manageProtocol(position);
  if (!protocol) return result(unavailable("unsupported_block"));
  return result(
    resolvePoolChart({
      network: position.network,
      protocol,
      poolAddress: position.poolId,
      label: pairLabel(position.tokens.map((token) => token.symbol)),
    }),
  );
}
