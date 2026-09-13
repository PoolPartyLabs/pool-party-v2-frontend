/**
 * @id PP-CORE-HOK-025 (POO-1134, POO-1384, POO-1390, POO-1403, POO-1598)
 * @name useOnRampSettlement
 * @implements-rules-version v1 (POO-1598 rules v1) · v1 (POO-1403 rules v1) · v4 (POO-1390 rules v1) · v3 (POO-1384 / POO-1129 rules v4) · v2 (POO-1129 rules v2)
 *
 * The heart of the Paybis on-ramp epic: it embeds the widget and reconciles the purchase from the
 * OBSERVED wallet balance delta, which is the only authoritative figure.
 *
 * ## Why the delta, not the amount we requested ([R4])
 *
 * A Paybis quote only PRE-FILLS. Their docs are explicit that the user can change the amount and the
 * currency inside the widget, and the payment method (which can carry its own minimum) is chosen
 * there too. So neither the amount we requested nor the amount Paybis reports is a fact. The wallet
 * balance delta is, and it is stronger even than the webhook's figure because it is on-chain truth.
 * This hook snapshots the balance before opening, re-reads after `completed`, and returns the delta;
 * POO-1135/1136 size every downstream leg (swap / bridge / invest) from it.
 *
 * ## Which delta counts ([R4], scoped)
 *
 * "The delta is truth" means the PURCHASE's delta. The reconcile window runs up to ten minutes, and a
 * detector that settled on any growth anywhere would also settle on an unrelated inbound credit and
 * hand POO-1135 a figure that is not the purchase. So detection is scoped to the on-ramp chain
 * (`ONRAMP_CHAIN_ID`: Paybis sells only ETH and USDC on Base) and to the token the order actually
 * bought, taken as an INPUT ({@link OpenOnRampArgs.expectedToken}) because `sizeOnRampOrder`
 * (POO-1133) already decided it. See {@link selectPurchaseDeltas}.
 *
 * ## Settlement contract ([R5])
 *
 * `completed` (a postMessage, NOT a websocket) starts a bounded, backing-off poll for the delta.
 * `rejected` / `cancelled` / `error` terminate with the matching state, but ONLY while `completed`
 * has not been observed ({@link isBeforeCompleted}): afterwards the payment has already been made, so
 * a late widget event describes the widget's UI rather than the money, and aborting would retire an
 * intent whose funds may still be landing. `closed` follows the same rule and, with no terminal event,
 * stays RESUMABLE (the intent is not retired). The poll ceiling elapsing with no delta is the
 * existing `settling` phase (POO-1037), never a failure: the money may still be in flight.
 *
 * ## Two traps this hook is built around (both verified)
 *
 *   1. **No second poller / no second channel.** The wallet README forbids a background interval
 *      because each read fans out over three networks. This poll complies: it is event-initiated
 *      (started by `completed`), backs off, has a hard ceiling, and stops on any terminal event or a
 *      close. The app-wide invalidation channel {@link requestBalanceRefresh} is published EXACTLY
 *      ONCE at settlement and once per terminal state, never per poll tick (v1 and v2 share one
 *      per-API-key throttle bucket). The poll is only the DETECTOR; the channel does not return
 *      holdings. Mirrors the shipped `DepositScreen.tsx:241,275` publish precedent (POO-1128 [R5]).
 *   2. **False-zero baseline.** Before the SIWE handshake `getWalletHoldingsAction` returns `[]` (not
 *      null), which is not nullish and so bypasses the on-chain fallback too: an ungated baseline
 *      reads a silent zero and the delta becomes the whole wallet. So the baseline is taken THROUGH
 *      {@link useTokenBalances} (SIWE-gated, POO-1128) and the hook refuses to open without a session;
 *      an empty/unproven poll read (a cookie that expired mid-widget) is skipped, never settled on.
 *
 * PP-SECURITY (POO-1134): the message listener validates `event.origin` against the Paybis widget
 * origin ({@link isPaybisWidgetOrigin}) BEFORE trusting any event. Without it a `completed` spoofed by
 * any other frame on the page would advance the plan against a purchase that never happened.
 *
 * PP-INTEGRATION-POINT: the widget SDK is loaded by {@link PaybisWidgetScript} from
 * `NEXT_PUBLIC_PAYBIS_WIDGET_URL`; the `requestId` is minted server-side by `createOnRampRequestAction`
 * (POO-1132) and passed in — this hook never mints and never accepts a client-forged id.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { requestBalanceRefresh } from "@/lib/balances/balanceRefresh";
import type { TokenBalance } from "@/lib/balances/types";
import { useTokenBalances } from "@/lib/balances/useTokenBalances";
import { getWalletHoldingsAction } from "@/lib/balances/walletHoldingsActions";
import { reportClientError } from "@/lib/observability/reportClientError";
import {
  markOnRampPaid,
  markOnRampRequest,
  type OnRampRequestStatus,
  recordOnRampRequest,
} from "./onRampJournal";
import { breadcrumbPaybisMessage } from "./paybisBreadcrumbs";
import { capturePaybisMessage, startPaybisCapture, stopPaybisCapture } from "./paybisCapture";
import {
  getPartnerExchangeWidget,
  isPaybisWidgetOrigin,
  parsePaybisWidgetEvent,
  parsePaybisWidgetReason,
} from "./paybisWidget";
import {
  computeTokenDeltas,
  hasPositiveDelta,
  type OnRampCurrencyCode,
  selectPurchaseDeltas,
  type TokenDelta,
} from "./tokenDeltas";

/** First delay after `completed` before the first balance re-read (ms). */
export const POLL_INITIAL_DELAY_MS = 3_000;
/** The backoff ceiling per interval (ms): reads never space out further than this. */
export const POLL_MAX_DELAY_MS = 20_000;
/** Multiplier applied to the inter-read delay after each miss. */
export const POLL_BACKOFF = 1.5;
/** Hard total ceiling ([R5], ~10 min): past this with no delta the flow is `timed-out` (settling). */
export const POLL_CEILING_MS = 10 * 60 * 1000;

/**
 * The settlement lifecycle. `reconciling` is the post-`completed` poll; `settled` means a delta
 * appeared; `timed-out` is the [R5] settling phase (money may be in flight), NOT a failure; `closed`
 * is a resumable close with no terminal event; the last three mirror the widget's terminal events.
 */
export type OnRampSettlementStatus =
  | "idle"
  | "opening"
  | "open"
  | "reconciling"
  | "settled"
  | "timed-out"
  | "closed"
  | "rejected"
  | "cancelled"
  | "error";

/**
 * Whether `completed` has NOT been observed yet, i.e. the only window in which a widget lifecycle
 * event may still abort the flow. `reconciling` / `settled` / `timed-out` all mean money has been
 * paid, and after that the widget is no longer the authority on what happened to it.
 */
function isBeforeCompleted(status: OnRampSettlementStatus): boolean {
  return status === "opening" || status === "open";
}

/**
 * Run a diagnostics side effect so it can never reach the money path (POO-1598 [R6]).
 *
 * This is belt-and-braces TODAY, and deliberately so. Both sinks already wrap their whole body in
 * their own `try`/`catch` (`paybisBreadcrumbs.ts`, `paybisCapture.ts`), so no reachable throw is
 * being caught here right now: the stranding this prevents is LATENT, not a live bug, and nobody
 * should go hunting for it.
 *
 * It is here because of WHERE the calls sit rather than what they currently do. Each one is on a
 * branch that decides whether a purchase opens, settles or is torn down, so a diagnostic that threw
 * before `parsePaybisWidgetEvent` ran would strand a buyer who has already been charged. A callee's
 * internal `catch` is a promise the callee can revise; the guarantee that OBSERVATION NEVER GATES
 * THE MONEY belongs to the caller, because only the caller knows what is downstream of it. This is
 * the one place that does, so it is the one place the guarantee can actually be made.
 */
function observe(run: () => void): void {
  try {
    run();
  } catch {
    // Diagnostics, never a gate.
  }
}

/** What {@link useOnRampSettlement.open} needs. `wallet` scopes the [R7] journal (skipped if absent). */
export interface OpenOnRampArgs {
  /** The server-minted Paybis purchase id ({@link createOnRampRequestAction}). Never client-forged. */
  requestId: string;
  /** The empty element the widget renders into (embed mode). */
  container: HTMLElement;
  /**
   * The token this order buys, i.e. `sizeOnRampOrder`'s `order.currencyCode` (POO-1133). It scopes
   * the detector to the purchase's own growth ([R4], {@link selectPurchaseDeltas}), so an unrelated
   * credit landing inside the reconcile window cannot settle the flow. Required, and passed in rather
   * than inferred: the order already decided ETH-BASE vs USDC-BASE, so guessing here would be a
   * second, weaker answer to a question that is already settled.
   */
  expectedToken: OnRampCurrencyCode;
  /** The SIWE-session wallet, for the [R7] resumable-request journal. */
  wallet?: string;
}

/** The settlement surface a widget frame drives. */
export interface OnRampSettlement {
  /** Where the settlement is in its lifecycle. */
  status: OnRampSettlementStatus;
  /** The observed per-token balance increase ([R4]); empty until `settled`. */
  deltaByToken: TokenDelta[];
  /** Open the embedded widget for a server-minted `requestId`. */
  open: (args: OpenOnRampArgs) => void;
  /** Return to `idle` and detach, so a stale widget message can no longer settle. */
  reset: () => void;
  /**
   * POO-1371: is a trustworthy balance baseline available RIGHT NOW.
   *
   * The frame must WAIT on this before calling {@link open}, which refuses without one ([R4]: a
   * still-loading snapshot is a false zero, and a delta measured against it would attribute the
   * user's whole wallet to the purchase). Exposed so the frame can fold it into the bounded poll it
   * already runs, rather than `open()` growing a retry loop of its own ([R7] no second poller).
   */
  isBaselineReady: boolean;
  /**
   * POO-1390 [R3]: what the VENDOR said about a terminal state, when it said anything.
   *
   * `undefined` on every non-terminal state, and on a terminal one that carried no reason. The host
   * uses it to replace the generic "The purchase did not complete" with the actual cause; absent, the
   * generic copy stands ([R5]), so a vendor that stops sending payloads degrades rather than breaks.
   */
  terminalReason?: string;
}

/** Drives the embedded Paybis widget and reconciles the purchase from the balance delta. */
export function useOnRampSettlement(): OnRampSettlement {
  const { isSignedIn } = useSiweSession();
  const { balances, isLoading } = useTokenBalances();

  const [status, setStatus] = useState<OnRampSettlementStatus>("idle");
  /**
   * POO-1390 [R3]: the vendor's own words for WHY a terminal state happened, when it sent any.
   * Surfaced so the dialog can say what Paybis said instead of the generic sentence this app
   * invented. Cleared on every fresh open, so a new purchase can never inherit the last one's
   * failure text.
   */
  const [terminalReason, setTerminalReason] = useState<string | undefined>(undefined);
  const [deltaByToken, setDeltaByToken] = useState<TokenDelta[]>([]);

  // Latest render values, read by the imperative `open` so it stays stable yet never stale (the same
  // shape useSiweSession uses for its handshake helpers).
  const latest = useRef({ isSignedIn, isLoading, balances });
  latest.current = { isSignedIn, isLoading, balances };

  // Mutable flow state, kept in refs so the single message handler and the poll never read a stale
  // closure. `status` is mirrored so the handler can branch on the live value.
  const statusRef = useRef<OnRampSettlementStatus>("idle");
  const baselineRef = useRef<TokenBalance[]>([]);
  const expectedTokenRef = useRef<OnRampCurrencyCode | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const publishedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const delayRef = useRef(POLL_INITIAL_DELAY_MS);
  const handlerRef = useRef<((event: MessageEvent) => void) | null>(null);

  const setFlowStatus = useCallback((next: OnRampSettlementStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  /** Fire the app-wide balance invalidation exactly once per open() session. */
  const publishRefreshOnce = useCallback(() => {
    if (publishedRef.current) return;
    publishedRef.current = true;
    // PP-INTEGRATION-POINT: the app-wide balance invalidation channel (POO-1128). The header chip and
    // every other subscriber converge through it; this hook's own poll is the detector, not this.
    requestBalanceRefresh();
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const detach = useCallback(() => {
    clearTimer();
    if (handlerRef.current) {
      window.removeEventListener("message", handlerRef.current);
      handlerRef.current = null;
    }
    // POO-1598 S3: close the capture wherever the listener closes: settle, timeout, every terminal
    // event, reset and unmount all route through here, so the session-end record (and its observed
    // message count, which is how a reader knows the sequence is complete) cannot be missed on one
    // of them. Idempotent, and a no-op when no session is armed.
    observe(stopPaybisCapture);
  }, [clearTimer]);

  /** A poll read that never trusts a false zero: `[]`/null (unproven) is skipped, never settled on. */
  const readHoldings = useCallback(async (): Promise<TokenBalance[] | null> => {
    // PP-INTEGRATION-POINT: the connected wallet's holdings, server-derived from the SIWE session
    // (POO-815). NOT `getFundingInventoryAction`: that returns `[]` for both no-session and total
    // failure with no discriminator and is a filtered, truncated view, so a delta measured against it
    // under-reports (POO-1134 gate-lifted note).
    const holdings = await getWalletHoldingsAction();
    return holdings && holdings.length > 0 ? holdings : null;
  }, []);

  const settle = useCallback(
    (deltas: TokenDelta[]) => {
      detach();
      setDeltaByToken(deltas);
      setFlowStatus("settled");
      const requestId = requestIdRef.current;
      if (requestId) markOnRampRequest(requestId, "settled");
      publishRefreshOnce();
    },
    [detach, setFlowStatus, publishRefreshOnce],
  );

  const timeOut = useCallback(() => {
    detach();
    // [R5] Not a failure: the intent stays resumable (never marked terminal) because the money may
    // still be in flight. Upstream renders the existing POO-1037 `settling` phase.
    setFlowStatus("timed-out");
    publishRefreshOnce();
  }, [detach, setFlowStatus, publishRefreshOnce]);

  const terminate = useCallback(
    (event: OnRampRequestStatus, reason?: string) => {
      detach();
      setTerminalReason(reason);
      setFlowStatus(event);
      const requestId = requestIdRef.current;
      if (requestId) markOnRampRequest(requestId, event);
      /**
       * POO-1390 [R2]: this path used to record NOTHING.
       *
       * Of the three ways a purchase reaches `ONRAMP_ERROR`, the two that reported
       * (`onramp.open_refused`, below) are both guarded unreachable upstream — `PaybisWidgetFrame`
       * waits for `isBaselineReady` AND a callable `openInEmbed` before calling `open()`, and its own
       * give-up path yields `unavailable`. So the ONLY reachable cause was this one, and it was
       * silent: a production report (v1.3.0, reference a99f6fa428df4fff86f04e1cba8acbb6) resolved to
       * nothing in Sentry, because nothing had ever been filed.
       *
       * The reference a user quotes has to lead somewhere. This is what makes it lead here.
       */
      // [R4] `cancelled` is the user shutting their own order, which is INTENT and not a defect, so
      // it is excluded exactly as a user-rejected wallet prompt is. `IGNORED_ERRORS` would not have
      // caught it: the message reads "Paybis widget terminated: cancelled" and matches none of those
      // patterns. Abandonment is an ANALYTICS event class (premise 11), not an error-tracker one.
      if (event !== "cancelled") {
        reportClientError(
          "onramp.widget_terminal",
          new Error(`Paybis widget terminated: ${event}`),
          {
            status: event,
            ...(reason ? { vendorReason: reason } : {}),
          },
          /**
           * POO-1403 [R3]: the vendor's own purchase id, as an INDEXED tag.
           *
           * This is the event an operator lands on for a failed purchase, and it named the vendor's
           * STATE without naming the vendor's PURCHASE, so the pivot to Paybis' record still needed
           * the user to go and read their own localStorage. A tag and not a field: `extra` is stored
           * and not indexed, which is no help to someone searching an invoice number.
           */
          requestId ? { pp_paybis_request_id: requestId } : {},
        );
      }
      publishRefreshOnce();
    },
    [detach, setFlowStatus, publishRefreshOnce],
  );

  /** One poll tick: bail if the flow stopped, time out at the ceiling, else read + compare + reschedule. */
  const tick = useCallback(async () => {
    if (statusRef.current !== "reconciling") return;
    if (Date.now() - startedAtRef.current >= POLL_CEILING_MS) {
      timeOut();
      return;
    }
    let holdings: TokenBalance[] | null = null;
    try {
      holdings = await readHoldings();
    } catch {
      holdings = null; // a failed read is unproven, not a delta; keep polling.
    }
    // A terminal event or reset may have landed while awaiting.
    if (statusRef.current !== "reconciling") return;
    // [R4] Only the PURCHASE settles: growth on the on-ramp chain, in the token this order bought.
    // An unrelated inbound credit elsewhere in the wallet is not evidence of this purchase, and the
    // reconcile window is long enough (~10 min) for one to arrive.
    const expectedToken = expectedTokenRef.current;
    if (holdings && expectedToken) {
      const deltas = selectPurchaseDeltas(
        computeTokenDeltas(baselineRef.current, holdings),
        expectedToken,
      );
      if (hasPositiveDelta(deltas)) {
        settle(deltas);
        return;
      }
    }
    delayRef.current = Math.min(delayRef.current * POLL_BACKOFF, POLL_MAX_DELAY_MS);
    timerRef.current = setTimeout(tick, delayRef.current);
  }, [readHoldings, settle, timeOut]);

  const startReconcile = useCallback(() => {
    if (statusRef.current === "reconciling") return;
    // POO-1384 [R7]: the widget said `completed`, so the card was charged. Record it, because this is
    // the ONE observation that separates "paid, still landing" from "abandoned before paying", and
    // `findResumableOnRampRequest` needs the difference: it applies its resumable-age bound only to
    // the never-paid case. Without this, a timed-out purchase (which stays `open` precisely because
    // the money may still be moving, and a bank transfer can take hours) would expire on the timer
    // and the retry would mint a SECOND intent, which is the double charge this journal prevents.
    const requestId = requestIdRef.current;
    if (requestId) markOnRampPaid(requestId);
    setFlowStatus("reconciling");
    startedAtRef.current = Date.now();
    delayRef.current = POLL_INITIAL_DELAY_MS;
    clearTimer();
    timerRef.current = setTimeout(tick, POLL_INITIAL_DELAY_MS);
  }, [setFlowStatus, clearTimer, tick]);

  /** The single, origin-validated widget message handler. Stable; reads live flow state via refs. */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // PP-SECURITY: reject any frame that is not a Paybis widget origin before trusting the payload.
      if (!isPaybisWidgetOrigin(event.origin)) return;
      /**
       * POO-1404: record EVERY vouched message, before the parser drops the ones we do not model.
       *
       * The parser's allowlist is right for control flow and wrong for diagnosis: `showLoader`,
       * `payment-initiated`, `payout-waiting` and friends are exactly the steps a user walks
       * through before a checkout dies, and discarding them is why a report could say "it broke at
       * the payment step" while our telemetry said only "error". Breadcrumbs attach to an event
       * only when one is actually sent, so a session that succeeds costs nothing.
       */
      /**
       * POO-1598 S3: the same message, recorded a SECOND time for a different purpose.
       *
       * Not a duplicate and not a merge, deliberately. The breadcrumb is ALWAYS ON and attaches only
       * to a Sentry event that is actually SENT, so a purchase that SUCCEEDS - the exact run the
       * capture exists to record - leaves no breadcrumb anywhere. The capture is flag-gated,
       * session-armed, redacted by ALLOW-LIST because its output is destined for a committed
       * fixture, and shipped as an ordered sequence a human can read back. Fusing them would let the
       * flag-gated one break the always-on one, and would force one masking posture onto two jobs
       * that need opposite ones. What must NOT be duplicated is not: one listener, one origin check,
       * one envelope decoder (`describePaybisMessage`, shared).
       *
       * Each runs through its OWN {@link observe}, not one wrapping both. Two calls and not one is
       * the whole point: a single wrapper would make the sinks each other's single point of failure,
       * so a throw in the breadcrumb would silence the capture for that message (and vice versa),
       * which is exactly the coupling the paragraph above says these two must not have. Neither can
       * reach the branch below that decides whether a charged purchase settles.
       */
      observe(() => breadcrumbPaybisMessage(event.data));
      observe(() => capturePaybisMessage(event.data));
      const name = parsePaybisWidgetEvent(event.data);
      if (name === null) return;

      switch (name) {
        case "opened":
        case "loaded":
          if (statusRef.current === "opening") setFlowStatus("open");
          return;
        case "completed":
          startReconcile();
          return;
        case "rejected":
        case "cancelled":
        case "error":
          // Same guard as `closed`, for the same reason: once `completed` has been observed the
          // payment has already been made, so a later widget event describes the WIDGET'S UI, not the
          // money. The chain decides, not the widget. Aborting here would mark the journal record
          // terminal and non-resumable while the funds may still be landing, and the mint site
          // (POO-1135) would then mint a FRESH requestId for a purchase already paid for: a
          // double-charge shape.
          //
          // This is a deliberate clarification of [R5], whose literal text says terminal events
          // terminate. They do, in the window where they can still be true. Do not "fix" it back.
          if (!isBeforeCompleted(statusRef.current)) return;
          terminate(name, parsePaybisWidgetReason(event.data));
          return;
        case "closed":
          // A close AFTER `completed` must not abort settlement detection (the purchase already
          // happened). A bare close (no terminal event, not reconciling/settled) stays resumable.
          if (!isBeforeCompleted(statusRef.current)) return;
          detach();
          setFlowStatus("closed");
          return;
      }
    },
    [setFlowStatus, startReconcile, terminate, detach],
  );

  const reset = useCallback(() => {
    detach();
    publishedRef.current = false;
    requestIdRef.current = null;
    baselineRef.current = [];
    expectedTokenRef.current = null;
    setDeltaByToken([]);
    setTerminalReason(undefined);
    setFlowStatus("idle");
  }, [detach, setFlowStatus]);

  const open = useCallback(
    ({ requestId, container, expectedToken, wallet }: OpenOnRampArgs) => {
      const { isSignedIn: signedIn, isLoading: loading, balances: current } = latest.current;
      // [R4] No trustworthy baseline → refuse. A pre-SIWE / still-loading snapshot is a false zero,
      // and the delta measured against it becomes the whole wallet.
      if (!signedIn || loading) {
        // POO-1371: this branch used to be SILENT, and it is the one that fired in production. The
        // frame calls `open()` the instant the SDK and container are ready, while `useTokenBalances`
        // is still in flight (it refetches on focus, after every write, and on a 15s floor), so the
        // race is common rather than exceptional. `PaybisWidgetFrame` now waits for
        // `isBaselineReady` before calling, which should make this unreachable. It stays as a last
        // line of defence, because opening against a false-zero baseline would attribute the user's
        // WHOLE WALLET to the purchase ([R4]).
        reportClientError(
          "onramp.open_refused",
          new Error("No trustworthy balance baseline when opening the widget"),
          { reason: !signedIn ? "not_signed_in" : "balances_loading" },
        );
        setFlowStatus("error");
        return;
      }
      const sdk = getPartnerExchangeWidget();
      if (!sdk) {
        // The loader has not attached the SDK yet.
        reportClientError(
          "onramp.open_refused",
          new Error("Paybis SDK not attached when opening the widget"),
          { reason: "sdk_missing" },
        );
        setFlowStatus("error");
        return;
      }

      // Fresh session: clear any prior flow, capture the baseline, arm the listener.
      detach();
      publishedRef.current = false;
      setDeltaByToken([]);
      setTerminalReason(undefined);
      baselineRef.current = current;
      expectedTokenRef.current = expectedToken;
      requestIdRef.current = requestId;

      // POO-1598 S3/S4: arm the widget capture for THIS purchase. This is the one place that holds
      // both the server-minted `requestId` and the moment the widget is handed to the buyer, so it
      // is where the trace id is pinned for the whole session. Gated off by default
      // (`onRampCapture`) AND scoped to one configured wallet ([R9]), so a buyer who is not the
      // named operator records nothing. When either gate is closed this is a no-op. Through
      // {@link observe}, so arming an instrument can never be the reason a purchase fails to open.
      observe(() => startPaybisCapture({ requestId, ...(wallet ? { wallet } : {}) }));

      // [R7] Journal BEFORE opening, so a reload finds the in-flight id and reuses it instead of
      // minting a second purchase intent. The mint site (POO-1135) reads findResumableOnRampRequest.
      if (wallet) recordOnRampRequest({ requestId, wallet });

      handlerRef.current = handleMessage;
      window.addEventListener("message", handleMessage);
      setFlowStatus("opening");
      // Embed mode only: postMessage events fire in an iframe, never a popup (POO-1134 scope decision).
      sdk.openInEmbed({ requestId }, container);
    },
    [detach, handleMessage, setFlowStatus],
  );

  // Detach on unmount so a timer or listener never outlives the component.
  useEffect(() => detach, [detach]);

  /**
   * POO-1371: is a trustworthy balance baseline available RIGHT NOW.
   *
   * Exposed so `PaybisWidgetFrame` can fold it into the bounded poll it already runs for the SDK,
   * rather than `open()` growing a retry loop of its own. The frame's header is explicit that there
   * must be no second poller ([R7]), and a transient condition must not produce a TERMINAL failure.
   */
  const isBaselineReady = isSignedIn && !isLoading;

  return { status, deltaByToken, open, reset, isBaselineReady, terminalReason };
}
