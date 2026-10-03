/**
 * @id PP-MGR-HOK-008
 * @name useCanvasViewport tests
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, a viewport hook; the Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The behaviour of the Build canvas viewport (handoff v1.2 [I8], [I5] part, [I9] part):
 *
 * - it opens at fit when the graph size first arrives, and never jumps on a later re-flow;
 * - the wheel is a NATIVE, non-passive listener: React's `onWheel` is passive and cannot
 *   `preventDefault`, which would let Ctrl + wheel zoom the whole page. The tests dispatch a
 *   cancelable native `WheelEvent` and assert `defaultPrevented`, which jsdom only honours outside a
 *   passive listener;
 * - "background" (what pans, clicks and double-click fits) is the container, the graph layer, or a
 *   descendant of the layer with no `data-canvas-interactive` ancestor up to the layer; a press on an
 *   interactive element never pans and never clicks the background;
 * - a press that moves more than 4 px is a pan and never a background click.
 *
 * jsdom lays nothing out, so `getBoundingClientRect` is stubbed for the canvas element: a 656 x 640
 * canvas (the Build frames) placed at (100, 50) on the page, which is what makes the pointer maths
 * relative to the container observable.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCanvasBackground,
  type UseCanvasViewportResult,
  useCanvasViewport,
} from "./useCanvasViewport";
import { computeFit, type Size } from "./viewportMath";

const CANVAS_LEFT = 100;
const CANVAS_TOP = 50;
const CANVAS: Size = { width: 656, height: 640 };
const WORKED_EXAMPLE_1: Size = { width: 608, height: 674 };

let current: UseCanvasViewportResult | null = null;

function result(): UseCanvasViewportResult {
  if (!current) throw new Error("the harness has not rendered");
  return current;
}

/**
 * Calls the hook's `fit`. Read through a destructured alias: biome's noFocusedTests reads any call
 * named `fit` (a Jasmine focused test) as a test left focused.
 */
function fitView(): void {
  const { fit: fitToView } = result();
  fitToView();
}

function Harness({
  graphSize,
  onBackgroundClick,
}: {
  graphSize: Size | null;
  onBackgroundClick?: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewport = useCanvasViewport({ graphSize, canvasRef, onBackgroundClick });
  current = viewport;
  return (
    <div ref={canvasRef} data-testid="canvas" {...viewport.bind}>
      <div data-canvas-layer="" data-testid="layer">
        <div data-testid="group-box">
          <svg data-testid="lines" aria-hidden="true">
            <path data-testid="line" d="M0 0L10 10" />
          </svg>
        </div>
        <button type="button" data-canvas-interactive="" data-testid="card">
          <span data-testid="card-title">WETH / USDC</span>
        </button>
      </div>
      <button type="button" data-testid="control">
        +
      </button>
    </div>
  );
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  current = null;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.testid === "canvas"
      ? rect(CANVAS_LEFT, CANVAS_TOP, CANVAS.width, CANVAS.height)
      : rect(0, 0, 0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A cancelable native wheel event, dispatched the way a browser does. */
function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/**
 * jsdom implements no pointer capture, so the canvas gets a recording stand-in with the same
 * contract: capture is per pointer id, and release only holds for an id that was captured.
 */
function stubPointerCapture(element: HTMLElement) {
  const captured = new Set<number>();
  const set = vi.fn((pointerId: number) => {
    captured.add(pointerId);
  });
  const release = vi.fn((pointerId: number) => {
    captured.delete(pointerId);
  });
  Object.assign(element, {
    setPointerCapture: set,
    releasePointerCapture: release,
    hasPointerCapture: (pointerId: number) => captured.has(pointerId),
  });
  return { set, release, isCaptured: (pointerId: number) => captured.has(pointerId) };
}

/** The graph point under a page point, given the current view. */
function graphPointUnder(clientX: number, clientY: number) {
  const { view } = result();
  return {
    x: (clientX - CANVAS_LEFT - view.x) / view.scale,
    y: (clientY - CANVAS_TOP - view.y) / view.scale,
  };
}

describe("useCanvasViewport: opening and controls", () => {
  // @rule I8
  it("[I8] starts at 100% and opens at fit when the graph size first arrives", () => {
    const { rerender } = render(<Harness graphSize={null} />);
    expect(result().view).toEqual({ scale: 1, x: 0, y: 0 });
    expect(result().readoutPct).toBe(100);

    rerender(<Harness graphSize={WORKED_EXAMPLE_1} />);

    expect(result().view).toEqual(computeFit(CANVAS, WORKED_EXAMPLE_1));
    expect(result().readoutPct).toBe(87);
  });

  // @rule I8
  it("[I8] fits on mount when the graph size is already known", () => {
    render(<Harness graphSize={{ width: 2080, height: 772 }} />);

    expect(result().readoutPct).toBe(30);
  });

  // @rule I9 (part)
  it("[I9] a later graph size (a re-flow) does not move the view", () => {
    const { rerender } = render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const opened = result().view;

    rerender(<Harness graphSize={{ width: 928, height: 772 }} />);

    expect(result().view).toEqual(opened);
  });

  // @rule I8 (D8)
  it("[I8] zoom in and zoom out step on the 10% grid", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);

    act(() => result().zoomIn());
    expect(result().view.scale).toBe(0.9);
    expect(result().readoutPct).toBe(90);

    act(() => result().zoomOut());
    act(() => result().zoomOut());
    expect(result().view.scale).toBe(0.7);
  });

  // @rule I8
  it("[I8] fit returns to the fitted view after zooming and panning", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    act(() => result().zoomIn());
    act(() => result().zoomIn());

    act(() => fitView());

    expect(result().view).toEqual(computeFit(CANVAS, WORKED_EXAMPLE_1));
  });

  // @rule I8
  it("[I8] fit with no graph yet changes nothing", () => {
    render(<Harness graphSize={null} />);

    act(() => fitView());

    expect(result().view).toEqual({ scale: 1, x: 0, y: 0 });
  });

  // @rule I9 (part)
  it("[I9] revealRect pans the minimum, with a 24 margin, and keeps the scale", () => {
    render(<Harness graphSize={{ width: 468, height: 572 }} />);
    const before = result().view;
    expect(before).toEqual({ scale: 1, x: 94, y: 16 });

    act(() => result().revealRect({ x: 700, y: 100, w: 176, h: 62 }));

    expect(result().view).toEqual({ scale: 1, x: 656 - 24 - 876, y: 16 });
  });
});

describe("useCanvasViewport: the wheel (native, non-passive)", () => {
  // @rule I8
  it("[I8] (test method) a passive listener cannot block the page: jsdom ignores its preventDefault", () => {
    // Without this, `defaultPrevented` below would prove nothing about passive versus non-passive.
    const element = document.createElement("div");
    element.addEventListener("wheel", (event) => event.preventDefault(), { passive: true });

    const event = new WheelEvent("wheel", { cancelable: true, ctrlKey: true, deltaY: -40 });
    element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  // @rule I8
  it("[I8] attaches the wheel as a native listener with passive: false", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "addEventListener");

    render(<Harness graphSize={WORKED_EXAMPLE_1} />);

    // React registers its own (passive) wheel listeners on the root, so only the calls made on the
    // canvas element itself are the hook's.
    const canvas = screen.getByTestId("canvas");
    const wheelCalls = spy.mock.calls.filter(
      ([type], index) => type === "wheel" && spy.mock.contexts[index] === canvas,
    );
    expect(wheelCalls).toHaveLength(1);
    expect(wheelCalls[0]?.[2]).toEqual({ passive: false });
  });

  // @rule I8
  it("[I8] Ctrl + wheel zooms around the pointer and blocks the page zoom", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const before = result().view.scale;
    const pointed = graphPointUnder(400, 300);

    const event = wheel(screen.getByTestId("canvas"), {
      deltaY: -40,
      ctrlKey: true,
      clientX: 400,
      clientY: 300,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(result().view.scale).toBeGreaterThan(before);
    const after = graphPointUnder(400, 300);
    expect(after.x).toBeCloseTo(pointed.x, 9);
    expect(after.y).toBeCloseTo(pointed.y, 9);
  });

  // @rule I8
  it("[I8] Cmd + wheel zooms too (the Mac modifier), and wheel down zooms out", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const before = result().view.scale;

    const event = wheel(screen.getByTestId("canvas"), {
      deltaY: 40,
      metaKey: true,
      clientX: 400,
      clientY: 300,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(result().view.scale).toBeLessThan(before);
  });

  // @rule I8
  it("[I8] a plain wheel pans, keeps the scale and blocks the page scroll", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const before = result().view;

    const event = wheel(screen.getByTestId("canvas"), { deltaX: 10, deltaY: 60 });

    expect(event.defaultPrevented).toBe(true);
    expect(result().view).toEqual({ scale: before.scale, x: before.x - 10, y: before.y - 60 });
  });

  // @rule I8
  it("[I8] a wheel over a card reaches the canvas too, so the page never scrolls under the graph", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const before = result().view;

    const event = wheel(screen.getByTestId("card-title"), { deltaY: 30 });

    expect(event.defaultPrevented).toBe(true);
    expect(result().view.y).toBe(before.y - 30);
  });

  // @rule I8
  it("[I8] removes the wheel listener on unmount", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const { unmount } = render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const canvas = screen.getByTestId("canvas");

    unmount();

    expect(
      spy.mock.calls.some(
        ([type], index) => type === "wheel" && spy.mock.contexts[index] === canvas,
      ),
    ).toBe(true);
  });
});

describe("useCanvasViewport: Safari pinch (gesture events)", () => {
  // Safari reports a trackpad pinch as gesturestart / gesturechange, not as Ctrl + wheel. jsdom has
  // no GestureEvent, so a plain cancelable Event of the same type stands in for it.
  function gesture(target: Element, type: string): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  // @rule I8
  it("[I8] registers gesturestart and gesturechange as native listeners with passive: false", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "addEventListener");

    render(<Harness graphSize={WORKED_EXAMPLE_1} />);

    const canvas = screen.getByTestId("canvas");
    for (const type of ["gesturestart", "gesturechange"]) {
      const calls = spy.mock.calls.filter(
        ([name], index) => name === type && spy.mock.contexts[index] === canvas,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[2]).toEqual({ passive: false });
    }
  });

  // @rule I8
  it("[I8] blocks the page zoom of a pinch over the canvas, a card included", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const before = result().view;

    expect(gesture(screen.getByTestId("canvas"), "gesturestart").defaultPrevented).toBe(true);
    expect(gesture(screen.getByTestId("card-title"), "gesturechange").defaultPrevented).toBe(true);
    // Blocking the page zoom is all it does: the canvas itself does not move.
    expect(result().view).toEqual(before);
  });

  // @rule I8
  it("[I8] removes both gesture listeners on unmount", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const { unmount } = render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const canvas = screen.getByTestId("canvas");

    unmount();

    for (const type of ["gesturestart", "gesturechange"]) {
      expect(
        spy.mock.calls.some(
          ([name], index) => name === type && spy.mock.contexts[index] === canvas,
        ),
      ).toBe(true);
    }
  });
});

describe("useCanvasViewport: drag, click and double-click on the background", () => {
  function press(target: Element, from: [number, number], to: [number, number]) {
    const canvas = screen.getByTestId("canvas");
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: to[0], clientY: to[1] });
  }

  // @rule I8
  it("[I8] dragging the canvas background pans by the full distance", () => {
    const onBackgroundClick = vi.fn();
    render(<Harness graphSize={WORKED_EXAMPLE_1} onBackgroundClick={onBackgroundClick} />);
    const before = result().view;

    press(screen.getByTestId("canvas"), [300, 300], [340, 270]);

    expect(result().view).toEqual({ scale: before.scale, x: before.x + 40, y: before.y - 30 });
    expect(onBackgroundClick).not.toHaveBeenCalled();
  });

  // @rule I8
  it("[I8] the graph layer, a group box and the lines count as background", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const start = result().view;

    press(screen.getByTestId("layer"), [300, 300], [310, 300]);
    press(screen.getByTestId("group-box"), [300, 300], [310, 300]);
    press(screen.getByTestId("line"), [300, 300], [310, 300]);

    expect(result().view.x).toBe(start.x + 30);
  });

  // @rule I8
  it("[I8] reports the pan while it lasts, for the grabbing cursor", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const canvas = screen.getByTestId("canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    expect(result().panning).toBe(false);
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 320, clientY: 300 });
    expect(result().panning).toBe(true);
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 320, clientY: 300 });
    expect(result().panning).toBe(false);
  });

  // @rule I5 (part)
  it("[I5] a press that moves 4 px or less is a background click, not a pan", () => {
    const onBackgroundClick = vi.fn();
    render(<Harness graphSize={WORKED_EXAMPLE_1} onBackgroundClick={onBackgroundClick} />);
    const before = result().view;

    press(screen.getByTestId("group-box"), [300, 300], [304, 300]);

    expect(result().view).toEqual(before);
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });

  // @rule I5 (part)
  it("[I5] a press that moves more than 4 px is a pan and never fires the background click", () => {
    const onBackgroundClick = vi.fn();
    render(<Harness graphSize={WORKED_EXAMPLE_1} onBackgroundClick={onBackgroundClick} />);

    press(screen.getByTestId("canvas"), [300, 300], [303, 304]);

    expect(onBackgroundClick).not.toHaveBeenCalled();
  });

  // @rule I5 (part)
  it("[I5] a press on a data-canvas-interactive element never pans and never clicks the background", () => {
    const onBackgroundClick = vi.fn();
    render(<Harness graphSize={WORKED_EXAMPLE_1} onBackgroundClick={onBackgroundClick} />);
    const before = result().view;

    press(screen.getByTestId("card"), [300, 300], [380, 360]);
    press(screen.getByTestId("card-title"), [300, 300], [301, 300]);

    expect(result().view).toEqual(before);
    expect(onBackgroundClick).not.toHaveBeenCalled();
  });

  // @rule I8
  it("[I8] a press on a control outside the graph layer never pans or clicks the background", () => {
    const onBackgroundClick = vi.fn();
    render(<Harness graphSize={WORKED_EXAMPLE_1} onBackgroundClick={onBackgroundClick} />);
    const before = result().view;

    press(screen.getByTestId("control"), [300, 300], [380, 300]);

    expect(result().view).toEqual(before);
    expect(onBackgroundClick).not.toHaveBeenCalled();
  });

  // @rule I8
  it("[I8] only the primary button pans", () => {
    const onBackgroundClick = vi.fn();
    render(<Harness graphSize={WORKED_EXAMPLE_1} onBackgroundClick={onBackgroundClick} />);
    const before = result().view;
    const canvas = screen.getByTestId("canvas");

    fireEvent.pointerDown(canvas, { button: 2, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 360, clientY: 300 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 360, clientY: 300 });

    expect(result().view).toEqual(before);
    expect(onBackgroundClick).not.toHaveBeenCalled();
  });

  // @rule I5 (part)
  it("[I5] a cancelled pan is released: no background click, no capture, no further movement", () => {
    const onBackgroundClick = vi.fn();
    render(<Harness graphSize={WORKED_EXAMPLE_1} onBackgroundClick={onBackgroundClick} />);
    const canvas = screen.getByTestId("canvas");
    const capture = stubPointerCapture(canvas);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 340, clientY: 300 });
    expect(result().panning).toBe(true);
    const panned = result().view;

    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    expect(result().panning).toBe(false);
    expect(capture.release).toHaveBeenCalledWith(1);
    expect(capture.isCaptured(1)).toBe(false);
    // What follows the cancel belongs to no press: it neither moves the view nor clicks.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 360 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 400, clientY: 360 });
    expect(result().view).toEqual(panned);
    expect(onBackgroundClick).not.toHaveBeenCalled();
  });

  // @rule I8
  it("[I8] a background press captures the pointer and the release lets it go", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const canvas = screen.getByTestId("canvas");
    const capture = stubPointerCapture(canvas);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: 300, clientY: 300 });
    expect(capture.set).toHaveBeenCalledWith(7);
    expect(capture.isCaptured(7)).toBe(true);

    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 340, clientY: 300 });
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 340, clientY: 300 });
    expect(capture.release).toHaveBeenCalledWith(7);
    expect(capture.isCaptured(7)).toBe(false);
  });

  // @rule I5 (part)
  it("[I5] a press on an interactive element never captures the pointer", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const capture = stubPointerCapture(screen.getByTestId("canvas"));

    fireEvent.pointerDown(screen.getByTestId("card"), { button: 0, pointerId: 1 });

    expect(capture.set).not.toHaveBeenCalled();
  });

  // @rule I8
  it("[I8] a wheel zoom in the middle of a pan is kept, and the pan goes on from it", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const canvas = screen.getByTestId("canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 340, clientY: 300 });
    const panned = result().view;
    wheel(canvas, { deltaY: -40, ctrlKey: true, clientX: 400, clientY: 300 });
    const zoomed = result().view;
    expect(zoomed.scale).toBeGreaterThan(panned.scale);

    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 360, clientY: 310 });

    // Both effects are kept: the zoom's scale and offset, plus the 20 x 10 of the second move.
    expect(result().view).toEqual({ scale: zoomed.scale, x: zoomed.x + 20, y: zoomed.y + 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 360, clientY: 310 });
    expect(result().view).toEqual({ scale: zoomed.scale, x: zoomed.x + 20, y: zoomed.y + 10 });
  });

  // @rule I8
  it("[I8] a control zoom in the middle of a pan is kept too", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    const canvas = screen.getByTestId("canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 320, clientY: 300 });
    act(() => result().zoomIn());
    const zoomed = result().view;
    expect(zoomed.scale).toBe(0.9);

    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 335, clientY: 290 });

    expect(result().view).toEqual({ scale: 0.9, x: zoomed.x + 15, y: zoomed.y - 10 });
  });

  // @rule I8
  it("[I8] a double-click on the background fits the graph", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    act(() => result().zoomIn());
    act(() => result().zoomIn());

    fireEvent.doubleClick(screen.getByTestId("line"));

    expect(result().view).toEqual(computeFit(CANVAS, WORKED_EXAMPLE_1));
  });

  // @rule I8
  it("[I8] a double-click on a card or a control does not fit", () => {
    render(<Harness graphSize={WORKED_EXAMPLE_1} />);
    act(() => result().zoomIn());
    const zoomed = result().view;

    fireEvent.doubleClick(screen.getByTestId("card-title"));
    fireEvent.doubleClick(screen.getByTestId("control"));

    expect(result().view).toEqual(zoomed);
  });
});

describe("isCanvasBackground", () => {
  function tree() {
    const container = document.createElement("div");
    container.innerHTML = `
      <div data-canvas-layer="">
        <div id="group"><svg><path id="line"></path></svg></div>
        <div data-canvas-interactive="" id="card"><span id="title"></span></div>
      </div>
      <div id="controls"><button id="zoom"></button></div>`;
    const byId = (id: string) => container.querySelector(`#${id}`);
    const layer = container.querySelector("[data-canvas-layer]");
    return { container, layer, byId };
  }

  // @rule I8
  it("[I8] the container, the layer and plain descendants of the layer are background", () => {
    const { container, layer, byId } = tree();

    expect(isCanvasBackground(container, container)).toBe(true);
    expect(isCanvasBackground(layer, container)).toBe(true);
    expect(isCanvasBackground(byId("group"), container)).toBe(true);
    expect(isCanvasBackground(byId("line"), container)).toBe(true);
  });

  // @rule I5 (part)
  it("[I5] an element carrying data-canvas-interactive, or inside one, is not background", () => {
    const { container, byId } = tree();

    expect(isCanvasBackground(byId("card"), container)).toBe(false);
    expect(isCanvasBackground(byId("title"), container)).toBe(false);
  });

  // @rule I8
  it("[I8] anything outside the layer (the zoom controls, the hint), or outside the canvas, is not", () => {
    const { container, byId } = tree();

    expect(isCanvasBackground(byId("controls"), container)).toBe(false);
    expect(isCanvasBackground(byId("zoom"), container)).toBe(false);
    expect(isCanvasBackground(document.body, container)).toBe(false);
    expect(isCanvasBackground(null, container)).toBe(false);
  });
});
