/**
 * @id PP-MGR-CMP-068
 * @name PanelPickList tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational list under test
 *
 * Modes 2 and 3 of the panel (handoff "Panel shell"): the heading counts the whole network, the
 * filter narrows the mandate's rows only, `Use` per row, the link back to the Mandate step, the
 * no-match box (a pasted address shortened), the empty mandate's box, loading and a failed read.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { matchesFilter, type PanelPickItem, PanelPickList } from "./PanelPickList";

const ITEMS: PanelPickItem[] = [
  {
    id: "weth-usdc",
    title: "WETH / USDC",
    subtitle: "0.05%",
    logos: [{ symbol: "WETH" }, { symbol: "USDC" }],
    searchText: "Wrapped Ether USD Coin 0xa1a1",
  },
  {
    id: "wbtc-usdc",
    title: "WBTC / USDC",
    subtitle: "0.30%",
    logos: [{ symbol: "WBTC" }, { symbol: "USDC" }],
    searchText: "Wrapped Bitcoin USD Coin 0xb2b2",
    useDisabled: true,
  },
];

function renderList(
  props: Partial<Parameters<typeof PanelPickList>[0]> = {},
  onUse = vi.fn(),
  onLink = vi.fn(),
) {
  render(
    <PanelPickList
      heading="Pools in your mandate"
      count={2}
      filterPlaceholder="Filter by token or address"
      items={ITEMS}
      useLabel="Use"
      rowLabel={(title) => `Use ${title}`}
      onUse={onUse}
      caption="Only the Uniswap v4 pools on Arbitrum that you chose in the mandate (step 4)."
      link={{ prompt: "Need another pool?", label: "Edit mandate · Pools", onClick: onLink }}
      noMatch={{
        title: (typed) => `No pool in your mandate has ${typed}`,
        caption: "Pools are chosen in the mandate, step 4.",
      }}
      emptyTitle="No pool of your mandate is on Arbitrum"
      {...props}
    />,
  );
  return { onUse, onLink };
}

describe("matchesFilter (P1)", () => {
  it("matches the title, the second line and the search text, without case", () => {
    // @rule P1
    const [weth] = ITEMS;
    if (!weth) throw new Error("fixture");
    expect(matchesFilter(weth, "")).toBe(true);
    expect(matchesFilter(weth, " weth ")).toBe(true);
    expect(matchesFilter(weth, "0.05")).toBe(true);
    expect(matchesFilter(weth, "0XA1A1")).toBe(true);
    expect(matchesFilter(weth, "wbtc")).toBe(false);
  });
});

describe("PanelPickList (Modes 2 and 3)", () => {
  it("[Mode 2] lists the rows with Use, the caption and the link back", async () => {
    // @rule P1
    const { onUse, onLink } = renderList();
    expect(screen.getByText("Pools in your mandate ·")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use WETH / USDC" }));
    expect(onUse).toHaveBeenCalledWith("weth-usdc");
    // A row whose Use is not ready cannot be used.
    expect(screen.getByRole("button", { name: "Use WBTC / USDC" })).toBeDisabled();
    expect(screen.getByText(/that you chose in the mandate/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit mandate · Pools" }));
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("[Mode 2] the filter narrows the list, and the count stays the network's total", async () => {
    // @rule P1
    renderList();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Filter by token or address" }),
      "wbtc",
    );
    expect(screen.queryByRole("button", { name: "Use WETH / USDC" })).toBeNull();
    expect(screen.getByRole("button", { name: "Use WBTC / USDC" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("[Mode 3] no match: one box in place of the list, a pasted address shortened", async () => {
    // @rule P1
    const { onLink } = renderList({ defaultFilter: `0x${"cd".repeat(20)}` });
    expect(screen.getByText("No pool in your mandate has 0xcdcd…cdcd")).toBeInTheDocument();
    expect(screen.getByText("Pools are chosen in the mandate, step 4.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    expect(screen.queryByText("Need another pool?")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Edit mandate · Pools" }));
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("[M2] a row that cannot be used says why, and its Use is disabled and described", () => {
    // @rule M2
    const [first, second] = ITEMS;
    if (!first || !second) throw new Error("fixture");
    renderList({ items: [first, { ...second, useDisabled: false, disabledReason: "Paused" }] });
    const use = screen.getByRole("button", { name: "Use WBTC / USDC" });
    expect(use).toBeDisabled();
    expect(use).toHaveAccessibleDescription("Paused");
    expect(screen.getByText("Paused")).toBeInTheDocument();
    // The second line gives way to the reason.
    expect(screen.queryByText("0.30%")).toBeNull();
    expect(screen.getByRole("button", { name: "Use WETH / USDC" })).toBeEnabled();
  });

  it("a mandate with nothing here shows its own box and no filter", () => {
    renderList({ items: [], count: 0 });
    expect(screen.getByText("No pool of your mandate is on Arbitrum")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("[P13] shows skeleton rows while the read loads, and the inline retry when it fails", async () => {
    // @rule P13
    const onRetry = vi.fn();
    renderList({ status: "loading" });
    expect(document.querySelector("[data-panel-pick-loading]")).not.toBeNull();
    renderList({
      status: "error",
      error: { text: "The v2 catalog is unavailable.", retryLabel: "Retry", onRetry },
    });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
