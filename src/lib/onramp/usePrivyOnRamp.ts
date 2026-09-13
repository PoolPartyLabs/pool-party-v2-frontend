/**
 * @id PP-CORE-HOK-035 (POO-1803, POO-1926, POO-1923, POO-1928)
 * @name usePrivyOnRamp
 * @implements-rules-version v4 (POO-1928 rules v1) · v3 (POO-1923 rules v1) · v2 (POO-1926 rules
 *   v1) · v1 (POO-1803 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * @analytics-events none, this module CALLS the shared funding-buy emitter (`PP-CORE-LIB-111`) and
 *   pushes nothing itself, the same way `ProvisioningPanel` calls `provisioningFunnel`.
 *
 * POO-1813 [R3]: three of the four rows originate here, and only three, because this is the one
 * place that knows the checkout was asked to open (`started`) and what the provider claimed on the
 * way out (`submitted` or `failed`). `settled` is deliberately NOT one of them: it is the observed
 * balance delta, which this module never sees, and the hosts report it through the SAME module so
 * the family still has one emitter rather than one per surface.
 *
 * One adapter opens the checkout, whichever rail is behind it. Born with two rails in mind: the ADR
 * is explicit that a second rail is a SECOND rail, never a replacement, so nothing here names Privy
 * in its input or output types.
 *
 * ## The contract, quoted from the shipped types
 *
 * `@privy-io/react-auth@3.40.0`, `dist/dts/index.d.ts:3108-3152`:
 *
 * ```ts
 * type AddFundsDestination = {
 *     address: string;
 *     chain: `${string}:${string}`;   // CAIP-2, e.g. "eip155:8453"
 *     asset: string;                  // "Destination token address."
 * };
 * type AddFundsFiatOptions = {
 *     source?: { assets?: SupportedFiatCurrency[]; defaultAsset?: SupportedFiatCurrency };
 *     environment?: FiatOnrampEnvironment;
 *     defaultAmount?: string;
 * };
 * type AddFundsResult =
 *   | { method: 'fiat'; status: 'submitted' | 'confirmed' }
 *   | { method: 'crypto'; status: 'completed' };
 * type UseAddFundsResult = { addFunds: (opts: AddFundsOptions) => Promise<AddFundsResult> };
 * declare const useAddFunds: () => UseAddFundsResult;
 * ```
 *
 * `useAddFunds` carries `@experimental This interface may change at any time.` in those same shipped
 * types (`dist/dts/index.d.ts:3151`). That is the reason this file exists as an adapter at all: one
 * module absorbs a signature the vendor reserves the right to change, and the hosts never see it.
 *
 * **`crypto` is never passed.** Omitting it is what skips Privy's own method chooser and takes the
 * buyer straight to the fiat flow (migration plan section 1). The SDK's own guard confirms the
 * shape: `if(!n.fiat && !n.crypto) throw ...`, so fiat alone is a supported call, not a trick.
 *
 * ## [R1] `defaultAsset` is ALWAYS passed, and the adapter refuses to open without it
 *
 * Omitting it does not throw. Privy falls back to a `navigator.language` rule, which is precisely
 * the source POO-1512 [R5] forbids as a currency oracle, and the buyer is shown a plausible wrong
 * currency with no error anywhere. A silent failure that looks like a correct answer cannot be
 * caught downstream, so it is caught here: no `defaultAsset`, no call, and a hard `no` outcome.
 *
 * ## [R3] the call is SYNCHRONOUS inside the click handler
 *
 * MoonPay, Coinbase and Meld all open a top-level popup. A browser only allows that from inside the
 * user gesture's own synchronous turn, so anything awaited before `addFunds` costs the buyer the
 * popup, silently. Two consequences shape this file: `openCheckout` performs no `await` before the
 * call, and the intent mint it does perform first is deliberately synchronous (`localStorage`).
 *
 * The mint goes first anyway, and the order matters: a popup that opens must never be able to exist
 * without a record, because after 3.40.0 an inconclusive exit is the normal case and the record is
 * the only thing that survives it.
 *
 * ## [R4] one question, three answers
 *
 * `classifyAddFundsOutcome` (`PP-CORE-LIB-109`) owns it, as a pure function with the evidence table
 * in its header, and this hook maps the answer onto the intent record.
 *
 * With ONE exception, and it is deliberate: POO-1923 [R2]'s timeout verdict is minted here, because
 * the classifier is a pure function over a SETTLED call and a wait that timed out is by definition
 * not settled. So this file answers the question exactly once, for the one case the classifier
 * cannot see. Folding it in would mean a third `SettledAddFunds` variant and a contract change on
 * `PP-CORE-LIB-109`; that is a redesign, not a review fix, and it is recorded on POO-1923.
 *
 * ## What this adapter never does
 *
 * It never resolves a settled or delivered figure: the on-chain delta is the sole authority
 * (ADR-0004) and observing it is POO-1804's. It never renders copy, never reads a feature flag (the
 * host picks the rail, through POO-1800), and never touches `buildOnRampSteps`, `ProvisioningOrder`
 * or `runOnRampBuy`. The host wiring is POO-1807/1808.
 *
 * It does drop ONE Sentry breadcrumb per classified outcome, which is not the same thing: a
 * breadcrumb is attached to an event somebody else sends, carries three fields we minted, and exists
 * because every path here RESOLVES. It rides beside the GA4 row rather than instead of it: an
 * incident and a funnel are different readers.
 *
 * POO-1926 [R1] added the durable half, because a breadcrumb alone never was one: every classified
 * outcome ALSO ships exactly one allow-listed line to the first-party ingest
 * (`shipClientErrorReport` → `POST /api/client-error`), so a clean failure and a success both leave
 * a record the breadcrumb could not.
 */
"use client";

import { useAddFunds } from "@privy-io/react-auth";
import { addBreadcrumb } from "@sentry/nextjs";
import { useCallback } from "react";
import { useFundingBuyFunnel } from "@/lib/analytics/fundingBuyFunnel";
// POO-1926: the first-party ingest, the same rail `reportClientError` uses. `shipClientErrorReport`
// is the non-error sender: this reports an OUTCOME, including a successful one, so there is no
// `Error` to reduce and nothing belongs in Sentry Issues.
import { currentPath, shipClientErrorReport } from "@/lib/observability/reportClientError";
import {
  type AddFundsClassification,
  classifyAddFundsOutcome,
  MISSING_DEFAULT_ASSET_REASON,
  type MoneyMoved,
  type ProviderStatus,
  UNSUPPORTED_FIAT_ASSET_REASON,
} from "./classifyAddFundsOutcome";
import type { OnRampDestination } from "./destinations";
import { PRIVY_FIAT_CURRENCIES } from "./fiatCurrencies";
import { mintOnRampIntent, ONRAMP_INTENT_OPEN_WINDOW_MS, updateOnRampIntent } from "./onRampIntent";

/**
 * The fiat options `addFunds` actually accepts, derived from the installed SDK's own signature.
 *
 * The currency codes are typed as a `SupportedFiatCurrency` union the package does not export, so a
 * cast at this boundary is unavoidable. Deriving it from `addFunds` rather than writing `as never`
 * keeps the cast honest: it narrows to whatever THIS version declares, and the day the union moves,
 * the compiler has something to disagree with.
 */
type AddFundsFiat = NonNullable<Parameters<ReturnType<typeof useAddFunds>["addFunds"]>[0]["fiat"]>;
type FiatSourceAssets = NonNullable<AddFundsFiat["source"]>["assets"];
type FiatDefaultAsset = NonNullable<AddFundsFiat["source"]>["defaultAsset"];

/** The breadcrumb category every on-ramp outcome lands under, so one incident reads as one story. */
const ONRAMP_BREADCRUMB_CATEGORY = "onramp";

/**
 * POO-1926 [R1]: the ingest token, extracted for the same reason `ONRAMP_BREADCRUMB_CATEGORY` is,
 * so the spec asserts the name this module actually sends instead of restating the literal.
 *
 * Deliberately three segments where the rest of this rail uses two (`onramp.paybis_capture`): the
 * real-money probe of 2026-09-12 is already recorded under this exact token, and renaming it would
 * split the retrieval from the two lines that made POO-1923 diagnosable.
 */
export const ONRAMP_OUTCOME_EVENT = "onramp.privy.outcome";

/**
 * The spend amount as a money string, rounded to whole cents.
 *
 * `defaultAmount` is a `string` that Privy writes straight into the modal's amount state and into
 * its quotes body (`index-rkoxGjIC.mjs` @ 399615 and @ 400200) with no sanitiser of its own, so a
 * float artifact reaches both the buyer's eyes and the provider's quote verbatim: a caller that
 * computes `43.5 * 1.007` hands over `43.785000000000004`. Same rounding as `toFiatAmount`
 * (`sizeOnRampOrder.ts:179-181`), private there and inlined here: two boundaries, one line each, no
 * shared module worth the coupling.
 */
function toMoneyString(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/**
 * What the caller hands the adapter. Rail-neutral on purpose: nothing here names a provider, so a
 * second rail can implement the same input.
 */
export interface PrivyOnRampInput {
  /** Chain and token, in the rail's vocabulary (`usdcDestination`, `PP-CORE-LIB-106`). */
  destination: OnRampDestination;
  /**
   * The wallet that receives the funds. Separate from {@link destination} because that type is about
   * WHAT and WHERE, and this is WHO; the SDK's `AddFundsDestination` merges the two and this adapter
   * is where they meet. It is also the intent record's owner key, so a second wallet in the same
   * browser profile cannot reconcile against this one's purchase.
   */
  address: string;
  /** What the buyer asked for, before any buffer. Recorded, never sent. */
  requested: { amount: number; currency: string };
  /**
   * What the caller decided to actually pass, buffer included. The adapter never computes a buffer
   * and never applies a rate: it forwards a decision somebody else made and records both figures so
   * the difference stays measurable.
   */
  prefill: { amount: number; currency: string };
  /**
   * [R2]: `assets` is forwarded EXACTLY as given. The probed-green set is POO-1805's to compute;
   * narrowing it here would put a second opinion of coverage in the tree.
   */
  fiat: { defaultAsset: string; assets: readonly string[] };
  /**
   * A plain input, not a lookup. The caller reads POO-1800's resolver; an adapter that resolved its
   * own environment could disagree with the host about which one the purchase is on.
   */
  environment: "production" | "sandbox";
  /**
   * The destination balance as it stood BEFORE the modal opened, in base units, as a decimal string
   * with its own `decimals`. The observation window's zero mark: a delta is a subtraction, and the
   * subtrahend has to be read before the buyer can spend, not after (ADR-0004).
   *
   * Supplied by the host rather than read here, because the host already holds it: both surfaces
   * read the destination balance to decide whether a purchase is needed at all, and a second read
   * inside the adapter would be a different instant and an `await` before the popup ([R3]).
   *
   * A base-unit STRING, never a number: a USDC balance past ~9e15 base units is not float-safe, and
   * `Number.prototype.toString` switches to exponent notation under 1e-6 (the failure POO-1573 [R3]
   * and the sources-drop incident both landed on).
   */
  baseline: { raw: string; decimals: number };
}

/** What the hosts and the watcher receive. */
export interface PrivyOnRampOutcome {
  /**
   * The intent record's key, or `null` when the adapter refused before minting one. `null` means
   * there is nothing to observe and nothing to reconcile: no surface ever opened.
   */
  attemptId: string | null;
  moved: MoneyMoved;
  reason: string;
  providerStatus?: ProviderStatus;
  /** The raw rejection, for diagnostics. Never interpreted by the caller. */
  error?: unknown;
}

/** The phase an outcome puts the intent into, and whether that phase is terminal. */
function phaseFor(moved: MoneyMoved): {
  phase: "confirmed" | "exited" | "failed";
  terminal: boolean;
} {
  if (moved === "confirmed") return { phase: "confirmed", terminal: false };
  // A `maybe` is NOT terminal: the observation window owns it from here (ADR-0006), and closing it
  // now is exactly the "cancelled over a charged card" this whole epic exists to stop.
  if (moved === "maybe") return { phase: "exited", terminal: false };
  return { phase: "failed", terminal: true };
}

/**
 * POO-1926 [R1]: every classified outcome of a fiat attempt, as a durable server-side line.
 *
 * There is already a Sentry BREADCRUMB at the classified-outcome point, and a breadcrumb is not a
 * record: it only ships attached to a later event, so an attempt that fails cleanly, or succeeds,
 * leaves no trace anywhere. That is exactly the hole PR 955's F4 flagged ("traceId always null; add
 * a breadcrumb or state the hosts own it") and it was deferred. On the one path that charges a card,
 * "we cannot tell you what happened" is not an acceptable answer to an incident.
 *
 * [R2] WHAT IS SENT is ours and non-identifying: an attempt id we minted, a classification, a slug,
 * the charge currency and which vendor environment was addressed. No amount, no wallet address, no
 * email. [R3] The provider's own rejection text is NOT forwarded, here or anywhere: it is raw vendor
 * prose and may carry anything, and it stays on the returned outcome for local diagnosis only.
 *
 * [R5] Every field is in `/api/client-error`'s allow-list, verified against the route rather than
 * assumed, so nothing is silently dropped on arrival. Note what that allow-list is NOT: an accepted
 * field is logged through `logWarn`, which also ships it to Sentry LOGS, so a field added here
 * reaches a third-party store too. Allow-listed is not the same as first-party-only, and the next
 * field belongs to that question before it belongs to this one.
 *
 * [R4] `environment` matters more than it looks: sandbox and production failures are
 * indistinguishable in a log line without it, and the two have completely different remedies.
 */
function reportOnRampOutcome(fields: {
  attemptId: string | null;
  moved: MoneyMoved;
  reason?: string;
  fiatCurrency: string;
  environment: "production" | "sandbox";
}): void {
  shipClientErrorReport({
    event: ONRAMP_OUTCOME_EVENT,
    // Unconditional, as on the rail's two other senders (`reportClientError.ts:219`,
    // `paybisCapture.ts:397`): `currentPath()` is a `window.location.pathname` read that cannot
    // disagree with itself inside one turn, and the route already skips an undefined value.
    path: currentPath(),
    category: fields.moved,
    ...(fields.reason === undefined ? {} : { reason: fields.reason }),
    asset: fields.fiatCurrency,
    surface: fields.environment,
    ...(fields.attemptId === null ? {} : { reference: fields.attemptId }),
  });
}

/**
 * POO-1928 [R2]: how much of the openness window is left unspent, so the verdict lands INSIDE it.
 *
 * What it has to cover is the interval between the timer resolving and `updateOnRampIntent`
 * finishing its `localStorage` read-modify-write (a `getItem`, a Zod parse of up to
 * `ONRAMP_INTENT_MAX_RECORDS` records, a `setItem`), plus whatever React does with the resolved
 * outcome on the way. That work is sub-millisecond, so it is NOT what sizes this.
 *
 * ONE MINUTE, because the real term is the timer FIRING LATE, and in this flow that is the normal
 * case rather than the tail. `setTimeout` promises a floor, never a ceiling: the provider's surface
 * takes focus for the whole wait, so our tab is hidden and silent for exactly the period being
 * timed, and a hidden silent tab has its already-scheduled timers clamped to roughly one wake per
 * minute (Chrome's intensive throttling, from five minutes hidden). A timer of this length in that
 * regime can resolve up to about a wake period after its nominal deadline. A margin smaller than
 * that puts the verdict back outside the window on precisely the buyer this issue is about, and a
 * one-millisecond margin would satisfy [R3]'s arithmetic while buying none of it.
 *
 * So: one full throttled wake period as the bound on lateness, and because the write it shares that
 * budget with costs microseconds, effectively the whole sixty seconds stands against the lateness.
 * The cost is stated rather than hidden, because the window is fixed and this is subtracted from it:
 * the backstop is fourteen minutes instead of fifteen. That does not change its character, since it
 * is a stuck-state backstop and not an interaction timeout, and fourteen minutes still outlasts card
 * entry and 3DS by a wide margin.
 */
export const PROVIDER_TIMEOUT_MARGIN_MS = 60 * 1000;

/**
 * POO-1923 [R2]: the bound on Privy's own promise.
 *
 * `await pending` had none, so a provider surface that never resolves left this hook awaiting
 * forever: no outcome, no intent update, no report, and a spinner the buyer cannot escape. Observed
 * on real money on 2026-09-12, where the provider page loaded indefinitely after an abandoned
 * attempt had left a dead transaction behind.
 *
 * MINUTES RATHER THAN SECONDS, and the size is the whole point. This is NOT an interaction
 * timeout: the buyer legitimately spends minutes inside the provider's surface entering a card,
 * clearing 3DS and confirming, and Privy's own copy says funds "should arrive within a few minutes".
 * A short bound would abort real purchases, which is a worse defect than the one it fixes. It is a
 * STUCK-STATE BACKSTOP for the case where the promise neither resolves nor rejects at all: a buyer
 * who closes the surface gets a rejection (`User exited flow`), so silence for this long means the
 * flow is wedged rather than slow.
 *
 * It sits inside ADR-0006's 30-minute passive window on purpose, so the visible phase gives up
 * before the passive one does and the handover is ordered rather than racing.
 *
 * ## POO-1928 [R1]: DERIVED from the openness window, never restated
 *
 * This was `15 * 60 * 1000` written out, which was EXACTLY `ONRAMP_INTENT_OPEN_WINDOW_MS`, and
 * `isStillOpen` (`onRampIntent.ts`) bounds an open record with a strict `<` against the `createdAt`
 * the intent is stamped with immediately before `addFunds`. So the instant this bound fired was the
 * same instant `findOpenOnRampIntent` stopped returning the record: the `provider_timeout` verdict
 * landed on a record no reader would hand back, and because a `maybe` deliberately leaves
 * `outcome: null` ({@link phaseFor}) there was no age bound left that would ever reconcile it. The
 * record did not become WRONG, it became PERMANENT, which is the state POO-1833's cross-session
 * resume would have inherited from us.
 *
 * The direction of the derivation is forced rather than chosen: this module imports `onRampIntent`
 * and that module imports nothing from here, so deriving the bound here introduces no cycle and
 * deriving the window there would. The ordering is pinned as an invariant in the spec ([R3]) because
 * the failure mode is a future EDIT to either number in isolation, which no behavioural test sees.
 *
 * What this does NOT do is retune the window. POO-1384 set 15 minutes and the `PP-NOTE` on
 * `ONRAMP_INTENT_OPEN_WINDOW_MS` says plainly that it is inherited rather than measured; narrowing
 * it is a separate, evidence-led change. This only makes the ORDERING structural, so either number
 * can move later without silently reopening the race.
 */
export const PROVIDER_TIMEOUT_MS = ONRAMP_INTENT_OPEN_WINDOW_MS - PROVIDER_TIMEOUT_MARGIN_MS;

/**
 * `maybe`, and never `no`. A timeout means we DO NOT KNOW whether the card was charged, and
 * ADR-0006 forbids rendering an inconclusive exit as a cancellation. This slug routes into the
 * observation window exactly as `user_exited` does.
 */
export const PROVIDER_TIMEOUT_REASON = "provider_timeout";

/**
 * Open the fiat checkout and report one classified outcome.
 *
 * Never throws. Every path resolves, because the caller is a click handler with no way to classify a
 * raw SDK rejection, and a throw there would surface as an unhandled error over a purchase that may
 * have succeeded.
 */
export function usePrivyOnRamp(): {
  openCheckout: (input: PrivyOnRampInput) => Promise<PrivyOnRampOutcome>;
} {
  // POO-1813 [R3]: the shared emitter, so this adapter reports the three moments it can see and the
  // hosts report the one it cannot.
  const funnel = useFundingBuyFunnel();
  // PP-INTEGRATION-POINT: Privy's fiat checkout. `useAddFunds` opens the provider's own surface and
  // resolves only with the provider's CLAIM about the charge, never a delivered figure.
  const { addFunds } = useAddFunds();

  const openCheckout = useCallback(
    async (input: PrivyOnRampInput): Promise<PrivyOnRampOutcome> => {
      /**
       * POO-1813 [R4]: `fiat_currency` is the currency the buyer is CHARGED in, which is
       * `fiat.defaultAsset` and never `prefill.currency`.
       *
       * The two disagree on every non-USD purchase: the prefill is a USD figure this rail sizes in
       * dollars and then declines to send (see `prefillIsInDefaultAsset` below), while the card is
       * charged in the buyer's own money. Reporting the sizing currency would put "USD" on a series
       * of euro charges, which is POO-1512's defect with an analytics label on it.
       */
      const fiatCurrency = (input.fiat?.defaultAsset ?? input.prefill.currency).toUpperCase();

      // [R1] before anything, including the mint: a call we refuse is not an attempt.
      if (!input.fiat?.defaultAsset) {
        // POO-1926 [R1] the durable line FIRST, and before `funnel.failed`: the GA4 emitter ends in
        // `window.dataLayer.push`, which GTM replaces with its own function and which carries no
        // try/catch here, so reporting behind it would let an emitter throw eat the record. Same
        // order as the classified-outcome point below.
        // No attempt id: nothing was minted and no surface opened, so there is nothing to join to.
        reportOnRampOutcome({
          attemptId: null,
          moved: "no",
          reason: MISSING_DEFAULT_ASSET_REASON,
          fiatCurrency,
          environment: input.environment,
        });
        funnel.failed(
          { rail: "privy", attemptId: null, fiatCurrency },
          MISSING_DEFAULT_ASSET_REASON,
        );
        return { attemptId: null, moved: "no", reason: MISSING_DEFAULT_ASSET_REASON };
      }
      // [R1] and present is not the same as sellable. `PRIVY_FIAT_CURRENCIES` (`PP-CORE-LIB-106`)
      // is the rail's own union, transcribed from its shipped types; a code outside it is refused
      // by the SDK as `Invalid input` prose on the buyer's screen, over a decision we were holding
      // the whole time.
      if (!PRIVY_FIAT_CURRENCIES.has(input.fiat.defaultAsset)) {
        reportOnRampOutcome({
          attemptId: null,
          moved: "no",
          reason: UNSUPPORTED_FIAT_ASSET_REASON,
          fiatCurrency,
          environment: input.environment,
        });
        funnel.failed(
          { rail: "privy", attemptId: null, fiatCurrency },
          UNSUPPORTED_FIAT_ASSET_REASON,
        );
        return { attemptId: null, moved: "no", reason: UNSUPPORTED_FIAT_ASSET_REASON };
      }

      // [R3] synchronous, and first: `mintOnRampIntent` writes to `localStorage` and returns.
      //
      // The record is wallet-scoped (`PP-CORE-LIB-107`), so the address goes in as the owner rather
      // than only into the SDK call: one browser profile holds several wallets and an unscoped
      // record would offer wallet B a reconcile against wallet A's purchase. `mintOnRampIntent`
      // lowercases it, so checksum casing is fine here.
      const intent = mintOnRampIntent({
        wallet: input.address,
        requested: input.requested,
        prefill: input.prefill,
        destination: input.destination,
        baselineRaw: input.baseline.raw,
        decimals: input.baseline.decimals,
      });

      // `defaultAmount` carries no currency of its own: the rail reads it in `source.defaultAsset`
      // (`dist/dts/index.d.ts:3116-3122`). A figure sized in one currency and spent in another is a
      // wrong charge wearing a prefill's clothes, so when the two disagree the amount is dropped
      // from the CALL and the buyer types their own. It stays on the record either way, because
      // measuring the spread (POO-1811) needs what we asked for, not what we managed to send.
      const prefillIsInDefaultAsset =
        input.prefill.currency.toUpperCase() === input.fiat.defaultAsset.toUpperCase();

      // [R3] NO `await` between the gesture and here, or the browser blocks the popup.
      const pending = addFunds({
        destination: {
          address: input.address,
          // No cast: `OnRampDestination.chain` is the same template literal the SDK demands
          // (`destinations.ts:49`), which is why POO-1801 typed it that way.
          chain: input.destination.chain,
          asset: input.destination.asset,
        },
        fiat: {
          source: {
            // POO-1801 owns the vocabulary that produces these codes, so the one cast the unexported
            // union forces is at this boundary and nowhere else.
            assets: [...input.fiat.assets] as FiatSourceAssets,
            defaultAsset: input.fiat.defaultAsset as FiatDefaultAsset,
          },
          environment: input.environment,
          ...(prefillIsInDefaultAsset
            ? { defaultAmount: toMoneyString(input.prefill.amount) }
            : {}),
        },
      });

      updateOnRampIntent(intent.attemptId, { phase: "opened" });
      // [R3] `started` is the CALL, not the gesture and not a purchase: the checkout was asked to
      // open, which is the denominator every later rate is measured against. After `addFunds`, so a
      // browser that blocks the popup still produces the row it then fails against.
      const context = { rail: "privy" as const, attemptId: intent.attemptId, fiatCurrency };
      funnel.started(context);

      // The bound, and the reason it is a race rather than an `AbortSignal`: `addFunds` takes no
      // signal, so the promise cannot be cancelled. We stop WAITING on it; if it settles later the
      // observation window is already watching the chain, which is the authority anyway (ADR-0004).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = Symbol("privy-onramp-timeout");
      const bounded = await Promise.race([
        pending
          .then((result) => ({ ok: true as const, result }))
          .catch((error: unknown) => ({ ok: false as const, error })),
        new Promise<typeof timedOut>((resolve) => {
          timer = setTimeout(() => resolve(timedOut), PROVIDER_TIMEOUT_MS);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);

      const verdict: AddFundsClassification =
        bounded === timedOut
          ? { moved: "maybe", reason: PROVIDER_TIMEOUT_REASON }
          : classifyAddFundsOutcome(bounded);
      const { phase, terminal } = phaseFor(verdict.moved);
      updateOnRampIntent(intent.attemptId, {
        phase,
        ...(terminal ? { outcome: "failed" as const } : {}),
      });

      // Every classified path RESOLVES, so without this an exit that may have charged a card leaves
      // no trace in an incident. The three fields are ours: an attempt id, a class and a slug. The
      // rejection's own message is raw provider text and is not forwarded, here or anywhere.
      addBreadcrumb({
        category: ONRAMP_BREADCRUMB_CATEGORY,
        level: "info",
        data: { attemptId: intent.attemptId, moved: verdict.moved, reason: verdict.reason },
      });

      // POO-1926 [R1]: the third and last report point, the only one an attempt with a minted
      // intent reaches. One attempt produces exactly one line, because both refusals returned.
      reportOnRampOutcome({
        attemptId: intent.attemptId,
        moved: verdict.moved,
        ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
        fiatCurrency,
        environment: input.environment,
      });

      // [R3]/[R4] The provider's CLAIM, or a hard no. Neither is money: `settled` is the hosts' to
      // emit, from the observed delta, and naming this one `submitted` is what keeps the two apart.
      if (verdict.moved === "no") funnel.failed(context, verdict.reason);
      else funnel.submitted(context, verdict.moved);

      return {
        attemptId: intent.attemptId,
        moved: verdict.moved,
        reason: verdict.reason,
        ...(verdict.providerStatus ? { providerStatus: verdict.providerStatus } : {}),
        // A timeout carries no `error`: there is no rejection to forward, which is precisely what
        // distinguishes it from an exit. Callers branch on `reason`, never on the presence of this.
        ...(bounded !== timedOut && !bounded.ok ? { error: bounded.error } : {}),
      };
    },
    [addFunds, funnel],
  );

  return { openCheckout };
}
