/**
 * @id PP-MGR-LIB-077-TEST
 * @name chartModel tests
 * @description Approved market identity, bounded widget settings and trusted-message regressions.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8678-37675
 * @linear https://linear.app/yeildbay/issue/POO-2309
 * @implements-rules-version v1 (POO-2309)
 * @analytics-events none, pure model tests; the chart host owns events.
 */
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import {
  buildChartUrl,
  CHART_WIDGET_ORIGIN,
  type ChartAsset,
  type ChartMarket,
  readChartMessage,
  resolveChartMarket,
} from "./chartModel";

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
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ARB_WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const WSOL = "So11111111111111111111111111111111111111112";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const asset = (network: string, address: string): ChartAsset => ({ network, address });

describe("resolveChartMarket", () => {
  // @rule R2: only approved network and contract identities resolve to the exchange reference.
  it.each([
    ["arbitrum", ARB_USDC, ARB_WETH],
    ["arbitrum", ARB_USDC, NATIVE_ETH],
    ["base", BASE_USDC, BASE_WETH],
    ["base", BASE_USDC, NATIVE_ETH],
  ])("resolves %s ETH identity %s / %s in either ordering", (network, usdc, eth) => {
    const tokens = [asset(network, eth), asset(network, usdc)];
    expect(resolveChartMarket(tokens)).toEqual({ status: "available", market: ETH_MARKET });
    expect(resolveChartMarket([...tokens].reverse())).toEqual({
      status: "available",
      market: ETH_MARKET,
    });
  });

  // @rule R2: EVM casing does not change an address identity.
  it("accepts mixed-case EVM addresses without reading symbol labels", () => {
    const tokens = [
      { ...asset("arbitrum", ARB_WETH.toUpperCase()), symbol: "FAKE" },
      { ...asset("arbitrum", ARB_USDC.toLowerCase()), symbol: "USDG" },
    ];
    expect(resolveChartMarket(tokens)).toEqual({ status: "available", market: ETH_MARKET });
  });

  // @rule R2: Solana identities remain case-sensitive and both orderings print the same reference.
  it("resolves exact Solana WSOL and USDC mints in either order", () => {
    const tokens = [asset("solana", WSOL), asset("solana", SOL_USDC)];
    expect(resolveChartMarket(tokens)).toEqual({ status: "available", market: SOL_MARKET });
    expect(resolveChartMarket([...tokens].reverse())).toEqual({
      status: "available",
      market: SOL_MARKET,
    });
  });

  // @rule R3: missing selection and incomplete configuration have distinct unavailable reasons.
  it("returns no_selection for an empty selection", () => {
    expect(resolveChartMarket([])).toEqual({ status: "unavailable", reason: "no_selection" });
  });

  // @rule R3: a partial configuration must not select a default symbol.
  it.each([
    [asset("arbitrum", ARB_WETH)],
    [asset("", ARB_WETH), asset("arbitrum", ARB_USDC)],
    [asset("arbitrum", " "), asset("arbitrum", ARB_USDC)],
  ])("returns unconfigured for partial identities %#", (...tokens) => {
    expect(resolveChartMarket(tokens)).toEqual({ status: "unavailable", reason: "unconfigured" });
  });

  // @rule R3: no USD/USDT substitution, unrelated network, duplicate or extra asset is inferred.
  it.each([
    [asset("arbitrum", ARB_WETH), asset("arbitrum", "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8")],
    [asset("arbitrum", ARB_WETH), asset("arbitrum", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9")],
    [asset("arbitrum", ARB_WETH), asset("base", BASE_USDC)],
    [asset("base", ARB_WETH), asset("base", BASE_USDC)],
    [asset("arbitrum", ARB_WETH), asset("arbitrum", ARB_WETH)],
    [asset("arbitrum", ARB_WETH), asset("arbitrum", ARB_USDC), asset("arbitrum", NATIVE_ETH)],
    [
      asset("polygon", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"),
      asset("polygon", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
    ],
    [asset("polygon", NATIVE_ETH), asset("polygon", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359")],
    [
      asset("robinhood", "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
      asset("robinhood", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
    ],
    [asset("ethereum", NATIVE_ETH), asset("ethereum", ARB_USDC)],
    [asset("solana", WSOL.toLowerCase()), asset("solana", SOL_USDC)],
    [asset("solana", WSOL), asset("solana", SOL_USDC.toLowerCase())],
    [asset("solana", NATIVE_ETH), asset("solana", SOL_USDC)],
  ])("rejects unsupported exact identities %#", (...tokens) => {
    expect(resolveChartMarket(tokens)).toEqual({
      status: "unavailable",
      reason: "unsupported_pair",
    });
  });
});

describe("buildChartUrl", () => {
  // @rule R1/R6: the official isolated Advanced Chart has real left tools and no symbol selector.
  it("configures the actual widget on its exact cross-origin path", () => {
    const url = new URL(buildChartUrl(ETH_MARKET, "en", "chart-1"));
    expect(CHART_WIDGET_ORIGIN).toBe("https://www.tradingview-widget.com");
    expect(url.origin).toBe(CHART_WIDGET_ORIGIN);
    expect(url.pathname).toBe("/embed-widget/advanced-chart/");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(JSON.parse(decodeURIComponent(url.hash.slice(1)))).toEqual({
      symbol: "BINANCE:ETHUSDC",
      interval: "D",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      autosize: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      allow_symbol_change: false,
      save_image: false,
      locale: "en",
      frameElementId: "chart-1",
    });
  });

  // @rule R5/R10: locales use vendor codes verified on the official embed, not guessed aliases.
  it.each([
    ["en", "en"],
    ["pt-BR", "br"],
    ["es", "es"],
    ["fr", "fr"],
    ["de", "de_DE"],
    // Dutch is not supported by TradingView. Only the iframe falls back; surrounding copy is nl.
    ["nl", "en"],
    ["ja", "ja"],
    ["ko", "kr"],
    ["zh-CN", "zh_CN"],
    ["zh-TW", "zh_TW"],
    ["vi", "vi_VN"],
    ["unknown", "en"],
  ])("maps %s to vendor locale %s", (locale, vendorLocale) => {
    const url = new URL(buildChartUrl(SOL_MARKET, locale, "locale-instance"));
    expect(url.searchParams.get("locale")).toBe(vendorLocale);
    expect(JSON.parse(decodeURIComponent(url.hash.slice(1))).locale).toBe(vendorLocale);
  });

  // @rule R10: adding an application locale needs an explicit vendor-language decision.
  it("covers every current configured locale", () => {
    expect([...locales]).toEqual([
      "en",
      "pt-BR",
      "es",
      "fr",
      "de",
      "nl",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "vi",
    ]);
  });

  // @rule R5/R6: public market and opaque instance configuration are safely URL-encoded.
  it("changes identity without adding app URL, token addresses or commands", () => {
    const id = 'opaque-<&"#?';
    const eth = buildChartUrl(ETH_MARKET, "en", id);
    const sol = buildChartUrl(SOL_MARKET, "en", "next-instance");
    expect(sol).not.toBe(eth);
    expect(JSON.parse(decodeURIComponent(new URL(eth).hash.slice(1))).frameElementId).toBe(id);
    expect(JSON.parse(decodeURIComponent(new URL(sol).hash.slice(1))).symbol).toBe(
      "BINANCE:SOLUSDC",
    );
    expect(eth).not.toContain("page-uri");
    expect(eth).not.toContain(ARB_USDC);
    expect(eth).not.toContain("set-symbol");
  });
});

describe("readChartMessage", () => {
  const frameWindow = {};
  const message = (name: string, frameElementId = "chart-1") => ({ name, frameElementId });
  const event = (data: unknown) => ({
    origin: "https://www.tradingview-widget.com",
    source: frameWindow,
    data,
  });

  // @rule R8: boot is not a verified data-ready or financial completion event.
  it("accepts load as boot and symbol-error as no-data", () => {
    expect(readChartMessage(event(message("tv-widget-load")), frameWindow, "chart-1")).toBe("boot");
    expect(readChartMessage(event(message("tv-widget-no-data")), frameWindow, "chart-1")).toBe(
      "no-data",
    );
  });

  // @rule R8: textual vendor messages are parsed safely.
  it("accepts the same bounded envelope as JSON text", () => {
    expect(
      readChartMessage(event(JSON.stringify(message("tv-widget-load"))), frameWindow, "chart-1"),
    ).toBe("boot");
  });

  // @rule R5/R8: old instances, foreign sources and lookalike origins cannot update the current chart.
  it.each([
    { ...event(message("tv-widget-load")), origin: "https://s.tradingview.com" },
    {
      ...event(message("tv-widget-load")),
      origin: "https://www.tradingview-widget.com.attacker.invalid",
    },
    { ...event(message("tv-widget-load")), origin: "http://www.tradingview-widget.com" },
    { ...event(message("tv-widget-load")), source: {} },
    { ...event(message("tv-widget-load")), source: null },
    { ...event(message("tv-widget-load")), source: undefined },
    event(message("tv-widget-load", "previous-instance")),
  ])("rejects an untrusted envelope %#", (input) => {
    expect(readChartMessage(input, frameWindow, "chart-1")).toBeNull();
  });

  // @rule R8: missing windows are never accepted, even when both sources have the same empty value.
  it.each([null, undefined])("rejects absent iframe window %s", (source) => {
    expect(
      readChartMessage({ ...event(message("tv-widget-load")), source }, source, "chart-1"),
    ).toBeNull();
  });

  // @rule R8: malformed data and unsupported callbacks do not throw or claim readiness.
  it.each([
    null,
    undefined,
    1,
    true,
    [],
    "{",
    "null",
    "[]",
    { name: "tv-widget-load" },
    { name: "tv-widget-load", frameElementId: 1 },
    message("tv-widget-ready"),
    message("tv-widget-resize-iframe"),
    message("openChartInPopup"),
  ])("ignores malformed or unsupported payload %#", (data) => {
    expect(readChartMessage(event(data), frameWindow, "chart-1")).toBeNull();
  });
});
