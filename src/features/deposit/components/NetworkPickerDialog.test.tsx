/**
 * @id PP-DEP-MOD-002 (POO-479, POO-728)
 * @name NetworkPickerDialog — tests
 * Behavior: lists the deposit networks; selecting one reports it; Continue stays disabled until a
 * network is chosen, then advances.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { DEPOSIT_NETWORKS } from "../lib/depositNetworks";
import { NetworkPickerDialog } from "./NetworkPickerDialog";

const base = DEPOSIT_NETWORKS.find((n) => n.slug === "base") ?? null;

describe("NetworkPickerDialog", () => {
  it("lists all deposit networks", () => {
    renderWithProviders(
      <NetworkPickerDialog
        open
        onOpenChange={vi.fn()}
        value={null}
        onSelect={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByText("Choose a network")).toBeInTheDocument();
    for (const network of DEPOSIT_NETWORKS) {
      expect(screen.getByRole("radio", { name: network.name })).toBeInTheDocument();
    }
  });

  it("keeps Continue disabled until a network is chosen and reports the selection", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <NetworkPickerDialog
        open
        onOpenChange={vi.fn()}
        value={null}
        onSelect={onSelect}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Base" }));
    expect(onSelect).toHaveBeenCalledWith(base);
  });

  it("enables Continue and advances once a network is selected", () => {
    const onContinue = vi.fn();
    renderWithProviders(
      <NetworkPickerDialog
        open
        onOpenChange={vi.fn()}
        value={base}
        onSelect={vi.fn()}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByRole("radio", { name: "Base" })).toBeChecked();
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).not.toBeDisabled();
    fireEvent.click(continueBtn);
    expect(onContinue).toHaveBeenCalled();
  });
});
