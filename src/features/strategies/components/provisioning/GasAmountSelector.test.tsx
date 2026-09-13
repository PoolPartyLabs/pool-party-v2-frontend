/**
 * @id PP-CORE-CMP-039
 * @name GasAmountSelector — tests
 * @implements-rules-version v3 (POO-1509 rules v1) · v2
 * Preset/custom selection, aria-pressed state, custom input reveal + validation helpers, and the
 * POO-1509 [R35] regression: the bound that rejects an amount is the bound the error text names.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { GasChoice } from "@/lib/provisioning";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { GasAmountSelector } from "./GasAmountSelector";
import type { GasFundingSource } from "./gasSelection";
import { selectPreset } from "./gasSelection";

function Harness({
  initial = null,
  balanceUsd = 1_000,
  source,
}: {
  initial?: GasChoice | null;
  balanceUsd?: number;
  source?: GasFundingSource;
}) {
  const [value, setValue] = useState<GasChoice | null>(initial);
  return (
    <GasAmountSelector
      value={value}
      onChange={setValue}
      balanceUsd={balanceUsd}
      {...(source === undefined ? {} : { source })}
    />
  );
}

describe("GasAmountSelector", () => {
  it("renders the $10 / $25 / Custom options", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$25.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
  });

  // @rule M5.2 (POO-1526) — the shared pill styling grows all three options together, so none of
  // the presets ends up misaligned with its Custom sibling.
  it("[M5.2] every pill (presets and Custom) carries an explicit 44pt touch target", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole("button", { name: "$10.00" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "$25.00" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Custom" })).toHaveClass("min-h-11");
  });

  it("marks the selected preset with aria-pressed", () => {
    renderWithProviders(<Harness initial={selectPreset(10)} />);
    expect(screen.getByRole("button", { name: "$10.00" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "$25.00" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selects another preset on click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={selectPreset(10)} />);
    await user.click(screen.getByRole("button", { name: "$25.00" }));
    expect(screen.getByRole("button", { name: "$25.00" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reveals the custom input when Custom is chosen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Custom gas amount")).toBeInTheDocument();
  });

  it("shows a below-min error for a custom amount under $10", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByLabelText("Custom gas amount"), "5");
    expect(screen.getByRole("alert")).toHaveTextContent("Minimum $10.00");
  });

  it("shows an over-max error for a custom amount above $200", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByLabelText("Custom gas amount"), "300");
    expect(screen.getByRole("alert")).toHaveTextContent("Maximum $200.00");
  });

  it("accepts a valid custom amount (no error)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByLabelText("Custom gas amount"), "50");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * REGRESSION, POO-1509 [R35]. The bound that rejected an amount was not the bound the user was
   * shown.
   *
   * `presets`, `minUsd` and `maxUsd` arrived as three independent props while `validateGas` was
   * called with NO source, so it always validated against the card floor ($10). Handed the on-chain
   * bounds, this component advertised `Minimum $5.00` in its error text and refused $7 anyway. Both
   * assertions below fail on the pre-POO-1509 component: the first on the message, the second because
   * an alert renders at all.
   */
  it("[R35] states the on-chain floor when the gas is converted from a holding", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness source="usdc" />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByLabelText("Custom gas amount"), "3");
    expect(screen.getByRole("alert")).toHaveTextContent("Minimum $5.00");
  });

  it("[R35] accepts an amount above the on-chain floor that the card floor would refuse", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness source="usdc" />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByLabelText("Custom gas amount"), "7");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[R35] offers $5 / $10 on the on-chain path and $10 / $25 on the card path", () => {
    const { unmount } = renderWithProviders(<Harness source="usdc" />);
    expect(screen.getByRole("button", { name: "$5.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$25.00" })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<Harness source="card" />);
    expect(screen.getByRole("button", { name: "$25.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$5.00" })).not.toBeInTheDocument();
  });
});
