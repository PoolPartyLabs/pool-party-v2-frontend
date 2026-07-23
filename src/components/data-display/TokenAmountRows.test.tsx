/**
 * @id PP-CORE-CMP-051
 * @name TokenAmountRows tests
 * @implements-rules-version v1
 *
 * [POO-573] The shared per-token payout list: an end-aligned flex-col of {@link TokenAmountRow},
 * one per `rows` entry in order, with the logo resolved from the symbol+network and the optional
 * per-row USD formatted via formatUsd. Behavior-preserving extraction of the 4 hand-rolled
 * Withdraw/Collect/Remove renderers, so these assertions mirror their prior output.
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { TokenAmountRows } from "./TokenAmountRows";

describe("TokenAmountRows", () => {
  it("renders one row per entry, in order", () => {
    renderWithProviders(
      <TokenAmountRows
        rows={[
          { symbol: "ETH", amount: 0.05 },
          { symbol: "USDC", amount: 145.2 },
        ]}
        network={undefined}
      />,
    );
    const rows = screen.getAllByText(/ETH|USDC/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("0.05 ETH");
    expect(rows[1]).toHaveTextContent("145.2 USDC");
  });

  it("renders a logo <img> when resolveTokenLogo returns a url (a committed major)", () => {
    const { container } = renderWithProviders(
      <TokenAmountRows rows={[{ symbol: "ETH", amount: 0.05 }]} network={undefined} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/tokens/eth.png");
  });

  it("falls back to the symbol initial when resolveTokenLogo returns nothing", () => {
    const { container } = renderWithProviders(
      <TokenAmountRows rows={[{ symbol: "ZZZ", amount: 1 }]} network={undefined} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Z")).toBeInTheDocument();
  });

  it("shows a de-emphasized USD value in parens when `usd` is provided", () => {
    renderWithProviders(
      <TokenAmountRows rows={[{ symbol: "ETH", amount: 0.05, usd: 23.8 }]} network={undefined} />,
    );
    expect(screen.getByText("($23.80)")).toBeInTheDocument();
  });

  it("omits the USD value when `usd` is not provided (amounts-only)", () => {
    renderWithProviders(
      <TokenAmountRows rows={[{ symbol: "ETH", amount: 0.05 }]} network={undefined} />,
    );
    expect(screen.queryByText(/\(\$/)).toBeNull();
  });

  it("applies the data-testid to the container", () => {
    renderWithProviders(
      <TokenAmountRows
        rows={[{ symbol: "ETH", amount: 0.05 }]}
        network={undefined}
        testId="withdraw-receive-tokens"
      />,
    );
    expect(screen.getByTestId("withdraw-receive-tokens")).toBeInTheDocument();
  });

  it("renders an empty container for empty rows", () => {
    renderWithProviders(<TokenAmountRows rows={[]} network={undefined} testId="empty-rows" />);
    const container = screen.getByTestId("empty-rows");
    expect(container).toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
