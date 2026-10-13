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
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { MandatePoolRef } from "./mandateDraft";
import { settlePoolSearches, solanaFailureNetwork } from "./poolSearchSettle";

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

describe("DEC-204: a failed read keeps its fallback pools and still counts as failed", () => {
  it("lists the fallback pools in the failed job's place and names its network", async () => {
    const eth = poolOf("eth-1", "arbitrum");
    const pinned = poolOf("solana:pinned", "solana");
    const result = await settlePoolSearches([
      { network: "arbitrum", run: () => Promise.resolve([eth]) },
      { network: "solana", run: unavailable, fallback: () => [pinned] },
    ]);
    expect(result.pools).toEqual([eth, pinned]);
    expect(result.failedNetworks).toEqual(["solana"]);
  });

  it("answers the fallback pools instead of throwing when every read fails", async () => {
    const pinned = poolOf("solana:pinned", "solana");
    const result = await settlePoolSearches([
      { network: "solana", run: unavailable, fallback: () => [pinned] },
    ]);
    expect(result).toEqual({ pools: [pinned], failedNetworks: ["solana"] });
  });

  it("never uses the fallback of a read that worked", async () => {
    const found = poolOf("solana:found", "solana");
    const fallback = vi.fn(() => [poolOf("solana:pinned", "solana")]);
    const result = await settlePoolSearches([
      { network: "solana", run: () => Promise.resolve([found]), fallback },
    ]);
    expect(result.pools).toEqual([found]);
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe("R10: the error event names the network only for a Solana failure", () => {
  // @rule R10
  it("gives solana for a Solana failure, and nothing when two networks failed or none is known", () => {
    expect(solanaFailureNetwork(["solana"])).toBe("solana");
    expect(solanaFailureNetwork(["solana", "solana"])).toBe("solana");
    // An EVM failure keeps the event it always had.
    expect(solanaFailureNetwork(["arbitrum"])).toBeUndefined();
    expect(solanaFailureNetwork(["arbitrum", "solana"])).toBeUndefined();
    expect(solanaFailureNetwork([])).toBeUndefined();
  });
});
