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
import { useCallback, useEffect, useState } from "react";
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
  const setAcknowledged = useCallback(
    (value: boolean) => {
      setAcknowledgedState(value);
      setAckedAtPct(value && priceImpactPct != null ? priceImpactPct : null);
    },
    [priceImpactPct],
  );
  return {
    acknowledged,
    setAcknowledged,
    blocked: gated && (!acknowledged || worsened),
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
