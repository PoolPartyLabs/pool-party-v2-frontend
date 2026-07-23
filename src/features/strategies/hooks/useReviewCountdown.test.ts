/**
 * @id PP-CORE-HOK-018
 * @name useReviewCountdown tests
 * @implements-rules-version v1
 *
 * The shared build→review re-quote countdown (POO-595, extracted from the POO-574 WithdrawModal glue):
 * while `active` it resets to `seconds`, ticks down once per second, and on reaching 0 fires
 * `onRefresh()` (the flow rebuild) and resets — repeating until it goes inactive. Inactive it holds and
 * never fires. Verified with fake timers.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewCountdown } from "./useReviewCountdown";

/** Advance fake timers inside act so the interval's setState flushes. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useReviewCountdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds at the full window and never fires while inactive", async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      useReviewCountdown({ active: false, seconds: 10, onRefresh }),
    );
    expect(result.current.seconds).toBe(10);
    await tick(5000);
    expect(result.current.seconds).toBe(10);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("resets to the full window on activate and ticks down once per second", async () => {
    const onRefresh = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) => useReviewCountdown({ active, seconds: 10, onRefresh }),
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    expect(result.current.seconds).toBe(10);
    await tick(3000);
    expect(result.current.seconds).toBe(7);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("fires onRefresh once and resets when it reaches 0, repeating each window", async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      useReviewCountdown({ active: true, seconds: 3, onRefresh }),
    );
    await tick(3000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.seconds).toBe(3);
    await tick(3000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(result.current.seconds).toBe(3);
  });

  it("clears the interval on deactivate: no further ticks, no refresh", async () => {
    const onRefresh = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) => useReviewCountdown({ active, seconds: 10, onRefresh }),
      { initialProps: { active: true } },
    );
    await tick(2000);
    expect(result.current.seconds).toBe(8);
    rerender({ active: false });
    await tick(20000);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("restarts at the full window each time it re-activates", async () => {
    const onRefresh = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) => useReviewCountdown({ active, seconds: 10, onRefresh }),
      { initialProps: { active: true } },
    );
    await tick(4000);
    expect(result.current.seconds).toBe(6);
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.seconds).toBe(10);
  });

  it("keeps ticking from where it was when onRefresh identity changes (no restart)", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onRefresh }) => useReviewCountdown({ active: true, seconds: 10, onRefresh }),
      { initialProps: { onRefresh: first } },
    );
    await tick(3000);
    expect(result.current.seconds).toBe(7);
    rerender({ onRefresh: second });
    await tick(2000);
    // A new onRefresh must NOT reset the window; it keeps counting down.
    expect(result.current.seconds).toBe(5);
  });

  // POO-888 [R3]: the Confirm click suspends the countdown SYNCHRONOUSLY - a zero-crossing landing
  // in the same tick as the click must not fire the re-quote (deactivating via the host's phase
  // state alone leaves that one-tick window open).
  describe("suspend (POO-888 R3)", () => {
    // @rule R3 - suspend() called before the zero-crossing effect flushes blocks the refresh.
    it("suspend() blocks a same-tick zero-crossing from firing onRefresh", async () => {
      const onRefresh = vi.fn();
      const { result } = renderHook(() =>
        useReviewCountdown({ active: true, seconds: 3, onRefresh }),
      );
      await tick(2000);
      // The interval is about to zero-cross; the user clicks Confirm in the same tick.
      act(() => {
        result.current.suspend();
      });
      await tick(5000);
      expect(onRefresh).not.toHaveBeenCalled();
    });

    // @rule R3 - a re-activation (leaving and re-entering the Review) re-arms the countdown.
    it("re-arms after suspend when the review re-activates", async () => {
      const onRefresh = vi.fn();
      const { result, rerender } = renderHook(
        ({ active }) => useReviewCountdown({ active, seconds: 3, onRefresh }),
        { initialProps: { active: true } },
      );
      act(() => {
        result.current.suspend();
      });
      await tick(4000);
      expect(onRefresh).not.toHaveBeenCalled();
      rerender({ active: false });
      rerender({ active: true });
      expect(result.current.seconds).toBe(3);
      await tick(3000);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
