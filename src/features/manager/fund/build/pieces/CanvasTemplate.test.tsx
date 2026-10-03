/**
 * @id PP-MGR-CMP-055
 * @name CanvasTemplate tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, presentational pieces; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The two templates of the Build canvas (handoff v1.2 [BB6], [C15], [BB10], [I1], [I2], [I10]): the
 * Add protocol circle and the Add network box, default and active. Two shapes, never the same; both
 * buttons named by their tooltip, which opens below them (side bottom, offset 8).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, isCanvasBackground } from "../canvas/useCanvasViewport";
import { AddNetworkTemplate, AddProtocolTemplate } from "./CanvasTemplate";

const PROTOCOL = "Add protocol on Arbitrum";
const NETWORK = "Add network";

function strokeOf(element: Element): Element {
  const stroke = element.querySelector(":scope > [data-piece-stroke]");
  if (!stroke) throw new Error("no stroke");
  return stroke;
}

describe("AddProtocolTemplate", () => {
  // @rule BB6
  it("[BB6] a 40 px circle, no fill, 1.5 px dashed 5 5 in muted-foreground, plus 16", () => {
    render(<AddProtocolTemplate tooltip={PROTOCOL} active={false} onActivate={() => {}} />);

    const circle = screen.getByRole("button", { name: PROTOCOL });
    for (const token of ["size-10", "rounded-full", "bg-transparent", "relative"]) {
      expect(circle.className).toContain(token);
    }
    expect(circle.className).not.toMatch(/(^|\s)bg-(surface|background)/);
    const stroke = strokeOf(circle);
    expect(stroke).toHaveAttribute("data-stroke-width", "1.5");
    expect(stroke).toHaveAttribute("data-stroke-dash", "5 5");
    expect(stroke.getAttribute("class")).toContain("text-muted-foreground");
    const plus = circle.querySelector("svg.lucide-plus");
    expect(plus).toHaveAttribute("width", "16");
    expect(plus?.getAttribute("class")).toContain("text-muted-foreground");
  });

  // @rule BB6
  it("[BB6] active (menu open or valid drop target): stroke and plus in primary", () => {
    render(<AddProtocolTemplate tooltip={PROTOCOL} active onActivate={() => {}} />);

    const circle = screen.getByRole("button", { name: PROTOCOL });
    const stroke = strokeOf(circle);
    expect(stroke).toHaveAttribute("data-stroke-width", "1.5");
    expect(stroke.getAttribute("class")).toContain("text-primary");
    expect(circle.querySelector("svg.lucide-plus")?.getAttribute("class")).toContain(
      "text-primary",
    );
  });

  // @rule I1
  it("[I1] a press opens the protocol menu with the circle as its anchor", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<AddProtocolTemplate tooltip={PROTOCOL} active={false} onActivate={onActivate} />);

    const circle = screen.getByRole("button", { name: PROTOCOL });
    await user.click(circle);

    expect(onActivate).toHaveBeenCalledWith(circle);
    expect(circle).toHaveAttribute("aria-haspopup", "menu");
  });

  // @rule BB10
  it("[BB10, C19] the tooltip opens on focus below the circle: side bottom, offset 8", async () => {
    const user = userEvent.setup();
    render(<AddProtocolTemplate tooltip={PROTOCOL} active={false} onActivate={() => {}} />);

    await user.tab();

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(PROTOCOL);
    const surface = tooltip.parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "bottom");
    expect(surface).toHaveAttribute("data-tooltip-offset", "8");
    expect(surface.className).toContain("whitespace-nowrap");
  });
});

describe("AddNetworkTemplate", () => {
  // @rule BB6
  it("[BB6] a 64 x 72 box, radius 16, surface-raised, 1 px dashed 5 5 in border, plus 16", () => {
    render(<AddNetworkTemplate tooltip={NETWORK} active={false} onActivate={() => {}} />);

    const box = screen.getByRole("button", { name: NETWORK });
    for (const token of ["w-16", "h-[72px]", "rounded-lg", "bg-surface-raised", "relative"]) {
      expect(box.className).toContain(token);
    }
    const stroke = strokeOf(box);
    expect(stroke).toHaveAttribute("data-stroke-width", "1");
    expect(stroke).toHaveAttribute("data-stroke-dash", "5 5");
    expect(stroke.getAttribute("class")).toContain("text-border");
    const plus = box.querySelector("svg.lucide-plus");
    expect(plus).toHaveAttribute("width", "16");
    expect(plus?.getAttribute("class")).toContain("text-muted-foreground");
  });

  // @rule BB6
  it("[BB6] active: 1.5 px primary stroke, plus in primary, same box", () => {
    const { rerender } = render(
      <AddNetworkTemplate tooltip={NETWORK} active={false} onActivate={() => {}} />,
    );
    const resting = screen.getByRole("button", { name: NETWORK }).className;

    rerender(<AddNetworkTemplate tooltip={NETWORK} active onActivate={() => {}} />);

    const box = screen.getByRole("button", { name: NETWORK });
    expect(box.className).toBe(resting);
    const stroke = strokeOf(box);
    expect(stroke).toHaveAttribute("data-stroke-width", "1.5");
    expect(stroke).toHaveAttribute("data-stroke-dash", "5 5");
    expect(stroke.getAttribute("class")).toContain("text-primary");
    expect(box.querySelector("svg.lucide-plus")?.getAttribute("class")).toContain("text-primary");
  });

  // @rule I2
  it("[I2] a press opens the network menu with the box as its anchor", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<AddNetworkTemplate tooltip={NETWORK} active={false} onActivate={onActivate} />);

    const box = screen.getByRole("button", { name: NETWORK });
    await user.click(box);

    expect(onActivate).toHaveBeenCalledWith(box);
    expect(box).toHaveAttribute("aria-haspopup", "menu");
  });

  // @rule BB10
  it("[BB10, C19] the tooltip opens on hover below the box: side bottom, offset 8", async () => {
    const user = userEvent.setup();
    render(<AddNetworkTemplate tooltip={NETWORK} active={false} onActivate={() => {}} />);

    await user.hover(screen.getByRole("button", { name: NETWORK }));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(NETWORK);
    expect(tooltip.parentElement).toHaveAttribute("data-side", "bottom");
    expect(tooltip.parentElement).toHaveAttribute("data-tooltip-offset", "8");
  });
});

describe("templates together", () => {
  // @rule C15
  it("[C15] two shapes, never the same: a circle with no fill and a filled rounded box", () => {
    render(
      <>
        <AddProtocolTemplate tooltip={PROTOCOL} active={false} onActivate={() => {}} />
        <AddNetworkTemplate tooltip={NETWORK} active={false} onActivate={() => {}} />
      </>,
    );

    const circle = screen.getByRole("button", { name: PROTOCOL });
    const box = screen.getByRole("button", { name: NETWORK });
    expect(circle.className).toContain("rounded-full");
    expect(box.className).not.toContain("rounded-full");
    expect(circle.className).not.toContain("bg-surface-raised");
    expect(box.className).toContain("bg-surface-raised");
  });

  // @rule I10
  it("[I10] both are in the tab order, Enter activates, with the app focus ring", async () => {
    const user = userEvent.setup();
    const onProtocol = vi.fn();
    const onNetwork = vi.fn();
    render(
      <>
        <AddProtocolTemplate tooltip={PROTOCOL} active={false} onActivate={onProtocol} />
        <AddNetworkTemplate tooltip={NETWORK} active={false} onActivate={onNetwork} />
      </>,
    );

    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    await user.keyboard("{Enter}");

    expect(onProtocol).toHaveBeenCalledTimes(1);
    expect(onNetwork).toHaveBeenCalledTimes(1);
    for (const name of [PROTOCOL, NETWORK]) {
      expect(screen.getByRole("button", { name }).className).toContain("focus-visible:ring-2");
    }
  });

  // @rule Interactive elements
  it("[Interactive elements] both carry data-canvas-interactive", () => {
    const { container } = render(
      <div data-canvas-layer="">
        <AddProtocolTemplate tooltip={PROTOCOL} active={false} onActivate={() => {}} />
        <AddNetworkTemplate tooltip={NETWORK} active={false} onActivate={() => {}} />
      </div>,
    );

    for (const name of [PROTOCOL, NETWORK]) {
      const element = screen.getByRole("button", { name });
      expect(element).toHaveAttribute(CANVAS_INTERACTIVE_ATTR, "");
      expect(isCanvasBackground(element.querySelector("svg.lucide-plus"), container)).toBe(false);
    }
  });

  // @rule Presentational
  it("[Presentational] render no string of their own", () => {
    const { container } = render(
      <>
        <AddProtocolTemplate tooltip="T1" active={false} onActivate={() => {}} />
        <AddNetworkTemplate tooltip="T2" active onActivate={() => {}} />
      </>,
    );

    expect(container.textContent).toBe("");
  });
});
