/**
 * @id PP-CORE-LIB-041 (POO-810)
 * @name decodeExecutedAmounts tests
 * @implements-rules-version v1
 *
 * The pure receipt decode (POO-810 R2/R8): sums ERC-20 `Transfer(_, to = user, value)` per token
 * (emitter = `log.address`), flags the USDC leg, and tallies the USDC total. Fixture logs are real
 * Transfer log shapes (topic0 signature + indexed from/to topics + a 32-byte value). Non-Transfer
 * logs, transfers to other recipients, and malformed logs are ignored; a missing/empty logs list
 * yields the empty result (the R9 fallback trigger).
 */
import { encodeEventTopics, numberToHex, pad } from "viem";
import { describe, expect, it } from "vitest";
import { erc20TransferEvent } from "@/contracts/erc20";
import { decodeExecutedAmounts, type ReceiptLog } from "./decodeExecutedAmounts";

const USER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x9999999999999999999999999999999999999999" as const;
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const; // Arbitrum USDC
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as const;
const POOL = "0x2222222222222222222222222222222222222222" as const;

/** Build a real-shaped ERC-20 Transfer log emitted by `token` for `from → to` of `value`. */
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

describe("decodeExecutedAmounts", () => {
  it("returns the empty result when there are no logs (R9 fallback trigger)", () => {
    // @rule R9
    const result = decodeExecutedAmounts({ logs: [], userWallet: USER, usdcAddress: USDC });
    expect(result.perToken).toEqual([]);
    expect(result.usdcReceived).toBe(BigInt(0));
  });

  it("returns the empty result when logs is undefined (R1/R9: node omitted logs)", () => {
    // @rule R9
    const result = decodeExecutedAmounts({ logs: undefined, userWallet: USER, usdcAddress: USDC });
    expect(result.perToken).toEqual([]);
    expect(result.usdcReceived).toBe(BigInt(0));
  });

  it("decodes a USDC refund to the user and flags it as USDC (invest R2)", () => {
    // @rule R2
    const logs = [transferLog(USDC, POOL, USER, BigInt(3_500_000))]; // 3.5 USDC refunded
    const result = decodeExecutedAmounts({ logs, userWallet: USER, usdcAddress: USDC });
    expect(result.perToken).toHaveLength(1);
    expect(result.perToken[0]).toMatchObject({ isUsdc: true, rawValue: BigInt(3_500_000) });
    expect(result.usdcReceived).toBe(BigInt(3_500_000));
  });

  it("identifies the USDC leg case-insensitively against the configured address (R7)", () => {
    // @rule R7
    const logs = [transferLog(USDC.toLowerCase() as `0x${string}`, POOL, USER, BigInt(1_000_000))];
    const result = decodeExecutedAmounts({
      logs,
      userWallet: USER.toUpperCase() as `0x${string}`,
      usdcAddress: USDC.toUpperCase() as `0x${string}`,
    });
    expect(result.perToken[0]?.isUsdc).toBe(true);
    expect(result.usdcReceived).toBe(BigInt(1_000_000));
  });

  it("decodes a mixed pair to the user: USDC leg + non-USDC token leg (collect/withdraw R2/R3)", () => {
    // @rule R2
    const logs = [
      transferLog(USDC, POOL, USER, BigInt(12_340_000)), // 12.34 USDC
      transferLog(WETH, POOL, USER, BigInt(5_000_000_000_000_000)), // 0.005 WETH
    ];
    const result = decodeExecutedAmounts({ logs, userWallet: USER, usdcAddress: USDC });
    expect(result.perToken).toHaveLength(2);
    const usdc = result.perToken.find((t) => t.isUsdc);
    const weth = result.perToken.find((t) => !t.isUsdc);
    expect(usdc?.rawValue).toBe(BigInt(12_340_000));
    expect(weth?.address.toLowerCase()).toBe(WETH.toLowerCase());
    expect(weth?.rawValue).toBe(BigInt(5_000_000_000_000_000));
    expect(result.usdcReceived).toBe(BigInt(12_340_000));
  });

  it("sums multiple Transfer legs of the same token to the user (R2)", () => {
    // @rule R2
    const logs = [
      transferLog(USDC, POOL, USER, BigInt(1_000_000)),
      transferLog(USDC, OTHER, USER, BigInt(2_500_000)),
    ];
    const result = decodeExecutedAmounts({ logs, userWallet: USER, usdcAddress: USDC });
    expect(result.perToken).toHaveLength(1);
    expect(result.perToken[0]?.rawValue).toBe(BigInt(3_500_000));
    expect(result.usdcReceived).toBe(BigInt(3_500_000));
  });

  it("ignores Transfers whose recipient is not the user (R2)", () => {
    // @rule R2
    const logs = [
      transferLog(USDC, USER, POOL, BigInt(9_000_000)), // user SENDS to the pool — not a receipt
      transferLog(WETH, POOL, OTHER, BigInt(1)), // to a third party
    ];
    const result = decodeExecutedAmounts({ logs, userWallet: USER, usdcAddress: USDC });
    expect(result.perToken).toEqual([]);
    expect(result.usdcReceived).toBe(BigInt(0));
  });

  it("ignores non-Transfer logs (different topic0) (R2)", () => {
    // @rule R2
    const approvalTopic0 = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
    const notTransfer: ReceiptLog = {
      address: USDC,
      topics: [approvalTopic0, pad(USER), pad(POOL)],
      data: pad(numberToHex(BigInt(1_000_000))),
    };
    const result = decodeExecutedAmounts({
      logs: [notTransfer],
      userWallet: USER,
      usdcAddress: USDC,
    });
    expect(result.perToken).toEqual([]);
    expect(result.usdcReceived).toBe(BigInt(0));
  });

  it("skips a malformed Transfer log without throwing (defensive: partial receipt)", () => {
    // @rule R9
    const malformed: ReceiptLog = {
      address: USDC,
      // Transfer topic0 but missing the indexed to-topic + data — decodeEventLog throws; must be swallowed.
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],
      data: "0x",
    };
    const good = transferLog(WETH, POOL, USER, BigInt(42));
    const result = decodeExecutedAmounts({
      logs: [malformed, good],
      userWallet: USER,
      usdcAddress: USDC,
    });
    // The good log still decodes; the malformed one is silently skipped.
    expect(result.perToken).toHaveLength(1);
    expect(result.perToken[0]?.rawValue).toBe(BigInt(42));
  });

  it("skips a 4-topic ERC-721-style Transfer that shares the Transfer topic0 (R2 QA hardening)", () => {
    // @rule R2
    // ERC-721 `Transfer(from, to, tokenId)` shares the SAME topic0 as ERC-20 Transfer but indexes
    // `tokenId` too, giving FOUR topics and empty data. Without the topic-count guard, `decodeEventLog`
    // against the ERC-20 ABI would mis-read the indexed tokenId as a `value` and inflate the inflow.
    // The transfer-topic0 is the shared `Transfer(address,address,uint256)` signature hash.
    const transferTopic0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const erc721Transfer: ReceiptLog = {
      address: WETH,
      // [sig, from, to, tokenId] — a 4-topic ERC-721 mint to the user, no non-indexed data.
      topics: [transferTopic0, pad(POOL), pad(USER), pad(numberToHex(BigInt(777)))],
      data: "0x",
    };
    const good = transferLog(USDC, POOL, USER, BigInt(1_000_000));
    const result = decodeExecutedAmounts({
      logs: [erc721Transfer, good],
      userWallet: USER,
      usdcAddress: USDC,
    });
    // Only the genuine 3-topic ERC-20 leg is counted; the ERC-721 log is skipped, not summed.
    expect(result.perToken).toHaveLength(1);
    expect(result.perToken[0]).toMatchObject({ isUsdc: true, rawValue: BigInt(1_000_000) });
    expect(result.usdcReceived).toBe(BigInt(1_000_000));
  });

  it("still decodes the pool leg when no USDC address is configured for the chain (R7)", () => {
    // @rule R7
    const logs = [transferLog(WETH, POOL, USER, BigInt(7))];
    const result = decodeExecutedAmounts({ logs, userWallet: USER, usdcAddress: undefined });
    expect(result.perToken).toHaveLength(1);
    expect(result.perToken[0]).toMatchObject({ isUsdc: false, rawValue: BigInt(7) });
    expect(result.usdcReceived).toBe(BigInt(0));
  });
});
