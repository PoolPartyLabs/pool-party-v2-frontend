/**
 * @id PP-MGR-LIB-077-TEST
 * @name chart frame size tests
 * @linear https://linear.app/yeildbay/issue/POO-2350
 * @implements-rules-version v1 (POO-2350)
 * @analytics-events none, pure size tests.
 *
 * The Raydium chart frame has a minimum height that fits the DEX Screener embed. The other
 * chart sources keep their minimum height. The tests never fetch DEX Screener.
 */
import { describe, expect, it } from "vitest";
import {
  CHART_FRAME_MIN_HEIGHT_PX,
  type ChartMarket,
  chartFrameMinHeight,
  resolvePoolChart,
  resolveTokenChart,
} from "./chartModel";

const SOLANA_POOL = "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const EVM_POOL = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";

function market(result: ReturnType<typeof resolvePoolChart>): ChartMarket {
  if (result.status !== "available") throw new Error(result.reason);
  return result.market;
}

describe("POO-2350: the chart frame size", () => {
  // @rule R1
  it("[R1] gives a Raydium pool frame one height that is not smaller than the embed needs", () => {
    const raydium = market(
      resolvePoolChart({
        network: "solana",
        protocol: "raydium",
        poolAddress: SOLANA_POOL,
        label: "SOL / USDC",
      }),
    );
    const height = chartFrameMinHeight(raydium);
    expect(height).toBe(CHART_FRAME_MIN_HEIGHT_PX.raydium);
    expect(Number.isInteger(height)).toBe(true);
    // The embed needs its chart, its toolbar and its axis. A height below 360 px clips them.
    expect(height).toBeGreaterThanOrEqual(360);
  });

  // @rule R2
  it("[R2] makes the Raydium frame taller than the old minimum, and only a bit taller", () => {
    const raydium = market(
      resolvePoolChart({
        network: "solana",
        protocol: "raydium",
        poolAddress: SOLANA_POOL,
        label: "SOL / USDC",
      }),
    );
    expect(chartFrameMinHeight(raydium)).toBeGreaterThan(CHART_FRAME_MIN_HEIGHT_PX.base);
    expect(chartFrameMinHeight(raydium)).toBeLessThanOrEqual(480);
  });

  // @rule R3
  it("[R3] keeps the old minimum height for a Uniswap pool and for a token", () => {
    const uniswap = market(
      resolvePoolChart({
        network: "base",
        protocol: "uniswap-v3",
        poolAddress: EVM_POOL,
        label: "WETH / USDC",
      }),
    );
    const token = market(
      resolveTokenChart({ network: "solana", address: USDC_MINT, label: "USDC" }),
    );
    expect(CHART_FRAME_MIN_HEIGHT_PX.base).toBe(96);
    expect(chartFrameMinHeight(uniswap)).toBe(CHART_FRAME_MIN_HEIGHT_PX.base);
    expect(chartFrameMinHeight(token)).toBe(CHART_FRAME_MIN_HEIGHT_PX.base);
  });

  // @rule R4
  it("[R4] is a pure rule: the same market gives the same height, and the input is not changed", () => {
    const raydium = market(
      resolvePoolChart({
        network: "solana",
        protocol: "raydium",
        poolAddress: SOLANA_POOL,
        label: "SOL / USDC",
      }),
    );
    const copy = structuredClone(raydium);
    expect(chartFrameMinHeight(raydium)).toBe(chartFrameMinHeight(raydium));
    expect(raydium).toEqual(copy);
  });
});
