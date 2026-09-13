/**
 * @id PP-CORE-CMP-070
 * @name GasTopUpBody — tests
 * @implements-rules-version v1 (POO-1509 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1509 rules v1):
 *   [R4]  `Not enough gas` is AUXILIARY: its own screen, reached when gas is the one thing missing,
 *         and it returns the user to whatever they were doing.
 *   [R35] the gas presets exist ONLY here, and they follow where the gas is paid from.
 *   [R36] the top-up converts a little of what the wallet already holds, and the copy says so.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GasChoice } from "@/lib/provisioning";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { GasTopUpBody, type GasTopUpBodyProps } from "./GasTopUpBody";
import type { GasFundingSource } from "./gasSelection";
import { selectPreset } from "./gasSelection";

function Harness({
  initial = selectPreset(10),
  source = "card",
  balanceUsd = 1_000,
  ...rest
}: {
  initial?: GasChoice | null;
  source?: GasFundingSource;
  balanceUsd?: number;
} & Partial<
  Pick<
    GasTopUpBodyProps,
    "onConfirm" | "onDismiss" | "confirmDisabled" | "ctaAmountUsd" | "children"
  >
>) {
  const [value, setValue] = useState<GasChoice | null>(initial);
  return (
    <GasTopUpBody
      value={value}
      onChange={setValue}
      balanceUsd={balanceUsd}
      source={source}
      onConfirm={rest.onConfirm ?? (() => {})}
      onDismiss={rest.onDismiss ?? (() => {})}
      {...(rest.confirmDisabled === undefined ? {} : { confirmDisabled: rest.confirmDisabled })}
      {...(rest.ctaAmountUsd === undefined ? {} : { ctaAmountUsd: rest.ctaAmountUsd })}
    >
      {rest.children}
    </GasTopUpBody>
  );
}

describe("GasTopUpBody (POO-1509)", () => {
  // @rule POO-1509 R36 — the note is the whole disclosure of how the top-up is paid for. Without it
  // the screen asks for money and never says where it comes from, and a user who has just been told
  // they have no gas reasonably assumes a card is next.
  it("[R36] says the top-up converts what the wallet already holds, with no card", () => {
    renderWithProviders(<Harness />);

    expect(screen.getByText(/convert a small part of what you already hold/i)).toBeInTheDocument();
    expect(screen.getByText(/no card needed/i)).toBeInTheDocument();
  });

  // @rule POO-1509 R35 — swapping a holding has no fiat floor, so it offers $5 / $10. The $10 / $25
  // pair is the PAYBIS minimum and belongs to the card path only (POO-1084 [F1-R4]).
  it("[R35] offers the on-chain presets when the gas is converted from a holding", () => {
    renderWithProviders(<Harness source="usdc" />);

    expect(screen.getByRole("button", { name: "$5.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$25.00" })).not.toBeInTheDocument();
  });

  it("[R35] offers the fiat presets when the gas has to be bought", () => {
    renderWithProviders(<Harness source="card" />);

    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$25.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$5.00" })).not.toBeInTheDocument();
  });

  // @rule POO-1509 R4 — the CTA names the amount it will add, so the irreversible act is legible
  // before it is taken. It is the same `provisioning.gas.cta` the standalone modal has always used.
  it("[R4] names the chosen amount on the CTA", () => {
    renderWithProviders(<Harness initial={selectPreset(25)} />);

    expect(screen.getByRole("button", { name: /add \$25\.00 gas/i })).toBeInTheDocument();
  });

  it("[R4] starts the top-up on confirm and leaves on dismiss", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    renderWithProviders(<Harness onConfirm={onConfirm} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: /add \$10\.00 gas/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /not now/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // @rule POO-1509 R35 — an amount that cannot execute must not be startable. The bound is the
  // SOURCE's, which is the defect this component closes: the selector advertised the source's floor
  // in its error text while validating against the card floor, so on the on-chain path a $7 custom
  // amount was rejected under a message that said the minimum was $5.
  it("[R35] blocks the CTA for an amount below the source's floor, and states that floor", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness source="usdc" initial={null} />);

    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByLabelText("Custom gas amount"), "3");

    expect(screen.getByRole("alert")).toHaveTextContent("Minimum $5.00");
    expect(screen.getByRole("button", { name: /add \$3\.00 gas/i })).toBeDisabled();
  });

  it("[R35] accepts an amount the source allows and the card path would not", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness source="usdc" initial={null} />);

    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByLabelText("Custom gas amount"), "7");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add \$7\.00 gas/i })).toBeEnabled();
  });

  // @rule POO-1509 R4: a host whose executed amount is NOT the edited value (the panel: only an
  // explicit valid choice resizes the plan) hands the executed figure in, and the CTA prints it
  // while validity, and so whether the CTA is enabled, still follows the edited value.
  it("[R4] prints the host's executed figure on the CTA when one is provided", () => {
    renderWithProviders(<Harness initial={selectPreset(10)} ctaAmountUsd={0.08} />);

    const cta = screen.getByTestId("gas-topup-confirm");
    expect(cta).toHaveTextContent("Add $0.08 gas");
    // The $10 preset is a valid choice, so the executed-figure override does not disable anything.
    expect(cta).toBeEnabled();
  });

  // The host's own gates (the POO-1047 price-impact acknowledgement) render inside the body and can
  // block the CTA. Auxiliary does not mean ungated: this screen still signs a swap.
  it("lets the host block the CTA and render its own gate above it", () => {
    renderWithProviders(
      <Harness confirmDisabled={true}>
        <p>Price impact is high</p>
      </Harness>,
    );

    expect(screen.getByText("Price impact is high")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add \$10\.00 gas/i })).toBeDisabled();
  });
});
