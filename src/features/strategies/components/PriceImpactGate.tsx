/**
 * @id PP-STR-CMP-022
 * @name PriceImpactGate
 * @implements-rules-version v2
 *
 * POO-1011: the catastrophic price-impact gate for swap-bearing Reviews. Complements the backend
 * fail-close guard (POO-1010): when the built quote's `swapInfo.priceImpactPercentage` reaches
 * {@link CATASTROPHIC_PRICE_IMPACT_PCT}, the Review shows a destructive, always-visible alert
 * stating the estimated loss (never inside the collapsible details, where the incident's 92.41%
 * was hidden) and the operation's primary CTA stays disabled until the user checks an explicit
 * @analytics-events tx_impact_gate_blocked, tx_impact_gate_acknowledged
 *
 * "I understand I may lose about X%" acknowledgment.
 *
 * `usePriceImpactGate` owns the acknowledgment lifecycle [R5/R5v2]: the check survives the
 * Review's 5s re-quote while the impact stays gated AND has not worsened by more than
 * ACK_WORSEN_RESET_PP beyond the acknowledged figure; it resets when the impact drops below the
 * threshold, worsens past that margin, or the Review is left (`active` false). Missing/malformed `swapInfo` means NO gate [R4]: the figure
 * is display-only and tolerant (POO-610 R1), and absence of a display figure must never block a
 * valid operation.
 *
 * The 2% amber detail row (`HIGH_PRICE_IMPACT_PCT`, PP-STR-CMP-018) is unchanged; this gate is the
 * second, blocking threshold on top of it.
 */
"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyticsFlow } from "@/lib/analytics/events";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { formatPercent } from "@/lib/utils/format";

/**
 * [R1] At or above this price impact (percent) the Review is gated behind the explicit
 * acknowledgment. The 2% `HIGH_PRICE_IMPACT_PCT` amber row stays warning-only.
 */
export const CATASTROPHIC_PRICE_IMPACT_PCT = 10;

/**
 * [R5v2] A re-quote that worsens the impact by more than this many percentage points beyond the
 * figure the user acknowledged invalidates the consent (the ack copy names a specific percent;
 * consenting to "about 10%" is not consenting to 92%). Improving re-quotes keep the check.
 */
export const ACK_WORSEN_RESET_PP = 1;

/** [R1/R4] Whether a built quote's price impact requires the blocking acknowledgment. */
export function isCatastrophicPriceImpact(
  priceImpactPct: number | undefined,
): priceImpactPct is number {
  return priceImpactPct != null && priceImpactPct >= CATASTROPHIC_PRICE_IMPACT_PCT;
}

/** What {@link usePriceImpactGate} hands the hosting modal. */
/**
 * Context the gate's two events carry (POO-1172). Optional so a host that has not been wired yet
 * still emits, rather than the gate going silent while five lanes land at different times: an event
 * with no `flow` is a cut you cannot slice, while a missing event is a number nobody can compute.
 */
export interface PriceImpactGateAnalytics {
  /** Which transaction flow the gate engaged in. */
  flow?: AnalyticsFlow;
  /** The strategy under the operation, where the host knows it. */
  strategyId?: string;
}

export interface PriceImpactGateState {
  /** The user has checked the acknowledgment. */
  acknowledged: boolean;
  /** Setter wired to the gate's checkbox. */
  setAcknowledged: (value: boolean) => void;
  /** Disable the Review's primary CTA while true (gated and not validly acknowledged). */
  blocked: boolean;
}

/**
 * Acknowledgment lifecycle for the gate [R5/R5v2]. `active` is "the Review step is showing" (e.g.
 * `phase === "review"`); leaving it, or the impact re-quoting below the threshold, clears the
 * consent so a later gate always starts unchecked. A re-quote that WORSENS the impact by more than
 * {@link ACK_WORSEN_RESET_PP} beyond the acknowledged figure also clears it (`blocked` accounts for
 * the worsening in the same render, so no frame exists where a stale consent enables the CTA).
 */
export function usePriceImpactGate(
  priceImpactPct: number | undefined,
  active: boolean,
  analytics?: PriceImpactGateAnalytics,
): PriceImpactGateState {
  const [acknowledged, setAcknowledgedState] = useState(false);
  const [ackedAtPct, setAckedAtPct] = useState<number | null>(null);
  const gated = isCatastrophicPriceImpact(priceImpactPct);
  const worsened =
    gated &&
    acknowledged &&
    ackedAtPct != null &&
    priceImpactPct > ackedAtPct + ACK_WORSEN_RESET_PP;
  useEffect(() => {
    if (!gated || !active || worsened) {
      setAcknowledgedState(false);
      setAckedAtPct(null);
    }
  }, [gated, active, worsened]);

  // POO-1172: the gate's own instrumentation. Read through a ref so the emitters are stable and the
  // effect below does not re-fire on every re-quote render.
  const { track } = useAnalytics();
  const analyticsRef = useRef(analytics);
  analyticsRef.current = analytics;
  const blocked = gated && (!acknowledged || worsened);
  /**
   * POO-1172 [P0]: `tx_impact_gate_blocked` fires from DERIVED STATE, not from a click, because the
   * CTA is hard-disabled while blocked and there is therefore no click to intercept. Once per
   * engagement: `firedAtPct` holds the impact the gate last reported, and a re-quote only counts as
   * a NEW engagement once the gate has actually released in between.
   *
   * Without it, POO-1010 (a 92.41% price impact hidden inside a collapsible) is invisible: nothing
   * in the union records that routing handed a user a quote that would destroy their funds.
   */
  const firedAtPct = useRef<number | null>(null);
  useEffect(() => {
    if (!blocked || !active) {
      if (!blocked) firedAtPct.current = null;
      return;
    }
    if (firedAtPct.current !== null) return;
    firedAtPct.current = priceImpactPct ?? null;
    const ctx = analyticsRef.current;
    track("tx_impact_gate_blocked", {
      ...(ctx?.flow ? { flow: ctx.flow } : {}),
      ...(ctx?.strategyId ? { strategy_id: ctx.strategyId } : {}),
      ...(priceImpactPct == null ? {} : { metric_value: priceImpactPct }),
      metric_name: "price_impact_pct",
    });
  }, [blocked, active, priceImpactPct, track]);

  const setAcknowledged = useCallback(
    (value: boolean) => {
      setAcknowledgedState(value);
      setAckedAtPct(value && priceImpactPct != null ? priceImpactPct : null);
      /**
       * POO-1172 [P0]: the explicit funds-at-risk override, and only the override. Unchecking is not
       * an event: the ratio that matters is acknowledged/blocked, and counting a toggle-off would
       * let one hesitant user inflate the denominator's twin.
       *
       * A HIGH override rate means the gate is a speed bump rather than a stop, and the real fix is
       * upstream routing. That reading is the entire reason both events exist as a pair.
       */
      if (!value) return;
      const ctx = analyticsRef.current;
      track("tx_impact_gate_acknowledged", {
        ...(ctx?.flow ? { flow: ctx.flow } : {}),
        ...(ctx?.strategyId ? { strategy_id: ctx.strategyId } : {}),
        ...(priceImpactPct == null ? {} : { metric_value: priceImpactPct }),
        metric_name: "price_impact_pct",
      });
    },
    [priceImpactPct, track],
  );
  return {
    acknowledged,
    setAcknowledged,
    blocked,
  };
}

/** Public props for {@link PriceImpactGate}. */
export interface PriceImpactGateProps {
  /** The built quote's price impact in percent (`swapInfo.priceImpactPercentage`). */
  priceImpactPct: number | undefined;
  /** Current acknowledgment state (from {@link usePriceImpactGate}). */
  acknowledged: boolean;
  /** Checkbox change handler (from {@link usePriceImpactGate}). */
  onAcknowledgedChange: (value: boolean) => void;
}

/**
 * The destructive funds-at-risk alert + explicit acknowledgment checkbox [R2]. Renders nothing
 * below the threshold [R1] or without a figure [R4]. The hosting modal disables its primary CTA
 * with {@link PriceImpactGateState.blocked}.
 */
export function PriceImpactGate({
  priceImpactPct,
  acknowledged,
  onAcknowledgedChange,
}: PriceImpactGateProps) {
  const t = useTranslations("strategies");
  if (!isCatastrophicPriceImpact(priceImpactPct)) return null;
  const pct = formatPercent(priceImpactPct, 2);
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3"
    >
      <p className="font-semibold text-destructive text-sm">{t("flow.priceImpactGate.title")}</p>
      <p className="text-muted-foreground text-xs">{t("flow.priceImpactGate.body", { pct })}</p>
      <label className="flex cursor-pointer items-start gap-2 text-foreground text-xs">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-destructive"
        />
        <span>{t("flow.priceImpactGate.ack", { pct })}</span>
      </label>
    </div>
  );
}
