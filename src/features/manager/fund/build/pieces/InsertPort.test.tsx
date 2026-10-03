/**
 * @id PP-MGR-CMP-052
 * @name InsertPort tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The insert port on a card edge (handoff v1.2 [BB7], [C17], [I4], [I10], [C19]): a 16 px dashed
 * circle with a plus, default and active, a button named by its tooltip that opens the port menu.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, isCanvasBackground } from "../canvas/useCanvasViewport";
import { InsertPort } from "./InsertPort";

const TIP = "Insert a flow block: Swap";

describe("InsertPort", () => {
  // @rule BB7
  it("[BB7] a 16 px circle on background, 1 px dashed 3 3 in muted-foreground, plus 8", () => {
    render(<InsertPort tooltip={TIP} active={false} onActivate={() => {}} />);

    const port = screen.getByRole("button", { name: TIP });
    for (const token of ["size-4", "rounded-full", "bg-background", "relative"]) {
      expect(port.className).toContain(token);
    }
    const stroke = port.querySelector("[data-piece-stroke]");
    expect(stroke).toHaveAttribute("data-stroke-width", "1");
    expect(stroke).toHaveAttribute("data-stroke-dash", "3 3");
    expect(stroke?.getAttribute("class")).toContain("text-muted-foreground");
    const plus = port.querySelector("svg.lucide-plus");
    expect(plus).toHaveAttribute("width", "8");
    expect(plus?.getAttribute("class")).toContain("text-muted-foreground");
  });

  // @rule BB7
  it("[BB7] active: stroke and plus in primary", () => {
    render(<InsertPort tooltip={TIP} active onActivate={() => {}} />);

    const port = screen.getByRole("button", { name: TIP });
    expect(port.querySelector("[data-piece-stroke]")?.getAttribute("class")).toContain(
      "text-primary",
    );
    expect(port.querySelector("svg.lucide-plus")?.getAttribute("class")).toContain("text-primary");
    expect(port).toHaveAttribute("data-active", "");
  });

  // @rule I4
  it("[I4] a press opens its menu: the port hands itself as the anchor", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<InsertPort tooltip={TIP} active={false} onActivate={onActivate} />);

    const port = screen.getByRole("button", { name: TIP });
    await user.click(port);

    expect(onActivate).toHaveBeenCalledWith(port);
    expect(port).toHaveAttribute("aria-haspopup", "menu");
  });

  // @rule I10
  it("[I10] keyboard: in the tab order, Enter and Space activate, the app focus ring", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<InsertPort tooltip={TIP} active={false} onActivate={onActivate} />);

    await user.tab();
    const port = screen.getByRole("button", { name: TIP });
    expect(port).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(port.className).toContain("focus-visible:ring-2");
  });

  // @rule C19
  it("[C19, BB10] the tooltip opens on focus: side top, offset 4, one line", async () => {
    const user = userEvent.setup();
    render(<InsertPort tooltip={TIP} active={false} onActivate={() => {}} />);

    await user.tab();

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(TIP);
    const surface = tooltip.parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "top");
    expect(surface).toHaveAttribute("data-tooltip-offset", "4");
    expect(surface.className).toContain("whitespace-nowrap");
  });

  // @rule C19
  it("[C19] the tooltip opens on hover", async () => {
    const user = userEvent.setup();
    render(<InsertPort tooltip={TIP} active={false} onActivate={() => {}} />);

    await user.hover(screen.getByRole("button", { name: TIP }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(TIP);
  });

  // @rule Interactive elements
  it("[Interactive elements] carries data-canvas-interactive: a press on it never pans", () => {
    const { container } = render(
      <div data-canvas-layer="">
        <InsertPort tooltip={TIP} active={false} onActivate={() => {}} />
      </div>,
    );

    const port = screen.getByRole("button", { name: TIP });
    expect(port).toHaveAttribute(CANVAS_INTERACTIVE_ATTR, "");
    expect(isCanvasBackground(port.querySelector("svg.lucide-plus"), container)).toBe(false);
  });

  // @rule Presentational
  it("[Presentational] renders no string of its own", () => {
    const { container } = render(<InsertPort tooltip="T1" active={false} onActivate={() => {}} />);

    expect(container.textContent).toBe("");
  });
});
