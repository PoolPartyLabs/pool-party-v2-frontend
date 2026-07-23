/**
 * @id PP-MGR-MOD (POO-312)
 * @name useManagerRemoveLiquidity tests (real branch)
 * @implements-rules-version v1
 *
 * Routes <= 50% to remove-liquidity-tx (partial, carries the collect-as-USDC flag) and > 50% (or
 * dust) to close-pool-tx; signs + sends and reports whether it closed. POO-824: switches the
 * wallet to the position's chain BEFORE sending and threads the target chainId into the executor,
 * else the tx lands on the wallet's current chain.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkToChainId } from "@/lib/chains/config";
import { classifyTxError } from "@/lib/tx/diagnostics";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    getEthereumProvider: () => Promise<unknown>;
    switchChain: ReturnType<typeof vi.fn>;
  }>,
  remove: vi.fn(),
  close: vi.fn(),
  execute: vi.fn(),
  recordLedger: vi.fn(async () => true),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("@/features/strategies/operations/withdrawActions", () => ({
  buildRemoveLiquidityTxAction: mocks.remove,
}));
vi.mock("../operations/closePoolAction", () => ({ buildClosePoolTxAction: mocks.close }));
// POO-719: the fire-and-forget ledger callback is mocked to assert the wiring only.
vi.mock("@/lib/strategies/v2/recordLiquidityEvent", () => ({
  recordLiquidityEvent: mocks.recordLedger,
}));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  return { ...actual, executeBuiltTransaction: mocks.execute };
});

import { useManagerRemoveLiquidity } from "./useManagerRemoveLiquidity";

const base = { network: "arbitrum", positionId: "0xpos", stakeUsd: 1000, collectAsUsdc: true };

describe("useManagerRemoveLiquidity (real mode)", () => {
  beforeEach(() => {
    mocks.wallets = [
      {
        address: "0xWALLET",
        getEthereumProvider: async () => ({ request: vi.fn() }),
        switchChain: vi.fn(),
      },
    ];
    // POO-475: the build actions return typed data ({ ok: true, tx } | { ok: false, code, message }).
    mocks.remove.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    mocks.close.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    mocks.execute.mockReset().mockResolvedValue("0xhash");
    mocks.recordLedger.mockClear();
  });

  // @rule POO-719 rules-v2 [R4v2/R11]: both the partial remove AND the close fire the ledger
  // callback with the mined txHash — the API decodes which one it was from the receipt.
  it("[POO-719] fires the ledger callback after a partial remove confirms", async () => {
    const { result } = renderHook(() => useManagerRemoveLiquidity());
    await result.current.execute({ ...base, percentage: 25 });

    expect(mocks.recordLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyRef: "0xpos",
        txHash: "0xhash",
        network: "arbitrum",
      }),
    );
  });

  it("[POO-719] fires the ledger callback after a close confirms (R11 manager zeroing)", async () => {
    const { result } = renderHook(() => useManagerRemoveLiquidity());
    await result.current.execute({ ...base, percentage: 100 });

    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.recordLedger).toHaveBeenCalledTimes(1);
    expect(mocks.recordLedger).toHaveBeenCalledWith(
      expect.objectContaining({ strategyRef: "0xpos", txHash: "0xhash" }),
    );
  });

  it("routes a 25% removal to remove-liquidity-tx (partial, with collect flag)", async () => {
    const { result } = renderHook(() => useManagerRemoveLiquidity());
    const out = await result.current.execute({ ...base, percentage: 25, collectAsUsdc: false });

    expect(mocks.remove).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: "0xpos", percentage: 25, shouldSwapFees: false }),
    );
    expect(mocks.close).not.toHaveBeenCalled();
    expect(out).toEqual({ hash: "0xhash", closed: false });
  });

  it("routes a 75% removal to close-pool-tx", async () => {
    const { result } = renderHook(() => useManagerRemoveLiquidity());
    const out = await result.current.execute({ ...base, percentage: 75 });

    // POO-509: the close call no longer forwards swapAllToStableCurrency — the action hard-closes to
    // the token pair (close-as-USDC is disabled server-side), so no caller can re-trigger the swap.
    expect(mocks.close).toHaveBeenCalledWith(expect.objectContaining({ positionId: "0xpos" }));
    expect(mocks.close.mock.calls[0]?.[0]).not.toHaveProperty("swapAllToStableCurrency");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(out).toEqual({ hash: "0xhash", closed: true });
  });

  it("promotes a dust removal (< $5 remaining) to a close", async () => {
    const { result } = renderHook(() => useManagerRemoveLiquidity());
    // 50% of $8 leaves $4 (< $5) → close.
    const out = await result.current.execute({ ...base, stakeUsd: 8, percentage: 50 });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(out.closed).toBe(true);
  });

  it("throws the SESSION_MISSING message when the build reports no session", async () => {
    mocks.remove.mockResolvedValue({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    const { result } = renderHook(() => useManagerRemoveLiquidity());
    await expect(result.current.execute({ ...base, percentage: 25 })).rejects.toThrow(
      /session not established/,
    );
  });

  it("throws a TransactionError carrying the failure code on cause, classified end to end", async () => {
    // @rule R3
    mocks.close.mockResolvedValue({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "too little received",
    });
    const { result } = renderHook(() => useManagerRemoveLiquidity());
    // 75% routes to close-pool-tx, which returns the failure.
    const error = await result.current.execute({ ...base, percentage: 75 }).catch((e) => e);
    expect(error).toMatchObject({
      message: "too little received",
      cause: { code: "SLIPPAGE_EXCEEDED" },
    });
    expect(classifyTxError(error)).toBe("slippage");
  });

  it("[POO-824 R2] switches the wallet to the position's chain before sending", async () => {
    let switchedBeforeSend = false;
    mocks.execute.mockImplementationOnce(async () => {
      switchedBeforeSend = (mocks.wallets[0]?.switchChain.mock.calls.length ?? 0) > 0;
      return "0xhash";
    });

    const { result } = renderHook(() => useManagerRemoveLiquidity());
    await result.current.execute({ ...base, network: "base", percentage: 25 });

    expect(mocks.wallets[0]?.switchChain).toHaveBeenCalledWith(networkToChainId("base"));
    // The switch must precede the send, else the tx lands on the wallet's current chain (the
    // Arbitrum default), not the position's network (POO-824, mirrors POO-350).
    expect(switchedBeforeSend).toBe(true);
    // The executor also receives the target chain for the broadcast-time assertion (POO-824 R1).
    expect(mocks.execute.mock.calls[0]?.[3]).toBe(networkToChainId("base"));
  });

  it("[POO-824 R2] throws on an unsupported network without sending", async () => {
    const { result } = renderHook(() => useManagerRemoveLiquidity());
    await expect(
      result.current.execute({ ...base, network: "solana", percentage: 25 }),
    ).rejects.toThrow(/Unsupported network/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  // POO-503 (POO-467 R2a): retryFrom("build") re-runs the build (remove vs close) so the backend
  // re-quotes; the array must carry a build step keyed "build".
  describe("retry-from-build (POO-503)", () => {
    // @rule R2a — the real remove/close array carries a build step keyed "build".
    it("carries a key: 'build' step (build → confirm:removeLiquidity)", () => {
      const { result } = renderHook(() => useManagerRemoveLiquidity());
      const steps = result.current.buildSteps({ ...base, percentage: 25 });
      expect(steps.map((s) => s.key)).toEqual(["build", "confirm:removeLiquidity"]);
    });

    // @rule R3 — re-running the build step re-quotes with whatever slippage the (rebuilt) input carries.
    it("forwards the current slippageTolerance into the build call on each rebuild", async () => {
      const { result } = renderHook(() => useManagerRemoveLiquidity());
      await result.current
        .buildSteps({ ...base, percentage: 25, slippageTolerance: 5 })[0]
        ?.run({});
      await result.current
        .buildSteps({ ...base, percentage: 25, slippageTolerance: 3 })[0]
        ?.run({});
      expect(mocks.remove.mock.calls[0]?.[0].slippageTolerance).toBe(5);
      expect(mocks.remove.mock.calls[1]?.[0].slippageTolerance).toBe(3);
    });
  });
});
