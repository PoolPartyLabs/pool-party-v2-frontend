/** @id PP-CP-HOOK-001 @name Cash+ wallet integration rules @implements-rules-version v1 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { encodeAbiParameters, encodeEventTopics, type Hash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cashPlusVaultAbi } from "@/lib/cash-plus/abi/CashPlusVault";
import { parseCashPlusDeployment } from "@/lib/cash-plus/config/deployments";
import { manifestFixture } from "@/lib/cash-plus/config/testFixture";
import { cashPlusJournalKey, writeCashPlusJournal } from "@/lib/cash-plus/journal";
import { CASH_PLUS_PREVIEW_SNAPSHOT } from "@/mocks/data/cashPlus";

const mocks = vi.hoisted(() => ({
  environment: {} as Record<string, unknown>,
  read: vi.fn(),
  history: vi.fn(),
  provider: { request: vi.fn() },
  client: {
    getBlock: vi.fn(),
    estimateGas: vi.fn(),
    readContract: vi.fn(),
    simulateContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  },
}));
vi.mock("../CashPlusProvider", () => ({ useCashPlusEnvironment: () => mocks.environment }));
vi.mock("@/lib/cash-plus/client", () => ({
  createCashPlusClient: () => mocks.client,
  verifyCashPlusDeployment: vi.fn(),
}));
vi.mock("@/lib/cash-plus/readSnapshot", () => ({
  readCashPlusSnapshot: (...args: unknown[]) => mocks.read(...args),
}));
vi.mock("@/lib/cash-plus/history", () => ({
  readCashPlusHistory: (...args: unknown[]) => mocks.history(...args),
}));

import { useCashPlus } from "./useCashPlus";

const owner = "0x3333333333333333333333333333333333333333",
  hash: Hash = `0x${"a".repeat(64)}`;
const deployment = parseCashPlusDeployment(manifestFixture);
const journalKey = cashPlusJournalKey(deployment, owner);

function minedDeposit(transactionHash: Hash = hash) {
  return {
    status: "success",
    transactionHash,
    blockNumber: BigInt(20),
    logs: [
      {
        address: deployment.vault,
        topics: encodeEventTopics({
          abi: cashPlusVaultAbi,
          eventName: "Deposited",
          args: { owner },
        }),
        data: encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }, { type: "uint64" }],
          [BigInt(100000000), BigInt("1000000000000000000"), BigInt(1)],
        ),
      },
    ],
  };
}

function savePending(stage: "approval" | "operation") {
  writeCashPlusJournal(journalKey, {
    hash,
    stage,
    transaction: { phase: "pending", kind: "deposit", hash },
  });
}

function sentTransactions() {
  return mocks.provider.request.mock.calls.filter(
    ([call]) => call.method === "eth_sendTransaction",
  );
}
const wrapper = () => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={query}>{children}</QueryClientProvider>;
  };
};
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.environment = {
    mode: "fork",
    deployment: parseCashPlusDeployment(manifestFixture),
    wallet: {
      connected: true,
      address: owner,
      correctChain: true,
      getProvider: async () => mocks.provider,
      connect: vi.fn(),
      switchNetwork: vi.fn(),
    },
  };
  mocks.read.mockResolvedValue({
    snapshot: { ...CASH_PLUS_PREVIEW_SNAPSHOT, mode: "fork", timestamp: 2000, readAt: 2000000 },
    walletBalanceAssets: BigInt(1000000000),
  });
  mocks.history.mockImplementation(async (_c: unknown, _d: unknown, snapshot: unknown) => snapshot);
  mocks.client.getBlock.mockResolvedValue({ timestamp: BigInt(2000) });
  mocks.client.estimateGas.mockResolvedValue(BigInt(100000));
  mocks.client.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      functionName === "allowance" ? BigInt(1000000000) : BigInt("1000000000000000000"),
  );
  mocks.client.simulateContract.mockResolvedValue({ result: BigInt(1) });
  mocks.client.waitForTransactionReceipt.mockRejectedValue(new Error("timeout"));
  mocks.provider.request.mockImplementation(async ({ method }: { method: string }) =>
    method === "eth_accounts" ? [owner] : method === "eth_chainId" ? "0x7a69" : hash,
  );
});
async function reviewed() {
  const hook = renderHook(() => useCashPlus(), { wrapper: wrapper() });
  await waitFor(() => expect(hook.result.current.status).toBe("ready"));
  await act(() => hook.result.current.review("deposit", "100"));
  expect(hook.result.current.transaction.phase).toBe("review");
  return hook;
}
describe("Cash+ runtime wallet safety", () => {
  it("retains pending hash on timeout and refuses duplicate sends or resets", async () => {
    const { result } = await reviewed();
    await act(() => result.current.confirm());
    expect(result.current.transaction).toMatchObject({ phase: "pending", hash });
    await act(() => result.current.confirm());
    await act(() => result.current.review("deposit", "100"));
    act(() => result.current.resetTransaction());
    expect(
      mocks.provider.request.mock.calls.filter(([call]) => call.method === "eth_sendTransaction"),
    ).toHaveLength(1);
    expect(result.current.transaction.phase).toBe("pending");
  });
  it("blocks an account changed after the review", async () => {
    const { result } = await reviewed();
    mocks.provider.request.mockResolvedValue(["0x4444444444444444444444444444444444444444"]);
    await act(() => result.current.confirm());
    expect(result.current.transaction.errorCode).toBe("WALLET_CHANGED");
    expect(
      mocks.provider.request.mock.calls.filter(([call]) => call.method === "eth_sendTransaction"),
    ).toHaveLength(0);
  });
  it("approves exact allowance then freshly simulates the deposit", async () => {
    const { result } = await reviewed();
    mocks.client.readContract.mockResolvedValue(BigInt(0));
    mocks.client.waitForTransactionReceipt.mockResolvedValueOnce({ status: "success" });
    mocks.client.simulateContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "deposit") throw new Error("POLICY_CHANGED");
        return { result: true };
      },
    );
    await act(() => result.current.confirm());
    expect(result.current.transaction.errorCode).toBe("POLICY_CHANGED");
    expect(
      mocks.provider.request.mock.calls.filter(([call]) => call.method === "eth_sendTransaction"),
    ).toHaveLength(1);
    expect(mocks.client.simulateContract.mock.calls.map(([call]) => call.functionName)).toEqual([
      "approve",
      "deposit",
    ]);
  });
  it("reports a mined revert without a fabricated successful receipt", async () => {
    const { result } = await reviewed();
    mocks.client.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    await act(() => result.current.confirm());
    expect(result.current.transaction).toMatchObject({ phase: "error", errorCode: "TX_REVERTED" });
    expect(result.current.transaction.receipt).toBeUndefined();
  });

  it("shows only the mined owner event as success and clears the pending journal", async () => {
    const { result } = await reviewed();
    mocks.client.waitForTransactionReceipt.mockResolvedValue(minedDeposit());
    await act(() => result.current.confirm());
    expect(result.current.transaction).toMatchObject({
      phase: "success",
      receipt: { hash, assets: BigInt(100000000), shares: BigInt("1000000000000000000") },
    });
    expect(sentTransactions()).toHaveLength(1);
    expect(sessionStorage.getItem(journalKey)).toBeNull();
    act(() => result.current.resetTransaction());
    await act(() => result.current.confirm());
    expect(result.current.transaction.phase).toBe("idle");
    expect(sentTransactions()).toHaveLength(1);
  });

  it.each([
    "approval",
    "operation",
  ] as const)("recovers a saved %s without sending another wallet transaction", async (stage) => {
    savePending(stage);
    mocks.client.waitForTransactionReceipt.mockResolvedValue(minedDeposit());
    const { result } = renderHook(() => useCashPlus(), { wrapper: wrapper() });
    await waitFor(() =>
      expect(result.current.transaction.phase).toBe(stage === "approval" ? "error" : "success"),
    );
    if (stage === "approval") {
      expect(result.current.transaction.errorCode).toBe("QUOTE_EXPIRED");
      expect(result.current.transaction.receipt).toBeUndefined();
    } else expect(result.current.transaction.receipt?.hash).toBe(hash);
    expect(sessionStorage.getItem(journalKey)).toBeNull();
    expect(sentTransactions()).toHaveLength(0);
  });

  it.each([
    "cancelled",
    "repriced",
  ] as const)("handles a %s replacement using its actual hash", async (reason) => {
    const replacementHash: Hash = `0x${"b".repeat(64)}`;
    savePending("operation");
    mocks.client.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason, transaction: { hash: replacementHash } });
      return minedDeposit(replacementHash);
    });
    const { result } = renderHook(() => useCashPlus(), { wrapper: wrapper() });
    await waitFor(() =>
      expect(result.current.transaction.phase).toBe(reason === "cancelled" ? "error" : "success"),
    );
    expect(result.current.transaction.hash).toBe(replacementHash);
    if (reason === "cancelled") {
      expect(result.current.transaction.errorCode).toBe("TX_CANCELLED");
      expect(result.current.transaction.receipt).toBeUndefined();
    } else expect(result.current.transaction.receipt?.hash).toBe(replacementHash);
    expect(sessionStorage.getItem(journalKey)).toBeNull();
    expect(sentTransactions()).toHaveLength(0);
  });

  it("refuses to present a successful network receipt without the expected vault event", async () => {
    const { result } = await reviewed();
    mocks.client.waitForTransactionReceipt.mockResolvedValue({ ...minedDeposit(), logs: [] });
    await act(() => result.current.confirm());
    expect(result.current.transaction).toMatchObject({
      phase: "error",
      errorCode: "RECEIPT_UNAVAILABLE",
    });
    expect(result.current.transaction.receipt).toBeUndefined();
    expect(sessionStorage.getItem(journalKey)).toBeNull();
  });

  it("requires a new review after the wallet replaces an approval", async () => {
    const { result } = await reviewed();
    mocks.client.readContract.mockResolvedValue(BigInt(0));
    mocks.client.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", transaction: { hash } });
      return minedDeposit();
    });
    await act(() => result.current.confirm());
    expect(result.current.transaction.errorCode).toBe("QUOTE_EXPIRED");
    expect(sentTransactions()).toHaveLength(1);
    expect(sessionStorage.getItem(journalKey)).toBeNull();
  });

  it("blocks an expired review before requesting a signature", async () => {
    const { result } = await reviewed();
    mocks.client.getBlock.mockResolvedValue({ timestamp: BigInt(2200) });
    await act(() => result.current.confirm());
    expect(result.current.transaction.errorCode).toBe("QUOTE_EXPIRED");
    expect(sentTransactions()).toHaveLength(0);
  });

  it.each([
    "invalid-hash",
    "rejected",
  ])("handles a wallet %s without inventing pending state", async (failure) => {
    const { result } = await reviewed();
    mocks.provider.request.mockImplementation(async ({ method }) => {
      if (method === "eth_accounts") return [owner];
      if (method === "eth_chainId") return "0x7a69";
      if (failure === "rejected") throw { code: 4001 };
      return "not-a-transaction-hash";
    });
    await act(() => result.current.confirm());
    expect(result.current.transaction).toMatchObject({
      phase: "error",
      errorCode: failure === "rejected" ? "USER_REJECTED" : "READ_UNAVAILABLE",
    });
    expect(result.current.transaction.hash).toBeUndefined();
    expect(sessionStorage.getItem(journalKey)).toBeNull();
  });

  it("keeps balances readable when history fails and bounds subsequent history requests", async () => {
    mocks.history.mockRejectedValue(new Error("history unavailable"));
    const { result } = renderHook(() => useCashPlus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.snapshot).toMatchObject({
      historyPartial: true,
      attributionComplete: false,
    });
    for (let window = 40000; window <= 200000; window += 20000) {
      await act(async () => result.current.loadEarlierHistory?.());
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(mocks.history.mock.lastCall?.[3]).toBe(window);
    }
    expect(result.current.loadEarlierHistory).toBeUndefined();
    expect(sentTransactions()).toHaveLength(0);
  });

  it("blocks a review on the wrong wallet network", async () => {
    const { result } = renderHook(() => useCashPlus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    mocks.provider.request.mockImplementation(async ({ method }) =>
      method === "eth_accounts" ? [owner] : "0xa4b1",
    );
    await act(() => result.current.review("deposit", "100"));
    expect(result.current.transaction.errorCode).toBe("WRONG_CHAIN");
    expect(sentTransactions()).toHaveLength(0);
  });

  it("reports a rejected network change and permits another attempt", async () => {
    const switchNetwork = vi.fn().mockRejectedValue({ code: 4001 });
    mocks.environment = {
      ...mocks.environment,
      wallet: {
        connected: true,
        address: owner,
        correctChain: false,
        switchNetwork,
        connect: vi.fn(),
        getProvider: async () => mocks.provider,
      },
    };
    const { result } = renderHook(() => useCashPlus(), { wrapper: wrapper() });
    await act(() => result.current.switchNetwork());
    expect(result.current.transaction.errorCode).toBe("USER_REJECTED");
    switchNetwork.mockResolvedValue(undefined);
    await act(() => result.current.switchNetwork());
    expect(switchNetwork).toHaveBeenCalledTimes(2);
    expect(sentTransactions()).toHaveLength(0);
  });
});
