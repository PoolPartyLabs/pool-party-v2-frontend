/**
 * @id PP-DEP-MOD-001 — tests
 * @name PaymentMethodDialog — tests
 * @implements-rules-version v3 (POO-1609 rules v2) · v2 (POO-1513 rules v1)
 *
 * The picker is built from the LIVE Paybis list, not from a local union. What is pinned here is
 * everything the hardcoded four made impossible (POO-1513 S1):
 *
 *   - the rows are whatever the provider resolved for the buyer's currency, under their real
 *     `displayName`, so a European is not offered Pix and an Android user is not denied Google Pay;
 *   - each row carries its OWN minimum in its OWN currency (`minCurrencyCode`), through `formatFiat`
 *     and never `formatUsd`, which would print `$20.00` for a EUR 20 floor;
 *   - a per-method charge appears ONLY when the quote already carried one (POO-1576 Q1: opportunistic,
 *     never a call per method);
 *   - an empty or unreadable list neither blocks nor goes silent: it says the PROVIDER returned
 *     nothing and Continue still works on the existing prefill.
 *
 * The blocked-row rule itself (POO-1609) is pinned on the shared `PaymentMethodList`
 * (`PaymentMethodList.test.tsx`); these fixtures use EUR floors well under the amounts exercised
 * here, so none of them cross a floor and this suite stays about the dialog's own chrome.
 */
import { describe, expect, it, vi } from "vitest";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { PaymentMethodDialog } from "./PaymentMethodDialog";

const CARD: OnRampPaymentMethod = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Credit Card",
  minUsd: 10,
  minCurrencyCode: "EUR",
};
const SEPA: OnRampPaymentMethod = {
  paymentMethod: "poolparty-sepa",
  displayName: "SEPA Transfer",
  minUsd: 20,
  minCurrencyCode: "EUR",
};

describe("PaymentMethodDialog (POO-1513 S1)", () => {
  it("renders the live list under the provider's own names, never the hardcoded four", () => {
    renderWithProviders(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        methods={[CARD, SEPA]}
        value={CARD.paymentMethod}
        onSelect={vi.fn()}
        onContinue={vi.fn()}
        enteredAmount={100}
      />,
    );
    expect(screen.getByRole("radio", { name: /Credit Card/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /SEPA Transfer/ })).toBeInTheDocument();
    // Pix is a Brazil-only method that the hardcoded union showed to every buyer everywhere.
    expect(screen.queryByRole("radio", { name: /Pix/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Apple Pay/ })).toBeNull();
  });

  // Each method's minimum is denominated in the currency the list was RESOLVED for (POO-1512 [R7]),
  // so `formatUsd` would print a dollar sign in front of a euro floor.
  it("prints each row's own minimum in its own currency", () => {
    renderWithProviders(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        methods={[CARD, SEPA]}
        value={CARD.paymentMethod}
        onSelect={vi.fn()}
        onContinue={vi.fn()}
        enteredAmount={100}
      />,
    );
    expect(screen.getByText("Minimum €20.00")).toBeInTheDocument();
    expect(screen.getByText("Minimum €10.00")).toBeInTheDocument();
    expect(screen.queryByText(/\$20\.00/)).toBeNull();
  });

  it("reports the Paybis identifier of the row the user picked", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        methods={[CARD, SEPA]}
        value={CARD.paymentMethod}
        onSelect={onSelect}
        onContinue={vi.fn()}
        enteredAmount={100}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /SEPA Transfer/ }));
    expect(onSelect).toHaveBeenCalledWith("poolparty-sepa");
  });

  // POO-1576 Q1: names and minimums are the content. A charge is rendered only when the quote we
  // were already making happens to carry one, and it belongs to the SELECTED row alone.
  it("shows a per-method charge only for the selected row, and only when the quote carried one", () => {
    const { rerender } = renderWithProviders(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        methods={[CARD, SEPA]}
        value={CARD.paymentMethod}
        onSelect={vi.fn()}
        onContinue={vi.fn()}
        enteredAmount={100}
      />,
    );
    expect(screen.queryByText(/You pay/)).toBeNull();

    rerender(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        methods={[CARD, SEPA]}
        value={CARD.paymentMethod}
        charges={{ [CARD.paymentMethod]: { amount: 103.4, currencyCode: "EUR" } }}
        onSelect={vi.fn()}
        onContinue={vi.fn()}
        enteredAmount={100}
      />,
    );
    // Exactly one row carries it: the one the quote priced.
    expect(screen.getAllByText("You pay €103.40")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /Credit Card[\s\S]*103\.40/ })).toBeInTheDocument();
  });

  /**
   * POO-1576 Q3: "vanishing is fine, but the empty state needs to inform the user that the provider
   * didn't give us any quotes so the user knows it's not a problem with our platform." So: not a dead
   * end, not a silent skip, and the attribution is explicit.
   */
  it("informs, attributes to the provider and still continues when the list is unreadable", () => {
    const onContinue = vi.fn();
    renderWithProviders(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        onContinue={onContinue}
        enteredAmount={100}
      />,
    );
    expect(screen.getByText(/Paybis did not return/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalled();
  });

  it("treats an empty list exactly like an unreadable one", () => {
    renderWithProviders(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        methods={[]}
        onSelect={vi.fn()}
        onContinue={vi.fn()}
        enteredAmount={100}
      />,
    );
    expect(screen.getByText(/Paybis did not return/)).toBeInTheDocument();
  });

  // The old picker's contract, kept: no fee percentages here (POO-1513 S3 deleted the model that
  // produced them, and the review step is where money figures live).
  it("never shows a fee percentage", () => {
    renderWithProviders(
      <PaymentMethodDialog
        open
        onOpenChange={vi.fn()}
        methods={[CARD, SEPA]}
        value={CARD.paymentMethod}
        onSelect={vi.fn()}
        onContinue={vi.fn()}
        enteredAmount={100}
      />,
    );
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
