/**
 * @id PP-MGR-CMP-046
 * @name CanvasViewport
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, a presentational container; the Build screen (PP-MGR-SCR-002, S7) owns
 *   every event, and a background click is reported through `onBackgroundClick`
 *
 * The canvas of the fund builder's Build step (handoff v1.2 [AN5], [AN6], [AN7], [I8]): a clipped
 * box 640 high, the graph layer that pans and zooms, the zoom controls and the hint line.
 *
 * Children are drawn in GRAPH coordinates (the layout at 100%, slice S3) inside a layer of the
 * graph's size; one CSS transform maps them to the screen. The state lives in
 * {@link useCanvasViewport}; this component draws it and hands the screen a small imperative handle
 * (`fit`, `revealRect`) for the moments it must move the view itself (I9: after a change, the new or
 * selected block stays in view).
 *
 * Decisions worth stating:
 *
 * 1. **The border is an overlay.** A real border would make the graph layer start 1 px inside the
 *    box, so the drawn canvas and the measured one would disagree by a pixel on every side. Drawn on
 *    top with `pointer-events: none`, it also frames whatever the graph scrolls under it.
 * 2. **The hint lets presses through.** It sits over the graph's corner; a press on it reaches the
 *    graph below, so it never blocks a pan. It stops short of the zoom controls so a long locale
 *    wraps instead of running under them.
 * 3. **The readout speaks a sentence.** "87%" alone is a bare number to a screen reader; it reads
 *    "Zoom 87%", from its own key, and is not a live region: a wheel would announce every step.
 * 4. **The page never scrolls sideways because of the graph (A7).** The box clips, its width comes
 *    from the grid column (`minmax(0, 1fr)`), and the layer is absolutely positioned, so a 2080 wide
 *    graph never widens anything. Proven by the `WideGraphNoPageScroll` story, not in jsdom.
 */
"use client";

import { Minus, Plus, Scan } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, type Ref, useId, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { CANVAS_LAYER_ATTR, useCanvasViewport } from "./useCanvasViewport";
import type { Size, ViewRect } from "./viewportMath";

/** What the screen can ask of the canvas (handoff [I8], [I9]). */
export interface CanvasViewportHandle {
  /** Fit the whole graph (same as the fit control and a background double-click). */
  fit(): void;
  /** Pan the minimum to bring a graph rect into view with a 24 margin; never zooms. */
  revealRect(rect: ViewRect): void;
}

/** Public props for {@link CanvasViewport}. */
export interface CanvasViewportProps {
  /** The laid-out graph size, or null until it exists. The first size opens the canvas at fit. */
  graphSize: Size | null;
  /** A press on the background that did not pan (I5: clears the selection, in S5). */
  onBackgroundClick?: () => void;
  /** Receives {@link CanvasViewportHandle}. */
  viewportRef?: Ref<CanvasViewportHandle>;
  /** The graph, in graph coordinates. Interactive pieces carry `data-canvas-interactive`. */
  children?: ReactNode;
}

const layerAttr = { [CANVAS_LAYER_ATTR]: "" };

/** One 28 x 28 control of the zoom stack. */
function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** The Build canvas: clipped container, pan and zoom layer, zoom controls, hint line. */
export function CanvasViewport({
  graphSize,
  onBackgroundClick,
  viewportRef,
  children,
}: CanvasViewportProps) {
  const t = useTranslations("manager");
  const canvasRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const { view, readoutPct, zoomIn, zoomOut, fit, revealRect, panning, bind } = useCanvasViewport({
    graphSize,
    canvasRef,
    onBackgroundClick,
  });

  useImperativeHandle(viewportRef, () => ({ fit, revealRect }), [fit, revealRect]);

  return (
    <div
      ref={canvasRef}
      data-canvas-viewport=""
      aria-describedby={hintId}
      className={cn(
        "relative h-[640px] w-full touch-none select-none overflow-hidden rounded-xl bg-background",
        panning ? "cursor-grabbing" : "cursor-grab",
      )}
      {...bind}
    >
      <div
        {...layerAttr}
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: graphSize?.width,
          height: graphSize?.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {children}
      </div>

      <div
        data-canvas-border=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl border border-border"
      />

      <p
        id={hintId}
        className="pointer-events-none absolute right-[62px] bottom-3 left-3 text-muted-foreground text-xs"
      >
        {t("fundBuilder.canvas.hint")}
      </p>

      <div
        data-canvas-zoom-controls=""
        className="absolute right-3 bottom-3 flex w-[38px] cursor-default flex-col items-center gap-0.5 rounded-md border border-border bg-surface p-1"
      >
        <ZoomButton label={t("fundBuilder.canvas.zoom.in")} onClick={zoomIn}>
          <Plus className="size-3.5" aria-hidden="true" />
        </ZoomButton>
        {/* The stack's content is 28 wide and "150%" is about 30 at 11 px: the readout may use
            the stack's padding, so it never wraps and never clips. */}
        <span className="whitespace-nowrap font-medium text-[11px] text-muted-foreground leading-4 tabular-nums">
          <span aria-hidden="true">
            {t("fundBuilder.canvas.zoom.readout", { pct: readoutPct })}
          </span>
          <span className="sr-only">
            {t("fundBuilder.canvas.zoom.readoutLabel", { pct: readoutPct })}
          </span>
        </span>
        <ZoomButton label={t("fundBuilder.canvas.zoom.out")} onClick={zoomOut}>
          <Minus className="size-3.5" aria-hidden="true" />
        </ZoomButton>
        <ZoomButton label={t("fundBuilder.canvas.zoom.fit")} onClick={fit}>
          <Scan className="size-3.5" aria-hidden="true" />
        </ZoomButton>
      </div>
    </div>
  );
}
