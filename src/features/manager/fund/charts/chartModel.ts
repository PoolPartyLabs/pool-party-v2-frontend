/**
 * @id PP-MGR-LIB-077
 * @name chartModel
 * @description Approved market references, isolated widget configuration and trusted messages.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8678-37675
 * @linear https://linear.app/yeildbay/issue/POO-2309
 * @implements-rules-version v1 (POO-2309)
 * @analytics-events none, pure market and embed helpers; the chart host owns events.
 *
 * These references describe Binance exchange markets, never a pool price, execution quote,
 * position valuation or liquidity range. Contract/mint identity authorizes only the reference.
 */
import type { Locale } from "@/i18n/config";
import { supportedChainMetas } from "@/lib/chains/config";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning/types";
import { USDC_MINT, WSOL_MINT } from "../solana-preview/solanaSchemas";

export interface ChartAsset {
  network: string;
  address: string;
}

export type ChartBlockReason =
  | "no_selection"
  | "unconfigured"
  | "unsupported_block"
  | "lending_reference"
  | "unsupported_pair";

export interface ChartMarket {
  id: "eth-usdc" | "sol-usdc";
  symbol: "BINANCE:ETHUSDC" | "BINANCE:SOLUSDC";
  pair: "ETH / USDC" | "SOL / USDC";
  venue: "Binance";
}

export type ChartAvailability =
  | { status: "available"; market: ChartMarket }
  | { status: "unavailable"; reason: ChartBlockReason };

export const CHART_WIDGET_ORIGIN = "https://www.tradingview-widget.com";

const ETH_MARKET: ChartMarket = {
  id: "eth-usdc",
  symbol: "BINANCE:ETHUSDC",
  pair: "ETH / USDC",
  venue: "Binance",
};
const SOL_MARKET: ChartMarket = {
  id: "sol-usdc",
  symbol: "BINANCE:SOLUSDC",
  pair: "SOL / USDC",
  venue: "Binance",
};

/** Both orderings deliberately display the same canonical exchange reference. */
export function resolveChartMarket(tokens: readonly ChartAsset[]): ChartAvailability {
  if (tokens.length === 0) return { status: "unavailable", reason: "no_selection" };
  if (tokens.length < 2 || tokens.some((token) => !token.network.trim() || !token.address.trim())) {
    return { status: "unavailable", reason: "unconfigured" };
  }
  const [first, second] = tokens;
  if (tokens.length !== 2 || !first || !second || first.network !== second.network) {
    return { status: "unavailable", reason: "unsupported_pair" };
  }

  if (first.network === "solana") {
    if (
      (first.address === WSOL_MINT && second.address === USDC_MINT) ||
      (second.address === WSOL_MINT && first.address === USDC_MINT)
    ) {
      return { status: "available", market: { ...SOL_MARKET } };
    }
  } else if (first.network === "arbitrum" || first.network === "base") {
    const chain = supportedChainMetas.find((meta) => meta.apiNetworkId === first.network);
    if (chain?.usdc.symbol === "USDC" && chain.chain.nativeCurrency.symbol === "ETH") {
      const usdc = chain.usdc.address.toLowerCase();
      const weth = chain.wrappedNative.toLowerCase();
      const isEth = (address: string) => address === weth || address === NATIVE_TOKEN_ADDRESS;
      const a = first.address.toLowerCase();
      const b = second.address.toLowerCase();
      if ((a === usdc && isEth(b)) || (b === usdc && isEth(a))) {
        return { status: "available", market: { ...ETH_MARKET } };
      }
    }
  }
  return { status: "unavailable", reason: "unsupported_pair" };
}

// Verified against the official Advanced Chart HTML locale and language bundle on 2026-10-09.
// TradingView has no Dutch widget translation; surrounding app copy remains in Dutch.
const WIDGET_LOCALES = {
  en: "en",
  "pt-BR": "br",
  es: "es",
  fr: "fr",
  de: "de_DE",
  nl: "en",
  ja: "ja",
  ko: "kr",
  "zh-CN": "zh_CN",
  "zh-TW": "zh_TW",
  vi: "vi_VN",
} as const satisfies Record<Locale, string>;

/** Exact URL structure emitted by the official loader, without executing it in the wallet page. */
export function buildChartUrl(market: ChartMarket, locale: string, instanceId: string): string {
  const widgetLocale = Object.hasOwn(WIDGET_LOCALES, locale)
    ? WIDGET_LOCALES[locale as Locale]
    : "en";
  // PP-INTEGRATION-POINT: public TradingView market reference; no custom OHLC/position feed is sent.
  const url = new URL("/embed-widget/advanced-chart/", CHART_WIDGET_ORIGIN);
  url.searchParams.set("locale", widgetLocale);
  url.hash = encodeURIComponent(
    JSON.stringify({
      symbol: market.symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      autosize: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      allow_symbol_change: false,
      save_image: false,
      locale: widgetLocale,
      frameElementId: instanceId,
    }),
  );
  return url.toString();
}

/** Accept only the current remote frame's bounded boot/error envelope, never financial data. */
export function readChartMessage(
  event: { origin: string; source: unknown; data: unknown },
  frameWindow: unknown,
  instanceId: string,
): "boot" | "no-data" | null {
  if (
    frameWindow === null ||
    frameWindow === undefined ||
    event.source === null ||
    event.source === undefined ||
    event.source !== frameWindow ||
    event.origin !== CHART_WIDGET_ORIGIN
  ) {
    return null;
  }
  let payload: unknown = event.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const envelope = payload as Record<string, unknown>;
  if (envelope.frameElementId !== instanceId) return null;
  if (envelope.name === "tv-widget-load") return "boot";
  if (envelope.name === "tv-widget-no-data") return "no-data";
  return null;
}
