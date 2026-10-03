/**
 * @id PP-MGR-HOK-008
 * @name useCanvasViewport
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, a viewport hook; the Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * Pan, zoom and fit for the Build canvas (handoff v1.2 [I8], [I5] part, [I9] part). The geometry is
 * in {@link viewportMath}; this hook owns the state and decides when it moves.
 *
 * ## Why the wheel is a native listener
 *
 * React attaches `onWheel` as a PASSIVE listener, and a passive listener cannot `preventDefault`.
 * Ctrl + wheel (and a trackpad pinch, which the browser reports as Ctrl + wheel) would then zoom the
 * whole PAGE while the canvas zoomed too, and a plain wheel would scroll the page under the graph.
 * So the hook attaches the wheel itself, on the element behind `canvasRef`, with
 * `{ passive: false }`, and `bind` carries only the pointer and double-click handlers.
 *
 * ## What "background" means
 *
 * Pan, the background click and double-click fit act only on the background: the canvas container,
 * the graph layer (`data-canvas-layer`), or any descendant of the layer with no ancestor, up to the
 * layer, carrying `data-canvas-interactive`. Group boxes and the SVG of lines are background; cards,
 * pills, templates, ports, share labels and network chips carry the attribute (slices S4 and S6),
 * so a press on one of them never pans. The zoom controls and the hint sit outside the layer, so
 * they are not background either.
 *
 * ## Why the click is decided on pointer up
 *
 * A press that moves more than 4 px is a pan and must never also clear the selection. Deciding the
 * click on pointer up, from the same press that may have panned, makes the two exclusive by
 * construction; a separate `onClick` would fire after a pan as well.
 *
 * ## No animation in this batch
 *
 * Zoom, fit and reveal are instant (D8), so reduced motion needs no special case here.
 *
 * PP-NOTE: biome's `noFocusedTests` reads any call named `fit` (Jasmine's focused test) as a test
 * left focused, `handle.fit()` included. Call it through an alias (`const { fit: fitView } = ...`).
 */
"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyWheel,
  computeFit,
  ensureVisible,
  exceedsPanThreshold,
  formatZoom,
  type Size,
  stepZoom,
  type ViewRect,
  type ViewTransform,
} from "./viewportMath";

/** Marks an element a press must never pan through (cards, pills, templates, ports, labels, chips). */
export const CANVAS_INTERACTIVE_ATTR = "data-canvas-interactive";
/** Marks the transformed graph layer inside the canvas container. */
export const CANVAS_LAYER_ATTR = "data-canvas-layer";

const INITIAL_VIEW: ViewTransform = { scale: 1, x: 0, y: 0 };

// useLayoutEffect measures before paint in the browser; on the server it would only warn.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Whether a pointer event's target is canvas background (see the file header): the container, the
 * graph layer, or a descendant of the layer with no `data-canvas-interactive` ancestor up to it.
 */
export function isCanvasBackground(target: EventTarget | null, container: Element): boolean {
  if (!(target instanceof Element)) return false;
  if (target === container) return true;
  let node: Element | null = target;
  while (node && node !== container) {
    if (node.hasAttribute(CANVAS_INTERACTIVE_ATTR)) return false;
    if (node.hasAttribute(CANVAS_LAYER_ATTR)) return container.contains(node);
    node = node.parentElement;
  }
  return false;
}

/** Spread onto the canvas container. Pointer and double-click handlers only: NO wheel. */
export interface CanvasViewportBind {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

/** What {@link useCanvasViewport} returns. */
export interface UseCanvasViewportResult {
  view: ViewTransform;
  /** The readout, a rounded percent of `view.scale`. */
  readoutPct: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Pan the minimum to bring a graph rect into view with a 24 margin; never zooms (handoff [I9]). */
  revealRect: (rect: ViewRect) => void;
  /** True while a background drag is panning, for the grabbing cursor. */
  panning: boolean;
  bind: CanvasViewportBind;
}

/** Input of {@link useCanvasViewport}. */
export interface UseCanvasViewportInput {
  /** The laid-out graph size, or null until the layout exists. The first non-null size fits. */
  graphSize: Size | null;
  /** The canvas container: measured, and the target of the native wheel listener. */
  canvasRef: RefObject<HTMLElement | null>;
  /** A background press that did not pan (handoff [I5]: clears the selection, in S5). */
  onBackgroundClick?: () => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: ViewTransform;
  panning: boolean;
}

function isMeasured(size: Size | null): size is Size {
  return size !== null && size.width > 0 && size.height > 0;
}

/** Pan, zoom and fit state for the Build canvas. */
export function useCanvasViewport({
  graphSize,
  canvasRef,
  onBackgroundClick,
}: UseCanvasViewportInput): UseCanvasViewportResult {
  const [view, setView] = useState<ViewTransform>(INITIAL_VIEW);
  const [canvasSize, setCanvasSize] = useState<Size | null>(null);
  const [panning, setPanning] = useState(false);

  // Handlers read the latest values through refs, so their identities stay stable.
  const viewRef = useRef(view);
  viewRef.current = view;
  const graphSizeRef = useRef(graphSize);
  graphSizeRef.current = graphSize;
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;
  const onBackgroundClickRef = useRef(onBackgroundClick);
  onBackgroundClickRef.current = onBackgroundClick;
  const dragRef = useRef<DragState | null>(null);
  const fittedRef = useRef(false);

  // Measure the canvas, and keep measuring it: the column is flexible (handoff [AN3]).
  useIsomorphicLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setCanvasSize((previous) =>
        previous && previous.width === box.width && previous.height === box.height
          ? previous
          : { width: box.width, height: box.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvasRef]);

  // [I8] The canvas opens at fit when the graph size first arrives. Later sizes are re-flows, and
  // [I9] says the viewport does not jump on a re-flow, so this runs once.
  useIsomorphicLayoutEffect(() => {
    if (fittedRef.current || !graphSize || !isMeasured(canvasSize)) return;
    fittedRef.current = true;
    setView(computeFit(canvasSize, graphSize));
  }, [graphSize, canvasSize]);

  // [I8] The wheel, native and non-passive (see the file header).
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const input = {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        zoom: event.ctrlKey || event.metaKey,
        shiftKey: event.shiftKey,
        pointer: { x: event.clientX - box.left, y: event.clientY - box.top },
        pageHeight: box.height,
      };
      setView((previous) => applyWheel(previous, input));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [canvasRef]);

  const zoomBy = useCallback((direction: 1 | -1) => {
    const canvas = canvasSizeRef.current ?? { width: 0, height: 0 };
    setView((previous) => stepZoom(previous, direction, canvas));
  }, []);
  const zoomIn = useCallback(() => zoomBy(1), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(-1), [zoomBy]);

  const fitToView = useCallback(() => {
    const graph = graphSizeRef.current;
    const canvas = canvasSizeRef.current;
    if (!graph || !isMeasured(canvas)) return;
    setView(computeFit(canvas, graph));
  }, []);

  const revealRect = useCallback((rect: ViewRect) => {
    const canvas = canvasSizeRef.current;
    if (!isMeasured(canvas)) return;
    setView((previous) => ensureVisible(previous, rect, canvas));
  }, []);

  const endDrag = useCallback(
    (pointerId: number) => {
      const drag = dragRef.current;
      dragRef.current = null;
      const element = canvasRef.current;
      if (element?.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      if (drag?.panning) setPanning(false);
      return drag;
    },
    [canvasRef],
  );

  const bind = useMemo<CanvasViewportBind>(
    () => ({
      onPointerDown: (event) => {
        const element = canvasRef.current;
        if (event.button !== 0 || !element || !isCanvasBackground(event.target, element)) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          origin: viewRef.current,
          panning: false,
        };
        // Keep receiving the move and the release when the pointer leaves the canvas mid-drag.
        try {
          element.setPointerCapture?.(event.pointerId);
        } catch {
          // A synthetic or already released pointer cannot be captured; the drag still works.
        }
      },
      onPointerMove: (event) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.panning) {
          if (!exceedsPanThreshold(dx, dy)) return;
          drag.panning = true;
          setPanning(true);
        }
        setView({ scale: drag.origin.scale, x: drag.origin.x + dx, y: drag.origin.y + dy });
      },
      onPointerUp: (event) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        endDrag(event.pointerId);
        // [I5] A press that never passed the threshold is a click on the background.
        if (!drag.panning) onBackgroundClickRef.current?.();
      },
      onPointerCancel: (event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        endDrag(event.pointerId);
      },
      onDoubleClick: (event) => {
        const element = canvasRef.current;
        if (element && isCanvasBackground(event.target, element)) fitToView();
      },
    }),
    [canvasRef, endDrag, fitToView],
  );

  return {
    view,
    readoutPct: formatZoom(view.scale),
    zoomIn,
    zoomOut,
    fit: fitToView,
    revealRect,
    panning,
    bind,
  };
}
