/**
 * @id PP-MGR-HOK-012
 * @name usePanelPool tests (real mode)
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks)
 *
 * Rules under test (POO-2185 rules v1):
 *   [R5] the hook reads on mount and again 15 s after each read settles, stops on unmount, never
 *        overlaps two reads (so a read slower than 15 s still lands), and an in-flight answer for an
 *        old pool never overwrites the new one
 *   [R6] real mode has no fallback to fixtures: a failed read is an error with a retry (P13)
 *   [R9] `applicable` is true only for a read the panel can vouch for: the last one succeeded, it is
 *        for this pool, and the pool is eligible with active liquidity (P13: Use and Apply stay
 *        disabled otherwise)
 *
 * The server action and the services seam are mocked; polling is verified with fake timers.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_POOL_PRICE_REFRESH_MS } from "@/features/manager/hooks/useLivePoolPrice";
import type { CatalogPool } from "@/lib/api/v2/schemas";
import { findPanelPoolFixture, panelPoolAtPrice } from "@/mocks/data/buildPanelFixtures";
import { PANEL_READ_TIMEOUT_MS, usePanelPool } from "./usePanelPool";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({ getCatalogPoolAction: mocks.read }));
vi.mock("@/features/manager/actions", () => ({ getPoolCurrentPriceAction: vi.fn() }));

function fixture(id: string, chainId: 42161 | 4663 = 42161): CatalogPool {
  const pool = findPanelPoolFixture(chainId, id);
  if (!pool) throw new Error(`no fixture ${id}`);
  return pool;
}

const POOL_A = fixture("arb-v4-weth-usdc-5");
const POOL_B = fixture("arb-v4-weth-usdc-30");
const ROBINHOOD = fixture("rbh-v4-weth-usdg-5", 4663);
const ID_A = POOL_A.poolId;
const ID_B = POOL_B.poolId;

const ok = (pool: CatalogPool) => ({ ok: true as const, data: pool });
const fail = (status: number, code: string) => ({
  ok: false as const,
  error: { status, code },
});

/** A copy of a fixture pool at another price, so a refresh visibly changes the view. */
function repriced(pool: CatalogPool, price: number): CatalogPool {
  return panelPoolAtPrice(pool, price);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Answer = ReturnType<typeof ok> | ReturnType<typeof fail>;

/** Advance fake timers inside act so the async state updates flush. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Settle a deferred answer inside act. */
async function settle(pending: { resolve: (value: Answer) => void }, answer: Answer) {
  await act(async () => {
    pending.resolve(answer);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("usePanelPool (real mode)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
    mocks.read.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls on the shared 15 s cadence, and gives a read twice that long before it gives up", () => {
    expect(LIVE_POOL_PRICE_REFRESH_MS).toBe(15_000);
    expect(PANEL_READ_TIMEOUT_MS).toBe(30_000);
  });

  describe("reading", () => {
    it("starts loading with no pool, then serves the mapped view", async () => {
      mocks.read.mockResolvedValue(ok(POOL_A));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      expect(result.current.status).toBe("loading");
      expect(result.current.pool).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.refreshedAt).toBeNull();
      await tick(0);
      expect(result.current.status).toBe("ready");
      expect(result.current.pool).toMatchObject({
        poolId: ID_A,
        feePct: 0.05,
        tickSpacing: 10,
        currentTick: -196090,
      });
      expect(result.current.pool?.price).toBeCloseTo(3050.4127, 6);
      expect(result.current.refreshedAt).toBe(Date.parse("2026-10-04T10:00:00Z"));
      expect(mocks.read).toHaveBeenCalledTimes(1);
      expect(mocks.read).toHaveBeenCalledWith(42161, ID_A);
    });

    it("reads the pool of the chain it is given", async () => {
      mocks.read.mockResolvedValue(ok(ROBINHOOD));
      const { result } = renderHook(() => usePanelPool(4663, ROBINHOOD.poolId));
      await tick(0);
      expect(mocks.read).toHaveBeenCalledWith(4663, ROBINHOOD.poolId);
      expect(result.current.pool?.orientation.quote.symbol).toBe("USDG");
    });
  });

  describe("polling [R5]", () => {
    it("refetches 15 s after each read and keeps the view current", async () => {
      mocks.read
        .mockResolvedValueOnce(ok(POOL_A))
        .mockResolvedValueOnce(ok(repriced(POOL_A, 3100)))
        .mockResolvedValue(ok(repriced(POOL_A, 3150)));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(mocks.read).toHaveBeenCalledTimes(1);

      await tick(14_999);
      expect(mocks.read).toHaveBeenCalledTimes(1);
      await tick(1);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      expect(result.current.pool?.price).toBeCloseTo(3100, 6);
      expect(result.current.refreshedAt).toBe(Date.parse("2026-10-04T10:00:15Z"));

      await tick(15_000);
      expect(mocks.read).toHaveBeenCalledTimes(3);
      expect(result.current.pool?.price).toBeCloseTo(3150, 6);
      expect(result.current.status).toBe("ready");
    });

    it("stops polling when it unmounts", async () => {
      mocks.read.mockResolvedValue(ok(POOL_A));
      const { unmount } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      await tick(15_000);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      unmount();
      await tick(120_000);
      expect(mocks.read).toHaveBeenCalledTimes(2);
    });

    it("stops when it unmounts with a read in flight, and drops that answer", async () => {
      const slow = deferred<Answer>();
      mocks.read.mockReturnValue(slow.promise);
      const { unmount } = renderHook(() => usePanelPool(42161, ID_A));
      unmount();
      await settle(slow, ok(POOL_A));
      await tick(120_000);
      expect(mocks.read).toHaveBeenCalledTimes(1);
    });

    describe("a read that takes longer than the interval [R5]", () => {
      it("never starts a second read while the first is in flight", async () => {
        const first = deferred<Answer>();
        mocks.read.mockReturnValueOnce(first.promise).mockResolvedValue(ok(POOL_A));
        renderHook(() => usePanelPool(42161, ID_A));
        await tick(PANEL_READ_TIMEOUT_MS - 1);
        expect(mocks.read).toHaveBeenCalledTimes(1);
      });

      it("applies a first read that lands after 16 s, and arms the next one after it", async () => {
        const first = deferred<Answer>();
        mocks.read.mockReturnValueOnce(first.promise).mockResolvedValue(ok(repriced(POOL_A, 3100)));
        const { result } = renderHook(() => usePanelPool(42161, ID_A));
        await tick(16_000);
        expect(result.current.status).toBe("loading");
        await settle(first, ok(POOL_A));
        expect(result.current.status).toBe("ready");
        expect(result.current.pool?.poolId).toBe(ID_A);
        expect(result.current.pool?.price).toBeCloseTo(3050.4127, 6);
        expect(result.current.refreshedAt).toBe(Date.parse("2026-10-04T10:00:16Z"));
        expect(result.current.applicable).toBe(true);

        // The next read is 15 s after the first one SETTLED, not after it started.
        await tick(14_999);
        expect(mocks.read).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(mocks.read).toHaveBeenCalledTimes(2);
        expect(result.current.pool?.price).toBeCloseTo(3100, 6);
      });

      it("shows the error of a first read that fails after 16 s, never an endless loading", async () => {
        const first = deferred<Answer>();
        mocks.read.mockReturnValueOnce(first.promise).mockResolvedValue(ok(POOL_A));
        const { result } = renderHook(() => usePanelPool(42161, ID_A));
        await tick(16_000);
        await settle(first, fail(504, "UPSTREAM_TIMEOUT"));
        expect(result.current.status).toBe("error");
        expect(result.current.error).toEqual({ status: 504, code: "UPSTREAM_TIMEOUT" });
        expect(result.current.pool).toBeNull();
        expect(result.current.applicable).toBe(false);

        // And it heals by itself on the next read.
        await tick(15_000);
        expect(result.current.status).toBe("ready");
        expect(result.current.applicable).toBe(true);
      });

      it("never leaves a panel 'ready' on an old price behind a slow refresh that fails", async () => {
        const second = deferred<Answer>();
        mocks.read.mockResolvedValueOnce(ok(POOL_A)).mockReturnValueOnce(second.promise);
        const { result } = renderHook(() => usePanelPool(42161, ID_A));
        await tick(0);
        await tick(15_000);
        expect(mocks.read).toHaveBeenCalledTimes(2);
        await tick(16_000);
        // 31 s in: the answer (the server's own 15 s timeout) lands after the next poll WOULD have fired.
        await settle(second, fail(504, "UPSTREAM_TIMEOUT"));
        expect(result.current.status).toBe("error");
        expect(result.current.applicable).toBe(false);
        expect(result.current.pool?.poolId).toBe(ID_A);
      });

      it("ends a read that never settles in a timeout error after 30 s, and keeps polling", async () => {
        mocks.read.mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(ok(POOL_A));
        const { result } = renderHook(() => usePanelPool(42161, ID_A));
        await tick(PANEL_READ_TIMEOUT_MS - 1);
        expect(result.current.status).toBe("loading");
        await tick(1);
        expect(result.current.status).toBe("error");
        expect(result.current.error).toEqual({ status: 504, code: "PANEL_READ_TIMEOUT" });
        expect(result.current.applicable).toBe(false);
        await tick(15_000);
        expect(result.current.status).toBe("ready");
        expect(mocks.read).toHaveBeenCalledTimes(2);
      });

      it("drops a read that lands after its timeout instead of applying it late", async () => {
        const late = deferred<Answer>();
        mocks.read.mockReturnValueOnce(late.promise).mockResolvedValue(ok(repriced(POOL_A, 3100)));
        const { result } = renderHook(() => usePanelPool(42161, ID_A));
        await tick(PANEL_READ_TIMEOUT_MS);
        expect(result.current.error?.code).toBe("PANEL_READ_TIMEOUT");
        await settle(late, ok(POOL_A));
        expect(result.current.error?.code).toBe("PANEL_READ_TIMEOUT");
        expect(result.current.pool).toBeNull();
      });
    });
  });

  describe("a change of pool [R5]", () => {
    it("shows nothing of the old pool while the new one loads", async () => {
      const pending = deferred<Answer>();
      mocks.read.mockImplementation((_chain: number, id: string) =>
        id === ID_A ? Promise.resolve(ok(POOL_A)) : pending.promise,
      );
      const { result, rerender } = renderHook(({ id }) => usePanelPool(42161, id), {
        initialProps: { id: ID_A },
      });
      await tick(0);
      expect(result.current.pool?.poolId).toBe(ID_A);
      expect(result.current.applicable).toBe(true);

      rerender({ id: ID_B });
      expect(result.current.pool).toBeNull();
      expect(result.current.status).toBe("loading");
      expect(result.current.refreshedAt).toBeNull();
      expect(result.current.applicable).toBe(false);

      await settle(pending, ok(POOL_B));
      expect(result.current.pool?.poolId).toBe(ID_B);
      expect(result.current.pool?.feePct).toBe(0.3);
      expect(result.current.applicable).toBe(true);
    });

    it("never lets an in-flight answer for an old pool overwrite the new one", async () => {
      const slow = deferred<Answer>();
      mocks.read.mockImplementation((_chain: number, id: string) =>
        id === ID_A ? slow.promise : Promise.resolve(ok(POOL_B)),
      );
      const { result, rerender } = renderHook(({ id }) => usePanelPool(42161, id), {
        initialProps: { id: ID_A },
      });
      rerender({ id: ID_B });
      await tick(0);
      expect(result.current.pool?.poolId).toBe(ID_B);

      await settle(slow, ok(POOL_A));
      expect(result.current.pool?.poolId).toBe(ID_B);
      expect(result.current.status).toBe("ready");
    });

    it("never lets a late FAILURE of the old pool flip the new one to an error", async () => {
      const slow = deferred<Answer>();
      mocks.read.mockImplementation((_chain: number, id: string) =>
        id === ID_A ? slow.promise : Promise.resolve(ok(POOL_B)),
      );
      const { result, rerender } = renderHook(({ id }) => usePanelPool(42161, id), {
        initialProps: { id: ID_A },
      });
      rerender({ id: ID_B });
      await tick(0);
      await settle(slow, fail(503, "V2_UNAVAILABLE"));
      expect(result.current.status).toBe("ready");
      expect(result.current.error).toBeNull();
    });

    it("reads again, on the new schedule, after the chain changes", async () => {
      mocks.read.mockImplementation((chain: number) =>
        Promise.resolve(ok(chain === 4663 ? ROBINHOOD : POOL_A)),
      );
      const { result, rerender } = renderHook(
        ({ chain, id }) => usePanelPool(chain as 42161 | 4663, id),
        { initialProps: { chain: 42161, id: ID_A } },
      );
      await tick(0);
      rerender({ chain: 4663, id: ROBINHOOD.poolId });
      await tick(0);
      expect(mocks.read).toHaveBeenLastCalledWith(4663, ROBINHOOD.poolId);
      expect(result.current.pool?.network).toBe("robinhood");
    });
  });

  describe("applicable: a read the panel can vouch for [R9]", () => {
    it("is false while loading, true once an eligible pool with liquidity has been read", async () => {
      mocks.read.mockResolvedValue(ok(POOL_A));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      expect(result.current.status).toBe("loading");
      expect(result.current.applicable).toBe(false);
      await tick(0);
      expect(result.current.status).toBe("ready");
      expect(result.current.applicable).toBe(true);
    });

    it("is false for a read that succeeded on a pool the catalog marks ineligible", async () => {
      mocks.read.mockResolvedValue(ok({ ...structuredClone(POOL_A), eligible: false }));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.status).toBe("ready");
      expect(result.current.pool?.eligible).toBe(false);
      expect(result.current.applicable).toBe(false);
    });

    it("is false for a hooked pool, a native currency and an unpriced token, each a ready read", async () => {
      const hooked = { ...structuredClone(POOL_A), hooked: true };
      const unpriced = structuredClone(POOL_A);
      const token = unpriced.tokens[1];
      if (!token) throw new Error("tokens");
      token.hubPriced = false;
      for (const pool of [hooked, unpriced]) {
        mocks.read.mockResolvedValue(ok(pool));
        const { result, unmount } = renderHook(() => usePanelPool(42161, ID_A));
        await tick(0);
        expect(result.current.status).toBe("ready");
        expect(result.current.applicable).toBe(false);
        unmount();
      }
    });

    it("is false for a pool with no active liquidity, though the read succeeded", async () => {
      mocks.read.mockResolvedValue(ok({ ...structuredClone(POOL_A), liquidity: "0" }));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.status).toBe("ready");
      expect(result.current.pool?.hasActiveLiquidity).toBe(false);
      expect(result.current.applicable).toBe(false);
    });

    it("becomes false when a pool loses its eligibility on a later read, and true when it returns", async () => {
      mocks.read
        .mockResolvedValueOnce(ok(POOL_A))
        .mockResolvedValueOnce(ok({ ...structuredClone(POOL_A), liquidity: "0" }))
        .mockResolvedValue(ok(POOL_A));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.applicable).toBe(true);
      await tick(15_000);
      expect(result.current.applicable).toBe(false);
      await tick(15_000);
      expect(result.current.applicable).toBe(true);
    });

    it("is false while a failed refresh keeps the last good pool, and true again after the next good read", async () => {
      mocks.read
        .mockResolvedValueOnce(ok(POOL_A))
        .mockResolvedValueOnce(fail(504, "UPSTREAM_TIMEOUT"))
        .mockResolvedValue(ok(POOL_A));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.applicable).toBe(true);

      await tick(15_000);
      expect(result.current.status).toBe("error");
      expect(result.current.pool?.poolId).toBe(ID_A);
      expect(result.current.applicable).toBe(false);

      await tick(15_000);
      expect(result.current.status).toBe("ready");
      expect(result.current.applicable).toBe(true);
    });

    it("is false during a retry and the error is cleared, though the stale pool stays for display", async () => {
      const retried = deferred<Answer>();
      mocks.read
        .mockResolvedValueOnce(ok(POOL_A))
        .mockResolvedValueOnce(fail(504, "UPSTREAM_TIMEOUT"))
        .mockReturnValueOnce(retried.promise);
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      await tick(15_000);
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ status: 504, code: "UPSTREAM_TIMEOUT" });

      act(() => result.current.retry());
      expect(result.current.status).toBe("loading");
      expect(result.current.error).toBeNull();
      expect(result.current.applicable).toBe(false);
      expect(result.current.pool?.poolId).toBe(ID_A);

      await settle(retried, ok(POOL_A));
      expect(result.current.status).toBe("ready");
      expect(result.current.error).toBeNull();
      expect(result.current.applicable).toBe(true);
    });

    it("is false while a retry after a first failed read is in flight, with the error cleared", async () => {
      const retried = deferred<Answer>();
      mocks.read
        .mockResolvedValueOnce(fail(503, "V2_UNAVAILABLE"))
        .mockReturnValueOnce(retried.promise);
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.status).toBe("error");
      act(() => result.current.retry());
      expect(result.current.status).toBe("loading");
      expect(result.current.error).toBeNull();
      expect(result.current.pool).toBeNull();
      expect(result.current.applicable).toBe(false);
      await settle(retried, ok(POOL_A));
      expect(result.current.applicable).toBe(true);
    });

    it("is false for a new pool until its first read lands, though the old pool was applicable", async () => {
      mocks.read.mockImplementation((_chain: number, id: string) =>
        Promise.resolve(ok(id === ID_A ? POOL_A : POOL_B)),
      );
      const { result, rerender } = renderHook(({ id }) => usePanelPool(42161, id), {
        initialProps: { id: ID_A },
      });
      await tick(0);
      expect(result.current.applicable).toBe(true);
      rerender({ id: ID_B });
      expect(result.current.applicable).toBe(false);
      await tick(0);
      expect(result.current.applicable).toBe(true);
    });
  });

  describe("idle: no pool picked yet [LOW-3]", () => {
    it("does nothing for a null pool id: no read, no timer, nothing applicable", async () => {
      const { result } = renderHook(() => usePanelPool(42161, null));
      expect(result.current).toMatchObject({
        status: "idle",
        pool: null,
        error: null,
        refreshedAt: null,
        applicable: false,
      });
      await tick(120_000);
      expect(mocks.read).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("starts reading when a pool is picked, and goes back to idle, clean, when it is cleared", async () => {
      mocks.read.mockResolvedValue(ok(POOL_A));
      const { result, rerender } = renderHook(
        ({ id }: { id: string | null }) => usePanelPool(42161, id),
        { initialProps: { id: null as string | null } },
      );
      rerender({ id: ID_A });
      expect(result.current.status).toBe("loading");
      await tick(0);
      expect(result.current.applicable).toBe(true);
      expect(mocks.read).toHaveBeenCalledTimes(1);

      rerender({ id: null });
      expect(result.current.status).toBe("idle");
      expect(result.current.pool).toBeNull();
      expect(result.current.applicable).toBe(false);
      await tick(120_000);
      expect(mocks.read).toHaveBeenCalledTimes(1);

      // Coming back to the same pool starts from nothing: the old read is not trusted again.
      rerender({ id: ID_A });
      expect(result.current.status).toBe("loading");
      expect(result.current.pool).toBeNull();
      expect(result.current.applicable).toBe(false);
    });
  });

  describe("errors, with a retry and no fixture fallback [R6]", () => {
    it("surfaces the action's error with no pool, then recovers on retry", async () => {
      mocks.read.mockResolvedValueOnce(fail(503, "V2_UNAVAILABLE"));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ status: 503, code: "V2_UNAVAILABLE" });
      expect(result.current.pool).toBeNull();
      expect(result.current.refreshedAt).toBeNull();

      mocks.read.mockResolvedValue(ok(POOL_A));
      act(() => result.current.retry());
      expect(result.current.status).toBe("loading");
      await tick(0);
      expect(result.current.status).toBe("ready");
      expect(result.current.error).toBeNull();
      expect(result.current.pool?.poolId).toBe(ID_A);
      expect(mocks.read).toHaveBeenCalledTimes(2);
    });

    it("keeps one schedule across a retry: no second timer is left running", async () => {
      mocks.read.mockResolvedValueOnce(fail(500, "SYSTEM_INTERNAL"));
      mocks.read.mockResolvedValue(ok(POOL_A));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      act(() => result.current.retry());
      await tick(0);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      await tick(15_000);
      expect(mocks.read).toHaveBeenCalledTimes(3);
    });

    it("a retry from a ready panel reads at once and moves the schedule", async () => {
      mocks.read.mockResolvedValue(ok(POOL_A));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      await tick(10_000);
      act(() => result.current.retry());
      await tick(0);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      await tick(14_999);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      await tick(1);
      expect(mocks.read).toHaveBeenCalledTimes(3);
    });

    it("turns a rejected action into an error instead of throwing", async () => {
      mocks.read.mockRejectedValue(new Error("network down"));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ status: 0, code: "PANEL_READ_FAILED" });
    });

    it("turns a pool it cannot map into an error with a retry", async () => {
      const broken = structuredClone(POOL_A);
      broken.poolKey.currency1 = `0x${"9".repeat(40)}`;
      mocks.read.mockResolvedValue(ok(broken));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ status: 502, code: "V2_INVALID_RESPONSE" });
      expect(result.current.pool).toBeNull();
      expect(result.current.applicable).toBe(false);
    });

    it("refuses an answer whose two prices disagree, as an invalid response with a retry", async () => {
      const contradictory = structuredClone(POOL_A);
      contradictory.currentPrice.token1PerToken0 = "3000";
      mocks.read.mockResolvedValue(ok(contradictory));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ status: 502, code: "V2_INVALID_RESPONSE" });
      expect(result.current.pool).toBeNull();
      expect(result.current.applicable).toBe(false);
    });

    it("refuses an answer for another pool than the one asked for", async () => {
      mocks.read.mockResolvedValue(ok(POOL_B));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ status: 502, code: "V2_INVALID_RESPONSE" });
      expect(result.current.pool).toBeNull();
    });

    it("refuses an answer for another chain than the one asked for", async () => {
      mocks.read.mockResolvedValue(ok(ROBINHOOD));
      const { result } = renderHook(() => usePanelPool(42161, ROBINHOOD.poolId));
      await tick(0);
      expect(result.current.error).toEqual({ status: 502, code: "V2_INVALID_RESPONSE" });
    });

    it("keeps the last good view while a refresh fails, and says it is stale", async () => {
      mocks.read
        .mockResolvedValueOnce(ok(POOL_A))
        .mockResolvedValueOnce(fail(504, "UPSTREAM_TIMEOUT"))
        .mockResolvedValue(ok(repriced(POOL_A, 3200)));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      const firstRefreshedAt = result.current.refreshedAt;

      await tick(15_000);
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ status: 504, code: "UPSTREAM_TIMEOUT" });
      expect(result.current.pool?.price).toBeCloseTo(3050.4127, 6);
      expect(result.current.refreshedAt).toBe(firstRefreshedAt);

      await tick(15_000);
      expect(result.current.status).toBe("ready");
      expect(result.current.error).toBeNull();
      expect(result.current.pool?.price).toBeCloseTo(3200, 6);
    });

    it("never serves a fixture in real mode, not even for a mock slug", async () => {
      const { result } = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-5"));
      await tick(0);
      expect(result.current.status).toBe("error");
      expect(result.current.pool).toBeNull();
      expect(mocks.read).not.toHaveBeenCalled();
    });

    it.each([
      ["a composite row id", `42161:${ID_A}`],
      ["a bare id that is too short", "0xabc"],
      ["an empty id", ""],
    ])("refuses %s without calling the API, with the code that names the mistake", async (_label, id) => {
      const { result } = renderHook(() => usePanelPool(42161, id));
      await tick(0);
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ status: 400, code: "INVALID_POOL_ID" });
      expect(mocks.read).not.toHaveBeenCalled();
    });

    it("accepts a PoolId in any letter case", async () => {
      mocks.read.mockResolvedValue(ok(POOL_A));
      const upper = `0x${ID_A.slice(2).toUpperCase()}`;
      const { result } = renderHook(() => usePanelPool(42161, upper));
      await tick(0);
      expect(result.current.status).toBe("ready");
      expect(mocks.read).toHaveBeenCalledWith(42161, upper);
    });
  });
});
