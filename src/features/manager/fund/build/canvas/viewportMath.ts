/**
 * @id PP-MGR-LIB-022
 * @name viewportMath
 * @implements-rules-version v1 (POO-2236 rules v1); v1 (POO-2152 rules v1)
 * @analytics-events none, pure geometry; the Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The geometry of the Build canvas viewport (handoff v1.2 [I8], [I9], coordinator default D8).
 *
 * The graph is laid out in its own coordinates (the layout of S3, at 100% zoom) and drawn through one
 * transform: `screen = graph * scale + (x, y)`, where screen is measured from the top-left corner of
 * the canvas container. Every function here takes a {@link ViewTransform} and returns a new one, so
 * the hook that owns the state ({@link useCanvasViewport}) only decides WHEN to move, never HOW.
 *
 * Three decisions are worth stating:
 *
 * 1. **Fit may go below the 25% floor.** The floor bounds the controls and the wheel, not fit:
 *    reference canvas A (2080 wide) only fits at about 30%, and a larger plan must still fit whole.
 *    Fit never zooms PAST 100%, so a small graph is shown at its real size.
 * 2. **The controls land on the 10% grid.** From a fit of 87%, zoom in goes to 90%, not 97%: a
 *    readout of round numbers is what tells the manager the control did something predictable.
 * 3. **Below the floor the wheel never zooms further out.** A large fit can sit at 18%; clamping the
 *    wheel to [25%, 150%] there would make a wheel-out JUMP IN to 25%. The lower bound is the
 *    current scale when it is already below the floor.
 */

/** A width and a height in px. */
export interface Size {
  width: number;
  height: number;
}

/** `screen = graph * scale + (x, y)`, screen measured from the canvas container's top-left. */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

/** A point in px. */
export interface ViewPoint {
  x: number;
  y: number;
}

/** A rect in graph coordinates (the layout's `Rect`). */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The viewport constants (handoff [I8], default D8). `FIT_PAD_Y` is 56 rather than 24 because it
 * keeps the hint line and the zoom controls clear of the graph.
 */
export const ZOOM = {
  MIN: 0.25,
  MAX: 1.5,
  STEP: 0.1,
  FIT_PAD_X: 24,
  FIT_PAD_Y: 56,
  FIT_TOP: 16,
  /** 116px zoom stack plus its 12px bottom inset. */
  FIT_CONTROLS: 128,
  PAN_THRESHOLD: 4,
} as const;

/** The default margin of {@link ensureVisible} (handoff [I9]). */
export const REVEAL_MARGIN = 24;

/** px per line for a wheel reported in lines (Firefox with a mouse wheel). */
const LINE_PX = 16;
/** How strongly a wheel delta zooms: 100 px of wheel is a factor of 2 before the per-event cap. */
const WHEEL_ZOOM_RATE = 0.01;
/** Cap per wheel event, as a power of 2, so one notch of a coarse mouse wheel stays a step. */
const WHEEL_ZOOM_MAX_EXPONENT = 0.5;
/** Tolerance for "this scale is already on the 10% grid" (0.7 * 10 is 7.000000000000001). */
const GRID_EPSILON = 1e-6;

/**
 * Fit (handoff [I8]): scale = min(1, (canvas width - 24) / graph width, (canvas height - 56) / graph
 * height); the graph is centred horizontally and starts 16 px from the top. It may go below 25%.
 *
 * An empty graph, or a canvas not measured yet (a side at or under its padding), fits at 100%
 * rather than at zero or a negative scale.
 */
export function computeFit(canvas: Size, graph: Size, center = false): ViewTransform {
  if (center) {
    // Build reserves the bottom control stack; Manage retains its original fit geometry.
    const roomHeight = Math.max(1, canvas.height - ZOOM.FIT_CONTROLS);
    const scale = Math.max(
      Number.EPSILON,
      Math.min(
        1,
        graph.width > 0 ? Math.max(1, canvas.width - 24) / graph.width : 1,
        graph.height > 0 ? Math.max(1, roomHeight - 24) / graph.height : 1,
      ),
    );
    return {
      scale,
      x: (canvas.width - graph.width * scale) / 2,
      y: (roomHeight - graph.height * scale) / 2,
    };
  }
  const byWidth = graph.width > 0 ? (canvas.width - ZOOM.FIT_PAD_X) / graph.width : 1;
  const byHeight = graph.height > 0 ? (canvas.height - ZOOM.FIT_PAD_Y) / graph.height : 1;
  const raw = Math.min(1, byWidth, byHeight);
  const scale = raw > 0 && Number.isFinite(raw) ? raw : 1;
  return {
    scale,
    x: (canvas.width - graph.width * scale) / 2,
    y: ZOOM.FIT_TOP,
  };
}

/** Zoom to `nextScale` keeping the graph point under `pointer` where it is on screen. */
export function zoomAround(
  view: ViewTransform,
  nextScale: number,
  pointer: ViewPoint,
): ViewTransform {
  const graphX = (pointer.x - view.x) / view.scale;
  const graphY = (pointer.y - view.y) / view.scale;
  return {
    scale: nextScale,
    x: pointer.x - graphX * nextScale,
    y: pointer.y - graphY * nextScale,
  };
}

/** The next scale of a control step, or null when the step is a no-op (D8). */
function stepScale(scale: number, direction: 1 | -1): number | null {
  if (direction === 1) {
    if (scale < ZOOM.MIN) return ZOOM.MIN;
    if (scale >= ZOOM.MAX) return null;
  } else if (scale <= ZOOM.MIN) {
    return null;
  }
  const tenths = scale / ZOOM.STEP;
  const nearest = Math.round(tenths);
  const onGrid = Math.abs(tenths - nearest) < GRID_EPSILON;
  const target = onGrid
    ? nearest + direction
    : direction === 1
      ? Math.ceil(tenths)
      : Math.floor(tenths);
  // Dividing an integer by 10 gives the exact decimal (0.3, not 0.30000000000000004).
  const next = target / 10;
  return Math.min(ZOOM.MAX, Math.max(ZOOM.MIN, next));
}

/**
 * One press of zoom in (`1`) or zoom out (`-1`), around the centre of the canvas (D8): rounds to
 * the 10% grid in the direction of the step and clamps to [25%, 150%]. Zoom in from below 25% goes
 * to 25%; zoom out at or below 25%, and zoom in at 150%, return the view unchanged.
 */
export function stepZoom(view: ViewTransform, direction: 1 | -1, canvas: Size): ViewTransform {
  const next = stepScale(view.scale, direction);
  if (next === null || next === view.scale) return view;
  return zoomAround(view, next, { x: canvas.width / 2, y: canvas.height / 2 });
}

/** What the hook reads off a native `WheelEvent`, so the wheel stays a pure function. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  /** Ctrl or Cmd held (a trackpad pinch arrives as Ctrl + wheel too). */
  zoom: boolean;
  shiftKey: boolean;
  /** The pointer, relative to the canvas container. */
  pointer: ViewPoint;
  /** The canvas height, for a wheel reported in pages. Defaults to 640 (handoff [AN5]). */
  pageHeight?: number;
}

function wheelPx(delta: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * pageHeight;
  return delta;
}

/**
 * The wheel (handoff [I8]): with Ctrl or Cmd it zooms around the pointer (wheel up zooms in), within
 * [25%, 150%], never further out when the view already sits below 25%; without it, it pans by its
 * delta, and Shift turns a vertical wheel into a sideways pan for a mouse with a single wheel.
 */
export function applyWheel(view: ViewTransform, wheel: WheelInput): ViewTransform {
  const pageHeight = wheel.pageHeight ?? 640;
  const dx = wheelPx(wheel.deltaX, wheel.deltaMode, pageHeight);
  const dy = wheelPx(wheel.deltaY, wheel.deltaMode, pageHeight);

  if (!wheel.zoom) {
    if (wheel.shiftKey && dx === 0) return { ...view, x: view.x - dy };
    return { ...view, x: view.x - dx, y: view.y - dy };
  }

  const exponent = Math.max(
    -WHEEL_ZOOM_MAX_EXPONENT,
    Math.min(WHEEL_ZOOM_MAX_EXPONENT, -dy * WHEEL_ZOOM_RATE),
  );
  const lower = Math.min(ZOOM.MIN, view.scale);
  const next = Math.min(ZOOM.MAX, Math.max(lower, view.scale * 2 ** exponent));
  if (next === view.scale) return view;
  return zoomAround(view, next, wheel.pointer);
}

/** A press that moves MORE than 4 px is a pan, never a click (handoff [I5], proposal). */
export function exceedsPanThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > ZOOM.PAN_THRESHOLD;
}

/** The minimal offset change on one axis that brings [start, end] inside [margin, size - margin]. */
function revealAxis(offset: number, start: number, end: number, size: number, margin: number) {
  const low = margin;
  const high = size - margin;
  // Larger than the room: show its start, which is where a card's title and a chain's top are.
  if (end - start > high - low) return offset + (low - start);
  if (start < low) return offset + (low - start);
  if (end > high) return offset - (end - high);
  return offset;
}

/**
 * Reveal (handoff [I9]): pan the minimum that brings `rect` (graph coordinates) into view with a
 * margin (24 by default). Never changes the scale. Returns the same view when nothing has to move.
 */
export function ensureVisible(
  view: ViewTransform,
  rect: ViewRect,
  canvas: Size,
  margin: number = REVEAL_MARGIN,
): ViewTransform {
  const left = rect.x * view.scale + view.x;
  const top = rect.y * view.scale + view.y;
  const right = left + rect.w * view.scale;
  const bottom = top + rect.h * view.scale;
  const x = revealAxis(view.x, left, right, canvas.width, margin);
  const y = revealAxis(view.y, top, bottom, canvas.height, margin);
  if (x === view.x && y === view.y) return view;
  return { scale: view.scale, x, y };
}

/** The readout: the scale as a rounded percent (87 for 0.8665). */
export function formatZoom(scale: number): number {
  return Math.round(scale * 100);
}
