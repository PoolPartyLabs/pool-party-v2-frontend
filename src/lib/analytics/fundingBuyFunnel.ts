/**
 * @id PP-CORE-LIB-111 (POO-1813)
 * @name funding buy funnel
 * @implements-rules-version v1 (POO-1813 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * @analytics-events funding_buy_started, funding_buy_submitted, funding_buy_failed, funding_buy_settled
 *
 * ONE emitter for the fiat purchase, shared by the two hosts of the PRIVY rail.
 *
 * These four names were specced in POO-1178 against Paybis vocabulary and then never emitted: they
 * have sat in `DEAD_EVENT_ALLOWLIST` since, which is the honest bookkeeping of a promise nobody
 * kept. This module keeps it, and keeps it once: a second emitter on a second host would report
 * every purchase twice, and the two would drift the first time either rail changed.
 *
 * The PAYBIS rail is deliberately NOT wired here. It keeps the events it already emits until
 * POO-1809 retires it, because re-pointing a live series onto four names it never carried would
 * make the history either side of the switch unreadable, over a rail that is being deleted anyway.
 * That is why {@link FundingBuyRail} has two values while only one of them is produced today: the
 * dimension exists so the day a second rail does emit, the two are separable rather than averaged.
 *
 * ## Why the shape is the shape
 *
 * `rail` is on every event because the same funnel now describes two providers, and a conversion
 * rate that silently mixes them is worse than two rates. `attempt_id` is OUR intent id
 * (`PP-CORE-LIB-107`), never a provider's reference: ours is a random opaque key we mint, while a
 * provider's may encode an account or a session and would put a vendor identifier into the
 * dataLayer. It is not PII, and it is what joins these four events into one purchase.
 *
 * ## `settled` is the only honest money-in number ([R4])
 *
 * `submitted` is the provider's CLAIM that it charged a card. `settled` is the OBSERVED balance
 * delta (`PP-CORE-LIB-110`), and it is the only one of the two that means money exists. They are
 * deliberately different names for that reason, and `settled` must never fire from a promise
 * resolving, a modal closing, or a status string: only from the watcher's `settled` outcome.
 *
 * ### Why `submitted` under-counts, and why nothing here corrects for it (ADR-0006)
 *
 * The claim is not always delivered. POO-1798's review pinned the loss to ONE provider: on the
 * STRIPE path the checkout renders inside Privy's own modal, and after react-auth 3.40.0 a charged
 * card and an abandonment both come back as `Error("User exited flow")`, so a real charge is
 * classified `maybe` and reported here as `moved: "maybe"` rather than as a confirmed claim. The
 * POPUP providers (MoonPay, Coinbase, Meld) still set `provider-confirming` before the window
 * closes, so their claim survives and arrives as `moved: "confirmed"`.
 *
 * The observation window is therefore MANDATORY on the Stripe path, where it is the only thing that
 * can tell a charge from an exit, and belt-and-braces on the popup path, where the claim already
 * said so. **Nothing branches on that distinction**, here or in the watcher: `maybe` and
 * `confirmed` both open the window and both settle only on the delta, and a funnel that special
 * cased Stripe would be reading a provider identity the SDK never tells us. `moved` is reported so
 * the asymmetry is measurable, never so that anything acts on it.
 *
 * It carries the three figures POO-1811's purchase half needs: `requested_usd` (what the buyer asked
 * for), `prefill_usd` (what we actually put in the field, buffer included) and `delivered_usd` (what
 * arrived). The difference between the first two is the buffer, and between the second and third is
 * the provider's spread, and neither was measurable before this event existed. That closes the
 * "requested vs delivered per purchase" half POO-1811 deliberately left open.
 *
 * `prefill_usd` is OMITTED, never sent as `0`, when we prefilled nothing. A buyer paying in reais
 * gets no `defaultAmount` at all (the figure is a USD one and the rail quotes no rate to convert
 * it), and a zero there would enter the buffer series as "we asked for nothing and they paid
 * anyway", which is a wrong number rather than a missing one. A missing dimension in GA4 is a row
 * the buffer query skips; a zero is a row it averages.
 */
"use client";

import { useCallback, useMemo } from "react";
import { useAnalytics } from "./useAnalytics";

/**
 * Which rail served the purchase.
 *
 * Only `privy` is produced today: the Paybis rail keeps its own events until POO-1809 retires it
 * (see the header). The value exists so the series is separable the day that changes, which is the
 * one thing that cannot be added retroactively.
 */
export type FundingBuyRail = "paybis" | "privy";

/** What every event in the family carries. */
export interface FundingBuyContext {
  rail: FundingBuyRail;
  /**
   * OUR intent id, or `null` when the adapter refused before minting one. Never a provider
   * reference: see the header.
   */
  attemptId: string | null;
  /** ISO-4217, the currency the buyer is charged in. */
  fiatCurrency: string;
}

/** The classifier's verdict, carried so a funnel row says what we knew at the time. */
export type FundingBuyMoved = "no" | "maybe" | "confirmed";

/** The figures the buffer measurement needs, all USD. */
export interface FundingBuyFigures {
  requestedUsd: number;
  /**
   * What we actually put in the provider's amount field, buffer included.
   *
   * OPTIONAL, and absent rather than `0` when we prefilled nothing: a non-USD buyer is sent no
   * `defaultAmount` at all, and a zero would land in the buffer series as a real figure. See the
   * header.
   */
  prefillUsd?: number;
  /** The OBSERVED delta. Never the requested or prefilled figure. */
  deliveredUsd: number;
}

/**
 * [R1] The Privy-era error codes, one per classifier reason, so an `error_code` on a funnel row
 * means exactly one thing.
 *
 * Mapped 1:1 and not folded: `popup_blocked` and `not_authenticated` are both hard noes and they
 * call for opposite fixes, so a shared code would make the two indistinguishable in exactly the
 * report that would otherwise tell us which one is happening.
 */
export const ONRAMP_REASON_CODES: Readonly<Record<string, string>> = {
  // The invalid-destination family: we sent something the SDK rejected before opening anything.
  invalid_destination_address: "ONRAMP_INVALID_DESTINATION_ADDRESS",
  invalid_destination_chain: "ONRAMP_INVALID_DESTINATION_CHAIN",
  invalid_destination_asset: "ONRAMP_INVALID_DESTINATION_ASSET",
  // The buyer is not signed in, so no checkout can be opened for them.
  not_authenticated: "ONRAMP_NOT_AUTHENTICATED",
  // A purchase is already open. A hard no for THIS call, which opened nothing.
  flow_already_open: "ONRAMP_FLOW_ALREADY_OPEN",
  // We passed an empty supported-currency list, which is our bug, not the provider's.
  empty_fiat_assets: "ONRAMP_EMPTY_FIAT_ASSETS",
  no_funding_config: "ONRAMP_NO_FUNDING_CONFIG",
  // The browser refused the window, usually because an await crept in before the call.
  popup_blocked: "ONRAMP_POPUP_BLOCKED",
  // The adapter's own refusals, before the SDK is reached: no currency at all, or one outside the
  // rail's own union (`classifyAddFundsOutcome.ts`, `MISSING_DEFAULT_ASSET_REASON` and
  // `UNSUPPORTED_FIAT_ASSET_REASON`). Two decisions WE made, so they are two codes.
  missing_default_asset: "ONRAMP_MISSING_DEFAULT_ASSET",
  unsupported_fiat_asset: "ONRAMP_UNSUPPORTED_FIAT_ASSET",
  // Not the adapter's, and not the provider's: the deposit host's checkout has no destination to
  // watch (`DepositPrivyCheckout.tsx`). Ours, and unreachable while Base ships, but it reaches the
  // same `error_code` field and an unmapped one there would report `ONRAMP_UNMAPPED` for a bug we
  // already named.
  destination_unavailable: "ONRAMP_DESTINATION_UNAVAILABLE",
  // The inconclusive exit: the buyer closed the surface and we do not know what happened.
  user_exited: "ONRAMP_USER_EXITED",
  // The other inconclusive exit, and it sits beside `user_exited` for the same reason: the provider
  // surface never settled AT ALL, so the visible wait gave up after its bound (POO-1923 [R2],
  // `PROVIDER_TIMEOUT_MS`). Not a refusal, because we do not know whether the card was charged.
  provider_timeout: "ONRAMP_PROVIDER_TIMEOUT",
  unknown_error: "ONRAMP_UNKNOWN_ERROR",
  unknown_success_status: "ONRAMP_UNKNOWN_SUCCESS_STATUS",
};

/**
 * The code for a classifier reason, or a namespaced fallback.
 *
 * The fallback is deliberate rather than a throw: a provider that adds a rejection message must not
 * be able to break a purchase through the analytics path, and an `ONRAMP_UNMAPPED` in a report is
 * itself the signal that this table needs an entry.
 */
export function onRampErrorCode(reason: string): string {
  return ONRAMP_REASON_CODES[reason] ?? "ONRAMP_UNMAPPED";
}

/** The four emitters, bound to the one `track` every surface in this app uses. */
export interface FundingBuyFunnel {
  /** The checkout was asked to open. Not a purchase yet, and not a gesture: the call itself. */
  started: (context: FundingBuyContext) => void;
  /**
   * The provider CLAIMED it charged. Named `submitted`, never `completed`: funds take minutes and
   * this says nothing about money existing.
   */
  submitted: (context: FundingBuyContext, moved: FundingBuyMoved) => void;
  /** A hard no. Carries the mapped code so the reason survives into the report. */
  failed: (context: FundingBuyContext, reason: string) => void;
  /** [R4] The OBSERVED delta arrived. The only honest money-in number in the repository. */
  settled: (context: FundingBuyContext, figures: FundingBuyFigures) => void;
}

/** Shared params, so the four rows join on the same keys. */
function baseParams(context: FundingBuyContext) {
  return {
    rail: context.rail,
    fiat_currency: context.fiatCurrency,
    ...(context.attemptId ? { attempt_id: context.attemptId } : {}),
  };
}

export function useFundingBuyFunnel(): FundingBuyFunnel {
  const { track } = useAnalytics();
  const started = useCallback(
    (context: FundingBuyContext) => track("funding_buy_started", baseParams(context)),
    [track],
  );
  const submitted = useCallback(
    (context: FundingBuyContext, moved: FundingBuyMoved) =>
      track("funding_buy_submitted", { ...baseParams(context), moved }),
    [track],
  );
  const failed = useCallback(
    (context: FundingBuyContext, reason: string) =>
      track("funding_buy_failed", {
        ...baseParams(context),
        reason,
        error_code: onRampErrorCode(reason),
      }),
    [track],
  );
  const settled = useCallback(
    (context: FundingBuyContext, figures: FundingBuyFigures) =>
      track("funding_buy_settled", {
        ...baseParams(context),
        requested_usd: figures.requestedUsd,
        // Omitted, never zeroed: see the header. `undefined` would still create the key.
        ...(figures.prefillUsd === undefined ? {} : { prefill_usd: figures.prefillUsd }),
        delivered_usd: figures.deliveredUsd,
        // GA4 wants a `value` with a `currency`, and the honest one is what ARRIVED.
        value: figures.deliveredUsd,
        currency: "USD",
      }),
    [track],
  );
  return useMemo(
    () => ({ started, submitted, failed, settled }),
    [started, submitted, failed, settled],
  );
}
