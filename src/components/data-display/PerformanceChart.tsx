/**
 * @id PP-CORE-CMP-022
 * @name PerformanceChart
 * @implements-rules-version v2
 * A lightweight, dependency-free area chart rendered from a labelled value series (e.g. portfolio
 * value over time). Brand-gold line + gradient fill from design tokens. Hovering or touching the plot
 * reveals a guide line, a marker on the series, and a tooltip with that point's label (date/time) and
 * value. The SVG path renders on the server; the hover layer hydrates on the client.
 *
 * v2 (POO-557 R2): ChartPoint carries an OPTIONAL `date` (the point's raw ISO date) so callers can
 * window a series by real calendar time. The chart itself ignores it; existing callers unaffected.
 */
"use client";

import { type PointerEvent as ReactPointerEvent, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/** One plotted point. */
export interface ChartPoint {
  /** The numeric value (drives the y position). */
  value: number;
  /** Pre-formatted x-axis label shown in the tooltip — a localized date or time. */
  label: string;
  /** Pre-formatted value for the tooltip (e.g. `"$4,460.00"`). Falls back to the raw number. */
  display?: string;
  /**
   * The point's raw ISO date (e.g. `"2026-06-19T00:00:00.000Z"`), when the series is real. Lets
   * callers window by calendar time (POO-557 R2); absent on date-less mock series.
   */
  date?: string;
}

/** Public props for {@link PerformanceChart}. */
export interface PerformanceChartProps {
  /** The series to plot, oldest → newest. Needs at least two points. */
  data: ChartPoint[];
  /** Accessible description of the series. */
  ariaLabel?: string;
  /** Extra classes on the wrapper (set a height; the chart fills its box). */
  className?: string;
}

const WIDTH = 600;
const HEIGHT = 160;
const PAD = 4;

/** Keep the centered tooltip inside the box at the edges. */
function clampPercent(value: number): number {
  return Math.min(86, Math.max(14, value));
}

/** Renders the series as a gold area chart with an interactive hover tooltip. */
export function PerformanceChart({ data, ariaLabel, className }: PerformanceChartProps) {
  const gradientId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) {
    return null;
  }

  const values = data.map((point) => point.value);
  // Pad the value domain ~12% beyond the data so the line never sits flush against the top/bottom
  // edge. For a flat series (zero span, e.g. invested == currentValue) use a unit band so it renders
  // centered instead of glued to the bottom (POO-323: "out of scale / only a line at the bottom").
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin;
  const pad = span === 0 ? 1 : span * 0.12;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const range = max - min;
  const stepX = (WIDTH - PAD * 2) / (data.length - 1);

  // Geometry in the 0..WIDTH / 0..HEIGHT viewBox, plus the same as 0..100 percentages for the HTML
  // overlay — the svg uses preserveAspectRatio="none", so x/y map linearly to the rendered box.
  const pts = data.map((point, index) => {
    const x = PAD + index * stepX;
    const y = PAD + (1 - (point.value - min) / range) * (HEIGHT - PAD * 2);
    return { x, y, xPct: (x / WIDTH) * 100, yPct: (y / HEIGHT) * 100 };
  });

  const line = `M ${pts.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" L ")}`;
  const lastX = (PAD + (data.length - 1) * stepX).toFixed(2);
  const baseY = (HEIGHT - PAD).toFixed(2);
  const area = `${line} L ${lastX},${baseY} L ${PAD.toFixed(2)},${baseY} Z`;

  function handlePointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1))));
    setHover(index);
  }

  const activePoint = hover !== null ? pts[hover] : undefined;
  const activeData = hover !== null ? data[hover] : undefined;

  return (
    <div
      ref={wrapRef}
      className={cn("relative h-full w-full", className)}
      onPointerMove={handlePointer}
      onPointerDown={handlePointer}
      onPointerLeave={() => setHover(null)}
      onPointerCancel={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel ?? "Performance over time"}
        className="h-full w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-gold)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-brand-gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--color-brand-gold)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {activePoint && activeData ? (
        <div aria-hidden="true">
          {/* Vertical guide line */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
            style={{ left: `${activePoint.xPct}%` }}
          />
          {/* Marker on the series */}
          <div
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
            style={{
              left: `${activePoint.xPct}%`,
              top: `${activePoint.yPct}%`,
              backgroundColor: "var(--color-brand-gold)",
            }}
          />
          {/* Tooltip — floats along the top, clamped inside the box */}
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-center shadow-md"
            style={{ left: `${clampPercent(activePoint.xPct)}%` }}
          >
            <p className="font-medium text-[10px] text-muted-foreground leading-tight">
              {activeData.label}
            </p>
            <p className="font-semibold text-foreground text-xs leading-tight">
              {activeData.display ?? String(activeData.value)}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
