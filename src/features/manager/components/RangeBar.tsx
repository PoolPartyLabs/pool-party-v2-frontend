/**
 * @id PP-MGR-CMP-024
 * @name RangeBar
 * @implements-rules-version v1
 *
 * A price track showing how a chosen [min, max] band sits relative to the current price — so the
 * manager can see at a glance how far (and which side) the range is. The domain pads around
 * whichever of min/max/current (and the optional prev range) spans widest; the active band is
 * highlighted (green in range, amber out) and the current price is a needle.
 *
 * Optionally renders a dimmer `prev` band behind the active one (e.g. the position's existing range
 * on the Move Range modal, so the manager sees where they're moving FROM vs TO). Extracted from the
 * Builder's Build step so both surfaces share one visual.
 */
"use client";

import { cn } from "@/lib/utils/cn";

/** Public props for {@link RangeBar}. */
export interface RangeBarProps {
  /** Lower bound of the active range. */
  min: number;
  /** Upper bound of the active range. */
  max: number;
  /** Current pool price (rendered as a needle). */
  current: number;
  /** Whether the current price sits inside the active range (drives the colour). */
  inRange: boolean;
  /** Optional previous range lower bound — rendered as a dimmer band behind the active one. */
  prevMin?: number;
  /** Optional previous range upper bound. */
  prevMax?: number;
  /** Extra classes merged after the defaults. */
  className?: string;
}

/** Price-range visual: a track with the active band, an optional prev band, and a price needle. */
export function RangeBar({
  min,
  max,
  current,
  inRange,
  prevMin,
  prevMax,
  className,
}: RangeBarProps) {
  const lows = [min, current, ...(prevMin != null ? [prevMin] : [])];
  const highs = [max, current, ...(prevMax != null ? [prevMax] : [])];
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  const pad = hi > lo ? (hi - lo) * 0.15 : Math.max(hi * 0.05, 1);
  const domainLo = lo - pad;
  const domain = hi + pad - domainLo || 1;
  const pos = (x: number) => Math.min(100, Math.max(0, ((x - domainLo) / domain) * 100));
  const left = pos(min);
  const right = pos(max);
  return (
    <div
      data-testid="range-bar"
      className={cn("relative h-2 w-full rounded-full bg-surface-raised", className)}
      aria-hidden="true"
    >
      {prevMin != null && prevMax != null ? (
        <div
          className="absolute inset-y-0 rounded-full bg-muted-foreground/20"
          style={{ left: `${pos(prevMin)}%`, right: `${100 - pos(prevMax)}%` }}
        />
      ) : null}
      <div
        className={cn(
          "absolute inset-y-0 rounded-full",
          inRange ? "bg-success/30" : "bg-warning/30",
        )}
        style={{ left: `${left}%`, right: `${100 - right}%` }}
      />
      <div
        className={cn(
          "absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full",
          inRange ? "bg-success" : "bg-warning",
        )}
        style={{ left: `${pos(current)}%` }}
      />
    </div>
  );
}
