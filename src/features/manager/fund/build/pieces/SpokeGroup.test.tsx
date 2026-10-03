/**
 * @id PP-MGR-CMP-053
 * @name SpokeGroup tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The dashed group of a spoke network and its network chip (handoff v1.2 [BB5], [C3], [C19], [I7],
 * default D5): with and without the close control, and invalid. The box is canvas background; the
 * chip is interactive.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, isCanvasBackground } from "../canvas/useCanvasViewport";
import { SpokeGroup, type SpokeGroupProps } from "./SpokeGroup";

const LOGO = <span data-testid="network-logo" />;

function props(overrides: Partial<SpokeGroupProps> = {}): SpokeGroupProps {
  return {
    width: 488,
    height: 292,
    networkName: "Robinhood Chain",
    networkLogo: LOGO,
    chipTooltip: "Robinhood Chain",
    ...overrides,
  };
}

function groupBox(): HTMLElement {
  const box = document.querySelector<HTMLElement>("[data-spoke-group]");
  if (!box) throw new Error("no group");
  return box;
}

function chip(): HTMLElement {
  const element = screen.getByText("Robinhood Chain").closest<HTMLElement>("[data-network-chip]");
  if (!element) throw new Error("no chip");
  return element;
}

describe("SpokeGroup", () => {
  // @rule BB5
  it("[BB5] the box: the size it is given, radius 16, surface-raised, 1 px dashed 5 5 in border", () => {
    render(<SpokeGroup {...props()} />);

    const box = groupBox();
    expect(box.style.width).toBe("488px");
    expect(box.style.height).toBe("292px");
    for (const token of ["relative", "rounded-lg", "bg-surface-raised"]) {
      expect(box.className).toContain(token);
    }
    const stroke = box.querySelector(":scope > [data-piece-stroke]");
    expect(stroke).toHaveAttribute("data-stroke-width", "1");
    expect(stroke).toHaveAttribute("data-stroke-dash", "5 5");
    expect(stroke?.getAttribute("class")).toContain("text-border");
  });

  // @rule BB5
  it("[BB5] the chip: 21 high, padding 2 / 6 / 8, gap 6, radius full, on background", () => {
    render(<SpokeGroup {...props()} />);

    const element = chip();
    for (const token of [
      "h-[21px]",
      "py-0.5",
      "pl-1.5",
      "pr-2",
      "gap-1.5",
      "rounded-full",
      "bg-background",
    ]) {
      expect(element.className).toContain(token);
    }
  });

  // @rule BB5
  it("[BB5] the chip sits 12 px from the left border, centred on the top border", () => {
    render(<SpokeGroup {...props()} />);

    const element = chip();
    for (const token of ["absolute", "left-3", "top-0", "-translate-y-1/2"]) {
      expect(element.className).toContain(token);
    }
    expect(element.parentElement).toBe(groupBox());
  });

  // @rule BB5
  it("[BB5] a 12 px logo, then the name in capitals by CSS, Label/Small in muted", () => {
    render(<SpokeGroup {...props()} />);

    const logo = screen.getByTestId("network-logo");
    const logoBox = logo.parentElement as HTMLElement;
    expect(logoBox.className).toContain("size-3");
    expect(logoBox).toHaveAttribute("aria-hidden", "true");
    const name = screen.getByText("Robinhood Chain");
    expect(name.textContent).toBe("Robinhood Chain");
    for (const token of ["uppercase", "text-[11px]", "font-medium", "text-muted-foreground"]) {
      expect(name.className).toContain(token);
    }
    expect(logoBox.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // @rule BB5
  it("[BB5, C19] the chip names its network: a tooltip on hover (top, 4) and the title attribute", async () => {
    const user = userEvent.setup();
    render(<SpokeGroup {...props()} />);

    expect(chip()).toHaveAttribute("title", "Robinhood Chain");
    await user.hover(chip());

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Robinhood Chain");
    const surface = tooltip.parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "top");
    expect(surface).toHaveAttribute("data-tooltip-offset", "4");
    expect(surface.className).toContain("whitespace-nowrap");
  });

  // @rule I7
  it("[I7, D5] without a close control the chip holds no button", () => {
    render(<SpokeGroup {...props()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // @rule I7
  it("[I7, D5] with a close control: a button on the chip, named, that removes the spoke", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<SpokeGroup {...props({ onRemove, removeLabel: "Remove Robinhood Chain" })} />);

    const close = screen.getByRole("button", { name: "Remove Robinhood Chain" });
    expect(chip()).toContainElement(close);
    await user.click(close);

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  // @rule I7
  it("[I7, I10] the close control is reachable by keyboard, with the app focus ring", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<SpokeGroup {...props({ onRemove, removeLabel: "Remove Robinhood Chain" })} />);

    await user.tab();
    const close = screen.getByRole("button", { name: "Remove Robinhood Chain" });
    expect(close).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(close.className).toContain("focus-visible:ring-2");
    expect(close.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  // @rule I7
  it("[I7] a close control needs its name: without removeLabel none is drawn", () => {
    render(<SpokeGroup {...props({ onRemove: () => {} })} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // @rule D6
  it("[D6] invalid (the network left the mandate): the dashes and the name in destructive", () => {
    render(<SpokeGroup {...props({ invalid: true })} />);

    const box = groupBox();
    expect(box).toHaveAttribute("data-invalid", "");
    expect(box.querySelector(":scope > [data-piece-stroke]")?.getAttribute("class")).toContain(
      "text-destructive",
    );
    expect(screen.getByText("Robinhood Chain").className).toContain("text-destructive");
  });

  // @rule Interactive elements
  it("[Interactive elements] the box is canvas background, the chip is interactive", () => {
    const { container } = render(
      <div data-canvas-layer="">
        <SpokeGroup {...props({ onRemove: () => {}, removeLabel: "Remove Robinhood Chain" })} />
      </div>,
    );

    expect(groupBox()).not.toHaveAttribute(CANVAS_INTERACTIVE_ATTR);
    expect(isCanvasBackground(groupBox(), container)).toBe(true);
    expect(chip()).toHaveAttribute(CANVAS_INTERACTIVE_ATTR, "");
    expect(isCanvasBackground(screen.getByText("Robinhood Chain"), container)).toBe(false);
    expect(
      isCanvasBackground(screen.getByRole("button", { name: "Remove Robinhood Chain" }), container),
    ).toBe(false);
  });

  // @rule Presentational
  it("[Presentational] renders no string of its own", () => {
    const { container } = render(
      <SpokeGroup
        {...props({ networkName: "N1", chipTooltip: "T1", onRemove: () => {}, removeLabel: "R1" })}
      />,
    );

    expect(container.textContent).toBe("N1");
  });
});
