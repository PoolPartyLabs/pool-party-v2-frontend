/**
 * @id PP-MGR-MOD-001 (POO-310, POO-437, POO-900)
 * @name useMoveRange tests (real branch)
 * @implements-rules-version v3 (POO-900 rules v1)
 *
 * Real mode converts the new prices to ticks (POO-282), then branches by network family (POO-437,
 * [R1]): current networks (Polygon) chain optimize → routing → build; legacy networks (Arbitrum/Base)
 * skip optimization, size the swap directly, and build with the simpler body. Both sign + send the
 * built tx and resolve with the hash. Throws when not connected / on a degenerate 0/0 rebalance.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullRangeTicks } from "@/lib/manager/fullRangeTicks";
import { priceToNearestUsableTick, tickToPrice } from "@/lib/manager/tickPrice";
import { classifyTxError } from "@/lib/tx/diagnostics";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    getEthereumProvider: () => Promise<unknown>;
    switchChain: (chainId: number) => Promise<void>;
  }>,
  optimize: vi.fn(),
  routing: vi.fn(),
  build: vi.fn(),
  computeSwap: vi.fn(),
  legacyBuild: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("../operations/moveRangeActions", () => ({
  optimizeMoveRangeAction: mocks.optimize,
  getMoveRangeRoutingAction: mocks.routing,
  buildMoveRangeTxAction: mocks.build,
  computeLegacyMoveRangeSwapAction: mocks.computeSwap,
  buildMoveRangeTxLegacyAction: mocks.legacyBuild,
}));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  return { ...actual, executeBuiltTransaction: mocks.execute };
});

import { useMoveRange } from "./useMoveRange";

/** Current-network (Polygon) run: optimize → routing → build. */
const currentInput = {
  network: "polygon",
  positionId: "0xpos" as `0x${string}`,
  feeBps: 30,
  decimals0: 18,
  decimals1: 6,
  minPrice: 2800,
  maxPrice: 3200,
  slippagePct: 0.5,
};

/** Legacy-network (Arbitrum) run: compute swap → build. */
const legacyInput = { ...currentInput, network: "arbitrum" };

const swapResult = { swapZeroForOneAmount: "1000", swapOneForZeroAmount: "0" };

describe("useMoveRange (real mode)", () => {
  beforeEach(() => {
    mocks.wallets = [
      {
        address: "0xWALLET",
        getEthereumProvider: async () => ({ request: vi.fn() }),
        switchChain: async () => {},
      },
    ];
    mocks.optimize.mockReset().mockResolvedValue(swapResult);
    mocks.routing.mockReset().mockResolvedValue({ ...swapResult, sqrtPriceX96After: "1" });
    // POO-475: the two BUILD actions return typed data; the read actions keep their own shapes.
    mocks.build.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    mocks.computeSwap.mockReset().mockResolvedValue(swapResult);
    mocks.legacyBuild.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    mocks.execute.mockReset().mockResolvedValue("0xhash");
  });

  describe("current networks (Polygon)", () => {
    it("converts prices to ticks and chains optimize → routing → build → send", async () => {
      const { result } = renderHook(() => useMoveRange());
      const out = await result.current.execute(currentInput);

      // POO-900 R3: the build recovers ticks by ROUNDING (the UI gate's resolver).
      const tickLower = priceToNearestUsableTick(2800, 18, 6, 30);
      const tickUpper = priceToNearestUsableTick(3200, 18, 6, 30);

      expect(mocks.optimize).toHaveBeenCalledWith(
        expect.objectContaining({
          positionId: "0xpos",
          tickLower,
          tickUpper,
          slippageTolerance: 0.5,
        }),
      );
      expect(mocks.routing).toHaveBeenCalledWith(
        expect.objectContaining({ swapZeroForOneAmount: "1000", swapOneForZeroAmount: "0" }),
      );
      expect(mocks.build).toHaveBeenCalledWith(
        expect.objectContaining({ tickLower, tickUpper, mintSlippageTolerance: 0.5 }),
      );
      // The legacy path must not run for a current network.
      expect(mocks.computeSwap).not.toHaveBeenCalled();
      expect(mocks.legacyBuild).not.toHaveBeenCalled();
      expect(mocks.execute).toHaveBeenCalledOnce();
      expect(out).toEqual({ hash: "0xhash" });
    });

    it("[POO-394] full-range uses the widest usable ticks, not price→tick", async () => {
      const { result } = renderHook(() => useMoveRange());
      const out = await result.current.execute({
        network: "polygon",
        positionId: "0xpos",
        feeBps: 30,
        decimals0: 18,
        decimals1: 6,
        fullRange: true,
        slippagePct: 0.5,
      });

      const { tickLower, tickUpper } = fullRangeTicks(30);
      expect(tickLower).toBeLessThan(priceToNearestUsableTick(2800, 18, 6, 30));
      expect(tickUpper).toBeGreaterThan(priceToNearestUsableTick(3200, 18, 6, 30));
      expect(mocks.optimize).toHaveBeenCalledWith(
        expect.objectContaining({
          positionId: "0xpos",
          tickLower,
          tickUpper,
          slippageTolerance: 0.5,
        }),
      );
      expect(out).toEqual({ hash: "0xhash" });
    });

    it("throws the SESSION_MISSING message when the build reports no session", async () => {
      mocks.build.mockResolvedValue({
        ok: false,
        code: "SESSION_MISSING",
        message: "Wallet session not established",
      });
      const { result } = renderHook(() => useMoveRange());
      await expect(result.current.execute(currentInput)).rejects.toThrow(/session not established/);
    });

    it("throws a TransactionError carrying the failure code on cause, classified end to end", async () => {
      // @rule R3
      mocks.build.mockResolvedValue({
        ok: false,
        code: "SLIPPAGE_EXCEEDED",
        message: "too little received",
      });
      const { result } = renderHook(() => useMoveRange());
      const error = await result.current.execute(currentInput).catch((e) => e);
      expect(error).toMatchObject({
        message: "too little received",
        cause: { code: "SLIPPAGE_EXCEEDED" },
      });
      expect(classifyTxError(error)).toBe("slippage");
    });

    it("[POO-319] throws when the optimizer returns zero swap amounts (degenerate range)", async () => {
      mocks.optimize.mockResolvedValue({ swapZeroForOneAmount: "0", swapOneForZeroAmount: "0" });
      const { result } = renderHook(() => useMoveRange());
      await expect(result.current.execute(currentInput)).rejects.toThrow(
        /No rebalance is possible/,
      );
      expect(mocks.routing).not.toHaveBeenCalled();
      expect(mocks.build).not.toHaveBeenCalled();
    });

    // @rule POO-900 R9 - the build rejects a below-minimum width client-side (parity with the
    // create-pool backstop, createPoolTicks): this is the only build path that could otherwise mint a
    // degenerate 1-spacing band on-chain (the old guard only rejected inverted/equal ticks).
    it("[POO-900 R9] rejects a 1-spacing range before any server call", async () => {
      const { result } = renderHook(() => useMoveRange());
      // Ticks 0 and 60 on the 0.30% grid (spacing 60) → exactly ONE spacing wide → below minimum.
      const narrow = {
        ...currentInput,
        minPrice: tickToPrice(0, 18, 6),
        maxPrice: tickToPrice(60, 18, 6),
      };
      await expect(result.current.execute(narrow)).rejects.toThrow(/too narrow/i);
      expect(mocks.optimize).not.toHaveBeenCalled();
      expect(mocks.build).not.toHaveBeenCalled();
    });

    // @rule POO-900 R3/R9 - the build resolves ticks by ROUNDING (the resolver the UI gate measures
    // with), so the exactly-2-spacing minimum the modal presents as valid builds instead of throwing.
    // Flooring read the display-rounded max (1.0002, raw tick ~1.9999) one tick low on spacing-1
    // pools, so the R9 backstop rejected the UI-blessed minimum AFTER the manager clicked Move.
    it("[POO-900 R3/R9] builds the UI-blessed exactly-2-spacing range on a spacing-1 pool", async () => {
      const { result } = renderHook(() => useMoveRange());
      // USDC/USDT 0.01% (feeBps 1 → spacing 1): min=1 / max=1.0002 is the round-gated 2-spacing
      // minimum (ticks 0 and 2) - the same bounds the modal's CTA gate accepts.
      const out = await result.current.execute({
        ...currentInput,
        feeBps: 1,
        decimals0: 6,
        decimals1: 6,
        minPrice: 1,
        maxPrice: 1.0002,
      });
      expect(mocks.optimize).toHaveBeenCalledWith(
        expect.objectContaining({ tickLower: 0, tickUpper: 2 }),
      );
      expect(out).toEqual({ hash: "0xhash" });
    });
  });

  describe("legacy networks (Arbitrum/Base) [POO-437]", () => {
    it("[R1] sizes the swap and builds directly, skipping optimize + routing", async () => {
      const { result } = renderHook(() => useMoveRange());
      const out = await result.current.execute(legacyInput);

      // POO-900 R3: the build recovers ticks by ROUNDING (the UI gate's resolver).
      const tickLower = priceToNearestUsableTick(2800, 18, 6, 30);
      const tickUpper = priceToNearestUsableTick(3200, 18, 6, 30);

      expect(mocks.computeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          positionId: "0xpos",
          tickLower,
          tickUpper,
          slippageTolerance: 0.5,
        }),
      );
      expect(mocks.legacyBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          tickLower,
          tickUpper,
          swapZeroForOneAmount: "1000",
          swapOneForZeroAmount: "0",
        }),
      );
      // The current path's optimizer / router must not run for a legacy network.
      expect(mocks.optimize).not.toHaveBeenCalled();
      expect(mocks.routing).not.toHaveBeenCalled();
      expect(mocks.execute).toHaveBeenCalledOnce();
      expect(out).toEqual({ hash: "0xhash" });
    });

    it("[R5] throws on a degenerate 0/0 rebalance without building", async () => {
      mocks.computeSwap.mockResolvedValue({ swapZeroForOneAmount: "0", swapOneForZeroAmount: "0" });
      const { result } = renderHook(() => useMoveRange());
      await expect(result.current.execute(legacyInput)).rejects.toThrow(/No rebalance is possible/);
      expect(mocks.legacyBuild).not.toHaveBeenCalled();
    });

    it("throws when the swap sizing returns null (position / state missing)", async () => {
      mocks.computeSwap.mockResolvedValue(null);
      const { result } = renderHook(() => useMoveRange());
      await expect(result.current.execute(legacyInput)).rejects.toThrow(
        /swap sizing returned no result/,
      );
      expect(mocks.legacyBuild).not.toHaveBeenCalled();
    });

    it("throws the SESSION_MISSING message when the legacy build reports no session", async () => {
      mocks.legacyBuild.mockResolvedValue({
        ok: false,
        code: "SESSION_MISSING",
        message: "Wallet session not established",
      });
      const { result } = renderHook(() => useMoveRange());
      await expect(result.current.execute(legacyInput)).rejects.toThrow(/session not established/);
    });
  });

  it("throws when the wallet is not connected", async () => {
    mocks.wallets = [];
    const { result } = renderHook(() => useMoveRange());
    await expect(result.current.execute(currentInput)).rejects.toThrow(/Wallet not connected/);
    expect(mocks.optimize).not.toHaveBeenCalled();
    expect(mocks.computeSwap).not.toHaveBeenCalled();
  });

  // POO-503 (POO-467 R2a): retryFrom("build") re-runs the build (optimize → route → build) so the
  // backend re-quotes minOut; the array must carry a build step keyed "build".
  describe("retry-from-build (POO-503)", () => {
    // @rule R2a — the real move-range array carries a build step keyed "build".
    it("carries a key: 'build' step (build → confirm:moveRange)", () => {
      const { result } = renderHook(() => useMoveRange());
      const steps = result.current.buildSteps(currentInput);
      expect(steps.map((s) => s.key)).toEqual(["build", "confirm:moveRange"]);
    });

    // @rule R3 — re-running the build step re-quotes with whatever slippage the (rebuilt) input carries.
    it("forwards the current slippagePct into the build call on each rebuild", async () => {
      const { result } = renderHook(() => useMoveRange());
      await result.current.buildSteps({ ...currentInput, slippagePct: 0.5 })[0]?.run({});
      await result.current.buildSteps({ ...currentInput, slippagePct: 5 })[0]?.run({});
      expect(mocks.build.mock.calls[0]?.[0].slippageTolerance).toBe(0.5);
      expect(mocks.build.mock.calls[1]?.[0].slippageTolerance).toBe(5);
    });
  });
});
