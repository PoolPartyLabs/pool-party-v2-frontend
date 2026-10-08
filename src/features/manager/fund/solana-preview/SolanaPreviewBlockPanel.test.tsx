/** @id PP-MGR-CMP-089 @implements-rules-version v1 (POO-2290 host) */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { SolanaPreviewBlockPanel } from "./SolanaPreviewBlockPanel";

describe("local Holding and Jupiter hosts", () => {
  const handlers = {
    onEdit: vi.fn(),
    onApply: vi.fn(),
    onDiscard: vi.fn(),
    onClose: vi.fn(),
    onUnavailable: vi.fn(),
  };
  it("mounts custody inspection without inventing an origin, balance, risk or LP fields", () => {
    renderWithProviders(
      <SolanaPreviewBlockPanel
        block={{ id: "local-holding", protocol: "holding", allocationBps: 0, pair: "SOL / USDC" }}
        edit={{ allocation: "0", pair: "SOL / USDC" }}
        error={null}
        applied={false}
        {...handlers}
      />,
    );
    const holding = screen.getByRole("region", { name: "Holding" });
    expect(within(holding).getAllByText("Not available").length).toBeGreaterThan(0);
    expect(within(holding).getByRole("button", { name: "Buy" })).toBeDisabled();
    expect(within(holding).getByRole("button", { name: "Sell" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Price range" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Account risk" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collect" })).toBeNull();
    expect(screen.queryByText("Supply APY")).toBeNull();
  });
  it("mounts a separate Jupiter inspection without a fabricated quote or validity", () => {
    renderWithProviders(
      <SolanaPreviewBlockPanel
        block={{ id: "local-jupiter", protocol: "jupiter", allocationBps: 0, pair: "SOL / USDC" }}
        edit={{ allocation: "0", pair: "SOL / USDC" }}
        error={null}
        applied={false}
        {...handlers}
      />,
    );
    const quote = screen.getByRole("region", { name: "Jupiter Swap" });
    expect(within(quote).getByText("Quote details are unavailable.")).toBeVisible();
    expect(within(quote).queryByText("Valid")).toBeNull();
    expect(screen.queryByRole("region", { name: "Holding" })).toBeNull();
  });
});

describe("local Kamino lending risk host", () => {
  // @rule R3/R4: Configure supplies unavailable market/reserve reads, distinct from Supply USDC.
  it("mounts Market and Reserve metadata before allocation without invented options", () => {
    renderWithProviders(
      <SolanaPreviewBlockPanel
        block={{ id: "local-kamino", protocol: "kamino", allocationBps: 0, pair: "SOL / USDC" }}
        edit={{ allocation: "0", pair: "SOL / USDC" }}
        error={null}
        applied={false}
        onEdit={vi.fn()}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    const section = screen.getByRole("region", { name: "Supply USDC" });
    expect(within(section).getByText("Market")).toBeVisible();
    expect(within(section).getByText("Reserve")).toBeVisible();
    expect(within(section).getAllByText("Not available")).toHaveLength(8);
    const labels = section.textContent ?? "";
    expect(labels.indexOf("Reserve")).toBeLessThan(labels.indexOf("Allocation (%)"));
    expect(labels.indexOf("Allocation (%)")).toBeLessThan(labels.indexOf("Supply APY"));
    expect(within(section).queryByRole("combobox")).toBeNull();
  });
  it("shows unavailable full-account risk without no-debt or LP controls", () => {
    renderWithProviders(
      <SolanaPreviewBlockPanel
        block={{ id: "local-kamino", protocol: "kamino", allocationBps: 0, pair: "SOL / USDC" }}
        edit={{ allocation: "0", pair: "SOL / USDC" }}
        error={null}
        applied={false}
        onEdit={vi.fn()}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    const risk = screen.getByRole("region", { name: "Account risk" });
    expect(within(risk).getByText("Verified account risk is not available.")).toBeInTheDocument();
    expect(within(risk).queryByText("No debt")).not.toBeInTheDocument();
    expect(screen.queryByText(/No debt is drawn/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Min price|Max price/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collect" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Borrow|Multiply/)).not.toBeInTheDocument();
  });
});

describe("local Solana protocol range host", () => {
  it.each([
    "orca",
    "raydium",
  ] as const)("mounts %s range presentation without seeding a pool, price or tick draft", (protocol) => {
    renderWithProviders(
      <SolanaPreviewBlockPanel
        block={{ id: `local-${protocol}`, protocol, allocationBps: 500, pair: "SOL / USDC" }}
        edit={{ allocation: "5", pair: "SOL / USDC" }}
        error={null}
        applied={false}
        onEdit={vi.fn()}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    const range = screen.getByRole("region", { name: "Price range" });
    expect(within(range).getByRole("status")).toHaveTextContent("Not available");
    expect(within(range).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Account risk" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tick spacing: 64|0\.3%|1\.0000/)).not.toBeInTheDocument();
  });
  it("defers the range section when the local LP allocation is zero", () => {
    renderWithProviders(
      <SolanaPreviewBlockPanel
        block={{ id: "deferred-orca", protocol: "orca", allocationBps: 0, pair: "SOL / USDC" }}
        edit={{ allocation: "0", pair: "SOL / USDC" }}
        error={null}
        applied={false}
        onEdit={vi.fn()}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    expect(screen.queryByRole("region", { name: "Price range" })).not.toBeInTheDocument();
    expect(screen.queryByText("Composition")).not.toBeInTheDocument();
  });
});
