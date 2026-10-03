/**
 * @id PP-MGR-CMP-057
 * @name CanvasMenu tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a presentational menu under test
 *
 * The menu of a canvas template or port (slice S5, POO-2155; handoff BB9) and the popover it is
 * built on: placement 12 px right of the anchor, top aligned, moved up at the viewport bottom,
 * opened to the left without room (pure `placePopover`); a portal above the canvas; Esc and an
 * outside click close it; arrow keys move focus; focus returns to the anchor; the rows, the
 * disabled rows at 40% with their reason, the footer and the link back to the mandate (C6, A4).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MandateDraft } from "../../mandateDraft";
import { createEmptyPlan } from "../plan/buildPlan";
import { emptySpokePlan, hubSupplyPlan, makeTestDraft } from "../plan/planTestKit";
import { placePopover } from "./AnchoredPopover";
import { makeDescribeContext } from "./blockTestKit";
import { CanvasMenu } from "./CanvasMenu";
import {
  type MenuModel,
  type MenuOption,
  networkMenuModel,
  portMenuModel,
  protocolMenuModel,
} from "./menuModels";

const VIEWPORT = { width: 1440, height: 900 };

describe("placePopover", () => {
  it("opens 12 px to the right of its anchor, top aligned", () => {
    // @rule BB9
    const place = placePopover(
      { left: 100, top: 200, right: 140, bottom: 240 },
      { width: 248, height: 300 },
      VIEWPORT,
    );
    expect(place).toEqual({ left: 152, top: 200, side: "right" });
  });

  it("moves up when it would pass the bottom of the viewport", () => {
    // @rule BB9
    const place = placePopover(
      { left: 100, top: 700, right: 140, bottom: 740 },
      { width: 248, height: 300 },
      VIEWPORT,
    );
    expect(place.top).toBe(900 - 8 - 300);
    expect(place.side).toBe("right");
  });

  it("opens to the left of its anchor when there is no room on the right", () => {
    // @rule BB9
    const place = placePopover(
      { left: 1300, top: 200, right: 1340, bottom: 240 },
      { width: 248, height: 300 },
      VIEWPORT,
    );
    expect(place).toEqual({ left: 1300 - 12 - 248, top: 200, side: "left" });
  });

  it("stays inside a viewport too small for either side", () => {
    // @rule BB9
    const place = placePopover(
      { left: 100, top: 10, right: 140, bottom: 50 },
      { width: 248, height: 900 },
      { width: 300, height: 400 },
    );
    expect(place.left).toBeGreaterThanOrEqual(8);
    expect(place.top).toBe(8);
  });
});

/** The menu as the controller hands it: opened from an anchor, closed by setting it to null. */
function Harness({
  model,
  onChoose = () => {},
  onLink = () => {},
  onClose,
}: {
  model: MenuModel;
  onChoose?(option: MenuOption): void;
  onLink?(step: "networks" | "protocols"): void;
  onClose?(): void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div>
      <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>
        anchor
      </button>
      <button type="button">elsewhere</button>
      <div data-testid="canvas">
        <CanvasMenu
          menu={anchor ? { anchor, model } : null}
          onChoose={onChoose}
          onLink={onLink}
          onClose={() => {
            onClose?.();
            setAnchor(null);
          }}
        />
      </div>
    </div>
  );
}

function protocols(): MenuModel {
  return protocolMenuModel("arbitrum", makeDescribeContext(createEmptyPlan()));
}

async function open(model: MenuModel, props: Partial<Parameters<typeof Harness>[0]> = {}) {
  const user = userEvent.setup();
  render(<Harness model={model} {...props} />);
  await user.click(screen.getByRole("button", { name: "anchor" }));
  return user;
}

describe("CanvasMenu", () => {
  it("is a menu named by its title, rendered in a portal outside the canvas", async () => {
    // @rule BB9
    await open(protocols());
    const menu = screen.getByRole("menu", { name: "Protocols on Arbitrum" });
    expect(screen.getByTestId("canvas")).not.toContainElement(menu);
    expect(document.body).toContainElement(menu);
    expect(menu.className).toContain("w-[248px]");
  });

  it("lists every option as a menu item, the disabled ones at 40% with their reason", async () => {
    // @rule I1
    // @rule ST2
    // @rule BB9
    await open(protocols());
    const items = screen.getAllByRole("menuitem");
    // Six options and the link.
    expect(items).toHaveLength(7);
    const borrow = screen.getByRole("menuitem", { name: /Borrow · add it under a Supply block/ });
    expect(borrow).toHaveAttribute("aria-disabled", "true");
    expect(borrow.className).toContain("opacity-40");
    const pool = screen.getByRole("menuitem", { name: /Uniswap v4 Liquidity position/ });
    expect(pool).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText("Protocols of your mandate on Arbitrum.")).toBeInTheDocument();
  });

  it("focuses the first enabled option when it opens", async () => {
    // @rule BB9
    await open(protocols());
    expect(screen.getByRole("menuitem", { name: /Uniswap v4/ })).toHaveFocus();
  });

  it("moves focus with the arrow keys, Home and End, wrapping at the ends", async () => {
    // @rule BB9
    const user = await open(protocols());
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Aave v3 Supply/ })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Edit mandate · Protocols" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Uniswap v4/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Edit mandate · Protocols" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: /Uniswap v4/ })).toHaveFocus();
  });

  it("closes on Escape and gives focus back to its anchor", async () => {
    // @rule BB9
    // @rule I10
    const onClose = vi.fn();
    const user = await open(protocols(), { onClose });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "anchor" })).toHaveFocus();
  });

  it("closes on a press outside it, and not on a press inside it or on its anchor", async () => {
    // @rule BB9
    const onClose = vi.fn();
    await open(protocols(), { onClose });
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: /Uniswap v4/ }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "anchor" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hands the chosen option to the controller, disabled ones included", async () => {
    // @rule I1
    const onChoose = vi.fn();
    const user = await open(protocols(), { onChoose });
    await user.click(screen.getByRole("menuitem", { name: /Aave v3 Supply/ }));
    expect(onChoose).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: { kind: "addChain", network: "arbitrum", blockKind: "aaveSupply" },
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: /Pendle/ }));
    expect(onChoose).toHaveBeenLastCalledWith(
      expect.objectContaining({ disabled: true, blockedReason: "coming_soon" }),
    );
  });

  it("chooses with Enter on the focused option", async () => {
    // @rule I10
    const onChoose = vi.fn();
    const user = await open(protocols(), { onChoose });
    await user.keyboard("{Enter}");
    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ id: "addChain:arbitrum:uniswapV4Pool" }),
    );
  });

  it("follows its link back to the mandate step", async () => {
    // @rule C6
    // @rule A4
    const onLink = vi.fn();
    const user = await open(networkMenuModel(makeDescribeContext(createEmptyPlan())), { onLink });
    await user.click(screen.getByRole("menuitem", { name: "Edit mandate · Networks" }));
    expect(onLink).toHaveBeenCalledWith("networks");
  });

  it("shows only the sentence and the link when nothing is available", async () => {
    // @rule I1
    const draft: MandateDraft = { ...makeTestDraft(), protocols: ["uniswap-v3-swap", "across"] };
    await open(protocolMenuModel("arbitrum", makeDescribeContext(createEmptyPlan(), draft)));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(
      screen.getByText("No protocol of your mandate is available on Arbitrum."),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit mandate · Protocols" })).toHaveFocus();
  });

  it("draws the Add network menu with its footer when no network is left", async () => {
    // @rule I2
    // @rule D4
    await open(networkMenuModel(makeDescribeContext(emptySpokePlan())));
    expect(screen.getByText("Robinhood Chain are already on the canvas.")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });

  it("draws the port menu after a Supply as Figma 8181-2110 does", async () => {
    // @rule I4
    // @rule ST4
    await open(
      portMenuModel(
        { side: "after", blockId: "hub-supply-supply" },
        makeDescribeContext(hubSupplyPlan()),
      ),
    );
    expect(screen.getByRole("menu", { name: "After Supply USDC" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Aave v3 Borrow against this supply/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Swap Flow block/ })).toBeInTheDocument();
    expect(
      screen.getByText("Blocks of your mandate that fit after this supply."),
    ).toBeInTheDocument();
  });

  it("closes on Tab, back on its anchor", async () => {
    // @rule BB9
    const onClose = vi.fn();
    const user = await open(protocols(), { onClose });
    await user.keyboard("{Tab}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "anchor" })).toHaveFocus();
  });

  it("places itself beside its anchor from the measured boxes", async () => {
    // @rule BB9
    const user = userEvent.setup();
    render(<Harness model={protocols()} />);
    const anchor = screen.getByRole("button", { name: "anchor" });
    anchor.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 200,
        right: 140,
        bottom: 240,
        width: 40,
        height: 40,
        x: 100,
        y: 200,
      }) as DOMRect;
    await user.click(anchor);
    const menu = screen.getByRole("menu");
    await waitFor(() => expect(menu.style.left).toBe("152px"));
    expect(menu.style.top).toBe("200px");
    // It follows its anchor when the window changes.
    anchor.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 260,
        right: 140,
        bottom: 300,
        width: 40,
        height: 40,
        x: 100,
        y: 260,
      }) as DOMRect;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => expect(menu.style.top).toBe("260px"));
  });
});
