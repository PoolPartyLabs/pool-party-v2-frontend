/**
 * @id PP-MGR-LIB-051
 * @name manageModel tests
 * @implements-rules-version v1 (POO-2226)
 * @analytics-events none, focused read normalization tests.
 */
import { describe, expect, it } from "vitest";
import { mockFund, mockSpokeBalances } from "@/mocks/data/v2Funds";
import { manageProtocolMark, normalizeManageModel } from "./manageModel";

describe("Manage reads", () => {
  it("[R2] uses core + chain + position key, never symbols or pool identity", () => {
    const first = mockFund.positionsSummary?.positions[0];
    if (!first) throw new Error("fixture position");
    const fund = {
      ...mockFund,
      positionsSummary: {
        protocolVersion: "v2" as const,
        positions: [first, { ...first, chainId: "4663" }],
      },
    };
    const model = normalizeManageModel(fund);
    expect(new Set(model.positions.map((p) => p.id)).size).toBe(2);
    expect(model.positions[0]?.blockId).toBeNull();
    expect(model.positions[0]?.poolId).toBeNull();
    expect(
      normalizeManageModel({ ...fund, coreVault: `0x${"9".repeat(40)}` }).positions[0]?.id,
    ).not.toBe(model.positions[0]?.id);
  });
  it("[R3] pairs amount0/amount1 with token metadata in its original order and preserves raw precision", () => {
    const position = normalizeManageModel(mockFund).positions[1];
    expect(position?.tokens.map((t) => t.symbol)).toEqual(["USDC", "WETH"]);
    expect(position?.tokens[1]?.amount).toMatchObject({
      status: "available",
      value: { raw: "75000000000000000000", decimal: "75", decimals: 18 },
    });
    expect(position?.valueUsd).toMatchObject({ status: "available", value: "400000" });
  });
  it("[R3] preserves valid zero independently from unavailable quantities and USD", () => {
    const first = mockFund.positionsSummary?.positions[0];
    if (!first?.aave) throw new Error("fixture supply");
    const zero = {
      ...first,
      valueUsd: null,
      currentValueUsd: null,
      aave: {
        ...first.aave,
        currentBalance: { protocolVersion: "v2" as const, raw: "0", decimal: "0" },
      },
    };
    const position = normalizeManageModel({
      ...mockFund,
      positionsSummary: { protocolVersion: "v2", positions: [zero] },
    }).positions[0];
    expect(position?.tokens[0]?.amount).toMatchObject({
      status: "available",
      value: { raw: "0", decimal: "0" },
    });
    expect(position?.valueUsd.status).toBe("unavailable");
  });
  it("[R5,R6] never converts scalar cash, holder income, uncollected fees or an absent queue into balances", () => {
    const model = normalizeManageModel(mockFund, mockSpokeBalances);
    expect(
      model.chains.every(
        (c) => c.cash.length === 2 && c.cash.every((t) => t.amount.status === "unavailable"),
      ),
    ).toBe(true);
    expect(model.withdrawal.requested.status).toBe("unavailable");
    expect(model.withdrawal.stillNeeded.status).toBe("unavailable");
    expect(model.withdrawal.coveragePct.status).toBe("unavailable");
    expect(model.income.amount.status).toBe("unavailable");
    expect(model.chains[0]?.idle.amount).toMatchObject({
      status: "available",
      value: { decimal: "190000" },
    });
    expect(model.chains[0]?.idleSharePct).toMatchObject({ status: "available", value: "19" });
  });
  it("[R7] distinguishes missing positions from an empty authorized positions read", () => {
    expect(normalizeManageModel({ ...mockFund, positionsSummary: undefined }).positions).toEqual(
      [],
    );
    expect(
      normalizeManageModel({
        ...mockFund,
        positionsSummary: { protocolVersion: "v2", positions: [] },
      }).positions,
    ).toEqual([]);
  });
  it("[R2,R3] resolves protocol marks from known adapters and keeps unsupported adapters neutral", () => {
    expect(manageProtocolMark("aave-v3")).toBe("aaveSupply");
    expect(manageProtocolMark("uniswap-v4")).toBe("uniswapV4Pool");
    expect(manageProtocolMark("uniswap-v3")).toBe("uniswapV3Pool");
    expect(manageProtocolMark("unknown-adapter")).toBe("unknown");
  });
});
