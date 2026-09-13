/**
 * @id PP-CORE-HOK-028 (POO-1172)
 * @name transaction flow instrumentation kit
 * @analytics-events tx_flow_abandoned, tx_signature_requested, tx_review_reached,
 *   tx_amount_blocked
 * @implements-rules-version v2 (POO-1385 rules v2) · v1
 * @epic POO-1168 (Google Analytics: GTM, GA4, Hotjar)
 *
 * The two cross-modal observers every money flow needs, and the two closed unions they define.
 *
 * LANE-1 exists because these cannot live in a feature lane: five modals need the same abandonment
 * semantics and the same signature semantics, and five independent implementations of "did this
 * session conclude?" would disagree within a quarter. A host wires each with a few lines in a file
 * it already owns.
 *
 * ## Why the unions are HERE and not in `events.ts`
 *
 * `AnalyticsTxExit` and `AnalyticsTxStep` were deliberately NOT landed with the rest of the taxonomy
 * in POO-1171. There was no single source to derive them from at that point: `SigningWhy` turned out
 * to be free i18n strings rather than an enum, and the exit points live in five separate modal state
 * machines. Declaring them ahead of their only consumer would have been guessing, and **a wrong union
 * member is harder to remove later than a missing one is to add**.
 *
 * They are derived here, against the emitters that use them, from what the code actually contains.
 *
 * ## What these observers do NOT do
 *
 * Neither proves the event fires at the right moment. `tx_flow_abandoned` proves a session ended
 * without calling `conclude()`; whether the host calls it on every real conclusion is the host's
 * correctness, not this module's. That is the same honest limit `scripts/analytics-check.ts` states
 * about itself.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AnalyticsFlow } from "./events";
import { useAnalytics } from "./useAnalytics";

/**
 * Where a user was when they left a transaction flow.
 *
 * Derived from the `Phase` unions of the five money modals, keeping only the states a user can
 * ABANDON from. `success` and `error` are deliberately absent: those are conclusions, and a session
 * that reached one is not an abandonment by definition.
 *
 * `pending` is the interesting one and the reason this is not just "review". A user who closes the
 * tab while the transaction is in flight has not abandoned their intent, they abandoned the WAIT,
 * and the money may still land. Counting that as ordinary drop-off would overstate churn on exactly
 * the flows that work.
 */
export const ANALYTICS_TX_EXITS = [
  /** The amount step, before any quote existed. */
  "amount",
  /** The confirm step of a flow that has no amount (collect, close). */
  "confirm",
  /** Waiting for the server build. Leaving here is usually latency, not a decision. */
  "building",
  /** The Review step: the quote, the fees and the impact are all on screen. */
  "review",
  /** The provisioning rail: the user was told they need to fund first. */
  "provision",
  /**
   * Inside the third-party on-ramp widget (POO-1174 [R2]). Added rather than folded into `pending`
   * or `provision`, both of which would have misreported it: `pending` means an on-chain
   * transaction in flight, and `provision` means the user was told to fund first. Walking away
   * mid-purchase at a card processor is neither, and it is the fiat funnel's most valuable exit,
   * because week one reconciles deposit completions against Paybis's own dashboard and only this
   * event separates "they left" from "the emitter is broken".
   */
  "onramp",
  /** In flight. Abandoning the wait, not the intent. */
  "pending",
] as const;

export type AnalyticsTxExit = (typeof ANALYTICS_TX_EXITS)[number];

/**
 * Which wallet prompt a signature request is for.
 *
 * Derived from the `key` on the `FlowStep[]` the money hooks build. Deliberately EXCLUDES two
 * families that look like neighbours:
 *
 * - `build`, by far the most common step key, is the SERVER build. It raises no wallet prompt, so
 *   counting it as a signature would inflate every prompt-per-flow figure with a step the user never
 *   sees.
 * - The provisioning legs (`op`, `swap`, `bridge`, `buy`, `gas`) already have their own dimension in
 *   `leg_kind`, and the funding funnel reports them. Duplicating them here would double-count.
 *
 * `approve` self-skips when the existing allowance already covers the amount, so a flow legitimately
 * raises two OR three prompts. That variance is the point: nothing in the union measures wallet
 * friction today, and POO-1175 records that not one signature is instrumented anywhere in the app.
 */
export const ANALYTICS_TX_STEPS = [
  /** ERC-20 approval to Permit2. Skipped when the allowance already covers. */
  "approve",
  /** The Permit2 signature. */
  "permit",
  /** The operation itself: the prompt where the money actually moves. */
  "confirm",
] as const;

export type AnalyticsTxStep = (typeof ANALYTICS_TX_STEPS)[number];

/**
 * Why a CTA could not act.
 *
 * Closed on purpose, and the reason is the same one that made `error_code` a shape check rather than
 * a mirrored union: a value here must be a CODE, never a label. `ReviewStep.tsx:914-927` already
 * builds an exhaustive list of seven blocking reasons and discards it, but it builds them as
 * TRANSLATED strings. Sending those would produce eleven variants of one reason (one per locale),
 * leak product copy into an analytics property, and make the dimension unusable for exactly the
 * grouping it exists for.
 *
 * These seven are read off that list's semantics, which is the only enumerated set of block reasons
 * in the repo today. **The union grows by reviewed addition as hosts wire**, and being closed is what
 * forces that review: a host cannot invent a reason silently, it has to add one here where someone
 * will ask whether it is really distinct from a reason that already exists.
 */
export const ANALYTICS_BLOCK_REASONS = [
  /** A required name is missing or fails its length rule. */
  "name_invalid",
  /** A fee or rate input is outside its permitted range. */
  "fee_invalid",
  /** An amount is missing, unparseable, or fails validation. */
  "amount_invalid",
  /** An amount is below the operation's economic minimum. */
  "below_minimum",
  /** A price range or its ticks could not be resolved. */
  "range_invalid",
  /** A required price is unknown, so the operation cannot be sized. */
  "price_unknown",
  /** An upload is still in flight and the value it produces is required. */
  "upload_in_progress",
  /**
   * The amount asked for is more than the position or balance holds.
   *
   * Split out of the generic `amount_invalid` deliberately. `WithdrawModal`'s `valid` gate folds
   * "nothing typed yet" and "more than you have" into one boolean, and only the second is a signal:
   * an empty field is a user who has not started, while an over-balance amount is a user who tried
   * to take out more than exists and was stopped. Reporting them as one reason would bury the
   * interesting half under the common one.
   */
  "exceeds_balance",
  /**
   * There is nothing to act on: claimable fees under the minimum, a position at dust.
   *
   * Distinct from `below_minimum`, which is about what the USER entered. This one is about what the
   * POSITION holds, so it is true the moment the modal opens and no input can clear it. Folding the
   * two together would make "users keep typing amounts that are too small" indistinguishable from
   * "users keep opening a modal that had nothing to offer them", which point at opposite fixes.
   */
  "nothing_to_claim",
  /**
   * The operation's chain is not in the wallet at all (POO-1385 [R8]).
   *
   * Not a validation reason like the others: nothing the user typed is wrong, and no input can clear
   * it. It is here because it is the purest blocked intent in the app: the user asked to invest and
   * the product said no, for a reason that lives entirely in their wallet's configuration. Distinct
   * from a wallet on the wrong chain, which is not blocked at all, just one prompt away.
   */
  "chain_unavailable",
  /**
   * The wallet is connected to a chain Pool Party does not support, so the SIWE handshake is refused
   * before a signature is even requested (POO-1461 [R1]).
   *
   * The INVERSE of `chain_unavailable`, and the reason both exist. There, our chain is missing from
   * their wallet, and the remedy lives in the wallet app: enable the network, then switch. Here,
   * their chain is missing from our supported set, and the remedy lives on our screen: switch to a
   * network we serve, then retry. Same word "chain", opposite direction, different fix, so folding
   * them together would produce a number nobody could act on.
   */
  "unsupported_chain",
  /**
   * The human dismissed the wallet prompt (POO-1461 [R1]).
   *
   * The one reason in this union where the product did not refuse anything, and it earns its place
   * for the same argument `nothing_to_claim` does: it shares a SURFACE with reasons that are
   * refusals, and separating them is the whole diagnostic. A user who cannot sign in because their
   * network is unsupported and a user who chose not to sign are looking at the same blocking dialog
   * and need opposite responses from us.
   */
  "user_rejected",
  /**
   * The rail serving fiat does not sell the NATIVE coin, so the gas-first buy leg is refused before
   * a checkout opens (POO-1808 [R4], answered by POO-1820).
   *
   * Distinct from `chain_unavailable` and from `nothing_to_claim`: the chain is fine and there is
   * plenty to act on, but this particular asset cannot be bought with money on this rail. It is a
   * VENDOR capability boundary, and it is reported because the product decision behind it (cover
   * gas with a paymaster, or disclose it differently) is still open: the number tells whoever takes
   * that decision how often a real buyer hits the wall.
   */
  "onramp_native_unavailable",
  /**
   * No provider will sell to this buyer, in this currency, for this amount, right now
   * (POO-1808 [R6], asked through POO-1805's probe).
   *
   * Not a validation reason and not a permanent one: coverage is a question with an answer that
   * changes without a release, which is why it is asked rather than looked up. Separated from every
   * reason above because the remedy is neither ours nor the buyer's input: it is a different payment
   * currency, or a wallet they already hold.
   */
  "onramp_uncovered",
  /**
   * The buyer's resolved currency is not one the rail can charge in, so the buy is refused before a
   * checkout opens (POO-1808 [R7], the POO-1512 class).
   *
   * The alternative is worse and is exactly what this reason exists to prevent: falling back to USD
   * would charge a buyer in a currency nobody chose for them, let their bank take the conversion,
   * and look like a successful purchase from every angle we can see. Distinct from
   * `onramp_uncovered`, which is about who will SELL: here somebody would sell, in a currency we
   * cannot ask for. The count is what tells us which currency to get onto the rail next.
   */
  "onramp_currency_unsupported",
  /**
   * The destination balance could not be read, so there is no baseline to subtract a delivery from
   * and the buy CTA refuses to open a checkout (POO-1808 [R5]).
   *
   * Reported because it is otherwise invisible: the buyer sees a "checking your balance" line that
   * never resolves, and nothing downstream records that a purchase was wanted. Defaulting the
   * baseline to zero instead would credit the buyer's OWN balance as a delivery the first time the
   * watcher looked, which is the fabricated-success class ADR-0004 exists to close. Fires once per
   * mount, because it is a read that failed rather than something the buyer did.
   */
  "onramp_baseline_unreadable",
  /**
   * A fiat purchase intent for this wallet was PAID as far as we observed, and has not landed, so a
   * fresh purchase is refused until the buyer says which they want (POO-1642 [R3], POO-1384 [R16]).
   *
   * The product genuinely says no here: the buyer pressed the money CTA and no purchase was minted.
   * Answering resumes into the settling screen or discards the old intent, but the interception is
   * the fact worth counting, exactly as `funding_run_stop_blocked` counts the attempt rather than
   * the answer.
   */
  "purchase_paid_unsettled",
  /**
   * The same refusal for an intent we never saw paid, past its resumable window (POO-1642 [R4],
   * POO-1384 [R15]).
   *
   * Split from `purchase_paid_unsettled` rather than folded into it, because the two point at
   * opposite fixes and folding them buries the actionable half. A PAID intent that never landed is
   * our settlement observer missing a delta, and the number to watch is whether it is rising. An
   * UNVERIFIED one is an intent that aged out while the buyer was inside a bank app or a 3DS
   * redirect, and the number to watch is how many buyers answer "resume" (we asked needlessly)
   * versus "start a new one" (the window is too short). One dimension value could answer neither.
   */
  "purchase_unverified",
  /**
   * The buyer said they had sent a crypto transfer and asked us to confirm it, and we have nothing
   * watching the address, so we cannot (POO-1624 [R5]).
   *
   * The product genuinely says no: the buyer pressed the money CTA on `/deposit`'s crypto path and
   * the answer is "check back", not a receipt. Deliberately NOT reported as `deposit_failed`:
   * nothing failed, the transfer is very probably arriving, and folding a missing OBSERVATION into
   * the fiat funnel's failure rate would corrupt the one number week-one reconciles against Paybis'
   * own dashboard.
   *
   * The count is the point. It is the denominator for the decision this event exists to inform:
   * how many real buyers reach a wait we cannot answer, and therefore whether extending POO-1129's
   * balance-delta reconcile to the crypto path is worth building. Until then the number is the only
   * evidence the absence costs anything.
   */
  "transfer_unobserved",
  /**
   * The buyer pressed the fiat confirm in REAL mode while the `fiatOnRamp` flag was dark (POO-1794
   * [R1]/[R2]). The on-ramp is not launched, so no provider is charged and no settlement can be
   * observed, and the confirm refuses rather than fabricating a completion.
   *
   * Deliberately NOT `transfer_unobserved`: that reason means a real flow ran and only its watcher
   * is missing, and week one reconciles its count against the provider's own dashboard. This one
   * means no flow ran at all, so folding it in would inflate exactly the number that reconciliation
   * trusts. Deliberately NOT `deposit_failed` either: nothing failed, because nothing ran. Like
   * `transfer_unobserved` it is a terminal blocked intent that CONCLUDES the abandonment, so it is
   * the deposit funnel's fifth settlement term:
   * `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`.
   *
   * A defense-in-depth count: a correct launch turns the flag on before the fiat method is
   * reachable, so a non-zero count is the alarm that a real buyer met a dark on-ramp.
   */
  "onramp_disabled",
  /**
   * POO-1807 [R10]. The Privy rail's two released-screen exits, on `/deposit` and later on the
   * operation hosts. Both mean the same thing at the top level, the visible observation window
   * (ADR-0006) closed without a delta, and they are split because they point at OPPOSITE fixes:
   *
   *   - `onramp_paid_unsettled`: we hold the provider's CLAIM that it charged, and the money has not
   *     landed inside the window. The question that count answers is whether 90 seconds is too short.
   *   - `onramp_unverified`: we hold no claim at all. The question is how often an inconclusive exit
   *     is a genuine abandonment rather than a charge we never saw, which is the one thing the
   *     3.40.0 upgrade made indistinguishable at the exit.
   *
   * Same split, and the same reason for it, as `purchase_paid_unsettled` / `purchase_unverified`.
   *
   * **Neither CONCLUDES the abandonment**, unlike `transfer_unobserved` and `onramp_disabled`. They
   * are denominators, like `below_minimum`: the flow is not over when they fire. The passive window
   * outlives the screen and may still settle the purchase, so concluding here would let one
   * `deposit_started` produce two settlement terms. The identity is therefore unchanged:
   * `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`, with a
   * released screen resolving later as `completed` (the delta landed) or `abandoned` (the buyer
   * left). That `abandoned` covers a buyer who paid and is waiting is a known imprecision, recorded
   * in POO-1807's PR rather than papered over.
   */
  "onramp_paid_unsettled",
  "onramp_unverified",
  /**
   * POO-1807 [R7]. The coverage probe (`PP-CORE-LIB-108`) answered that NOBODY will sell to this
   * buyer, in this currency, at this amount, so the confirm refuses before any checkout opens.
   *
   * Deliberately NOT `deposit_failed`: nothing failed and nothing ran. Deliberately not
   * `below_minimum` either, which is our own floor; this is the market's answer, and the two lead to
   * different actions (raise the amount, versus there is nothing to raise it to).
   */
  "onramp_uncovered",
  /**
   * POO-1807 [R7] (POO-1801 review F10). The rail does not sell in this buyer's currency, or we
   * could not resolve one for them at all, so the confirm refuses before any checkout opens.
   *
   * Its own reason rather than `onramp_uncovered` because the two point at OPPOSITE fixes, and one
   * of them is ours: `onramp_uncovered` is the market's answer for a currency we can charge in, and
   * clears by itself; this one means either the rail's currency union does not cover a real buyer
   * (a product gap) or our own resolution chain failed (an outage). Folded together, an outage in
   * `resolveOnRampCurrency` would read as demand from an unserved country.
   *
   * A DENOMINATOR, not a settlement term, like the two above: nothing ran, and the buyer is still
   * on the flow.
   */
  "onramp_currency_unsupported",
  /**
   * The position's own contract refuses the operation because it predates the version that supports
   * it (POO-1712 [R5]). Today: `MoveRange.exec` requires `version() >= 2`, and 43 of 387 live
   * positions are version 1.
   *
   * Deliberately NOT `range_invalid`. That reason means WE could not resolve something (an
   * unreadable fee tier, an unmeasured band) and is transient, cleared by a better read. This one
   * means the CHAIN will not accept the call no matter what the manager does or what we read: no
   * range, no retry and no reload can clear it. Folding them together would bury a permanent
   * condition inside a metric people watch for read failures.
   *
   * POO-1712 rules v2 (Rafael, 2026-08-20): permanent means PERMANENT. A version-1 position will
   * never move its range, and there is no migration coming, so this count is not a backlog waiting
   * to be drained. It measures how often a manager walks into a wall we already know about, which is
   * the number that says whether the refusal is doing its job or whether these 43 positions need a
   * louder treatment than a soft-blocked button.
   *
   * Note the blast radius is narrower than it looks: `MoveRange.sol:53` is the ONLY hard
   * `require(version() >= POSITION_VERSION_2)` in the position implementation. Withdraw, liquidity,
   * collect, close and rewards all BRANCH on the version instead of refusing, so a v1 position is
   * no OTHER version refusal exists in the position implementation. That is narrower than
   "fully operable": nobody has executed a collect, a close or a liquidity change against a live
   v1 position to prove it, and these are proxies running the current implementation.
   */
  "position_version_unsupported",
] as const;

export type AnalyticsBlockReason = (typeof ANALYTICS_BLOCK_REASONS)[number];

/** Context both observers carry. */
export interface TxFlowContext {
  flow: AnalyticsFlow;
  strategyId?: string;
}

export interface TxFlowAbandonment {
  /**
   * Record that the session reached a terminal outcome. Call on completion AND on failure: a flow
   * that failed did not get abandoned, it got answered.
   */
  conclude: () => void;
}

/**
 * Emit `tx_flow_abandoned` when a flow session ends without concluding.
 *
 * The mechanics copy `provisioningFunnel.ts`, which is the reference implementation in this repo and
 * had already worked out the three things that are easy to get wrong:
 *
 * 1. **`[]` deps on the effect**, so the cleanup runs on the REAL unmount and not on every re-render.
 *    A modal re-renders constantly while a quote refreshes.
 * 2. **The emitter is reached through a ref**, because a stale closure here reports the wrong flow.
 * 3. **A `concludedRef`**, so a session that already emitted a completion or a failure never also
 *    reports an abandonment. Without it `started` stops equalling `completed + failed + abandoned`,
 *    and the funnel arithmetic is the entire reason the event exists.
 *
 * `exitAt` is read as a FUNCTION at unmount rather than captured, because where the user was is only
 * knowable at the moment they left. Returning `null` suppresses the event, which is how a host says
 * "this close is not an abandonment" (a programmatic close, a route change it initiated itself).
 */
export function useTxFlowAbandonment(
  context: TxFlowContext,
  exitAt: () => AnalyticsTxExit | null,
): TxFlowAbandonment {
  const { track } = useAnalytics();
  const contextRef = useRef(context);
  contextRef.current = context;
  const exitAtRef = useRef(exitAt);
  exitAtRef.current = exitAt;
  const concludedRef = useRef(false);
  const firedRef = useRef(false);
  const trackRef = useRef(track);
  trackRef.current = track;

  useEffect(
    () => () => {
      if (concludedRef.current || firedRef.current) return;
      const exit = exitAtRef.current();
      if (!exit) return;
      firedRef.current = true;
      const { flow, strategyId } = contextRef.current;
      trackRef.current("tx_flow_abandoned", {
        flow,
        ...(strategyId ? { strategy_id: strategyId } : {}),
        tx_exit: exit,
      });
    },
    [],
  );

  const conclude = useCallback(() => {
    concludedRef.current = true;
  }, []);

  return { conclude };
}

/**
 * Emit `tx_signature_requested` each time a wallet prompt becomes active.
 *
 * A thin OBSERVER over the per-step statuses `useWalletSignFlow` already maintains, which is the same
 * shape `ProvisioningPanel` uses to observe leg settlement. Observing rather than instrumenting each
 * call site is what keeps this correct as flows change their step composition: a hook that grows a
 * step gets it counted without anyone remembering to add a `track`.
 *
 * Fires on the `active` transition only. A step that goes `active -> error -> active` on a retry is a
 * SECOND request, which is right: the user really was prompted twice, and prompt count per completed
 * flow is the wallet-friction number POO-1175 says nothing measures today.
 *
 * Steps whose key is not a wallet prompt are ignored, so a host can pass its whole step list.
 */
export function useTxSignatureObserver(
  context: TxFlowContext,
  steps: readonly { key: string }[],
  statuses: readonly string[],
): void {
  const { track } = useAnalytics();
  const contextRef = useRef(context);
  contextRef.current = context;
  const seenActive = useRef<Set<number>>(new Set());

  useEffect(() => {
    statuses.forEach((status, index) => {
      const step = analyticsTxStepOf(steps[index]?.key);
      if (status !== "active") {
        // Leaving `active` re-arms the step, so a retry counts as a genuine second prompt.
        if (status !== "done") seenActive.current.delete(index);
        return;
      }
      if (seenActive.current.has(index)) return;
      if (!step) return;
      seenActive.current.add(index);
      const { flow, strategyId } = contextRef.current;
      track("tx_signature_requested", {
        flow,
        ...(strategyId ? { strategy_id: strategyId } : {}),
        tx_step: step,
      });
    });
  }, [statuses, steps, track]);
}

/**
 * Emit `tx_review_reached` once per session, when the flow first reaches its Review step.
 *
 * This is the event that finally makes `*_submitted` comparable across flows (POO-1175). Invest
 * fires `submitted` on the AMOUNT CTA while withdraw fires it on the CONFIRM CTA, so the two have
 * never measured the same thing and nobody noticed. A shared "the user saw the quote, the fees and
 * the impact" step gives every flow one honest common denominator, without moving either existing
 * emitter and breaking its series.
 *
 * Fires once per mount, not once per visit to the step. Stepping back to edit an amount and
 * returning is one review, not two: the question is how many sessions reached the decision point.
 */
export function useTxReviewReached(context: TxFlowContext, reached: boolean): void {
  const { track } = useAnalytics();
  const contextRef = useRef(context);
  contextRef.current = context;
  const firedRef = useRef(false);

  useEffect(() => {
    if (!reached || firedRef.current) return;
    firedRef.current = true;
    const { flow, strategyId } = contextRef.current;
    track("tx_review_reached", {
      flow,
      ...(strategyId ? { strategy_id: strategyId } : {}),
    });
  }, [reached, track]);
}

/**
 * Emit `tx_amount_blocked` when a money CTA is blocked, once per engagement.
 *
 * Fires from DERIVED STATE, not from a click, and that is forced rather than chosen: every money CTA
 * uses a hard `disabled` with `pointer-events: none`, so unlike `app_cta_blocked` there is no tap to
 * intercept. The block is only observable by watching the state that causes it.
 *
 * The host passes a REASON, or `null` for "not blocked in a way worth reporting", and that split is
 * the whole design. The hook cannot tell an empty amount field from a rejected one, but the host
 * always can, and pushing the judgement there is what keeps this from counting every modal open as
 * a block. Concretely: an untouched field is `null`, an amount over the balance is
 * `exceeds_balance`.
 *
 * Fires once per engagement per reason, re-arming only when the reason clears. A user typing "1",
 * "10", "100" against a $50 minimum is ONE block they worked their way out of, not three.
 */
export function useTxAmountBlocked(
  context: TxFlowContext,
  reason: AnalyticsBlockReason | null,
): void {
  const { track } = useAnalytics();
  const contextRef = useRef(context);
  contextRef.current = context;
  const firedFor = useRef<AnalyticsBlockReason | null>(null);

  useEffect(() => {
    if (reason === null) {
      firedFor.current = null;
      return;
    }
    if (firedFor.current === reason) return;
    firedFor.current = reason;
    const { flow, strategyId } = contextRef.current;
    track("tx_amount_blocked", {
      flow,
      ...(strategyId ? { strategy_id: strategyId } : {}),
      block_reason: reason,
    });
  }, [reason, track]);
}

/**
 * Resolve a `FlowStep` key to the wallet prompt it stands for, or `undefined` when the step is not
 * one this module counts (the server `build`, the provisioning legs).
 *
 * Real step keys carry an operation suffix: `"confirm:collect"`, `"confirm:withdraw"`,
 * `"approve:USDC"`. The base name says WHAT the wallet asks, the suffix what it asks it FOR, so the
 * match accepts both forms while the RESOLVED value stays the base name. That is what
 * `AnalyticsParams.tx_step` accepts (`AnalyticsTxStep`), and it is what keeps the dimension
 * comparable across flows: a prompt count split by `"confirm:collect"` vs `"confirm:invest"` would
 * re-encode `flow`, which every event already carries.
 */
export function analyticsTxStepOf(key: string | undefined): AnalyticsTxStep | undefined {
  if (key === undefined) return undefined;
  return ANALYTICS_TX_STEPS.find((step) => key === step || key.startsWith(`${step}:`));
}

/** Whether a `FlowStep` key is one of the wallet prompts this module counts (either key form). */
export function isAnalyticsTxStep(key: string | undefined): boolean {
  return analyticsTxStepOf(key) !== undefined;
}
