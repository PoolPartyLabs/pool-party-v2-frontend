/**
 * @id PP-MGR-CMP-049
 * @name pieceParts tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, presentational helpers; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The three helpers every canvas piece shares: the stroke drawn inside a piece ([A3]: it takes no
 * layout space, so a card is 176 x 62 in every state), the icon set (`BlockIcon`), and the one-line
 * tooltip ([BB10]).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, CANVAS_LAYER_ATTR } from "../canvas/useCanvasViewport";
import { BlockIconGlyph, canvasInteractive, PieceStroke, PieceTooltip } from "./pieceParts";
import type { BlockIcon } from "./pieceTypes";

describe("PieceStroke", () => {
  // @rule A3
  it("[A3] is an overlay: absolute, inset 0, no pointer events, clipped to the piece's radius", () => {
    const { container } = render(<PieceStroke width={1} radius={20} />);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    for (const token of [
      "absolute",
      "inset-0",
      "size-full",
      "pointer-events-none",
      "overflow-hidden",
      "rounded-[inherit]",
    ]) {
      expect(svg?.getAttribute("class")).toContain(token);
    }
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  // @rule A3
  it("[A3] draws the stroke inside: twice the width on the edge, the outer half clipped away", () => {
    const { container } = render(<PieceStroke width={1.5} radius={20} />);

    const svg = container.querySelector("svg");
    const rect = container.querySelector("rect");
    expect(svg).toHaveAttribute("data-stroke-width", "1.5");
    expect(rect).toHaveAttribute("stroke-width", "3");
    expect(rect).toHaveAttribute("width", "100%");
    expect(rect).toHaveAttribute("height", "100%");
    expect(rect).toHaveAttribute("rx", "20");
    expect(rect).toHaveAttribute("ry", "20");
    expect(rect).toHaveAttribute("fill", "none");
    expect(rect).toHaveAttribute("stroke", "currentColor");
  });

  // @rule BB1
  it("[BB1] a dashed stroke carries its exact dash pattern; a solid one carries none", () => {
    const { container, rerender } = render(<PieceStroke width={1.5} radius={20} dash="6 6" />);
    expect(container.querySelector("rect")).toHaveAttribute("stroke-dasharray", "6 6");
    expect(container.querySelector("svg")).toHaveAttribute("data-stroke-dash", "6 6");

    rerender(<PieceStroke width={1} radius={20} />);
    expect(container.querySelector("rect")).not.toHaveAttribute("stroke-dasharray");
    expect(container.querySelector("svg")).toHaveAttribute("data-stroke-dash", "solid");
  });

  // @rule BB1
  it("[BB1] takes its colour from a token class (currentColor), never a literal", () => {
    const { container } = render(<PieceStroke width={1} radius={20} className="text-primary" />);

    expect(container.querySelector("svg")?.getAttribute("class")).toContain("text-primary");
  });
});

describe("BlockIconGlyph", () => {
  const cases: ReadonlyArray<[BlockIcon, string]> = [
    ["layers", "lucide-layers"],
    ["bank", "lucide-landmark"],
    ["swap", "lucide-arrow-left-right"],
    ["coins", "lucide-coins"],
    ["bridge", "lucide-route"],
    ["depositIn", "lucide-download"],
    ["withdrawOut", "lucide-upload"],
    ["hourglass", "lucide-hourglass"],
  ];

  for (const [icon, lucideClass] of cases) {
    // @rule BB1
    it(`[BB1] draws "${icon}" as the Figma icon (${lucideClass}), decorative`, () => {
      const { container } = render(<BlockIconGlyph icon={icon} size={16} />);

      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain(lucideClass);
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("data-block-icon", icon);
      expect(svg).toHaveAttribute("width", "16");
    });
  }
});

describe("PieceTooltip", () => {
  // @rule BB10
  it("[BB10] opens on focus, side top, offset 4 by default, on one line", async () => {
    const user = userEvent.setup();
    render(
      <PieceTooltip content="Fixed: USDC on Arbitrum">
        <button type="button">lock</button>
      </PieceTooltip>,
    );

    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Fixed: USDC on Arbitrum");
    const surface = tooltip.parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "top");
    expect(surface).toHaveAttribute("data-tooltip-offset", "4");
    expect(surface.className).toContain("whitespace-nowrap");
    expect(surface.className).toContain("max-w-none");
    expect(surface.className).not.toContain("max-w-xs");
  });

  // @rule BB10
  it("[BB10] takes another side and offset (the templates: bottom, 8)", async () => {
    const user = userEvent.setup();
    render(
      <PieceTooltip content="Add network" side="bottom" sideOffset={8}>
        <button type="button">box</button>
      </PieceTooltip>,
    );

    await user.tab();
    const surface = (await screen.findByRole("tooltip")).parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "bottom");
    expect(surface).toHaveAttribute("data-tooltip-offset", "8");
  });
});

describe("canvasInteractive", () => {
  // @rule Interactive elements
  it("[Interactive elements] marks an element so the viewport never pans through it", () => {
    render(<div data-testid="piece" {...canvasInteractive} />);

    expect(screen.getByTestId("piece")).toHaveAttribute(CANVAS_INTERACTIVE_ATTR, "");
    expect(CANVAS_LAYER_ATTR).toBe("data-canvas-layer");
  });
});
