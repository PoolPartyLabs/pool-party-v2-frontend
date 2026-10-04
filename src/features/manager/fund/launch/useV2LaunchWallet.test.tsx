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
}));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("@/lib/tx/useEnsureWalletChain", () => ({ useEnsureWalletChain: () => mocks.ensure }));
vi.mock("@/lib/tx/sendTransaction", () => ({
  sendBuiltTransaction: mocks.send,
  isUserRejection: (failure: { code?: number }) => failure.code === 4001,
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({ readContract: mocks.read, getTransactionReceipt: mocks.receipt }),
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
