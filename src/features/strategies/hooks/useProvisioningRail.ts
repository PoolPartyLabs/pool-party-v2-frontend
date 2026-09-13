/**
 * @id PP-STR-HOK-020 (POO-1042, POO-1043, POO-1136, POO-1384, POO-1413, POO-1508, POO-1578, POO-1573, POO-1666)
 * @name useProvisioningRail
 * @implements-rules-version v9 (POO-1666 rules v1) · v8 (POO-1573 rules v2) · v7 (POO-1578 rules v1) · v6 (POO-1508 rules v2) · v5 (POO-1413 rules v1) · v4 (POO-1384 / POO-1129 rules v4) · v3 (POO-1136 / POO-1129 rules v3) · v2 (POO-1043 rules v1) · v1 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Binds the execution rail to the connected wallet (POO-1042 [R10]).
 *
 * {@link buildPlanSteps} (PP-STR-LIB-017, POO-1036) has been the `ProvisioningPanel`'s typed
 * `buildPlanSteps` prop since the epic was designed, and **no production caller had ever passed it**.
 * Which means what actually ran, every time, was the panel's fallback: a 900 ms `setTimeout` that
 * settles a `0xMOCK…MOCK` hash. This hook is the missing binding, in one place, so all six op modals
 * get the same rail and none of them can drift into a private one.
 *
 * Everything the rail needs from the outside is injected rather than imported by it, for the reason
 * `buildPlanSteps` states: the three Uniswap calls are `"use server"` actions whose transport reads
 * `UNISWAP_API_KEY` (ADR 0003). Passing them as functions keeps the rail free of the server graph;
 * on the client they are RPC stubs, so the key stays where it belongs.
 *
 * Mock-safe like every other operation executor in this folder (`useInvest`, `useWithdraw`): in mock
 * mode {@link ProvisioningRail.buildSteps} is `undefined`, the panel falls back to its mock settle,
 * and mock behaviour is byte-identical to before this issue.
 *
 * ## POO-1043: the two omissions, closed
 *
 * **The recovery journal is bound.** POO-1042 passed no `journal`, so POO-1038's idempotency and
 * resume machinery, the highest-risk work in the epic, did not run in production at all: a killed tab
 * mid-bridge had no in-flight record to reconcile against the chain. It runs now, minted at the
 * moment the user approves the route ([R7], `02_BRIDGE_ARCHITECTURE.md` §3.7) rather than when the
 * plan is quoted, because a plan nobody accepted has no in-flight transactions to track and a record
 * of one would surface as "you have funding in progress" for a route that never started.
 *
 * The rail is BUILT when the plan resolves and the journal is MINTED at the confirm, a user decision
 * later, so the recorder resolves its journal at call time ({@link createDeferredJournalRecorder}).
 * Before {@link ProvisioningRail.openJournal} every write is a no-op, which is precisely the
 * pre-POO-1038 behaviour.
 *
 * **The re-quote confirmer is forwarded.** With none the rail REFUSES a materially worse re-quote
 * rather than signing it ([R5] of POO-1036), which is the correct default and a dead end: the leg
 * aborts with no way for the user to accept a price they might well be happy with. The prompt itself
 * is the panel's, and it travels down with the plan for the same reason `onLegBroadcast` does.
 */
"use client";

import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSwitchChain } from "wagmi";
// The settling verdict a paid-but-unlanded intent routes to, rather than reopening the widget.
import { ONRAMP_SETTLING_CODE } from "@/features/deposit/components/StandaloneOnRampRail";
import { personalSign } from "@/lib/auth/personalSign";
import { useAuth } from "@/lib/auth/useAuth";
import { reportClientError } from "@/lib/observability/reportClientError";
// PP-INTEGRATION-POINT (POO-1136): the on-ramp request-id server action. A `"use server"` module is
// an RPC stub on the client, so `PP_API_KEY` never enters the bundle (mirrors the Uniswap actions).
import {
  createOnRampRequestAction,
  getOnRampEthTargetAction,
  getOnRampPaymentMethodsAction,
  getOnRampQuoteAction,
} from "@/lib/onramp/onRampActions";
// [R7] The client-persisted record of in-flight purchase intents (PP-CORE-LIB-067). This hook is the
// MINT site the journal was written for: it reads it before minting so an in-flight id is resumed.
import {
  findExpiredOnRampIntent,
  findResumableOnRampRequest,
  retireOnRampRequest,
} from "@/lib/onramp/onRampJournal";
// POO-1573 [R5] (rules v2): the refusal's own code, shared with both hosts from the on-ramp's pure
// client-safe module so the three surfaces cannot drift on the string.
import { ONRAMP_ETH_UNPRICED_CODE } from "@/lib/onramp/schemas";
import { buildOnRampSignatureMessage } from "@/lib/onramp/signatureMessage";
import type { OnRampEthTarget, ProvisioningOrder, ProvisioningPlan } from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning";
import { isMockMode } from "@/lib/services";
import { readErc20Balance, readNativeBalance, readTransactionCount } from "@/lib/tokens/readErc20";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";
import { findWalletForAddress, TransactionError } from "@/lib/tx/sendTransaction";
// PP-INTEGRATION-POINT: the three Uniswap Trading API calls the rail issues, as `"use server"`
// stubs. The key never reaches this module or any bundle it ships in (ADR 0003).
import { buildSwapTx, checkApproval, quoteSwap } from "@/lib/uniswap/actions";
import type { PlanRailCtx, PlanRailDeps } from "../lib/buildPlanSteps";
import { buildPlanSteps, planJournalLegs } from "../lib/buildPlanSteps";
import type { FundingOperationKind } from "../lib/fundingJournal";
import { createDeferredJournalRecorder, createJournal, retireJournal } from "../lib/fundingJournal";
import { pricedQuoteMethodsById } from "../lib/onRampMethodRows";
// POO-1375: the SHIPPED default-method chooser, reused so the mint pre-selects what the picker priced.
import { pickDefaultPaymentMethod } from "./useBuyRouteQuote";
import type { FlowStep } from "./useWalletSignFlow";

/**
 * What the panel's `buildPlanSteps` prop takes.
 *
 * The reporter half is spelled out structurally rather than imported from `ProvisioningPanel`: the
 * panel imports this hook, so importing its type back would close a cycle for two fields.
 */
export type PlanRailBuilder = (
  plan: ProvisioningPlan,
  rail: {
    onLegBroadcast: NonNullable<PlanRailDeps["onLegBroadcast"]>;
    consumeBuffer?: NonNullable<PlanRailDeps["consumeBuffer"]>;
    /** POO-1136: run the fiat purchase (open the widget + settle). Provided by the panel. */
    runOnRampBuy?: NonNullable<PlanRailDeps["runOnRampBuy"]>;
  },
) => FlowStep<PlanRailCtx>[];

/**
 * POO-1384 [R15]: what the user answers when an in-flight purchase intent has aged out unverified.
 *
 * `"resume"` reopens the journaled `requestId`; `"new"` discards it and mints a fresh purchase. The
 * choice is the USER'S because the client cannot know whether money moved: `paidAt` records only what
 * we OBSERVED, and a bank transfer, a 3DS redirect, a dismissal, or a parser drift all move money
 * without us seeing `completed`. See {@link findExpiredOnRampIntent}.
 */
export type ConfirmResumePurchase = (intent: {
  requestId: string;
  /** When the intent was minted, so the prompt can say how long ago in the user's own terms. */
  startedAt: number;
  /**
   * Whether we OBSERVED this purchase being paid. It changes the question, not just the wording:
   * for a paid intent `"resume"` means KEEP WAITING (the settling screen), because reopening the
   * vendor widget on a finished purchase is the production dead end POO-1384 was filed for.
   */
  paid: boolean;
}) => Promise<"resume" | "new">;

/** What the journal records this route as ([R7]). */
export interface ProvisioningRailOperation {
  kind: FundingOperationKind;
  /** The chain the operation itself runs on, which is where every route has to terminate. */
  targetChainId: number;
  strategyId?: string;
}

/** How a host configures the bound rail. */
export interface ProvisioningRailOptions {
  /**
   * The settings gear's Max slippage, percent. Omitted, the rail falls back to the plan's own echoed
   * figure, which is what it was quoted with.
   */
  slippagePct?: number;
  /**
   * The operation this route funds. Absent, no journal is minted and the rail executes exactly as it
   * did before POO-1043, simply with no in-flight record: a host that cannot say what it is funding
   * cannot produce a record anyone could reconcile.
   */
  operation?: ProvisioningRailOperation;
}

/** The bound rail: the step builder, plus the journal's lifecycle. */
export interface ProvisioningRail {
  /** The panel's `buildPlanSteps` prop. `undefined` in mock mode. */
  buildSteps: PlanRailBuilder | undefined;
  /**
   * Mint the recovery journal for `plan` ([R7]). Call it at the CONFIRM, never when the plan is
   * computed. Idempotent-by-replacement: a second call starts a new record and leaves the previous
   * one exactly as it stands, because a transaction already on a chain is not un-broadcast by the
   * user opening a new route.
   */
  openJournal: (plan: ProvisioningPlan) => void;
  /**
   * Bind the rail to an EXISTING journal instead of minting one (POO-1137).
   *
   * A route that is resumed in a later session already has its record: the standalone `/deposit` rail
   * finds a settled-but-unconverted purchase, rebuilds the one leg it has left, and must write to
   * that record rather than open a second one beside it. {@link openJournal} cannot serve this, since
   * it is idempotent-BY-REPLACEMENT by design, and a second record would leave the first one lying
   * around claiming the same conversion is still due.
   */
  adoptJournal: (journalId: string) => void;
  /**
   * Retire the journal: the route completed, so there is nothing in flight to recover. Deliberately
   * NOT called on a failure or at the bridge poll ceiling, where the record is the whole point.
   */
  closeJournal: () => void;
  /**
   * POO-1136: turn a fiat `buy` order into a Paybis `requestId`, minted at EXECUTION time ([R8]).
   *
   * `personal_sign`s {@link buildOnRampSignatureMessage} with the connected wallet, then
   * {@link createOnRampRequestAction} verifies it server-side against the SIWE wallet and returns the
   * id the widget opens with. Deliberately NOT the widget half: opening and settling is the panel's,
   * because a widget has to render. The panel composes the two into `runOnRampBuy`.
   *
   * [R7] It RESUMES before it mints: an `open` journal record for this wallet is an intent whose
   * purchase may still be in flight, and minting beside it is a double charge. See
   * {@link findResumableOnRampRequest}.
   *
   * Returns the wallet alongside the id so the panel can journal the intent under the SAME address
   * this resolved, rather than taking a second, independent read of "the connected wallet".
   */
  mintOnRampRequest: (
    order: ProvisioningOrder,
    options?: MintOnRampOptions,
  ) => Promise<{ requestId: string; wallet: string }>;
}

/**
 * POO-1578: the mint's optional inputs, as ONE object rather than a positional tail.
 *
 * `paymentMethod` is why this exists: the user's choice is made in a component and consumed deep
 * inside {@link resolveWidgetPrefill}, and adding it positionally after an already-optional
 * `confirmResume` would mean callers passing `undefined` to reach it.
 *
 * It deliberately does NOT live on {@link ProvisioningRailOptions}. Those are read at hook-call time,
 * and `StandaloneOnRampRail` holds its options as a MODULE CONSTANT precisely so their identity never
 * moves: a fresh object per render rebuilds the rail, and with it the flow's steps, on every render of
 * a component that runs for minutes. A selection that changes at runtime would do exactly that and
 * reset a running flow.
 */
export interface MintOnRampOptions {
  /**
   * POO-1384 [R15]: asked only when an intent has aged out with no observed payment, where neither
   * resuming nor minting is safe to decide silently. Omitted, this mints, which is the
   * pre-POO-1384 behavior.
   */
  confirmResume?: ConfirmResumePurchase;
  /**
   * POO-1578 S3: the method the USER chose, threaded to the quote and to the mint so the widget opens
   * on their choice instead of the card `pickDefaultPaymentMethod` prefers. Omitted, that chooser still
   * applies as the FALLBACK ([S4]), which is what keeps every surface without a picker working.
   */
  paymentMethod?: string;
  /**
   * POO-1618 [R2]: the fiat the FLOW settled on, so this mint stops resolving one of its own.
   *
   * The step's list and its figures were fetched for a currency the server resolved (or accepted
   * from the buyer) seconds ago, and {@link resolveWidgetPrefill} used to resolve again from
   * scratch on a received-fixed order. Two resolutions can disagree across a cache expiry or a
   * profile write, and the second one is the one that BILLS: the screen prints EUR and the card is
   * charged USD (`CR-CORE-023`). There is no later place to fix it - `POST /v3/request` has no fiat
   * field and the widget opens on `{ requestId }` alone - so the currency reaches checkout only
   * through the `quoteId` this function pins.
   *
   * It is the SERVER's echo, never a raw browser value: POO-1618 [R2]'s validation happens on the
   * methods call that produced it. Omitted, the pre-POO-1618 behaviour is unchanged.
   */
  currencyCodeFrom?: string;
}

/** A rail that does nothing, for mock mode: no wallet, no session, no journal. */
const INERT_RAIL: ProvisioningRail = {
  buildSteps: undefined,
  openJournal: () => {},
  adoptJournal: () => {},
  closeJournal: () => {},
  mintOnRampRequest: async () => {
    throw new Error("On-ramp is unavailable in mock mode");
  },
};

/**
 * POO-1573 [R1]: the ETH figure an `ETH-BASE` order is quoted received-fixed against. THROWS when the
 * price cannot be established ([R5], rules v2).
 *
 * The order carries the RECIPE (`gasFloorEth + fundingUsd / ethUsd`) and not the figure, because a
 * price is perishable and a plan executes for minutes ([R8]'s reasoning about `quoteId`). So it is
 * solved here, at mint time, seconds before the widget opens.
 *
 * ## Why the failure costs the PURCHASE, and no longer the precision (rules v2, Rafael 2026-08-14)
 *
 * Rules v1 said "a failed read costs precision, never the purchase" and fell back to the shipped
 * spend-fixed USD leg. That is not a loss of precision on this screen. With no target the leg is
 * spend-fixed, so `currencyOverride` re-pins `order.fiatCurrency` ("USD"), {@link resolveWidgetPrefill}
 * re-fetches the method list PINNED TO USD, the SEPA identifier the buyer chose on `/deposit` is not in
 * a USD list, `pickDefaultPaymentMethod` falls back to a card, and the widget opens on a card in
 * dollars. That is the live report this whole cluster exists to close, word for word: "I chose bank
 * transfer and was charged on a card in USD", reinstated silently, on the one screen that has just
 * promised the buyer their own method and their own currency.
 *
 * So the mint aborts BEFORE the widget opens and the host returns the buyer to review with a reason.
 * Opening the widget with no prefill at all is not the alternative either (POO-1375: a checkout opening
 * on 0.00 makes buyers hand-type a round number, which discards the SIZING and underfunds the
 * operation). Refusing is the only option that neither bills the wrong money nor underfunds.
 *
 * The report is UNCHANGED and load-bearing: `onramp.eth_target_unavailable` is a STABLE token with a
 * Sentry alert rule pointing at that exact string (`reportClientError` captures to Sentry since
 * POO-1147). Do not rename it, and do not stop emitting it on either branch below.
 */
async function resolveEthTargetAmount(target: OnRampEthTarget): Promise<number> {
  const result = await getOnRampEthTargetAction(target);
  if (!result.ok) {
    reportClientError(
      "onramp.eth_target_unavailable",
      new Error("Could not price the gas-first ETH target; the purchase is refused"),
      {
        code: result.code,
        ...(result.correlationId ? { correlationId: result.correlationId } : {}),
      },
    );
    throw new TransactionError("Could not price ETH for this purchase", {
      code: ONRAMP_ETH_UNPRICED_CODE,
      ...(result.correlationId ? { correlationId: result.correlationId } : {}),
    });
  }
  const amount = Number(result.ethAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    // The same refusal, reported on the same token: an `ok` result carrying a figure that cannot be
    // quoted is contract drift (`toEthAmount` already refuses a zero target), and quoting it would be
    // the one remaining way back to the USD leg.
    reportClientError(
      "onramp.eth_target_unavailable",
      new Error("The gas-first ETH target resolved to a figure that cannot be quoted"),
      { code: "ONRAMP_ETH_AMOUNT_UNUSABLE", ethAmount: result.ethAmount },
    );
    throw new TransactionError("Could not price ETH for this purchase", {
      code: ONRAMP_ETH_UNPRICED_CODE,
    });
  }
  return amount;
}

/** The real rail, bound to the connected wallet, or an inert one in mock mode. */
/**
 * POO-1375: the widget's STARTING POINT, resolved fresh at mint time.
 *
 * Paybis pre-fills the amount and the crypto selection from a `quoteId`, and pre-selects a method
 * from `paymentMethod` (`paybis.service.ts`: "This pre-fills the amount and cryptocurrency selection
 * in widget"). Neither was being sent, so the checkout opened on 0.00 EUR and the user had to retype
 * the figure we had just computed. That is not cosmetic: the order is SIZED so the landed amount covers
 * the operation (the $10 floor, the gas component, and `seedRequiredUsd`'s 5% buffer), and a
 * hand-typed round number discards all three and lands short. POO-1641 removed the 1% fee gross-up
 * that used to sit on top: it covered a Pool Party deduction that does not happen, and the partner
 * cut is already inside the price Paybis quotes. The sizing above is what carries the guarantee.
 *
 * [R8] refused to bake a `quoteId` into the PLAN because a plan executes for minutes and a quote
 * expires. That reasoning stands and is why this runs HERE, at execution time, seconds before the
 * mint, rather than at plan-build time. Nothing expiring is stored.
 *
 * Both values are starting points, NOT locks: the widget still lets the user change the amount,
 * currency and method, which is the intended behaviour.
 *
 * Prefill is a convenience, never a gate. Every failure path returns what it has (possibly nothing)
 * and the mint proceeds exactly as before, because refusing to sell someone crypto over a cosmetic
 * lookup would be a worse bug than the one this fixes.
 *
 * ONE exception, and it is not a prefill failure: the ETH target below ([R5] of POO-1573, rules v2).
 * That value decides the CURRENCY the buyer is charged in, not the figure the checkout opens on, so
 * losing it is not cosmetic; it silently bills a European in dollars on a card. It is resolved before
 * the `try` and its throw propagates, which is why the catch's promise still holds for everything
 * inside it.
 */
async function resolveWidgetPrefill(
  order: ProvisioningOrder,
  /**
   * POO-1578 S2/S4: the user's chosen method. When it is on offer for the resolved currency it is what
   * gets quoted and sent; otherwise, and when nothing was chosen, `pickDefaultPaymentMethod` applies as
   * the fallback it now is rather than the override it was.
   */
  selectedPaymentMethod?: string,
  /**
   * POO-1618 [R2]: the currency the flow already settled, applied to a RECEIVED-fixed order in place
   * of a second resolution. Ignored on the spend-fixed leg, which is [R5]: see `currencyOverride`.
   */
  settledCurrencyCodeFrom?: string,
): Promise<{ quoteId?: string; paymentMethod?: string }> {
  /**
   * POO-1573 [R1]: the ETH leg's received-fixed target, priced NOW.
   *
   * Resolved BEFORE anything else, and OUTSIDE the `try` below, for two different reasons. It decides
   * the currency of BOTH calls below: a target makes this leg received-fixed, and a received-fixed leg
   * lets the server resolve the buyer's own currency. And per [R5] (rules v2) an unpriceable ETH leg
   * REFUSES the purchase, so its throw has to leave this function rather than be swallowed by the
   * catch that keeps every genuinely cosmetic prefill failure from taking the mint down. The price
   * read lives inside the `"use server"` boundary (`ethTarget.ts`) for the same reason the currency
   * resolution does.
   *
   * An order with no recipe at all (a plan built before this shipped, a mock fixture) is `undefined`
   * and keeps the pre-POO-1573 spend-fixed leg, unchanged: there is nothing to refuse over, because
   * nothing promised the buyer their own currency in the first place.
   */
  const ethAmount =
    order.currencyCode === "ETH-BASE" && order.ethTarget
      ? await resolveEthTargetAmount(order.ethTarget)
      : undefined;
  /**
   * POO-1375 / POO-1573: which side the quote FIXES.
   *
   * `USDC-BASE` is received-fixed against `order.fiatAmount` (USDC is ~1:1 with USD, POO-1375).
   * `ETH-BASE` is received-fixed against the ETH target, which is the only way this line is reached
   * for an order carrying one ([R5] v2 refuses the alternative above). Computed up front because
   * POO-1512 [R6] makes it decide the CURRENCY of both calls below, not just the quote's direction.
   */
  const receivedFixed = order.currencyCode === "USDC-BASE" || ethAmount !== undefined;
  /**
   * POO-1512 [R6]: the currency override, or `undefined` to let the action resolve the buyer's own.
   *
   * A RECEIVED-fixed order takes the currency the FLOW settled (POO-1618 [R2]) and otherwise omits
   * it, so the buyer is quoted and offered payment methods in their own currency. Its `amount` is the
   * CRYPTO figure, so the fiat code only selects which methods and rates are priced and cannot
   * corrupt the sum. Passing the settled one is not a new trust: it is the SAME resolution the step
   * already showed the buyer, sent instead of asking the server to answer the same question twice
   * and possibly differently (POO-1621 defect 1).
   *
   * A SPEND-fixed order pins `order.fiatCurrency` ("USD"). Its `amount` IS `order.fiatAmount`, a
   * USD-denominated figure built from USD gas floors and `ethUsd`; resolving it to EUR would charge
   * EUR 208 where 208 was computed as dollars. There is no FX source in the app (POO-333), so the only
   * correct answer for that leg is to leave it alone. Since POO-1573 an ETH order carrying a recipe
   * never reaches it: rules v2 refuses rather than degrading a promised currency back to dollars.
   */
  const currencyOverride = receivedFixed ? settledCurrencyCodeFrom : order.fiatCurrency;

  try {
    const methods = await getOnRampPaymentMethodsAction({
      currencyCodeTo: order.currencyCode,
      ...(currencyOverride === undefined ? {} : { currencyCodeFrom: currencyOverride }),
    });
    // Paybis requires a payment method to quote at all, so no methods means no prefill.
    if (!methods.ok || methods.methods.length === 0) return {};
    /**
     * POO-1512: ONE currency resolution per flow. The methods call above resolved (or was pinned to)
     * a fiat currency, and the quote below must be priced in that SAME currency: methods and quote
     * are separate server-action invocations, so a cache expiry or a profile write between them can
     * make a second resolution answer differently, listing methods in EUR and quoting in USD, which
     * sends a SEPA-only method into a USD quote. The action echoes the currency it actually used
     * (`currencyCodeFrom`), so the quote pins it explicitly instead of resolving again.
     */
    const flowCurrency = currencyOverride ?? methods.currencyCodeFrom;
    /**
     * POO-1578 S2/S4: the user's choice first, the shipped chooser as the fallback.
     *
     * `pickDefaultPaymentMethod` prefers a card, which is what the funding picker priced and labelled,
     * and that remains right when nobody has chosen: two sites picking differently would show one
     * figure and open on another. What changes is precedence. A selection the pair does not offer
     * falls back rather than dead-ending, because the list is fetched per resolved currency
     * (POO-1512), so a currency change can legitimately retire the method the user picked.
     */
    const chosen =
      selectedPaymentMethod === undefined
        ? undefined
        : methods.methods.find((entry) => entry.paymentMethod === selectedPaymentMethod);
    const method = chosen ?? pickDefaultPaymentMethod(methods.methods);
    if (!method) return {};
    /**
     * POO-1578 [R2 posture]: a DROPPED choice is reported, exactly like the two divergences below.
     *
     * The fallback is correct and stays; what is not acceptable is that it is invisible. The user
     * asked for SEPA and the widget opens on a card, and nothing anywhere records that we substituted
     * on a money path. `onramp.quote_unpriced` and `onramp.quote_method_substituted` are reported for
     * precisely this reason, and this is the same class of event one step earlier: the method the
     * PICKER offered seconds ago is no longer in the list the mint just fetched.
     *
     * That is a real upstream/timing signal, not a user error: the list is per resolved currency
     * (POO-1512), so a profile write or a cache expiry between the picker's fetch and this one can
     * retire the method legitimately. It is also the shape POO-1513 lost the selection in, which is
     * the reason it needs to be observable rather than inferred from a support ticket.
     */
    if (selectedPaymentMethod !== undefined && !chosen) {
      reportClientError(
        "onramp.selection_unavailable",
        new Error("The buyer's chosen payment method is not on offer for the resolved currency"),
        {
          selectedPaymentMethod,
          fellBackTo: method.paymentMethod,
          // The flow's ONE resolution (POO-1512), which is what decided the list this missed against.
          currencyCodeFrom: flowCurrency,
          currencyCodeTo: order.currencyCode,
        },
      );
    }
    const paymentMethod = method.paymentMethod;

    // POO-1573 [R2]: the CRYPTO figure on the ETH leg, the USD one on every recipe-less order. A
    // figure computed in dollars is never sent as another currency's amount; what changes is the unit.
    const amount = ethAmount ?? Number(order.fiatAmount);
    if (!Number.isFinite(amount) || amount <= 0) return { paymentMethod };

    // POO-1375: RECEIVED-fixed, matching the funding picker, so the widget opens on what must LAND.
    //
    // Spend-fixed pins the fiat and lets Paybis decide the output, so the delivered amount moves with
    // every fee difference: another payment method, another fiat currency, a rate change. The
    // spend-fixed figure is computed against ONE method's rate, so a user switching to Apple Pay (observed
    // 6.19% against a card rate) lands short and the operation underfunds. Received-fixed pins the
    // OUTPUT and lets Paybis solve for the fiat per method and per currency, so a BRL, EUR or USD
    // buyer all receive the same USDC. Fee variance becomes the provider's problem instead of a
    // number we have to predict correctly.
    //
    // POO-1573: BOTH legs now. A gas-first plan buys ETH-BASE against the ETH target its order
    // carries ([R1]), so the same property holds for it: the OUTPUT is pinned and Paybis solves the
    // fiat, which is what lets a European be charged in euros. Only an order carrying NO recipe keeps
    // the old spend-fixed shape; an unpriceable one refuses ([R5] v2). (`receivedFixed` is computed at
    // the top of this function, because POO-1512 [R6] makes it decide `currencyOverride` too.)
    const quote = await getOnRampQuoteAction({
      currencyCodeTo: order.currencyCode,
      // Always explicit (POO-1512): the currency the METHODS call used, so the flow cannot straddle
      // two resolutions. See `flowCurrency` above.
      currencyCodeFrom: flowCurrency,
      amount,
      paymentMethod,
      ...(receivedFixed ? { direction: "receive" as const } : {}),
    });
    if (!quote.ok) {
      /**
       * POO-1573 [R5]: the LAST silent degrade on this path, and the one the deploy order rides on.
       *
       * Every other failure here is reported (`onramp.quote_unpriced`,
       * `onramp.quote_method_substituted`, `onramp.selection_unavailable`); a REFUSED quote was not,
       * and it is the shape of the pool-party-api dependency this change carries. POO-1588
       * (`33abc64`) made the quote's amount floor direction-aware; before it, the flat `0.01` was
       * applied to the receive direction too, where the amount is the CRYPTO figure. So an API
       * without it 400s every gas-first quote from our own $10 floor up to `0.01 x ethUsd` (~$25 at
       * $2,500/ETH), which is exactly where a `/deposit` amount and a provisioning shortfall sit.
       *
       * The symptom is not an error the buyer sees: the widget opens with no pre-filled amount, they
       * hand-type a round number, POO-1375's sizing is lost and the operation underfunds. Silent
       * underfunding is the failure class this whole flow is built to avoid, so the degrade is loud
       * even though it is survivable.
       */
      reportClientError(
        "onramp.quote_unavailable",
        new Error("The on-ramp quote was refused; the widget opens with no pre-filled amount"),
        {
          code: quote.code,
          ...(quote.correlationId ? { correlationId: quote.correlationId } : {}),
          paymentMethod,
          currencyCodeTo: order.currencyCode,
          // The flow's ONE resolution (POO-1512), which is the currency the quote was priced in.
          currencyCodeFrom: flowCurrency,
          // On a received-fixed leg this is the CRYPTO figure, which is why `direction` rides beside
          // it: reading it as a fiat number would misdiagnose the report.
          requestedAmount: amount,
          direction: receivedFixed ? "receive" : "spend",
        },
      );
      return { paymentMethod };
    }

    // POO-1374 (folded in): the method's own fiat MINIMUM still applies, and pinning the output does
    // not change that. Report it rather than letting Paybis reject the order at checkout with a
    // generic provider error and no number the user can act on.
    // The quote's per-method entry keys on `id`, which carries the same value the methods list calls
    // `paymentMethod` (both "poolparty-credit-card"). Two names, one identifier.
    //
    // POO-1413: that equality is no longer asserted from reading, it is CAPTURED. A live
    // `POST /v2/quote` against the dev-configured Paybis on 2026-08-07 answered
    // `paymentMethods: [{ id: "poolparty-credit-card", name: "Credit/Debit Card", ... }]` for
    // `paymentMethod: "poolparty-credit-card"`. It matters because if the two namespaces ever
    // diverged, the `find` below would miss on EVERY purchase and silently disable POO-1375's
    // prefill flow-wide, which is a far worse failure than the one this guard fixes.
    /**
     * POO-1413 [R1]: a quote that priced NOTHING for our method must not become a prefill.
     *
     * `paymentMethods` is an array with no minimum, so a quote Paybis priced nothing for parses as
     * perfectly valid. Passing its `quoteId` to the mint is what produced the production 500 on
     * 2026-08-07 (trace `8f2a7d4f0759431681fd797970d7eabf`): Paybis answered 422 "There are no
     * available payment/payout methods in Quote" on `property_path: quoteId`, and the user was shown
     * "Internal server error" twice.
     *
     * Every other failure path in this function already degrades to `{ paymentMethod }`, and the
     * header already says "Prefill is a convenience, never a gate". An unpriced quote is a failed
     * prefill; it was the one case that did not follow the function's own rule.
     */
    // [R9] POO-1666: ask the SHARED predicate, not `paymentMethods` directly. Paybis returns the same
    // method as priced AND refused in one response, so a raw `.find` here saw an ordinary priced
    // method and handed its `quoteId` to a mint that Paybis then rejected with "There are no
    // available payment/payout methods in Quote". The rows have consulted `paymentMethodErrors`
    // since POO-1599; this is the mint catching up to them.
    const offered = pricedQuoteMethodsById(quote.quote);
    const requested = offered.get(paymentMethod.trim());
    /**
     * [R3] When the quote priced SOMETHING, just not our method, follow the quote rather than the
     * request. Rafael's call, 2026-08-07, and it is the only option that keeps the sizing guarantee:
     * the alternative (keep our method, drop the `quoteId`) opens the widget with an empty amount, so
     * the user hand-types the round number this function's own header warns about at [R]"a hand-typed
     * round number lands short". Losing the sizing is a funding defect; opening on a method the user
     * can change in the widget is a cosmetic one.
     */
    const priced = requested ?? offered.values().next().value;
    if (!priced) {
      // [R2] Loud, because "the provider offered this method seconds ago and then priced nothing for
      // it" is a real upstream signal, and today it was silent right up until the mint failed.
      reportClientError(
        "onramp.quote_unpriced",
        new Error(
          quote.quote.paymentMethods.length > 0
            ? "Paybis priced methods and then refused every one of them"
            : "Paybis returned a quote with no pricing for any method",
        ),
        {
          paymentMethod,
          currencyCodeTo: order.currencyCode,
          // POO-1512: the quote's ECHOED currency, never `order.fiatCurrency`. On a received-fixed
          // leg the request omits the fiat and the server resolves the buyer's own, so reporting the
          // order's constant "USD" is false and sends on-call replaying in the wrong currency,
          // watching it price fine, and closing the incident unreproducible.
          currencyCodeFrom: quote.quote.currencyCodeFrom,
          // `requestedAmount`, not `amount`: on a received-fixed order this is the CRYPTO figure, so
          // reading it beside `currencyCodeFrom` as a fiat number would misdiagnose the report.
          // `direction` says which side it fixes, exactly as the quote query does.
          requestedAmount: amount,
          direction: receivedFixed ? "receive" : "spend",
          /**
           * [R9] The two shapes are NOT the same incident, and reporting both as "nothing was
           * priced" is what made POO-1666 need a manual production capture to diagnose. Paybis
           * returned ONE method here, with a real EUR 10.53 charge, and refused it in the same
           * response. On-call reading `methodCount: 0` reproduces the wrong thing.
           */
          methodCount: quote.quote.paymentMethods.length,
          refusedCount: (quote.quote.paymentMethodErrors ?? []).length,
          /**
           * The vendor's own refusal text, which is the only datum that says WHEN our floor stops
           * being enough ("You have to buy or sell at least 10.003001 USDC per order"). Parsed since
           * POO-1599 and thrown away after a boolean. This is Sentry, not analytics, so the
           * no-raw-vendor-text rule does not apply, and POO-1603's prohibition is on BRANCHING, not
           * on reporting.
           */
          refusals: (quote.quote.paymentMethodErrors ?? [])
            .map((entry) => `${entry.paymentMethod}: ${entry.message ?? "(no message)"}`)
            .slice(0, 12),
        },
      );
      // [R4] The purchase still opens, without a pre-filled amount. Worse UX than a prefill, far
      // better than a 500. This is the shape from the production incident: NOTHING was priced, so
      // there is no substitute to fall back to.
      return { paymentMethod };
    }

    if (!requested) {
      // [R2] Still reported. A substitution keeps the purchase whole, but "we asked for the method
      // Paybis had just offered and it answered about a different one" is exactly the upstream
      // behaviour we want to be able to show them.
      reportClientError(
        "onramp.quote_method_substituted",
        new Error("Paybis priced a different method than the one requested"),
        {
          paymentMethod,
          substitutedTo: priced.id,
          currencyCodeTo: order.currencyCode,
          // POO-1512: the quote's echoed currency, for the same reason as `onramp.quote_unpriced`
          // above: `order.fiatCurrency` is a constant "USD" the received-fixed request never sent.
          currencyCodeFrom: quote.quote.currencyCodeFrom,
          requestedAmount: amount,
          direction: receivedFixed ? "receive" : "spend",
          methodCount: quote.quote.paymentMethods.length,
        },
      );
    }

    /**
     * The minimum belongs to the method we are actually OPENING on, which after a substitution is not
     * the one `pickDefaultPaymentMethod` chose. Re-look it up rather than comparing the substitute's
     * charge against our original method's floor, which would report a false breach (or hide a real
     * one) on exactly the path that is already going wrong.
     *
     * `chargeUsd` is non-optional on the normalized method (`schemas.ts`), and the only way it could
     * have been undefined was the missing-entry case the guard above returns on, so the old
     * `charge !== undefined` test here is dead.
     */
    const openingMethod =
      methods.methods.find((entry) => entry.paymentMethod === priced.id) ?? method;
    const charge = priced.chargeUsd;
    if (openingMethod.minUsd > 0 && charge < openingMethod.minUsd) {
      reportClientError(
        "onramp.below_method_minimum",
        new Error("Order is below the selected payment method minimum"),
        {
          paymentMethod: openingMethod.paymentMethod,
          chargeUsd: charge,
          minUsd: openingMethod.minUsd,
        },
      );
    }

    return { quoteId: quote.quote.quoteId, paymentMethod: priced.id };
  } catch {
    // Never let a prefill lookup take down the purchase.
    return {};
  }
}

export function useProvisioningRail(options: ProvisioningRailOptions = {}): ProvisioningRail {
  const { slippagePct, operation } = options;

  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo(() => INERT_RAIL, []);
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { wallets } = useWallets();
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { signTypedData } = useSignTypedData();
  // The CONNECTOR-level switch. This app builds its wagmi config with `@privy-io/wagmi`, and
  // `EmbeddedWalletActivator` (POO-1003) makes the embedded wallet the active wagmi account, so the
  // provider `getEthereumProvider()` hands back is bound to Privy's connector. `wallet.switchChain`
  // moves the Privy wallet OBJECT and does not necessarily move that connector, which is why the
  // SDK call returned cleanly and the provider kept reporting the old chain (POO-1079).
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { switchChainAsync } = useSwitchChain();
  /**
   * The CURRENT wallets, read at execution time rather than captured when the steps were built.
   *
   * `buildSteps` runs when the plan resolves; its steps then execute for MINUTES afterwards, across
   * re-renders and at least one chain switch. Privy hands out a new `ConnectedWallet` array whenever
   * that state moves, so a step closure holding the build-time object is holding a detached handle.
   *
   * On an EXTERNAL wallet that is harmless: `getEthereumProvider()` returns the live injected
   * provider, which reports the real chain whoever asks. An EMBEDDED wallet carries its own chain
   * state, so the stale object keeps handing back a provider pinned to the chain it was built on,
   * and no switch of any kind can move it (POO-1080). `useInvest` never hit this because it resolves
   * its wallet INSIDE the run, which is what this restores.
   */
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const walletsRef = useRef(wallets);
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);
  // POO-892 [R5]: the ACTIVE address drives the wallet lookup — `wallets[0]` can be the stale handle
  // after a wallet switch, and a plan priced for one wallet must never be signed by another.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { address: activeAddress } = useAuth();

  // [R7] The journal the rail is currently writing to, or null while the user has approved nothing.
  // A ref rather than state on purpose: the steps read it mid-execution, and a re-render between the
  // confirm and a leg's broadcast must not be able to hand that leg a different journal.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const journalIdRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const openJournal = useCallback(
    (plan: ProvisioningPlan) => {
      const legs = planJournalLegs(plan);
      // A plan with no executable legs (mock mode's fixture) has nothing to put on a chain, and a
      // journal with no legs is never retired by the store's own all-terminal rule.
      if (!operation || !activeAddress || legs.length === 0) return;
      journalIdRef.current = createJournal({
        wallet: activeAddress,
        operation,
        legs,
      }).journalId;
    },
    [operation, activeAddress],
  );
  // POO-1137: bind to a record that already exists (a resumed route), so its legs keep accruing on
  // the same journal the earlier session opened.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const adoptJournal = useCallback((journalId: string) => {
    journalIdRef.current = journalId;
  }, []);
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const closeJournal = useCallback(() => {
    const journalId = journalIdRef.current;
    if (journalId === null) return;
    journalIdRef.current = null;
    retireJournal(journalId);
  }, []);

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const buildSteps = useCallback<PlanRailBuilder>(
    (plan, reporters) => {
      const wallet = findWalletForAddress(wallets, activeAddress);
      if (!wallet || !activeAddress) {
        // A plan with no wallet has nothing to sign it. Failing at the first step, legibly, beats
        // rendering a plan whose CTA cannot do anything.
        return [
          {
            key: "wallet",
            run: async () => {
              throw new TransactionError("Wallet not connected");
            },
          },
        ];
      }
      const owner = activeAddress as `0x${string}`;

      /**
       * The provider for the chain we are CURRENTLY on, fetched once per switch and reused.
       *
       * `useInvest` switches, then takes a provider, then broadcasts with THAT object, and it works
       * on an embedded wallet. The rail instead called `getEthereumProvider()` fresh on every single
       * request, including the `eth_chainId` read inside the broadcast assertion. An embedded
       * wallet's provider is initialised from the wallet's configured chain, so each fresh fetch
       * answered with the app default (`NEXT_PUBLIC_CHAIN_ID`, Polygon at the time; Arbitrum since POO-1385) no matter which
       * switch had just succeeded. That is why the same 137 -> 8453 switch works for a direct invest
       * and never worked here (POO-1081).
       *
       * Held per built-steps run, refreshed by `switchChain`, so the rail broadcasts through the
       * same handle the switch produced.
       */
      let current: Eip1193Provider | null = null;
      const liveWallet = () => findWalletForAddress(walletsRef.current, activeAddress) ?? wallet;
      const providerForNow = async (): Promise<Eip1193Provider> => {
        if (!current) current = await liveWallet().getEthereumProvider();
        return current;
      };

      const deps: PlanRailDeps = {
        owner,
        // Resolved per broadcast rather than held: `getEthereumProvider` is the wallet's own handle
        // and the choke point (`executeBuiltTransaction`) is what asserts the chain on it.
        provider: {
          request: async (args) => (await providerForNow()).request(args),
        },
        // Privy's own API, not the provider's `wallet_switchEthereumChain`. An EMBEDDED wallet
        // ignores the raw RPC and keeps reporting its old chain, which surfaced as WRONG_CHAIN
        // ("stayed on chain 137") mid-route. Every other operation here already switches this way.
        switchChain: async (chainId) => {
          // wagmi FIRST, because the connector is what the provider follows. Only if that path is
          // unavailable do we fall back to the wallet SDK, which is the right lever for a wallet
          // that is not driving the connector. Never both: on an external wallet each one prompts,
          // and asking twice for one switch is its own bug.
          // Whichever lever moves it, the cached provider belongs to the OLD chain now.
          current = null;
          try {
            await switchChainAsync({ chainId });
            return;
          } catch {
            // Falling back to the wallet SDK is an ordinary outcome for a wallet that does not drive
            // the connector, not an incident, so it is not logged.
          }
          // Same rule: the SDK fallback has to act on the LIVE handle, not the captured one.
          await liveWallet().switchChain(chainId);
        },
        signTypedData: async (data) => {
          const { signature } = await signTypedData(data as Parameters<typeof signTypedData>[0], {
            address: owner,
          });
          return signature;
        },
        // Base units as a decimal string, which is what the rail compares with BigInt. The native
        // coin is addressed as `0x0…0` by the Trading API and by the planner, so it routes to the
        // chain's balance rather than to an ERC-20 read that would revert.
        readTokenBalance: async ({ chainId, token, owner: holder }) => {
          const address = holder as `0x${string}`;
          const raw =
            token.toLowerCase() === NATIVE_TOKEN_ADDRESS
              ? await readNativeBalance(address, chainId)
              : await readErc20Balance(token as `0x${string}`, address, chainId);
          return raw.toString();
        },
        quoteSwap,
        checkApproval,
        buildSwapTx,
        ...(slippagePct === undefined ? {} : { slippagePct }),
        // [R7] The durable record. PP-INTEGRATION-POINT: `readNonce` is a real
        // `eth_getTransactionCount(latest)` on the LEG's chain, which is why it is a per-chain public
        // client and not the wallet provider (a route spans chains, a provider answers for one).
        journal: createDeferredJournalRecorder(() => journalIdRef.current, {
          readNonce: ({ chainId }) => readTransactionCount(owner, chainId),
        }),
        onLegBroadcast: reporters.onLegBroadcast,
        // POO-1508 [R43]: somebody accounting for the run's shared price-move buffer before a
        // materially worse price is signed. Without it the rail refuses, which is safe and unhelpful.
        ...(reporters.consumeBuffer ? { consumeBuffer: reporters.consumeBuffer } : {}),
        // POO-1136: the fiat purchase runner. Without it a `buy` step refuses legibly.
        ...(reporters.runOnRampBuy ? { runOnRampBuy: reporters.runOnRampBuy } : {}),
      };

      return buildPlanSteps(plan, deps);
    },
    [wallets, activeAddress, signTypedData, slippagePct, switchChainAsync],
  );

  // POO-1136 [R8]: mint the on-ramp `requestId` at execution time. Sign with the LIVE wallet handle
  // (the same reason `buildSteps` resolves it per run): a plan executes for minutes after it is built.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const mintOnRampRequest = useCallback(
    async (
      order: ProvisioningOrder,
      // Named `mintOptions`, not `options`: the hook's own `ProvisioningRailOptions` parameter is
      // called `options` and is in scope for all ~100 lines of this money path. Two different bags
      // of settings under one name is the kind of shadowing that reads fine and picks the wrong one.
      mintOptions?: MintOnRampOptions,
    ): Promise<{ requestId: string; wallet: string }> => {
      const {
        confirmResume,
        paymentMethod: selectedPaymentMethod,
        currencyCodeFrom: settledCurrencyCodeFrom,
      } = mintOptions ?? {};
      const wallet = findWalletForAddress(walletsRef.current, activeAddress);
      if (!wallet || !activeAddress) throw new TransactionError("Wallet not connected");

      /**
       * [R7] "one purchase per step, ever." RESUME before minting.
       *
       * A `requestId` is a purchase INTENT. The window this closes is the paid-but-not-landed one: the
       * tab dies after the card is charged and before the delta appears, the user reopens the op, the
       * plan is re-derived, and this runs again. Minting there opens a SECOND Paybis intent while the
       * first purchase's funds are still moving, which is the double charge PP-CORE-LIB-067 was built
       * to prevent. Only an `open` record for THIS wallet is returned, so a settled / rejected /
       * cancelled / errored intent is never resumed and a fresh purchase mints normally.
       *
       * It also short-circuits the `personal_sign`, which is the right order twice over: re-signing to
       * re-derive an id we already hold is a wallet prompt that buys the user nothing.
       */
      const resumable = findResumableOnRampRequest(activeAddress);

      /**
       * POO-1384 [R16]: a PAID intent must never reopen the widget.
       *
       * Reported from production: "every time he opens any on-ramp modal it resumes in that
       * transaction-complete screen and he can't go anywhere". That is this exact loop. The purchase
       * finished at Paybis, our settlement never saw the delta, the record stayed `open`, and every
       * subsequent mint reopened the same `requestId` onto the vendor's own completed screen, which
       * has nothing left to do. Resuming a FINISHED purchase is not a resume; it is a wall.
       *
       * The money did move, though, so silently minting beside it is the double charge. The honest
       * answer is the settling screen we already have ("your purchase is still landing", no retry
       * offered), plus an explicit discard for the user who knows it is never arriving.
       */
      if (resumable?.paidAt !== undefined && confirmResume) {
        const choice = await confirmResume({
          requestId: resumable.requestId,
          startedAt: resumable.createdAt,
          paid: true,
        });
        if (choice === "resume")
          throw new TransactionError("Your purchase is still settling", {
            code: ONRAMP_SETTLING_CODE,
          });
        retireOnRampRequest(resumable.requestId);
      } else if (resumable) {
        // Unpaid and still fresh: the ordinary reload-mid-checkout case. Reopening the form the user
        // was already filling in is right, and asking would be noise.
        return { requestId: resumable.requestId, wallet: activeAddress };
      }

      /**
       * POO-1384 [R15]: an intent we can neither auto-resume nor safely replace. ASK.
       *
       * Past the resumable window with no `paidAt`, the honest state is "we do not know whether money
       * moved" (see {@link findExpiredOnRampIntent} for the six ways that happens). Both silent
       * branches are wrong in that state: resuming reopens a `requestId` Paybis may have expired,
       * which is the "Session timed out" dead end; minting may open a SECOND purchase beside funds
       * that are still landing, which is the double charge this journal exists to prevent. Only the
       * user knows whether they paid, so only the user can answer.
       *
       * Absent a `confirmResume` (a host that has not been threaded, or a caller with no UI) this
       * falls through to minting, which is exactly the pre-POO-1384 behavior.
       */
      const expired = findExpiredOnRampIntent(activeAddress);
      if (expired && confirmResume) {
        const choice = await confirmResume({
          requestId: expired.requestId,
          startedAt: expired.createdAt,
          paid: false,
        });
        if (choice === "resume") return { requestId: expired.requestId, wallet: activeAddress };
        // "Start a new one" is a deliberate discard: retire the old intent so this decision is taken
        // ONCE, rather than re-prompting on every retry for a purchase the user already disowned.
        retireOnRampRequest(expired.requestId);
      }

      const message = buildOnRampSignatureMessage(activeAddress);
      // PP-INTEGRATION-POINT: Privy embedded / external wallet `personal_sign` (same shape as every
      // other per-write signature in this app, e.g. `useManagerProfileWrite`).
      // POO-1407: through `personalSign`, which hex-encodes. This is a money path, and the raw string
      // it used to send is what made Ledger Live sign the EMPTY message.
      const signature = await personalSign(
        await wallet.getEthereumProvider(),
        message,
        activeAddress,
      );
      // POO-1375: resolved HERE rather than in the plan, so nothing expiring is stored ([R8]) and the
      // widget still opens on the amount we sized instead of 0.00.
      // POO-1573 [R5] (rules v2): this can now THROW, and only for one cause, an `ETH-BASE` order
      // whose target could not be priced. The mint aborts before `createOnRampRequestAction`, so no
      // purchase intent exists and no widget opens; the host returns the buyer to review with a
      // reason. See {@link ONRAMP_ETH_UNPRICED_CODE}.
      const prefill = await resolveWidgetPrefill(
        order,
        selectedPaymentMethod,
        settledCurrencyCodeFrom,
      );
      const result = await createOnRampRequestAction({
        signature,
        message,
        currencyCode: order.currencyCode,
        ...(prefill.quoteId === undefined ? {} : { quoteId: prefill.quoteId }),
        ...(prefill.paymentMethod === undefined ? {} : { paymentMethod: prefill.paymentMethod }),
      });
      if (!result.ok)
        throw new TransactionError(result.message, {
          code: result.code,
          correlationId: result.correlationId,
        });
      // Journaled by the WIDGET FRAME, not here: the record has to exist before the widget opens and
      // the frame is what opens it, so recording at the mint would file an intent for a purchase the
      // user may never be shown (`useOnRampSettlement.open`).
      return { requestId: result.requestId, wallet: activeAddress };
    },
    [activeAddress],
  );

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  return useMemo(
    () => ({ buildSteps, openJournal, adoptJournal, closeJournal, mintOnRampRequest }),
    [buildSteps, openJournal, adoptJournal, closeJournal, mintOnRampRequest],
  );
}
