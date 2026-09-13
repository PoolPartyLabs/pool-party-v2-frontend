/**
 * @id PP-STR-CMP-029 (POO-1808)
 * @name PrivyBuyStep
 * @implements-rules-version v2 (POO-1813 rules v1: the purchase funnel's settled row, and the
 *   mapped `error_code` on a hard no) · v1 (POO-1808 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * @analytics-events tx_amount_blocked
 *
 * The buy LEG's own funnel events stay where they already are, on the panel's flow-status effect, so
 * this step cannot double-count them. POO-1813 [R4] adds one more ROW from here,
 * `funding_buy_settled`, fired from the OBSERVED DELTA because the adapter that reports the other
 * three never sees a balance. It is absent from the header above on purpose: the row is PUSHED by
 * the shared emitter (`PP-CORE-LIB-111`), which carries the header for the whole family, the same
 * way `ProvisioningPanel` causes the `funding_*` funnel without declaring it.
 *
 * The provisioning buy step, on the second rail. It composes four modules and owns no policy of its
 * own:
 *
 *   * {@link usePrivyOnRamp} (`PP-CORE-HOK-035`) opens the checkout and classifies the exit.
 *   * {@link watchOnRampSettlementVisible} (`PP-CORE-LIB-110`) decides when money actually arrived.
 *   * {@link useOnRampCoverage} (`PP-CORE-HOK-036`) asks whether anyone will sell before we open.
 *   * {@link usdcDestination} (`PP-CORE-LIB-106`) says where it should land, in the rail's own words.
 *
 * ## [R3] The promise resolves on the DELTA, never on a claim
 *
 * The provider's `confirmed` is its claim that it charged a card. Privy's own JSDoc says funds take
 * minutes to arrive, so resolving there would be a NEW fabricated success of exactly the kind this
 * epic exists to delete: the next leg's `sizeFromRealBalance` would read a zero delta and throw
 * `PROVISIONING_LEG_EMPTY` over money that is genuinely on its way. So the claim starts the
 * observation window and nothing else, and `onSettled` fires from the observed balance delta.
 *
 * At the visible ceiling the outcome is `settling` or `unverified`, and the step HANDS OVER rather
 * than holding a promise nobody will settle: it rejects with {@link ONRAMP_SETTLING_CODE}, which is
 * the code the panel's own `settling` screen already reads on the Paybis rail. That screen says the
 * purchase is still landing, offers no retry that would charge a second card, and is never framed as
 * a cancellation (ADR-0006). Leaving the promise pending instead would freeze the run on a step with
 * no exit, on a surface whose passive window does not survive the unmount: cross-session resumption
 * is POO-1833's, and until it lands the honest end of the visible window is a handover, not a hang.
 *
 * ## [R5] The baseline is read before the click, not after
 *
 * A baseline taken after the buyer may already have paid would subtract their own money from the
 * delta and report a smaller delivery than arrived. So the destination balance is read once on
 * mount, the CTA stays disabled with an honest message until it exists, and the click hands that
 * exact figure to both the checkout and the watcher.
 *
 * The click handler calls `openCheckout` SYNCHRONOUSLY. Every await between the gesture and the
 * SDK's own window opening is a popup the browser blocks, which is why coverage is probed on mount
 * rather than on the press.
 *
 * ## What this step refuses, and why refusing is the honest answer
 *
 * [R4] A `"ETH-BASE"` order is the gas-first leg, and POO-1820 answered that native is not for sale
 * on this rail. The step refuses BEFORE opening rather than opening a checkout that cannot fill the
 * order. Whether to cover gas with a paymaster or to disclose it differently is Murilo's product
 * decision; this refusal is the honest placeholder until it is taken.
 *
 * [R6] An `uncovered` probe means no provider will sell to this buyer, for this currency, right now.
 * Opening anyway would show them a checkout with nothing in it. An `unknown` probe does NOT block:
 * we could not find out, which is not the same as a refusal.
 *
 * [R7] A resolved currency the rail cannot charge in is refused too, and that refusal replaces the
 * silent `?? "usd"` this step first shipped with. Defaulting there would charge a buyer in a currency
 * nobody chose for them and let their bank take the conversion, which is the POO-1512 defect one rail
 * over. USD is used ONLY when no currency was resolved at all, because USD is the terminal fallback
 * of the server chain that resolves it (POO-1805 [R3]), not a guess this component invents.
 *
 * ## The currency list is never narrowed
 *
 * `assets` is always the rail's full list. A `covered` probe answers whether ANYONE will sell for one
 * amount in one currency; it is not a statement that the other 48 currencies are unavailable, and
 * narrowing on it would take the buyer's own currency picker away on the strength of a question
 * nobody asked. `defaultAsset` is what decides the currency they land on ([R7]).
 */
"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import type { AnalyticsFlow } from "@/lib/analytics/events";
import { onRampErrorCode, useFundingBuyFunnel } from "@/lib/analytics/fundingBuyFunnel";
import type { AnalyticsBlockReason } from "@/lib/analytics/txFlowKit";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import type {
  OnRampObservationInput,
  OnRampSettlementDeps,
  OnRampSettlementOutcome,
} from "@/lib/onramp/awaitOnRampSettlement";
import { watchOnRampSettlementVisible } from "@/lib/onramp/awaitOnRampSettlement";
import type { CoverageProbeInput, CoverageResult } from "@/lib/onramp/coverageProbe";
import { usdcDestination } from "@/lib/onramp/destinations";
import { PRIVY_FIAT_CURRENCIES, toPrivyFiat } from "@/lib/onramp/fiatCurrencies";
import { resolveOnRampEnvironment } from "@/lib/onramp/onRampProvider";
import { ONRAMP_SETTLING_CODE } from "@/lib/onramp/schemas";
import { useOnRampCoverage } from "@/lib/onramp/useOnRampCoverage";
import {
  type PrivyOnRampInput,
  type PrivyOnRampOutcome,
  usePrivyOnRamp,
} from "@/lib/onramp/usePrivyOnRamp";
import type { ProvisioningOrder } from "@/lib/provisioning/types";
import { readErc20Balance } from "@/lib/tokens/readErc20";
import { formatUsd } from "@/lib/utils/format";

/** Base, the one chain this rail delivers on today. */
const BASE_CHAIN_ID = 8453;

/** USDC's decimals on every chain this app ships. Used only to format the observed delta. */
const USDC_DECIMALS = 6;

/** Our vocabulary for the gas-first leg's order. Never a vendor wire token. */
const NATIVE_ORDER_CODE = "ETH-BASE";

/**
 * [R4] The typed code a refused native order rejects with.
 *
 * PP-TODO(POO-1813): this and {@link ONRAMP_UNCOVERED_CODE} join the `ONRAMP_*` code union whose
 * exhaustiveness claim is already false today. The eight Paybis codes are deliberately untouched:
 * they belong to a rail that is still live (D13) and renaming any of them here would change the
 * behaviour of a path this issue promises not to touch.
 */
export const ONRAMP_NATIVE_UNAVAILABLE_CODE = "ONRAMP_NATIVE_UNAVAILABLE";

/** [R6] The typed code a refused-for-coverage order rejects with. */
export const ONRAMP_UNCOVERED_CODE = "ONRAMP_UNCOVERED";

/** [R7] The typed code a buy refused for an uncharagable currency rejects with. */
export const ONRAMP_CURRENCY_UNSUPPORTED_CODE = "ONRAMP_CURRENCY_UNSUPPORTED";

/**
 * The code the step rejects with when the observation loop itself throws.
 *
 * A `readBalance` that rejects for the whole window, a watcher that throws: whatever the cause, the
 * failure is OURS and not the buyer's, so it never says "cancelled" and never says "declined". It
 * lands on the panel's generic buy-failure copy, which is the honest sentence for "we lost track of
 * your purchase" until POO-1813 gives the family its own words.
 */
export const ONRAMP_OBSERVER_FAILED_CODE = "ONRAMP_OBSERVER_FAILED";

/**
 * The rail's terminal currency fallback, and the ONLY case it is used for: no currency resolved at
 * all. It is the server chain's own last step (CloudFront country, then profile, then USD, POO-1805
 * [R3]), so using it here agrees with that chain rather than inventing a second answer. A currency
 * that RESOLVED and is not chargeable is refused instead ([R7]), never silently replaced by this.
 */
const UNRESOLVED_CURRENCY_FALLBACK = "usd";

/** Everything the step reaches for, injected so the suite never needs a Privy provider. */
export interface PrivyBuyStepDeps {
  openCheckout: (input: PrivyOnRampInput) => Promise<PrivyOnRampOutcome>;
  probeCoverage: (input: CoverageProbeInput) => Promise<CoverageResult>;
  /** One `balanceOf` on the destination chain, in base units. The baseline AND the watcher's read. */
  readBalance: OnRampSettlementDeps["readBalance"];
  watchVisible: (
    input: OnRampObservationInput,
    deps: OnRampSettlementDeps,
  ) => Promise<OnRampSettlementOutcome>;
  sleep: OnRampSettlementDeps["sleep"];
  now: OnRampSettlementDeps["now"];
  /** From `resolveOnRampEnvironment()` (`PP-CORE-LIB-105`), never resolved here. */
  environment: "production" | "sandbox";
}

export interface PrivyBuyStepProps {
  order: ProvisioningOrder;
  /** The wallet the funds must land on. */
  address: string;
  /**
   * [R7] The buyer's currency as the SERVER resolved it, threaded down from the panel's
   * `useBuyRouteQuote` echo, exactly as the Paybis rail's method step reads it. `undefined` when no
   * resolution has arrived, which is the one case {@link UNRESOLVED_CURRENCY_FALLBACK} covers.
   *
   * Deliberately NOT `order.fiatCurrency`: the planner writes a constant `"USD"` there
   * (`sizeOnRampOrder.ts`), so reading the currency off the order would make every buyer's checkout
   * open in dollars while looking like it had asked.
   */
  buyerCurrency?: string;
  /**
   * Premise 11's context, so this step's blocked intents are comparable with every other event the
   * flow emits. The panel converts `operation.kind` at its own boundary and passes the result; a
   * `tx_amount_blocked` without `flow` cannot be attributed to a funnel at all.
   */
  analytics?: { flow?: AnalyticsFlow; strategyId?: string };
  /** Settles the panel's `runOnRampBuy` promise. Called ONLY on an observed delta ([R3]). */
  onSettled: () => void;
  /** Rejects it, with a typed error the panel already knows how to render. */
  onFailed: (error: Error) => void;
  deps: PrivyBuyStepDeps;
}

/** A rejection the panel's existing error surface can read, same shape as the Paybis path's. */
function typedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** What the step is doing right now. `settling` is a pause, never a failure ([R3]). */
type StepPhase = "preparing" | "ready" | "opening" | "observing" | "settling" | "refused";

export function PrivyBuyStep({
  order,
  address,
  buyerCurrency,
  analytics,
  onSettled,
  onFailed,
  deps,
}: PrivyBuyStepProps): React.ReactElement | null {
  const t = useTranslations("strategies.provisioning.onramp");
  const { track } = useAnalytics();
  // POO-1813 [R4]: the shared emitter, so this host's `settled` row is the same row the deposit host
  // pushes for the same kind of purchase, joined to the adapter's three on our attempt id.
  const buyFunnel = useFundingBuyFunnel();
  const [phase, setPhase] = useState<StepPhase>("preparing");
  const [baseline, setBaseline] = useState<bigint | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  /**
   * [R8] The blocked intent with its flow context attached, in one place so no call site can forget
   * half of it. `flow` and `strategy_id` are what make this event comparable with the rest of the
   * funnel, and the panel is the only thing that knows either.
   */
  const flow = analytics?.flow;
  const strategyId = analytics?.strategyId;
  const reportBlocked = useCallback(
    (reason: AnalyticsBlockReason) => {
      track("tx_amount_blocked", {
        ...(flow ? { flow } : {}),
        ...(strategyId ? { strategy_id: strategyId } : {}),
        block_reason: reason,
      });
    },
    [track, flow, strategyId],
  );
  const reportRef = useRef(reportBlocked);
  reportRef.current = reportBlocked;

  /**
   * Memoized because it is an OBJECT, and an object rebuilt every render is a dependency that
   * changes every render. Left raw it re-ran the preparation effect on every state update, which
   * reset the phase back to `ready` and made the settling screen unreachable.
   */
  const destination = useMemo(() => usdcDestination(BASE_CHAIN_ID), []);

  /**
   * The callbacks and the injected deps are held in refs for the same reason: the panel rebuilds
   * both on every render, and an effect that depends on their identity would re-prepare the step
   * underneath a purchase that is already open.
   */
  const settleRef = useRef({ onSettled, onFailed, buyFunnel });
  settleRef.current = { onSettled, onFailed, buyFunnel };
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /**
   * [R7] The currency the checkout opens in, resolved ONCE for every path below.
   *
   * Three answers, and the middle one is the whole point. A resolved currency the rail can charge in
   * is used. A resolved currency it cannot is REFUSED, because silently swapping it for dollars is a
   * charge in money nobody chose. No resolution at all falls back to USD, which is where the server
   * chain that resolves it ends anyway.
   */
  const resolvedFiat = buyerCurrency ? toPrivyFiat(buyerCurrency) : undefined;
  const currencyUnsupported = Boolean(buyerCurrency) && resolvedFiat === undefined;
  const defaultAsset = resolvedFiat ?? UNRESOLVED_CURRENCY_FALLBACK;

  /**
   * [R4] The refusal that happens before anything else, including the baseline read: a purchase we
   * will not open needs no preparation, and reading a balance for it would be work done for a
   * checkout that never appears.
   */
  const nativeOrder = order.currencyCode === NATIVE_ORDER_CODE;
  useEffect(() => {
    if (!nativeOrder) return;
    reportRef.current("onramp_native_unavailable");
    setPhase("refused");
    setRefusal("nativeUnavailable");
    settleRef.current.onFailed(
      typedError(ONRAMP_NATIVE_UNAVAILABLE_CODE, "this rail does not sell the native coin"),
    );
  }, [nativeOrder]);

  /**
   * [R7] The second refusal before any work, for the same reason as the first: a checkout we cannot
   * open in the buyer's own money is not a checkout we open in somebody else's.
   */
  useEffect(() => {
    if (nativeOrder || !currencyUnsupported) return;
    reportRef.current("onramp_currency_unsupported");
    setPhase("refused");
    setRefusal("currencyUnsupported");
    settleRef.current.onFailed(
      typedError(
        ONRAMP_CURRENCY_UNSUPPORTED_CODE,
        "this rail cannot charge in the buyer's currency",
      ),
    );
  }, [nativeOrder, currencyUnsupported]);

  /**
   * [R5] The baseline, and [R6] the coverage question, both before the click. Neither is allowed to
   * happen after it: a late baseline hides money the buyer already had, and a late coverage probe is
   * an await between the gesture and the popup.
   */
  useEffect(() => {
    if (nativeOrder || currencyUnsupported || !destination) return;
    let cancelled = false;
    (async () => {
      const bound = depsRef.current;
      try {
        const current = await bound.readBalance({ ...destination, address });
        if (!cancelled) setBaseline(current);
      } catch {
        // Left null on purpose: the CTA refuses and says so. A baseline we could not read is not a
        // zero, and a zero here would credit the buyer's own balance as a delivery. Reported too
        // ([R8]): a wall the buyer cannot get past is a blocked intent, not a quiet spinner.
        if (cancelled) return;
        setBaseline(null);
        reportRef.current("onramp_baseline_unreadable");
      }
      const probed = await bound.probeCoverage({
        fiat: defaultAsset,
        amount: order.fiatAmount,
        destination: { ...destination, address },
        environment: bound.environment,
      });
      if (cancelled) return;
      // Only `uncovered` refuses. `unknown` means we could not find out, which is not a refusal;
      // `amount-too-low` names the RAIL's own display floor, which our `ON_RAMP_FLOOR_USD` order
      // already clears, and treating it as a refusal here would put a second opinion of the floor
      // in front of a buy the planner already sized. Neither is stored: nothing downstream reads
      // the answer, and a state nobody reads is a re-render nobody asked for.
      if (probed.status === "uncovered") {
        reportRef.current("onramp_uncovered");
        setPhase("refused");
        setRefusal("uncovered");
        settleRef.current.onFailed(
          typedError(ONRAMP_UNCOVERED_CODE, "no provider sells to this buyer right now"),
        );
        return;
      }
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
    // `deps` is deliberately absent: it is read through `depsRef` precisely so a re-render cannot
    // re-prepare a step whose checkout is already open.
    //
    // No debounce, and none is needed (POO-1805 F11): `order.fiatAmount` is a PLAN figure, re-sized
    // by a re-quote and never by a field the buyer is typing in, so this effect runs about once per
    // buy. The hook underneath also de-duplicates identical questions still in flight
    // (`useOnRampCoverage`'s `inFlight` map), which is where a burst would be absorbed if one ever
    // arrived from somewhere else.
  }, [nativeOrder, currencyUnsupported, destination, address, defaultAsset, order.fiatAmount]);

  /**
   * [R7] What to prefill, and the one case where we must not.
   *
   * The amount is `buyOrderUsd` as the planner already computed it (`max(ON_RAMP_FLOOR_USD,
   * shortfall)`), with no rate and no second buffer applied on top. It rides ONLY when the buyer is
   * paying in dollars, because the figure is a USD figure: prefilling it as a euro amount would ask
   * for a different sum than the leg needs, and the rail gives us no rate to convert with.
   *
   * The adapter enforces the same rule at its own boundary (it drops `defaultAmount` when the
   * prefill currency and `fiat.defaultAsset` disagree), so this is the honest input rather than the
   * only guard: what the flag decides here is what the buyer READS.
   */
  const usdPrefill = defaultAsset === UNRESOLVED_CURRENCY_FALLBACK;

  const open = useCallback(() => {
    if (baseline === null || !destination) return;
    setPhase("opening");
    // [R5] SYNCHRONOUS from the gesture: no await before this call, or the popup is blocked.
    const bound = depsRef.current;
    const opened = bound.openCheckout({
      destination,
      address,
      requested: { amount: Number(order.fiatAmount), currency: order.fiatCurrency },
      prefill: usdPrefill
        ? { amount: Number(order.fiatAmount), currency: order.fiatCurrency }
        : { amount: 0, currency: order.fiatCurrency },
      // The rail's FULL list, always. See the header: a `covered` answer is about one amount in one
      // currency, and narrowing to it would take the buyer's own picker away. `defaultAsset` is what
      // decides where they land.
      fiat: { defaultAsset, assets: [...PRIVY_FIAT_CURRENCIES] },
      environment: bound.environment,
      baseline: { raw: baseline.toString(), decimals: USDC_DECIMALS },
    });

    (async () => {
      try {
        const outcome = await opened;
        // A refusal before the mint, or a hard no: nothing was charged and nothing is coming.
        if (outcome.moved === "no" || !outcome.attemptId) {
          setPhase("refused");
          setRefusal("failedBody");
          // POO-1813 [R1]: the MAPPED code, never the classifier's raw slug. The panel reports this
          // `code` as the run's `error_code`, and a lowercase reason fails the shape guard: it was
          // either dropped outright or folded into `SYSTEM_UNKNOWN`, so every distinct hard no
          // arrived as the same unusable row.
          settleRef.current.onFailed(
            typedError(onRampErrorCode(outcome.reason), "the purchase did not start"),
          );
          return;
        }
        setPhase("observing");
        // [R3] The claim starts the WATCH. It never settles the promise.
        const settled = await bound.watchVisible(
          {
            attemptId: outcome.attemptId,
            destination,
            address,
            baseline,
            decimals: USDC_DECIMALS,
            moved: outcome.moved,
          },
          { readBalance: bound.readBalance, sleep: bound.sleep, now: bound.now },
        );
        if (settled.outcome === "settled") {
          /**
           * [R4] The ONLY honest money-in number: the observed delta, never the promise resolving
           * and never the provider's claim.
           *
           * `fiat_currency` is `defaultAsset`, what the card is CHARGED in, and deliberately not
           * `order.fiatCurrency`: the planner writes a constant `"USD"` there (`sizeOnRampOrder.ts`),
           * so reading the currency off the order would report every buyer's charge as dollars.
           * `prefill_usd` is OMITTED rather than zeroed when we prefilled nothing, which is exactly
           * the non-USD case: a zero would enter the buffer series as a figure we never asked for.
           */
          settleRef.current.buyFunnel.settled(
            {
              rail: "privy",
              attemptId: outcome.attemptId,
              fiatCurrency: defaultAsset.toUpperCase(),
            },
            {
              requestedUsd: Number(order.fiatAmount),
              ...(usdPrefill ? { prefillUsd: Number(order.fiatAmount) } : {}),
              deliveredUsd: Number(settled.delivered.amount),
            },
          );
          settleRef.current.onSettled();
          return;
        }
        // [R3] `settling` / `unverified`: the visible window is over and the money has not landed.
        // The step HANDS OVER instead of holding a promise nobody will settle: the panel's settling
        // screen says the purchase is still landing, offers no retry that would charge a second
        // card, and is never framed as a cancellation. The local copy is set first so the handover
        // is visible even where the panel keeps this step mounted.
        setPhase("settling");
        settleRef.current.onFailed(
          typedError(ONRAMP_SETTLING_CODE, "the purchase was paid and has not landed yet"),
        );
      } catch (error) {
        // The observation loop itself broke: a `readBalance` that threw past the watcher's own
        // handling, a `sleep` that rejected, an adapter that threw where it promised not to. Ours,
        // not the buyer's, so it is reported as a failure of the observation and never as a
        // cancellation. Without this the promise stayed pending forever and the run froze on a step
        // with no exit.
        setPhase("refused");
        setRefusal("failedBody");
        settleRef.current.onFailed(
          Object.assign(typedError(ONRAMP_OBSERVER_FAILED_CODE, "we lost track of the purchase"), {
            cause: error,
          }),
        );
      }
    })();
  }, [baseline, destination, defaultAsset, usdPrefill, address, order]);

  // The buyer's own currency as they would recognise it, for the two sentences that name one. Never
  // `order.fiatCurrency`, which the planner writes as a constant `"USD"`.
  const buyerCurrencyLabel = (buyerCurrency ?? order.fiatCurrency).toUpperCase();

  if (nativeOrder || phase === "refused") {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {refusal === "uncovered"
          ? t("uncovered", { currency: buyerCurrencyLabel })
          : refusal === "currencyUnsupported"
            ? t("currencyUnsupported", { currency: buyerCurrencyLabel })
            : refusal === "nativeUnavailable"
              ? t("nativeUnavailable")
              : t("failedBody")}
      </p>
    );
  }

  if (phase === "settling") {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t("timedOut")}
      </p>
    );
  }

  if (phase === "observing" || phase === "opening") {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t("reconciling")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!usdPrefill ? (
        <p className="text-muted-foreground text-sm">
          {/* The figure is what the buyer PAYS, so it is money and carries no ticker at all. It was
              first written as "{amount} USDC", which named the DELIVERED asset beside a SPEND
              amount: two different quantities on either side of the provider's spread, and the one
              distinction CONTEXT.md is most explicit about. `formatUsd` because the order itself is
              denominated in dollars (`sizeOnRampOrder` writes `fiatCurrency: "USD"`), and this
              sentence only appears when the buyer pays in something else, so what it says is "the
              leg needs about this much in dollars, type the equivalent". */}
          {t("enterAmount", { amount: formatUsd(Number(order.fiatAmount)) })}
        </p>
      ) : null}
      {baseline === null ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("baselineUnavailable")}
        </p>
      ) : null}
      {/* Its own key, not the Paybis path's `open`: that string is a STATUS sentence read under a
          mounted checkout iframe ("Complete your purchase in the checkout above"), and there is no
          checkout above this button. Provider-neutral, because the merchant of record is Stripe,
          MoonPay, Coinbase or Meld and never the integrator whose SDK we call. */}
      <Button type="button" onClick={open} disabled={baseline === null || phase !== "ready"}>
        {t("openCheckout")}
      </Button>
    </div>
  );
}

/**
 * The step as the panel renders it: the same component with its four seams bound to the real ones.
 *
 * The split is not ceremony. The suite for this step drives an inconclusive exit, a ceiling and a
 * refusal, none of which a real SDK will produce on demand, and mocking `@privy-io/react-auth` in a
 * component test would replace the very contract POO-1803 traced out of the bundle with a guess. So
 * the logic takes its dependencies as props and this wrapper is the only thing that knows they come
 * from hooks.
 */
export function ConnectedPrivyBuyStep(
  props: Omit<PrivyBuyStepProps, "deps" | "address">,
): React.ReactElement | null {
  // ONE read of "the connected wallet", in the only component that consumes it. The panel's POO-1403
  // note warns that two independent reads could disagree and file the intent under an address the
  // resume lookup never queries; on this rail there is no mint to source it from, so the read lives
  // here rather than being threaded through a second path.
  const { address } = useAccount();
  const { openCheckout } = usePrivyOnRamp();
  const probeCoverage = useOnRampCoverage();
  const deps = useMemo<PrivyBuyStepDeps>(
    () => ({
      openCheckout,
      probeCoverage,
      // PP-INTEGRATION-POINT: the on-chain read that decides whether the money arrived. The address
      // is the registry's own Base USDC (`PP-CORE-LIB-106`), never a literal repeated here.
      readBalance: async ({ asset, address }) =>
        readErc20Balance(asset as `0x${string}`, address as `0x${string}`, BASE_CHAIN_ID),
      watchVisible: watchOnRampSettlementVisible,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      // [R2]/POO-1800: the environment is DERIVED once, by the resolver that owns the rule, and
      // passed down. A step that read its own could disagree with the rail about which one it is on.
      environment: resolveOnRampEnvironment(),
    }),
    [openCheckout, probeCoverage],
  );
  return <PrivyBuyStep {...props} address={address ?? ""} deps={deps} />;
}
