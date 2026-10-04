import { encodeErrorResult, parseAbi } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), receipt: vi.fn() }));
vi.mock("@/lib/tx/sendTransaction", () => ({
  sendBuiltTransaction: mocks.send,
  waitForReceipt: mocks.receipt,
}));

import { mockFundBuild, mockWallet } from "@/mocks/data/v2Funds";
import { decodeFundRevert, fundTransactionCode, sendFundTransaction } from "./fundTransactions";

const hash = `0x${"a".repeat(64)}`;
const tx = mockFundBuild({ action: "claim-payout" }).transactions[0];
if (!tx) throw new Error("missing test transaction");
describe("fund receipt observation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.send.mockResolvedValue(hash);
  });
  // @rule R1 @rule R3
  it("observes broadcast before querying receipt, then confirms with block", async () => {
    const observe = vi.fn();
    mocks.receipt.mockImplementation(async () => {
      expect(observe).toHaveBeenCalledWith(expect.objectContaining({ hash, status: "pending" }));
      return { blockNumber: 42 };
    });
    await sendFundTransaction({ request: vi.fn() }, tx, mockWallet, "claim", observe);
    expect(observe.mock.calls.at(-1)?.[0]).toEqual({
      hash,
      chainId: 42161,
      action: "claim",
      status: "confirmed",
      blockNumber: 42,
    });
  });
  // @rule R3
  it("decodes a mined revert at its receipt block without exposing raw messages", async () => {
    const data = encodeErrorResult({
      abi: parseAbi(["error StaleSpokeReport(uint256 spokeIndex)"]),
      errorName: "StaleSpokeReport",
      args: [BigInt(1)],
    });
    mocks.receipt.mockRejectedValue({ cause: { code: "TX_REVERTED" } });
    const request = vi
      .fn()
      .mockResolvedValueOnce({ blockNumber: "0x2a" })
      .mockRejectedValueOnce({ data, message: "secret raw rpc failure" });
    const observe = vi.fn();
    await expect(
      sendFundTransaction({ request }, tx, mockWallet, "claim", observe),
    ).rejects.toThrow("TX_REVERTED");
    expect(request.mock.calls[1]?.[0].params[1]).toBe("0x2a");
    expect(observe.mock.calls.at(-1)?.[0]).toEqual({
      hash,
      chainId: 42161,
      action: "claim",
      status: "reverted",
      blockNumber: 42,
      reason: "refreshing",
      errorName: "StaleSpokeReport",
    });
  });
  // @rule R3
  it("keeps RPC uncertainty pending and does not retry submission", async () => {
    mocks.receipt.mockRejectedValue(new Error("rpc unavailable"));
    const observe = vi.fn();
    await expect(
      sendFundTransaction({ request: vi.fn() }, tx, mockWallet, "claim", observe),
    ).rejects.toThrow("TX_CONFIRMATION_UNKNOWN");
    expect(observe.mock.calls[1]?.[0]).toMatchObject({ status: "pending", uncertain: true, hash });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  // @rule R3
  it("does not record wallet rejection before broadcast", async () => {
    mocks.send.mockRejectedValue({ code: 4001 });
    const observe = vi.fn();
    await expect(
      sendFundTransaction({ request: vi.fn() }, tx, mockWallet, "claim", observe),
    ).rejects.toEqual({ code: 4001 });
    expect(observe).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  // @rule R3
  it("does not claim a decoded reason if a failed receipt has no usable revert data", async () => {
    mocks.receipt.mockRejectedValue({ cause: { code: "TX_REVERTED" } });
    const observe = vi.fn();
    await expect(
      sendFundTransaction(
        { request: vi.fn().mockRejectedValue(new Error("rpc")) },
        tx,
        mockWallet,
        "claim",
        observe,
      ),
    ).rejects.toThrow("TX_REVERTED");
    expect(observe.mock.calls[1]?.[0]).toMatchObject({
      status: "reverted",
      reason: "revertUnknown",
    });
    expect(decodeFundRevert({ data: "0x1234", message: "private" })).toBe("revertUnknown");
    expect(fundTransactionCode({ cause: { code: "TX_CONFIRMATION_UNKNOWN" } })).toBe(
      "TX_CONFIRMATION_UNKNOWN",
    );
  });
});
