/**
 * @id PP-MGR-HOK-005 (POO-861)
 * @name useLivePoolPrice tests
 * @implements-rules-version v1
 *
 * Real-mode behavior (POO-861 R1/R3): seeds with the selection price, does NOT fetch on mount, polls
 * every 15s while active (and not while inactive), refresh() forces an immediate read, and a null read
 * keeps the last known price. The server action + services seam are mocked; verified with fake timers.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getPoolCurrentPriceAction } = vi.hoisted(() => ({
  getPoolCurrentPriceAction: vi.fn(),
}));
vi.mock("../actions", () => ({ getPoolCurrentPriceAction }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));

import { useLivePoolPrice } from "./useLivePoolPrice";

const params = {
  network: "base",
  currency0: "0xAAA",
  currency1: "0xBBB",
  feeTier: 500,
  initialPrice: 3000,
};

/** Advance fake timers inside act so the interval's async setState flushes. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useLivePoolPrice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getPoolCurrentPriceAction.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("seeds with the initial price and does not fetch on mount", () => {
    const { result } = renderHook(() => useLivePoolPrice({ ...params, active: true }));
    expect(result.current.price).toBe(3000);
    expect(getPoolCurrentPriceAction).not.toHaveBeenCalled();
  });

  it("polls every 15s while active and updates the price", async () => {
    getPoolCurrentPriceAction.mockResolvedValue({ currentPrice: 3123.45, tickCurrent: 12345 });
    const { result } = renderHook(() => useLivePoolPrice({ ...params, active: true }));
    await tick(15_000);
    expect(getPoolCurrentPriceAction).toHaveBeenCalledTimes(1);
    expect(getPoolCurrentPriceAction).toHaveBeenCalledWith({
      network: "base",
      currency0: "0xAAA",
      currency1: "0xBBB",
      feeTier: 500,
    });
    expect(result.current.price).toBe(3123.45);
  });

  it("does not poll while inactive", async () => {
    const { result } = renderHook(() => useLivePoolPrice({ ...params, active: false }));
    await tick(60_000);
    expect(getPoolCurrentPriceAction).not.toHaveBeenCalled();
    expect(result.current.price).toBe(3000);
  });

  it("refresh() forces an immediate read", async () => {
    getPoolCurrentPriceAction.mockResolvedValue({ currentPrice: 2950, tickCurrent: 111 });
    const { result } = renderHook(() => useLivePoolPrice({ ...params, active: true }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(getPoolCurrentPriceAction).toHaveBeenCalledTimes(1);
    expect(result.current.price).toBe(2950);
  });

  it("keeps the last known price when the read returns null", async () => {
    getPoolCurrentPriceAction.mockResolvedValue(null);
    const { result } = renderHook(() => useLivePoolPrice({ ...params, active: true }));
    await tick(15_000);
    expect(getPoolCurrentPriceAction).toHaveBeenCalledTimes(1);
    expect(result.current.price).toBe(3000);
  });
});
