/**
 * @id PP-STR-LIB-011 (POO-810)
 * @name receiptDecode tests
 * @implements-rules-version v1
 *
 * The shared executor-side glue for the truthful receipts (POO-810): `positionCurrencies` maps a
 * client Position's per-token fee symbols + decimals into the `{ symbol, decimals }[]` the token-meta
 * resolver eliminates USDC against; `decodeReceipt` composes the wallet + chain + currencies into a
 * single decode call and NEVER throws (a decode/RPC failure yields null → the modal R9-falls-back).
 */
import { describe, expect, it, vi } from "vitest";
import type { Position } from "@/lib/schemas";
import { decodeReceipt, positionCurrencies } from "./receiptDecode";

const basePosition = {
  id: "0xpos",
  strategyId: "0xstrat",
  invested: 100,
  currentValue: 100,
  totalYield: 5,
  available: 5,
  reinvestment: "manual-payout",
  status: "active",
} as unknown as Position;

describe("positionCurrencies", () => {
  it("maps claimableFeeTokens symbols + decimals0/1 into currency metas", () => {
    const position = {
      ...basePosition,
      claimableFeeTokens: [
        { symbol: "USDC", amount: 1 },
        { symbol: "WETH", amount: 0.01 },
      ],
      decimals0: 6,
      decimals1: 18,
    } as unknown as Position;
    expect(positionCurrencies(position)).toEqual([
      { symbol: "USDC", decimals: 6 },
      { symbol: "WETH", decimals: 18 },
    ]);
  });

  it("returns undefined when the per-token symbols/decimals are absent (lean read)", () => {
    expect(positionCurrencies(basePosition)).toBeUndefined();
  });

  it("returns undefined when only symbols (no decimals) are present", () => {
    const position = {
      ...basePosition,
      claimableFeeTokens: [
        { symbol: "USDC", amount: 1 },
        { symbol: "WETH", amount: 0.01 },
      ],
    } as unknown as Position;
    expect(positionCurrencies(position)).toBeUndefined();
  });
});

describe("decodeReceipt", () => {
  it("returns null when there are no logs (R9 fallback trigger)", async () => {
    const result = await decodeReceipt({
      logs: [],
      wallet: "0x1111111111111111111111111111111111111111",
      chainId: 42161,
      position: basePosition,
    });
    expect(result).toBeNull();
  });

  it("returns null and never throws when decoding blows up (R9)", async () => {
    // A malformed logs input that would throw inside the pipeline still yields null, not a rejection.
    const result = await decodeReceipt({
      logs: [{ address: "0xbad", topics: [], data: "0x" }] as never,
      wallet: "0x1111111111111111111111111111111111111111",
      chainId: 42161,
      position: basePosition,
    });
    expect(result).toBeNull();
  });

  it("returns null for an unsupported chain (no USDC config) with only a USDC-shaped payout", async () => {
    // Guard: unknown chain still resolves to a safe null rather than crashing the success handler.
    const result = await decodeReceipt({
      logs: [],
      wallet: "0x1111111111111111111111111111111111111111",
      chainId: 99999,
      position: basePosition,
    });
    expect(result).toBeNull();
  });

  it("decodes a USDC-only payout into rows + usdcUsd (real path, injected read unused)", async () => {
    const { encodeEventTopics, numberToHex, pad } = await import("viem");
    const { erc20TransferEvent } = await import("@/contracts/erc20");
    const USER = "0x1111111111111111111111111111111111111111" as const;
    const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const; // Arbitrum USDC
    const topics = encodeEventTopics({
      abi: [erc20TransferEvent],
      eventName: "Transfer",
      args: { from: "0x2222222222222222222222222222222222222222", to: USER },
    }) as `0x${string}`[];
    const read = vi.fn();
    const result = await decodeReceipt({
      logs: [{ address: USDC, topics, data: pad(numberToHex(BigInt(7_000_000))) }],
      wallet: USER,
      chainId: 42161,
      position: basePosition,
      readMeta: read,
    });
    expect(result?.usdcUsd).toBeCloseTo(7, 6);
    expect(result?.rows).toEqual([{ symbol: "USDC", amount: 7, usd: 7 }]);
    expect(read).not.toHaveBeenCalled();
  });
});
