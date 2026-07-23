/**
 * @id PP-CORE-HOK-015
 * @name useWalletSignFlow
 * @implements-rules-version v2 · v1 (POO-888 rules v1) · v1 (POO-887 rules v1) · v1 (POO-885 rules v1)
 *
 * Drives a {@link WalletSteps}/{@link WalletSignModal} from REAL wallet/tx events (FU-001): runs an
 * ordered list of awaitable step fns, advancing `activeStep` + per-step status as each settles, and
 * routing a thrown step to an error state whose `retry()` resumes from the failed step (already-done
 * steps are not re-run). Privy-free + mock-safe so it unit-tests with stub steps. The host keeps owning
 * its phase state machine + analytics; this only owns the step progression.
 *
 * Each step's `run(ctx)` may return a partial context (merged for later steps), `{ txHash }` to record
 * a mined hash, or `{ skipped: true }` to mark the step skipped (e.g. an approve whose allowance is
 * already sufficient) and advance. Throwing fails the flow at that step. Steps must not mutate `ctx`.
 *
 * The host should keep the `steps` array's length stable for a given flow instance (it always is per
 * operation); `reset()` rebuilds the per-step arrays from the current step list.
 *
 * POO-888 (rules v1) - the re-quote vs Confirm races:
 * [R1] At most one step is ever "active": every new run reconciles statuses orphaned by a cancelled
 *      run (an orphaned "active" before the start index becomes "done", after it becomes "idle").
 * [R2] `resume()` during an in-flight (re)build SERIALIZES behind it - the queued Confirm converts
 *      the pause into a run-through, so the send always signs the FRESH build, never a stale one.
 * [R4] Once past the pause (the send region), the run is uncancellable by `rebuild()`: a countdown
 *      zero-crossing landing after Confirm is absorbed by the in-flight run, whose outcome (success
 *      or failure) is always consumed. A second `resume()` mid-send is likewise a no-op (no double
 *      dispatch). [R3, countdown-side] lives in useReviewCountdown.suspend(); [R5] all six operation
 *      modals share this hook, so the guarantees hold across the family.
 *
 * POO-887 (rules v1) - the retry gate:
 * [R1] A retry (retry()/retryFrom()) whose FAILED step sits at or before the pause index re-honors
 *      `pauseAfterKey`: the pause was never consumed this run (e.g. a permit cancel before any
 *      Review), so the user lands on the Review again before any money-moving signature.
 * [R2] A post-Review retry keeps its run-through semantics (POO-499's legitimate re-quote case);
 *      `retryWillPause` tells the host which phase to enter ("building" re-engages the
 *      awaiting → review mapping; "pending" keeps the send stepper).
 * [R3] A post-Review retry never reuses a built tx older than {@link MAX_BUILT_TX_AGE_MS} (the
 *      server's secParams sigDeadline is 5 min - a stale send is a guaranteed revert): it restarts
 *      from the build step, run-through. `builtAt` is tracked whenever the pause-key step completes.
 * [R4] Shared hook - the same gate holds across all six operation modals.
 *
 * POO-885 (rules v1) - background re-quote failures are non-fatal:
 * [R1] A failed countdown rebuild NEVER terminates the flow: the last good quote stays, the flow
 *      returns to `awaiting`, and the next 10s window retries.
 * [R2] `quoteStale` flips after {@link STALE_QUOTE_FAILURES} consecutive background failures (a
 *      subtle Review hint) and clears on the next good build. Hard ceiling: `resume()` never sends
 *      a build older than {@link MAX_BUILT_TX_AGE_MS} - it rebuilds first, run-through.
 * [R3] Failure analytics stay host-side and only fire on flow `status === "error"`, which background
 *      failures no longer produce - only user-action failures (run/retry/queued Confirm) surface.
 * [R4] Every `useReviewCountdown` host shares these semantics through this hook.
 */
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useGrantDuckShootTry } from "@/features/rewards/hooks/useGrantDuckShootTry";
import { type TxError, toTxError } from "@/lib/tx/diagnostics";
import type { WalletStepStatus } from "../components/WalletSteps";

/** The result a step may return: context to merge, a mined hash, and/or a skip marker. */
export type FlowStepResult<Ctx> = (Partial<Ctx> & { txHash?: string; skipped?: boolean }) | void;

/** One ordered step in a wallet-sign flow. Its `key` aligns with the modal's step descriptor. */
export interface FlowStep<Ctx> {
  /** Stable key (matches the WalletSignSpec-derived descriptor key). */
  key: string;
  /** Run the step against the accumulating context. Throws to fail; returns a partial/skip/hash. */
  run: (ctx: Ctx) => Promise<FlowStepResult<Ctx>>;
}

/** Overall flow status (drives the host's confirm/pending/success/error phase). POO-574: `awaiting`
 * is the opt-in pause after `pauseAfterKey` — the build step is done and the flow holds for the
 * user's approval on the Review, before the wallet send/sign step runs. */
export type FlowStatus = "idle" | "running" | "awaiting" | "success" | "error";

/**
 * POO-887 [R3]: how long a built tx stays sendable. The server embeds a 5-minute Permit2
 * `secParams.sigDeadline` at build time (blockchain.service.ts:736); past ~4 minutes the FE treats
 * the build as stale and rebuilds before any send (retry or Confirm), never signing a
 * guaranteed-revert tx. Also POO-885 [R2]'s hard Confirm ceiling.
 */
export const MAX_BUILT_TX_AGE_MS = 4 * 60_000;

/** POO-885 [R2]: consecutive background re-quote failures before the Review shows the stale hint. */
export const STALE_QUOTE_FAILURES = 3;

/** What the host wires into the modal + its phase machine. */
export interface WalletSignFlow<Ctx = Record<string, unknown>> {
  /** Active step index (→ WalletSteps.activeStep). */
  activeStep: number;
  /** Per-step status (→ WalletSteps.statuses). */
  statuses: WalletStepStatus[];
  /** Per-step mined hash (→ WalletSteps.txHashes). */
  txHashes: (string | undefined)[];
  /** Overall status. */
  status: FlowStatus;
  /** Structured error when `status === "error"` (→ TransactionErrorActions). */
  error: TxError | null;
  /** Terminal mined hash (the last step that produced one). */
  txHash: string | null;
  /**
   * The accumulated step context (POO-574). Exposed reactively so a build→review→sign host can read
   * the built figures (e.g. `estimatedGasInUsd`) while paused in `awaiting` and after each rebuild.
   */
  context: Ctx;
  /**
   * POO-887 [R2]: true when the NEXT `retry()`/`retryFrom()` will re-honor the Review pause (the
   * failed step sits at or before the pause, so the pause was never consumed this run). Hosts use it
   * to pick the retry phase: `"building"` (re-engages the awaiting → review mapping) vs `"pending"`.
   */
  retryWillPause: boolean;
  /**
   * POO-885 [R2]: true after {@link STALE_QUOTE_FAILURES} consecutive BACKGROUND re-quote failures -
   * the Review shows a subtle "quote may be outdated" hint. A successful rebuild clears it.
   * Background failures never terminate the flow [R1]; the countdown just retries.
   */
  quoteStale: boolean;
  /** Start the flow from the beginning. */
  run: () => Promise<void>;
  /**
   * Resume from the failed step, reusing prior context (no re-sign of done steps). POO-887: a
   * pre-Review failure re-pauses at the Review [R1]; a post-Review retry runs through but rebuilds
   * first when the built tx is past {@link MAX_BUILT_TX_AGE_MS} [R3].
   */
  retry: () => Promise<void>;
  /**
   * Resume from the earliest step whose `key` matches (POO-499 R2a): the slippage auto-retry uses
   * `retryFrom("build")` so the backend re-quotes minOut, without re-running/re-signing the earlier
   * approve/permit steps. Steps before the target keep their done/skipped status, txHashes and
   * accumulated context; the target and everything after it reset to idle before the re-run. When no
   * step carries the key, it falls back to {@link retry} (resume from the failed step).
   */
  retryFrom: (key: string) => Promise<void>;
  /**
   * Continue from an `awaiting` pause (POO-574): run the steps AFTER `pauseAfterKey` — the wallet
   * send/sign — once the user approves on the Review. No-op semantics if never paused.
   */
  resume: () => Promise<void>;
  /**
   * Re-run the `pauseAfterKey` step (POO-574 re-quote): re-runs the build (reusing any earlier
   * approve/permit context) and pauses again in `awaiting` with refreshed context. Drives the
   * Review's 10s countdown refresh.
   */
  rebuild: () => Promise<void>;
  /** Reset to idle (cancels any in-flight run); call on dialog re-open. */
  reset: () => void;
}

/** Options for {@link useWalletSignFlow}. */
export interface UseWalletSignFlowOptions<Ctx> {
  /** Seed context available to the first step. */
  initialContext?: Ctx;
  /** Fallback error code when a thrown error carries none (e.g. "INVEST_FAILED"). */
  fallbackErrorCode?: string;
  /**
   * POO-574: when set, the flow PAUSES after the step whose `key` matches (status → `awaiting`),
   * exposing the accumulated `context` for a Review, and waits for `resume()`. `run()` and
   * `rebuild()` honor the pause; `retry()`/`retryFrom()` run through it (a post-approval re-quote
   * must not bounce the user back to the Review). Omitted → the flow runs straight through (default).
   */
  pauseAfterKey?: string;
}

/** Runner that drives a wallet-sign modal from the real settlement of ordered async steps. */
export function useWalletSignFlow<Ctx = Record<string, unknown>>(
  steps: FlowStep<Ctx>[],
  options: UseWalletSignFlowOptions<Ctx> = {},
): WalletSignFlow<Ctx> {
  const [activeStep, setActiveStep] = useState(0);
  const [statuses, setStatuses] = useState<WalletStepStatus[]>(() => steps.map(() => "idle"));
  const [txHashes, setTxHashes] = useState<(string | undefined)[]>(() =>
    steps.map(() => undefined),
  );
  const [status, setStatus] = useState<FlowStatus>("idle");
  const [error, setError] = useState<TxError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  // POO-574: the accumulated context exposed reactively (the build→review host reads built figures).
  const [context, setContext] = useState<Ctx>(() => options.initialContext ?? ({} as Ctx));
  // POO-885 R2: consecutive BACKGROUND re-quote failures (reset by any successful build).
  const [rebuildFailures, setRebuildFailures] = useState(0);

  // Refs keep the callbacks stable regardless of whether the host memoizes `steps`/`options`.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // POO-764: every mined protocol tx earns a Duck Shoot try. Held in a ref so runFrom's identity and
  // deps stay unchanged; the hook is real-mode-only, deduped, and lets the backend decide eligibility.
  const grantTry = useGrantDuckShootTry();
  const grantTryRef = useRef(grantTry);
  grantTryRef.current = grantTry;
  // Accumulating context + the index to (re)start from + a run-id guard for cancellation.
  const ctxRef = useRef<Ctx>(options.initialContext ?? ({} as Ctx));
  const startRef = useRef(0);
  const runIdRef = useRef(0);
  // POO-574: the index of the step we paused after (pauseAfterKey), so resume()/rebuild() know where.
  const pausedIndexRef = useRef(-1);
  // POO-888: the in-flight run's bookkeeping, so resume()/rebuild() can serialize/no-op against it
  // instead of cancelling it (`pastPause` marks the uncancellable send region, R4).
  const currentRunRef = useRef<{ id: number; pastPause: boolean; promise: Promise<void> } | null>(
    null,
  );
  // POO-888 R2: a Confirm click queued behind an in-flight (re)build - the run consumes it at the
  // pause point and continues straight into the send with the fresh build.
  const pendingResumeRef = useRef(false);
  // POO-887 R3: when the pause-key (build) step last completed, so retry()/resume() can refuse to
  // send a build past MAX_BUILT_TX_AGE_MS (the server's 5-min sigDeadline) and rebuild instead.
  const builtAtRef = useRef<number | null>(null);

  // `pauseAfter` (POO-574): when a completed step's key matches it, hold in `awaiting` and return,
  // so the host can render a Review before the remaining (send/sign) steps run. run()/rebuild() pass
  // it; retry()/retryFrom()/resume() pass undefined so a post-approval re-quote runs straight through.
  // `background` (POO-885): a countdown-initiated rebuild. Its failure is NON-FATAL [R1]: the flow
  // returns to `awaiting` with the last good quote (the failed step's status restored to "done") and
  // the consecutive-failure counter increments; the next 10s window simply retries. Only a queued
  // Confirm (a user action) turns the failure fatal.
  const runFrom = useCallback(
    (from: number, pauseAfter?: string, background = false): Promise<void> => {
      const runId = ++runIdRef.current;
      const record = {
        id: runId,
        // POO-888 R4: a run starting after the pause point (the resumed send) is born uncancellable.
        pastPause: pausedIndexRef.current >= 0 && from > pausedIndexRef.current,
        promise: Promise.resolve(),
      };
      currentRunRef.current = record;
      const promise = (async () => {
        const flowSteps = stepsRef.current;
        setStatus("running");
        setError(null);
        // POO-888 R1: single-active invariant - reconcile any "active" orphaned by a cancelled run
        // (before the start index it had completed in a prior run; at/after it, this run re-drives it).
        setStatuses((prev) =>
          prev.map((value, index) =>
            value === "active" ? (index < from ? "done" : "idle") : value,
          ),
        );
        for (let index = from; index < flowSteps.length; index++) {
          if (runIdRef.current !== runId) return; // cancelled (reset / unmount)
          // POO-888 R4: crossing the pause point enters the send region - uncancellable from here on.
          if (pausedIndexRef.current >= 0 && index > pausedIndexRef.current)
            record.pastPause = true;
          const flowStep = flowSteps[index];
          if (!flowStep) break;
          setActiveStep(index);
          setStatuses((prev) => withAt(prev, index, "active"));
          try {
            const result: Partial<Ctx> & { txHash?: string; skipped?: boolean } =
              (await flowStep.run(ctxRef.current)) ?? {};
            if (runIdRef.current !== runId) return;
            const { txHash: stepHash, skipped, ...partial } = result;
            ctxRef.current = { ...ctxRef.current, ...(partial as Partial<Ctx>) };
            setContext(ctxRef.current);
            setStatuses((prev) => withAt(prev, index, skipped ? "skipped" : "done"));
            if (stepHash) {
              setTxHashes((prev) => withAt(prev, index, stepHash));
              setTxHash(stepHash);
              // POO-764: grant a Duck Shoot try for this mined protocol tx (fire-and-forget, deduped).
              grantTryRef.current(stepHash);
            }
            // POO-887 R3: any completion of the pause-key (build) step refreshes the build's age -
            // including run-through re-runs where `pauseAfter` was not passed. POO-885 R2: a good
            // build also clears the consecutive background-failure streak (and the stale hint).
            if (
              optionsRef.current.pauseAfterKey &&
              flowStep.key === optionsRef.current.pauseAfterKey
            ) {
              builtAtRef.current = Date.now();
              setRebuildFailures(0);
            }
            // POO-574: pause the flow here (build → Review) and wait for resume(); later steps stay
            // idle. POO-888 R2: a Confirm queued during this (re)build consumes the pause instead -
            // the run continues into the send with the build it JUST produced (the fresh quote).
            if (pauseAfter && flowStep.key === pauseAfter) {
              pausedIndexRef.current = index;
              startRef.current = index + 1; // a plain retry()/resume() picks up the send step
              if (pendingResumeRef.current) {
                pendingResumeRef.current = false;
                continue;
              }
              setStatus("awaiting");
              return;
            }
          } catch (caught) {
            if (runIdRef.current !== runId) return;
            // POO-885 R1: a BACKGROUND re-quote failure never terminates the flow. Keep the last good
            // quote (context untouched - a failed step merges nothing), restore the build's "done",
            // return to the Review's `awaiting`, and count the failure ([R2]'s stale hint). The next
            // countdown window retries. A queued Confirm makes it a user-action failure instead [R3].
            if (background && !pendingResumeRef.current) {
              setStatuses((prev) => withAt(prev, index, "done"));
              setRebuildFailures((count) => count + 1);
              setStatus("awaiting");
              return;
            }
            pendingResumeRef.current = false;
            setStatuses((prev) => withAt(prev, index, "error"));
            setError(toTxError(caught, optionsRef.current.fallbackErrorCode));
            setStatus("error");
            startRef.current = index; // retry() resumes here
            return;
          }
        }
        if (runIdRef.current !== runId) return;
        pendingResumeRef.current = false;
        startRef.current = flowSteps.length;
        setStatus("success");
      })().finally(() => {
        // Only this run may clear its own registration (a cancelling successor already replaced it).
        if (currentRunRef.current === record) currentRunRef.current = null;
      });
      record.promise = promise;
      return promise;
    },
    [],
  );

  // POO-887: the pause-key step's index in the CURRENT steps array (-1 when no pause configured).
  const pauseIndexOf = useCallback(() => {
    const key = optionsRef.current.pauseAfterKey;
    return key ? stepsRef.current.findIndex((flowStep) => flowStep.key === key) : -1;
  }, []);
  // POO-887 R3 / POO-885 R2: is the last good build past its freshness window?
  const isBuiltStale = useCallback(
    () => builtAtRef.current != null && Date.now() - builtAtRef.current > MAX_BUILT_TX_AGE_MS,
    [],
  );
  // Reset the target and everything after it to idle + clear their hashes before re-running, so the
  // stepper reflects a fresh attempt from `target`; earlier steps keep their done/skipped status,
  // txHashes and accumulated context.
  const restartFrom = useCallback(
    (target: number, pauseAfter?: string) => {
      setStatuses((prev) => prev.map((value, index) => (index >= target ? "idle" : value)));
      setTxHashes((prev) => prev.map((value, index) => (index >= target ? undefined : value)));
      return runFrom(target, pauseAfter);
    },
    [runFrom],
  );

  const run = useCallback(() => {
    startRef.current = 0;
    pausedIndexRef.current = -1;
    pendingResumeRef.current = false;
    builtAtRef.current = null;
    setRebuildFailures(0);
    ctxRef.current = optionsRef.current.initialContext ?? ({} as Ctx);
    setContext(ctxRef.current);
    return runFrom(0, optionsRef.current.pauseAfterKey);
  }, [runFrom]);

  const retry = useCallback(() => {
    const pauseIndex = pauseIndexOf();
    // POO-887 R1: the failed step sits at or before the pause - the Review was never consumed this
    // run, so the retry re-honors the pause (never straight into the money-moving signature).
    if (pauseIndex >= 0 && startRef.current <= pauseIndex) {
      return runFrom(startRef.current, optionsRef.current.pauseAfterKey);
    }
    // POO-887 R3: a post-Review retry with a stale built tx rebuilds first (run-through - the user
    // already approved on the Review; POO-499 semantics), never signing past the sigDeadline.
    if (pauseIndex >= 0 && isBuiltStale()) return restartFrom(pauseIndex);
    return runFrom(startRef.current);
  }, [runFrom, pauseIndexOf, isBuiltStale, restartFrom]);

  // POO-574: continue past the `awaiting` pause into the send/sign steps (runs through, no re-pause).
  // POO-888 R2: during an in-flight (re)build the Confirm is QUEUED behind it (the fresh build gets
  // signed, never the stale one); R4: during an in-flight send it is a no-op (no double dispatch).
  // POO-885 R2 (hard ceiling): a build older than MAX_BUILT_TX_AGE_MS is never sent - the Confirm
  // forces a rebuild first, running through into the send.
  const resume = useCallback(() => {
    const inFlight = currentRunRef.current;
    if (inFlight) {
      if (!inFlight.pastPause) pendingResumeRef.current = true;
      return inFlight.promise;
    }
    if (isBuiltStale()) return restartFrom(pausedIndexRef.current);
    return runFrom(pausedIndexRef.current + 1);
  }, [runFrom, isBuiltStale, restartFrom]);
  // POO-574: re-run the paused (build) step to re-quote — reusing any earlier approve/permit context —
  // then pause again in `awaiting`. Drives the Review's 10s refresh. POO-888 R4: NEVER cancels an
  // in-flight run - a zero-crossing racing the Confirm's send (or another re-quote) is absorbed by
  // the run already in flight, whose outcome is always consumed.
  const rebuild = useCallback(() => {
    const inFlight = currentRunRef.current;
    if (inFlight) return inFlight.promise;
    // POO-885: countdown rebuilds are background - their failures are non-fatal (see runFrom).
    return runFrom(pausedIndexRef.current, optionsRef.current.pauseAfterKey, true);
  }, [runFrom]);

  const retryFrom = useCallback(
    (key: string) => {
      const flowSteps = stepsRef.current;
      const keyed = flowSteps.findIndex((flowStep) => flowStep.key === key);
      // POO-499 R2a: resume from the keyed step when it exists (and is at/before the failed step so
      // approve/permit are never re-run), else fall back to resume-from-failed-step. `startRef`
      // holds the failed index (set in runFrom's catch).
      const target = keyed >= 0 ? Math.min(keyed, startRef.current) : startRef.current;
      // POO-887 R1: like retry(), a pre-Review failure re-honors the pause; the post-Review
      // slippage auto-retry keeps its run-through semantics (POO-574 R4 / POO-499).
      const pauseIndex = pauseIndexOf();
      const pauseAfter =
        pauseIndex >= 0 && startRef.current <= pauseIndex
          ? optionsRef.current.pauseAfterKey
          : undefined;
      return restartFrom(target, pauseAfter);
    },
    [pauseIndexOf, restartFrom],
  );

  const reset = useCallback(() => {
    runIdRef.current++; // cancel any in-flight run
    currentRunRef.current = null;
    pendingResumeRef.current = false;
    builtAtRef.current = null;
    setRebuildFailures(0);
    startRef.current = 0;
    pausedIndexRef.current = -1;
    ctxRef.current = optionsRef.current.initialContext ?? ({} as Ctx);
    setContext(ctxRef.current);
    setActiveStep(0);
    setStatuses(stepsRef.current.map(() => "idle"));
    setTxHashes(stepsRef.current.map(() => undefined));
    setStatus("idle");
    setError(null);
    setTxHash(null);
  }, []);

  // POO-887 R2: derived for the host's retry phase choice - on an error whose failed step (kept in
  // `activeStep` by the catch) sits at or before the pause, the next retry re-honors the Review.
  const pauseIndex = options.pauseAfterKey
    ? steps.findIndex((flowStep) => flowStep.key === options.pauseAfterKey)
    : -1;
  const retryWillPause = status === "error" && pauseIndex >= 0 && activeStep <= pauseIndex;
  // POO-885 R2: the Review's subtle stale-quote hint threshold.
  const quoteStale = rebuildFailures >= STALE_QUOTE_FAILURES;

  return useMemo(
    () => ({
      activeStep,
      statuses,
      txHashes,
      status,
      error,
      txHash,
      context,
      retryWillPause,
      quoteStale,
      run,
      retry,
      retryFrom,
      resume,
      rebuild,
      reset,
    }),
    [
      activeStep,
      statuses,
      txHashes,
      status,
      error,
      txHash,
      context,
      retryWillPause,
      quoteStale,
      run,
      retry,
      retryFrom,
      resume,
      rebuild,
      reset,
    ],
  );
}

/** Return a copy of `arr` with `index` set to `value` (immutable per-step update). */
function withAt<T>(arr: T[], index: number, value: T): T[] {
  const next = arr.slice();
  next[index] = value;
  return next;
}
