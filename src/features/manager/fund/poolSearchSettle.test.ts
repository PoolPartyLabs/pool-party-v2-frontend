/**
 * @id PP-MGR-CMP-107
 * @name poolSearchSettle tests
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, pure logic
 *
 * R5: one failed network read must not erase the pools of the other networks. A mandate that holds
 * Ethereum and Solana keeps its Ethereum pools when DEX Screener is down, and the step shows an
 * error with Retry for the Solana part only.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { MandatePoolRef } from "./mandateDraft";
import { settlePoolSearches } from "./poolSearchSettle";

function poolOf(id: string, network: MandatePoolRef["network"]): MandatePoolRef {
  const token = { address: "0x1", symbol: "T", name: "T", logoUrl: null };
  return {
    id,
    address: id,
    network,
    protocol: network === "solana" ? "raydium" : "uniswap-v3",
    token0: token,
    token1: token,
    feeBps: null,
    feeTier: null,
    tvlUsd: null,
    aprPct: null,
    tierSharePct: null,
    hasHook: false,
  } as MandatePoolRef;
}

const unavailable = () => Promise.reject(new ApiError(502, "RAYDIUM_UNAVAILABLE", "unavailable"));

describe("R5: a failed network read keeps the pools of the other networks", () => {
  // @rule R5
  it("keeps the EVM pools and names Solana as the failed part, in a mixed mandate", async () => {
    const eth = poolOf("eth-1", "arbitrum");
    const result = await settlePoolSearches([
      { network: "arbitrum", run: () => Promise.resolve([eth]) },
      { network: "solana", run: unavailable },
    ]);
    expect(result.pools).toEqual([eth]);
    expect(result.failedNetworks).toEqual(["solana"]);
  });

  // @rule R5
  it("throws when every read fails, so a one-network mandate keeps its error state", async () => {
    await expect(
      settlePoolSearches([{ network: "solana", run: unavailable }]),
    ).rejects.toMatchObject({ code: "RAYDIUM_UNAVAILABLE" });
  });

  // @rule R5
  it("reports no failed network and dedupes by pool id when every read succeeds", async () => {
    const eth = poolOf("eth-1", "arbitrum");
    const result = await settlePoolSearches([
      { network: "arbitrum", run: () => Promise.resolve([eth]) },
      { network: "arbitrum", run: () => Promise.resolve([eth]) },
    ]);
    expect(result.pools).toEqual([eth]);
    expect(result.failedNetworks).toEqual([]);
  });
});
