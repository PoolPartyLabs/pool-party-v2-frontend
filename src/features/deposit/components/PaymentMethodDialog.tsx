/**
 * @id PP-DEP-MOD-001
 * @name PaymentMethodDialog
 * @implements-rules-version v5 (POO-1612 rules v1) · v4 (POO-1609 rules v1) · v3 (POO-1612 rules v1) · v2 (POO-1513 rules v1) · v1 (POO-494)
 *
 * POO-1612 S1: the rows themselves now live in {@link PaymentMethodList}, shared with the inline
 * payment-method section the amount step renders at `lg` and above. This dialog stays the mobile /
 * below-`lg` host: chrome (title, Continue) plus the list. POO-1609's blocked row (rules v2) moved
 * with them, unchanged: this dialog still owns no money rule and still forwards the host's refusals.
 *
 * Step 2 of the fiat on-ramp: pick a Paybis payment method (bottom sheet on mobile, centered dialog on
 * desktop). Since POO-1513 the rows are the LIVE list `getOnRampPaymentMethodsAction` resolved for the
 * buyer's own currency, not a local `"pix" | "card" | "applePay" | "bank"` union.
 *
 * ## Why the hardcoded four had to go
 *
 * They were neither country-filtered nor availability-checked, so a European was offered Pix (a
 * Brazil-only method, and the DEFAULT selection for every buyer in every country) while an Android
 * buyer was not offered Google Pay (POO-1455). The provider already answers that question per resolved
 * currency; the picker now asks it.
 *
 * ## What a row says, and what it deliberately does not (POO-1576 Q1)
 *
 * Names and minimums are the content. A per-method charge is rendered OPPORTUNISTICALLY, only when the
 * quote the flow was already making happens to carry one, and therefore only for the SELECTED row.
 *
 * POO-1599 retired the reason this used to give. "A quote prices ONE method" was our own constraint,
 * not the vendor's: `paymentMethod` is OPTIONAL on `POST /v2/quote`, and omitted, the answer carries a
 * figure for every method the pair offers, in the SAME single upstream POST against the same
 * per-API-key throttle. So the payload behind this dialog can price every row. It still shows one,
 * because the host publishes the charge for the method the flow is priced against; widening that is
 * POO-1576/S2's call, not a limit of the quote.
 *
 * Every money figure goes through `formatFiat` with its OWN currency code, never `formatUsd`. Since
 * POO-1512 the list is fetched in the buyer's resolved currency, so `minUsd` keeps its historical name
 * while carrying (say) euros, and `formatUsd` would print `$20.00` in front of a EUR 20 floor.
 *
 * ## A row below its provider's floor is REFUSED, never raised (POO-1609 [S2], rules v2)
 *
 * "A cobrança nunca é elevada": the charge is never raised. Where this picker used to let the host
 * scale the buyer's order up to the floor of the method they tapped, a row the host reports as
 * blocked now renders at reduced emphasis, in its own position, with `method.blocked` INSTEAD OF its
 * minimum, and cannot become the host's `value`.
 *
 * It keeps its radio and stays focusable, marked `aria-disabled` and never `disabled`: a `disabled`
 * control leaves the tab order, and a method a screen-reader user can neither reach nor hear
 * announced is worse than one they hear is unavailable and why. Never hidden and never reordered,
 * so the buyer can see the method exists and what it would take to reach it (POO-1576 Q2 survives
 * the reversal; only the raise dies).
 *
 * The comparison is the HOST's: this component is handed identifiers and owns no money rule.
 *
 * ## An empty or unreadable list informs, it never blocks (POO-1576 Q3)
 *
 * "Vanishing is fine, but the empty state needs to inform the user that the provider didn't give us any
 * quotes so the user knows it's not a problem with our platform." So the step neither dead-ends nor
 * silently disappears: it attributes the gap to the provider and Continue still proceeds on the
 * existing prefill (`pickDefaultPaymentMethod` inside the rail).
 *
 * PP-NOTE: the QUOTE still publishes no loading discriminator, by design (it degrades, it never
 * blocks, and never shows a spinner that traps the user). The LIST is a different question and became
 * one when the buyer gained a currency control: POO-1618 added `methodsLoading` and POO-1630 forwards
 * it here, so a reload renders a skeleton rather than "the provider returned nothing". Absent it,
 * "still resolving" and "unreadable" still render the same informational state, which stays correct
 * for a host that cannot trigger a reload.
 *
 * PP-INTEGRATION-POINT: the rows are the live Paybis method list, supplied by the host from
 * `useBuyRouteQuote` (`getOnRampPaymentMethodsAction`, PP-CORE-LIB-063).
 */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import { type PaymentMethodCharge, PaymentMethodList } from "./PaymentMethodList";

/** Re-exported so existing importers of the charge shape do not have to know it moved. */
export type { PaymentMethodCharge };

/** Public props for {@link PaymentMethodDialog}. */
export interface PaymentMethodDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /**
   * The live methods for the buyer's resolved currency. `undefined` while unresolved and when the list
   * could not be read: both render the informational state, never a blocker (see the header).
   */
  methods?: OnRampPaymentMethod[];
  /** The Paybis identifier currently selected (the buyer's choice, or the list-derived default). */
  value?: string;
  /** Called with the Paybis identifier of the row the buyer activated, blocked or not. */
  onSelect: (paymentMethod: string) => void;
  /** Called when Continue is pressed (advance to Review). Enabled in every state. */
  onContinue: () => void;
  /** Every row's own charge, keyed by Paybis identifier, when the quote priced it (POO-1612). */
  charges?: Record<string, PaymentMethodCharge>;
  /** POO-1630: a methods call is in flight, so an empty list is "not yet". Forwarded to the list. */
  loading?: boolean;
  /** The buyer's entered amount (USDC), for the blocked-row tier-2 comparison on an unpriced row. */
  enteredAmount: number;
}

/** Payment-method picker dialog, built from the live Paybis list. */
export function PaymentMethodDialog({
  open,
  onOpenChange,
  methods,
  value,
  onSelect,
  onContinue,
  charges,
  enteredAmount,
  loading,
}: PaymentMethodDialogProps) {
  const t = useTranslations("deposit");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("method.title")}</DialogTitle>
        </DialogHeader>

        {/*
          POO-1609 [S2]: `charges` and `enteredAmount` are forwarded, not dropped. This dialog is
          chrome around the list, and the one thing chrome must not do is starve the blocked-row
          comparison of an input on its way through: with no `charges` every row falls to tier 2, and
          with the wrong `enteredAmount` the floor is compared against an order nobody placed.
        */}
        <PaymentMethodList
          {...(methods === undefined ? {} : { methods })}
          {...(value === undefined ? {} : { value })}
          {...(charges === undefined ? {} : { charges })}
          enteredAmount={enteredAmount}
          onSelect={onSelect}
          loading={loading ?? false}
        />

        <Button className="w-full" size="lg" onClick={onContinue}>
          {t("method.continue")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
