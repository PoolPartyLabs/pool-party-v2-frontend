/**
 * @id PP-MGR-CMP-025
 * @name TokenSplitBar.test
 * @implements-rules-version v1
 *
 * Behavior (POO-387 [R5]): renders both token symbols + rounded percentages. POO-501 extends it with
 * optional per-token logos (R1) and an optional pre-formatted amount/USD sub-line under each side (R2),
 * and locks the percent-only fallback when the sub-lines are absent (R4).
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { TokenSplitBar } from "./TokenSplitBar";

describe("TokenSplitBar", () => {
  it("renders both token symbols and their rounded percentages", () => {
    renderWithProviders(<TokenSplitBar pct0={48} pct1={52} token0="ETH" token1="USDC" />);
    expect(screen.getByText("ETH")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("48%")).toBeInTheDocument();
    expect(screen.getByText("52%")).toBeInTheDocument();
  });

  // @rule R1: the token logo img renders when the icon prop is set; absent → no img (initial legend).
  // The legend logos are decorative (alt=""), so query the raw <img> tags, not the a11y "img" role.
  it("renders the token logo img when icon props are set and no img otherwise (R1)", () => {
    const { container, rerender } = renderWithProviders(
      <TokenSplitBar
        pct0={48}
        pct1={52}
        token0="ETH"
        token1="USDC"
        icon0="/tokens/eth.png"
        icon1="/tokens/usdc.png"
      />,
    );
    const srcs = Array.from(container.querySelectorAll("img")).map((n) => n.getAttribute("src"));
    expect(srcs).toEqual(["/tokens/eth.png", "/tokens/usdc.png"]);
    // Without icons the legend carries no imgs.
    rerender(<TokenSplitBar pct0={48} pct1={52} token0="ETH" token1="USDC" />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  // @rule R2: a per-token sub-line (pre-formatted amount + USD) renders under each side when provided.
  it("renders a per-token sub-line (amount + USD) under each side when provided (R2)", () => {
    renderWithProviders(
      <TokenSplitBar
        pct0={60}
        pct1={40}
        token0="ETH"
        token1="USDC"
        sub0="~0.5 ETH (~$1,500.00)"
        sub1="~1,000 USDC (~$1,000.00)"
      />,
    );
    expect(screen.getByText("~0.5 ETH (~$1,500.00)")).toBeInTheDocument();
    expect(screen.getByText("~1,000 USDC (~$1,000.00)")).toBeInTheDocument();
  });

  // @rule R4: with no sub-lines the legend is exactly the percent-only render (no amount text).
  it("renders the percent-only legend when sub-lines are absent (R4)", () => {
    renderWithProviders(<TokenSplitBar pct0={70} pct1={30} token0="WBTC" token1="USDC" />);
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    // No approx-marked amount sub-line leaks in.
    expect(screen.queryByText(/~.*\$/)).toBeNull();
  });
});
