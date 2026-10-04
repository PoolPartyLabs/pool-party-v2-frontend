/**
 * @id PP-MGR-CMP-056
 * @name BuildPalette tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a presentational palette under test
 *
 * The left column of the Build step (slice S5, POO-2155; handoff AN8, I3, ST10, D22, D25): the
 * sections in order with the caption under the lists, the coming-soon rows that cannot be dragged,
 * and the pointer drag (no library) that hands a drop to the controller with the key of the
 * `data-graph-target` under the pointer, or null anywhere else.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MandateDraft } from "../../mandateDraft";
import { makeTestDraft } from "../plan/planTestKit";
import { BuildPalette, type BuildPaletteProps } from "./BuildPalette";
import { type PaletteDragItem, paletteModel } from "./blockRegistry";
import { makeTestCopy } from "./blockTestKit";

const copy = makeTestCopy();

function props(over: Partial<BuildPaletteProps> = {}): BuildPaletteProps {
  return {
    model: paletteModel(makeTestDraft(), copy),
    onDragStart: vi.fn(),
    onDrop: vi.fn(),
    onDragCancel: vi.fn(),
    ...over,
  };
}

function row(name: string): HTMLElement {
  const element = screen
    .getAllByText(name)
    .map((node) => node.closest<HTMLElement>("[data-palette-item]"))
    .find((node) => node !== null);
  if (!element) throw new Error(`no palette row ${name}`);
  return element;
}

let elementAtPoint: Element | null = null;
const originalElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  elementAtPoint = null;
  document.elementFromPoint = vi.fn(() => elementAtPoint);
});

afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
});

describe("BuildPalette", () => {
  it("shows From your mandate, Flow blocks, the caption, then Coming soon", () => {
    // @rule AN8
    render(<BuildPalette {...props()} />);
    const text = screen.getByTestId("build-palette").textContent ?? "";
    const order = [
      "From your mandate",
      "Uniswap v4",
      "Flow blocks",
      "Collect fees",
      "Drag a block onto the canvas.",
      "Coming soon",
      "GMX",
    ].map((part) => text.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("names each list by its section label", () => {
    // @rule AN8
    render(<BuildPalette {...props()} />);
    expect(screen.getByRole("list", { name: "From your mandate" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Flow blocks" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Coming soon" })).toBeInTheDocument();
  });

  it("prints protocol name over block type on the mandate cards, with a grip", () => {
    // @rule AN8
    render(<BuildPalette {...props()} />);
    const supply = row("Supply");
    expect(within(supply).getByText("Aave v3")).toBeInTheDocument();
    expect(supply.querySelector("[data-palette-grip]")).not.toBeNull();
  });

  it("shows coming-soon rows with the Soon tag, no grip, and the Coming soon tooltip as their description", () => {
    // @rule AN8
    // @rule C22
    render(<BuildPalette {...props()} />);
    const pendle = row("Pendle");
    expect(within(pendle).getByText("Soon")).toBeInTheDocument();
    expect(pendle.querySelector("[data-palette-grip]")).toBeNull();
    expect(pendle).toHaveAttribute("data-draggable", "false");
    const focusable = pendle.querySelector("[tabindex='0']");
    expect(focusable).toHaveAccessibleDescription("Coming soon");
  });

  it("has no buttons: a drag is a pointer gesture and the menus are the keyboard path", () => {
    // @rule I10
    // @rule D22
    render(<BuildPalette {...props()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("scrolls inside its column when taller than 640", () => {
    // @rule D25
    render(<BuildPalette {...props()} />);
    expect(screen.getByTestId("build-palette").className).toContain("max-h-[640px]");
    expect(screen.getByTestId("build-palette").className).toContain("overflow-y-auto");
  });

  it("starts a drag only after the pointer moves more than 4 px", () => {
    // @rule I3
    const p = props();
    render(<BuildPalette {...p} />);
    const pool = row("Uniswap v4");
    fireEvent.pointerDown(pool, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 13, clientY: 10 });
    expect(p.onDragStart).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 13, clientY: 10 });
    expect(p.onDrop).not.toHaveBeenCalled();
    fireEvent.pointerDown(pool, { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 30, clientY: 10 });
    const item: PaletteDragItem = { family: "position", kind: "uniswapV4Pool" };
    expect(p.onDragStart).toHaveBeenCalledWith(item);
  });

  it("drops on the graph target under the pointer, by its key", () => {
    // @rule I3
    const p = props();
    render(
      <>
        <BuildPalette {...p} />
        <div data-graph-target="addProtocol:arbitrum">
          <span data-testid="inside-target" />
        </div>
      </>,
    );
    elementAtPoint = screen.getByTestId("inside-target");
    const swap = row("Swap");
    fireEvent.pointerDown(swap, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(document.elementFromPoint).toHaveBeenCalledWith(400, 300);
    expect(p.onDrop).toHaveBeenCalledWith({ family: "flow", kind: "swap" }, "addProtocol:arbitrum");
  });

  it("drops with no key anywhere else", () => {
    // @rule I3
    const p = props();
    render(<BuildPalette {...p} />);
    elementAtPoint = document.body;
    const pool = row("Uniswap v4");
    fireEvent.pointerDown(pool, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(p.onDrop).toHaveBeenCalledWith({ family: "position", kind: "uniswapV4Pool" }, null);
  });

  it("never drags a coming-soon row", () => {
    // @rule AN8
    // @rule C22
    const p = props();
    render(<BuildPalette {...p} />);
    const gmx = row("GMX");
    fireEvent.pointerDown(gmx, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(p.onDragStart).not.toHaveBeenCalled();
    expect(p.onDrop).not.toHaveBeenCalled();
  });

  it("draws the dragged card at 80% under the pointer while dragging", () => {
    // @rule ST10
    // @rule I3
    render(<BuildPalette {...props()} />);
    const pool = row("Supply");
    fireEvent.pointerDown(pool, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 120 });
    const preview = document.querySelector<HTMLElement>("[data-palette-preview]");
    expect(preview).not.toBeNull();
    expect(preview?.style.opacity).toBe("0.8");
    expect(preview?.style.left).toBe("200px");
    expect(preview).toHaveAttribute("aria-hidden", "true");
  });

  it("cancels a drag on Escape and on a cancelled pointer", () => {
    // @rule I3
    const p = props();
    render(<BuildPalette {...p} />);
    const pool = row("Uniswap v4");
    fireEvent.pointerDown(pool, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 10 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onDragCancel).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 10 });
    expect(p.onDrop).not.toHaveBeenCalled();

    fireEvent.pointerDown(pool, { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 60, clientY: 10 });
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(p.onDragCancel).toHaveBeenCalledTimes(2);
  });

  it("lists only what the mandate holds: no Aave, no Collect fees without Uniswap v4", () => {
    // @rule D25
    const draft: MandateDraft = {
      ...makeTestDraft(),
      protocols: ["uniswap-v3-swap", "across", "aave-v3"],
    };
    render(<BuildPalette {...props({ model: paletteModel(draft, copy) })} />);
    expect(screen.queryByText("Collect fees")).not.toBeInTheDocument();
    expect(screen.queryByText("Liquidity position")).not.toBeInTheDocument();
    expect(screen.getAllByText("Aave v3")).toHaveLength(2);
  });
});
