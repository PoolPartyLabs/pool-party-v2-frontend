/**
 * @id PP-CORE-CMP-005
 * @name MetricTile
 * @implements-rules-version v2
 * A compact KPI tile: a muted label + a prominent value, with an optional toned delta line.
 * Two-part by design (label + value); the optional delta is the only extra context (design P3).
 *
 * v2 (POO-843 R4): the tile is `min-w-0` so it always shrinks to its grid/flex track instead of
 * forcing the row wider, and the value renders `tabular-nums`. The half-width-tile overflow of a
 * 7-figure USD value is fixed at the source by having callers format large money compact
 * (`formatUsdTile`), so the figure fits without truncating (number-formatting skill §3).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Delta emphasis → text color token. */
const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Public props for {@link MetricTile}. */
export interface MetricTileProps {
  /** Small uppercase-ish caption above the value. */
  label: ReactNode;
  /** The prominent figure. */
  value: ReactNode;
  /** Color for `value`. Defaults to `neutral` (the prominent foreground color). */
  valueTone?: "positive" | "negative" | "neutral";
  /** Optional secondary line (e.g. a change). */
  delta?: ReactNode;
  /** Color for `delta`. Defaults to `neutral`. */
  deltaTone?: "positive" | "negative" | "neutral";
  /** Extra classes on the tile. */
  className?: string;
}

/** A single labelled metric. */
export function MetricTile({
  label,
  value,
  valueTone = "neutral",
  delta,
  deltaTone = "neutral",
  className,
}: MetricTileProps) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-surface p-4", className)}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          "mt-1 font-semibold text-xl tabular-nums",
          valueTone === "neutral" ? "text-foreground" : TONE[valueTone],
        )}
      >
        {value}
      </p>
      {delta ? <p className={cn("mt-0.5 text-xs", TONE[deltaTone])}>{delta}</p> : null}
    </div>
  );
}
