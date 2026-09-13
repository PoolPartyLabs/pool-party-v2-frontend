/**
 * @id PP-CORE-HOK-026 (POO-1153, POO-1413, POO-1578, POO-1513, POO-1596, POO-1599, POO-1609,
 *     POO-1612, POO-1576, POO-1618)
 * @name useBuyRouteQuote
 * @implements-rules-version v10 (POO-1618 rules v1) · v9 (POO-1576 rules v1) · v8
 *     (POO-1609/POO-1612 rules v1, POO-1596 rules v1) · v7 (POO-1599 rules v1) · v6
 *     (POO-1513 rules v1) · v5 (POO-1578 rules v1) · v4 (POO-1413 rules v1) · v3
 *     (POO-1153 / POO-1129 rules v3)
 *
 * ## The full quote rides along now (POO-1612), not just the published method's slice
 *
 * POO-1599 unpinned the listing quote so ONE upstream call prices every method on the pair, but the
 * state below still narrowed that answer down to the one method it publishes and labels. The blocked
 * row (POO-1609), a picker rendering every row's own charge, and the mint's own "did the provider
 * actually offer this method" check (`pricedQuoteMethodsById`, POO-1666) all need the WHOLE thing, so
 * {@link BuyRouteQuoteState.quote} carries it verbatim, alongside the narrowed fields rather than
 * instead of them (the strategies buy route is a separate consumer of those and is untouched by this
 * addition).
 *
 * The live figure behind [R10]. `FundingRoutePicker.buyChargeUsd` was optional with nothing supplying
 * it, so the buy row always showed its neutral "shown at checkout" caption. This hook resolves the real
 * received-fixed quote so the picker can display what the card will ACTUALLY be charged before the user
 * commits, which is the whole point of [R10]: a figure this app computed is never authoritative about
 * what Paybis will charge.
 *
 * ## What it does, in two hops
 *
 *   1. {@link getOnRampPaymentMethodsAction} lists the pair's methods, each with its `displayName` and
 *      its own `minAmount`. {@link pickDefaultPaymentMethod} chooses one to price and to LABEL the
 *      figure with, because the charge varies materially by method and the user can change it inside
 *      the widget, so an unlabelled number overpromises (the old "Buy with card" failure).
 *   2. {@link getOnRampQuoteAction} prices the purchase RECEIVED-FIXED (`direction: "receive"`): it asks
 *      Paybis what it costs to DELIVER `amountToUsd` (what must LAND, which since POO-1641 is the bare
 *      requirement floored at `PAYBIS_MIN_USD`, with no fee gross-up over it), and the returned
 *      `amountFrom` (`chargeUsd`) is the [R10] figure. It is read as-is and never re-derived;
 *      `amountTo` is never asserted to equal the request (the POO-1139 caveat).
 *
 * ## The listing quote asks about EVERY method (POO-1599)
 *
 * That second hop used to pin the chosen-or-default method, and so every answer carried exactly one
 * priced entry. That looked like a property of the vendor and was a property of our request: Paybis
 * lists `paymentMethod` as OPTIONAL on `POST /v2/quote` and, omitted, returns "Array of quotes
 * calculated for each available payment method" (docs.payb.is, read 2026-08-14; measured through our
 * own API the same day, one method requested and one method priced).
 *
 * So the pin is now sent ONLY when the buyer has chosen (POO-1578's threading, unchanged). With no
 * choice the request goes unpinned, for the same single POST against the same per-API-key throttle,
 * and the answer carries a figure for every method the pair offers. `pickDefaultPaymentMethod` still
 * decides which of those entries is published and labelled; it no longer decides what is asked.
 *
 * ## It degrades, it never blocks (POO-1153, Rafael 2026-07-31)
 *
 * We build against PRODUCTION currency codes (`USDC-BASE`, `ETH-BASE`) and there is deliberately no
 * branch on environment and no sandbox special-case: the SAME code path runs everywhere. On ANY
 * failure, unsupported pair, 404, throttle, timeout, malformed response, empty list, the hook yields
 * NO figure (`chargeUsd` undefined), which is exactly `buyChargeUsd`'s documented neutral-caption
 * fallback. Never an error state, never a spinner that traps the user.
 *
 * ## The dev quote RESOLVES now, and this paragraph used to assert the opposite (POO-1605/POO-1626)
 *
 * Until 2026-08-14 the text here read "the sandbox has no `USDC-BASE` pair, so a production-code quote
 * 404s on dev. That is accepted". pool-party-api reversed that decision: `sandbox-currency-map.ts`
 * substitutes `USDC-BASE` -> `USDC-SEPOLIA` and `ETH-BASE` -> `ETH-SEPOLIA` on the way OUT and restores
 * the production codes on the way IN, active if and only if `PAYBIS_API` points at a sandbox host. Both
 * hops below therefore resolve on dev, in production codes, and a buy row that never prints a charge
 * there is now a DEFECT to investigate rather than the expected rendering.
 *
 * VERIFIED ON DEV, not only on the API's `main` (2026-08-17): the dev `pp_api` container runs image
 * `v0.9.7-1-g106784a`, and `49f557f` is an ancestor of `106784a` with `sandbox-currency-map.ts`
 * present in that tree. Stated because the claim above is about a DEPLOYED environment: reading the
 * mapping on a branch says the code exists, not that dev is running it, and shipping the stronger
 * sentence on the weaker evidence is the exact failure this file's rewrite exists to retire.
 *
 * What still yields no figure, and none of it is environment-branching: MOCK MODE, where the host gates
 * this hook off outright (`ProvisioningPanel`, there is no Paybis rail behind the actions); a pair
 * OUTSIDE the two this app buys, since the substitution table covers exactly those two, so any other
 * code (`USDT-BASE`, say) passes through unmapped and the vendor answers for it honestly; and every
 * ordinary throttle, timeout and contract drift, which stay just as real in production.
 *
 * `USDT-BASE` is an ILLUSTRATION of an unmapped code, not a claim about Paybis' production catalogue.
 * Nothing in this repo evidences what the vendor does or does not sell there: the only pairs capture
 * is the sandbox one (`USDT-SEPOLIA`, `USDT-TRC`), and POO-1598's production fixtures cover method
 * lists for `ETH-BASE` / `USDC-BASE` alone.
 *
 * DO NOT read the above as "dev exercises the on-ramp end to end". It reaches WIDGET OPEN and stops.
 * Settlement is scoped to Base (`EXPECTED_TOKEN_SCOPE`, `src/lib/onramp/tokenDeltas.ts`, both codes
 * pinned to `ONRAMP_CHAIN_ID` 8453) while a sandbox purchase delivers on Sepolia, so a dev purchase
 * takes the payment and then sits in the settling state until it times out. That last mile is POO-1627's
 * and is expected on dev, not a provisioning-lane defect.
 *
 * ## Two effects, because the two hops answer to different inputs (POO-1578)
 *
 * The list and the charge used to be resolved by ONE effect that cleared everything before it ran.
 * That was harmless while the only input was the amount, and wrong the moment a picker could change
 * the SELECTION: every selection change blanked `methods` for a whole methods round trip, emptying
 * the picker the user was mid-click in, which is precisely what [S1] below forbids.
 *
 * So the hops are split along what they actually depend on:
 *
 *   the METHODS effect owns `methods` + `currencyCodeFrom` and keys on the pair (`currencyCodeTo`),
 *      the buyer's CHOSEN currency (POO-1618 [R3]), whether the hook is `enabled`, and whether there
 *      is an amount AT ALL. The list is a function of the pair and the currency, never of the
 *      amount's value or of which method the user picked.
 *   the QUOTE effect owns the charge fields and keys on the list, the amount, and the selection.
 *
 * Each holds its OWN run id, so each is independently race-safe, and neither can write the other's
 * fields. `hasAmount` is a boolean on purpose: crossing zero decides whether we fetch at all, while
 * $210 -> $320 must not re-list methods that cannot have changed.
 *
 * The split is also why the second hop can be suspended ALONE ({@link BuyRouteQuoteInput.pricingEnabled},
 * POO-1513 X1): a caller whose pair cannot be priced from a dollar figure — the gas-first `ETH-BASE`
 * leg, whose target only the mint can solve (POO-1573) — still needs the list, and would otherwise
 * have to choose between a picker with no rows and a charge for a pair the buyer is not billed on.
 *
 * Race guard: a superseded run (the amount or the selection changed while a call was in flight) may
 * not write state, so a stale charge can never land after a fresher one; a fresh quote run clears the
 * charge first, so a displayed figure always matches the amount currently being funded, or is absent.
 *
 * ## The charge NAMES its request, and costs one POST per pause (POO-1513)
 *
 * Two things a picker over a typed amount needs that a fixed-amount caller never did:
 *
 *   - `pricedFor` tags each published charge with the (amount, method) it answers. The state
 *     publishes a charge one commit behind the input that invalidated it, which is invisible to a
 *     consumer that only DISPLAYS the figure and is a money defect for one that does ARITHMETIC
 *     across the pair. `/deposit`'s raise-to-minimum (POO-1609, deleted) computed
 *     `methodMinUsd / chargeUsd`, and on the mismatched pair that ratio scaled a freshly typed 5000
 *     into a 5159.61 purchase, which is the defect that made this field a tag rather than a number.
 *   - the quote is DEBOUNCED ({@link QUOTE_DEBOUNCE_MS}). Priced straight off the amount it spent one
 *     upstream POST per keystroke, on a throttle `pool-party-api` applies per API KEY and shares with
 *     v1. The CLEAR is not debounced: a stale figure leaves the screen immediately, as before.
 *
 * ## The buyer may CHOOSE the currency, and the list reloads under it (POO-1618, POO-1576)
 *
 * {@link BuyRouteQuoteInput.currencyCodeFrom} is a PROPOSAL: it rides to the methods action on
 * `proposedCurrencyCodeFrom`, where the server checks it against the supported set for the pair and
 * answers with the resolved default when it does not hold up. So the input decides what is asked and
 * the echoed {@link BuyRouteQuoteState.currencyCodeFrom} decides what everything on screen is
 * denominated in. The method SET is a function of that currency and not a relabelling of it
 * (`directa24_pix` is BRL-only, `poolparty-trustly` is USD-only), so the effect re-lists and
 * {@link BuyRouteQuoteState.methodsLoading} says so while it does: leaving the previous currency's
 * rows up is the POO-1513 stale-figure class, and calling the empty gap "the provider returned
 * nothing" blames Paybis for our own reload.
 *
 * ONE currency resolution per flow (POO-1512): the quote pins `currencyCodeFrom` to whatever the
 * METHODS call resolved rather than letting the server resolve a second time. Two independent
 * resolutions can disagree across a cache expiry or a profile write, and a picker printing per-method
 * minimums in the list's currency beside a charge in the quote's currency is exactly that disagreement
 * made visible. `resolveWidgetPrefill` pins it for the same reason.
 *
 * PP-INTEGRATION-POINT: the live received-fixed quote + payment methods, via `getOnRampQuoteAction` and
 * `getOnRampPaymentMethodsAction` (PP-CORE-LIB-063, pool-party-api with Paybis behind it).
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reportClientError } from "@/lib/observability/reportClientError";
import { getOnRampPaymentMethodsAction, getOnRampQuoteAction } from "@/lib/onramp/onRampActions";
import type { OnRampPaymentMethod, OnRampQuote } from "@/lib/onramp/schemas";

/** What {@link useBuyRouteQuote} needs. */
export interface BuyRouteQuoteInput {
  /**
   * What must LAND on Base, in USD. The received-fixed quote asks Paybis "what does it cost to deliver
   * this", so this is the `amountTo` side. Zero or negative means there is nothing to price.
   *
   * POO-1641: no longer carries a gross-up for a Pool Party on-ramp fee. There is none, and there
   * never was one collected: the cut is a partner-side configuration already inside the price Paybis
   * quotes. Callers pass the requirement, floored at `PAYBIS_MIN_USD`.
   */
  amountToUsd: number;
  /**
   * Paybis crypto code to receive. Always a PRODUCTION code (`USDC-BASE`, or `ETH-BASE` on the gas-first
   * leg); this app never holds a sandbox-only code like `USDC-SEPOLIA`, and since POO-1605 it does not
   * need to, because pool-party-api substitutes the sandbox equivalent at its own vendor boundary and
   * restores the production code before we see the answer.
   */
  currencyCodeTo?: string;
  /**
   * Gate the whole fetch. Off in the crypto-only cut, in mock mode, and whenever there is no buy route
   * on screen, so no upstream quota is spent listing methods and pricing a purchase nobody is offered.
   */
  enabled: boolean;
  /**
   * Gate the SECOND hop alone: list the pair's methods, publish no charge. Defaults to `true`.
   *
   * `false` for a pair whose receive side {@link amountToUsd} does not denominate. The received-fixed
   * quote asks Paybis to deliver `amount` OF `currencyCodeTo`, so a dollar figure is the right request
   * for `USDC-BASE` and a meaningless one for `ETH-BASE`: on the gas-first leg the ETH to deliver is
   * `gasFloorEth + fundingUsd / ethUsd`, solved at MINT time against a real ETH price the client does
   * not hold (POO-1573; the wallet's own ratio is exactly 0 for the no-ETH wallet that leg serves).
   * Pricing anyway would spend an upstream POST asking for 100 ETH and publish a figure for a pair the
   * buyer is not billed on.
   *
   * It gates the quote and nothing else: the list still resolves, so a picker keeps its rows and its
   * minimums. Flipping it to `false` CLEARS any charge already published, on the effect's own
   * clear-first rule, so a figure can never outlive the pair it belonged to.
   */
  pricingEnabled?: boolean;
  /**
   * POO-1578 S2: the method the USER chose, when a surface has asked. Priced instead of the one
   * {@link pickDefaultPaymentMethod} would have chosen, so the figure on screen belongs to the method
   * they picked.
   *
   * Omitted (no picker yet, nothing selected, or a selection the pair no longer offers) the default
   * still applies: `pickDefaultPaymentMethod` is a FALLBACK now, never an override ([S4]).
   */
  paymentMethod?: string;
  /**
   * POO-1618 [R2]/[R3]: the fiat the BUYER chose, when a surface has offered the choice.
   *
   * A PROPOSAL, not a setting. It travels to the methods action on its own field
   * (`proposedCurrencyCodeFrom`), where the server matches it against the supported set for the pair
   * and answers with the resolved default when it does not hold up. So this input decides what is
   * ASKED FOR and never what is used: {@link BuyRouteQuoteState.currencyCodeFrom} is the answer, and
   * it is what the rows, the minimums and the charge are all denominated in.
   *
   * Changing it RE-LISTS. The set of methods is a function of the currency (`directa24_pix` is
   * BRL-only, `poolparty-trustly` is USD-only), which is the whole reason the control exists: a
   * buyer on the wrong currency does not see the wrong symbol, they lose Pix or SEPA entirely.
   */
  currencyCodeFrom?: string;
}

/**
 * The exact request a published charge answers (POO-1513).
 *
 * Both fields, together, because either one alone identifies the wrong thing: two methods are priced
 * for the same amount and one method is priced for every amount the buyer types.
 */
export interface BuyRoutePricedFor {
  /** The `amountToUsd` this charge was quoted for, as it was passed in. */
  amountToUsd: number;
  /** The Paybis identifier of the method that was priced (the selection, or the fallback). */
  paymentMethod: string;
}

/** What {@link useBuyRouteQuote} returns. Every field absent = the picker's neutral-caption fallback. */
export interface BuyRouteQuoteState {
  /** [R10] The authoritative total charge (`amountFrom`) for the default method, or undefined. */
  chargeUsd?: number;
  /**
   * POO-1513: what {@link chargeUsd} was priced FOR. Present exactly when a charge is.
   *
   * ## Why the state has to say this out loud
   *
   * This hook publishes its charge ONE COMMIT behind the input that invalidated it: the quote effect
   * runs after the render that changed the amount, so `setCharge(NO_CHARGE)` lands in the NEXT
   * commit while the render in between still shows the PREVIOUS amount's figure. Every consumer that
   * only DISPLAYS the charge is unharmed by that (it is one frame of a stale number, which the
   * clear-first rule then removes). A consumer doing ARITHMETIC across the pair is not:
   * `/deposit`'s raise ratio is `methodMinUsd / chargeUsd` applied to the amount, which is sound
   * only when both operands come from the same quote, and was silently scaling a freshly typed
   * order by the previous one's ratio (5000 became 5159.61, unbounded rather than a rounding
   * artifact, and that figure reached the mint).
   *
   * So the tag is the fix at the level where the ambiguity is created, rather than each consumer
   * inventing its own way to guess. A consumer that needs the pair compares this against what it is
   * currently showing and refuses when they disagree.
   */
  pricedFor?: BuyRoutePricedFor;
  /**
   * POO-1512 [R7]: the currency {@link chargeUsd} is actually billed in (`chargeCurrencyCode`).
   *
   * Since the buyer is charged in their own currency, this figure is no longer always dollars, and
   * `formatUsd` would print `$208.00` for a EUR 208 charge. The field is named for what it IS rather
   * than renaming `chargeUsd` across every consumer in this PR; that rename is POO-1512's D4 follow-up.
   */
  chargeCurrency?: string;
  /**
   * The default method's human label, shown beside the charge so the number is never unlabelled.
   *
   * POO-1596 F1: it does NOT require a charge. The label belongs to the METHODS list, which resolves
   * independently of the quote, so a suppressed or failed quote still publishes one and a consumer
   * may render it with no figure beside it. The quote's own label still wins when it ran, because a
   * POO-1413 substitution means Paybis priced a method we would not have defaulted to.
   */
  methodLabel?: string;
  /**
   * The default method's own minimum, in {@link methodMinCurrency}, for the picker to surface as
   * information. The field keeps its historical name; since POO-1512 the methods list is fetched in
   * the buyer's resolved currency, so the figure is no longer necessarily dollars.
   *
   * POO-1596 F1: like {@link methodLabel}, it comes from the methods list and survives a quote that
   * produced no charge, which is what lets the picker's minimum note render on the gas-first leg.
   */
  methodMinUsd?: number;
  /**
   * POO-1512 [R7]: the fiat currency {@link methodMinUsd} is denominated in (`minCurrencyCode`).
   * Without it the picker would print a EUR minimum through `formatUsd` and claim dollars.
   *
   * POO-1596 F1: present whenever {@link methodMinUsd} is, quote or no quote.
   */
  methodMinCurrency?: string;
  /**
   * POO-1578 S1: EVERY method the pair offers for the resolved currency, each with its `displayName`
   * and its own minimum. This was always fetched and always discarded down to the one that got priced.
   *
   * Set as soon as the methods call answers, INDEPENDENTLY of the quote: a picker renders names and
   * minimums without a charge, and blanking the list on a pricing failure would empty the step exactly
   * when the user still has to be able to choose.
   */
  methods?: OnRampPaymentMethod[];
  /**
   * The fiat the list was actually resolved for, echoed by the action (POO-1512). A picker needs it to
   * know WHICH currency's method set it is showing, and a caller making a follow-up call can pin it
   * rather than triggering a second resolution that could answer differently.
   */
  currencyCodeFrom?: string;
  /**
   * POO-1576/POO-1630: a methods call is IN FLIGHT, so an empty list is "not yet" and not "none".
   *
   * The hook publishes no loading discriminator for the QUOTE, deliberately and permanently: it
   * degrades, it never blocks, and a spinner on a figure that is allowed to be absent would trap a
   * user mid-funding over a caption. The LIST is a different question, and it became one when the
   * buyer gained a currency control. The list is cleared the instant the choice changes (the old
   * rows belong to the old currency, and leaving them is the POO-1513 stale-figure class in another
   * shape), which leaves a window where a picker holding only the empty list would tell the buyer
   * the provider returned nothing - accusing Paybis of an outage during our own reload.
   *
   * It is a REPORT, never a gate: `Continue` stays enabled through it, on the same prefill it has
   * always used, because Q3's "never a dead end" applies to a slow list exactly as it does to an
   * absent one.
   *
   * OPTIONAL in the type and always published by the hook. The optionality is for the other side:
   * `/deposit` and the view helpers build this shape by hand, and every one of them predates the
   * field, so requiring it would make a picker that has no reload compile only after being told
   * about one. Absent reads as "nothing in flight", which is the correct answer for a caller that
   * cannot start a fetch.
   */
  methodsLoading?: boolean;
  /**
   * POO-1612: the FULL priced quote, one entry per method the pair offers, plus the vendor's own
   * per-method refusals. The fields above narrow this to the ONE method that gets published and
   * labelled; a picker rendering every row's own charge needs the whole answer instead, and so does
   * `pricedQuoteMethodsById` (PP-STR-LIB-022), which is how the rows AND the mint agree about which
   * methods the provider actually offered (POO-1666: Paybis returns the same method priced in
   * `paymentMethods` and refused in `paymentMethodErrors`, in one response).
   *
   * Exposed verbatim rather than reshaped, so a caller passes this straight through. Present exactly
   * when {@link chargeUsd} is (same commit, same source quote).
   *
   * POO-1577 was the original requester (the Best price comparison); that pill and the module behind
   * it are both gone (POO-1129 D1, POO-1639), and the field stays because three other consumers
   * arrived for it.
   *
   * POO-1576 briefly published this same payload a second time as `listing`, bundled with the
   * amount it answered for. That is {@link pricedFor}, which lands in the same `setCharge`
   * commit as this field, so the provisioning method step reads the pair instead.
   */
  quote?: OnRampQuote;
}

/**
 * What the METHODS effect owns. Resolved TOGETHER or not at all: the currency is what the list was
 * fetched for, so a list without it cannot tell the quote which resolution to pin (POO-1512).
 */
interface ResolvedMethods {
  methods: OnRampPaymentMethod[];
  currencyCodeFrom: string;
}

/** What the QUOTE effect owns: every charge field, and none of the list's. */
type BuyRouteCharge = Omit<BuyRouteQuoteState, "methods" | "currencyCodeFrom" | "methodsLoading">;

/**
 * Paybis crypto code the fiat buy always lands (Base only). A PRODUCTION code in every environment:
 * pool-party-api swaps in the sandbox equivalent at its own vendor boundary (POO-1605), so this
 * constant is never environment-aware and never holds a testnet spelling.
 */
const DEFAULT_CURRENCY_CODE_TO = "USDC-BASE";

/** The neutral fallback: no charge available. A stable reference, so `setState` bails when unchanged. */
const NO_CHARGE: BuyRouteCharge = {};

/**
 * How long the amount must hold still before the purchase is priced (POO-1513).
 *
 * The quote is a POST through `apiFetch`, and `pool-party-api` throttles per API KEY rather than per
 * IP, on a bucket v1 and v2 share. Priced straight off the amount, `/deposit`'s keypad spent one of
 * everyone's requests per KEYSTROKE to price amounts nobody was funding: "100" is three calls, two
 * of them for figures that were never on screen long enough to read.
 *
 * Deliberately short: this is the pause between keystrokes, not a loading policy. The CLEARING of a
 * stale figure is not debounced at all (it stays in the effect body), because a number that no
 * longer matches the amount must leave the screen immediately whatever the network is doing.
 *
 * Exported so a suite asserting that NO quote was spent can wait out the real window rather than
 * hardcoding a number that would silently stop measuring anything if this one moved.
 */
export const QUOTE_DEBOUNCE_MS = 250;

/** Matches "credit card" in either the identifier (`poolparty-credit-card`) or the label. */
const CARD_PATTERN = /credit.?card/i;

/**
 * Choose the method to quote and label. A card is the sensible universal default (and the method the
 * received-fixed mechanism was verified against, POO-1153), so it wins even when it is not first; with
 * no card on offer, the first method the backend returns is used. Pure, so it is unit-tested directly.
 */
export function pickDefaultPaymentMethod(
  methods: readonly OnRampPaymentMethod[],
): OnRampPaymentMethod | undefined {
  const card = methods.find(
    (method) => CARD_PATTERN.test(method.paymentMethod) || CARD_PATTERN.test(method.displayName),
  );
  return card ?? methods[0];
}

/** Resolve the received-fixed [R10] charge for the buy route, or nothing when it cannot be priced. */
export function useBuyRouteQuote({
  amountToUsd,
  currencyCodeTo = DEFAULT_CURRENCY_CODE_TO,
  enabled,
  pricingEnabled = true,
  paymentMethod: selectedPaymentMethod,
  currencyCodeFrom: proposedCurrencyCodeFrom,
}: BuyRouteQuoteInput): BuyRouteQuoteState {
  const [resolved, setResolved] = useState<ResolvedMethods | null>(null);
  const [charge, setCharge] = useState<BuyRouteCharge>(NO_CHARGE);
  // POO-1576: "a call is out", never "the answer is empty". Owned by the METHODS effect alone.
  const [methodsLoading, setMethodsLoading] = useState(false);
  // Monotonic run ids, one per effect: only the newest run of EACH may write, so a superseded call
  // never clobbers a fresher one, and neither effect can be made stale by the other's traffic.
  const methodsRunIdRef = useRef(0);
  const quoteRunIdRef = useRef(0);

  /**
   * Whether there is a purchase to price at all. A BOOLEAN rather than the amount itself, because it
   * is what the methods effect keys on: crossing zero decides whether we spend upstream quota, while
   * $210 -> $320 cannot change which methods the pair offers and must not re-list them.
   */
  const hasAmount = Number.isFinite(amountToUsd) && amountToUsd > 0;

  /**
   * POO-1578 S1: the list, resolved independently of the quote and published as soon as it answers.
   *
   * The picker's names and minimums come from HERE, not from the quote, so a pricing failure costs
   * the figure and never the list: a picker that blanked on a failed quote would empty the step
   * exactly when the user still has to be able to choose. Clearing first is right on THIS effect's
   * inputs (a new pair, or a suspension) because the old list belonged to the previous resolution;
   * it would be wrong on the amount or the selection, which is why they are not deps here.
   */
  /**
   * POO-1599 F1: make a degrade LOUD once, not on every keystroke.
   *
   * This hook swallowed every failure - no `reportClientError`, no `logError`, no `track` anywhere in
   * the file. Survivable while the quote was always pinned and its realistic failure was dev's absent
   * `USDC-BASE` pair (true when this was written, and POO-1605 has since removed even that excuse:
   * pool-party-api maps the pair into the sandbox, so dev quotes resolve); not survivable now the
   * LISTING quote is unpinned, because `ProvisioningPanel`
   * never pins and `/deposit` does not pin on first paint. A frontend deployed ahead of an API that
   * still requires `paymentMethod` then 400s on EVERY quote and renders a plausible screen with no
   * figure, with nothing in Sentry. That is how POO-1601 survived five days.
   *
   * Reported ONCE per distinct failure per mount. The effect re-runs per (debounced) amount change,
   * so reporting each attempt would put a permanent floor of noise under the error rate - the thing
   * `isExpectedNonOutage` exists to prevent - and would bury the one signal that matters. One report
   * per class is enough: a wrong deploy order produces a code this surface has never seen.
   */
  const reportedRef = useRef<Set<string>>(new Set());
  const reportOnce = useCallback((event: string, code: string, fields: Record<string, unknown>) => {
    const key = `${event}:${code}`;
    if (reportedRef.current.has(key)) return;
    reportedRef.current.add(key);
    reportClientError(event, new Error(`${event}: ${code}`), { code, ...fields });
  }, []);

  useEffect(() => {
    const runId = ++methodsRunIdRef.current;
    setResolved(null);

    // Suspended or nothing to price. Bumping the run id above already stopped any in-flight write.
    if (!enabled || !hasAmount) {
      setMethodsLoading(false);
      return;
    }
    setMethodsLoading(true);

    void (async () => {
      try {
        const methodsResult = await getOnRampPaymentMethodsAction({
          currencyCodeTo,
          /**
           * POO-1618 [R2]: the buyer's choice, PROPOSED. Sent on its own field so the server can
           * tell it from a currency the app resolved itself and validate it against the supported
           * set; the answer comes back as `currencyCodeFrom` below, which may be the resolved
           * default when the choice did not hold up.
           */
          ...(proposedCurrencyCodeFrom === undefined
            ? {}
            : { proposedCurrencyCodeFrom: proposedCurrencyCodeFrom }),
        });
        if (methodsRunIdRef.current !== runId) return; // superseded
        if (!methodsResult.ok) {
          // Degrade unchanged; it is now visible. Reported for grep-ability rather than as an outage
          // claim: an unsupported pair is a legitimate vendor answer. It is NOT the routine dev state
          // any more though (POO-1605 maps our pairs into the sandbox), so this firing on dev for
          // `USDC-BASE` or `ETH-BASE` is worth a look rather than a shrug.
          reportOnce("onramp.methods_unavailable", methodsResult.code, { currencyCodeTo });
          return;
        }
        setResolved({
          methods: methodsResult.methods,
          currencyCodeFrom: methodsResult.currencyCodeFrom,
        });
      } catch {
        // The actions do not throw across the RSC boundary, but a client-side surprise still degrades
        // to the neutral caption rather than surfacing an error the picker has no state for.
        if (methodsRunIdRef.current === runId) setResolved(null);
      } finally {
        // Whatever the outcome, this run is no longer in flight. Guarded on the run id like every
        // other write here, so a superseded call cannot report the fresher one's fetch as finished.
        if (methodsRunIdRef.current === runId) setMethodsLoading(false);
      }
    })();
    // POO-1618 [R3]: the CHOSEN currency is a dependency, because the method SET is a function of it.
    // Without it the buyer picks BRL and keeps the dollar rows, which is the defect the control was
    // built to fix, arriving one layer in.
  }, [enabled, hasAmount, currencyCodeTo, proposedCurrencyCodeFrom, reportOnce]);

  /**
   * The charge, priced for ONE method out of the list above. Owns nothing the list owns.
   */
  useEffect(() => {
    const runId = ++quoteRunIdRef.current;
    // Clear the charge first: a displayed figure must always match the amount, the method and the PAIR
    // now being funded, or be absent. A stable NO_CHARGE reference makes this a no-op when nothing
    // showed. `pricingEnabled` is a dep for exactly this reason: a pair that stops being priceable
    // (the balance read lands and the order turns out to be gas-first) must lose its figure here.
    setCharge(NO_CHARGE);

    if (!enabled || !pricingEnabled || !hasAmount || resolved === null) return;
    const { methods, currencyCodeFrom } = resolved;

    /**
     * POO-1578 S2/S4: the user's choice wins; the shipped chooser is the fallback.
     *
     * A selection the pair does not offer falls back rather than dead-ending: the list is fetched
     * per resolved currency (POO-1512), so a currency change can legitimately retire the method
     * the user picked, and refusing to price anything at that moment would blank the figure with
     * no way for the user to understand why.
     *
     * POO-1599 splits the two things this used to conflate. `chosen` is what the BUYER asked for and
     * is the only thing that pins the request; `method` is which entry of the answer gets published
     * and labelled, and the shipped chooser still supplies it when nothing was chosen.
     */
    const chosen =
      selectedPaymentMethod === undefined
        ? undefined
        : methods.find((entry) => entry.paymentMethod === selectedPaymentMethod);
    const method = chosen ?? pickDefaultPaymentMethod(methods);
    if (!method) return; // no method on offer

    // POO-1513: wait out the keystrokes before spending an upstream POST on this amount. The clear
    // above already happened, so the pause costs a figure that was stale anyway, never a stale one
    // left on screen. The cleanup cancels a pending fetch that the next keystroke supersedes.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const quoteResult = await getOnRampQuoteAction({
            currencyCodeTo,
            // POO-1512: the currency the METHODS call resolved, pinned rather than resolved again,
            // so the list's per-method minimums and this charge can never be denominated
            // differently.
            currencyCodeFrom,
            amount: amountToUsd,
            /**
             * POO-1599 [R1]: pinned ONLY when the buyer chose. Otherwise the field is absent and
             * Paybis prices EVERY method available for the pair in this one call.
             *
             * Pinning the fallback here is what made "a quote prices ONE method" look like a vendor
             * property: it was our request. Measured 2026-08-14, one method in, one method out. An
             * unpinned listing quote costs the same single POST against the same per-API-key
             * throttle, and comes back with a figure for every row instead of one.
             *
             * The fallback deliberately does NOT pin: a method the buyer never chose is the worst
             * one to spend the call on, and asking about all of them still answers about it.
             */
            ...(chosen === undefined ? {} : { paymentMethod: chosen.paymentMethod }),
            direction: "receive",
          });
          if (quoteRunIdRef.current !== runId) return; // superseded
          if (!quoteResult.ok) {
            // `pinned` is the field that matters: an UNPINNED quote failing is the signature of a
            // frontend running ahead of an API that still requires `paymentMethod` (POO-1599), which
            // is otherwise indistinguishable from an unsupported pair.
            reportOnce("onramp.listing_quote_unavailable", quoteResult.code, {
              currencyCodeTo,
              pinned: chosen !== undefined,
            });
            return; // unsupported pair, throttle, drift → fallback (dev resolves now, POO-1605)
          }
          /**
           * POO-1413: match on the METHOD ID, not position.
           *
           * "We requested exactly one method, so the quote answers for it" held right up until
           * Paybis answered about something else. A positional read then displays THAT method's
           * charge under OUR method's `displayName` (below), and the [R10] charge is the number the
           * user decides on. The rail (`useProvisioningRail`) matches by id for the same reason; two
           * consumers of one payload disagreeing about what identifies a priced method is how this
           * class of bug survives.
           *
           * `amountFrom` (chargeUsd) is the [R10] figure; `amountTo` is never asserted against the
           * request (POO-1139). The id equality is captured, not assumed: a live `POST /v2/quote` on
           * 2026-08-07 echoed `id: "poolparty-credit-card"` for that exact `paymentMethod`.
           */
          const priced = quoteResult.quote.paymentMethods.find(
            (entry) => entry.id === method.paymentMethod,
          );
          if (!priced) {
            // Paybis priced nothing FOR THIS METHOD: the caption stays neutral, but the payload is
            // still published. An unpinned quote that skipped the DEFAULT method has very likely
            // priced the others, and blanking a picker's rows over the label's own method would
            // discard exactly the comparison POO-1599 fetched.
            //
            // POO-1576 widens POO-1612's `quote` to this branch. It therefore no longer implies
            // {@link chargeUsd}: `quote` says "this is what Paybis answered", `pricedFor` says
            // "and it answers for THIS (amount, method)". A consumer doing arithmetic gates on
            // `pricedFor`, never on the presence of `quote`.
            //
            // RUN-GUARDED, and this branch is why the guard had to grow. `setCharge` REPLACES, and
            // only the `catch` below used to check the run id: both success publishes carried a
            // full charge, so a straggler overwrote a good charge with another good one and the
            // asymmetry never showed. This branch publishes a charge-LESS object, so an out-of-date
            // run landing here wipes the live figure off the review (`/deposit` shares this hook,
            // and its "prices the review from the mocked quote" test caught exactly that, in 2 runs
            // of 5). Guarding both publishes closes the widening AND the older asymmetry.
            if (quoteRunIdRef.current === runId) setCharge({ quote: quoteResult.quote });
            return;
          }

          if (quoteRunIdRef.current !== runId) return;
          setCharge({
            // POO-1612: the whole multi-method answer, verbatim, for a picker rendering every row's
            // own charge, and for `pricedQuoteMethodsById` (PP-STR-LIB-022, POO-1666).
            quote: quoteResult.quote,
            chargeUsd: priced.chargeUsd,
            // POO-1512 [R7]: carried from the quote, never assumed. Paybis says what it billed in.
            chargeCurrency: priced.chargeCurrencyCode,
            methodLabel: method.displayName,
            methodMinUsd: method.minUsd,
            // POO-1512 [R7]: the minimum's own currency rides with the figure, never assumed USD.
            methodMinCurrency: method.minCurrencyCode,
            // POO-1513: the request this figure answers, so a consumer doing arithmetic across the
            // pair can tell it apart from the previous amount's charge (see {@link pricedFor}).
            pricedFor: { amountToUsd, paymentMethod: method.paymentMethod },
          });
        } catch {
          // The actions do not throw across the RSC boundary, but a client-side surprise still
          // degrades to the neutral caption rather than surfacing an error the picker has no state
          // for.
          if (quoteRunIdRef.current === runId) setCharge(NO_CHARGE);
        }
      })();
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    resolved,
    amountToUsd,
    selectedPaymentMethod,
    currencyCodeTo,
    enabled,
    pricingEnabled,
    hasAmount,
    // Stable by construction (`useCallback` with no deps), so declaring it satisfies the exhaustive
    // -deps rule without ever re-running the effect. Declared rather than suppressed.
    reportOnce,
  ]);

  // POO-1578 S1: ONE object out, unchanged in shape, so every consumer reads the list and the charge
  // together exactly as before. Both halves are stable references when nothing moved, so this is too.
  return useMemo(() => {
    if (resolved === null) return { ...charge, methodsLoading };
    const merged: BuyRouteQuoteState = { ...resolved, ...charge, methodsLoading };
    /**
     * POO-1596 F1: the LABEL and the MINIMUM come from the methods list, not from the quote, so they
     * must survive a quote that was suppressed or that failed.
     *
     * They were only ever written inside the quote effect, so `pricingEnabled: false` - the gas-first
     * leg, where a dollar figure says nothing about an ETH target - emptied all three. The picker
     * gates its minimum note on the label AND the minimum being present, so the disclosure went dark
     * on exactly the leg that still needs it, and the design's "Min. $500.00" row could not render.
     *
     * The quote still WINS when it ran, and NOT because it can name a method this expression would
     * not have picked: given the same list and the same selection the two agree by construction (a
     * POO-1413 substitution publishes no charge and no label at all, so it is not the case either).
     * It wins because the charge and its label were resolved TOGETHER, for the selection live at that
     * moment, while this expression is re-evaluated on every render. The moment the buyer's selection
     * moves, the quote effect has not yet cleared the charge it priced for the previous one, and
     * overwriting the label here would print the new method's name beside the old method's figure:
     * POO-1413's failure class arriving through the merge rather than through a positional read. This
     * only fills the gap.
     */
    if (merged.methodLabel === undefined) {
      const named =
        (selectedPaymentMethod !== undefined
          ? resolved.methods.find((entry) => entry.paymentMethod === selectedPaymentMethod)
          : undefined) ?? pickDefaultPaymentMethod(resolved.methods);
      if (named) {
        merged.methodLabel = named.displayName;
        merged.methodMinUsd = named.minUsd;
        merged.methodMinCurrency = named.minCurrencyCode;
      }
    }
    return merged;
  }, [resolved, charge, methodsLoading, selectedPaymentMethod]);
}
