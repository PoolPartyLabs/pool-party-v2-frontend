/**
 * @id PP-CORE-LIB-101 (POO-1609)
 * @name on-ramp method-floor comparison
 * @implements-rules-version v1
 *
 * Whether a payment method's provider-set minimum exceeds the order, and therefore whether that row
 * renders BLOCKED. One mechanism for both surfaces that render a payment-method row (`/deposit`'s
 * `PaymentMethodList`, PP-DEP-CMP-005, and any future host), so the rule is computed once and cannot
 * mean two different things in two places. Pure and React-free for that reason alone: the pickers
 * differ, the comparison does not.
 *
 * ## Reversed twice on 2026-08-14. This is the second reversal, and it stands.
 *
 * The shipped behaviour (PR #876, POO-1513) RAISED the order to a method's minimum on selection. That
 * is deleted, not gated: "the charge is never raised... the payment method must stay BLOCKED with a
 * message explaining it" (murilo, 2026-08-14). A method whose minimum exceeds the order is shown, in
 * its normal position, never hidden and never reordered; it simply cannot be selected.
 *
 * ## The two tiers, and why the second is not a fallback of convenience
 *
 * **Tier 1 — the row carries a charge.** Since POO-1599 the listing quote prices every method for the
 * pair in one call, and both figures this compares are denominated in the currency the flow resolved
 * (the quote echoes `currencyCodeFrom`, the floor rides `minCurrencyCode` from the same resolution).
 * Exact, no currency guard needed.
 *
 * **Tier 2 — the row carries NO charge.** The gas-first buyer is never quoted
 * (`pricingEnabled: !gasFirst`, `DepositScreen.tsx`), so tier 1 is unavailable to exactly the buyer
 * POO-1573 calls "the canonical on-ramp user". This is the common case for that buyer, not a rare
 * fallback, which is why it is a full tier and not an afterthought.
 *
 * The currency guard applies to TIER 2 ONLY: the entered amount is USDC (received-fixed, POO-729), so
 * it is compared against a floor only when that floor is itself USD-denominated. A floor in another
 * currency cannot be compared without an FX source the app does not have (POO-333), and the app errs
 * toward NOT blocking: a method wrongly blocked removes an option the buyer could have used, while a
 * method wrongly offered is recoverable at checkout.
 *
 * ## Two earlier drafts were wrong, recorded so nobody rebuilds them
 *
 * The first exempted the gas-first buyer entirely, by confusing the charge with the floor. The second
 * was tier 2 alone with the currency guard, which was implementable but threw away the precision
 * POO-1599 had just made available for every buyer who IS quoted. The live rule is both tiers, in
 * this order: tier 1 whenever a charge exists, tier 2 only when it does not.
 *
 * An imprecision tier 2 carries, deliberately: it blocks slightly early relative to what tier 1 would
 * say once fees are added (an order between `floor / (1 + markup)` and `floor` clears the floor after
 * the markup but is blocked anyway). Accepted rather than hidden.
 */

/** The fields this comparison reads off a payment method. Satisfied by `OnRampPaymentMethod`. */
export interface MethodFloorCandidate {
  paymentMethod: string;
  /** The method's own minimum, in {@link minCurrencyCode}. Non-positive means "no floor at all". */
  minUsd: number;
  minCurrencyCode: string;
}

/** The row's own charge (tier 1), when the quote priced it. */
export interface MethodFloorCharge {
  amount: number;
  currencyCode: string;
}

/**
 * Do two fiat codes name the SAME currency? Case- and padding-insensitive, because a currency code is
 * an identifier and `" usd"` is USD. A code that names nothing, absent or blank, is never a match: an
 * unresolved denomination is not a shared one.
 *
 * **Exported because it is the ONE such rule on this surface (POO-1632).** A second copy lived in
 * `onRampMethodRows.ts` (PP-STR-LIB-022), whose own comment named this file as the shared home it was
 * waiting on; this file landed and the comment went stale, which is the drift POO-1632 exists to stop.
 * Two currency-equality rules on one money screen is the same failure class as the two row builders.
 *
 * The convergence takes the STRICTER semantics, which were the row builder's. This copy answered
 * `true` for two blank codes (`"" === ""`), unreachable from its own call site below, where the second
 * operand is the literal `"USD"`. On the ROW builder's call site both operands come off the wire:
 * `minCurrencyCode` rides the METHODS call and `chargeCurrencyCode` rides the QUOTE, so a payload with
 * both blank would have licensed a comparison between two figures whose denomination nothing
 * established. This app has no FX source at all (POO-333), so the fail direction is fixed: an
 * incomparable pair is never treated as comparable.
 */
export function sameFiat(a: string | undefined, b: string | undefined): boolean {
  const left = a?.trim().toUpperCase() ?? "";
  const right = b?.trim().toUpperCase() ?? "";
  return left !== "" && left === right;
}

/**
 * Is this method's own minimum ABOVE what the buyer is being asked to pay right now?
 *
 * @param method the row's own minimum, in its own currency.
 * @param charge the row's own charge, when the quote priced it (tier 1). A non-positive figure is not
 *   a price (a quote's total is never legitimately zero); this falls back to tier 2 exactly as an
 *   absent charge does, rather than reading a failed figure as "free".
 * @param enteredAmount the buyer's typed amount (USDC, received-fixed), read only on tier 2.
 */
export function isMethodBelowFloor({
  method,
  charge,
  enteredAmount,
}: {
  method: MethodFloorCandidate;
  charge?: MethodFloorCharge;
  enteredAmount: number;
}): boolean {
  if (!(method.minUsd > 0)) return false;

  if (charge !== undefined && charge.amount > 0) {
    return charge.amount < method.minUsd;
  }

  if (!sameFiat(method.minCurrencyCode, "USD")) return false;
  return enteredAmount < method.minUsd;
}

/**
 * The method carrying the LOWEST positive floor in the list, for `method.allBlocked`'s `{amount}` when
 * every row is blocked. Methods with no floor (`minUsd <= 0`) never win: they name nothing to raise
 * toward. `undefined` when nothing in the list has a floor at all.
 */
export function lowestFloor(
  methods: readonly MethodFloorCandidate[],
): MethodFloorCandidate | undefined {
  return methods.reduce<MethodFloorCandidate | undefined>((lowest, method) => {
    if (!(method.minUsd > 0)) return lowest;
    if (lowest === undefined || method.minUsd < lowest.minUsd) return method;
    return lowest;
  }, undefined);
}
