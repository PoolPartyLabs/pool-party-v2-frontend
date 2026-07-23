/**
 * @id PP-STR-MOD-004 (POO-320)
 * @name useWithdraw tests (real branch)
 * @implements-rules-version v1
 *
 * Routes by amount: a partial removal → remove-liquidity-tx (percentage + collect/legacy handling);
 * a full or closed-position amount → withdraw-tx. Sends + resolves the hash; throws on null-build /
 * not-connected.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkToChainId } from "@/lib/chains/config";
import type { Position, Strategy } from "@/lib/schemas";
import { classifyTxError } from "@/lib/tx/diagnostics";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    switchChain: ReturnType<typeof vi.fn>;
    getEthereumProvider: () => Promise<unknown>;
  }>,
  remove: vi.fn(),
  withdraw: vi.fn(),
  close: vi.fn(),
  execute: vi.fn(),
  recordLedger: vi.fn(async () => true),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
// POO-719: the fire-and-forget ledger callback is mocked to assert the wiring only.
vi.mock("@/lib/strategies/v2/recordLiquidityEvent", () => ({
  recordLiquidityEvent: mocks.recordLedger,
}));
vi.mock("../operations/withdrawActions", () => ({
  buildRemoveLiquidityTxAction: mocks.remove,
  buildWithdrawTxAction: mocks.withdraw,
}));
// POO-847 R4: the manager's full exit routes to the close-pool build.
vi.mock("@/features/manager/operations/closePoolAction", () => ({
  buildClosePoolTxAction: mocks.close,
}));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  // POO-810: the confirm step now sends via executeBuiltTransactionWithLogs (keeps the receipt logs).
  return { ...actual, executeBuiltTransactionWithLogs: mocks.execute };
});

import { useWithdraw } from "./useWithdraw";

const strategy = (network = "polygon") =>
  ({ id: "s1", network, pool: "0xpool" }) as unknown as Strategy;
const position = (over: Partial<Position> = {}) =>
  ({ id: "0xpos", currentValue: 100, status: "active", ...over }) as Position;

describe("useWithdraw (real mode)", () => {
  beforeEach(() => {
    mocks.wallets = [
      {
        address: "0xWALLET",
        switchChain: vi.fn().mockResolvedValue(undefined),
        getEthereumProvider: async () => ({ request: vi.fn() }),
      },
    ];
    // POO-475: the build actions return typed data ({ ok: true, tx } | { ok: false, code, message }).
    mocks.remove.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    mocks.withdraw.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    mocks.close.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    // POO-810: the send returns { hash, logs }; empty logs → decodeReceipt yields decoded = null.
    mocks.execute.mockReset().mockResolvedValue({ hash: "0xhash", logs: [] });
    mocks.recordLedger.mockClear();
  });

  // @rule POO-847 R4 (Murilo 2026-07-11): a MANAGER's full exit through the investor flow CLOSES
  // the pool (close-pool-tx), never withdraw-tx — the mobile investor surface routes owned
  // positions here since the managed view is desktop-only.
  it("[POO-847 R4] routes an owner's FULL exit to close-pool-tx", async () => {
    const { result } = renderHook(() => useWithdraw());
    const out = await result.current.execute(
      strategy(),
      position({ currentValue: 100, isPoolManager: true }),
      100,
      0.5,
    );

    expect(mocks.close).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: "0xpos", slippageTolerance: 0.5 }),
    );
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(out).toEqual({ hash: "0xhash" });
  });

  // @rule POO-847 R4: an owned removal at/under 50% (non-dust) keeps the investor percentage route
  // (the desktop POO-312 threshold promotes only ABOVE 50% or on a dust remainder).
  it("[POO-847 R4] an owner's <= 50% removal keeps the remove-liquidity percentage route", async () => {
    const { result } = renderHook(() => useWithdraw());
    await result.current.execute(
      strategy(),
      position({ currentValue: 100, isPoolManager: true }),
      25,
    );

    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ percentage: 25 }));
    expect(mocks.close).not.toHaveBeenCalled();
  });

  // @rule POO-847 R4 (>50% promotion): an owned removal STRICTLY over 50% now promotes to a full
  // pool close (close-pool-tx), mirroring the desktop RemoveLiquidityModal POO-312 threshold — it no
  // longer routes to remove-liquidity-tx as a partial. Exactly 50% still stays a partial (above).
  it("[POO-847 R4] an owner's > 50% removal promotes to close-pool-tx", async () => {
    const { result } = renderHook(() => useWithdraw());
    // $73 of $100 = 73% (> 50) → close, not a 73% partial.
    await result.current.execute(
      strategy(),
      position({ currentValue: 100, isPoolManager: true }),
      73,
      0.5,
    );

    expect(mocks.close).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: "0xpos", slippageTolerance: 0.5 }),
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  // @rule POO-847 R4 (dust promotion): an owned removal that would leave a dust remainder (< $5)
  // promotes to a full pool close even though it is under a full exit.
  it("[POO-847 R4] an owner's dust-leaving removal promotes to close-pool-tx", async () => {
    const { result } = renderHook(() => useWithdraw());
    // $97 of $100 leaves $3 (< $5 dust) → close.
    await result.current.execute(
      strategy(),
      position({ currentValue: 100, isPoolManager: true }),
      97,
    );

    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  // @rule POO-847 R4: a NON-manager (investor) > 50% removal is UNAFFECTED — it stays the investor
  // percentage remove-liquidity route (the close promotion is owned-only).
  it("[POO-847 R4] a non-owner > 50% removal stays remove-liquidity (no close promotion)", async () => {
    const { result } = renderHook(() => useWithdraw());
    await result.current.execute(strategy(), position({ currentValue: 100 }), 73);

    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ percentage: 73 }));
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("routes a partial amount to remove-liquidity-tx with the rounded percentage", async () => {
    const { result } = renderHook(() => useWithdraw());
    const out = await result.current.execute(strategy(), position({ currentValue: 100 }), 25);

    expect(mocks.remove).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: "0xpos", percentage: 25 }),
    );
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(out).toEqual({ hash: "0xhash" });
  });

  // @rule POO-719 rules-v2 [R4v2]: a confirmed remove/withdraw fires the cost-basis ledger
  // callback with the mined txHash — fire-and-forget, never gating the flow.
  it("[POO-719] fires the liquidity-event ledger callback after the receipt confirms", async () => {
    const { result } = renderHook(() => useWithdraw());
    await result.current.execute(strategy(), position({ currentValue: 100 }), 25);

    expect(mocks.recordLedger).toHaveBeenCalledTimes(1);
    expect(mocks.recordLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyRef: "0xpos",
        txHash: "0xhash",
      }),
    );
  });

  it("sends poolPartyPositionAddress on a current network, omits it on legacy", async () => {
    const { result } = renderHook(() => useWithdraw());

    await result.current.execute(strategy("polygon"), position(), 25);
    expect(mocks.remove.mock.calls[0]?.[0].poolPartyPositionAddress).toBe("0xpool");

    await result.current.execute(strategy("arbitrum"), position(), 25);
    expect(mocks.remove.mock.calls[1]?.[0].poolPartyPositionAddress).toBeUndefined();
  });

  // POO-481 R4: the receive-as-pair choice flips shouldSwapFees on BOTH build routes.
  it("[POO-481 R4] threads receiveAsPair as shouldSwapFees=false on both routes", async () => {
    const { result } = renderHook(() => useWithdraw());
    await result.current.execute(strategy(), position({ currentValue: 100 }), 25, 0.5, true);
    expect(mocks.remove.mock.calls[0]?.[0].shouldSwapFees).toBe(false);
    await result.current.execute(strategy(), position({ currentValue: 100 }), 100, 0.5, true);
    expect(mocks.withdraw.mock.calls[0]?.[0].shouldSwapFees).toBe(false);
  });

  it("[POO-481 R4] defaults to swapping to USDC when the choice is omitted", async () => {
    const { result } = renderHook(() => useWithdraw());
    await result.current.execute(strategy(), position({ currentValue: 100 }), 25);
    expect(mocks.remove.mock.calls[0]?.[0].shouldSwapFees).toBe(true);
  });

  it("routes a full amount (≥ currentValue) to withdraw-tx", async () => {
    const { result } = renderHook(() => useWithdraw());
    await result.current.execute(strategy(), position({ currentValue: 100 }), 100);
    expect(mocks.withdraw).toHaveBeenCalledWith(expect.objectContaining({ positionId: "0xpos" }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("routes a closed position to withdraw-tx regardless of amount", async () => {
    const { result } = renderHook(() => useWithdraw());
    await result.current.execute(strategy(), position({ status: "closed" }), 10);
    expect(mocks.withdraw).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("switches the wallet to the strategy's chain before sending (POO-350)", async () => {
    let switchedBeforeSend = false;
    mocks.execute.mockImplementationOnce(async () => {
      switchedBeforeSend = (mocks.wallets[0]?.switchChain.mock.calls.length ?? 0) > 0;
      return { hash: "0xhash", logs: [] };
    });

    const { result } = renderHook(() => useWithdraw());
    await result.current.execute(strategy("base"), position(), 25);

    expect(mocks.wallets[0]?.switchChain).toHaveBeenCalledWith(networkToChainId("base"));
    // The switch must precede the send, else the tx lands on the wallet's current chain (the
    // Arbitrum default), not the position's network (POO-350).
    expect(switchedBeforeSend).toBe(true);
  });

  it("throws the SESSION_MISSING message when the build reports no session", async () => {
    mocks.remove.mockResolvedValue({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    const { result } = renderHook(() => useWithdraw());
    await expect(result.current.execute(strategy(), position(), 25)).rejects.toThrow(
      /session not established/,
    );
  });

  it("throws a TransactionError carrying the failure code on cause, classified end to end", async () => {
    // @rule R3
    mocks.remove.mockResolvedValue({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "too little received",
    });
    const { result } = renderHook(() => useWithdraw());
    const error = await result.current.execute(strategy(), position(), 25).catch((e) => e);
    expect(error).toMatchObject({
      message: "too little received",
      cause: { code: "SLIPPAGE_EXCEEDED" },
    });
    expect(classifyTxError(error)).toBe("slippage");
  });

  it("throws when the wallet is not connected", async () => {
    mocks.wallets = [];
    const { result } = renderHook(() => useWithdraw());
    await expect(result.current.execute(strategy(), position(), 25)).rejects.toThrow(
      /Wallet not connected/,
    );
  });

  // Each step also guards its own required context (the modal runs them individually and can retry).
  describe("step guards", () => {
    it("build step throws when the strategy has no network configured", async () => {
      const { result } = renderHook(() => useWithdraw());
      await expect(
        result.current.execute({ id: "s1" } as unknown as Strategy, position(), 25),
      ).rejects.toThrow(/no network configured/);
    });

    it("confirm step throws when the tx was not built", async () => {
      const { result } = renderHook(() => useWithdraw());
      const steps = result.current.buildSteps(strategy(), position(), 25);
      // steps[1] = "confirm:withdraw"; the build step never ran, so there is no built tx in context.
      await expect(steps[1]?.run({})).rejects.toThrow(/Transaction was not built/);
    });
  });

  // POO-503 (POO-467 R2a): the real array must expose a build step so retryFrom("build") re-quotes
  // server-side; re-running the build re-computes minOut at the current price.
  describe("retry-from-build (POO-503)", () => {
    // @rule R2a — the real withdraw array carries a build step keyed "build".
    it("carries a key: 'build' step (build → confirm:withdraw)", () => {
      const { result } = renderHook(() => useWithdraw());
      const steps = result.current.buildSteps(strategy(), position(), 25, 2);
      expect(steps.map((s) => s.key)).toEqual(["build", "confirm:withdraw"]);
    });

    // @rule R3 — the build step re-quotes with whatever slippage the (rebuilt) array carries.
    it("forwards the current slippageTolerance into the build call on each rebuild", async () => {
      const { result } = renderHook(() => useWithdraw());
      // First rebuild carries 2, a later rebuild (after the user raises it) carries 5.
      await result.current.buildSteps(strategy(), position(), 25, 2)[0]?.run({});
      await result.current.buildSteps(strategy(), position(), 25, 5)[0]?.run({});
      expect(mocks.remove.mock.calls[0]?.[0].slippageTolerance).toBe(2);
      expect(mocks.remove.mock.calls[1]?.[0].slippageTolerance).toBe(5);
    });
  });
});
