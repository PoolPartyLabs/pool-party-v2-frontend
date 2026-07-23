/**
 * @id PP-CORE-CMP-042
 * @name TokenAmountRow tests
 * @implements-rules-version v1
 *
 * [POO-417 R3] One token payout line: avatar (logo or symbol initial) + amount with symbol at
 * crypto precision; optional de-emphasized USD in parens (omitted for collect, amounts-only).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenAmountRow } from "./TokenAmountRow";

describe("TokenAmountRow", () => {
  it("renders the amount with its symbol at crypto precision (no 4dp truncation)", () => {
    render(<TokenAmountRow symbol="WBTC" amount={0.00131} />);
    expect(screen.getByText("0.00131 WBTC")).toBeInTheDocument();
  });

  it("[R6b] renders a zero amount", () => {
    render(<TokenAmountRow symbol="USDC" amount={0} />);
    expect(screen.getByText("0 USDC")).toBeInTheDocument();
  });

  it("[R3] omits the USD value by default (amounts-only)", () => {
    render(<TokenAmountRow symbol="ETH" amount={0.05} />);
    expect(screen.queryByText(/\(\$/)).toBeNull();
  });

  it("shows a de-emphasized USD value in parens when provided", () => {
    render(<TokenAmountRow symbol="ETH" amount={0.05} usd="$23.80" />);
    expect(screen.getByText("($23.80)")).toBeInTheDocument();
  });

  it("uses the logo image when iconUrl is provided", () => {
    const { container } = render(
      <TokenAmountRow symbol="ETH" amount={0.05} iconUrl="https://logo/eth.png" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://logo/eth.png");
    expect(img).toHaveAttribute("alt", "");
  });

  it("falls back to the symbol initial when no logo is provided", () => {
    const { container } = render(<TokenAmountRow symbol="ETH" amount={0.05} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("E")).toBeInTheDocument();
  });

  // POO-839 R7 — the row wraps between the amount and the USD span (never mid-token: "710.25"
  // and "USDC" must stay on the same line), and can shrink inside its cell (min-w-0).
  it("wraps between the amount and USD, keeping the amount+symbol together", () => {
    const { container } = render(<TokenAmountRow symbol="USDC" amount={710.25} usd="$710.25" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("flex-wrap");
    expect(wrapper).toHaveClass("justify-end");
    expect(wrapper).toHaveClass("min-w-0");
    expect(screen.getByText("710.25 USDC")).toHaveClass("whitespace-nowrap");
  });
});
