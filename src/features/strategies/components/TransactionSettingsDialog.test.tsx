/**
 * @id PP-STR-MOD-007
 * @name TransactionSettingsDialog — tests
 * Behavior: slippage presets + custom value and receive-as selection each call their change
 * handler; the receive options render from the manager-defined list. POO-513: the custom field is
 * derived from the slippage prop (R1), accepts decimals with a dot or comma (R3), and the deadline
 * renders as a disabled coming-soon field (R4).
 */
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { TransactionSettingsDialog } from "./TransactionSettingsDialog";

function setup(overrides?: Partial<Parameters<typeof TransactionSettingsDialog>[0]>) {
  const onSlippageChange = vi.fn();
  const onDeadlineChange = vi.fn();
  const onReceiveAsChange = vi.fn();
  const onOpenChange = vi.fn();
  renderWithProviders(
    <TransactionSettingsDialog
      open
      onOpenChange={onOpenChange}
      slippage={0.5}
      onSlippageChange={onSlippageChange}
      deadlineMins={30}
      onDeadlineChange={onDeadlineChange}
      receiveAs="USDC"
      onReceiveAsChange={onReceiveAsChange}
      receiveOptions={["USDC", "USDT", "DAI"]}
      {...overrides}
    />,
  );
  return { onSlippageChange, onDeadlineChange, onReceiveAsChange, onOpenChange };
}

describe("TransactionSettingsDialog", () => {
  // POO-463 R1: the presets are 0.5 / 1 / 2 (the old 0.1 is gone; Custom covers outliers).
  it("renders the 0.5 / 1 / 2 preset buttons (POO-463 R1)", () => {
    setup();
    expect(screen.getByRole("button", { name: "0.5%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2%" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "0.1%" })).not.toBeInTheDocument();
  });

  it("selects a slippage preset", () => {
    const { onSlippageChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "2%" }));
    expect(onSlippageChange).toHaveBeenCalledWith(2);
  });

  // POO-403 R6: 0-100 accepted, one decimal; clamps above 100; no "000" artifact.
  it("accepts a custom slippage (0-100, one decimal) and clamps above 100", () => {
    const { onSlippageChange } = setup();
    const custom = screen.getByLabelText("Custom");
    fireEvent.change(custom, { target: { value: "2.5" } });
    expect(onSlippageChange).toHaveBeenCalledWith(2.5);
    // 0-100 is allowed now (warnings replace the small hard cap).
    fireEvent.change(custom, { target: { value: "99" } });
    expect(onSlippageChange).toHaveBeenCalledWith(99);
    // Above 100 clamps to 100.
    fireEvent.change(custom, { target: { value: "150" } });
    expect(onSlippageChange).toHaveBeenLastCalledWith(100);
  });

  it("normalizes a leading-zero entry so '000' reads as 0 (the reported bug)", () => {
    const { onSlippageChange } = setup();
    const custom = screen.getByLabelText("Custom");
    fireEvent.change(custom, { target: { value: "000" } });
    expect(onSlippageChange).toHaveBeenLastCalledWith(0);
    expect(custom).toHaveValue("0");
  });

  // POO-547 R1: every flow now shares the 100 default max (the per-flow 5% caps are gone). A decimal
  // above 5% is accepted (no clamp until 100), so the same custom field behaves identically in
  // Move Range / Close / Create Pool / managed Collect and every investor flow.
  it("accepts a custom slippage above 5% with the shared 100 default max (POO-547 R1)", () => {
    const { onSlippageChange } = setup();
    const custom = screen.getByLabelText("Custom");
    // 12.5% used to be clamped to the manager 5% cap; now it passes through untouched.
    fireEvent.change(custom, { target: { value: "12.5" } });
    expect(onSlippageChange).toHaveBeenLastCalledWith(12.5);
    expect(onSlippageChange).not.toHaveBeenCalledWith(5);
    // Right up to the 100 default max.
    fireEvent.change(custom, { target: { value: "80" } });
    expect(onSlippageChange).toHaveBeenLastCalledWith(80);
  });

  // POO-547 R4: the 0.1% floor is applied on commit (onBlur), not per keystroke, and NOT inside
  // sanitizeSlippageInput — so an in-progress "0." stays typeable while focused.
  it("keeps an in-progress '0.' typeable while focused (no premature floor) (POO-547 R4)", () => {
    setup();
    const custom = screen.getByLabelText("Custom");
    fireEvent.change(custom, { target: { value: "0." } });
    // The intermediate decimal survives — the floor does not fire on change.
    expect(custom).toHaveValue("0.");
  });

  // POO-547 R4: a below-floor value can reach the field via an external (non-preset) seed
  // (seedCustomText stringifies the prop without sanitizing). On blur it snaps up to the 0.1 floor,
  // in both the field and the committed value.
  it("floors a below-floor seeded value to 0.1 on blur (POO-547 R4)", () => {
    const onSlippageChange = vi.fn();
    renderWithProviders(
      <TransactionSettingsDialog
        open
        onOpenChange={vi.fn()}
        slippage={0.05}
        onSlippageChange={onSlippageChange}
      />,
    );
    const custom = screen.getByLabelText("Custom");
    // The external seed shows the raw 0.05 before commit.
    expect(custom).toHaveValue("0.05");
    fireEvent.blur(custom);
    // On blur the value snaps up to the 0.1 floor, in the field and the reported value.
    expect(custom).toHaveValue("0.1");
    expect(onSlippageChange).toHaveBeenLastCalledWith(0.1);
  });

  it("leaves an at-or-above-floor value untouched on blur (POO-547 R4)", () => {
    const { onSlippageChange } = setup();
    const custom = screen.getByLabelText("Custom");
    fireEvent.change(custom, { target: { value: "0.5" } });
    onSlippageChange.mockClear();
    fireEvent.blur(custom);
    // No re-floor: 0.5 >= 0.1, so the value and field stay put (no extra onSlippageChange for a snap).
    expect(custom).toHaveValue("0.5");
    expect(onSlippageChange).not.toHaveBeenCalled();
  });

  it("leaves an empty custom field empty on blur so it falls back to the seed (POO-547 R4)", () => {
    const { onSlippageChange } = setup();
    const custom = screen.getByLabelText("Custom");
    fireEvent.change(custom, { target: { value: "2" } });
    fireEvent.change(custom, { target: { value: "" } });
    onSlippageChange.mockClear();
    fireEvent.blur(custom);
    expect(custom).toHaveValue("");
    // Empty must NOT be floored to 0.1 (the host's default seed applies instead).
    expect(onSlippageChange).not.toHaveBeenCalledWith(0.1);
  });

  // POO-403 R6: High (> 5%) / Very high (> 20%) slippage warnings.
  it("warns on high slippage above 5%", () => {
    setup({ slippage: 10 });
    expect(screen.getByText("High slippage")).toBeInTheDocument();
    expect(screen.queryByText("Very high slippage")).not.toBeInTheDocument();
  });

  it("escalates to a very-high warning above 20%", () => {
    setup({ slippage: 25 });
    expect(screen.getByText("Very high slippage")).toBeInTheDocument();
  });

  it("shows no slippage warning at a safe value", () => {
    setup({ slippage: 0.5 });
    expect(screen.queryByText("High slippage")).not.toBeInTheDocument();
    expect(screen.queryByText("Very high slippage")).not.toBeInTheDocument();
  });

  // @rule POO-513 R1: the custom field is DERIVED from the slippage prop: when the host changes
  // it from outside (e.g. the reset-on-close in every flow modal, while this component stays
  // mounted), a stale custom text is re-seeded so the gear can never display a custom value
  // different from the effective slippage (the reported 1.7-shown / 2-built desync).
  it("re-seeds the custom field when the slippage prop changes from outside (POO-513 R1)", () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      onSlippageChange: vi.fn(),
    };
    const { rerender } = renderWithProviders(
      <TransactionSettingsDialog {...props} slippage={1.7} />,
    );
    expect(screen.getByLabelText("Custom")).toHaveValue("1.7");
    // Host resets to the preset default (Collect's close reset): the custom text clears.
    rerender(<TransactionSettingsDialog {...props} slippage={2} />);
    expect(screen.getByLabelText("Custom")).toHaveValue("");
    // An external non-preset value (the manager 5% default) re-seeds as custom text.
    rerender(<TransactionSettingsDialog {...props} slippage={5} />);
    expect(screen.getByLabelText("Custom")).toHaveValue("5");
  });

  // @rule POO-513 R3: a comma decimal separator (pt-BR and most EU keyboard layouts) is read as
  // the decimal point instead of being dropped ("1,7" used to collapse to 17).
  it("accepts a comma as the decimal separator (POO-513 R3)", () => {
    const { onSlippageChange } = setup();
    const custom = screen.getByLabelText("Custom");
    fireEvent.change(custom, { target: { value: "1,7" } });
    expect(onSlippageChange).toHaveBeenLastCalledWith(1.7);
    expect(custom).toHaveValue("1.7");
  });

  // @rule POO-513 R4: no build consumes the deadline yet, so the field renders as coming soon:
  // disabled input + badge, and the hint stops promising cancellation.
  it("renders the deadline as coming soon: disabled input + badge (POO-513 R4)", () => {
    setup();
    const input = screen.getByLabelText("Transaction deadline");
    expect(input).toBeDisabled();
    expect(input).toHaveValue(30);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Custom deadlines are coming soon. Transactions currently use a standard deadline.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Cancels the transaction if it hasn't confirmed within this time."),
    ).not.toBeInTheDocument();
  });

  it("renders the manager-defined receive options and selects one", () => {
    const { onReceiveAsChange } = setup();
    expect(screen.getByRole("button", { name: "DAI" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "USDT" }));
    expect(onReceiveAsChange).toHaveBeenCalledWith("USDT");
  });

  it("closes via Done", () => {
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // @rule POO-842 R3: at 375px the shared 4-column cell leaves ~48px for the custom input — the
  // en placeholder barely fits and pt-BR "Personalizado" is unreadable. Below sm the custom field
  // takes its own full-width row (col-span-3 under grid-cols-3); sm+ keeps the 4-column row.
  it("[POO-842 R3] the custom slippage field takes its own full-width row below sm", () => {
    setup();
    const custom = screen.getByLabelText("Custom");
    const cell = custom.parentElement;
    expect(cell).toHaveClass("col-span-3");
    expect(cell).toHaveClass("sm:col-span-1");
    const grid = cell?.parentElement;
    expect(grid).toHaveClass("grid-cols-3");
    expect(grid).toHaveClass("sm:grid-cols-4");
  });
});
