/**
 * @id PP-MGR-SCR-002 (POO-503)
 * @name useCreatePool retry-from-build harness (real mode)
 * @implements-rules-version v2
 *
 * POO-503 (POO-467 rules v2): the real-mode retry-from-build proof for the create-pool array
 * (approve:token0 → approve:token1 → permit → build → confirm:addLiquidity). Driven through the REAL
 * {@link useWalletSignFlow}, retryFrom("build") re-quotes the build a SECOND time on a slippage failure
 * while the TWO approvals + the permit signature are preserved (never re-run / re-signed, R2/R2a/R9),
 * and the rebuilt call carries the current gear slippage (fresh, R3). A backend SLIPPAGE_EXCEEDED build
 * failure (POO-475 typed) classifies as slippage end to end.
 *
 * NOTE (scope): POO-503 wires the retry-from-build INFRA against the real create-pool array; the full
 * auto-retry ORCHESTRATION (pending notice / slippage view / settings auto-open) lives in the six modals
 * per POO-467 R5 and was intentionally not added to the create-pool ReviewStep by POO-499. This file
 * proves the array + runner honor retryFrom("build") so the orchestration can key off it when wired.
 *
 * Mirrors useCreatePool.test.tsx's module mocks (services-barrel trap: mock like the neighbors do).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type FlowStep, useWalletSignFlow } from "@/features/strategies/hooks/useWalletSignFlow";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    getEthereumProvider: () => Promise<unknown>;
    switchChain: (chainId: number) => Promise<void>;
  }>,
  signTypedData: vi.fn(async () => ({ signature: "0xsig" })),
  managerAddress: "0xMANAGER" as string | null,
  allowance: BigInt(0),
  approveTx: vi.fn(() => ({ tx: { to: "0xusdc", data: "0xapprove" } })),
  build: vi.fn(),
  execute: vi.fn(),
  executeWithReceipt: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: mocks.wallets }),
  useSignTypedData: () => ({ signTypedData: mocks.signTypedData }),
}));
vi.mock("@/lib/manager/managerContracts", () => ({
  poolPartyManagerAddress: () => mocks.managerAddress,
}));
vi.mock("@/lib/tx/permit2", () => ({
  readPermit2TokenAllowance: async () => mocks.allowance,
  readPermit2Nonce: async () => 0,
  buildPermit2ApproveTx: mocks.approveTx,
  buildPermitBatch: (a: unknown, b: unknown, spender: unknown) => ({ a, b, spender }),
  permitBatchTypedData: () => ({}),
  serializePermitBatch: () => ({ details: [], spender: "0xMANAGER", sigDeadline: "0" }),
}));
vi.mock("../operations/createPoolAction", () => ({ buildCreatePoolTxAction: mocks.build }));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  return {
    ...actual,
    executeBuiltTransaction: mocks.execute,
    executeBuiltTransactionWithReceipt: mocks.executeWithReceipt,
  };
});

import { useCreatePool } from "./useCreatePool";

const input = (slippageTolerance: number) => ({
  network: "arbitrum",
  feeBps: 5,
  token0: "0xt0" as `0x${string}`,
  amount0: BigInt(1000),
  token1: "0xt1" as `0x${string}`,
  amount1: BigInt(2000),
  featureSettings: { name: "My Strategy", description: null, poolManagerFee: 20 },
  slippageTolerance,
});

const SLIPPAGE_FAIL = {
  ok: false as const,
  code: "SLIPPAGE_EXCEEDED",
  message: "price slippage check failed",
};
const BUILD_OK = { ok: true as const, tx: { to: "0xc", data: "0xd" } };

describe("useCreatePool retry-from-build (real mode, POO-503)", () => {
  beforeEach(() => {
    mocks.wallets = [
      {
        address: "0xWALLET",
        getEthereumProvider: async () => ({ request: vi.fn() }),
        switchChain: async () => {},
      },
    ];
    mocks.managerAddress = "0xMANAGER";
    mocks.allowance = BigInt(0); // both allowances below the seed → both approvals actually run
    mocks.approveTx.mockClear();
    mocks.signTypedData.mockClear();
    mocks.build.mockReset();
    mocks.execute.mockReset().mockResolvedValue("0xhash");
    mocks.executeWithReceipt.mockReset().mockResolvedValue({ hash: "0xhash", blockNumber: 100 });
  });

  // @rule R2a — the real create-pool array carries a build step keyed "build".
  it("the real create-pool array carries a key: 'build' step (approve×2 → permit → build → confirm)", () => {
    const { result } = renderHook(() => useCreatePool());
    const steps = result.current.buildSteps(input(0.5));
    expect(steps.map((s) => s.key)).toEqual([
      "approve:token0",
      "approve:token1",
      "permit",
      "build",
      "confirm:addLiquidity",
    ]);
    expect(steps.some((s) => s.key === "build")).toBe(true);
  });

  // @rule R2a/R2/R9 — retryFrom("build") re-quotes build without re-running the two approvals or
  // re-signing the permit batch.
  it("re-runs build on retryFrom('build') without re-running the two approvals or re-signing permit", async () => {
    mocks.build.mockResolvedValueOnce(SLIPPAGE_FAIL).mockResolvedValueOnce(BUILD_OK);
    const { result } = renderHook(() => useCreatePool());
    const steps = result.current.buildSteps(input(0.5)) as unknown as FlowStep<never>[];
    const flow = renderHook(() =>
      useWalletSignFlow(steps, { fallbackErrorCode: "CREATE_POOL_FAILED" }),
    );

    await act(async () => {
      await flow.result.current.run();
    });
    expect(flow.result.current.status).toBe("error");
    expect(flow.result.current.error?.kind).toBe("slippage");
    // Two approval txs executed (both allowances below seed), one permit signed, one build attempt.
    expect(mocks.approveTx).toHaveBeenCalledTimes(2);
    expect(mocks.signTypedData).toHaveBeenCalledTimes(1);
    expect(mocks.build).toHaveBeenCalledTimes(1);

    await act(async () => {
      await flow.result.current.retryFrom("build");
    });

    // build re-quoted; the two approvals + permit are preserved.
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.approveTx).toHaveBeenCalledTimes(2);
    expect(mocks.signTypedData).toHaveBeenCalledTimes(1);
    expect(flow.result.current.status).toBe("success");
  });

  // @rule R3 — the rebuilt steps carry the updated gear slippage (fresh, not a stale open-time closure).
  it("re-quotes with the updated slippage after the steps rebuild", async () => {
    mocks.build.mockResolvedValueOnce(SLIPPAGE_FAIL).mockResolvedValueOnce(BUILD_OK);
    const { result } = renderHook(() => useCreatePool());
    let steps = result.current.buildSteps(input(0.5)) as unknown as FlowStep<never>[];
    const flow = renderHook(
      ({ s }: { s: FlowStep<never>[] }) =>
        useWalletSignFlow(s, { fallbackErrorCode: "CREATE_POOL_FAILED" }),
      { initialProps: { s: steps } },
    );

    await act(async () => {
      await flow.result.current.run();
    });
    expect(mocks.build.mock.calls[0]?.[0].slippageTolerance).toBe(0.5);

    steps = result.current.buildSteps(input(5)) as unknown as FlowStep<never>[];
    flow.rerender({ s: steps });
    await act(async () => {
      await flow.result.current.retryFrom("build");
    });

    expect(mocks.build.mock.calls[1]?.[0].slippageTolerance).toBe(5);
    expect(flow.result.current.status).toBe("success");
  });
});
