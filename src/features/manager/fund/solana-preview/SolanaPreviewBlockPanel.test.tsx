/** @id PP-MGR-CMP-089 @implements-rules-version v1 (POO-2290 host) */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { SolanaPreviewBlockPanel } from "./SolanaPreviewBlockPanel";

describe("local Kamino lending risk host", () => {
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
