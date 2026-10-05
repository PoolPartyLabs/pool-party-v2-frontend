/**
 * @id PP-MGR-CMP-046
 * @name CanvasViewport tests
 * @implements-rules-version v1 (POO-2236 rules v1); v1 (POO-2152 rules v1)
 * @analytics-events none, a presentational container; the Build screen (PP-MGR-SCR-002, S7) owns
 *   every event
 *
 * The canvas container of the Build step (handoff v1.2 [AN5], [AN6], [AN7], [I8], [I5] part,
 * [I9] part): a clipped 640 high box, the transformed graph layer, the zoom controls with their
 * readout, and the hint line. The pan, zoom and fit maths are proven in `viewportMath.test.ts` and
 * the hook's own tests; these pin what the manager can see and press.
 *
 * A7 (the page never scrolls sideways because of the graph) is NOT proven here: jsdom lays nothing
 * out. The `WideGraphNoPageScroll` story checks it in a real browser.
 */
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../../tests/utils/renderWithProviders";
import { CanvasViewport, type CanvasViewportHandle } from "./CanvasViewport";
import type { Size } from "./viewportMath";

const WORKED_EXAMPLE_1: Size = { width: 608, height: 674 };

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  // The Build frames' canvas: 656 x 640. jsdom lays nothing out, so the canvas reports it here.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-canvas-viewport") ? rect(656, 640) : rect(0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Graph() {
  return (
    <div data-testid="graph">
      <div data-testid="group-box" />
      <button type="button" data-canvas-interactive="" data-testid="card">
        WETH / USDC
      </button>
    </div>
  );
}

function renderViewport(
  props: Partial<{
    graphSize: Size | null;
    onBackgroundClick: () => void;
    viewportRef: React.Ref<CanvasViewportHandle>;
  }> = {},
) {
  return renderWithProviders(
    <CanvasViewport
      graphSize={props.graphSize === undefined ? WORKED_EXAMPLE_1 : props.graphSize}
      onBackgroundClick={props.onBackgroundClick}
      viewportRef={props.viewportRef}
    >
      <Graph />
    </CanvasViewport>,
  );
}

function canvas(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-canvas-viewport]");
  if (!element) throw new Error("no canvas");
  return element;
}

function layer(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-canvas-layer]");
  if (!element) throw new Error("no graph layer");
  return element;
}

describe("CanvasViewport: the container", () => {
  // @rule AN5
  it("[AN5] is a 640 high box with radius 20 on the background token, clipping its content", () => {
    renderViewport();

    expect(canvas().className).toContain("h-[max(640px,calc(100dvh-280px))]");
    expect(canvas().className).toContain("rounded-xl");
    expect(canvas().className).toContain("bg-background");
  });

  // @rule AN5
  it("[AN5] clips with overflow: clip, never overflow: hidden, so focus cannot scroll the box", () => {
    renderViewport();

    // `hidden` still makes a scroll container: focusing a card outside the visible box (keyboard
    // Tab, once S4 and S6 put cards in it) would scroll the box itself, drifting the graph and the
    // zoom controls away from the view the transform describes. `clip` makes no scroll container.
    expect(canvas().className).toContain("overflow-clip");
    expect(canvas().className).not.toContain("overflow-hidden");
  });

  // @rule AN5
  it("[AN5] draws its 1 px border in an overlay, so the border never shifts the graph", () => {
    renderViewport();

    const border = canvas().querySelector("[data-canvas-border]");
    expect(border).not.toBeNull();
    expect(border?.className).toContain("border-border");
    expect(border?.className).toContain("pointer-events-none");
    expect(border).toHaveAttribute("aria-hidden", "true");
  });

  // @rule I8
  it("[I8] renders the children inside the transformed graph layer, sized to the graph", () => {
    renderViewport();

    expect(layer()).toContainElement(screen.getByTestId("graph"));
    expect(layer().style.width).toBe("608px");
    expect(layer().style.height).toBe("674px");
    // The transform is `screen = graph * scale + (x, y)`, so it scales from the top-left corner.
    expect(layer().className).toContain("origin-top-left");
  });

  // @rule I8
  it("[I8] opens at fit: the layer carries the fitted transform", () => {
    renderViewport();

    const scale = 584 / 674;
    const x = (656 - 608 * scale) / 2;
    expect(layer().style.transform).toBe(`translate(${x}px, 16px) scale(${scale})`);
  });

  // @rule D8
  it("[D8] the viewport does not animate in this batch: no transition on the layer", () => {
    renderViewport();

    expect(layer().className).not.toMatch(/transition/);
    expect(layer().style.transition).toBe("");
  });

  // @rule I8
  it("[I8] shows the grab cursor on the canvas, and grabbing while a pan lasts", () => {
    renderViewport();
    expect(canvas().className).toContain("cursor-grab");

    fireEvent.pointerDown(canvas(), { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 340, clientY: 300 });

    expect(canvas().className).toContain("cursor-grabbing");
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 340, clientY: 300 });
    expect(canvas().className).not.toContain("cursor-grabbing");
  });
});

describe("CanvasViewport: zoom controls and readout", () => {
  // @rule AN6
  it("[AN6] stacks zoom in, the readout, zoom out and fit, each control with an accessible name", () => {
    renderViewport();

    const stack = canvas().querySelector("[data-canvas-zoom-controls]");
    expect(stack).not.toBeNull();
    const buttons = Array.from(stack?.querySelectorAll("button") ?? []);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Zoom in",
      "Zoom out",
      "Fit to view",
    ]);
    expect(stack?.textContent).toContain("87%");
    // Order inside the stack: zoom in, readout, zoom out, fit.
    const order = Array.from(stack?.children ?? []).map((child) =>
      child.tagName === "BUTTON" ? child.getAttribute("aria-label") : "readout",
    );
    expect(order).toEqual(["Zoom in", "readout", "Zoom out", "Fit to view"]);
  });

  // @rule AN6
  it("[AN6] sits bottom right, inset 12, 38 wide, radius 12, on the surface token with a border", () => {
    renderViewport();

    const stack = canvas().querySelector("[data-canvas-zoom-controls]");
    for (const token of [
      "absolute",
      "right-3",
      "bottom-3",
      "w-[38px]",
      "rounded-md",
      "bg-surface",
      "border-border",
      "p-1",
      "gap-0.5",
    ]) {
      expect(stack?.className).toContain(token);
    }
  });

  // @rule AN6
  it("[AN6] the readout is the rounded percent, with a spoken label", () => {
    renderViewport();

    expect(screen.getByText("87%")).toBeInTheDocument();
    expect(screen.getByText("Zoom 87%")).toBeInTheDocument();
  });

  // @rule I8 (D8)
  it("[I8] zoom in and zoom out step the readout on the 10% grid", async () => {
    renderViewport();

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("90%")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("80%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  // @rule I8 (D8)
  it("[I8] zoom out stops at 25% and zoom in at 150%", async () => {
    renderViewport();
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });

    for (let press = 0; press < 12; press++) await userEvent.click(zoomOut);
    expect(screen.getByText("25%")).toBeInTheDocument();

    for (let press = 0; press < 16; press++) await userEvent.click(zoomIn);
    expect(screen.getByText("150%")).toBeInTheDocument();
  });

  // @rule I8
  it("[I8] fit returns to the fitted readout", async () => {
    renderViewport();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    await userEvent.click(screen.getByRole("button", { name: "Fit to view" }));

    expect(screen.getByText("87%")).toBeInTheDocument();
  });

  // @rule AN6
  it("[AN6] the controls work from the keyboard (Enter and Space)", async () => {
    renderViewport();

    screen.getByRole("button", { name: "Zoom in" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("90%")).toBeInTheDocument();

    screen.getByRole("button", { name: "Zoom out" }).focus();
    await userEvent.keyboard(" ");
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  // @rule I5 (part)
  it("[I5] pressing a control never clicks the background", async () => {
    const onBackgroundClick = vi.fn();
    renderViewport({ onBackgroundClick });

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.dblClick(screen.getByRole("button", { name: "Zoom out" }));

    expect(onBackgroundClick).not.toHaveBeenCalled();
  });
});

describe("CanvasViewport: hint line", () => {
  // @rule AN7
  it("[AN7] prints the hint bottom left, inset 12, in the muted caption style", () => {
    renderViewport();

    const hint = screen.getByText(
      "Ctrl + scroll to zoom (Cmd + scroll on Mac) · drag to move · double-click to fit",
    );
    for (const token of ["absolute", "left-3", "bottom-3", "text-xs", "text-muted-foreground"]) {
      expect(hint.className).toContain(token);
    }
  });

  // @rule AN7
  it("[AN7] describes the canvas, and lets a press through to the graph below it", () => {
    renderViewport();

    const hint = screen.getByText(/Ctrl \+ scroll to zoom/);
    expect(canvas()).toHaveAttribute("aria-describedby", hint.id);
    expect(hint.className).toContain("pointer-events-none");
  });
});

describe("CanvasViewport: wheel, drag, click and double-click", () => {
  // @rule I8
  it("[I8] Ctrl + wheel zooms and blocks the page zoom; a plain wheel pans and blocks the scroll", () => {
    renderViewport();

    const zoom = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -40,
      clientX: 300,
      clientY: 300,
    });
    act(() => {
      screen.getByTestId("card").dispatchEvent(zoom);
    });
    expect(zoom.defaultPrevented).toBe(true);
    expect(screen.queryByText("87%")).not.toBeInTheDocument();

    const before = layer().style.transform;
    const pan = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 50 });
    act(() => {
      canvas().dispatchEvent(pan);
    });
    expect(pan.defaultPrevented).toBe(true);
    expect(layer().style.transform).not.toBe(before);
  });

  // @rule I5 (part)
  it("[I5] a background press of 4 px or less reports a background click; more is a pan", () => {
    const onBackgroundClick = vi.fn();
    renderViewport({ onBackgroundClick });
    const groupBox = screen.getByTestId("group-box");

    fireEvent.pointerDown(groupBox, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 203, clientY: 202 });
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 203, clientY: 202 });
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);

    const before = layer().style.transform;
    fireEvent.pointerDown(groupBox, { button: 0, pointerId: 2, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(canvas(), { pointerId: 2, clientX: 205, clientY: 200 });
    fireEvent.pointerUp(canvas(), { pointerId: 2, clientX: 205, clientY: 200 });
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
    expect(layer().style.transform).not.toBe(before);
  });

  // @rule I5 (part)
  it("[I5] a press on a data-canvas-interactive element never pans, clicks the background or fits", async () => {
    const onBackgroundClick = vi.fn();
    renderViewport({ onBackgroundClick });
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomed = layer().style.transform;
    const card = screen.getByTestId("card");

    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 260, clientY: 240 });
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 260, clientY: 240 });
    fireEvent.doubleClick(card);

    expect(layer().style.transform).toBe(zoomed);
    expect(onBackgroundClick).not.toHaveBeenCalled();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  // @rule I8
  it("[I8] a double-click on the background fits", async () => {
    renderViewport();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("90%")).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByTestId("group-box"));

    expect(screen.getByText("87%")).toBeInTheDocument();
  });
});

describe("CanvasViewport: the handle", () => {
  // @rule I9 (part)
  it("[I9] exposes fit and revealRect to the screen that owns the selection", async () => {
    const ref = createRef<CanvasViewportHandle>();
    renderViewport({ graphSize: { width: 468, height: 572 }, viewportRef: ref });
    expect(layer().style.transform).toBe("translate(94px, 16px) scale(1)");

    act(() => ref.current?.revealRect({ x: 700, y: 100, w: 176, h: 62 }));
    expect(layer().style.transform).toBe("translate(-244px, 16px) scale(1)");

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    act(() => {
      const handle = ref.current;
      if (handle) {
        const { fit: fitView } = handle;
        fitView();
      }
    });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  // @rule I8
  it("[I8] with no graph yet the layer is unsized and the readout reads 100%", () => {
    renderViewport({ graphSize: null });

    expect(layer().style.width).toBe("");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

it("[POO-2226 R4] Manage can open at 100% while Fit remains available", async () => {
  renderWithProviders(
    <CanvasViewport graphSize={WORKED_EXAMPLE_1} initialScale={1}>
      <Graph />
    </CanvasViewport>,
  );
  expect(layer().style.transform).toContain("scale(1)");
  expect(screen.getByText("100%")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Fit to view" }));
  expect(screen.getByText("87%")).toBeInTheDocument();
});
