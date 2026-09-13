/**
 * @id PP-CORE-LIB-097
 * @name fundingTarget
 * @implements-rules-version v3 (POO-1812 rules v1: the caller's rate now derives from the run's
 *   own slippage, and the D9 server value must take PRECEDENCE over it once that contract lands)
 *   · v2 (POO-1755 rules v1) · v1 (POO-1499 rules v1)
 * @analytics-events none, a pure maths module with no interaction; its screens carry the funnel.
 *   (`src/lib/analytics/provisioningFunnel.ts` holds the provisioning funnel those screens emit.)
 *
 * How much a funding route has to SOURCE, which is not the same as what the operation costs
 * (POO-1499 [R49], [R52], [R53], plus [R9] for the no-gas case). [R50], the disclosure copy, and
 * [R51], restarting when the buffer is exceeded, are NOT implemented here: they belong to the screens.
 *
 * One place, because step 1's row amounts, step 2's coverage meter and `Convert what's needed`, and
 * the `You pay` line must never disagree about it: three call sites computing the same figure is how
 * a meter fills to "covered" against a CTA that still refuses.
 *
 * ⚠ That unification is NOT fully achieved. `sourceTargetUsd` is wired now (via `fundingRoutes.ts` →
 * `FundingRoutePicker`, POO-1501), and it is not the only live sizer for this quantity:
 *
 * - `sourceTargetUsd("buy")` (here; LIVE, the "Where from" row's title): `(transaction × 1.05) + $2`,
 *   floored at `PAYBIS_MIN_USD` (POO-1542). This is what must LAND.
 * - `buyOrderUsd` (`ProvisioningPanel.tsx`; LIVE): `max(PAYBIS_MIN_USD, shortfall)`, which feeds the
 *   crypto-side method-minimum gate and the real received-fixed quote (the buy row's SUBTITLE, what
 *   the card is actually charged). POO-1641 dropped the 1% fee gross-up that used to sit over the
 *   shortfall here, so this figure and the order below now differ only by the gas component.
 * - `sizeOnRampOrder` (`src/lib/onramp/sizeOnRampOrder.ts:195`, floor clamp at `:168`; LIVE):
 *   `max(minUsd, requiredUsd + gasComponent)`, which sizes the actual Paybis order.
 *
 * These three answer DIFFERENT questions on purpose (landed vs. charged vs. ordered) and are not
 * meant to converge to one number: see [R10] and `FundingRoutePicker`'s title/subtitle split. What
 * POO-1542 closes is narrower and non-negotiable regardless of which question is being answered: the
 * title here must never print an amount BELOW `PAYBIS_MIN_USD` (a figure the rail will not sell), and
 * it is now floored. Before the floor, a small requirement (a gas-only top-up) could print `$5.15`
 * while the order actually placed was `$10` or more, understating what the route sources ([R10]'s
 * failure direction). The gas half of the same reconciliation: this module and `buildPlan.ts` now
 * share ONE predicate for "does this route buy gas" ({@link onRampRouteBuysGas},
 * `computeNeed.ts`, POO-1542 [B]), so the row and the plan cannot disagree on whether the reserve is
 * real, even though their gas AMOUNTS still differ ({@link BUY_ROUTE_NATIVE_RESERVE_USD} here vs. the
 * live-quoted `GasFeasibility.requiredGasUsd` in the plan) — that residual gap is unchanged by this
 * issue and stays open.
 *
 * ## The two things that sit on top of the transaction
 *
 * **A buffer**, because selection and settlement are not the same moment. Without it a $200
 * investment lands as less than $200 whenever the market moves in between, which is the failure the
 * user actually notices. [R50] says the leftover comes back to the wallet and that the screen must
 * say so, because silent over-collection is indistinguishable from a hidden fee. **Neither half is
 * built yet**: the copy key exists in no locale, and nothing in the flow returns the surplus. Both
 * are open on `CR-CORE-014`. This module computes the number; it does not disclose it, and must not
 * be read as if it did.
 *
 * **A gas component that differs by route** ([R53]), which is why `Buy` costs LESS than `Use your
 * tokens` for one operation. That is deliberate and it falls out of how each route gets its gas.
 *
 * ## Why the rate is 5% and not the spec's 3%
 *
 * Decided by murilo 2026-08-10. A buffer already shipped at 5% ({@link SEED_BUFFER_RATE}), sized
 * against POO-1042 [R7]'s hard constraint that "the CTA must never flip from enabled to disabled
 * underneath the user", covering max slippage (2%), Uniswap's fee (≤1%) and the bridge fee. The
 * spec's 3% is justified by price moves alone. Lowering the number AND re-basing it in one change
 * would retune a live gate on two variables at once, so only the base moved: the buffer now
 * multiplies `transaction + gas` rather than the transaction alone.
 *
 * ## Why this does not weaken `gasFeasibility.ts` [R4] ("GAS COMES FROM THE QUOTE. Never a constant")
 *
 * That rule forbids SIZING gas, and the test it actually applies is about reach rather than about
 * what a constant is called: `onramp/config.ts` admits a constant when it never sizes a top-up and
 * never reaches `classifyGasFeasibility` or `buildPlan`'s GAS path. Neither figure here can. They are
 * inputs to how much a route must SOURCE, upstream of every gas decision, and what a step actually
 * spends on gas is still the quote's answer, everywhere, unchanged.
 *
 * Stated that way on purpose, because the tempting version of this argument does not hold: "it is not
 * a gas cost" is doing more work than it can bear, since a reserve is still chosen by a belief about
 * what gas costs. Reach is the property that survives scrutiny.
 */
import { GAS_CUSTOM_MIN_USDC_USD, PAYBIS_MIN_USD } from "@/lib/provisioning";
import type { FundingRouteKind } from "./fundingRoutes";
import { ceilToUsd, SEED_BUFFER_RATE, toMicros } from "./fundingSelection";

/**
 * The buffer applied when nothing else has said otherwise (D9, decided 2026-08-10).
 *
 * Aliased rather than redefined: `SEED_BUFFER_RATE` is the shipped number with the reasoning that
 * sized it, and two constants holding one rate is how they drift apart.
 *
 * Since POO-1812 it is the FLOOR rather than the whole story. `bufferRate` on
 * {@link SourceTargetInput} is supplied by the panel as `seedBufferRate(effectiveSlippagePct)`, so
 * the route cards' target moves with the run's own slippage exactly as the seed does ([R3]). This
 * constant is what an unsupplied rate falls back to, and nothing more.
 */
export const DEFAULT_SOURCE_BUFFER_RATE = SEED_BUFFER_RATE;

/**
 * USD of ETH the buy route keeps back so the wallet can sign afterwards ([R52]).
 *
 * A card purchase always lands as ETH on Base, so the route buys everything in ETH, converts what
 * the operation needs into USDC, and holds this much back. There is no separate gas purchase on
 * this route, which is the whole reason it costs less than converting.
 *
 * This is a RESERVE: it says how much native must remain, the same shape as `PAYBIS_GAS_FLOOR_ETH`
 * for a holding the user already had. What makes it acceptable under `gasFeasibility.ts` [R4] is that
 * it never sizes a top-up and is never read by `classifyGasFeasibility`, not that it can be called
 * something other than a cost.
 *
 * ## USD, not ETH: answered (POO-1542), closing the note left open on POO-1501
 *
 * One honest difference from `PAYBIS_GAS_FLOOR_ETH`: that floor is denominated in ETH and this is
 * denominated in USD, so a price move changes how much gas this $2 actually buys while the ETH floor
 * would not move. That is acceptable here and would not be for the floor, and the difference is what
 * each one guards. `PAYBIS_GAS_FLOOR_ETH` is a STRICT per-transaction floor: it exists so a specific
 * holding still covers a specific quoted gas cost, so letting it float in USD could silently drop it
 * below what that transaction needs. This reserve is not sized against any specific quote; it exists
 * so the wallet holds SOME ETH dust to sign with afterwards, and $2 of ETH is a multiple of what any
 * single L2 transaction actually costs across the price ranges ETH has traded in. A price move can
 * shrink the dust; it cannot plausibly shrink it below one transaction's worth. USD is also what [R52]
 * / [R53] specify literally ("$2.00"), not an ETH quantity, so denominating it otherwise would be the
 * thing needing justification, not the reverse.
 */
export const BUY_ROUTE_NATIVE_RESERVE_USD = 2;

/** Everything {@link sourceTargetUsd} needs, and nothing that can be derived from it. */
export interface SourceTargetInput {
  /** What the operation itself costs, in USD. The figure the user typed, before anything is added. */
  transactionUsd: number;
  /** Which route is being priced. Each funds its gas differently ([R53]). */
  routeKind: FundingRouteKind;
  /** Whether the target chain needs a gas top-up at all. `false` collapses the component ([R9]). */
  gasNeeded: boolean;
  /**
   * The buffer rate for this quote, overriding {@link DEFAULT_SOURCE_BUFFER_RATE}.
   *
   * POO-1812 changed who fills this in. It is no longer empty until a server exists: the panel
   * supplies the CLIENT rate for the run, `seedBufferRate(effectiveSlippagePct)`, so the route
   * cards' target and the seed spend one number ([R3]).
   *
   * PP-INTEGRATION-POINT (POO-1499 D9): the server sets this alongside the quote, so it can be
   * tuned per network and per market without a deploy. Assumed contract: a finite rate in `[0, 1)`
   * on the plan/quote payload. A client constant cannot serve that purpose and neither can a
   * `NEXT_PUBLIC_` env, which is baked at build time and is a constant wearing a costume. When that
   * contract lands the server's rate must take PRECEDENCE over the panel's, which means the panel
   * stops supplying its own here rather than the two racing at this seam. Wiring issue: POO-1499.
   */
  bufferRate?: number;
}

/**
 * The gas this route has to source, in USD ([R53]).
 *
 * `tokens` / `tokens-plus-buy` swap a holding the wallet already has. That is not a purchase, so no
 * rail imposes a minimum on it and the Paybis fiat floor does not apply; the figure is
 * `GAS_CUSTOM_MIN_USDC_USD`, the lowest amount the USDC-funded gas control accepts. POO-1084 [F1-R4]
 * settled that split and recorded why, in the words that matter here: forcing the $10 card floor
 * "would spend ten dollars of someone's balance to buy a few cents of native coin".
 *
 * `buy` keeps {@link BUY_ROUTE_NATIVE_RESERVE_USD} back out of the ETH it already bought ([R52]).
 *
 * `deposit` sources nothing: its amount is settled on the deposit surface, not here.
 */
export function routeGasComponentUsd(kind: FundingRouteKind, gasNeeded: boolean): number {
  if (!gasNeeded) return 0;
  switch (kind) {
    case "tokens":
    case "tokens-plus-buy":
      return GAS_CUSTOM_MIN_USDC_USD;
    case "buy":
      return BUY_ROUTE_NATIVE_RESERVE_USD;
    case "deposit":
      return 0;
  }
}

/** A rate we are willing to multiply money by. Anything else falls back rather than propagating. */
function usableRate(rate: number | undefined): number {
  if (rate === undefined) return DEFAULT_SOURCE_BUFFER_RATE;
  return Number.isFinite(rate) && rate >= 0 && rate < 1 ? rate : DEFAULT_SOURCE_BUFFER_RATE;
}

/**
 * What this route must source to fund the operation ([R49], [R52], [R53]).
 *
 * The two routes are shaped differently on purpose:
 *
 * - `tokens`: `(transaction + gas) × (1 + rate)`. Both halves are converted through a market, so
 *   both are exposed to the price move the buffer exists to absorb.
 * - `buy`: `(transaction × (1 + rate)) + reserve`. The reserve is held back from ETH the user has
 *   just received, so there is no conversion between now and then for a buffer to protect.
 *
 * ⚠ The `buy` figure is what must LAND, never what the card is charged. [R10] and
 * `FundingRoutePicker`'s existing `buyChargeUsd` / `subtitlePending` split exist because printing our
 * own number as the provider's charge is the "Buy with card" overpromise POO-1413 already fixed once.
 * Render this as an amount to fund, never as a price. POO-1446 reworded the pending half to name the
 * CHARGE (`Final charge shown at checkout`) rather than an "amount", since the amount is what THIS
 * function returns and the caption's whole job is to say that figure is not the price.
 *
 * Rounds UP to the cent, for the same reason the running total rounds a shortfall up: a sub-cent gap
 * must never read as covered. Two limits, stated because an unstated limit is indistinguishable from
 * a guarantee: the micro-dollar conversion rounds BEFORE the ceil, so a full-float input can
 * understate by a cent (~44 per million, unreachable from a typed amount and reachable from a derived
 * one); and a transaction above ~1.8e302 overflows to `Infinity`. Both fail in the over-ask direction
 * or are absurd. A malformed transaction returns 0 rather than NaN, which would compare false
 * against everything and silently open the CTA.
 *
 * A ZERO transaction is NOT malformed (POO-1755 [R1]). The five non-spending ops (withdraw /
 * collect / compound / move-range / close) cost `opRequiredUsdc: 0` by definition (POO-1042 [R3]),
 * and POO-1033 [R2] deliberately sends them into the wizard when their gas can only come from
 * another chain, so a zero-transaction route with `gasNeeded` legitimately reaches this function
 * and must price its GAS COMPONENT alone. Treating the zero as malformed is what held
 * `FundingRoutePicker`'s D1 skeleton on screen forever: every card's figure was `undefined` by
 * construction, with nothing in flight to ever resolve it (production, v1.5.0 through v1.6.3).
 * Only a route with nothing to source at all (zero transaction AND no gas component) still returns
 * 0, unfloored: a $10 purchase of nothing is not a smaller version of any real order.
 *
 * `buy` is additionally floored at `PAYBIS_MIN_USD` (POO-1542 [A]). Every buy order this app places
 * goes through Paybis's $10 minimum regardless of what this formula computes (`buyOrderUsd` /
 * `sizeOnRampOrder`, see the file header), so a small requirement printing anything below that names
 * an amount the rail will not sell: the smallest a card purchase can ever land is the floor, never
 * less. `tokens` / `tokens-plus-buy` are NOT floored here, because converting an existing holding is
 * not a fiat purchase and carries no Paybis minimum.
 */
export function sourceTargetUsd(input: SourceTargetInput): number {
  const { transactionUsd, routeKind, gasNeeded, bufferRate } = input;
  if (!Number.isFinite(transactionUsd) || transactionUsd < 0) return 0;
  if (routeKind === "deposit") return 0;

  const rate = usableRate(bufferRate);
  const gas = routeGasComponentUsd(routeKind, gasNeeded);
  // POO-1755 [R1]: zero is the non-spending ops' legitimate cost, and such a route still sources
  // its gas. Only nothing-at-all (no transaction AND no gas component) short-circuits, unfloored.
  if (transactionUsd <= 0 && gas <= 0) return 0;

  // Integer micro-dollars, because `(200 + 5) * 1.05` is not 215.25 in IEEE-754 and a cent that
  // rounds the wrong way here is a CTA that refuses a selection the meter says is complete. The
  // kernel is `fundingSelection.ts`'s, imported rather than redefined, for the same reason the rate
  // is aliased above: two implementations of one rounding is how a row and a meter start disagreeing
  // about the same cent. (Its clamp of a malformed reading to 0 is unreachable here: the transaction
  // is guarded finite-positive above and the gas component is a constant.)
  const buffered =
    routeKind === "buy"
      ? Math.round(toMicros(transactionUsd) * (1 + rate)) + toMicros(gas)
      : Math.round(toMicros(transactionUsd + gas) * (1 + rate));

  const target = ceilToUsd(buffered);
  return routeKind === "buy" ? Math.max(PAYBIS_MIN_USD, target) : target;
}
