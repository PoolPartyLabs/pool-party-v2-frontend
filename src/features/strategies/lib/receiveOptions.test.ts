/**
 * @id PP-STR-LIB-002 (POO-403)
 * @name strategyReceiveOptions.test
 * @implements-rules-version v1
 *
 * R4: the "Receive as" picker must offer the strategy's tokens. Manager-defined `receiveTokens`
 * wins; otherwise derive USDC + the pool pair from `poolPair`; otherwise USDC-only.
 * POO-481 R1: `withdrawReceiveOptions` is the Withdraw-specific BINARY variant (USDC or the pool
 * pair) whose pair resolves from real data the modal already holds, so real mode stops collapsing
 * to USDC-only.
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy, StrategyDetail } from "@/lib/schemas";
import { strategyReceiveOptions, withdrawReceiveOptions } from "./receiveOptions";

/** Minimal detail stub — only the fields the helper reads. */
function detail(partial: Partial<StrategyDetail>): StrategyDetail {
  return partial as StrategyDetail;
}

/** Minimal strategy/position stubs — only the fields the binary helper reads. */
const asStrategy = (partial: Partial<Strategy>): Strategy => partial as Strategy;
const asPosition = (partial: Partial<Position>): Position => partial as Position;

describe("withdrawReceiveOptions (POO-481 R1)", () => {
  it("prefers the position's claimableFeeTokens (real per-token data) over any pair field", () => {
    const result = withdrawReceiveOptions(
      asStrategy({ poolPair: { token0: "AAA", token1: "BBB" } }),
      asPosition({
        claimableFeeTokens: [
          { symbol: "ETH", amount: 0.05 },
          { symbol: "USDC", amount: 145 },
        ],
      }),
    );
    expect(result.options).toEqual(["USDC", "ETH / USDC"]);
    expect(result.pairTokens).toEqual(["ETH", "USDC"]);
    expect(result.pairLabel).toBe("ETH / USDC");
  });

  it("falls back to the detail poolPair (mock strategies)", () => {
    const result = withdrawReceiveOptions(
      asStrategy({ detail: detail({ poolPair: { token0: "WETH", token1: "ARB" } }) }),
      asPosition({}),
    );
    expect(result.options).toEqual(["USDC", "WETH / ARB"]);
  });

  it("falls back to the TOP-LEVEL strategy poolPair (the real-mode mapper shape)", () => {
    // mapStrategy never sets `detail` but does map strategy.poolPair; this is the reported bug.
    const result = withdrawReceiveOptions(
      asStrategy({ poolPair: { token0: "ETH", token1: "USDC" } }),
      asPosition({}),
    );
    expect(result.options).toEqual(["USDC", "ETH / USDC"]);
    expect(result.pairTokens).toEqual(["ETH", "USDC"]);
  });

  it("degrades to USDC-only when no pair source exists (never fabricated)", () => {
    const result = withdrawReceiveOptions(asStrategy({}), undefined);
    expect(result.options).toEqual(["USDC"]);
    expect(result.pairTokens).toBeUndefined();
    expect(result.pairLabel).toBeUndefined();
  });
});

describe("strategyReceiveOptions", () => {
  it("uses the manager-defined receiveTokens verbatim when present (R4)", () => {
    expect(strategyReceiveOptions(detail({ receiveTokens: ["USDC", "USDT", "DAI"] }))).toEqual([
      "USDC",
      "USDT",
      "DAI",
    ]);
  });

  it("derives USDC + the pool pair when receiveTokens is absent (R4)", () => {
    expect(strategyReceiveOptions(detail({ poolPair: { token0: "WETH", token1: "ARB" } }))).toEqual(
      ["USDC", "WETH", "ARB"],
    );
  });

  it("dedupes USDC when the pool already contains it (R4)", () => {
    expect(
      strategyReceiveOptions(detail({ poolPair: { token0: "USDC", token1: "WETH" } })),
    ).toEqual(["USDC", "WETH"]);
  });

  it("prefers manager receiveTokens over the pool pair when both exist", () => {
    expect(
      strategyReceiveOptions(
        detail({ receiveTokens: ["USDC", "USDT"], poolPair: { token0: "WETH", token1: "ARB" } }),
      ),
    ).toEqual(["USDC", "USDT"]);
  });

  it("falls back to USDC-only when neither field is present (honest default)", () => {
    expect(strategyReceiveOptions(detail({}))).toEqual(["USDC"]);
    expect(strategyReceiveOptions(undefined)).toEqual(["USDC"]);
  });
});
