/**
 * @id PP-MGR-CMP-050
 * @name FlowPill tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The flow pill of the Build canvas (handoff v1.2 [BB3], [C7], [C19], [BB10]): Swap · auto, Swap,
 * Collect fees and Bridge · auto. Every pill has the same 176 x 26 shape, a plain 12 px icon (no
 * disc) and one line of text; its tooltip opens on hover and on focus.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, isCanvasBackground } from "../canvas/useCanvasViewport";
import { FlowPill } from "./FlowPill";
import type { FlowContent } from "./pieceTypes";

const SWAP_AUTO: FlowContent = {
  text: "Swap · auto",
  tooltip: "The app swaps USDC into the pool tokens",
  icon: "swap",
};
const COLLECT_FEES: FlowContent = {
  text: "Collect fees",
  tooltip: "Claims the pool fees into Income (fees)",
  icon: "coins",
};

const PILLS: ReadonlyArray<[string, FlowContent]> = [
  ["Swap · auto", SWAP_AUTO],
  ["Swap", { text: "Swap", tooltip: "Swaps into another token of your mandate", icon: "swap" }],
  ["Collect fees", COLLECT_FEES],
  [
    "Bridge · auto",
    { text: "Bridge · auto", tooltip: "Moves USDG to Robinhood Chain", icon: "bridge" },
  ],
];

describe("FlowPill", () => {
  // @rule BB3
  it("[BB3] is 176 x 26, radius full, surface, 1 px border, padding 0 x 10, gap 6", () => {
    render(<FlowPill content={SWAP_AUTO} />);

    const pill = screen.getByRole("button", { name: "Swap · auto" });
    for (const token of [
      "w-[176px]",
      "h-[26px]",
      "rounded-full",
      "bg-surface",
      "border",
      "border-border",
      "px-2.5",
      "gap-1.5",
    ]) {
      expect(pill.className).toContain(token);
    }
    expect(pill.className).not.toMatch(/(^|\s)py-/);
  });

  // @rule BB3
  it("[BB3, C7] a plain 12 px muted icon, straight on the pill: no disc, no icon box", () => {
    render(<FlowPill content={SWAP_AUTO} />);

    const pill = screen.getByRole("button", { name: "Swap · auto" });
    const icon = pill.querySelector("[data-block-icon]");
    expect(icon?.parentElement).toBe(pill);
    expect(icon).toHaveAttribute("width", "12");
    expect(icon?.getAttribute("class")).toContain("text-muted-foreground");
    expect(pill.querySelector(".bg-surface-raised")).toBeNull();
  });

  // @rule BB3
  it("[BB3, BB10] one line of Caption/Default in muted, never wrapping", () => {
    render(<FlowPill content={SWAP_AUTO} />);

    const text = screen.getByText("Swap · auto");
    for (const token of [
      "text-xs",
      "leading-normal",
      "text-muted-foreground",
      "whitespace-nowrap",
      "truncate",
    ]) {
      expect(text.className).toContain(token);
    }
    expect(screen.getByRole("button", { name: "Swap · auto" }).className).toContain(
      "whitespace-nowrap",
    );
  });

  for (const [label, content] of PILLS) {
    // @rule BB3
    it(`[BB3] ${label}: its text and the ${content.icon} icon`, () => {
      render(<FlowPill content={content} />);

      const pill = screen.getByRole("button", { name: content.text });
      expect(pill.querySelector("[data-block-icon]")).toHaveAttribute(
        "data-block-icon",
        content.icon,
      );
    });
  }

  // @rule C19
  it("[C19, BB10] the tooltip opens on focus: side top, offset 4, one line", async () => {
    const user = userEvent.setup();
    render(<FlowPill content={SWAP_AUTO} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Swap · auto" })).toHaveFocus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("The app swaps USDC into the pool tokens");
    const surface = tooltip.parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "top");
    expect(surface).toHaveAttribute("data-tooltip-offset", "4");
    expect(surface.className).toContain("whitespace-nowrap");
  });

  // @rule C19
  it("[C19] the tooltip opens on hover", async () => {
    const user = userEvent.setup();
    render(<FlowPill content={COLLECT_FEES} />);

    await user.hover(screen.getByRole("button", { name: "Collect fees" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Claims the pool fees into Income (fees)",
    );
  });

  // @rule I5
  it("[I5] not selectable in this batch: no pressed state", () => {
    render(<FlowPill content={SWAP_AUTO} />);

    expect(screen.getByRole("button", { name: "Swap · auto" })).not.toHaveAttribute("aria-pressed");
  });

  // @rule Interactive elements
  it("[Interactive elements] carries data-canvas-interactive: a press on it never pans", () => {
    const { container } = render(
      <div data-canvas-layer="">
        <FlowPill content={SWAP_AUTO} />
      </div>,
    );

    expect(screen.getByRole("button", { name: "Swap · auto" })).toHaveAttribute(
      CANVAS_INTERACTIVE_ATTR,
      "",
    );
    expect(isCanvasBackground(screen.getByText("Swap · auto"), container)).toBe(false);
  });

  // @rule Presentational
  it("[Presentational] renders no string of its own", () => {
    const { container } = render(
      <FlowPill content={{ text: "P1", tooltip: "T1", icon: "swap" }} />,
    );

    expect(container.textContent).toBe("P1");
  });
});
