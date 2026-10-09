/**
 * @id PP-MGR-LIB-078
 * @name chartContext
 * @description Exact selected-block identity for approved market references without money fields.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8674-15508
 * @linear https://linear.app/yeildbay/issue/POO-2309
 * @implements-rules-version v1 (POO-2309)
 * @analytics-events none, private pure selection context; chart hosts own bounded events.
 */
import { apiNetworkForChain } from "@/lib/chains/config";
import type { PanelDraftTarget } from "../build/panel/usePanelDraft";
import { findMandatePool } from "../build/plan/blockConfig";
import type { PanelConfig } from "../build/plan/buildPlan";
import type { ManagePosition } from "../manage/manageModel";
import { type MandateDraft, normalizeTokenIdentity, tokenKey } from "../mandateDraft";
import { SOLANA_LOCAL_CONFIGS } from "../solana-preview/solanaBuilderRuntime";
import { USDC_MINT, WSOL_MINT } from "../solana-preview/solanaSchemas";
import {
  type ChartAsset,
  type ChartAvailability,
  type ChartBlockReason,
  resolveChartMarket,
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
  if ("catalogId" in config) return [config.catalogId, config.pair];
  return [];
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
  if (
    target.kind === "aaveSupply" ||
    target.kind === "aaveBorrow" ||
    target.kind === "solanaKaminoSupply"
  ) {
    return selected(configIdentity(config), unavailable("lending_reference"));
  }
  if (target.kind === "uniswapV4Pool" || target.kind === "uniswapV3Pool") {
    const poolId = config && "poolId" in config ? config.poolId : null;
    if (!poolId) return selected([null], unavailable("unconfigured"));
    const pool = findMandatePool(draft.pools, target.network, poolId);
    if (!pool) return selected([poolId.toLowerCase()], unavailable("unconfigured"));
    const tokens = [pool.token0, pool.token1].map(
      (token): ChartAsset => ({
        network: pool.network,
        address: normalizeTokenIdentity(pool.network, token.address),
      }),
    );
    const details = [poolId.toLowerCase(), pool.protocol, tokens];
    const protocol = target.kind === "uniswapV4Pool" ? "uniswap-v4" : "uniswap-v3";
    return selected(
      details,
      pool.network !== "solana" && pool.protocol === protocol
        ? resolveChartMarket(tokens)
        : unavailable("unsupported_pair"),
    );
  }
  if (target.kind === "swap") {
    if (!config || !("tokenInKey" in config) || !config.tokenInKey || !config.tokenOutKey) {
      return selected([null], unavailable("unconfigured"));
    }
    const keys = [config.tokenInKey, config.tokenOutKey];
    const rows = keys.map((key) => draft.tokens.find((token) => tokenKey(token) === key));
    const tokens = rows.flatMap((token): ChartAsset[] =>
      token
        ? [
            {
              network: token.network,
              address: normalizeTokenIdentity(token.network, token.address),
            },
          ]
        : [],
    );
    if (rows.some((token) => !token)) return selected([keys, tokens], unavailable("unconfigured"));
    return selected(
      [keys, tokens],
      rows.every((token) => token?.network === target.network)
        ? resolveChartMarket(tokens)
        : unavailable("unsupported_pair"),
    );
  }
  if (target.kind === "solanaOrcaPool" || target.kind === "solanaRaydiumPool") {
    const catalogId = config && "catalogId" in config ? config.catalogId : null;
    const pair = config && "pair" in config ? config.pair : null;
    const tokens = draft.tokens
      .filter((token) => token.network === "solana")
      .map((token): ChartAsset => ({ network: token.network, address: token.address }));
    const canonical = [WSOL_MINT, USDC_MINT].map((address) =>
      tokens.find((token) => token.address === address),
    );
    const details = [catalogId, pair, canonical];
    if (!catalogId || !pair) return selected(details, unavailable("unconfigured"));
    if (
      draft.runtime !== "solana-local" ||
      target.network !== "solana" ||
      catalogId !== SOLANA_LOCAL_CONFIGS[target.kind]?.catalogId ||
      (pair !== "SOL / USDC" && pair !== "USDC / SOL")
    ) {
      return selected(details, unavailable("unsupported_pair"));
    }
    if (canonical.some((token) => !token)) {
      return selected(
        details,
        unavailable(tokens.length < 2 ? "unconfigured" : "unsupported_pair"),
      );
    }
    return selected(
      details,
      resolveChartMarket(canonical.filter((token): token is ChartAsset => Boolean(token))),
    );
  }
  return selected(configIdentity(config), unavailable("unsupported_block"));
}

/** Current on-chain position identity owns drawings; values, ranges and drafts never do. */
export function manageChartSelection(position: ManagePosition | null): ChartSelection {
  if (!position) return { identity: null, availability: unavailable("no_selection") };
  const tokens = position.tokens.map(
    (token): ChartAsset => ({
      network: apiNetworkForChain(token.chainId) ?? String(token.chainId),
      address: token.address?.toLowerCase() ?? "",
    }),
  );
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
  if (position.kind === "supply")
    return { identity, availability: unavailable("lending_reference") };
  if (position.kind !== "liquidity")
    return { identity, availability: unavailable("unsupported_block") };
  if (tokens.length === 0) return { identity, availability: unavailable("unconfigured") };
  const network = apiNetworkForChain(position.chainId);
  if (
    position.network !== network ||
    position.tokens.some((token) => token.chainId !== position.chainId)
  ) {
    return { identity, availability: unavailable("unsupported_pair") };
  }
  return { identity, availability: resolveChartMarket(tokens) };
}
