/**
 * @id PP-MGR-LIB-077-TEST
 * @name chartModel tests
 * @description DEX Screener embed URL, pool and token chart identity, and the bounded analytics value.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8678-37675
 * @linear https://linear.app/yeildbay/issue/POO-2338
 * @implements-rules-version v1 (POO-2338)
 * @analytics-events none, pure model tests; the chart host owns events.
 *
 * The tests check the URL string only. They never fetch DEX Screener.
 */
import { describe, expect, it } from "vitest";
import { getWrappedNative, supportedChainMetas } from "@/lib/chains/config";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning/types";
import { USDC_MINT } from "../solana-preview/solanaSchemas";
import {
  buildChartUrl,
  CHART_EMBED_ORIGIN,
  CHART_EMBED_PARAMS,
  type ChartAvailability,
  type ChartMarket,
  chartAnalyticsMarket,
  chartPageUrl,
  resolvePoolChart,
  resolveTokenChart,
} from "./chartModel";

const V3_POOL = `0x${"c3".repeat(20)}`;
const V4_POOL_ID = `0x${"d4".repeat(32)}`;
const QUERY =
  "embed=1&theme=dark&trades=0&chartLeftToolbar=1&chartTheme=dark&chartStyle=1&chartType=usd&interval=60";

function marketOf(availability: ChartAvailability): ChartMarket {
  if (availability.status !== "available") throw new Error(`Unavailable: ${availability.reason}`);
  return availability.market;
}
function arbitrumUsdc(): string {
  const meta = supportedChainMetas.find((item) => item.apiNetworkId === "arbitrum");
  if (!meta) throw new Error("Missing arbitrum chain meta");
  return meta.usdc.address;
}

describe("buildChartUrl", () => {
  // @rule R1
  it("points to the DEX Screener embed, never to TradingView or Binance", () => {
    const url = buildChartUrl(
      marketOf(
        resolvePoolChart({
          network: "arbitrum",
          protocol: "uniswap-v4",
          poolAddress: V4_POOL_ID,
          label: "WETH / USDC",
        }),
      ),
    );
    expect(CHART_EMBED_ORIGIN).toBe("https://dexscreener.com");
    expect(new URL(url).origin).toBe("https://dexscreener.com");
    expect(url.toLowerCase()).not.toMatch(/tradingview|binance/);
  });

  // @rule R4
  it("sends only the verified embed parameters, with the left drawing toolbar and no info=0", () => {
    const url = new URL(
      buildChartUrl(
        marketOf(
          resolvePoolChart({
            network: "base",
            protocol: "uniswap-v3",
            poolAddress: V3_POOL,
            label: "WETH / USDC",
          }),
        ),
      ),
    );
    expect(url.search).toBe(`?${QUERY}`);
    expect([...url.searchParams.keys()]).toEqual(Object.keys(CHART_EMBED_PARAMS));
    expect(url.searchParams.get("chartLeftToolbar")).toBe("1");
    expect(url.searchParams.has("info")).toBe(false);
    expect(url.hash).toBe("");
  });

  // @rule R7
  it("puts only the chain slug and the public address in the URL", () => {
    const wallet = `0x${"a1".repeat(20)}`;
    const strategy = `0x${"b2".repeat(20)}`;
    const selection = {
      network: "polygon",
      protocol: "uniswap-v3" as const,
      poolAddress: V3_POOL,
      label: "Private label",
      wallet,
      strategy,
      userId: "user-4242",
      blockId: "block-7777",
    };
    const market = marketOf(resolvePoolChart(selection));
    const url = buildChartUrl({ ...market, ...selection, ...market });
    const parsed = new URL(url);
    expect(parsed.pathname.split("/").filter(Boolean)).toEqual(["polygon", V3_POOL]);
    expect(parsed.search).toBe(`?${QUERY}`);
    for (const value of [wallet, strategy, "user-4242", "block-7777", "Private"]) {
      expect(url.toLowerCase(), value).not.toContain(value.toLowerCase());
    }
  });

  // @rule R11
  it("links the attribution to the public DEX Screener page of the same pool", () => {
    const market = marketOf(
      resolvePoolChart({
        network: "arbitrum",
        protocol: "uniswap-v4",
        poolAddress: V4_POOL_ID,
        label: "WETH / USDC",
      }),
    );
    expect(chartPageUrl(market)).toBe(`https://dexscreener.com/arbitrum/${V4_POOL_ID}`);
  });
});

describe("resolvePoolChart", () => {
  // @rule R2
  it("opens the exact Uniswap v3 pool address on its chain slug", () => {
    const market = marketOf(
      resolvePoolChart({
        network: "arbitrum",
        protocol: "uniswap-v3",
        poolAddress: `0x${"C3".repeat(20)}`,
        label: "WETH / USDC",
      }),
    );
    expect(market).toEqual({
      kind: "pool",
      chain: "arbitrum",
      address: V3_POOL,
      label: "WETH / USDC",
      venue: "Uniswap v3",
    });
    expect(buildChartUrl(market)).toBe(`https://dexscreener.com/arbitrum/${V3_POOL}?${QUERY}`);
  });

  // @rule R2
  it("opens the bare Uniswap v4 PoolId (bytes32) on its chain slug", () => {
    const market = marketOf(
      resolvePoolChart({
        network: "robinhood",
        protocol: "uniswap-v4",
        poolAddress: V4_POOL_ID,
        label: "WETH / USDG",
      }),
    );
    expect(market.venue).toBe("Uniswap v4");
    expect(buildChartUrl(market)).toBe(`https://dexscreener.com/robinhood/${V4_POOL_ID}?${QUERY}`);
  });

  // @rule R5
  it("is unconfigured when the pool has no real address or PoolId", () => {
    for (const poolAddress of [null, undefined, "", "  ", "arb-v4-weth-usdc-5"]) {
      expect(
        resolvePoolChart({ network: "arbitrum", protocol: "uniswap-v4", poolAddress, label: "" }),
      ).toEqual({ status: "unavailable", reason: "unconfigured" });
    }
    // A v4 PoolId is bytes32 and a v3 pool is a 20-byte address. The wrong length is not a pool.
    expect(
      resolvePoolChart({
        network: "arbitrum",
        protocol: "uniswap-v4",
        poolAddress: V3_POOL,
        label: "",
      }),
    ).toEqual({ status: "unavailable", reason: "unconfigured" });
    expect(
      resolvePoolChart({
        network: "arbitrum",
        protocol: "uniswap-v3",
        poolAddress: V4_POOL_ID,
        label: "",
      }),
    ).toEqual({ status: "unavailable", reason: "unconfigured" });
  });

  // @rule R5
  it("is an unsupported pair on a network that is not in the verified chain list", () => {
    for (const network of ["ethereum", "solana", "42161", ""]) {
      expect(
        resolvePoolChart({ network, protocol: "uniswap-v4", poolAddress: V4_POOL_ID, label: "" }),
      ).toEqual({ status: "unavailable", reason: "unsupported_pair" });
    }
  });
});

describe("resolveTokenChart", () => {
  // @rule R3
  it("opens the token chart of an EVM asset with its lowercase address", () => {
    const usdc = arbitrumUsdc();
    const market = marketOf(
      resolveTokenChart({ network: "arbitrum", address: usdc, label: "USDC" }),
    );
    expect(market).toEqual({
      kind: "token",
      chain: "arbitrum",
      address: usdc.toLowerCase(),
      label: "USDC",
      venue: "Arbitrum",
    });
    expect(buildChartUrl(market)).toBe(
      `https://dexscreener.com/arbitrum/${usdc.toLowerCase()}?${QUERY}`,
    );
  });

  // @rule R3
  it("uses the wrapped native token address for the native token", () => {
    for (const network of ["arbitrum", "base", "polygon", "robinhood"]) {
      const wrapped = getWrappedNative(network)?.toLowerCase();
      expect(wrapped, network).toMatch(/^0x[0-9a-f]{40}$/);
      const market = marketOf(
        resolveTokenChart({ network, address: NATIVE_TOKEN_ADDRESS, label: "ETH" }),
      );
      expect(market.address, network).toBe(wrapped);
    }
  });

  // @rule R3
  it("keeps the case of a Solana mint", () => {
    const market = marketOf(
      resolveTokenChart({ network: "solana", address: USDC_MINT, label: "USDC" }),
    );
    expect(market.venue).toBe("Solana");
    expect(buildChartUrl(market)).toBe(`https://dexscreener.com/solana/${USDC_MINT}?${QUERY}`);
  });

  // @rule R5
  it("is unconfigured without an asset and unsupported on another network", () => {
    for (const address of [null, undefined, "", "not-an-address"]) {
      expect(resolveTokenChart({ network: "arbitrum", address, label: "" })).toEqual({
        status: "unavailable",
        reason: "unconfigured",
      });
    }
    expect(resolveTokenChart({ network: "solana", address: "0OIl-not-base58", label: "" })).toEqual(
      { status: "unavailable", reason: "unconfigured" },
    );
    expect(resolveTokenChart({ network: "ethereum", address: arbitrumUsdc(), label: "" })).toEqual({
      status: "unavailable",
      reason: "unsupported_pair",
    });
  });
});

describe("DEX Screener chain slug", () => {
  // @rule R2
  it("uses the app apiNetworkId of the pool chain as the URL chain slug", () => {
    for (const network of ["arbitrum", "base", "polygon", "robinhood"]) {
      const meta = supportedChainMetas.find((item) => item.apiNetworkId === network);
      expect(meta, network).toBeDefined();
      const url = buildChartUrl(
        marketOf(
          resolvePoolChart({
            network: meta?.apiNetworkId ?? "",
            protocol: "uniswap-v3",
            poolAddress: V3_POOL,
            label: "",
          }),
        ),
      );
      expect(new URL(url).pathname, network).toBe(`/${network}/${V3_POOL}`);
    }
  });
});

describe("chartAnalyticsMarket", () => {
  // @rule R9
  it("sends pool, token or unavailable, and never an address", () => {
    const pool = resolvePoolChart({
      network: "arbitrum",
      protocol: "uniswap-v4",
      poolAddress: V4_POOL_ID,
      label: "WETH / USDC",
    });
    const token = resolveTokenChart({ network: "solana", address: USDC_MINT, label: "USDC" });
    expect(chartAnalyticsMarket(pool)).toBe("pool");
    expect(chartAnalyticsMarket(token)).toBe("token");
    expect(chartAnalyticsMarket({ status: "unavailable", reason: "unconfigured" })).toBe(
      "unavailable",
    );
  });
});
