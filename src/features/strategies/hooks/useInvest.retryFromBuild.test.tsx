/**
 * @id PP-STR-MOD-001 (POO-503)
 * @name useInvest retry-from-build harness (real mode)
 * @implements-rules-version v2
 *
 * POO-503 (POO-467 rules v2): the real-mode counterpart to the mock orchestration (POO-499). It proves
 * that the REAL invest step array (approve:USDC → permit → build → confirm:invest) carries a `key:
 * "build"` step and, driven through the REAL {@link useWalletSignFlow}, honors retryFrom("build"):
 *   - a slippage-classified build failure re-quotes on retry — the build action runs a SECOND time (R2a);
 *   - the approve/permit executors are NEVER re-invoked or re-signed across the retry (R2/R9);
 *   - the rebuilt call carries the CURRENT gear slippage (raised in the auto-opened settings), because
 *     the modal rebuilds the steps array on a slippage change and the runner reads the latest via its
 *     stepsRef (so retryFrom re-quotes at the new tolerance, R3);
 *   - a backend SLIPPAGE_EXCEEDED build failure (typed via POO-475) classifies as slippage end to end
 *     (`flow.error.kind === "slippage"`), the exact hook the shared auto-retry orchestration keys off.
 *
 * Mirrors useInvest.test.tsx's module mocks (the services-barrel trap: mock like the neighbors do).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    getEthereumProvider: () => Promise<unknown>;
    switchChain: (chainId: number) => Promise<void>;
  }>,
  signTypedData: vi.fn(async () => ({ signature: "0xsig" })),
  allowance: BigInt(0),
  approveTx: vi.fn(() => ({ tx: { to: "0xusdc", data: "0xapprove" } })),
  build: vi.fn(),
  execute: vi.fn(),
  executeWithLogs: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/manager/managerContracts", () => ({
  poolPartyManagerAddress: () => "0xMANAGER0000000000000000000000000000000",
}));
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: mocks.wallets }),
  useSignTypedData: () => ({ signTypedData: mocks.signTypedData }),
}));
vi.mock("@/lib/tx/permit2", () => ({
  readPermit2TokenAllowance: async () => mocks.allowance,
  readPermit2Nonce: async () => 0,
  buildPermit2ApproveTx: mocks.approveTx,
  buildPermitSingle: (token: unknown, spender: unknown) => ({ token, spender }),
  permitTypedData: () => ({}),
  serializePermit: () => ({ details: {}, spender: "0xpool", sigDeadline: "0" }),
}));
vi.mock("../operations/investActions", () => ({ buildAddLiquidityTxAction: mocks.build }));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  // POO-810: approve → executeBuiltTransaction (hash); confirm → executeBuiltTransactionWithLogs.
  return {
    ...actual,
    executeBuiltTransaction: mocks.execute,
    executeBuiltTransactionWithLogs: mocks.executeWithLogs,
  };
});

import { useInvest } from "./useInvest";
import { type FlowStep, useWalletSignFlow } from "./useWalletSignFlow";

const strategy = (network = "polygon") =>
  ({ id: "s1", network, pool: "0xpool" }) as unknown as Strategy;

/** A slippage build failure the way POO-475 surfaces it: typed data → TransactionError(code). */
const SLIPPAGE_FAIL = {
  ok: false as const,
  code: "SLIPPAGE_EXCEEDED",
  message: "price slippage check failed",
};
const BUILD_OK = { ok: true as const, tx: { to: "0xc", data: "0xd" } };

/**
 * Compose the REAL invest step array through the REAL runner, exposing the flow plus a `setSlippage`
 * that rebuilds the steps (mirroring InvestModal's useMemo([amount, slippage]) → the runner's stepsRef
 * picks up the fresh array on the next retryFrom).
 */
function renderInvestFlow(amountUsd = 100) {
  return renderHook(() => {
    const invest = useInvest();
    // The harness owns the (amount, slippage) the modal would; a slippage change rebuilds the steps.
    return {
      invest,
      makeSteps: (slippage: number): FlowStep<never>[] =>
        invest.buildSteps(strategy("polygon"), amountUsd, slippage) as unknown as FlowStep<never>[],
    };
  });
}

describe("useInvest retry-from-build (real mode, POO-503)", () => {
  beforeEach(() => {
    mocks.wallets = [
      {
        address: "0xWALLET",
        getEthereumProvider: async () => ({ request: vi.fn() }),
        switchChain: async () => {},
      },
    ];
    mocks.allowance = BigInt(0); // below the deposit → the approve step actually runs
    mocks.approveTx.mockClear();
    mocks.signTypedData.mockClear();
    mocks.build.mockReset();
    mocks.execute.mockReset().mockResolvedValue("0xhash");
    // POO-810: the confirm send returns { hash, logs }; empty logs → decoded null (no partial fill).
    mocks.executeWithLogs.mockReset().mockResolvedValue({ hash: "0xhash", logs: [] });
  });

  // @rule R2a — the real invest array exposes a build step keyed "build" so retryFrom("build") re-quotes.
  it("the real invest step array carries a key: 'build' step (approve:USDC → permit → build → confirm)", () => {
    const { result } = renderHook(() => useInvest());
    const steps = result.current.buildSteps(strategy(), 100, 2);
    expect(steps.map((s) => s.key)).toEqual(["approve:USDC", "permit", "build", "confirm:invest"]);
    expect(steps.some((s) => s.key === "build")).toBe(true);
  });

  // @rule R2a/R2/R9 — on a slippage build failure, retryFrom("build") re-runs BUILD a second time while
  // the approve + permit executors are NOT re-invoked (no re-approval, no re-sign).
  it("re-runs build on retryFrom('build') without re-running approve or re-signing permit", async () => {
    // First build fails with the slippage code; the retried build succeeds.
    mocks.build.mockResolvedValueOnce(SLIPPAGE_FAIL).mockResolvedValueOnce(BUILD_OK);
    const { result } = renderInvestFlow();
    const steps = result.current.makeSteps(2);
    const flow = renderHook(() => useWalletSignFlow(steps, { fallbackErrorCode: "INVEST_FAILED" }));

    await act(async () => {
      await flow.result.current.run();
    });
    // The run stopped at the build step's slippage failure.
    expect(flow.result.current.status).toBe("error");
    expect(flow.result.current.error?.kind).toBe("slippage");
    // approve ran once (allowance below deposit → real approve tx), permit signed once, build tried once.
    expect(mocks.approveTx).toHaveBeenCalledTimes(1);
    expect(mocks.signTypedData).toHaveBeenCalledTimes(1);
    expect(mocks.build).toHaveBeenCalledTimes(1);

    await act(async () => {
      await flow.result.current.retryFrom("build");
    });

    // build re-quoted (SECOND call); approve + permit were preserved (NOT re-run / re-signed).
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.approveTx).toHaveBeenCalledTimes(1);
    expect(mocks.signTypedData).toHaveBeenCalledTimes(1);
    expect(flow.result.current.status).toBe("success");
  });

  // @rule R3 — after the user raises slippage in the auto-opened settings, the rebuilt steps re-quote
  // with the NEW tolerance (the runner reads the latest steps array via stepsRef on retryFrom).
  it("re-quotes with the updated slippage after the steps rebuild (fresh, not stale-closure)", async () => {
    mocks.build.mockResolvedValueOnce(SLIPPAGE_FAIL).mockResolvedValueOnce(BUILD_OK);
    const { result } = renderInvestFlow();
    // The modal would rebuild the steps array when slippage changes; the harness swaps it the same way.
    let steps = result.current.makeSteps(2);
    const flow = renderHook(
      ({ s }: { s: FlowStep<never>[] }) =>
        useWalletSignFlow(s, { fallbackErrorCode: "INVEST_FAILED" }),
      { initialProps: { s: steps } },
    );

    await act(async () => {
      await flow.result.current.run();
    });
    expect(mocks.build.mock.calls[0]?.[0].slippageTolerance).toBe(2);

    // User raises slippage to 5 → the modal rebuilds the array; the runner's stepsRef picks it up.
    steps = result.current.makeSteps(5);
    flow.rerender({ s: steps });
    await act(async () => {
      await flow.result.current.retryFrom("build");
    });

    // The re-quote used the NEW value, not the 2 captured at open time.
    expect(mocks.build.mock.calls[1]?.[0].slippageTolerance).toBe(5);
    expect(flow.result.current.status).toBe("success");
  });

  // @rule R1/R5b — a backend SLIPPAGE_EXCEEDED build failure (POO-475 typed → TransactionError(code))
  // classifies as slippage end to end, the hook the shared auto-retry keys off.
  it("classifies a SLIPPAGE_EXCEEDED build failure as slippage on the flow error", async () => {
    mocks.build.mockResolvedValue(SLIPPAGE_FAIL);
    const { result } = renderInvestFlow();
    const steps = result.current.makeSteps(2);
    const flow = renderHook(() => useWalletSignFlow(steps, { fallbackErrorCode: "INVEST_FAILED" }));
    await act(async () => {
      await flow.result.current.run();
    });
    expect(flow.result.current.status).toBe("error");
    expect(flow.result.current.error?.kind).toBe("slippage");
  });
});
