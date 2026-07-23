/**
 * @id PP-REW-CMP-011
 * @name StreakBoost
 * @implements-rules-version v1
 *
 * Rubber Rush daily-streak card: a flame-headed card showing the current streak as a row of day
 * segments (D1…D7), filled up to the current streak, plus an explainer. Presentational.
 */
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link StreakBoost}. */
export interface StreakBoostProps {
  /** Card title. */
  title: string;
  /** Explainer text under the segments. */
  body: string;
  /** Progress label shown top-right (e.g. "0 / 7 days"). */
  progressLabel: string;
  /** One label per day segment, in order (e.g. ["D1", … "D7"]). */
  dayLabels: readonly string[];
  /** How many leading segments are filled (the current streak). */
  filledCount: number;
  /** Extra classes on the card. */
  className?: string;
}

/** The Rubber Rush daily-streak boost card. */
export function StreakBoost({
  title,
  body,
  progressLabel,
  dayLabels,
  filledCount,
  className,
}: StreakBoostProps) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flame className="size-4 text-primary" aria-hidden="true" />
          <h3 className="font-semibold text-foreground">{title}</h3>
        </div>
        <span className="font-semibold text-primary text-sm">{progressLabel}</span>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5 sm:gap-2">
        {dayLabels.map((label, index) => (
          <div
            key={label}
            className={cn(
              "flex h-9 items-center justify-center rounded-md border text-xs",
              index < filledCount
                ? "border-primary bg-primary/15 font-semibold text-primary"
                : "border-border bg-surface-raised text-muted-foreground",
            )}
          >
            {label}
          </div>
        ))}
      </div>
      <p className="mt-3 text-muted-foreground text-sm">{body}</p>
    </div>
  );
}
