/**
 * @id PP-PORT (POO-299, POO-270, POO-453)
 * @name usePositions
 * @implements-rules-version v2
 *
 * Real-mode client hook for the connected wallet's positions. Waits for the SIWE session
 * (POO-270) and then fetches via getPositionsAction, which derives the wallet server-side
 * from the session cookie — the address is no longer passed from the client. `positions` is
 * null while loading; a SIWE failure surfaces as an error so the loader can react.
 *
 * v2 (POO-453 resilience): getPositionsAction now returns a discriminated result. [R4] A transient
 * failure (throttle 429, gateway/DB blip, timeout, network) no longer hard-fails the page: the hook
 * keeps the last-good positions on screen, sets `isRetrying`, and retries on a bounded backoff. The
 * browser can wait out a 60s throttle window — SSR cannot. [R5] A non-retryable failure (or exhausted
 * retries) still surfaces via `error` so the loader can show the error boundary.
 *
 * Used only inside real-mode data loaders; in mock mode the routes SSR the mock directly.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPositionsAction } from "@/features/portfolio/actions";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import type { Position } from "@/lib/schemas";

/**
 * [R4] Backoff before each retry of a transient failure (ms). Bounded to 3 retries within a single
 * throttle window (the backend blocks for up to 60s), so a throttled read self-heals without ever
 * hanging or spamming. One tunable constant; its length is the max retry count.
 */
const RETRY_BACKOFF_MS = [3000, 8000, 20_000];

/**
 * Fetch the signed-in wallet's positions. `positions` is null until the first read resolves and
 * stays populated across background refreshes and transient failures (never blanks on a retry).
 * `isRetrying` is true while a transient failure is being retried, so a loader can show a subtle
 * "still loading" note without an alarming error. `refresh()` forces a re-fetch — used after an
 * invest/withdraw so the just-changed position shows its new state.
 */
export function usePositions(): {
  positions: Position[] | null;
  error: unknown;
  isRetrying: boolean;
  refresh: () => void;
} {
  const { isSignedIn, status } = useSiweSession();
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  // Retry bookkeeping. A ref (not state) so the count survives the effect re-runs a retry triggers,
  // and resets to 0 on any success. The timer is cleared before scheduling a new one / on teardown.
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== undefined) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick is an intentional re-fetch trigger — bumping it re-runs the effect though the body doesn't read it. clearRetryTimer is stable.
  useEffect(() => {
    if (status === "error") {
      setError(new Error("Could not establish a wallet session"));
      return;
    }
    if (!isSignedIn) {
      clearRetryTimer();
      attemptRef.current = 0;
      setPositions(null);
      setError(null);
      setIsRetrying(false);
      return;
    }

    let active = true;
    // Only the first load and sign-out clear the list; background refreshes (refreshTick / focus /
    // interval) and transient-failure retries replace it in place, so an open screen never flashes
    // its loading skeleton and never blanks under a throttle (POO-329, POO-453).
    setError(null);
    getPositionsAction()
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          // Success clears the degraded state and resets the retry budget.
          attemptRef.current = 0;
          clearRetryTimer();
          setIsRetrying(false);
          setPositions(result.positions);
          return;
        }
        if (result.retryable) {
          scheduleRetryOrGiveUp();
          return;
        }
        // [R5] Non-retryable failure: surface immediately.
        attemptRef.current = 0;
        setIsRetrying(false);
        setError(new Error("Could not load positions"));
      })
      .catch(() => {
        // A thrown Server Action invocation (e.g. a network blip reaching the server) is transient.
        if (active) scheduleRetryOrGiveUp();
      });

    // [R4] Retry a transient failure on a bounded backoff, keeping last-good positions; give up (and
    // surface the error) once the retry budget is spent.
    function scheduleRetryOrGiveUp() {
      if (attemptRef.current < RETRY_BACKOFF_MS.length) {
        const delay = RETRY_BACKOFF_MS[attemptRef.current];
        attemptRef.current += 1;
        setIsRetrying(true);
        clearRetryTimer();
        retryTimerRef.current = setTimeout(() => setRefreshTick((tick) => tick + 1), delay);
        return;
      }
      // Retries exhausted: give up and surface the error.
      attemptRef.current = 0;
      setIsRetrying(false);
      setError(new Error("Could not load positions"));
    }

    return () => {
      active = false;
    };
  }, [isSignedIn, status, refreshTick, clearRetryTimer]);

  // Drop any pending retry when the hook unmounts.
  useEffect(() => clearRetryTimer, [clearRetryTimer]);

  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  // Keep an open Portfolio/Home fresh without a manual nav: re-fetch when the tab regains focus and
  // on a modest interval, both paused while the tab is hidden so a backgrounded app never polls
  // (POO-329). Refreshes are silent (the list updates in place) — no skeleton flash.
  useEffect(() => {
    if (!isSignedIn) return;
    const REFRESH_MS = 45_000;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (intervalId === undefined) intervalId = setInterval(refresh, REFRESH_MS);
    };
    const stop = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => refresh();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [isSignedIn, refresh]);

  return { positions, error, isRetrying, refresh };
}
