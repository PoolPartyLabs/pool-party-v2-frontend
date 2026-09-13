/**
 * @id PP-STR-LIB-022 (POO-1576, POO-1129)
 * @name onRampMethodRows
 * @implements-rules-version v3 (POO-1666 rules v1) · v2 (POO-1129 rules v1) · v1 (POO-1576 rules v1)
 *
 * One row of the "Choose how to pay" step: a Paybis method, its vendor labels, and either its own
 * charge for THIS order or the minimum that stopped it being priced.
 *
 * Pure and React-free: the two surfaces that print these rows (this step and `/deposit`'s picker)
 * differ in layout and must not differ in what a row MEANS. Everything the frames settle lives here,
 * where it can be pinned by a test, rather than in JSX where it can only be pinned by a screenshot.
 *
 * ## POO-1632's convergence: what landed, what was already done, and what is still owed
 *
 * The issue was written against a `main` that has moved, so two of its three findings had already
 * dissolved and are recorded here rather than silently dropped.
 *
 * **The second row builder is gone.** POO-1632 names `src/features/deposit/lib/paymentMethodRows.ts`
 * as this file's rival. That file does not exist; `/deposit` has no separate builder, so the "two
 * builders drift apart" risk the issue opens on is not live. What IS still true is that the two
 * screens compute BLOCKED differently: `PaymentMethodList` calls `isMethodBelowFloor`
 * (PP-CORE-LIB-101), which is two-tiered, while [R7] below is deliberately tier 1 only. That is a
 * behaviour difference with a stated reason, not a duplication, and closing it is a rules decision
 * rather than a refactor.
 *
 * **The trim helpers are down to one.** The issue counts three; there were two, and `bestPrice.ts`'s
 * went with that module (POO-1639). {@link methodToken} is the survivor.
 *
 * **The currency guard is down to one.** {@link sameFiat} is now imported, see [R7].
 *
 * **STILL OWED, and deliberately not attempted here:** the third transcription finding. The same
 * Paybis payload is hand-maintained in `src/mocks/data/onRampPaymentMethods.ts`,
 * `OnRampMethodStep.stories.tsx` and this file's own test, and real captures now exist at
 * `src/mocks/data/paybisCapture/*.capture.json` (PP-CORE-MCK-007). Two facts, measured on the
 * captures rather than assumed, because they point opposite ways:
 *
 * The captures ARE richer than the transcriptions and would strengthen the TEST fixtures. A 10-method
 * EUR response ties three methods at one charge in 7 of its 13 quote records, and prices
 * `pool-party-manual-bank-transfer` at EUR 10.68 against its own published EUR 200.00 floor, so the
 * tie and the blocked row that pin [R7] are both OBSERVED there rather than composed by us.
 *
 * The blocker is not the payload, it is the ids and the mock's charge MODEL. The captures carry the
 * real `pool-party-credit-card`; every transcription carries the older `poolparty-credit-card`, so
 * repointing moves every id-naming assertion across four test files and the story at once. And
 * `onRampPaymentMethods.ts` is not a transcription at all: it is three deliberately-chosen methods
 * plus `MOCK_TERMS`, a rate-and-fixed model that derives a charge for ANY amount the harness types,
 * which a captured snapshot of one order size cannot replace. Left whole on POO-1632 rather than done
 * half-way, since half of it leaves [R7] pinned by nothing.
 *
 * ## The rules, and the failure each one prevents
 *
 * **[R2] Beyond eligibility the list is UNFILTERED, in the vendor's own order.** POO-1606 is now
 * ANSWERED (POO-1129 A7-b: instant only, this iteration), and the answer is applied as a rule OVER
 * this list rather than inside it, by {@link selectInstantMethods} upstream. That separation is the
 * point: row-building stays value-blind, so nothing here hides or reorders a method, and lifting the
 * deferral later changes one call site instead of these rules.
 *
 * **[R3] A row's charge is matched BY ID.** POO-1413: Paybis has answered about a method we did not
 * ask about, and a positional read then prints one method's charge under another's name. The ids are
 * the same token on both sides (`OnRampPaymentMethod.paymentMethod` and
 * `OnRampQuotePaymentMethod.id`), and they are compared trimmed, because a padded id on either side
 * would silently strand a row as unpriced while its charge sat one whitespace character away.
 *
 * **[R4] There is no superlative of ours beside a money figure.** The `Best price` pill is CANCELLED
 * (POO-1129 D1, Murilo: *"use as labels do vendor so"*), so the chip slot belongs to the vendor's own
 * labels and to nothing else.
 *
 * The COMPARISON behind it is gone too, not merely unwired (POO-1639): `bestPrice.ts`
 * (PP-CORE-LIB-100) was kept on the argument that it would back a "cheapest-viable default", and that
 * consumer was never built and is not scheduled by any open issue. An exported comparison nobody calls,
 * justified by a caller that does not exist, is the dead code a future sweep re-derives this whole
 * thread from. Deleted with its test; `git show b0624813:src/lib/onramp/bestPrice.ts` restores it if a
 * default ever needs one.
 *
 * **[R7] A row whose own charge is below its own floor is BLOCKED** (POO-1129 D2/D3, POO-1609 rules
 * v2). "A cobrança nunca é elevada": the charge is never raised, so the row states what the provider
 * needs and refuses the selection, and the order the buyer already set never moves.
 *
 * The comparison is POO-1609's TIER 1, and only tier 1, because that is what `/deposit` shipped in
 * PR #897 and AC6 requires the two screens to agree for the same method and the same order: row R's
 * own charge against row R's own floor. Tier 2 (the entered amount against the floor of an UNPRICED
 * row) is not implemented on either screen yet; adding it here alone would make provisioning refuse a
 * method `/deposit` still offers.
 *
 * It fails OPEN in three directions, all of them POO-1609's stated choice that "a method wrongly
 * blocked removes an option the buyer could have used, while a method wrongly offered is recoverable
 * at checkout": no charge, no floor, or two currencies that are not provably the same one. The floor
 * rides the METHODS call and the charge rides the QUOTE, so their shared denomination is asserted
 * rather than assumed (POO-333: this app has no FX source at all).
 *
 * That third guard is {@link sameFiat}, and since POO-1632 it is IMPORTED rather than copied. This
 * file used to keep its own, on the note that the shared home was `methodFloor.ts` "which the deposit
 * lane owns and has not landed": it landed as PP-CORE-LIB-101, so the note was stale and the two
 * screens were one edit away from disagreeing about what "same currency" means. The shared rule is
 * this file's stricter one (a blank code names no currency and never matches), so nothing here
 * changes and `/deposit`'s tier 2 gets strictly safer.
 *
 * **[R6] "Unpriced" is a fact about THIS order, and it is the VENDOR's fact.** A row is unpriced when
 * the quote priced other rows and not this one, or when `paymentMethodErrors` names it (POO-1599: the
 * provider's own reason, which outranks any figure still sitting beside it). Deliberately NOT derived
 * by comparing the method's `minUsd` against the order: those two figures come from two different
 * calls in two potentially different currencies, and arithmetic across that pair is the guess
 * {@link OnRampQuoteMethodError} exists to replace. It also means a quote that priced NOTHING (the
 * gas-first ETH leg, whose target only the mint can solve) marks no row unpriced: nothing was
 * refused, so nothing may be shown as refused.
 *
 * A row's own `minimum` is separate and always present when the provider sent one, because it is a
 * fact about the METHOD rather than about this order.
 *
 * **[R5] Labels are the vendor's, verbatim.** POO-1603 [R3] permits rendering one and forbids
 * branching on one, so they travel as opaque strings in the order Paybis sent them. A blank label
 * names nothing and is dropped rather than rendered as an empty chip.
 *
 * **[R8] Eligibility is separate from presentation, and it lives in {@link selectInstantMethods}.**
 * POO-1129 A7-b keeps non-instant methods out of the first iteration, which requires reading a
 * label's VALUE, which [R5] forbids of a row. [R5] governs how a row LOOKS and stays value-blind,
 * while [R8] answers whether a method may be OFFERED at all, so the eligibility answer is taken
 * before a row is ever built and never re-read from one.
 *
 * That split describes WHERE the value-read lives; it does not license it. This file previously
 * concluded the two were "not in tension", and that was wrong: the brief forbids the UI behaving
 * differently for a specific label value, and which methods are OFFERED is UI behaviour. So [R8] is a
 * knowing, temporary exception rather than a reconciliation. See the `PP-DEBT(SEV:MED) POO-1606` on
 * {@link INSTANT_LABEL} for the prohibition verbatim, the two rejected alternatives, and the two
 * routes that remove it.
 *
 * PP-INTEGRATION-POINT: every input here is live Paybis data, supplied by the caller from
 * `useBuyRouteQuote` (`getOnRampPaymentMethodsAction` + `getOnRampQuoteAction`, PP-CORE-LIB-063).
 */

import { sameFiat } from "@/lib/onramp/methodFloor";
import type { OnRampPaymentMethod, OnRampQuote } from "@/lib/onramp/schemas";

/** A fiat figure with the currency it is denominated in. Since POO-1512 that is not always USD. */
export interface OnRampMethodFigure {
  /** Display-grade amount (cents precision, float-safe), never re-derived here. */
  amount: number;
  /** ISO-4217 code the amount is denominated in. */
  currencyCode: string;
}

/** One selectable row of the method step. */
export interface OnRampMethodRow {
  /** The Paybis identifier: what the mint takes, and the row's key. Never a position (POO-1413). */
  id: string;
  /** The vendor's human label for the method. */
  name: string;
  /** [R5] The vendor's own tags, verbatim and in order. Rendered as chips, never branched on. */
  labels: string[];
  /** [R3] This method's own charge for this order, when the quote priced it. */
  charge?: OnRampMethodFigure;
  /** The method's own floor, in its own currency, when the provider set one. */
  minimum?: OnRampMethodFigure;
  /**
   * [R7] This order's charge for this method is below this method's own floor.
   *
   * The row still renders, in place, with everything it can say. What it cannot do is be SELECTED:
   * the charge is never raised to meet the floor, so the option simply does not serve this order.
   * Mutually exclusive with {@link unpriced} by construction, since blocking needs a charge.
   */
  blocked: boolean;
  /** [R6] The provider priced the other rows and not this one. Still selectable. */
  unpriced: boolean;
}

/** What {@link buildOnRampMethodRows} needs. */
export interface OnRampMethodRowsInput {
  /** The pair's methods for the resolved currency, in the order the provider returned them. */
  methods: readonly OnRampPaymentMethod[];
  /**
   * The LISTING quote for THIS order, or nothing.
   *
   * Nothing is a normal answer, not a failure: the gas-first `ETH-BASE` leg publishes no quote (its
   * received-fixed target is solved at mint time), and a quote for a DIFFERENT amount must be
   * withheld by the caller rather than shown against an order it does not answer for.
   */
  quote?: OnRampQuote;
}

/**
 * A method token in its comparable form: the ONE trim helper on this surface (POO-1632).
 *
 * A second copy lived in `bestPrice.ts` and went with it (POO-1639). Kept private rather than
 * exported, because after that deletion this file is its only caller and an export with one in-file
 * consumer is an API nobody asked for. Whitespace only: case is left alone, because these are opaque
 * vendor tokens with no documented casing rule, and folding them would invent an equivalence Paybis
 * never stated (unlike an ISO-4217 currency code, which {@link sameFiat} does fold).
 */
function methodToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The vendor label that means "this method settles inside the operation". The only one A7-b reads.
 *
 * PP-DEBT(SEV:MED) POO-1606: **this constant is the smell, it is deliberate, and it is temporary.**
 *
 * The prohibition, verbatim from `docs/_analysis/paybis-flow-figma-brief-2026-08-07.md:104` (§4.2):
 *
 * > "`labels` has **no documented value set**. Only `high-approval-rate` and `instant` have ever been
 * > observed. Design a generic chip that renders any string, with a fallback for none. Nothing in the
 * > UI may behave differently for a specific label value."
 *
 * Which method is OFFERED is the UI behaving differently for a specific label value, so this filter is
 * inside the prohibition, not beside it. (POO-1603's issue body restates the same rule harder, as
 * "never branch on a specific value ... because a label says `instant`". Cite the brief line above: it
 * is the source, it is in this repo, and it is the version that is checkable.)
 *
 * We branch on it anyway, because there is **no settlement-time field to branch on instead**, and that
 * is a fact about the VENDOR rather than about our decoder. Same brief, §8 "Do not design these",
 * line 169: *"Processing time ... Dropped from scope on 2026-08-07. It exists only in a prose table,
 * **has no API field**, and would be a hardcoded claim on screen."* (`schemas.ts` cites the same fact
 * on `OnRampPaymentMethod.labels`.) Our own decoder reads six fields (`paymentMethod`, `displayName`,
 * `minAmount`, `labels`, `icon`, `maxAmount`) and strips three more (`fees`, `id`, `name`); none of
 * the nine is a settlement time, but the vendor-level fact above is what actually makes `labels` the
 * only speed signal, and it survives the next schema change.
 *
 * **Rejected alternative (Rafael, 16/08): eligibility by label PRESENCE rather than by value** - offer
 * a method when `labels` is non-empty, so nothing compares against a literal. It fails twice:
 * - the live non-instant method **carries** labels. `poolparty-trustly` ships `low-fee` +
 *   `high-approval-rate` and no `instant` (`ProvisioningPanel.methodStep.test.tsx:558`), as does the
 *   SEPA fixture with `["low-fee"]` (`src/mocks/data/onRampPaymentMethods.ts:79-84`, transcribed from
 *   the 14/08 sandbox capture). A presence test ADMITS exactly what this filter exists to exclude.
 * - `labels` decodes to a MISSING KEY when the vendor sends none, sends `null`, or sends a shape the
 *   schema cannot read (`schemas.ts` normalizer, pinned at `schemas.test.ts:701-727`). So a presence
 *   test also fails CLOSED for a method whose labels merely failed to parse, which is a worse failure
 *   mode than the one we have.
 *
 * **Removal, either route, and whichever lands first wins:**
 * - **POO-1606** ships non-instant methods disabled-with-a-reason instead of hidden. The filter stops
 *   deciding what is OFFERED and this constant goes with it.
 * - **POO-1644** captures the real vendor vocabulary. If a settlement-time field turns out to exist,
 *   or Paybis publishes a documented value set, this whole comparison is replaced by the real signal.
 *
 * Until one of those lands the rule and the code contradict each other, so do not "fix" this by
 * deleting the branch: read {@link selectInstantMethods} first, and note it FAILS OPEN by design.
 */
const INSTANT_LABEL = "instant";

/** What {@link selectInstantMethods} answers: the methods to offer, and whether the filter gave up. */
export interface InstantMethodSelection {
  /** The methods eligible for this iteration, in the provider's own order. */
  methods: readonly OnRampPaymentMethod[];
  /**
   * [R8] The filter matched NOTHING, so it was abandoned and every method is being offered.
   *
   * The caller MUST report this loudly. It means one of two things and both are worth knowing: the
   * vendor has stopped sending `instant` (so this whole rule is silently off), or this buyer's
   * currency genuinely offers no instant rail (so A7-b is refusing them the step entirely). Neither
   * is visible from the rendered screen, which looks exactly like an ordinary unfiltered list.
   */
  failedOpen: boolean;
}

/**
 * [R8] POO-1129 A7-b: the methods this iteration may offer, and never an empty step.
 *
 * > Rafael: *"defer both, we will add non-instant as an improvement in the future, not at the first
 * > iteration."*
 *
 * The infrastructure agrees with the deferral rather than merely permitting it: the journal retains
 * for 24 h, a `requestId` auto-reuses for 15 min, the settlement poll ceiling is 10 min, and
 * `paybisWidget.ts` leaves `payment-initiated` / `payout-waiting` unhandled. A 1-to-3 day rail
 * offered on top of those ships a buyer who pays by transfer, closes the tab, and has nothing in the
 * app telling them where their money is.
 *
 * ## Why it fails open, and why that is not a hedge
 *
 * The captured vocabulary is `instant` / `low-fee` / `high-approval-rate`, and every one of them is
 * POSITIVE. "Not instant" is therefore an ABSENCE and never an assertion: a method carrying no
 * `instant` may be slow, or may be a method the vendor simply did not tag, and the two are
 * indistinguishable from here. A set carrying no `instant` at all is far more likely to be a
 * vocabulary we have not captured (POO-1644 is the capture) than a world with no instant rail. So a
 * filter that matches nothing is abandoned rather than obeyed, because an empty step is a dead end
 * and a slightly-too-long list is a screen the buyer can still use.
 */
export function selectInstantMethods(
  methods: readonly OnRampPaymentMethod[],
): InstantMethodSelection {
  const instant = methods.filter((method) =>
    (method.labels ?? []).some((label) => label.trim().toLowerCase() === INSTANT_LABEL),
  );
  // An empty INPUT is not a filter that failed; it is Q3's own "the provider returned nothing"
  // state, which has its own event and must not also fire this one.
  if (instant.length > 0 || methods.length === 0) {
    return { methods: instant, failedOpen: false };
  }
  return { methods, failedOpen: true };
}

/**
 * [R9] The methods a quote actually offers, keyed by id: priced AND not refused.
 *
 * **Paybis returns the SAME method as both, in one response.** Captured in production on 2026-08-17
 * (POO-1666): a 10-USDC quote listed `pool-party-credit-card` in `paymentMethods` with a real price
 * of EUR 10.53, and simultaneously in `paymentMethodErrors` with "You have to buy or sell at least
 * 10.003001 USDC per order". A consumer reading only `paymentMethods` therefore sees a perfectly
 * ordinary priced method, and Paybis then rejects the whole quote at `/v3/request` with "There are no
 * available payment/payout methods in Quote".
 *
 * Exported because the MINT needs the identical answer and used to compute its own, weaker one. The
 * row builder had this right since POO-1599; `useProvisioningRail` guarded only on
 * `paymentMethods` being EMPTY, which is the case one step to the left: non-empty and still unusable.
 * That divergence is what put a doomed `quoteId` on a real buyer's purchase, so the two callers share
 * this function rather than each keeping a rule.
 *
 * Refusals are matched by NAME only: `code` and `message` are an undocumented vendor set that nothing
 * branches on (POO-1599, and POO-1603's prohibition by the same reasoning).
 */
export function pricedQuoteMethodsById(
  quote?: OnRampQuote,
): Map<string, OnRampQuote["paymentMethods"][number]> {
  const refused = new Set(
    (quote?.paymentMethodErrors ?? [])
      .map((entry) => methodToken(entry?.paymentMethod))
      .filter((name) => name !== ""),
  );
  return new Map(
    (quote?.paymentMethods ?? [])
      .map((entry) => [methodToken(entry?.id), entry] as const)
      .filter(([id]) => id !== "" && !refused.has(id)),
  );
}

/** Build the step's rows from the live list and the quote that priced it. Pure. */
export function buildOnRampMethodRows({
  methods,
  quote,
}: OnRampMethodRowsInput): OnRampMethodRow[] {
  // [R6]/[R9] One shared answer to "did the provider actually offer this method", so the rows and the
  // mint can never disagree about it again.
  const pricedById = pricedQuoteMethodsById(quote);
  return methods.map((method) => {
    const id = methodToken(method.paymentMethod);
    const charge = pricedById.get(id);
    const hasFloor = method.minUsd > 0;
    return {
      id: method.paymentMethod,
      name: method.displayName,
      labels: (method.labels ?? []).filter((label) => label.trim() !== ""),
      ...(charge
        ? {
            charge: { amount: charge.chargeUsd, currencyCode: charge.chargeCurrencyCode },
          }
        : {}),
      ...(hasFloor
        ? { minimum: { amount: method.minUsd, currencyCode: method.minCurrencyCode } }
        : {}),
      /**
       * [R7] Tier 1, and every clause is a fail-open guard rather than a formality.
       *
       * A charge of zero is a figure we failed to read and not a free purchase; a floor of zero is
       * the absence of a floor; and two codes that are not provably equal cannot be subtracted at
       * all. `>` and never `>=`: the floor is a minimum the vendor accepts, so an exact match
       * clears it, and refusing equality would block the very order the vendor takes.
       */
      blocked:
        charge !== undefined &&
        charge.chargeUsd > 0 &&
        hasFloor &&
        method.minUsd > charge.chargeUsd &&
        sameFiat(method.minCurrencyCode, charge.chargeCurrencyCode),
      // [R6] Only meaningful against a quote that priced SOMETHING: with nothing priced, nothing was
      // refused either, and marking every row would claim a refusal the provider never made.
      unpriced: pricedById.size > 0 && charge === undefined,
    };
  });
}
