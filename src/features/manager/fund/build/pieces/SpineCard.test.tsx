/**
 * @id PP-MGR-CMP-048
 * @name SpineCard tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The fixed blocks of the hub's spine (handoff v1.2 [BB2], [C2], [C19]): Deposit, Idle input, Idle
 * output, Income (fees) and Withdraw. 236 x 62, the position card's anatomy, a 14 px lock with its
 * tooltip on Deposit and Withdraw, nothing to select.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, isCanvasBackground } from "../canvas/useCanvasViewport";
import type { BlockIcon } from "./pieceTypes";
import { SpineCard } from "./SpineCard";

const LOCK = "Fixed: USDC on Arbitrum";

interface Role {
  role: string;
  title: string;
  caption: string;
  icon: BlockIcon;
  locked: boolean;
}

const ROLES: readonly Role[] = [
  {
    role: "Deposit",
    title: "Deposit",
    caption: "USDC · Arbitrum",
    icon: "depositIn",
    locked: true,
  },
  {
    role: "Idle input",
    title: "Idle input",
    caption: "USDC waiting on the hub",
    icon: "hourglass",
    locked: false,
  },
  {
    role: "Idle output",
    title: "Idle output",
    caption: "USDC back on the hub",
    icon: "hourglass",
    locked: false,
  },
  {
    role: "Income (fees)",
    title: "Income (fees)",
    caption: "USDC · Arbitrum",
    icon: "coins",
    locked: false,
  },
  {
    role: "Withdraw",
    title: "Withdraw",
    caption: "USDC · Arbitrum",
    icon: "withdrawOut",
    locked: true,
  },
];

function cardOf(title: string): HTMLElement {
  const card = screen.getByText(title).closest("[data-spine-card]");
  if (!(card instanceof HTMLElement)) throw new Error("no spine card");
  return card;
}

describe("SpineCard", () => {
  // @rule BB2
  it("[BB2] is 236 x 62 with the position card's anatomy: radius 20, surface, 1 px border inside", () => {
    render(
      <SpineCard
        title="Idle input"
        caption="USDC waiting on the hub"
        icon="hourglass"
        locked={false}
      />,
    );

    const card = cardOf("Idle input");
    for (const token of [
      "w-[236px]",
      "h-[62px]",
      "rounded-xl",
      "bg-surface",
      "py-[11px]",
      "px-[13px]",
      "gap-2.5",
    ]) {
      expect(card.className).toContain(token);
    }
    expect(card.className).not.toMatch(/(^|\s)border(\s|$)/);
    const stroke = card.querySelector(":scope > [data-piece-stroke]");
    expect(stroke).toHaveAttribute("data-stroke-width", "1");
    expect(stroke?.getAttribute("class")).toContain("text-border");
    expect(stroke?.getAttribute("class")).not.toContain("group-hover:");

    const icon = card.querySelector("[data-block-icon]");
    expect(icon).toHaveAttribute("width", "16");
    expect(icon?.getAttribute("class")).toContain("text-muted-foreground");
    expect((icon?.parentElement as HTMLElement).className).toContain("size-7");
    expect(screen.getByText("Idle input").className).toContain("font-medium");
    expect(screen.getByText("USDC waiting on the hub").className).toContain(
      "text-muted-foreground",
    );
  });

  for (const spine of ROLES) {
    // @rule BB2
    it(`[BB2] ${spine.role}: its title, caption and icon${spine.locked ? ", locked" : ""}`, () => {
      render(
        <SpineCard
          title={spine.title}
          caption={spine.caption}
          icon={spine.icon}
          locked={spine.locked}
          lockTooltip={spine.locked ? LOCK : undefined}
        />,
      );

      const card = cardOf(spine.title);
      expect(card).toHaveTextContent(spine.caption);
      expect(card.querySelector("[data-block-icon]")).toHaveAttribute(
        "data-block-icon",
        spine.icon,
      );
      if (spine.locked) {
        expect(screen.getByRole("button", { name: LOCK })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
      }
    });
  }

  // @rule BB2
  it("[BB2] the lock is 14 px, muted, at the right end of the card", () => {
    render(
      <SpineCard
        title="Deposit"
        caption="USDC · Arbitrum"
        icon="depositIn"
        locked
        lockTooltip={LOCK}
      />,
    );

    const lock = screen.getByRole("button", { name: LOCK });
    expect(cardOf("Deposit").lastElementChild).toBe(lock);
    expect(lock.className).toContain("text-muted-foreground");
    expect(lock.className).toContain("shrink-0");
    const glyph = lock.querySelector("svg");
    expect(glyph).toHaveAttribute("width", "14");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
  });

  // @rule C19
  it("[C19, BB10] the lock's tooltip opens on focus: side top, offset 4, one line", async () => {
    const user = userEvent.setup();
    render(
      <SpineCard
        title="Withdraw"
        caption="USDC · Arbitrum"
        icon="withdrawOut"
        locked
        lockTooltip={LOCK}
      />,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: LOCK })).toHaveFocus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(LOCK);
    const surface = tooltip.parentElement as HTMLElement;
    expect(surface).toHaveAttribute("data-side", "top");
    expect(surface).toHaveAttribute("data-tooltip-offset", "4");
    expect(surface.className).toContain("whitespace-nowrap");
  });

  // @rule C19
  it("[C19] the lock's tooltip opens on hover", async () => {
    const user = userEvent.setup();
    render(
      <SpineCard
        title="Deposit"
        caption="USDC · Arbitrum"
        icon="depositIn"
        locked
        lockTooltip={LOCK}
      />,
    );

    await user.hover(screen.getByRole("button", { name: LOCK }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(LOCK);
  });

  // @rule BB2
  it("[BB2, C2] not selectable: no pressed state, no hover stroke, the card itself is no control", () => {
    render(
      <SpineCard
        title="Deposit"
        caption="USDC · Arbitrum"
        icon="depositIn"
        locked
        lockTooltip={LOCK}
      />,
    );

    const card = cardOf("Deposit");
    expect(card.tagName).toBe("DIV");
    expect(card).not.toHaveAttribute("aria-pressed");
    expect(card).not.toHaveAttribute("tabindex");
  });

  // @rule Interactive elements
  it("[Interactive elements] carries data-canvas-interactive: a press on it never pans", () => {
    const { container } = render(
      <div data-canvas-layer="">
        <SpineCard
          title="Idle output"
          caption="USDC back on the hub"
          icon="hourglass"
          locked={false}
        />
      </div>,
    );

    expect(cardOf("Idle output")).toHaveAttribute(CANVAS_INTERACTIVE_ATTR, "");
    expect(isCanvasBackground(screen.getByText("Idle output"), container)).toBe(false);
  });

  // @rule Presentational
  it("[Presentational] renders no string of its own", () => {
    const { container } = render(
      <SpineCard title="T1" caption="C1" icon="depositIn" locked lockTooltip="L1" />,
    );

    expect(container.textContent).toBe("T1C1");
  });
});
