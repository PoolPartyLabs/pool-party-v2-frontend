/**
 * @id PP-DEP-MOD-001
 * @name PaymentMethodDialog — tests
 * Behavior: selecting a method reports it; Continue advances; no fee text is shown in the picker.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { PaymentMethodDialog } from "./PaymentMethodDialog";

describe("PaymentMethodDialog", () => {
  it("selects a method and continues without showing fees", () => {
    const onSelect = vi.fn();
    const onContinue = vi.fn();
    renderWithProviders(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        value="pix"
        onSelect={onSelect}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByText("Payment method")).toBeInTheDocument();
    // No fees in the picker.
    expect(screen.queryByText(/%/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Card/ }));
    expect(onSelect).toHaveBeenCalledWith("card");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });
});
