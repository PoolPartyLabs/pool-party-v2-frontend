/**
 * @id PP-MGR-LIB-077
 * @name chartModel
 * @description DEX Screener embed URL for the exact pool or asset of the selected block.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8678-37675
 * @linear https://linear.app/yeildbay/issue/POO-2338
 * @implements-rules-version v1 (POO-2338)
 * @analytics-events none, pure market and embed helpers; the chart host owns events.
 *
 * POO-2338 replaces the POO-2309 TradingView and Binance reference. The chart shows public
 * DEX Screener data for one pool or one token. It is not an execution quote, a position value or
 * a range. The URL holds only the chain slug and the public pool or token address (R7).
 * Build and Manage both use this file, so the same pool or asset gives the same URL (R6).
 */
import { getWrappedNative, networkDisplayName } from "@/lib/chains/config";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning/types";

export type ChartBlockReason =
  | "no_selection"
  | "unconfigured"
  | "unsupported_block"
  | "unsupported_pair";

/** Chain slugs that DEX Screener uses. They are the same as the app apiNetworkId values. */
export const DEXSCREENER_CHAINS = ["arbitrum", "base", "polygon", "robinhood", "solana"] as const;
export type DexScreenerChain = (typeof DEXSCREENER_CHAINS)[number];

export type ChartPoolProtocol = "uniswap-v3" | "uniswap-v4";

export interface ChartMarket {
  kind: "pool" | "token";
  chain: DexScreenerChain;
  /** Public pool address, bare v4 PoolId, token address or Solana mint. */
  address: string;
  /** Display only. It never goes into the URL or into analytics. */
  label: string;
  /** Display only: the pool protocol, or the network name of a token. */
  venue: string;
}

export type ChartAvailability =
  | { status: "available"; market: ChartMarket }
  | { status: "unavailable"; reason: ChartBlockReason };

export const CHART_EMBED_ORIGIN = "https://dexscreener.com";

/** The verified embed parameters, in URL order (R4). Do not add `info=0`. */
export const CHART_EMBED_PARAMS = {
  embed: "1",
  theme: "dark",
  trades: "0",
  chartLeftToolbar: "1",
  chartTheme: "dark",
  chartStyle: "1",
  chartType: "usd",
  interval: "60",
} as const satisfies Record<string, string>;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const POOL_ID = /^0x[0-9a-f]{64}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const POOL_VENUES: Record<ChartPoolProtocol, string> = {
  "uniswap-v3": "Uniswap v3",
  "uniswap-v4": "Uniswap v4",
};

function chartChain(network: string): DexScreenerChain | null {
  return (DEXSCREENER_CHAINS as readonly string[]).includes(network)
    ? (network as DexScreenerChain)
    : null;
}

function unavailable(reason: ChartBlockReason): ChartAvailability {
  return { status: "unavailable", reason };
}

export interface PoolChartInput {
  network: string;
  protocol: ChartPoolProtocol;
  /** v3: the pool contract address. v4: the bare PoolId (bytes32). */
  poolAddress: string | null | undefined;
  label: string;
}

/** The exact Uniswap pool chart (R2). A mock pool with no real address is unconfigured (R5). */
export function resolvePoolChart(input: PoolChartInput): ChartAvailability {
  const address = input.poolAddress?.trim() ?? "";
  if (!address) return unavailable("unconfigured");
  const chain = chartChain(input.network);
  // Solana pools (Orca, Raydium) have no canonical pool address in the app.
  if (!chain || chain === "solana") return unavailable("unsupported_pair");
  const pattern = input.protocol === "uniswap-v4" ? POOL_ID : EVM_ADDRESS;
  if (!pattern.test(address)) return unavailable("unconfigured");
  return {
    status: "available",
    market: {
      kind: "pool",
      chain,
      address: address.toLowerCase(),
      label: input.label,
      venue: POOL_VENUES[input.protocol],
    },
  };
}

export interface TokenChartInput {
  network: string;
  /** EVM token address, the native sentinel address, or a Solana mint. */
  address: string | null | undefined;
  label: string;
}

/** The token chart of a lending asset (R3). The native token uses its wrapped address. */
export function resolveTokenChart(input: TokenChartInput): ChartAvailability {
  const raw = input.address?.trim() ?? "";
  if (!raw) return unavailable("unconfigured");
  const chain = chartChain(input.network);
  if (!chain) return unavailable("unsupported_pair");
  if (chain === "solana") {
    if (!SOLANA_ADDRESS.test(raw)) return unavailable("unconfigured");
    return {
      status: "available",
      market: { kind: "token", chain, address: raw, label: input.label, venue: "Solana" },
    };
  }
  const address =
    raw.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase() ? getWrappedNative(chain) : raw;
  if (!address || !EVM_ADDRESS.test(address)) return unavailable("unconfigured");
  return {
    status: "available",
    market: {
      kind: "token",
      chain,
      address: address.toLowerCase(),
      label: input.label,
      venue: networkDisplayName(chain) ?? chain,
    },
  };
}

/** The public DEX Screener page. The attribution link opens it. */
export function chartPageUrl(market: ChartMarket): string {
  return `${CHART_EMBED_ORIGIN}/${market.chain}/${market.address}`;
}

/** The iframe URL (R4). Only the chain slug and the public address change (R7). */
// PP-INTEGRATION-POINT: public DEX Screener embed; no Pool Party price feed, position or wallet data is sent.
export function buildChartUrl(market: ChartMarket): string {
  return `${chartPageUrl(market)}?${new URLSearchParams(CHART_EMBED_PARAMS).toString()}`;
}

/** The bounded `chart_market` analytics value (R9). It never holds an address. */
export function chartAnalyticsMarket(
  availability: ChartAvailability,
): "pool" | "token" | "unavailable" {
  return availability.status === "available" ? availability.market.kind : "unavailable";
}
