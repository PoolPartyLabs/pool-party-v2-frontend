/**
 * @id PP-CORE-MOD-010
 * @name BuyGasModal — tests
 * @implements-rules-version v3
 * Amount phase (default $10, CTA, Paybis), custom validation disabling the CTA, the pending handoff,
 * and a successful settle emitting the chosen gas. Uses fireEvent for the flow (see CollectModal.test).
 * POO-523: the settings gear (Max slippage 0.5/1/2 default 2% + deadline), slippage threading into
 * the gas build seam, and reset-on-close.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { BuyGasModal } from "./BuyGasModal";

vi.mock("./settle", () => ({
  settleOutcome: vi.fn(() => "success"),
  settleTxError: vi.fn(() => ({ code: "-32603", message: "execution reverted: mock" })),
  settleTxHash: vi.fn(() => "0xMOCK00000000000000000000000000000000MOCK"),
}));

function noop() {}

describe("BuyGasModal", () => {
  it("renders the amount phase with the $10 default, CTA, and Paybis footnote", () => {
    renderWithProviders(<BuyGasModal open onOpenChange={noop} />);
    expect(screen.getByRole("heading", { name: "Not enough gas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$10.00" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Add $10.00 gas" })).toBeEnabled();
    expect(screen.getByText("Powered by Paybis")).toBeInTheDocument();
  });

  it("keeps the CTA disabled until a custom amount is valid", () => {
    renderWithProviders(<BuyGasModal open onOpenChange={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: /^Add .* gas$/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Custom gas amount"), { target: { value: "5" } });
    expect(screen.getByRole("button", { name: /^Add .* gas$/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Custom gas amount"), { target: { value: "50" } });
    expect(screen.getByRole("button", { name: "Add $50.00 gas" })).toBeEnabled();
  });

  it("enters the pending handoff when the CTA is clicked", () => {
    renderWithProviders(<BuyGasModal open onOpenChange={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Add $10.00 gas" }));
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    expect(screen.getByText("Top up gas")).toBeInTheDocument();
  });

  it("settles to success and emits the chosen gas", async () => {
    const onDone = vi.fn();
    // Inject an immediate real-seam step (bypasses the 1200ms mock delay) — also exercises the
    // buildGasSteps path the gate uses in real mode.
    const buildGasSteps = () => [{ key: "topUpGas", run: async () => ({ txHash: "0xabc123" }) }];
    renderWithProviders(
      <BuyGasModal open onOpenChange={noop} onDone={onDone} buildGasSteps={buildGasSteps} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add $10.00 gas" }));
    // Assert the unique success body (the title "Gas added" appears twice: the sr-only sheet title +
    // the visible status title, matching the CollectModal pattern).
    expect(await screen.findByText("Your wallet is topped up and ready.")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith({ presetUsd: 10, amountUsd: 10 });
  });

  // @rule POO-523 R1 — the gear opens the shared settings with Max slippage (0.5/1/2) defaulting
  // to 2%; deadline renders whatever the shared dialog on main renders (standard props).
  it("renders the settings gear and opens the dialog with the 2% default highlighted", () => {
    renderWithProviders(<BuyGasModal open onOpenChange={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0.5%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2%" })).toHaveClass("border-primary");
    expect(screen.getByRole("button", { name: "0.5%" })).not.toHaveClass("border-primary");
  });

  // @rule POO-523 R2 — the chosen slippage threads into the gas top-up build seam (POO-414 rail).
  it("threads the chosen slippage into buildGasSteps", async () => {
    const buildGasSteps = vi.fn(() => [
      { key: "topUpGas", run: async () => ({ txHash: "0xabc123" }) },
    ]);
    renderWithProviders(<BuyGasModal open onOpenChange={noop} buildGasSteps={buildGasSteps} />);
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "0.5%" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Add $10.00 gas" }));
    await waitFor(() =>
      expect(buildGasSteps).toHaveBeenCalledWith({ presetUsd: 10, amountUsd: 10 }, 0.5),
    );
  });

  // @rule POO-523 R3 — closing the sheet resets the slippage to the 2% default (POO-513 policy).
  it("resets the slippage to the 2% default when the sheet closes", async () => {
    renderWithProviders(<BuyGasModal open onOpenChange={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "0.5%" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    // The close reset lands after a beat (150ms); reopen the gear and wait for the default.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2%" })).toHaveClass("border-primary"),
    );
    expect(screen.getByRole("button", { name: "0.5%" })).not.toHaveClass("border-primary");
  });
});
