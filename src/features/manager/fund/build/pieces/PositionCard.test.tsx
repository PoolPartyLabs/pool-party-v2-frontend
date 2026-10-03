/**
 * @id PP-MGR-CMP-049
 * @name PositionCard tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The 176 x 62 position card of the Build canvas (handoff v1.2 [BB1], [A3], defaults D11 and D27):
 * default, selected, empty (selected or not), invalid, coming soon, a long caption, hover and focus.
 * jsdom has no layout, so the geometry is asserted on the classes that produce it, and the claim
 * that matters most ([A3]: the card is 176 x 62 whatever its stroke) is asserted by comparing the
 * box classes of every state.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, isCanvasBackground } from "../canvas/useCanvasViewport";
import { PositionCard } from "./PositionCard";
import type { BlockContent, CardState } from "./pieceTypes";

const NAME = "WETH / USDC, Uniswap v4 · 0.05%, on Arbitrum, 60% of the capital";

function content(overrides: Partial<BlockContent> = {}): BlockContent {
  return {
    title: "WETH / USDC",
    caption: "Uniswap v4 · 0.05%",
    icon: "layers",
    state: "default",
    accessibleName: NAME,
    ...overrides,
  };
}

const EMPTY = content({ title: "Uniswap v4", caption: "Pick a pool", state: "empty" });
const INVALID = content({ caption: "No longer in your mandate", state: "invalid" });
const SOON = content({ caption: "Uniswap v3 · 0.05%", state: "comingSoon", soonTag: "Soon" });

/** The card element: the button when it can be selected. */
function card(): HTMLElement {
  return screen.getByRole("button", { name: NAME });
}

function strokeOf(element: HTMLElement): SVGElement {
  const stroke = element.querySelector<SVGElement>(":scope > [data-piece-stroke]");
  if (!stroke) throw new Error("no stroke overlay");
  return stroke;
}

function iconOf(element: HTMLElement): SVGElement {
  const icon = element.querySelector<SVGElement>("[data-block-icon]");
  if (!icon) throw new Error("no icon");
  return icon;
}

/** The classes that decide the card's box: size, padding, border width, box sizing. */
function boxClasses(element: HTMLElement): string[] {
  return element.className
    .split(/\s+/)
    .filter((token) =>
      /^(w-|h-|size-|min-|max-|p[xytrbl]?-|border(-\d|-\[|$)|box-|outline-\d)/.test(token),
    )
    .sort();
}

describe("PositionCard", () => {
  // @rule BB1
  // @rule A3
  it("[BB1, A3] is 176 x 62, radius 20, on surface, padding 11 / 13, gap 10, with no CSS border", () => {
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);

    const element = card();
    for (const token of [
      "w-[176px]",
      "h-[62px]",
      "rounded-xl",
      "bg-surface",
      "py-[11px]",
      "px-[13px]",
      "gap-2.5",
      "relative",
    ]) {
      expect(element.className).toContain(token);
    }
    expect(boxClasses(element)).toEqual(["h-[62px]", "px-[13px]", "py-[11px]", "w-[176px]"]);
  });

  // @rule A3
  it("[A3] the box is identical in every state: the stroke is drawn inside and takes no space", () => {
    const states: ReadonlyArray<[BlockContent, boolean]> = [
      [content(), false],
      [content(), true],
      [EMPTY, false],
      [EMPTY, true],
      [INVALID, false],
      [INVALID, true],
      [SOON, false],
      [SOON, true],
    ];
    const boxes = states.map(([blockContent, selected]) => {
      const { unmount } = render(
        <PositionCard content={blockContent} selected={selected} onSelect={() => {}} />,
      );
      const element = card();
      const box = boxClasses(element).join(" ");
      expect(strokeOf(element).getAttribute("class")).toContain("absolute");
      unmount();
      return box;
    });

    expect(new Set(boxes).size).toBe(1);
  });

  // @rule BB1
  it("[BB1] default: 1 px solid border stroke, hover raises it to muted-foreground, icon box and muted icon", () => {
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);

    const element = card();
    const stroke = strokeOf(element);
    expect(stroke).toHaveAttribute("data-stroke-width", "1");
    expect(stroke).toHaveAttribute("data-stroke-dash", "solid");
    expect(stroke.getAttribute("class")).toContain("text-border");
    expect(stroke.getAttribute("class")).toContain("group-hover:text-muted-foreground");
    expect(element.className).toContain("group");

    const icon = iconOf(element);
    expect(icon).toHaveAttribute("data-block-icon", "layers");
    expect(icon).toHaveAttribute("width", "16");
    expect(icon.getAttribute("class")).toContain("text-muted-foreground");
    const iconBox = icon.parentElement as HTMLElement;
    for (const token of ["size-7", "rounded-md", "bg-surface-raised"]) {
      expect(iconBox.className).toContain(token);
    }
  });

  // @rule BB1
  it("[BB1] title Body/Medium in foreground over caption Caption/Default in muted, gap 1", () => {
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);

    const title = screen.getByText("WETH / USDC");
    const caption = screen.getByText("Uniswap v4 · 0.05%");
    for (const token of ["text-sm", "font-medium", "leading-normal", "text-foreground"]) {
      expect(title.className).toContain(token);
    }
    for (const token of ["text-xs", "leading-normal", "text-muted-foreground"]) {
      expect(caption.className).toContain(token);
    }
    expect((title.parentElement as HTMLElement).className).toContain("gap-px");
    expect(title.parentElement).toBe(caption.parentElement);
  });

  // @rule BB1
  it("[BB1] selected: 2 px primary stroke, primary icon, announced as pressed, no hover change", () => {
    render(<PositionCard content={content()} selected onSelect={() => {}} />);

    const element = screen.getByRole("button", { name: NAME, pressed: true });
    const stroke = strokeOf(element);
    expect(stroke).toHaveAttribute("data-stroke-width", "2");
    expect(stroke).toHaveAttribute("data-stroke-dash", "solid");
    expect(stroke.getAttribute("class")).toContain("text-primary");
    expect(stroke.getAttribute("class")).not.toContain("group-hover:");
    expect(iconOf(element).getAttribute("class")).toContain("text-primary");
  });

  // @rule BB1
  it("[BB1] not selected: announced as not pressed", () => {
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);

    expect(screen.getByRole("button", { name: NAME, pressed: false })).toBeInTheDocument();
  });

  // @rule BB1
  it("[BB1] empty, not selected: 1.5 px dashed 6 6 in border, caption in primary, hover raises it", () => {
    render(<PositionCard content={EMPTY} selected={false} onSelect={() => {}} />);

    const stroke = strokeOf(card());
    expect(stroke).toHaveAttribute("data-stroke-width", "1.5");
    expect(stroke).toHaveAttribute("data-stroke-dash", "6 6");
    expect(stroke.getAttribute("class")).toContain("text-border");
    expect(stroke.getAttribute("class")).toContain("group-hover:text-muted-foreground");
    expect(screen.getByText("Pick a pool").className).toContain("text-primary");
    expect(screen.getByText("Uniswap v4").className).toContain("text-foreground");
  });

  // @rule BB1
  it("[BB1] empty and selected (a new block): the dashes are primary, the icon too", () => {
    render(<PositionCard content={EMPTY} selected onSelect={() => {}} />);

    const element = card();
    const stroke = strokeOf(element);
    expect(stroke).toHaveAttribute("data-stroke-width", "1.5");
    expect(stroke).toHaveAttribute("data-stroke-dash", "6 6");
    expect(stroke.getAttribute("class")).toContain("text-primary");
    expect(iconOf(element).getAttribute("class")).toContain("text-primary");
    expect(screen.getByText("Pick a pool").className).toContain("text-primary");
  });

  // @rule D27
  it("[D27] invalid: 1 px destructive stroke and the caption in destructive", () => {
    render(<PositionCard content={INVALID} selected={false} onSelect={() => {}} />);

    const stroke = strokeOf(card());
    expect(stroke).toHaveAttribute("data-stroke-width", "1");
    expect(stroke).toHaveAttribute("data-stroke-dash", "solid");
    expect(stroke.getAttribute("class")).toContain("text-destructive");
    expect(stroke.getAttribute("class")).not.toContain("group-hover:");
    expect(screen.getByText("No longer in your mandate").className).toContain("text-destructive");
  });

  // @rule D27
  it("[D27] invalid and selected: the selection stroke wins, the caption stays destructive", () => {
    render(<PositionCard content={INVALID} selected onSelect={() => {}} />);

    const stroke = strokeOf(card());
    expect(stroke).toHaveAttribute("data-stroke-width", "2");
    expect(stroke.getAttribute("class")).toContain("text-primary");
    expect(screen.getByText("No longer in your mandate").className).toContain("text-destructive");
  });

  // @rule D27
  it("[D27] coming soon: the normal card plus the Soon tag at the right end", () => {
    render(<PositionCard content={SOON} selected={false} onSelect={() => {}} />);

    const element = card();
    const stroke = strokeOf(element);
    expect(stroke).toHaveAttribute("data-stroke-width", "1");
    expect(stroke.getAttribute("class")).toContain("text-border");
    expect(screen.getByText("Uniswap v3 · 0.05%").className).toContain("text-muted-foreground");

    const tag = screen.getByText("Soon");
    const tagBox = tag.closest("[data-soon-tag]") as HTMLElement;
    expect(tagBox).not.toBeNull();
    expect(element.lastElementChild).toBe(tagBox);
    for (const token of ["h-[21px]", "px-1.5", "rounded-full", "shrink-0"]) {
      expect(tagBox.className).toContain(token);
    }
    for (const token of ["text-[11px]", "font-medium", "text-muted-foreground"]) {
      expect(tag.className).toContain(token);
    }
    expect(strokeOf(tagBox)).toHaveAttribute("data-stroke-width", "1");
  });

  // @rule D27
  it("[D27] the Soon tag shows only on a coming-soon card", () => {
    render(
      <PositionCard content={content({ soonTag: "Soon" })} selected={false} onSelect={() => {}} />,
    );

    expect(screen.queryByText("Soon")).not.toBeInTheDocument();
  });

  // @rule D11
  it("[D11] title and caption stay on one line, cut by an ellipsis", () => {
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);

    expect(screen.getByText("WETH / USDC").className).toContain("truncate");
    expect(screen.getByText("Uniswap v4 · 0.05%").className).toContain("truncate");
    expect((screen.getByText("WETH / USDC").parentElement as HTMLElement).className).toContain(
      "min-w-0",
    );
  });

  // @rule D11
  it("[D11] a caption cut by its ellipsis opens a tooltip with the full caption", async () => {
    const user = userEvent.setup();
    const long = content({
      title: "Supply USDG",
      caption: "Aave v3 · Robinhood Chain",
      icon: "bank",
      fullCaption: "Aave v3 · Robinhood Chain",
    });
    render(<PositionCard content={long} selected={false} onSelect={() => {}} />);
    const caption = screen.getByText("Aave v3 · Robinhood Chain");
    Object.defineProperty(caption, "scrollWidth", { configurable: true, value: 160 });
    Object.defineProperty(caption, "clientWidth", { configurable: true, value: 112 });

    await user.tab();

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Aave v3 · Robinhood Chain");
    const surface = tooltip.parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "top");
    expect(surface).toHaveAttribute("data-tooltip-offset", "4");
    expect(surface.className).toContain("whitespace-nowrap");
  });

  // @rule D11
  it("[D11] a caption that fits opens no tooltip", async () => {
    const user = userEvent.setup();
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);
    const caption = screen.getByText("Uniswap v4 · 0.05%");
    Object.defineProperty(caption, "scrollWidth", { configurable: true, value: 112 });
    Object.defineProperty(caption, "clientWidth", { configurable: true, value: 112 });

    await user.tab();
    expect(card()).toHaveFocus();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // @rule I5
  it("[I5] a click selects the block", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PositionCard content={content()} selected={false} onSelect={onSelect} />);

    await user.click(card());

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // @rule I10
  it("[I10] a button in the tab order, named by its place, activated by Enter and Space", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PositionCard content={content()} selected={false} onSelect={onSelect} />);

    await user.tab();
    expect(card()).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(card()).toHaveAttribute("type", "button");
  });

  // @rule BB1
  it("[BB1] focus: the app focus ring, drawn outside the box", () => {
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);

    for (const token of [
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
    ]) {
      expect(card().className).toContain(token);
    }
  });

  // @rule BB1
  it("[BB1] without onSelect the card is not a button, and still names its place", () => {
    const { container } = render(<PositionCard content={content()} selected={false} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(NAME).className).toContain("sr-only");
    expect(screen.getByText("WETH / USDC").closest("[aria-hidden='true']")).not.toBeNull();
    expect(container.firstElementChild).toHaveAttribute(CANVAS_INTERACTIVE_ATTR, "");
    // The stroke clips to the card's radius through `rounded-[inherit]`: the wrapper between the
    // card and the stroke must pass the radius on, or the corners would show square.
    const stroke = container.querySelector("[data-piece-stroke]");
    expect(stroke?.parentElement?.className).toContain("rounded-[inherit]");
  });

  // @rule Interactive elements
  it("[Interactive elements] carries data-canvas-interactive: a press on it never pans", () => {
    const { container } = render(
      <div data-canvas-layer="">
        <PositionCard content={content()} selected={false} onSelect={() => {}} />
      </div>,
    );

    const element = card();
    expect(element).toHaveAttribute(CANVAS_INTERACTIVE_ATTR, "");
    expect(isCanvasBackground(screen.getByText("WETH / USDC"), container)).toBe(false);
  });

  // @rule Presentational
  it("[Presentational] renders no string of its own: every word comes from its props", () => {
    const { container } = render(
      <PositionCard
        content={content({ title: "T1", caption: "C1", state: "comingSoon", soonTag: "S1" })}
        selected={false}
        onSelect={() => {}}
      />,
    );

    expect(container.textContent).toBe("T1C1S1");
  });

  // @rule I9
  it("[I9] colour changes respect reduced motion", () => {
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);

    expect(strokeOf(card()).getAttribute("class")).toContain("motion-reduce:transition-none");
  });

  // @rule BB1
  it.each<CardState>([
    "default",
    "empty",
    "invalid",
    "comingSoon",
  ])("[BB1] exposes its state %s for the renderer and the stories", (state) => {
    render(<PositionCard content={content({ state })} selected={false} onSelect={() => {}} />);

    expect(card()).toHaveAttribute("data-card-state", state);
  });

  // @rule D11
  it("[D11] hover on a card whose caption fits opens no tooltip, past the 200 ms delay", async () => {
    const user = userEvent.setup();
    render(<PositionCard content={content()} selected={false} onSelect={() => {}} />);

    await user.hover(card());
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // @rule D11
  it("[D11] hover on a card whose caption is cut opens the full caption", async () => {
    const user = userEvent.setup();
    render(
      <PositionCard
        content={content({ caption: "Aave v3 · Robinhood Chain", title: "Supply USDG" })}
        selected={false}
        onSelect={() => {}}
      />,
    );
    const caption = screen.getByText("Aave v3 · Robinhood Chain");
    Object.defineProperty(caption, "scrollWidth", { configurable: true, value: 160 });
    Object.defineProperty(caption, "clientWidth", { configurable: true, value: 112 });

    await user.hover(card());

    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent("Aave v3 · Robinhood Chain"),
    );
  });
});
