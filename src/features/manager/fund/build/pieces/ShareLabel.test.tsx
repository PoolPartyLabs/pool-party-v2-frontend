/**
 * @id PP-MGR-CMP-051
 * @name ShareLabel tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The share label on a chain's or a spoke's stub (handoff v1.2 [BB4], [C8], [C19], [I5], [I10]):
 * default, highlighted (its edge or itself is hovered) and 0% (an empty block). A button when it has
 * an action (a hub chain's label selects the block it feeds), named by its tooltip.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, isCanvasBackground } from "../canvas/useCanvasViewport";
import { ShareLabel } from "./ShareLabel";

const TIP = "60% of the strategy's capital";

function strokeOf(element: Element): Element {
  const stroke = element.querySelector("[data-piece-stroke]");
  if (!stroke) throw new Error("no stroke");
  return stroke;
}

describe("ShareLabel", () => {
  // @rule BB4
  it("[BB4] height 20, padding 1 x 7 inside a 1 px border, radius full, on background", () => {
    render(<ShareLabel text="60%" tooltip={TIP} highlighted={false} onActivate={() => {}} />);

    const label = screen.getByRole("button", { name: TIP });
    for (const token of ["h-5", "px-2", "rounded-full", "bg-background", "relative"]) {
      expect(label.className).toContain(token);
    }
    const stroke = strokeOf(label);
    expect(stroke).toHaveAttribute("data-stroke-width", "1");
    expect(stroke).toHaveAttribute("data-stroke-dash", "solid");
    expect(stroke.getAttribute("class")).toContain("text-border");
  });

  // @rule BB4
  it("[BB4] the text is Numeric/Label in foreground, tabular, on one line", () => {
    render(<ShareLabel text="60%" tooltip={TIP} highlighted={false} onActivate={() => {}} />);

    const text = screen.getByText("60%");
    for (const token of [
      "text-[13px]",
      "font-semibold",
      "tabular-nums",
      "text-foreground",
      "whitespace-nowrap",
    ]) {
      expect(text.className).toContain(token);
    }
  });

  // @rule BB4
  it("[BB4] highlighted: 1.5 px primary border and primary text, the same box", () => {
    const { rerender } = render(
      <ShareLabel text="60%" tooltip={TIP} highlighted={false} onActivate={() => {}} />,
    );
    const resting = screen.getByRole("button", { name: TIP }).className;

    rerender(<ShareLabel text="60%" tooltip={TIP} highlighted onActivate={() => {}} />);

    const label = screen.getByRole("button", { name: TIP });
    expect(label.className).toBe(resting);
    const stroke = strokeOf(label);
    expect(stroke).toHaveAttribute("data-stroke-width", "1.5");
    expect(stroke.getAttribute("class")).toContain("text-primary");
    expect(screen.getByText("60%").className).toContain("text-primary");
    expect(label).toHaveAttribute("data-highlighted", "");
  });

  // @rule BB4
  it("[BB4, C8] an empty block shows 0%", () => {
    render(
      <ShareLabel
        text="0%"
        tooltip="0% of the strategy's capital"
        highlighted={false}
        onActivate={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "0% of the strategy's capital" })).toHaveTextContent(
      "0%",
    );
  });

  // @rule I5
  it("[I5] with an action it is a button: a click hands the label element as the anchor", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<ShareLabel text="60%" tooltip={TIP} highlighted={false} onActivate={onActivate} />);

    const label = screen.getByRole("button", { name: TIP });
    await user.click(label);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(label);
  });

  // @rule I10
  it("[I10] keyboard: in the tab order, named by its tooltip, Enter activates", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<ShareLabel text="60%" tooltip={TIP} highlighted={false} onActivate={onActivate} />);

    await user.tab();
    const label = screen.getByRole("button", { name: TIP });
    expect(label).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onActivate).toHaveBeenCalledTimes(1);
    for (const token of ["focus-visible:ring-2", "focus-visible:ring-ring"]) {
      expect(label.className).toContain(token);
    }
  });

  // @rule BB4
  it("[BB4, D26] without an action it is no button, and still reads the whole sentence", () => {
    render(<ShareLabel text="35%" tooltip="35% of the strategy's capital" highlighted={false} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("35% of the strategy's capital").className).toContain("sr-only");
    expect(screen.getByText("35%").closest("[aria-hidden='true']")).not.toBeNull();
    // The stroke clips to the label's radius through `rounded-[inherit]` on every wrapper.
    const stroke = document.querySelector("[data-piece-stroke]");
    expect(stroke?.parentElement?.className).toContain("rounded-[inherit]");
  });

  // @rule C19
  it("[C19, BB10] the tooltip opens on focus: side top, offset 4, one line", async () => {
    const user = userEvent.setup();
    render(<ShareLabel text="60%" tooltip={TIP} highlighted={false} onActivate={() => {}} />);

    await user.tab();

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(TIP);
    const surface = tooltip.parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "top");
    expect(surface).toHaveAttribute("data-tooltip-offset", "4");
    expect(surface.className).toContain("whitespace-nowrap");
  });

  // @rule C19
  it("[C19] the tooltip opens on hover, with or without an action", async () => {
    const user = userEvent.setup();
    render(<ShareLabel text="35%" tooltip="35% of the strategy's capital" highlighted={false} />);

    await user.hover(screen.getByText("35%"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("35% of the strategy's capital");
  });

  // @rule BB8
  it("[BB8] reports hover and keyboard focus, so the renderer can light its edge too", () => {
    const onHoverChange = vi.fn();
    render(
      <ShareLabel
        text="60%"
        tooltip={TIP}
        highlighted={false}
        onActivate={() => {}}
        onHoverChange={onHoverChange}
      />,
    );
    const label = screen.getByRole("button", { name: TIP });

    fireEvent.pointerEnter(label);
    fireEvent.pointerLeave(label);
    fireEvent.focus(label);
    fireEvent.blur(label);

    expect(onHoverChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  // @rule Interactive elements
  it("[Interactive elements] carries data-canvas-interactive, with or without an action", () => {
    const { container } = render(
      <div data-canvas-layer="">
        <ShareLabel text="60%" tooltip={TIP} highlighted={false} onActivate={() => {}} />
        <ShareLabel text="35%" tooltip="35% of the strategy's capital" highlighted={false} />
      </div>,
    );

    expect(screen.getByRole("button", { name: TIP })).toHaveAttribute(CANVAS_INTERACTIVE_ATTR, "");
    expect(isCanvasBackground(screen.getByText("60%"), container)).toBe(false);
    expect(isCanvasBackground(screen.getByText("35%"), container)).toBe(false);
  });

  // @rule Presentational
  it("[Presentational] renders no string of its own", () => {
    const { container } = render(
      <ShareLabel text="P1" tooltip="T1" highlighted={false} onActivate={() => {}} />,
    );

    expect(container.textContent).toBe("P1");
  });
});
