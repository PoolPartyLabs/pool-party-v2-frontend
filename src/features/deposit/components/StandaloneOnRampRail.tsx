/**
 * @id PP-DEP-CMP-004 (POO-1390)
 * @name StandaloneOnRampRail
 * @implements-rules-version v6 (POO-1642 rules v1) · v5 (POO-1513 rules v1) · v4 (POO-1390 rules v1) · v3 (POO-1129 rules v3)
 * @epic POO-1129 (fiat on-ramp), phase 6 (POO-1137)
 *
 * The `/deposit` standalone fiat rail: it runs the bespoke standalone purchase ([R3]) end to end and
 * reports one terminal outcome to {@link DepositScreen}. Real-mode only: {@link DepositScreen} mounts
 * it behind `!isMockMode && isFeatureEnabled("fiatOnRamp")`, and it is inert without a real wallet
 * (`useProvisioningRail` returns the INERT rail in mock mode, so `buildSteps` is `undefined` and no
 * flow runs).
 *
 * ## It reuses the in-flow rail, it does not fork it
 *
 * The purchase and the ETH->USDC swap execute through the SAME machinery POO-1136 wired for the
 * provisioning panel, so slippage, approval (native ETH needs none), re-quote-at-execution and the
 * delta-scoped settlement are inherited, never re-implemented:
 *
 *   - {@link buildStandaloneOnRampPlan} sizes the order with `sizeOnRampOrder({ standalone: true })`
 *     ([R1] standalone trigger, never the classifier) and shapes a buy (+ swap) plan with no bridge.
 *   - {@link useProvisioningRail} binds the shipped rail to the connected wallet: `buildSteps` expands
 *     the plan through `buildPlanSteps`, and `mintOnRampRequest` mints the `requestId` at execution
 *     time ([R8]) RESUMING a journaled in-flight one first ([R7], `findResumableOnRampRequest`).
 *   - {@link runOnRampBuy} composes the mint with {@link PaybisWidgetFrame}, exactly as
 *     `ProvisioningPanel` does: mint, then render the widget, then resolve the buy step from the
 *     observed balance delta ([R4]/[R11], scoped to the token the order bought).
 *   - {@link useWalletSignFlow} runs the ordered steps; a terminal Paybis state throws, and a reconcile
 *     timeout throws {@link ONRAMP_SETTLING_CODE}, routed to the host's settling screen (money in
 *     flight, never a failure — POO-1037 precedent).
 *
 * ## The settled-but-unconverted window, and why the rail owns both halves of it
 *
 * A gas-first purchase settles as ETH on Base and still has one leg to go. A failure AFTER that point
 * (the ordinary ones: the user rejects the swap signature, the chain switch fails, the quote fails) is
 * a completely different event from a failure before it, and conflating them is a double charge:
 *
 *   - it moved money, so the host's "no money was moved" copy would be false;
 *   - the fix is to RESUME the failed step, never to start over. Starting over re-enters this
 *     component, and the fresh balance snapshot now CLEARS `PAYBIS_GAS_FLOOR_ETH`, so the retry plan
 *     is a USDC-direct purchase: a second card charge, with the first purchase's ETH stranded.
 *
 * So the rail stays mounted through the error phase and hands the host a
 * {@link StandaloneOnRampFailure} carrying both a `settled` discriminator and `flow.retry()` itself,
 * which resumes from the failed step and re-runs nothing that already succeeded. That is the same
 * contract every other `useWalletSignFlow` host honours (`ProvisioningPanel.tsx:1087`). Only a
 * PRE-settlement failure may go back to review and mint again.
 *
 * Try again is one of two doors, and closing it alone would be theatre: a tab killed between the
 * settled buy and the completed swap reaches the identical double charge with no click at all. So the
 * conversion is JOURNALED, under the `deposit` operation kind, from the moment the purchase settles
 * ({@link settledSwapBaseUnits} + `openJournal`) until it lands (`closeJournal`). A later mount finds
 * it ({@link findStandaloneSwapResume}) and runs the conversion ALONE, with no `buy` step in the plan
 * and therefore no mint, and the shipped POO-1038/1043 leg recovery applies to it exactly as it does
 * to an in-flow route.
 *
 * The balance snapshot the plan's [R1] trigger reads is taken THROUGH {@link useTokenBalances}
 * (SIWE-gated), never a raw holdings read, and is captured ONCE: `useTokenBalances` re-reads on the
 * settlement publish, and rebuilding the plan mid-flight would reset the running flow.
 *
 * PP-INTEGRATION-POINT: the whole real rail (widget SDK, on-ramp server actions, Uniswap swap) runs
 * behind this component. Every underlying call is a seam already marked in `useProvisioningRail` /
 * `PaybisWidgetFrame` / `useOnRampSettlement`; this component adds no new upstream call of its own.
 */
"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { useTokenBalances } from "@/lib/balances/useTokenBalances";
import type { TokenDelta } from "@/lib/onramp/tokenDeltas";
import type { ProvisioningPlan } from "@/lib/provisioning";
import { ONRAMP_CHAIN_ID } from "@/lib/provisioning/computeNeed";
import type { TxError } from "@/lib/tx/diagnostics";
import { TransactionError } from "@/lib/tx/sendTransaction";
import {
  PaybisWidgetFrame,
  type PaybisWidgetTerminalStatus,
} from "../../strategies/components/provisioning/PaybisWidgetFrame";
import {
  type ConfirmResumePurchase,
  type ProvisioningRailOptions,
  useProvisioningRail,
} from "../../strategies/hooks/useProvisioningRail";
import { type FlowStep, useWalletSignFlow } from "../../strategies/hooks/useWalletSignFlow";
import { fiatSwapFractionBps, type OnRampBuyRequest } from "../../strategies/lib/buildPlanSteps";
import {
  buildStandaloneOnRampPlan,
  buildStandaloneSwapPlan,
  findStandaloneSwapResume,
  readBaseNativeEth,
  STANDALONE_DEPOSIT_OPERATION,
  settledSwapBaseUnits,
} from "../lib/standaloneOnRampPlan";

/**
 * The reconcile timed out with the purchase paid but not yet on-chain. Not a failure: the money may
 * still be landing, so the host routes it to a settling screen (POO-1037 / POO-1136 precedent). Its own
 * code so the settling copy can speak about a fiat purchase. Mirrors `ProvisioningPanel`'s constant.
 */
export const ONRAMP_SETTLING_CODE = "ONRAMP_SETTLING";

/**
 * How the standalone purchase records itself in the funding recovery journal.
 *
 * A module constant rather than an inline literal so its identity is stable: `useProvisioningRail`
 * memoises `openJournal` on the operation, and a fresh object per render would rebuild the rail (and
 * with it the flow's steps) on every single render of a component that runs for minutes.
 */
const RAIL_OPTIONS: ProvisioningRailOptions = {
  operation: { kind: STANDALONE_DEPOSIT_OPERATION, targetChainId: ONRAMP_CHAIN_ID },
};

/** Accumulating flow context is unused here (each step settles independently); kept generic. */
type RailCtx = Record<string, unknown>;

/**
 * Map a terminal Paybis widget state to the throw the buy step propagates (mirrors the panel).
 *
 * POO-1390 [R3]: `reason` is the vendor's own explanation when it sent one, and it replaces the
 * generic sentence because that sentence was ours rather than theirs. See the panel's copy of this
 * function for the incident that motivated it. Absent a reason the generic copy stands ([R5]).
 */
function onRampTerminalError(
  status: PaybisWidgetTerminalStatus,
  reason?: string,
): TransactionError {
  if (status === "timed-out") {
    return new TransactionError("The purchase was paid but has not landed on-chain yet", {
      code: ONRAMP_SETTLING_CODE,
    });
  }
  // rejected / cancelled / error / closed / unavailable: the purchase did not complete, so nothing
  // moved. `closed` (the user shut the checkout without paying) is terminal here because the hook only
  // reaches it before `completed` ([R12]); Try again re-runs the buy, reusing the journaled requestId.
  return new TransactionError(reason ?? "The purchase did not complete", {
    code: `ONRAMP_${status.toUpperCase()}`,
  });
}

/**
 * What the purchase ACTUALLY delivered, for the host's receipt and its `deposit_completed` event.
 *
 * [R4] the observed delta is the authority and the estimate is not: the user can change the amount
 * (and the payment method, which carries its own fees) inside the Paybis widget, so a receipt built
 * from `computeDepositQuote` can be a figure the user never paid and never received.
 *
 * The card charge itself is NOT observable from the app, so neither field claims to be it. What is
 * reported is what landed on-chain and what the deposit leaves the user holding.
 */
export interface StandaloneOnRampSettlement {
  /** The raw per-token delta the widget reconciled ([R4]), scoped to the token the order bought. */
  deltas: TokenDelta[];
  /** USD the purchase delivered on-chain, summed over the delta. */
  settledUsd: number;
  /**
   * USDC the deposit leaves the user with. For a USDC-direct purchase that is the observed delta
   * itself. For a gas-first purchase it is the FUNDING share of the delivered ETH, i.e. the exact
   * input the conversion leg spends: its output is that input minus the swap's own slippage, which
   * only the leg's fresh quote knows, so this is the figure the app can substantiate rather than a
   * post-swap number it would have to invent.
   */
  receivedUsdc: number;
}

/** A terminal failure, with everything the host needs to answer it correctly. */
export interface StandaloneOnRampFailure {
  /** The flow's structured error (plain `code` + `message`), for the copy and `deposit_failed`. */
  error: TxError;
  /**
   * The purchase had already SETTLED when this failed: the card was charged and the funds landed as
   * ETH on Base. The host must say so, and must never route such a failure back to a fresh purchase.
   */
  settled: boolean;
  /**
   * POO-1403 [R1]: the Paybis `requestId` THIS session minted, or `undefined` when it never got that
   * far (the mint itself failed, or the user left during the SDK wait).
   *
   * Carried on the failure rather than re-read from the journal, because the journal keeps a purchase
   * for 24h and its newest record is then somebody's EARLIER, probably settled, purchase. Printing
   * that for an attempt which minted nothing tells support the user was charged when they were not.
   */
  paybisRequestId?: string;
  /**
   * Resume from the failed step (`useWalletSignFlow.retry`), re-running nothing that succeeded. Valid
   * only while this component stays mounted, which is why the host keeps it mounted through the error
   * phase rather than unmounting it and remounting a fresh one.
   */
  retry: () => void;
}

/** Public props for {@link StandaloneOnRampRail}. */
export interface StandaloneOnRampRailProps {
  /** USD the user wants to receive as USDC (the entered `/deposit` amount). */
  receiveUsd: number;
  /**
   * POO-1513 S2: the Paybis method the BUYER chose on `/deposit`, threaded to `mintOnRampRequest` and
   * from there onto the quote and `createOnRampRequestAction` (POO-1578 S3).
   *
   * This prop IS the boundary the selection used to die at. The props were `receiveUsd` plus three
   * callbacks, so the mint re-derived a method with `pickDefaultPaymentMethod` and every purchase
   * opened on a card, whatever the picker had been told. Omitted (nothing chosen, or a host with no
   * picker) that chooser still applies inside the rail as the FALLBACK it now is.
   */
  paymentMethod?: string;
  /**
   * POO-1630: the fiat currency the review was priced in, threaded for the same reason
   * {@link StandaloneOnRampRailProps.paymentMethod} is, and it is the SERVER's echo, never the
   * buyer's request.
   *
   * The same boundary swallowed this too. With no prop, `mintOnRampRequest` re-resolves the currency
   * from scratch (`useProvisioningRail.ts`: `currencyOverride = receivedFixed ? settledCurrencyCodeFrom
   * : order.fiatCurrency`, both undefined from here), so a buyer who moved to BRL to reach Pix got a
   * mint that resolved USD, found no `directa24_pix`, and fell back to a CARD priced in USD. They
   * approved one currency and one method and the widget opened another of each. That divergence was
   * unreachable while real mode had no currency control, which is precisely why adding the control had
   * to add this prop in the same change.
   *
   * The ECHO and not the pick: a proposal the server refused must not travel any further than the
   * screen that refused to show it.
   */
  currencyCodeFrom?: string;
  /**
   * POO-1642 [R1]: ask the BUYER about an in-flight purchase intent the mint cannot verify, instead
   * of deciding for them. Threaded through the same boundary as the two props above, for the same
   * reason, at a much higher cost for getting it wrong.
   *
   * POO-1384 built this and `ProvisioningPanel` has passed it since. This rail did not, and
   * `useProvisioningRail` states the consequence in its own comment: absent a `confirmResume` the
   * mint "falls through to minting, which is exactly the pre-POO-1384 behavior". Two production
   * journeys reach that fall-through from one buyer who paid, closed the tab, and came back:
   *
   *   - **paid and not arrived**: the widget reopens on the vendor's own completed screen, which has
   *     nothing left to do, and the buyer cannot leave it;
   *   - **not paid and expired**: a SECOND Paybis intent is minted beside a purchase whose funds may
   *     still be landing, so one deposit charges the card twice.
   *
   * Omitted (a host with no UI to ask with), the pre-POO-1384 fall-through is unchanged: this rail
   * adds no behaviour of its own, it only carries the host's question to the one place that can ask
   * it. See {@link ConfirmResumePurchase} for what the two answers mean on each branch.
   */
  confirmResume?: ConfirmResumePurchase;
  /**
   * The purchase settled on-chain: the host shows success and publishes the balance refresh.
   *
   * `null` when this run finished a purchase an EARLIER session made (a resumed conversion): there is
   * no delta to report, because nothing was bought in this run. The host falls back to its own figures
   * rather than rendering a zero it cannot substantiate.
   */
  onSettled: (settlement: StandaloneOnRampSettlement | null) => void;
  /** The reconcile timed out (money may still be landing): the host shows the settling screen. */
  onSettling: () => void;
  /** The purchase or its conversion did not complete. See {@link StandaloneOnRampFailure}. */
  onFailed: (failure: StandaloneOnRampFailure) => void;
}

/** What this mount is doing: a fresh purchase, or finishing one an earlier session paid for. */
type StandaloneBuild =
  | { kind: "fresh"; plan: ProvisioningPlan }
  | { kind: "resume"; plan: ProvisioningPlan; journalId: string };

/** Runs the standalone Paybis purchase (+ swap-to-USDC) and reports one terminal outcome. */
export function StandaloneOnRampRail({
  receiveUsd,
  paymentMethod,
  currencyCodeFrom,
  confirmResume,
  onSettled,
  onSettling,
  onFailed,
}: StandaloneOnRampRailProps) {
  const { balances, isLoading } = useTokenBalances();
  const { address, isLoading: walletLoading } = useAuth();

  // Capture the plan ONCE, the first time balances AND the wallet are resolved. Re-deriving it when
  // `useTokenBalances` re-reads on the settlement publish would reset the running flow ([R1] trigger
  // snapshot is a point-in-time read, not a live value), and deriving it before the wallet resolves
  // would miss a resumable conversion and mint a purchase beside one already paid for.
  //
  // PP-NOTE (degraded read, POO-1137): `useTokenBalances` resolves `isLoading=false` with `balances=[]`
  // when the FIRST read fails (a throttle, a transient RPC error), and `[]` is not distinguishable
  // here from a genuinely empty wallet. `readBaseNativeEth` therefore reads a zero, which is BELOW
  // `PAYBIS_GAS_FLOOR_ETH`, so an unreadable balance biases the plan to ETH-first. That is the safe
  // direction on purpose: the failure mode of buying ETH the user did not need is one extra
  // conversion leg and some native left over, while the failure mode of the opposite bias (assuming
  // gas the user does not have) is USDC landing in a wallet that cannot pay for a single transaction,
  // which is exactly the dead end [R1]'s standalone trigger exists to prevent.
  const builtRef = useRef<StandaloneBuild | null>(null);
  if (builtRef.current === null && !isLoading && !walletLoading) {
    // [R7], past the mint: a settled purchase whose conversion never landed is RESUMED, never bought
    // again. Its plan carries no `buy` step, so this mount cannot mint a second Paybis request.
    const resume = address ? findStandaloneSwapResume(address) : null;
    if (resume) {
      builtRef.current = { kind: "resume", plan: resume.plan, journalId: resume.journalId };
    } else {
      const { eth, ethUsd } = readBaseNativeEth(balances);
      const { plan } = buildStandaloneOnRampPlan({ receiveUsd, baseNativeEth: eth, ethUsd });
      builtRef.current = { kind: "fresh", plan };
    }
  }
  const built = builtRef.current;

  const rail = useProvisioningRail(RAIL_OPTIONS);
  const railRef = useRef(rail);
  railRef.current = rail;
  // Read through a ref for the same reason `ProvisioningPanel` does: the builder's identity moves
  // whenever Privy hands out a new wallets array, and a plan already running must not be re-expanded
  // underneath itself.
  const buildStepsRef = useRef(rail.buildSteps);
  buildStepsRef.current = rail.buildSteps;
  // POO-1513 S2: the buyer's chosen method, held the same way and for the same reason as `buildSteps`.
  const paymentMethodRef = useRef(paymentMethod);
  paymentMethodRef.current = paymentMethod;
  // POO-1630: the review's settled currency, held the same way and for the same reason.
  const currencyCodeFromRef = useRef(currencyCodeFrom);
  currencyCodeFromRef.current = currencyCodeFrom;
  // POO-1642 [R1]: the host's question, held the same way and for a sharper version of the same
  // reason. This callback closes over the prompt's own state, so its identity moves on every render
  // of the host; in `runOnRampBuy`'s deps that would re-expand a plan already minutes into its run.
  const confirmResumeRef = useRef(confirmResume);
  confirmResumeRef.current = confirmResume;

  // The observed delta of the purchase this run made, or null while none has settled. It is both the
  // pre/post-settlement discriminator for a failure and the receipt's figures ([R4]).
  const settledRef = useRef<TokenDelta[] | null>(null);
  // One journal per settled purchase: `openJournal` is idempotent-by-REPLACEMENT, so a second call
  // would leave a duplicate record claiming the same conversion is still due.
  const journalOpenedRef = useRef(false);

  // The fiat purchase currently in flight, or null. Set by the buy step's `runOnRampBuy`, it renders
  // the embedded widget and holds the resolvers the widget settles. Mirrors `ProvisioningPanel`.
  const [onRampBuy, setOnRampBuy] = useState<{
    requestId: string;
    expectedToken: OnRampBuyRequest["expectedToken"];
    wallet: string;
    settle: (deltas: TokenDelta[]) => void;
    fail: (error: TransactionError) => void;
  } | null>(null);

  /**
   * Journal the conversion the settled purchase still owes, BEFORE the buy step resolves.
   *
   * Written here rather than at the confirm because before settlement there is nothing on-chain to
   * convert, and the on-ramp journal's own `open` record ([R7]) already makes the purchase itself
   * resumable. From this write until `closeJournal` the deposit is recoverable by any later mount.
   */
  const openConversionJournal = useCallback((deltas: TokenDelta[]) => {
    const current = builtRef.current;
    if (journalOpenedRef.current || current?.kind !== "fresh") return;
    const amountIn = settledSwapBaseUnits(current.plan, deltas);
    // A USDC-direct purchase has no conversion to owe, and a delta we cannot express in base units is
    // one we must not record a swap for. Both mean there is nothing to resume.
    if (amountIn === null) return;
    journalOpenedRef.current = true;
    railRef.current.openJournal(
      buildStandaloneSwapPlan({
        amountIn,
        ...(current.plan.slippagePct === undefined
          ? {}
          : { slippagePct: current.plan.slippagePct }),
      }),
    );
  }, []);

  const runOnRampBuy = useCallback(
    async ({ order, expectedToken }: OnRampBuyRequest) => {
      // [R7]/[R8] Mint at execution time, RESUMING a journaled in-flight id first (inside the rail).
      // POO-1513 S2: the buyer's method rides along, read through a REF for the same reason
      // `buildStepsRef` is. Putting it in this callback's deps would rebuild `flowSteps` and
      // re-expand a plan that is already running. The selection is settled before the flow starts
      // (the host has left the review step), so the ref always holds the value they confirmed.
      const chosen = paymentMethodRef.current;
      const chosenCurrency = currencyCodeFromRef.current;
      const askResume = confirmResumeRef.current;
      const { requestId, wallet } = await railRef.current.mintOnRampRequest(order, {
        ...(chosen === undefined ? {} : { paymentMethod: chosen }),
        // POO-1630: without this the mint re-resolves the currency and can bill a different one on a
        // different method than the review showed. See the prop's own doc for the BRL/Pix trace.
        ...(chosenCurrency === undefined ? {} : { currencyCodeFrom: chosenCurrency }),
        // POO-1642 [R1]: without this the mint decides the in-flight question silently, and both of
        // its silent answers are wrong. Absent (never an explicit `undefined`, which would read as a
        // host that HAS no question rather than one that was never asked) the mint behaves exactly as
        // it did before POO-1384.
        ...(askResume === undefined ? {} : { confirmResume: askResume }),
      });
      // POO-1403 [R1]: remember it for the failure report; never cleared, so it survives a failure
      // in a LATER leg, which is exactly the case where the card was already charged.
      mintedRequestIdRef.current = requestId;
      return new Promise<void>((resolve, reject) => {
        setOnRampBuy({
          requestId,
          expectedToken,
          wallet,
          settle: (deltas) => {
            setOnRampBuy(null);
            settledRef.current = deltas;
            openConversionJournal(deltas);
            resolve();
          },
          fail: (error) => {
            setOnRampBuy(null);
            reject(error);
          },
        });
      });
    },
    [openConversionJournal],
  );

  const flowSteps = useMemo<FlowStep<RailCtx>[]>(() => {
    const buildSteps = buildStepsRef.current;
    if (!built || !buildSteps) return [];
    return buildSteps(built.plan, { onLegBroadcast: () => {}, runOnRampBuy });
  }, [built, runOnRampBuy]);

  const flow = useWalletSignFlow<RailCtx>(flowSteps, { fallbackErrorCode: "ONRAMP_FAILED" });

  // Auto-run once the plan is built. `useWalletSignFlow` returns a fresh object each render, so read it
  // through a ref and gate on a one-shot flag rather than the flow identity.
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || flowSteps.length === 0) return;
    startedRef.current = true;
    const current = builtRef.current;
    // A resumed conversion writes to the record the earlier session opened, so its legs accrue on the
    // one journal and `closeJournal` retires the right one.
    if (current?.kind === "resume") railRef.current.adoptJournal(current.journalId);
    void flowRef.current.run();
  }, [flowSteps.length]);

  /** Resume from the failed step. Handed to the host so Try again never remounts a fresh purchase. */
  const retry = useCallback(() => {
    void flowRef.current.retry();
  }, []);

  // Report the single terminal outcome to the host exactly once PER attempt. The one-shot flag is
  // cleared when a retry puts the flow back in motion, so a second failure is reported too; it is
  // never cleared while the flow sits in `error`, which would re-notify on any unrelated re-render.
  const notifiedRef = useRef(false);
  /** The Paybis `requestId` this session minted, for the failure report (POO-1403 [R1]). */
  const mintedRequestIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (flow.status === "running") notifiedRef.current = false;
  }, [flow.status]);
  useEffect(() => {
    if (notifiedRef.current) return;
    if (flow.status === "success") {
      notifiedRef.current = true;
      // [R7] Every leg landed: nothing is in flight, so the recovery record must not survive to tell
      // a later mount that a conversion is still due.
      railRef.current.closeJournal();
      onSettled(summariseSettlement(builtRef.current, settledRef.current));
      return;
    }
    if (flow.status === "error") {
      notifiedRef.current = true;
      if (flow.error?.code === ONRAMP_SETTLING_CODE) {
        onSettling();
        return;
      }
      // Pass the TxError straight through (its `code` is a plain field). A missing error is impossible
      // once status is `error`, but fall back rather than assert.
      onFailed({
        error: flow.error ?? { code: "ONRAMP_FAILED", message: "The purchase did not complete" },
        ...(mintedRequestIdRef.current ? { paybisRequestId: mintedRequestIdRef.current } : {}),
        // A resumed conversion is post-settlement BY CONSTRUCTION: the purchase it is finishing was
        // paid for in an earlier session, so its failure can never route back to a fresh purchase.
        settled: settledRef.current !== null || builtRef.current?.kind === "resume",
        retry,
      });
    }
  }, [flow.status, flow.error, onSettled, onSettling, onFailed, retry]);

  if (onRampBuy) {
    return (
      <PaybisWidgetFrame
        requestId={onRampBuy.requestId}
        expectedToken={onRampBuy.expectedToken}
        wallet={onRampBuy.wallet}
        onSettled={(deltas) => onRampBuy.settle(deltas)}
        onTerminal={(status, reason) => onRampBuy.fail(onRampTerminalError(status, reason))}
      />
    );
  }

  // The host owns the terminal screens (success / settling / error), and it keeps this component
  // mounted through the error phase so `retry` stays live. Rendering a caption underneath it would
  // put a spinner below an error.
  if (flow.status === "success" || flow.status === "error") return null;

  // Between mount / mint and the swap leg the widget is not mounted, so this component owns the
  // caption. "swapping" once the flow is on the buy-swap leg; "connecting" before the purchase opens.
  const activeKey = flowSteps[flow.activeStep]?.key;
  const status: StandaloneOnRampRailStatus = activeKey?.includes("swap")
    ? "swapping"
    : "connecting";
  return <StandaloneOnRampRailView status={status} />;
}

/**
 * What to tell the host about the money, or `null` when this run observed no purchase.
 *
 * A resumed conversion returns `null` on purpose: it finished a purchase made in an earlier session,
 * whose delta this app never saw and cannot reconstruct (the journal stores base units against token
 * addresses and no USD, `02_BRIDGE_ARCHITECTURE.md` §3.3). Reporting a zero would be worse than
 * reporting nothing.
 */
function summariseSettlement(
  built: StandaloneBuild | null,
  deltas: TokenDelta[] | null,
): StandaloneOnRampSettlement | null {
  if (!deltas || deltas.length === 0 || built?.kind !== "fresh") return null;
  const settledUsd = deltas.reduce((sum, delta) => sum + delta.usd, 0);

  // A USDC purchase IS the deposit: the observed amount is what the user now holds, exactly.
  const usdc = deltas.find((delta) => delta.symbol.toUpperCase() === "USDC");
  if (usdc) return { deltas, settledUsd, receivedUsdc: usdc.amount };

  // A gas-first purchase bought the deposit PLUS gas, so only the funding share becomes USDC. The
  // ratio is the rail's own ({@link fiatSwapFractionBps}), never a second copy of the rule.
  const swapStep = built.plan.steps.find((step) => step.key === "buy-swap");
  const buyStep = built.plan.steps.find((step) => step.type === "buy");
  const bps =
    swapStep && buyStep ? (fiatSwapFractionBps(swapStep, buyStep.amountUsd) ?? 10_000) : 10_000;
  return { deltas, settledUsd, receivedUsdc: (settledUsd * bps) / 10_000 };
}

/** The non-widget phases this rail renders its own caption for. */
export type StandaloneOnRampRailStatus = "connecting" | "swapping";

/** The caption key per non-widget phase (literal keys so the static i18n scan sees each one). */
const CAPTION_KEY: Record<StandaloneOnRampRailStatus, string> = {
  connecting: "onramp.connecting",
  swapping: "onramp.swapping",
};

/** Public props for {@link StandaloneOnRampRailView}. */
export interface StandaloneOnRampRailViewProps {
  /** Which non-widget phase caption to show. */
  status: StandaloneOnRampRailStatus;
}

/**
 * The presentational shell for the rail's non-widget phases, framed to match {@link PaybisWidgetFrame}
 * so the surface does not jump when the widget mounts / unmounts. Split out so both captions are
 * story- and test-able without a running flow (react-component-blueprint: separated states).
 */
export function StandaloneOnRampRailView({ status }: StandaloneOnRampRailViewProps) {
  const t = useTranslations("deposit");
  return (
    <section aria-label={t("onramp.title")} className="flex w-full flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-white/[0.04] p-2">
        <div className="flex min-h-[26rem] w-full flex-col items-center justify-center gap-3 p-6">
          <span
            className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
            aria-hidden="true"
          />
          <p role="status" aria-live="polite" className="text-center text-muted-foreground text-sm">
            {t(CAPTION_KEY[status])}
          </p>
        </div>
      </div>
      <p className="text-center text-muted-foreground text-xs">{t("securedByPaybis")}</p>
    </section>
  );
}
