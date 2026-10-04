import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LaunchTransaction } from "@/lib/api/v2/launchSchemas";
import { useV2LaunchWallet } from "./useV2LaunchWallet";

const mocks = vi.hoisted(() => ({
  wallets: [] as { address: string }[],
  ensure: vi.fn(),
  send: vi.fn(),
  request: vi.fn(),
  read: vi.fn(),
  receipt: vi.fn(),
  blockNumber: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("@/lib/tx/useEnsureWalletChain", () => ({ useEnsureWalletChain: () => mocks.ensure }));
vi.mock("@/lib/tx/sendTransaction", () => ({
  sendBuiltTransaction: mocks.send,
  isUserRejection: (failure: { code?: number }) => failure.code === 4001,
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: vi.fn(() => ({
    readContract: mocks.read,
    getTransactionReceipt: mocks.receipt,
    getBlockNumber: mocks.blockNumber,
    getTransaction: mocks.transaction,
  })),
}));
const manager = `0x${"34".repeat(20)}`;
const transaction: LaunchTransaction = {
  from: manager,
  to: `0x${"12".repeat(20)}`,
  chainId: 42161,
  data: "0x1234",
  value: "0",
};
describe("real wallet launch binding [R1, R6]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.wallets = [{ address: manager }];
    mocks.ensure.mockResolvedValue({ request: mocks.request });
    mocks.read.mockResolvedValue(BigInt(100000000));
    mocks.send.mockResolvedValue(`0x${"ab".repeat(32)}`);
    mocks.receipt.mockResolvedValue({ status: "success" });
    mocks.request.mockResolvedValue("0xsignature");
    mocks.blockNumber.mockResolvedValue(BigInt(12345));
  });
  it.each([
    42161, 4663,
  ] as const)("reads a trustworthy block on chain %s without wallet interaction", async (chain) => {
    const { result } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balance).not.toBeNull());
    expect(await result.current.wallet?.blockNumber?.(chain)).toBe(BigInt(12345));
    const { createPublicClient } = await import("viem");
    expect(createPublicClient).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chain: expect.objectContaining({ id: chain }),
      }),
    );
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.blockNumber.mockRejectedValueOnce(new Error("offline"));
    await expect(result.current.wallet?.blockNumber?.(chain)).rejects.toThrow();
  });
  it("persists a returned hash even if cancellation occurred during broadcast", async () => {
    const { result } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balance).not.toBeNull());
    const controller = new AbortController();
    mocks.send.mockImplementationOnce(async () => {
      controller.abort();
      return "0xhash";
    });
    const submitted = vi.fn();
    expect(await result.current.wallet?.send(transaction, submitted, controller.signal)).toBe(
      "0xhash",
    );
    expect(submitted).toHaveBeenCalledWith("0xhash");
  });
  it("does not broadcast when cancelled during chain preflight", async () => {
    const { result } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balance).not.toBeNull());
    const controller = new AbortController();
    mocks.ensure.mockImplementationOnce(async () => {
      controller.abort();
      return { request: mocks.request };
    });
    await expect(
      result.current.wallet?.send(transaction, vi.fn(), controller.signal),
    ).rejects.toThrow("LAUNCH_CANCELLED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([
    42161, 4663,
  ] as const)("reads the exact submitted calldata on chain %s without signing", async (chain) => {
    const { result } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balance).not.toBeNull());
    const hash = `0x${"ab".repeat(32)}`;
    const submitted = {
      from: manager,
      to: transaction.to,
      input: transaction.data,
      value: BigInt(42),
    };
    mocks.transaction.mockResolvedValueOnce({ ...submitted, hash, blockNumber: BigInt(123) });
    expect(await result.current.wallet?.transaction?.(chain, hash)).toEqual(submitted);
    expect(mocks.transaction).toHaveBeenCalledWith({ hash });
    const { createPublicClient } = await import("viem");
    expect(createPublicClient).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chain: expect.objectContaining({ id: chain }),
      }),
    );
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.transaction.mockRejectedValueOnce(new Error("pending"));
    expect(await result.current.wallet?.transaction?.(chain, hash)).toBeNull();
    expect(await result.current.wallet?.transaction?.(chain, "invalid")).toBeNull();
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
  it("does not reinterpret persistence callback failures as wallet rejection", async () => {
    const { result } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balance).not.toBeNull());
    const failure = new Error("JOURNAL_WRITE_FAILED");
    await expect(
      result.current.wallet?.send(transaction, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    BigInt(-1),
    12345,
  ])("rejects invalid RPC block lower bounds: %s", async (block) => {
    const { result } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balance).not.toBeNull());
    mocks.blockNumber.mockResolvedValueOnce(block);
    await expect(result.current.wallet?.blockNumber?.(42161)).rejects.toThrow(
      "BALANCES_UNAVAILABLE",
    );
  });
  it("reads real balance without requesting signatures and refreshes explicitly", async () => {
    const { result } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balance).toBe(BigInt(100000000)));
    expect(mocks.ensure).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refreshBalance();
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(result.current.manager).toBe(manager);
  });
  it("checks chains before signing/broadcast and sanitizes ambiguous and rejected sends", async () => {
    const { result } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balance).not.toBeNull());
    await result.current.wallet?.send(transaction);
    expect(mocks.ensure).toHaveBeenCalledWith(mocks.wallets[0], 42161);
    mocks.send.mockRejectedValueOnce({ code: 4001 });
    await expect(result.current.wallet?.send(transaction)).rejects.toThrow("USER_REJECTED");
    mocks.send.mockRejectedValueOnce(new Error("rpc secret"));
    await expect(result.current.wallet?.send(transaction)).rejects.toThrow(
      "SUBMISSION_RECONCILIATION_REQUIRED",
    );
    expect(await result.current.wallet?.sign("profile")).toBe("0xsignature");
    mocks.request.mockResolvedValueOnce(null);
    await expect(result.current.wallet?.sign("profile")).rejects.toThrow("INVALID_SIGNATURE");
  });
  it("handles unavailable balances, unknown receipts and disconnected wallets", async () => {
    mocks.read.mockRejectedValue(new Error("offline"));
    const { result, unmount } = renderHook(() => useV2LaunchWallet());
    await waitFor(() => expect(result.current.balanceError).toBe(true));
    expect(await result.current.wallet?.receipt(42161, "invalid")).toBeNull();
    mocks.receipt.mockRejectedValueOnce(new Error("pending"));
    expect(await result.current.wallet?.receipt(42161, `0x${"ab".repeat(32)}`)).toBeNull();
    expect(await result.current.wallet?.receipt(42161, `0x${"ab".repeat(32)}`)).toMatchObject({
      status: "success",
    });
    unmount();
    mocks.wallets = [];
    const disconnected = renderHook(() => useV2LaunchWallet());
    expect(disconnected.result.current.wallet).toBeNull();
    expect(disconnected.result.current.manager).toBeNull();
  });
});
