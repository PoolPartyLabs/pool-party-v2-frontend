/**
 * @id PP-MGR-CMP-064
 * @name AllocationSlider
 * @implements-rules-version v1 (POO-2187 rules v1); POO-2237 rules v1
 * @analytics-events none emitted here. `onReachCeiling` tells the caller a gesture of the manager
 *   brought the share to its ceiling, and the Build screen (PP-MGR-SCR-002) reports it as
 *   `builder_block_limit_hit` with the ceiling's reason.
 *
 * The Allocation field of a block (handoff P8, P9): a share of the strategy's capital, 0 to 100 in
 * steps of 5, with its label row (the value at the right end, Numeric/Body).
 *
 * - [P9] Track 326 x 4, `surface-raised`; 19 ticks (1 x 4, `border`), one every 5%; the filled part
 *   in `primary`; a 14 px `foreground` knob centred on the end of the filled part. Keyboard: the
 *   arrows move one step, Home and End jump to 0 and to the ceiling.
 * - [P8] It stops at its CEILING (`allocationCeiling`, PP-MGR-LIB-027), which the caller passes as a
 *   whole percent. A ceiling that is not a multiple of 5 is a valid stop: the stops are the
 *   multiples of 5 under it, plus the ceiling itself. Under 100 the ceiling is drawn: a 2 x 10 tick
 *   (`muted-foreground`) on the track, and the track and the step ticks beyond it dimmed to 50% (the
 *   frames dim one or the other; the handoff says dim both).
 * - At the ceiling (and only under 100) the reason sentence shows under the slider (Caption,
 *   muted); a mandate cap's sentence carries the link row "Need more?" + "Edit mandate · Limits",
 *   the strategy's room has no link. The words are the caller's.
 * - [P4] The value never passes the ceiling: a press beyond it lands on it.
 *
 * Props only: the value is the caller's draft, the strings arrive translated.
 */
"use client";

import { type KeyboardEvent, type PointerEvent, useId, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { PanelFieldLabel } from "./PanelFieldLabel";
import { NUMERIC_BODY, PANEL_FOCUS_RING, PANEL_LINK } from "./panelStyles";

/** One step of the slider, in percent (P8). */
export const ALLOCATION_STEP = 5;

/** The 19 step ticks: 5% to 95% (P9). */
const TICKS = Array.from({ length: 19 }, (_, index) => (index + 1) * ALLOCATION_STEP);

/** The next stop above `value`: the next multiple of 5, never past the ceiling. */
export function stepUp(value: number, ceiling: number): number {
  if (value >= ceiling) return ceiling;
  return Math.min(ceiling, (Math.floor(value / ALLOCATION_STEP) + 1) * ALLOCATION_STEP);
}

/** The next stop below `value`: the multiple of 5 under it, never under 0. */
export function stepDown(value: number, ceiling: number): number {
  if (value > ceiling) return ceiling;
  if (value % ALLOCATION_STEP !== 0) return Math.floor(value / ALLOCATION_STEP) * ALLOCATION_STEP;
  return Math.max(0, value - ALLOCATION_STEP);
}

/** The stop nearest to a position on the track, in percent: a multiple of 5, or the ceiling. */
export function stopAt(pct: number, ceiling: number): number {
  const snapped = Math.round(Math.min(100, Math.max(0, pct)) / ALLOCATION_STEP) * ALLOCATION_STEP;
  return Math.min(ceiling, snapped);
}

/** Public props for {@link AllocationSlider}. */
export interface AllocationSliderProps {
  /** The share the draft holds, a whole percent. */
  value: number;
  /** The highest stop, a whole percent from 0 to 100 (P8). */
  ceiling: number;
  /** Minimum allocation retained by existing child blocks (POO-2237). */
  minimum?: number;
  onChange(value: number): void;
  /** A gesture brought the value to the ceiling from below it (and the ceiling is under 100). */
  onReachCeiling?(): void;
  copy: {
    /** "Allocation". */
    label: string;
    /** The (i) tooltip. */
    help: string;
    /** "More about Allocation". */
    helpLabel: string;
  };
  /** The reason the ceiling stops the slider, shown at the ceiling; null for none. */
  ceilingSentence: string | null;
  /** The link row under a mandate cap's sentence; null under the strategy's room. */
  ceilingLink: { prompt: string; label: string; onClick(): void } | null;
}

/** The Allocation field: label row, slider, and the sentence at the ceiling (P8, P9). */
export function AllocationSlider({
  value,
  ceiling,
  minimum = 0,
  onChange,
  onReachCeiling,
  copy,
  ceilingSentence,
  ceilingLink,
}: AllocationSliderProps) {
  const labelId = useId();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const shown = Math.min(value, 100);
  const limited = ceiling < 100;
  const atCeiling = limited && value >= ceiling;

  // Review L4 of PR #54: the value as last moved, so two pointer moves before a render cannot both
  // read "below the ceiling" and report reaching it twice.
  const current = useRef(value);
  current.current = value;

  const move = (next: number) => {
    next = Math.max(minimum, Math.min(ceiling, next));
    const before = current.current;
    if (next === before) return;
    current.current = next;
    onChange(next);
    if (limited && next === ceiling && before < ceiling) onReachCeiling?.();
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    move(stopAt(((event.clientX - box.left) / box.width) * 100, ceiling));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => number> = {
      ArrowRight: () => stepUp(value, ceiling),
      ArrowUp: () => stepUp(value, ceiling),
      ArrowLeft: () => stepDown(value, ceiling),
      ArrowDown: () => stepDown(value, ceiling),
      Home: () => minimum,
      End: () => ceiling,
    };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    move(next());
  };

  return (
    <div data-allocation-slider="" className="flex flex-col gap-2">
      <PanelFieldLabel
        label={copy.label}
        help={copy.help}
        helpLabel={copy.helpLabel}
        labelId={labelId}
        value={<span className={NUMERIC_BODY}>{`${value}%`}</span>}
      />
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuemin={minimum}
        aria-valuemax={ceiling}
        aria-valuenow={value}
        aria-valuetext={`${value}%`}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          // L4: only the main button moves the knob; a right click opens the context menu.
          if (event.button !== 0) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) fromPointer(event);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        className={cn(
          "relative h-3.5 w-full cursor-pointer touch-none rounded-sm",
          PANEL_FOCUS_RING,
        )}
      >
        {/* The track: full opacity up to the ceiling, dimmed beyond it. */}
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-surface-raised"
          style={{ width: `${limited ? ceiling : 100}%` }}
        />
        {limited ? (
          <span
            aria-hidden="true"
            data-allocation-dimmed=""
            className="absolute top-1/2 right-0 h-1 -translate-y-1/2 rounded-full bg-surface-raised opacity-50"
            style={{ width: `${100 - ceiling}%` }}
          />
        ) : null}
        {TICKS.map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            data-allocation-tick={tick}
            className={cn(
              "absolute top-1/2 h-1 w-px -translate-y-1/2 bg-border",
              limited && tick > ceiling ? "opacity-50" : null,
            )}
            style={{ left: `${tick}%` }}
          />
        ))}
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-primary"
          style={{ width: `${shown}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${shown}%` }}
        />
        {/* The ceiling's tick sits above the knob, so it still shows when the knob is on it. */}
        {limited ? (
          <span
            aria-hidden="true"
            data-allocation-ceiling={ceiling}
            className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-muted-foreground"
            style={{ left: `${ceiling}%` }}
          />
        ) : null}
      </div>
      {atCeiling && ceilingSentence ? (
        <div data-allocation-ceiling-sentence="" className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs">{ceilingSentence}</p>
          {ceilingLink ? (
            <p className="flex flex-wrap items-baseline gap-1.5 text-sm">
              <span className="text-muted-foreground">{ceilingLink.prompt}</span>
              <button type="button" onClick={ceilingLink.onClick} className={PANEL_LINK}>
                {ceilingLink.label}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
