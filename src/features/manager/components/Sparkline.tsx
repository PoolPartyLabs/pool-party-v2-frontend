/**
 * @id PP-MGR-CMP-014
 * @name Sparkline
 * @implements-rules-version v1
 *
 * Tiny decorative trend line for the Manage-strategies cards: a normalized SVG polyline tinted by
 * the series direction (up = success, down = destructive, flat = muted). Purely visual
 * (aria-hidden); the card's KPIs carry the real numbers.
 */
import { cn } from "@/lib/utils/cn";

const WIDTH = 96;
const HEIGHT = 28;
const PAD = 2;

/** Public props for {@link Sparkline}. */
export interface SparklineProps {
  /** The series, oldest → newest (at least two points). */
  data: number[];
  /** Extra classes on the svg (sets the box; the drawing scales to it). */
  className?: string;
}

/** A tiny trend sparkline. */
export function Sparkline({ data, className }: SparklineProps) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min;
  const step = (WIDTH - PAD * 2) / (data.length - 1);
  const points = data
    .map((value, index) => {
      // Flat series draw on the midline instead of dividing by zero.
      const normalized = span === 0 ? 0.5 : (value - min) / span;
      const x = PAD + index * step;
      const y = HEIGHT - PAD - normalized * (HEIGHT - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const first = data[0] ?? 0;
  const last = data[data.length - 1] ?? 0;
  const tone =
    last > first ? "text-success" : last < first ? "text-destructive" : "text-muted-foreground";
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-7 w-24", tone, className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
