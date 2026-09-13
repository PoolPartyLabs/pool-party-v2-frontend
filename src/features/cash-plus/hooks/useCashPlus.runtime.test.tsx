/** @id PP-CP-HOOK-001 @name Cash+ wallet integration rules @implements-rules-version v1 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCashPlusDeployment } from "@/lib/cash-plus/config/deployments";
import { manifestFixture } from "@/lib/cash-plus/config/testFixture";
import { CASH_PLUS_PREVIEW_SNAPSHOT } from "@/mocks/data/cashPlus";

const mocks = vi.hoisted(() => ({
  environment: {} as Record<string, unknown>,
  read: vi.fn(),
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
  readCashPlusHistory: async (_c: unknown, _d: unknown, s: unknown) => s,
}));

import { useCashPlus } from "./useCashPlus";

const owner = "0x3333333333333333333333333333333333333333",
  hash = `0x${"a".repeat(64)}`;
const wrapper = () => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={query}>{children}</QueryClientProvider>;
  };
};
beforeEach(() => {
  vi.clearAllMocks();
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
});
