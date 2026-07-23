/**
 * @id PP-PORT (POO-159)
 * @name PositionLink
 * @implements-rules-version v1
 *
 * Client wrapper around the locale-aware Link for an owned position. Navigates to the position's
 * strategy detail and emits `position_detail_viewed` (position + strategy id) on click. Keeps
 * PositionCard and the positions table as Server Components — only this leaf is client. Tracking
 * goes through `useAnalytics()`; never gtag/dataLayer directly.
 */
"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";

/** Props for {@link PositionLink}. */
export interface PositionLinkProps {
  /** The investor's position id (carried on the analytics event). */
  positionId: string;
  /** The strategy the position belongs to; also the navigation target. */
  strategyId: string;
  /** Classes forwarded to the underlying link. */
  className?: string;
  /** Accessible name — for a label-only stretched overlay link with no visible children. */
  ariaLabel?: string;
  /** Link contents (server-rendered card / cell). Optional for a label-only stretched link. */
  children?: ReactNode;
  /**
   * Origin surface, appended as `?from=<from>` so the strategy detail's Back returns here instead of
   * the default Explore (POO-554). Portfolio passes `"portfolio"`; omitted elsewhere → Back = Strategies.
   */
  from?: string;
}

/** A position link that records `position_detail_viewed` before navigating to the strategy detail. */
export function PositionLink({
  positionId,
  strategyId,
  className,
  ariaLabel,
  children,
  from,
}: PositionLinkProps) {
  const { track } = useAnalytics();
  return (
    <Link
      href={from ? `/strategies/${strategyId}?from=${from}` : `/strategies/${strategyId}`}
      className={className}
      aria-label={ariaLabel}
      onClick={() =>
        track("position_detail_viewed", { position_id: positionId, strategy_id: strategyId })
      }
    >
      {children}
    </Link>
  );
}
