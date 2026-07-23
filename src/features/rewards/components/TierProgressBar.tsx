/**
 * @id PP-REW-CMP-010
 * @name TierProgressBar
 * @implements-rules-version v2
 *
 * Rubber Rush loyalty-tier bar (POO-761): the track is split into one equal segment per tier. The
 * "You" marker (a duck head) sits WITHIN the active tier's segment at
 * `(activeIndex + progressPct/100) * segment` (progressPct is progress toward the NEXT tier, 0..100),
 * a gold→grape gradient fills only up to that position over a dark track, segment dividers separate
 * the tiers, and every tier label up to and including the active one is highlighted. Presentational;
 * the marker position and active index come from the rewards data. Ported from the reference
 * (pool-party-interface `dashboard/ui/tier-progress-bar.tsx`).
 */
import { cn } from "@/lib/utils/cn";

/** Public props for {@link TierProgressBar}. */
export interface TierProgressBarProps {
  /** Progress toward the NEXT tier, as a percentage (0–100) within the active tier. */
  progressPct: number;
  /** 0-based index of the active tier within {@link TierProgressBarProps.tiers}. */
  activeIndex: number;
  /** The tier labels, in order (lowest → highest). */
  tiers: readonly string[];
  /** Caption shown above the marker (e.g. "You"). */
  youLabel: string;
  /** Extra classes on the wrapper. */
  className?: string;
}

/** Clamp `value` into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The Rubber Rush tier-progression bar. */
export function TierProgressBar({
  progressPct,
  activeIndex,
  tiers,
  youLabel,
  className,
}: TierProgressBarProps) {
  // Each tier owns an equal slice of the track; the marker sits within the active tier's slice at its
  // within-tier progress. [R1] pos = (activeIndex + progressPct/100) * segment.
  const segment = 100 / tiers.length;
  const rawPos =
    (clamp(activeIndex, 0, tiers.length - 1) + clamp(progressPct, 0, 100) / 100) * segment;
  const fillWidth = `${clamp(rawPos, 0, 100)}%`;
  // [R6] Keep the duck fully on the track even at 0% (never clips off the left edge).
  const markerLeft = `${clamp(rawPos, 5, 100)}%`;

  return (
    <div className={cn("w-full", className)}>
      {/* Reserve room above the track for the duck's upper half + the "You" caption. */}
      <div className="relative pt-11">
        {/* Gradient track — the marker's positioning context. The duck sits ON this line, so the track
            is NOT clipped; the fill has its own overflow-hidden wrapper to keep its rounded ends. */}
        <div className="relative h-3 rounded-full bg-surface-raised">
          <div className="absolute inset-0 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-brand-grape transition-all duration-500"
              style={{ width: fillWidth }}
            />
          </div>
          <div className="absolute inset-0 flex">
            {tiers.map((label, index) => (
              <div
                key={label}
                className={cn(
                  "flex-1",
                  index < tiers.length - 1 && "border-background/70 border-r",
                )}
              />
            ))}
          </div>
          {/* "You" caption, centered above the duck. */}
          <span
            className="-translate-x-1/2 absolute bottom-8 z-10 font-semibold text-[10px] text-muted-foreground transition-all duration-500"
            style={{ left: markerLeft }}
          >
            {youLabel}
          </span>
          {/* Duck marker — its box is vertically centered ON the track line (the line runs through the
              middle of the head), horizontally at the marker position. Flipped to face the track. */}
          <img
            src="/brand/duck-head.png"
            alt=""
            aria-hidden="true"
            className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 z-10 -scale-x-100 size-9 object-contain transition-all duration-500"
            style={{ left: markerLeft }}
          />
        </div>
      </div>
      {/* Tier labels; every tier up to and including the active one is highlighted. */}
      <div className="mt-2 flex">
        {tiers.map((label, index) => (
          <span
            key={label}
            className={cn(
              "flex-1 text-center text-[10px] sm:text-xs",
              index <= activeIndex ? "font-semibold text-primary" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
