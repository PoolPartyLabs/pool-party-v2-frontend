/**
 * @id PP-STR-HOK-001
 * @name useSlippageAutoRetry
 * @implements-rules-version v2
 *
 * The single place the POO-467 slippage-retry orchestration lives (POO-499, rules v2), consumed by
 * all six transactional modals so the behavior is defined once, not copy-pasted six times. Given a
 * {@link WalletSignFlow}, it turns the flow's slippage-classified failures into:
 *   1. exactly ONE automatic retry per user-initiated run, resuming from the build step
 *      (`flow.retryFrom("build")`), while the modal shows a pending NOTICE instead of an error view (R2);
 *   2. on the SECOND slippage failure of the same run, a slippage-specific error view (the modal reads
 *      {@link SlippageAutoRetry.slippageError}) and the settings sheet opened automatically ONCE (R3).
 * Non-slippage / unknown failures pass through untouched (R1/R4): the modal's usual error view + manual
 * retry semantics are unchanged.
 *
 * Slippage classification comes only from `flow.error.kind === "slippage"` (POO-473 classifyTxError);
 * there is no local string-matching (R1). The modal contributes only its gear slippage value + a
 * settings opener; this hook owns the one-shot + auto-open bookkeeping.
 *
 * The `autoRetrying` / `slippageError` flags are DERIVED DURING RENDER (not set in an effect) so a
 * modal reading them inside its own `flow.status === "error"` effect sees the correct value on the
 * same render the error appears — the error-view flip is suppressed on the first slippage failure with
 * no ordering race. The side effects (retryFrom, analytics, auto-open) run in this hook's effect.
 *
 * @analytics-events tx_slippage_retry
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import type { WalletSignFlow } from "./useWalletSignFlow";

/** Options for {@link useSlippageAutoRetry}. */
export interface UseSlippageAutoRetryOptions<Ctx = Record<string, unknown>> {
  /** The wallet-sign flow whose slippage failures drive the orchestration. */
  flow: WalletSignFlow<Ctx>;
  /** The operation name for the analytics event (e.g. "invest", "withdraw", "collect"). */
  flowName: string;
  /** The strategy id for the analytics event. */
  strategyId: string;
  /** The current gear slippage tolerance, in percent (interpolated into the notice + error copy). */
  slippagePct: number;
  /** Opens the TransactionSettingsDialog (called once on the second slippage failure, R3). */
  onOpenSettings: () => void;
}

/** What the modal reads from {@link useSlippageAutoRetry}. */
export interface SlippageAutoRetry {
  /**
   * True between the first slippage failure and its resolution: the modal must SUPPRESS its error
   * view (keep the pending phase) and render {@link notice}. Derived during render (R2).
   */
  autoRetrying: boolean;
  /**
   * True on the second slippage failure of the same run: the modal shows the slippage-specific error
   * view (own title/body). Derived during render (R3).
   */
  slippageError: boolean;
  /**
   * The current gear slippage, echoed so the modal can interpolate it into the pending retry notice
   * (`flow.slippage.retryNotice`) and the slippage error copy (`errorTitle`/`errorBody`) via `t()` —
   * i18n stays in the modal (which owns the `strategies` namespace), not this namespace-less hook.
   */
  slippagePct: number;
}

/** Drives the one-automatic-retry + slippage error view + settings auto-open across the tx modals. */
export function useSlippageAutoRetry<Ctx = Record<string, unknown>>({
  flow,
  flowName,
  strategyId,
  slippagePct,
  onOpenSettings,
}: UseSlippageAutoRetryOptions<Ctx>): SlippageAutoRetry {
  const { track } = useAnalytics();
  // The one-shot: has this run already consumed its automatic retry?
  const retriedRef = useRef(false);
  // Has the settings sheet already been auto-opened for this run's slippage error?
  const autoOpenedRef = useRef(false);
  // Previous flow status, to detect a fresh user-initiated run (re-arms the one-shot).
  const prevStatusRef = useRef(flow.status);
  // Keep the latest opener out of the effect deps so a parent re-render can't retrigger it.
  const onOpenSettingsRef = useRef(onOpenSettings);
  onOpenSettingsRef.current = onOpenSettings;
  // Persistent flag: the notice stays up from the first slippage error THROUGH the whole re-run (build
  // then confirm), not just the single error frame, so the pending view keeps showing it (R2).
  const [retryInFlight, setRetryInFlight] = useState(false);

  const isSlippageFailure = flow.status === "error" && flow.error?.kind === "slippage";
  // R2: the FIRST slippage failure of the run (retry not yet consumed). Derived during render so the
  // modal's own error effect sees the suppression on the exact frame the error appears.
  const isFirstSlippageFailure = isSlippageFailure && !retriedRef.current;
  // R3: the SECOND slippage failure (retry already consumed) → slippage error view + auto-open.
  const isSecondSlippageFailure = isSlippageFailure && retriedRef.current;

  useEffect(() => {
    // Re-arm the one-shot on a genuinely fresh run: a new run() moves the flow from a terminal/idle
    // state into "running" (the dialog resets to idle on close/reopen, or lands on success). The
    // automatic retry and the manual "Try again" both move error → running, so they never re-arm.
    if (
      flow.status === "running" &&
      (prevStatusRef.current === "idle" || prevStatusRef.current === "success")
    ) {
      retriedRef.current = false;
      autoOpenedRef.current = false;
      setRetryInFlight(false);
    }
    prevStatusRef.current = flow.status;

    if (isFirstSlippageFailure) {
      // Consume the one-shot synchronously so a re-render before the retry lands can't double-fire.
      retriedRef.current = true;
      setRetryInFlight(true);
      // R8: one analytics event per AUTOMATIC retry (flow + strategy id only, never error text/code).
      track("tx_slippage_retry", { flow: flowName, strategy_id: strategyId });
      // R2/R2a: re-run from the build step so the backend re-quotes at the current price.
      void flow.retryFrom("build");
      return;
    }
    if (isSecondSlippageFailure) {
      // The retry resolved to a second slippage failure: drop the notice, show the error view.
      setRetryInFlight(false);
      if (!autoOpenedRef.current) {
        // R3: open the settings sheet exactly once; closing it must not re-open it.
        autoOpenedRef.current = true;
        onOpenSettingsRef.current();
      }
      return;
    }
    // The retry resolved to success (or any non-slippage terminal): the notice is done.
    if (flow.status === "success" || flow.status === "error") {
      setRetryInFlight(false);
    }
  }, [
    flow,
    flow.status,
    isFirstSlippageFailure,
    isSecondSlippageFailure,
    track,
    flowName,
    strategyId,
  ]);

  return {
    // The notice shows on the first-error frame (render-derived) AND throughout the re-run (state).
    autoRetrying: isFirstSlippageFailure || retryInFlight,
    slippageError: isSecondSlippageFailure,
    slippagePct,
  };
}
