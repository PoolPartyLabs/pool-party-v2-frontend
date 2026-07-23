/**
 * @id PP-CORE-HOK-018
 * @name useReviewCountdown
 * @implements-rules-version v1
 *
 * The shared build→review re-quote countdown (POO-595), extracted verbatim from the POO-574
 * WithdrawModal glue so the rollout modals (Remove, Move Range, Invest, Launch) don't each re-implement
 * the timer. While `active` (the modal is on its Review), it resets to `seconds`, ticks down once per
 * second, and on reaching 0 fires `onRefresh()` — the flow's `rebuild()` re-quote — then resets the
 * window, repeating until the review is left. Inactive it holds at the full window and never fires.
 *
 * `onRefresh` is read through a ref, so passing a fresh callback each render never restarts the window;
 * only `active`/`seconds` drive the interval. Returns the current seconds for the "Refreshes in {n}s"
 * label. No business logic of its own — behaviourally identical to the two inline WithdrawModal effects.
 *
 * POO-888 [R3]: `suspend()` halts the refresh SYNCHRONOUSLY (a ref, not state) for the Confirm click.
 * Deactivating via the host's phase alone leaves a one-tick window where a zero-crossing scheduled in
 * the same tick as the click would still fire `onRefresh()` - a re-quote racing the just-dispatched
 * send. Suspension re-arms when `active` toggles back on (the Review is re-entered).
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** Options for {@link useReviewCountdown}. */
export interface UseReviewCountdownOptions {
  /** True while the modal is on its Review (typically `phase === "review"`). */
  active: boolean;
  /** The full re-quote window, in seconds (e.g. 10). */
  seconds: number;
  /** Fired when the window elapses without approval — the flow's `rebuild()` re-quote. */
  onRefresh: () => void;
}

/** What {@link useReviewCountdown} returns to the Review host. */
export interface ReviewCountdown {
  /** The current window's remaining seconds, for the "Refreshes in {n}s" label. */
  seconds: number;
  /**
   * POO-888 [R3]: synchronously stop the zero-crossing refresh - called first thing in the Review's
   * Confirm handler, before any state updates, so a same-tick zero-crossing can't fire a re-quote
   * against the dispatched send. Re-arms when `active` goes false → true.
   */
  suspend: () => void;
}

/** Drive a review's visible re-quote countdown; see the file header for the full contract. */
export function useReviewCountdown({
  active,
  seconds,
  onRefresh,
}: UseReviewCountdownOptions): ReviewCountdown {
  const [countdown, setCountdown] = useState(seconds);
  // Keep the latest onRefresh without restarting the timer when its identity changes.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  // POO-888 [R3]: the synchronous suspension gate - a ref so the Confirm click blocks a zero-crossing
  // scheduled in the same tick (state would only apply on the next render, too late).
  const suspendedRef = useRef(false);

  // Reset to the full window on entering the review (re-arming any suspension), then tick down once
  // per second; clear the interval when the review is left or the hook unmounts.
  useEffect(() => {
    if (!active) return;
    suspendedRef.current = false;
    setCountdown(seconds);
    const id = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [active, seconds]);

  // At 0, re-quote (onRefresh) and reset the window — refreshing the built figures without leaving the
  // review. Guarded so it fires once per zero-crossing. POO-888 R3: while suspended the window still
  // resets (so a stale 0 can't fire on re-activation) but the refresh itself is swallowed.
  useEffect(() => {
    if (!active || countdown > 0) return;
    setCountdown(seconds);
    if (suspendedRef.current) return;
    onRefreshRef.current();
  }, [active, countdown, seconds]);

  return useMemo(
    () => ({
      seconds: countdown,
      suspend: () => {
        suspendedRef.current = true;
      },
    }),
    [countdown],
  );
}
