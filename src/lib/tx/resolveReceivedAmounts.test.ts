/**
 * @id PP-CORE-LIB-044 (POO-810)
 * @name resolveReceivedAmounts tests
 * @implements-rules-version v1
 *
 * The async orchestrator behind the truthful receipts (POO-810): decode the receipt `Transfer`-to-
 * user legs, resolve each leg's `{ symbol, decimals }`, and produce the display rows + the USDC USD
 * total in one call. The on-chain read is injected, so this unit-tests with fixture logs + a mocked
 * read (no live chain). Empty/absent logs → the empty result (R9 fallback trigger at the call site).
 */
import { encodeEventTopics, numberToHex, pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import { erc20TransferEvent } from "@/contracts/erc20";
import type { ReceiptLog } from "./decodeExecutedAmounts";
import { resolveReceivedAmounts } from "./resolveReceivedAmounts";

const USER = "0x1111111111111111111111111111111111111111" as const;
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as const;
const POOL = "0x2222222222222222222222222222222222222222" as const;
const CHAIN_ID = 42161;

function transferLog(
  token: `0x${string}`,
  from: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
): ReceiptLog {
  // A fully-specified {from,to} yields three concrete indexed topics (never null).
  const topics = encodeEventTopics({
    abi: [erc20TransferEvent],
    eventName: "Transfer",
    args: { from, to },
  }) as `0x${string}`[];
  return { address: token, topics, data: pad(numberToHex(value)) };
}

describe("resolveReceivedAmounts", () => {
  it("returns the empty result when logs are absent (R9 fallback trigger)", async () => {
    // @rule R9
    const result = await resolveReceivedAmounts({
      logs: [],
      userWallet: USER,
      chainId: CHAIN_ID,
      usdcAddress: USDC,
      currencies: undefined,
      readMeta: vi.fn(),
    });
    expect(result).toEqual({ rows: [], usdcUsd: 0, hasUnpricedLeg: false });
  });

  it("decodes + resolves a USDC refund to a USD total, no on-chain read (invest R2/R4)", async () => {
    // @rule R2
    const read = vi.fn();
    const result = await resolveReceivedAmounts({
      logs: [transferLog(USDC, POOL, USER, BigInt(3_500_000))],
      userWallet: USER,
      chainId: CHAIN_ID,
      usdcAddress: USDC,
      currencies: [
        { symbol: "USDC", decimals: 6 },
        { symbol: "WETH", decimals: 18 },
      ],
      readMeta: read,
    });
    expect(result.usdcUsd).toBeCloseTo(3.5, 6);
    expect(result.rows).toEqual([{ symbol: "USDC", amount: 3.5, usd: 3.5 }]);
    expect(read).not.toHaveBeenCalled();
  });

  it("resolves a mixed pair from the position currencies (collect/withdraw R5/R6)", async () => {
    // @rule R5
    const read = vi.fn();
    const result = await resolveReceivedAmounts({
      logs: [
        transferLog(USDC, POOL, USER, BigInt(10_000_000)),
        transferLog(WETH, POOL, USER, BigInt(2_000_000_000_000_000)),
      ],
      userWallet: USER,
      chainId: CHAIN_ID,
      usdcAddress: USDC,
      currencies: [
        { symbol: "USDC", decimals: 6 },
        { symbol: "WETH", decimals: 18 },
      ],
      readMeta: read,
    });
    expect(result.usdcUsd).toBeCloseTo(10, 6);
    expect(result.rows).toEqual([
      { symbol: "USDC", amount: 10, usd: 10 },
      { symbol: "WETH", amount: 0.002 },
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it("reads on-chain for the non-USDC leg when currencies are missing (R7)", async () => {
    // @rule R7
    const read = vi.fn().mockResolvedValue({ symbol: "ARB", decimals: 18 });
    const result = await resolveReceivedAmounts({
      logs: [transferLog(WETH, POOL, USER, BigInt(1_000_000_000_000_000_000))],
      userWallet: USER,
      chainId: CHAIN_ID,
      usdcAddress: USDC,
      currencies: undefined,
      readMeta: read,
    });
    expect(result.rows).toEqual([{ symbol: "ARB", amount: 1 }]);
    expect(read).toHaveBeenCalledWith(WETH, CHAIN_ID);
  });

  // @rule POO-844 R1 — a leg whose meta cannot resolve is kept as a RAW base-unit row (labelled by a
  // short address, no `usd`) and flips `hasUnpricedLeg`, keeping the resolved USDC leg. It used to be
  // dropped, which understated an X/USDC pair receipt by collapsing it to the USDC leg alone.
  it("[POO-844] keeps an unresolvable leg as a raw row + hasUnpricedLeg (was dropped)", async () => {
    const read = vi.fn().mockRejectedValue(new Error("rpc down"));
    const result = await resolveReceivedAmounts({
      logs: [
        transferLog(USDC, POOL, USER, BigInt(4_000_000)),
        transferLog(WETH, POOL, USER, BigInt(5)),
      ],
      userWallet: USER,
      chainId: CHAIN_ID,
      usdcAddress: USDC,
      currencies: undefined,
      readMeta: read,
    });
    expect(result.usdcUsd).toBeCloseTo(4, 6);
    expect(result.hasUnpricedLeg).toBe(true);
    expect(result.rows).toEqual([
      { symbol: "USDC", amount: 4, usd: 4 },
      // Raw base-unit value (5), short address label, no USD.
      { symbol: `${WETH.slice(0, 6)}…${WETH.slice(-4)}`, amount: 5 },
    ]);
  });
});
