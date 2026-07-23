/**
 * @id PP-DEP-CMP-002
 * @name AmountField — tests
 * Behavior: increment chips ADD to the current value; Max sets the full value.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { AmountField } from "./AmountField";

describe("AmountField", () => {
  it("adds increments and sets Max", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithProviders(
      <AmountField
        value="100"
        onValueChange={onValueChange}
        increments={[50, 100]}
        maxValue={500}
        maxLabel="Max"
        ariaLabel="Amount"
      />,
    );
    await user.click(screen.getByRole("button", { name: "+$50.00" }));
    expect(onValueChange).toHaveBeenCalledWith("150");
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(onValueChange).toHaveBeenCalledWith("500");
  });

  it("Max rounds to cents by default (fiat field)", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithProviders(
      <AmountField
        value=""
        onValueChange={onValueChange}
        increments={[50]}
        maxValue={38.005424}
        maxLabel="Max"
        ariaLabel="Amount"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(onValueChange).toHaveBeenCalledWith("38.01");
  });

  it("Max fills the exact balance at full token precision when maxFractionDigits is set", async () => {
    // POO-303: invest passes 6 (USDC decimals) so Max signs the real wallet balance, not 2dp.
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithProviders(
      <AmountField
        value=""
        onValueChange={onValueChange}
        increments={[50]}
        maxValue={38.005424}
        maxLabel="Max"
        ariaLabel="Amount"
        maxFractionDigits={6}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(onValueChange).toHaveBeenCalledWith("38.005424");
  });
});
