/**
 * @id PP-MGR-CMP-058
 * @name PanelStub tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a presentational stub under test
 *
 * The body of the Configure block panel in this batch (slice S5, POO-2155; handoff AN10, HU1):
 * "Nothing selected" with its body; the head of a selected block (protocol, block type, network
 * chip) and "Remove block"; the sentence of an open menu in place of the body.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PanelStub, type PanelStubProps } from "./PanelStub";

const BASE: PanelStubProps = {
  head: null,
  nothingTitle: "Nothing selected",
  body: "Add a protocol or a network on the canvas, or drag a block from the left. A new block arrives empty; you pick its pool, asset or market here.",
  removeLabel: "Remove block",
  onRemove: () => {},
};

const EMPTY_POOL: PanelStubProps["head"] = {
  blockKind: "uniswapV4Pool",
  protocolName: "Uniswap v4",
  blockType: "Liquidity position · no pool yet",
  network: "arbitrum",
  networkName: "Arbitrum",
};

describe("PanelStub", () => {
  it("says Nothing selected, with its body, and offers no action", () => {
    // @rule AN10
    render(<PanelStub {...BASE} />);
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(screen.getByText(BASE.body as string)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the menu sentence in place of the body while a menu is open", () => {
    // @rule AN10
    const sentence =
      "Choose a protocol in the menu. The block is added on Arbitrum and opens here.";
    render(<PanelStub {...BASE} body={sentence} />);
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it("heads a selected empty block with its protocol, its type and its network chip", () => {
    // @rule AN10
    // @rule G6
    render(<PanelStub {...BASE} head={EMPTY_POOL} body={null} />);
    expect(screen.getByText("Uniswap v4")).toBeInTheDocument();
    expect(screen.getByText("Liquidity position · no pool yet")).toBeInTheDocument();
    const chip = screen.getByText("Arbitrum").closest("[data-network-chip]");
    expect(chip).not.toBeNull();
    expect(screen.queryByText("Nothing selected")).not.toBeInTheDocument();
  });

  it("heads a configured block without the missing-field suffix", () => {
    // @rule AN10
    render(
      <PanelStub
        {...BASE}
        head={{
          ...EMPTY_POOL,
          blockKind: "aaveSupply",
          protocolName: "Aave v3",
          blockType: "Supply",
        }}
        body={null}
      />,
    );
    expect(screen.getByText("Aave v3")).toBeInTheDocument();
    expect(screen.getByText("Supply")).toBeInTheDocument();
  });

  it("removes the selected block with its destructive text button", async () => {
    // @rule I6
    const onRemove = vi.fn();
    render(<PanelStub {...BASE} head={EMPTY_POOL} body={null} onRemove={onRemove} />);
    const remove = screen.getByRole("button", { name: "Remove block" });
    expect(remove.className).toContain("text-destructive");
    await userEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps Remove block under a menu sentence while a block is selected", () => {
    // @rule AN10
    render(<PanelStub {...BASE} head={EMPTY_POOL} body="Choose what comes after Supply WETH." />);
    expect(screen.getByText("Choose what comes after Supply WETH.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove block" })).toBeInTheDocument();
  });
});
