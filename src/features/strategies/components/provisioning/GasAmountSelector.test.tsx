/**
 * @id PP-CORE-CMP-039
 * @name GasAmountSelector — tests
 * @implements-rules-version v2
 * Preset/custom selection, aria-pressed state, custom input reveal + validation helpers.
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
import { selectPreset } from "./gasSelection";

function Harness({
  initial = null,
  balanceUsd = 1_000,
}: {
  initial?: GasChoice | null;
  balanceUsd?: number;
}) {
  const [value, setValue] = useState<GasChoice | null>(initial);
  return <GasAmountSelector value={value} onChange={setValue} balanceUsd={balanceUsd} />;
}

describe("GasAmountSelector", () => {
  it("renders the $10 / $25 / Custom options", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$25.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
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
});
