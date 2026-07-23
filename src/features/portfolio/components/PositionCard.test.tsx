import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { PositionCard } from "./PositionCard";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const strategy: Strategy = {
  id: "strat-stable-yield",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_250_000,
  investors: 312,
  estReturn: 7.4,
  rateType: "APY",
  status: "active",
};

const position: Position = {
  id: "pos-1",
  strategyId: "strat-stable-yield",
  invested: 1800,
  currentValue: 2050,
  totalYield: 250,
  available: 120,
  reinvestment: "auto-compound",
  status: "active",
};

describe("PositionCard", () => {
  it("renders the position metrics and links to the owned detail", () => {
    renderWithProviders(<PositionCard position={position} strategy={strategy} />);
    expect(screen.getByText("Stable Yield")).toBeInTheDocument();
    expect(screen.getByText("$1,800.00")).toBeInTheDocument();
    expect(screen.getByText("+$250.00")).toBeInTheDocument();
    expect(screen.getByText("$2,050.00")).toBeInTheDocument();
    // POO-554: the card carries `?from=portfolio` so the detail's Back returns to the Portfolio.
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/strategies/strat-stable-yield?from=portfolio",
    );
  });

  it("[POO-724] renders the strategy logo when logoUrl is set", () => {
    const { container } = renderWithProviders(
      <PositionCard
        position={position}
        strategy={{ ...strategy, logoUrl: "https://cdn.example.com/logo.png" }}
      />,
    );
    expect(container.querySelector('img[src="https://cdn.example.com/logo.png"]')).toBeTruthy();
  });

  it("[POO-724] falls back to the initials monogram (no img) when there is no logoUrl", () => {
    const { container } = renderWithProviders(
      <PositionCard position={position} strategy={strategy} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the active status pill", () => {
    renderWithProviders(<PositionCard position={position} strategy={strategy} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows the paused status pill", () => {
    renderWithProviders(
      <PositionCard position={{ ...position, status: "paused" }} strategy={strategy} />,
    );
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("[R1] hides the rate for a closed position (no Final APR label, no % value)", () => {
    renderWithProviders(
      <PositionCard position={{ ...position, status: "closed" }} strategy={strategy} />,
    );
    expect(screen.getByText("Closed")).toBeInTheDocument();
    // POO-647: the redundant "Available to withdraw" pill is gone (the card taps through to detail).
    expect(screen.queryByText("Available to withdraw")).toBeNull();
    // POO-653: a closed position shows no rate at all — the Final APY metric is dropped entirely.
    expect(screen.queryByText("Final APR")).toBeNull();
    expect(screen.queryByText("Rate")).toBeNull();
    expect(screen.queryByText("7.4%")).toBeNull();
    // The remaining metrics still render (Invested / Total yield / Current value).
    expect(screen.getByText("$1,800.00")).toBeInTheDocument();
    expect(screen.getByText("+$250.00")).toBeInTheDocument();
    expect(screen.getByText("$2,050.00")).toBeInTheDocument();
    expect(screen.queryByText("Auto-compound")).not.toBeInTheDocument();
  });

  it("[R1] shows the Rate metric (APR/APY) for a non-closed position", () => {
    renderWithProviders(<PositionCard position={position} strategy={strategy} />);
    expect(screen.getByText("Rate")).toBeInTheDocument();
    expect(screen.getByText("7.4%")).toBeInTheDocument();
  });

  // POO-771 R6 (supersedes POO-745): the verified badge is gated on the backend-derived top-level
  // `strategy.managerVerified` (embedded via POO-758), NOT the prospectus `detail.managerVerified`.
  const detailBase = {
    lockupDays: 0,
    about: "x",
    composition: [],
    mandate: { assets: [], protocols: [], networks: [] },
    riskLimits: {
      maxDrawdown: [],
      leverage: "",
      rebalancing: "",
      liquidity: "",
      strategyType: "",
      benchmark: "",
      custody: "",
    },
    fees: { managementPct: 0, performancePct: 0 },
  };

  // @rule R6
  it("[R6] hides the verified badge when managerVerified is absent or false", () => {
    // No managerVerified (the common lean case) and an explicit false both hide the badge.
    const { unmount } = renderWithProviders(
      <PositionCard position={position} strategy={strategy} />,
    );
    expect(screen.queryByLabelText("Verified manager")).toBeNull();
    unmount();

    renderWithProviders(
      <PositionCard position={position} strategy={{ ...strategy, managerVerified: false }} />,
    );
    expect(screen.queryByLabelText("Verified manager")).toBeNull();
  });

  // @rule R6
  it("[R6] shows the verified badge only when managerVerified is true", () => {
    renderWithProviders(
      <PositionCard position={position} strategy={{ ...strategy, managerVerified: true }} />,
    );
    expect(screen.getByLabelText("Verified manager")).toBeInTheDocument();
  });

  // @rule R6: the source is the embedded flag, NOT the prospectus detail (the old gate).
  it("[R6] gates on managerVerified, not detail.managerVerified", () => {
    renderWithProviders(
      <PositionCard
        position={position}
        strategy={{ ...strategy, detail: { ...detailBase, managerVerified: true } }}
      />,
    );
    expect(screen.queryByLabelText("Verified manager")).toBeNull();
  });

  // @rule POO-840 R3 — the card body is pointer-events-none (the stretched link owns the tap),
  // which also killed the Rate/APR tooltips: despite the cursor-help/dotted affordance the tap
  // fell through to navigation. The triggers re-enable pointer events above the overlay link
  // (the ManagerLink precedent).
  it("[POO-840 R3] the Rate/APR tooltip triggers re-enable pointer events above the link", () => {
    renderWithProviders(<PositionCard position={position} strategy={strategy} />);
    // The "Rate" label expands to APR; the unit token is the fixture's APY.
    const triggers = [
      screen.getByRole("button", { name: "Annual Percentage Rate" }),
      screen.getByRole("button", { name: "Annual Percentage Yield" }),
    ];
    for (const trigger of triggers) {
      expect(trigger).toHaveClass("pointer-events-auto");
      expect(trigger).toHaveClass("relative");
      expect(trigger).toHaveClass("z-10");
    }
  });
});
