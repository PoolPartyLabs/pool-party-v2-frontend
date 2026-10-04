/**
 * @id PP-MGR-HOK-012
 * @name usePanelPool tests (real mode)
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks)
 *
 * Rules under test (POO-2185 rules v1):
 *   [R5] the hook reads on mount and every 15 s while mounted, stops on unmount, and an in-flight
 *        answer for an old pool never overwrites the new one
 *   [R6] real mode has no fallback to fixtures: a failed read is an error with a retry (P13)
 *
 * The server action and the services seam are mocked; polling is verified with fake timers.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_POOL_PRICE_REFRESH_MS } from "@/features/manager/hooks/useLivePoolPrice";
import type { CatalogPool } from "@/lib/api/v2/schemas";
import { findPanelPoolFixture } from "@/mocks/data/buildPanelFixtures";
import { usePanelPool } from "./usePanelPool";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({ getCatalogPoolAction: mocks.read }));
vi.mock("@/features/manager/actions", () => ({ getPoolCurrentPriceAction: vi.fn() }));

function fixture(id: string): CatalogPool {
  const pool = findPanelPoolFixture(42161, id);
  if (!pool) throw new Error(`no fixture ${id}`);
  return pool;
}

const POOL_A = fixture("arb-v4-weth-usdc-5");
const POOL_B = fixture("arb-v4-weth-usdc-30");
const ID_A = POOL_A.poolId;
const ID_B = POOL_B.poolId;

const ok = (pool: CatalogPool) => ({ ok: true as const, data: pool });
const fail = (status: number, code: string) => ({
  ok: false as const,
  error: { status, code },
});

/** A copy of a fixture pool at another price, so a refresh visibly changes the view. */
function repriced(pool: CatalogPool, price: string): CatalogPool {
  const copy = structuredClone(pool);
  copy.currentPrice.token1PerToken0 = price;
  return copy;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Advance fake timers inside act so the async state updates flush. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
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

  it("polls on the shared 15 s cadence", () => {
    expect(LIVE_POOL_PRICE_REFRESH_MS).toBe(15_000);
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
      const robinhood = findPanelPoolFixture(4663, "rbh-v4-weth-usdg-5");
      if (!robinhood) throw new Error("fixture");
      mocks.read.mockResolvedValue(ok(robinhood));
      const { result } = renderHook(() => usePanelPool(4663, robinhood.poolId));
      await tick(0);
      expect(mocks.read).toHaveBeenCalledWith(4663, robinhood.poolId);
      expect(result.current.pool?.orientation.quote.symbol).toBe("USDG");
    });
  });

  describe("polling [R5]", () => {
    it("refetches every 15 s while mounted and keeps the view current", async () => {
      mocks.read
        .mockResolvedValueOnce(ok(POOL_A))
        .mockResolvedValueOnce(ok(repriced(POOL_A, "3100")))
        .mockResolvedValue(ok(repriced(POOL_A, "3150")));
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(0);
      expect(mocks.read).toHaveBeenCalledTimes(1);

      await tick(14_999);
      expect(mocks.read).toHaveBeenCalledTimes(1);
      await tick(1);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      expect(result.current.pool?.price).toBe(3100);
      expect(result.current.refreshedAt).toBe(Date.parse("2026-10-04T10:00:15Z"));

      await tick(15_000);
      expect(mocks.read).toHaveBeenCalledTimes(3);
      expect(result.current.pool?.price).toBe(3150);
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

    it("applies only the latest read when two overlap", async () => {
      const first = deferred<ReturnType<typeof ok>>();
      const second = deferred<ReturnType<typeof ok>>();
      mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => usePanelPool(42161, ID_A));
      await tick(15_000);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      await act(async () => {
        second.resolve(ok(repriced(POOL_A, "3100")));
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        first.resolve(ok(repriced(POOL_A, "3000")));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.pool?.price).toBe(3100);
    });
  });

  describe("a change of pool [R5]", () => {
    it("shows nothing of the old pool while the new one loads", async () => {
      const pending = deferred<ReturnType<typeof ok>>();
      mocks.read.mockImplementation((_chain: number, id: string) =>
        id === ID_A ? Promise.resolve(ok(POOL_A)) : pending.promise,
      );
      const { result, rerender } = renderHook(({ id }) => usePanelPool(42161, id), {
        initialProps: { id: ID_A },
      });
      await tick(0);
      expect(result.current.pool?.poolId).toBe(ID_A);

      rerender({ id: ID_B });
      expect(result.current.pool).toBeNull();
      expect(result.current.status).toBe("loading");
      expect(result.current.refreshedAt).toBeNull();

      await act(async () => {
        pending.resolve(ok(POOL_B));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.pool?.poolId).toBe(ID_B);
      expect(result.current.pool?.feePct).toBe(0.3);
    });

    it("never lets an in-flight answer for an old pool overwrite the new one", async () => {
      const slow = deferred<ReturnType<typeof ok>>();
      mocks.read.mockImplementation((_chain: number, id: string) =>
        id === ID_A ? slow.promise : Promise.resolve(ok(POOL_B)),
      );
      const { result, rerender } = renderHook(({ id }) => usePanelPool(42161, id), {
        initialProps: { id: ID_A },
      });
      rerender({ id: ID_B });
      await tick(0);
      expect(result.current.pool?.poolId).toBe(ID_B);

      await act(async () => {
        slow.resolve(ok(POOL_A));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.pool?.poolId).toBe(ID_B);
      expect(result.current.status).toBe("ready");
    });

    it("never lets a late FAILURE of the old pool flip the new one to an error", async () => {
      const slow = deferred<ReturnType<typeof fail>>();
      mocks.read.mockImplementation((_chain: number, id: string) =>
        id === ID_A ? slow.promise : Promise.resolve(ok(POOL_B)),
      );
      const { result, rerender } = renderHook(({ id }) => usePanelPool(42161, id), {
        initialProps: { id: ID_A },
      });
      rerender({ id: ID_B });
      await tick(0);
      await act(async () => {
        slow.resolve(fail(503, "V2_UNAVAILABLE"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.status).toBe("ready");
      expect(result.current.error).toBeNull();
    });

    it("reads again, on the new schedule, after the chain changes", async () => {
      const robinhood = findPanelPoolFixture(4663, "rbh-v4-weth-usdg-5");
      if (!robinhood) throw new Error("fixture");
      mocks.read.mockImplementation((chain: number) =>
        Promise.resolve(ok(chain === 4663 ? robinhood : POOL_A)),
      );
      const { result, rerender } = renderHook(
        ({ chain, id }) => usePanelPool(chain as 42161 | 4663, id),
        { initialProps: { chain: 42161, id: ID_A } },
      );
      await tick(0);
      rerender({ chain: 4663, id: robinhood.poolId });
      await tick(0);
      expect(mocks.read).toHaveBeenLastCalledWith(4663, robinhood.poolId);
      expect(result.current.pool?.network).toBe("robinhood");
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

    it("keeps retrying with a single schedule: no duplicate interval after a retry", async () => {
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
    });

    it("keeps the last good view while a refresh fails, and says it is stale", async () => {
      mocks.read
        .mockResolvedValueOnce(ok(POOL_A))
        .mockResolvedValueOnce(fail(504, "UPSTREAM_TIMEOUT"))
        .mockResolvedValue(ok(repriced(POOL_A, "3200")));
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
      expect(result.current.pool?.price).toBe(3200);
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
