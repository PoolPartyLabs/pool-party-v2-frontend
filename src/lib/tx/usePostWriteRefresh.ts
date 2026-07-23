/**
 * @id PP-CORE-HOK-016 (POO-364, POO-453, POO-638)
 * @name usePostWriteRefresh
 * @implements-rules-version v1
 *
 * Shared post-write freshness. After a confirmed on-chain write, every view that shows the
 * affected entity must reflect it without a manual reload. The backend reflects writes within
 * seconds, but a single client refetch races that indexer window, and `router.refresh()` only
 * re-runs the CURRENT route's server components — not a client data-loader on another route.
 *
 * This hook returns one stable callback that, on the immediate pass: re-runs the caller's local
 * client refetch (`refreshLocal`, e.g. usePositions().refresh or the manager-console refresh),
 * busts this wallet's positions cache, invalidates the strategy catalog cache ([R4], revalidate
 * BEFORE router.refresh else the stale cache is re-read), and re-renders the route. It then repeats
 * ONLY the cheap positions-invalidate + local refetch on a BOUNDED schedule to absorb the indexer
 * lag — the catalog revalidate + RSC refresh run once, never per tick, because re-firing them storms
 * the backend throttle (POO-377).
 *
 * POO-638 (rules v1) makes the follow-up schedule DETERMINISTIC when the caller supplies the mined
 * receipt block + the touched strategy ids:
 * - [R1] instead of the blind POLL_DELAYS_MS that stopped at 13s (POO-492), it polls the v2 read's
 *   `onchain.blockNumber` per touched strategy with bounded backoff until converged
 *   (`onchain.blockNumber >= receipt.blockNumber`, {@link nextConvergenceStep}) or a hard cap
 *   ({@link CONVERGENCE_CAP_MS}). Each observation still busts positions + refetches, so the existing
 *   subtle "updating" affordance shows while it converges.
 * - [R2] a caller that does NOT pass convergence info (a surface not yet on v2 reads) keeps the blind
 *   bounded poll below, unchanged.
 * - [R3] the confirm POST (POO-307) fires FIRST from the write flow so the backend refreshes the
 *   touched position immediately; this poll only OBSERVES the v2 onchain block, it never writes.
 *
 * POO-453: the positions read is short-cached, so each POLL TICK busts `positionsTag(wallet)` before
 * refetching (else it reads the pre-write cached value). That revalidate is cheap (marks the tag
 * stale, no upstream fetch), so — unlike the catalog revalidate — it is safe to repeat per tick.
 * The immediate refetch stays synchronous (its own read is pre-index anyway) so the success UI reacts
 * at once; the ticks are what converge to the indexed value.
 * Mock-safe: in mock mode it runs a single pass and schedules no timers (never polls real reads).
 * Consolidates the duplicated success-refresh across the operation modals + create ([R5]). Folds
 * in POO-363.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { revalidatePositionsAction } from "@/lib/portfolio/revalidatePositions";
import { isMockMode } from "@/lib/services";
import { revalidateStrategiesAction } from "@/lib/strategies/revalidateStrategies";
import { readStrategyOnchainBlocksAction } from "@/lib/strategies/v2/strategiesV2Actions";
import { convergenceBackoffMs, nextConvergenceStep } from "./blockConvergence";

/**
 * Follow-up refresh offsets (ms) AFTER the immediate pass, for the [R2] fallback path (surfaces not
 * yet on v2 reads). Bounded + self-terminating: covers the few-seconds backend indexer window
 * without unbounded polling. Superseded by deterministic convergence when the caller passes a receipt
 * block ([R1]).
 */
export const POLL_DELAYS_MS = [2000, 5000, 9000, 13_000];

/**
 * [R1] What a caller hands the refresh callback to opt into deterministic convergence: the mined
 * receipt block from the wallet flow and the strategy id(s) the write touched. Omit it (or pass no
 * strategy ids) to keep the [R2] blind fallback poll.
 */
export interface PostWriteConvergence {
  /** The mined receipt block number (from useWalletSignFlow / the tx receipt). */
  blockNumber: number;
  /** The strategy id(s) whose indexed onchain state the write touched. */
  strategyIds: string[];
}

/**
 * Returns a referentially stable callback to call once from a write's success handler.
 *
 * @param refreshLocal - The caller's in-place client refetch (positions / manager console). Omit it
 *   where the writing route has no local loader (e.g. create-pool on /manager/new).
 * @returns A callback accepting an optional {@link PostWriteConvergence}: with it, the follow-up poll
 *   is deterministic ([R1]); without it, the blind bounded fallback runs ([R2]).
 */
export function usePostWriteRefresh(
  refreshLocal?: () => void,
): (convergence?: PostWriteConvergence) => void {
  const router = useRouter();
  // Refs keep the returned callback stable regardless of changing `refreshLocal` / `router` identity,
  // so a success effect that depends on it never re-fires (mirrors the existing onChangedRef pattern).
  const refreshLocalRef = useRef(refreshLocal);
  refreshLocalRef.current = refreshLocal;
  const routerRef = useRef(router);
  routerRef.current = router;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Bumped on every invocation + on unmount, so an in-flight async convergence tick (which awaits the
  // v2 read between timers) bails instead of scheduling more work for a superseded / unmounted run.
  const runIdRef = useRef(0);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  // Cancel any pending follow-ups (and invalidate any in-flight tick) when the host unmounts.
  useEffect(
    () => () => {
      runIdRef.current++;
      clearTimers();
    },
    [clearTimers],
  );

  /** Bust the short-lived positions cache, then refetch — the per-observation "updating" affordance. */
  const observePositions = useCallback((runId: number) => {
    void revalidatePositionsAction().then(() => {
      if (runIdRef.current === runId) refreshLocalRef.current?.();
    });
  }, []);

  return useCallback(
    (convergence?: PostWriteConvergence) => {
      const runId = ++runIdRef.current; // supersede any prior poll (blind or convergence)
      clearTimers();
      // Immediate pass: run the caller's local refetch synchronously so the success UI (onChanged /
      // console refresh) reacts at once, and start busting this wallet's positions cache. The write is
      // not indexed yet, so the immediate read shows pre-write data regardless of the cache; the
      // follow-up poll (which invalidates THEN refetches) converges to the indexed value (POO-453).
      refreshLocalRef.current?.();
      void revalidatePositionsAction();
      // Invalidate the catalog BEFORE re-rendering, else router.refresh() re-fetches the stale cache.
      // The catalog revalidate + RSC refresh are expensive, so they run ONCE — re-firing them per tick
      // stormed the SSR caller against the backend throttle and 504'd the gateway (POO-377).
      void revalidateStrategiesAction().then(() => routerRef.current.refresh());
      if (isMockMode) return;

      const strategyIds = convergence?.strategyIds ?? [];
      if (convergence && strategyIds.length > 0) {
        // [R1][R3] Deterministic convergence: observe the v2 onchain block per touched strategy with
        // bounded backoff until it catches up to the mined receipt block, or the hard cap. Each tick
        // busts positions + refetches (the affordance), then decides whether to keep observing.
        const targetBlock = convergence.blockNumber;
        const startedAt = Date.now();
        let pending = strategyIds;
        let attempt = 0;

        const scheduleTick = (delayMs: number) => {
          timersRef.current.push(setTimeout(runTick, delayMs));
        };

        const runTick = async () => {
          if (runIdRef.current !== runId) return; // superseded / unmounted before this fired
          let reads: Record<string, number | null> = {};
          try {
            reads = await readStrategyOnchainBlocksAction(pending);
          } catch {
            // Observe-only ([R3]): a failed read is "no progress this tick"; the cap still bounds us.
            reads = {};
          }
          if (runIdRef.current !== runId) return; // unmounted while awaiting the read
          observePositions(runId);
          attempt += 1;
          const step = nextConvergenceStep({
            pending,
            reads,
            targetBlock,
            attempt,
            elapsedMs: Date.now() - startedAt,
          });
          if (step.done) return; // converged or capped — the refetch above surfaced the latest value
          pending = step.pending;
          scheduleTick(step.nextDelayMs);
        };

        scheduleTick(convergenceBackoffMs(0));
        return;
      }

      // [R2] Fallback: blind bounded poll for surfaces not yet on v2 reads. Each tick busts the
      // short-lived positions cache FIRST, then refetches, so a tick that lands after the indexer
      // catches up reads the fresh value instead of the cached pre-write one.
      timersRef.current = POLL_DELAYS_MS.map((delay) =>
        setTimeout(() => observePositions(runId), delay),
      );
    },
    [clearTimers, observePositions],
  );
}
