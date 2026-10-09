/** @id PP-MGR-CMP-100 @name ReactFlowGraph tests @implements-rules-version v1 @analytics-events none, presentational engine tests. */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Position } from "@xyflow/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeFit, type Size } from "../canvas/viewportMath";
import {
  FinancialConnectionEdge,
  ReactFlowGraph,
  useFinancialGraphPresentation,
} from "./ReactFlowGraph";
import type { FinancialGraphPresentation } from "./reactFlowProjection";

// @rule R1/R3: custom edges use actual measured handle coordinates and whole-connection hover.
it("draws measured financial endpoints and preserves the complete highlighted connection", () => {
  const hover = vi.fn();
  const props = {
    id: "income:lp",
    source: "lp",
    target: "income",
    sourceX: 110,
    sourceY: 120,
    targetX: 320,
    targetY: 330,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    selected: false,
    selectable: false,
    deletable: false,
    data: {
      points: [
        { x: 100, y: 100 },
        { x: 100, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 300 },
      ],
      tone: "income" as const,
      highlighted: true,
      onHoverChange: hover,
    },
  };
  const mounted = render(
    <svg aria-hidden="true">
      <FinancialConnectionEdge {...props} />
    </svg>,
  );
  const path = mounted.container.querySelector("[data-edge-id]");
  expect(path?.getAttribute("d")).toMatch(/^M110,120 /);
  expect(path?.getAttribute("d")).toMatch(/L320,330$/);
  expect(path).toHaveAttribute("data-highlighted", "");
  expect(path).toHaveAttribute("data-edge-tone", "income");
  const hit = mounted.container.querySelector("[data-edge-hit]");
  if (!hit) throw new Error("missing financial hover target");
  fireEvent.pointerEnter(hit);
  expect(hover).toHaveBeenLastCalledWith("income:lp");
  fireEvent.pointerLeave(hit);
  expect(hover).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole("button")).toBeNull();
});

const GRAPH_SIZE: Size = { width: 1200, height: 700 };
const presentation: FinancialGraphPresentation = {
  semantic: {
    nodes: [
      { id: "source", kind: "holding", network: "base", rect: { x: 0, y: 0, w: 100, h: 60 } },
      { id: "target", kind: "holding", network: "base", rect: { x: 0, y: 200, w: 100, h: 60 } },
    ],
    ports: [
      {
        id: "source:out",
        nodeId: "source",
        direction: "out",
        class: "principal",
        network: "base",
        originId: null,
        side: "bottom",
        offset: 0.5,
      },
      {
        id: "target:in",
        nodeId: "target",
        direction: "in",
        class: "principal",
        network: "base",
        originId: null,
        side: "top",
        offset: 0.5,
      },
    ],
    junctions: [],
    segments: [],
    connections: [
      {
        id: "principal",
        class: "principal",
        originId: null,
        sourcePortId: "source:out",
        targetPortId: "target:in",
        segmentIds: [],
      },
    ],
  },
  paths: [
    {
      id: "principal",
      tone: "muted",
      points: [
        { x: 50, y: 60 },
        { x: 50, y: 200 },
      ],
    },
  ],
  surfaces: new Map([
    ["source", <span key="source">Source title</span>],
    ["target", <span key="target">Target title</span>],
  ]),
};

function RegisteredGraph() {
  useFinancialGraphPresentation(presentation);
  return null;
}

function EngineHarness({
  initialScale,
  fitOnResize = false,
  onClear = () => {},
}: {
  initialScale?: number;
  fitOnResize?: boolean;
  onClear?(): void;
}) {
  const [selected, setSelected] = useState(true);
  return (
    <ReactFlowGraph
      graphSize={GRAPH_SIZE}
      initialScale={initialScale}
      fitOnResize={fitOnResize}
      onBackgroundClick={() => {
        onClear();
        setSelected(false);
      }}
      chrome={(controls) => (
        <>
          <output aria-label="Selection">{selected ? "Source selected" : "No selection"}</output>
          <output aria-label="Zoom">{controls.readoutPct}%</output>
        </>
      )}
    >
      <RegisteredGraph />
    </ReactFlowGraph>
  );
}

function box(width: number, height: number): DOMRect {
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

describe("POO-2302 real engine viewport regressions", () => {
  let canvasSize: Size;
  let observations: { callback: ResizeObserverCallback; targets: Set<Element> }[];

  beforeEach(() => {
    canvasSize = { width: 656, height: 640 };
    observations = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets = new Set<Element>();
        constructor(callback: ResizeObserverCallback) {
          observations.push({ callback, targets: this.targets });
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
        }
      },
    );
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        m22 = 1;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return Number.parseFloat(this.style.width) || canvasSize.width;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return Number.parseFloat(this.style.height || this.style.minHeight) || canvasSize.height;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return box(this.offsetWidth, this.offsetHeight);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function viewport(): HTMLElement {
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) throw new Error("missing real engine viewport");
    return viewport;
  }

  async function connection(): Promise<SVGElement> {
    let hit: SVGElement | null = null;
    await waitFor(() => {
      hit = document.querySelector<SVGElement>("[data-edge-hit='principal']");
      expect(hit).not.toBeNull();
    });
    if (!hit) throw new Error("missing real engine connection");
    return hit;
  }

  function measureCanvas(next: Size) {
    canvasSize = next;
    const canvas = document.querySelector("[data-canvas-viewport]");
    if (!canvas) throw new Error("missing canvas");
    act(() => {
      for (const observation of observations) {
        if (observation.targets.has(canvas)) observation.callback([], {} as ResizeObserver);
      }
    });
  }

  function mouse(target: Element | Window, type: string, init: MouseEventInit = {}) {
    // Vitest's Window proxy is rejected by jsdom 29's UIEventInit conversion. d3 still needs
    // event.view for its window capture listeners, so assign it after constructing the event.
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, "view", { value: window });
    fireEvent(target, event);
  }

  // @rule POO-2302 R4 / I5: a financial connection remains clickable background.
  it("clears selection once when clicking a real financial connection", async () => {
    const clear = vi.fn();
    render(<EngineHarness onClear={clear} />);
    const hit = await connection();
    mouse(hit, "mousedown", { button: 0, clientX: 50, clientY: 100 });
    mouse(window, "mouseup", { button: 0, clientX: 50, clientY: 100 });
    fireEvent.click(hit);
    expect(screen.getByLabelText("Selection")).toHaveTextContent("No selection");
    expect(clear).toHaveBeenCalledTimes(1);
  });

  // @rule POO-2302 R4 / I5/I8: dragging a connection pans without clearing selection.
  it("preserves selection after dragging a real financial connection beyond 4 px", async () => {
    const clear = vi.fn();
    render(<EngineHarness onClear={clear} />);
    const hit = await connection();
    const before = viewport().style.transform;
    mouse(hit, "mousedown", { button: 0, clientX: 50, clientY: 100 });
    mouse(window, "mousemove", { buttons: 1, clientX: 70, clientY: 110 });
    mouse(window, "mouseup", { button: 0, clientX: 70, clientY: 110 });
    // d3 suppresses the browser click following a pan. Exercise that capture listener too.
    fireEvent.click(hit);
    expect(viewport().style.transform).not.toBe(before);
    expect(screen.getByLabelText("Selection")).toHaveTextContent("Source selected");
    expect(clear).not.toHaveBeenCalled();
  });

  // @rule POO-2302 R4 / POO-2226 R4: Manage retains its native 100% opening geometry.
  it("opens a graph wider than the measured canvas at its start and title at 100%", async () => {
    render(<EngineHarness initialScale={1} />);
    await connection();
    await waitFor(() => expect(viewport().style.transform).toBe("translate(0px,0px) scale(1)"));
    expect(screen.getByText("Source title")).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom")).toHaveTextContent("100%");
  });

  // @rule POO-2302 R4 / I8: an unmeasured canvas does not consume the opening placement.
  it("waits for positive canvas dimensions before centering a 100% opening", async () => {
    canvasSize = { width: 0, height: 0 };
    render(<EngineHarness initialScale={1} />);
    await connection();
    measureCanvas({ width: 1600, height: 640 });
    await waitFor(() => expect(viewport().style.transform).toBe("translate(200px,0px) scale(1)"));
    expect(screen.getByLabelText("Zoom")).toHaveTextContent("100%");
  });

  // @rule POO-2302 R4 / I8: fit requires a measured canvas even without resize refitting.
  it.each([
    false,
    true,
  ])("waits for the first positive measurement before fitting (fitOnResize=%s)", async (fitOnResize) => {
    canvasSize = { width: 0, height: 0 };
    render(<EngineHarness fitOnResize={fitOnResize} />);
    await connection();
    expect(screen.getByLabelText("Zoom")).toHaveTextContent("100%");
    measureCanvas({ width: 656, height: 640 });
    const fit = computeFit(canvasSize, GRAPH_SIZE, fitOnResize);
    await waitFor(() =>
      expect(viewport().style.transform).toBe(
        `translate(${fit.x}px,${fit.y}px) scale(${fit.scale})`,
      ),
    );
    expect(screen.getByLabelText("Zoom")).toHaveTextContent("53%");
  });
});
