/**
 * @id PP-STR-CMP-017
 * @name SinglePoolProspectus.test
 * Behavior: derives the Composition ("Liquidity pool") + Investment-mandate (pair tokens, Uniswap v3,
 * network) cards from the pool pair; shows the "not available" note when the pair is unknown.
 * POO-897 (rules v1): an optional `split` renders the per-token proportion in the Composition card -
 * two token rows (logo + symbol + integer percent) over a proportional two-tone bar [R1]/[R6]; no
 * split keeps today's single "Liquidity pool 100%" row [R4].
 * POO-903 (rules v1): both cards start COLLAPSED (defaultOpen=false) — body assertions expand the
 * card from its header toggle first [R1]; the state is per-visit local, never persisted [R3].
 */
import { describe, expect, it } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { SinglePoolProspectus } from "./SinglePoolProspectus";

/** POO-903: the cards start collapsed — expand one by its header toggle before body assertions. */
function expand(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("SinglePoolProspectus", () => {
  // @rule R1: the Investment mandate renders per-asset token logos, the Uniswap protocol logo, and a
  // network logo on the Networks row.
  it("derives Composition + Investment mandate from the pool pair, with token/protocol/network logos", () => {
    const { container } = renderWithProviders(
      <SinglePoolProspectus
        tokens={{ token0: "ETH", token1: "USDC" }}
        networkName="Arbitrum"
        network="arbitrum"
      />,
    );
    expand(/Composition/);
    expand(/Investment mandate/);
    expect(screen.getByText("Liquidity pool")).toBeInTheDocument();
    expect(screen.getByText("ETH")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("Uniswap v3")).toBeInTheDocument();
    expect(screen.getByText("Arbitrum")).toBeInTheDocument();
    // POO-739: token, protocol and network logos render alongside their labels.
    expect(container.querySelector('img[src="/tokens/eth.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="/tokens/usdc.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="/protocols/uniswap.svg"]')).not.toBeNull();
    expect(container.querySelector('img[src="/networks/arbitrum.png"]')).not.toBeNull();
  });

  it("shows the 'not available' note when the pair is unknown", () => {
    renderWithProviders(<SinglePoolProspectus tokens={null} />);
    expand(/Composition/);
    expand(/Investment mandate/);
    // The note shows in both the Composition and the Investment-mandate cards.
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Liquidity pool")).toBeNull();
  });

  // @rule R1: with a split, the Composition card shows one row per token (logo + symbol + integer
  // percent) and a proportional two-tone bar.
  it("[R1] renders per-token rows with logos, integer percents and a two-tone bar from `split`", () => {
    const { container } = renderWithProviders(
      <SinglePoolProspectus
        tokens={{ token0: "ETH", token1: "USDC" }}
        networkName="Arbitrum"
        network="arbitrum"
        split={{ pct0: 72.4, pct1: 27.6 }}
      />,
    );
    expand(/Composition/);
    // The single "Liquidity pool" placeholder is replaced by the per-token rows.
    expect(screen.queryByText("Liquidity pool")).toBeNull();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // Integer percents (formatPercent(x, 0)) per token row, token0 first.
    expect(within(rows[0] as HTMLElement).getByText("ETH")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("72%")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("USDC")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("28%")).toBeInTheDocument();
    // Each row carries the token logo (POO-739 resolution).
    expect((rows[0] as HTMLElement).querySelector('img[src="/tokens/eth.png"]')).not.toBeNull();
    expect((rows[1] as HTMLElement).querySelector('img[src="/tokens/usdc.png"]')).not.toBeNull();
    // The bar is proportional: two tones sized by the raw (unrounded) percents.
    expect(container.querySelector('[style*="width: 72.4%"]')).not.toBeNull();
    expect(container.querySelector('[style*="width: 27.6%"]')).not.toBeNull();
  });

  // @rule R3: out-of-range positions render 0/100 truthfully (same as the manager Allocation).
  it("[R3] renders a truthful 0/100 split for an out-of-range position", () => {
    renderWithProviders(
      <SinglePoolProspectus
        tokens={{ token0: "ETH", token1: "USDC" }}
        network="arbitrum"
        split={{ pct0: 0, pct1: 100 }}
      />,
    );
    expand(/Composition/);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("0%")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("100%")).toBeInTheDocument();
  });

  // @rule R6: integer rounding is accepted: 99.6/0.4 renders 100/0.
  it("[R6] rounds to integer percents (99.6/0.4 renders 100%/0%)", () => {
    renderWithProviders(
      <SinglePoolProspectus
        tokens={{ token0: "ETH", token1: "USDC" }}
        network="arbitrum"
        split={{ pct0: 99.6, pct1: 0.4 }}
      />,
    );
    expand(/Composition/);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("100%")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("0%")).toBeInTheDocument();
  });

  // @rule R4: no split (unresolvable) -> today's single "Liquidity pool 100%" row, never fabricated.
  it("[R4] keeps the single 'Liquidity pool 100%' row when split is absent", () => {
    renderWithProviders(
      <SinglePoolProspectus tokens={{ token0: "ETH", token1: "USDC" }} split={null} />,
    );
    expand(/Composition/);
    expect(screen.getByText("Liquidity pool")).toBeInTheDocument();
  });
});

// POO-903 (rules v1): both prospectus cards start collapsed; the header toggle expands them and
// the state lives per visit only.
describe("SinglePoolProspectus: collapsed by default (POO-903)", () => {
  // @rule R1: both real-mode cards render with defaultOpen=false — headers visible, bodies hidden.
  it("[R1] starts with Composition + Investment mandate collapsed and their bodies hidden", () => {
    renderWithProviders(
      <SinglePoolProspectus
        tokens={{ token0: "ETH", token1: "USDC" }}
        networkName="Arbitrum"
        network="arbitrum"
      />,
    );
    expect(screen.getByRole("button", { name: /Composition/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /Investment mandate/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Liquidity pool")).toBeNull();
    expect(screen.queryByText("Uniswap v3")).toBeNull();
  });

  // @rule R1/R4: the header toggle expands the card (aria-expanded carries the state), each card
  // independently.
  it("[R1][R4] expands a card from its header with aria-expanded semantics", () => {
    renderWithProviders(
      <SinglePoolProspectus
        tokens={{ token0: "ETH", token1: "USDC" }}
        networkName="Arbitrum"
        network="arbitrum"
      />,
    );
    const composition = screen.getByRole("button", { name: /Composition/ });
    fireEvent.click(composition);
    expect(composition).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Liquidity pool")).toBeInTheDocument();
    // The sibling card stays independent (still collapsed).
    expect(screen.getByRole("button", { name: /Investment mandate/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(composition);
    expect(screen.queryByText("Liquidity pool")).toBeNull();
  });

  // @rule R3: per-visit local state — a fresh mount starts collapsed again (no persistence).
  it("[R3] does not persist the expanded state across mounts", () => {
    const view = renderWithProviders(
      <SinglePoolProspectus tokens={{ token0: "ETH", token1: "USDC" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Composition/ }));
    expect(screen.getByText("Liquidity pool")).toBeInTheDocument();
    view.unmount();
    renderWithProviders(<SinglePoolProspectus tokens={{ token0: "ETH", token1: "USDC" }} />);
    expect(screen.getByRole("button", { name: /Composition/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Liquidity pool")).toBeNull();
  });
});
