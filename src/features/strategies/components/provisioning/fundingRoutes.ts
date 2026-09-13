/**
 * @id PP-CORE-LIB-061 (POO-1084, POO-1155, POO-1501, POO-1755, POO-1784, POO-1916)
 * @name resolveFundingRoutes
 * @implements-rules-version v8 (POO-1916 rules v1) · v7 (POO-1784 rules v1) · v6 (POO-1755 rules v1) · v5 (POO-1501 rules v1) · v4 (POO-1499 rules v1) · v3 (POO-1155 / POO-1129 rules v3) · v1 (POO-1084 rules v1)
 *
 * The assembly rule the whole "Where from" screen hangs on (POO-1082 [R1]/[R2]):
 *
 *   > Only what is missing. One choice per step. A step with a single viable option is skipped.
 *
 * Given what the operation still needs and what the wallet can actually spend towards it, this
 * answers "how many genuinely different ways are there to fund this". Two or more, and the user is
 * asked. One, and the app just takes it. None, and there is nothing to ask about either.
 *
 * ## What counts as spendable
 *
 * The same two tests the picker already applies, reused rather than re-derived
 * ({@link isSelectableVerdict}, {@link reachesChain}): a holding on a chain that cannot pay its own
 * gas cannot originate a transaction ([R3]), and a holding Uniswap routes nowhere near the target
 * would 404 at quote time. Both are deliberately conservative in the same direction as the picker:
 * an UNCLASSIFIED chain reads as spendable, and an empty routability set still allows a same-chain
 * holding, because a degraded read must never make a funded user look broke (UF-20 [R6]).
 *
 * ## Why the on-ramp is a parameter
 *
 * `onRampEnabled` is passed in, never read from a flag here. It is `false` for the whole crypto-only
 * cut (POO-1082 D3, POO-1089), which means exactly one route exists today and the step is always
 * skipped. Making it an argument keeps the two- and three-route shapes testable now, so the Paybis
 * phase turns it on rather than building it.
 *
 * ## The flag is not the whole question: the CHAIN answers too (POO-1784, POO-1916)
 *
 * A flag that is on still does not make a purchase possible everywhere, so the ramp-era routes are
 * ANDed with {@link onRampCanDeliverStable}, IMPORTED from `lib/onramp/destinations` and shared with
 * `buildPlan.buildOnRampSteps` rather than restated here, because a picker and the thing it picks
 * holding two copies of one rule is precisely how they came to disagree (POO-1784).
 *
 * What that predicate MEANS changed in POO-1916 [R1]. POO-1784 read it as "the target chain's stable
 * is the one the rail sells", on the premise that the leg carrying a purchase onwards is a same-token
 * bridge, and suppressed `buy`, `tokens-plus-buy` and the `deposit` link on a Robinhood Chain (4663,
 * USDG) target. A live probe says `USDC(8453) -> USDG(4663)` answers `200`, `routing: "BRIDGE"`
 * (2026-09-11, re-probed 2026-09-12), so the purchase does reach that chain and the suppression was
 * withholding a route that works. The predicate is now the STATIC half only -- does the registry name
 * a stable there -- and the planner settles the live half against `/quote` ([R3]). This function is a
 * pure render-time call and cannot ask a live question, so it is deliberately the optimistic side of
 * that split, exactly as it already is about gas (an UNCLASSIFIED chain reads as spendable).
 *
 * `tokens` is untouched: a wallet that covers the operation on its own is not a purchase, and
 * refusing it would turn a working Robinhood invest into a dead end.
 *
 * ## `deposit` has its OWN reason to be absent (POO-1916 [R4])
 *
 * It used to ride the buy card's gate, justified as "a peer of the buy card" (POO-1155), which is
 * incidental: it is true of the layout, not of whether the link works. Un-gating the purchase would
 * have un-gated the link with it, so the real reason now sits at the gate --
 * {@link depositServesChain}, over the `DEPOSIT_NETWORKS` list that POO-1776 [R4] keeps 4663 out of.
 * A ghost link to a surface that cannot name the user's chain is a dead end dressed as an escape.
 *
 * ⚠ One deliberate, documented narrowing against the planner: `buildOnRampSteps` scopes its refusal
 * to `shortfall > 0`, so a GAS-ONLY purchase (buy ETH on Base, never touching a stable) stays
 * available on Robinhood. This function has no such carve-out, per POO-1784 [R1], because it cannot
 * see whether the requirement it was handed is gas-only: `requiredUsd` arrives already summed. The
 * cost is a gas-only Robinhood need losing a route the planner would still serve; the alternative is
 * splitting the requirement across this boundary for a case gated behind two flags that are both off
 * in production. Revisit with the Robinhood alpha if that need turns out to be real.
 *
 * ## The empty-wallet tension, on purpose
 *
 * The case matrix draws an empty wallet as `1 Where from → Buy with card`, but [R2] says a single
 * option is skipped, and an empty wallet leaves exactly one. [R2] wins: a screen that asks a
 * question with one answer is not a choice. Revisit with POO-1089, when the buy route first exists.
 *
 * ## Money
 *
 * No arithmetic of its own. The running total goes through {@link fundingProgress}, which
 * accumulates integer micro-dollars and rounds a shortfall UP and a surplus DOWN. A second
 * implementation here is exactly how the route subtitle and the picker's meter would start
 * disagreeing about the same wallet by a cent.
 */

// The list that decides whether `/deposit` serves a chain, read at its source (POO-1916 [R4]). Pure
// constants, no `server-only` in its graph, so a `"use client"` component importing this stays safe.
import { depositServesChain } from "@/features/deposit/lib/depositNetworks";
// Type-only, and therefore erased at compile time: `fundingInventory.ts` is `server-only` and this
// module is imported by `"use client"` components. Never turn this into a value import (ADR 0003).
import type { FundingSource } from "@/lib/balances/fundingInventory";
// The predicate the PLANNER applies, imported rather than re-derived (POO-1784 [R1]). Pure and
// client-safe: it reads only the chain registry (`lib/onramp/serverBoundary.test.ts` pins that).
import { onRampCanDeliverStable } from "@/lib/onramp/destinations";
import type { GasFeasibility } from "@/lib/provisioning";
import { onRampRouteBuysGas } from "@/lib/provisioning";
import { fundingProgress, fundingSourceKey, spendableSources } from "./fundingSelection";
import type { SourceTargetInput } from "./fundingTarget";
import { sourceTargetUsd } from "./fundingTarget";

/**
 * How a requirement can be funded.
 *
 * `tokens` — the wallet covers it on its own.
 * `tokens-plus-buy` — the wallet covers part of it; the rest is bought.
 * `buy` — all of it is bought (bank transfer, card, Apple Pay and others, not card-only).
 * `deposit` — POO-1155: fund from an external wallet, the existing web3 deposit path, offered as a
 *   PEER option on the "Where from" screen rather than a separate escape. It carries no funding
 *   figures: the amount is settled on the deposit surface, not here.
 */
export type FundingRouteKind = "tokens" | "tokens-plus-buy" | "buy" | "deposit";

/** One way to fund the requirement, with the figures its row needs. */
export interface FundingRoute {
  kind: FundingRouteKind;
  /** USD this route draws from the wallet. Zero for a pure purchase. */
  availableUsd: number;
  /** USD this route has to buy. Zero when the wallet covers the requirement. */
  shortfallUsd: number;
  /**
   * USD THIS route must source, buffer and its own gas component included (POO-1499 [R53]).
   *
   * Per route rather than one figure for the screen, because they genuinely differ: the tokens route
   * converts a holding and pays the swap floor, while the buy route holds a reserve back out of ETH
   * it already bought. That is why `Buy` costs less than `Use your tokens` for one operation, and it
   * is what R5's `Use your {amount}` / `Buy {amount}` interpolate.
   *
   * **Absent** when the caller states no `target`, and absent on `deposit`, whose amount is
   * settled on the deposit surface. Undefined rather than `0` on purpose: a row that prints `$0.00`
   * is a confident wrong number, while an absent figure forces the consumer to decide what to show.
   * Optional so every call site that predates POO-1499 keeps compiling and behaving exactly as it did.
   *
   * Distinct from {@link FundingRoutesInput.requiredUsd}, which is unchanged and still decides which
   * routes exist and whether the wallet covers them.
   */
  sourceTargetUsd?: number;
}

/** What {@link resolveFundingRoutes} needs to know. */
export interface FundingRoutesInput {
  /** Everything the wallet can pay with, across chains (the routable inventory). */
  sources: readonly FundingSource[];
  /** The gas verdict per candidate chain. An absent entry is unclassified, not blocked. */
  gasByChainId: Readonly<Record<number, GasFeasibility>>;
  /** The chain the operation runs on. */
  targetChainId: number;
  /** What still has to be funded, in USD, fees and buffer included. */
  requiredUsd: number;
  /** Whether the fiat on-ramp is a real option. `false` for the crypto-only cut. */
  onRampEnabled: boolean;
  /**
   * What the operation itself costs, and optionally the quote's buffer rate (POO-1499 [R49]; the D9
   * seam is `SourceTargetInput.bufferRate`).
   *
   * Optional and additive: it feeds {@link FundingRoute.sourceTargetUsd} only, so a call site that
   * predates POO-1499 keeps its exact behaviour and reports NO target rather than a wrong one.
   * `target.transactionUsd` is NOT a second `requiredUsd`: that one is already buffered and is what
   * coverage is measured against, while this is the bare figure the per-route maths starts from.
   *
   * `gasNeeded` is deliberately NOT part of this group (POO-1542 [B]). It used to be one flag the
   * caller computed once and this function applied to every route alike, which is exactly how the
   * buy row ended up asking the wrong question: the panel's `ProvisioningPanel.tsx` answers "does
   * the TARGET chain need gas" for its own `1c` frame, and that is the right question for `tokens` /
   * `tokens-plus-buy` (a conversion that lands on the target), but the WRONG one for `buy` (a card
   * purchase that lands as ETH on Base first, whatever the target is). This function now derives
   * `gasNeeded` itself, per route, from `gasByChainId` + `targetChainId` it already receives — see
   * {@link gasNeededFor} — so a caller cannot re-introduce the divergence by passing one shared flag.
   */
  target?: Omit<SourceTargetInput, "routeKind" | "gasNeeded">;
}

/**
 * The genuinely different ways to fund this requirement, most-preferred first.
 *
 * Ordering is the board's rule 5: the on-ramp is the last resort, so a wallet-funded route always
 * precedes a purchase. An empty array means there is no route to offer, which is not the same as an
 * error: the picker still renders its own short state, with the gap named and the CTA closed.
 */
export function resolveFundingRoutes(input: FundingRoutesInput): FundingRoute[] {
  const { sources, gasByChainId, targetChainId, requiredUsd, target } = input;

  // POO-1784 [R1]/[R2], as corrected by POO-1916 [R1]: the ramp is a real option only when a stable
  // can reach THIS chain. The flag and the chain are ANDed once, here, so every purchase route below
  // reads one answer and they cannot part company. On the launch chains this is `true` and the value
  // is the flag itself, byte-for-byte the pre-POO-1784 behaviour; on 4663 it is now `true` as well,
  // because the bridge delivers USDG (probed live, see the header).
  const onRampEnabled = input.onRampEnabled && onRampCanDeliverStable(targetChainId);

  /**
   * Does THIS route have to source gas at all? (POO-1542 [B])
   *
   * `buy` shares its predicate with `buildPlan.buildOnRampSteps` — the SAME imported function,
   * `onRampRouteBuysGas` — so the row and the plan cannot disagree on whether the reserve is real:
   * a card purchase lands as ETH on Base first regardless of the target chain's own verdict.
   *
   * `tokens` / `tokens-plus-buy` ask only about the TARGET chain, unchanged from before this issue:
   * converting a holding lands directly on the target, so Base's own gas is beside the point for
   * these two routes. `deposit` never reaches this (it carries no target figure).
   */
  const gasNeededFor = (routeKind: FundingRouteKind): boolean =>
    routeKind === "buy"
      ? onRampRouteBuysGas(gasByChainId, targetChainId)
      : gasByChainId[targetChainId]?.verdict !== "OK";

  /**
   * POO-1499 [R53]: what THIS route has to source, which is not what the next one has to.
   *
   * `undefined` when the caller named no target (or a malformed transaction), so a pre-POO-1499
   * call site reports no figure rather than a fabricated `$0.00`, and its existing deep-equality
   * tests keep passing untouched.
   *
   * POO-1755 [R1]: a ZERO transaction is a stated target, not an absent one, whenever the route
   * still has gas to source. The five non-spending ops carry `opRequiredUsdc: 0` by definition and
   * POO-1033 [R2] deliberately routes them into the wizard, so reading their zero as "no target"
   * left every card `undefined` and the picker's D1 skeleton on screen forever, with nothing in
   * flight to resolve it. `undefined` must mean "a figure is still coming"; a figure this function
   * can price NOW is always priced. A zero with nothing to source at all keeps `undefined`, which
   * preserves the D1 semantics for the one shape that genuinely has no amount to print (it is also
   * unreachable: a need that classifies `multi` always has a gas or USDC gap behind it).
   */
  const targetFor = (routeKind: FundingRouteKind): number | undefined =>
    target &&
    Number.isFinite(target.transactionUsd) &&
    (target.transactionUsd > 0 || (target.transactionUsd === 0 && gasNeededFor(routeKind)))
      ? sourceTargetUsd({ ...target, routeKind, gasNeeded: gasNeededFor(routeKind) })
      : undefined;

  // [R1] Nothing missing, nothing to route. A zero (or malformed) requirement is not a funding
  // question, and offering routes for it would put a screen in front of an operation that is
  // already fully funded.
  if (!Number.isFinite(requiredUsd) || requiredUsd <= 0) return [];

  const spendable = spendableSources(sources, gasByChainId, targetChainId);
  const progress = fundingProgress(spendable, spendable.map(fundingSourceKey), requiredUsd);

  const routes: FundingRoute[] = [];

  if (progress.covered) {
    routes.push({
      kind: "tokens",
      availableUsd: progress.selectedUsd,
      shortfallUsd: 0,
      sourceTargetUsd: targetFor("tokens"),
    });
  } else if (onRampEnabled && progress.selectedUsd > 0) {
    routes.push({
      kind: "tokens-plus-buy",
      availableUsd: progress.selectedUsd,
      shortfallUsd: progress.remainingUsd,
      sourceTargetUsd: targetFor("tokens-plus-buy"),
    });
  }
  // A wallet that falls short with no on-ramp gets NO tokens route. It would send the user to a
  // picker whose CTA can never open, dressed as a way forward.

  if (onRampEnabled) {
    routes.push({
      kind: "buy",
      availableUsd: 0,
      shortfallUsd: progress.requiredUsd,
      sourceTargetUsd: targetFor("buy"),
    });
    // POO-1155: depositing from an external wallet is always a way to fund the requirement, so it is
    // offered as a PEER on the "Where from" screen rather than hidden as a separate escape. Gated on
    // the SAME `onRampEnabled` as the buy route so the crypto-only cut (where this screen never
    // renders) stays byte-identical: with the flag off, `routes` is at most `[tokens]` and the picker
    // is skipped exactly as before. It carries no figures; the amount is settled on the deposit
    // surface (`/deposit`), and the panel routes the choice there.
    //
    // POO-1916 [R4]: and on a SECOND condition of its own, which the buy card does not share. Until
    // now the two were one gate and the shared answer happened to suppress both on Robinhood Chain;
    // the purchase is offered there again, and this link must not follow it, because
    // `DEPOSIT_NETWORKS` excludes 4663 (POO-1776 [R4]) and the link would open a surface that cannot
    // name the user's chain. Recorded here rather than left to the layout argument it used to rest
    // on, so nobody re-derives "deposit is a peer of buy" into "deposit goes wherever buy goes".
    if (depositServesChain(targetChainId)) {
      routes.push({ kind: "deposit", availableUsd: 0, shortfallUsd: 0 });
    }
  }

  return routes;
}

/** [R2] Does the user get asked? Only when there is more than one answer. */
export function shouldPickRoute(routes: readonly FundingRoute[]): boolean {
  return routes.length > 1;
}

/**
 * The routes drawn as CARDS. `deposit` is a ghost link below them (POO-1501 [R7]), not a card, so it
 * is excluded from anything that reasons about the choice the cards present.
 *
 * Exported (POO-1541) so `FundingRoutePicker` and `ProvisioningPanel` filter to the SAME set the
 * screen actually renders as choices, rather than each keeping its own copy that could drift.
 */
export const CARD_ROUTE_KINDS: readonly FundingRouteKind[] = ["tokens", "tokens-plus-buy", "buy"];

/**
 * A route that can carry `Recommended`. `deposit` cannot, and saying so in the TYPE rather than only
 * in prose is what stops a caller having to handle a case this function never produces: an analytics
 * param typed to the real set caught exactly that, which is the interlock working.
 */
export type RecommendableRouteKind = Exclude<FundingRouteKind, "deposit">;

/**
 * Which route carries `Recommended`, if any (POO-1501 [R6]).
 *
 * The rule is FEWEST STEPS, and it collapses to one question because of how the routes are built.
 * A `tokens` route is only pushed when the wallet COVERS the target (see `progress.covered` above),
 * so its mere presence means converting is enough on its own: one step. When it is absent the wallet
 * falls short, and then `buy` (one step) beats `tokens-plus-buy` (convert, buy, then move).
 *
 * **Nothing is recommended when only one card is on screen.** A badge that appears on the only
 * option is not guidance, it is decoration, and it invites the user to look for the comparison it
 * implies. `deposit` never counts here: it is a ghost link ([R7]), so a screen showing `Buy` plus the
 * deposit link is a one-card screen and carries no chip. That is `1d`, the empty wallet.
 */
export function recommendedRouteKind(
  routes: readonly FundingRoute[],
): RecommendableRouteKind | undefined {
  const cards = routes.filter((route) => CARD_ROUTE_KINDS.includes(route.kind));
  if (cards.length < 2) return undefined;
  return cards.some((route) => route.kind === "tokens") ? "tokens" : "buy";
}
