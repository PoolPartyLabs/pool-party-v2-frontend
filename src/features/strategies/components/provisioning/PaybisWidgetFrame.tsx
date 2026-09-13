/**
 * @id PP-CORE-CMP-066 (POO-1134, POO-1135, POO-1136, POO-1377, POO-1384, POO-1390, POO-1405, POO-1496)
 * @name PaybisWidgetFrame
 * @implements-rules-version v6 (POO-1390 rules v1) · v5 (POO-1384 / POO-1129 rules v4) · v4 (POO-1136 / POO-1129 rules v3) · v3 (POO-1135 / POO-1129 rules v3) · v2 (POO-1129 rules v2)
 *
 * The embedded Paybis on-ramp: the container the widget renders INTO, its lifecycle chrome, and the
 * bridge to {@link useOnRampSettlement}, which reconciles the purchase from the observed balance
 * delta ([R4]). Embed mode only (POO-1134 scope decision), because postMessage events fire in an
 * iframe and never a popup, and those events are what drive settlement ([R5]).
 *
 * The presentational half is split into {@link PaybisWidgetFrameView} so every lifecycle caption is
 * story- and test-able without a live SDK (react-component-blueprint: separated states).
 *
 * The SDK is loaded by {@link PaybisWidgetScript} and attaches asynchronously, so this waits (bounded,
 * self-terminating, NOT a background interval) for `window.PartnerExchangeWidget.openInEmbed` to be a
 * function before opening. POO-1369: it used to wait on `isLoaded`, which the SDK sets once it has
 * been DRIVEN rather than when it is ready to be, so the wait could never end and every purchase
 * timed out as ONRAMP_UNAVAILABLE. On settlement it calls {@link PaybisWidgetFrameProps.onSettled} with the delta; on a
 * terminal state it calls {@link PaybisWidgetFrameProps.onTerminal}. POO-1135 wires those into the
 * provisioning rail (re-derive the legs from the delta) and mounts this beside the running plan card.
 *
 * PP-NOTE (Apple Pay): the Payment Request API is gated by Permissions Policy, and the open question
 * POO-1134 left here is now closed. It is NOT the iframe attribute: the SDK already sets `payment *`
 * on the element it builds (see the note above {@link PaybisWidgetFrameProps}). It was the document
 * half, `payment=()` in our own header, fixed by POO-1405. A popup fallback was never the answer.
 *
 * ## Mock mode is gated OFF, on purpose (POO-1135)
 *
 * There is no real Paybis SDK and no real balance rail in mock mode: `useOnRampSettlement`'s poll reads
 * `getWalletHoldingsAction`, which returns `[]` without a SIWE session, so settlement could only ever
 * reach `timed-out` and the mock-mode visual harness would look broken for a reason unrelated to this
 * component. So in mock mode the frame does NOT open the widget and shows a documented placeholder
 * instead. The real embed + settlement runs only with real data behind the `fiatOnRamp` flag.
 */
"use client";

import { X } from "lucide-react";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { reportClientError } from "@/lib/observability/reportClientError";
import { getPartnerExchangeWidget } from "@/lib/onramp/paybisWidget";
import type { OnRampCurrencyCode, TokenDelta } from "@/lib/onramp/tokenDeltas";
import { type OnRampSettlementStatus, useOnRampSettlement } from "@/lib/onramp/useOnRampSettlement";
// The mock/real seam: mock mode has no Paybis SDK and no real holdings rail, so the frame is gated off.
import { isMockMode } from "@/lib/services";
import { cn } from "@/lib/utils/cn";

/** How often to check whether the async SDK has attached (ms). */
export const SDK_READY_POLL_MS = 150;
/** How long to wait for the SDK before giving up and showing the unavailable state (ms). */
export const SDK_READY_MAX_WAIT_MS = 8_000;

/**
 * The frame's lifecycle: the hook's status, the local "SDK never loaded" verdict, and `mock` — the
 * documented mock-mode placeholder (POO-1135), where there is no real widget to embed.
 */
export type PaybisWidgetFrameStatus = OnRampSettlementStatus | "unavailable" | "mock";

/**
 * What {@link PaybisWidgetFrameProps.onTerminal} can report: every state after which this frame will
 * never resolve on its own (POO-1136).
 *
 * Wider than {@link OnRampSettlementStatus} by exactly one member, `unavailable`, because the SDK
 * never attaching is a dead end the HOOK cannot see: `open()` was never reached, so the hook sits at
 * `idle` forever while this component has already given up. A host awaiting a purchase has to be told,
 * or its promise never settles.
 */
export type PaybisWidgetTerminalStatus = OnRampSettlementStatus | "unavailable";

/**
 * The states after which nothing further will happen, so the host must be released (POO-1136).
 *
 * `closed` is in here, and that is the fix POO-1136 makes: it is the most common abandonment action
 * (the user shuts the checkout without paying) and it left `runOnRampBuy`'s promise pending forever,
 * with the op modal's dismissal lock held. It is safe to treat as terminal precisely because the hook
 * only ever REACHES `closed` before `completed` ([R12]: a post-`completed` close returns before
 * `setFlowStatus("closed")`, so reconciliation is never aborted and this status never appears for it).
 *
 * `timed-out` is terminal FOR THE FRAME and deliberately not a failure: the host maps it to the
 * settling phase, because the money may still be landing.
 */
const TERMINAL_STATUSES = new Set<OnRampSettlementStatus>([
  "rejected",
  "cancelled",
  "error",
  "timed-out",
  "closed",
]);

/** The caption key per lifecycle state (literal keys so the static i18n scan sees each one). */
const CAPTION_KEY: Record<PaybisWidgetFrameStatus, string> = {
  idle: "provisioning.onramp.connecting",
  opening: "provisioning.onramp.opening",
  open: "provisioning.onramp.open",
  reconciling: "provisioning.onramp.reconciling",
  settled: "provisioning.onramp.settled",
  "timed-out": "provisioning.onramp.timedOut",
  closed: "provisioning.onramp.closed",
  rejected: "provisioning.onramp.rejected",
  cancelled: "provisioning.onramp.cancelled",
  error: "provisioning.onramp.error",
  unavailable: "provisioning.onramp.unavailable",
  mock: "provisioning.onramp.mockMode",
};

/** States whose caption should read as a problem rather than progress. */
const WARNING_STATES = new Set<PaybisWidgetFrameStatus>([
  "timed-out",
  "closed",
  "rejected",
  "cancelled",
  "error",
  "unavailable",
]);

/**
 * The iframe permission split, read from the vendor's shipped bundle (POO-1405, corrected POO-1496).
 *
 * A CROSS-ORIGIN iframe needs two independent grants for a policy-gated feature: the embedding
 * document must hold it, and the iframe element must delegate it. POO-1405 fixed the first half for
 * `payment` in `lib/security/headers.ts`. It also shipped a `usePaymentAllow` MutationObserver hook
 * for the second half, on the stated premise that "the SDK does not set `allow` on the element it
 * creates".
 *
 * That premise was wrong, and POO-1496 established it against the live bundle on 2026-08-10
 * (`widget.paybis.com` and `widget.sandbox.paybis.com` are byte-identical but for the origin):
 *
 *     createIframe(e){ let t=document.createElement(`iframe`);
 *                      return t.src=f(e),
 *                        t.setAttribute(`allow`,`clipboard-read; clipboard-write *; payment *; camera *; microphone *`),
 *                        t.setAttribute(`allowpaymentrequest`,`true`), t }
 *
 * The SDK sets the documented recipe itself, and it is the only `setAttribute("allow", ...)` in the
 * bundle, so nothing later rewrites it. It is set while the element is still DETACHED and appended
 * afterwards (`E=this.createIframe(e), a(E), t.append(E)`); a frame resolves its permissions policy
 * when it NAVIGATES and a detached iframe does not navigate, so the delegation lands before the load
 * and there is no race to lose.
 *
 * So the hook was never load-bearing. Its own guard returned early on the vendor's string every run
 * (`/(^|[;\s])payment([;\s]|$)/` matches `payment *`), it carried no test, and it has therefore never
 * modified an attribute in production. POO-1405's real and complete fix was the header. Removed here
 * rather than left as documented dead weight, because the next person to debug this checkout should
 * not be told the vendor omits an attribute the vendor in fact sets.
 *
 * The consequence for POO-1496: `camera` and `microphone` are already delegated ON THE ELEMENT, so
 * the only missing grant is the document half we own, and it is a header edit alone. That edit stays
 * blocked on `CR-CORE-011` (OPEN, owner Legal), which asks whether we should take that posture at all.
 */

/** Public props for {@link PaybisWidgetFrame}. */
export interface PaybisWidgetFrameProps {
  /** The server-minted Paybis purchase id (never client-forged; from `createOnRampRequestAction`). */
  requestId: string;
  /**
   * The token this order buys (`sizeOnRampOrder`'s `order.currencyCode`, POO-1133). Scopes settlement
   * detection to the purchase's own growth ([R4]), so an unrelated credit arriving during the
   * reconcile window cannot settle the flow.
   */
  expectedToken: OnRampCurrencyCode;
  /** The SIWE-session wallet, for the [R7] resumable-request journal. */
  wallet?: string;
  /** Called once with the observed per-token delta ([R4]) when the purchase settles. */
  onSettled?: (deltas: TokenDelta[]) => void;
  /**
   * Called once when the frame reaches a state it will never leave
   * ({@link PaybisWidgetTerminalStatus}).
   *
   * POO-1390 [R3]: `reason` is the VENDOR's own words when it sent any, so the host can say what
   * Paybis said rather than the sentence this app invented. Absent on `unavailable` (the SDK never
   * attached, so there is no vendor to quote) and on any terminal state that carried no payload.
   */
  onTerminal?: (status: PaybisWidgetTerminalStatus, reason?: string) => void;
  /** Extra classes on the outer section. */
  className?: string;
}

/** The embedded Paybis on-ramp with balance-delta settlement. */
export function PaybisWidgetFrame({
  requestId,
  expectedToken,
  wallet,
  onSettled,
  onTerminal,
  className,
}: PaybisWidgetFrameProps) {
  const { status, deltaByToken, open, isBaselineReady, terminalReason } = useOnRampSettlement();
  const containerRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  const notifiedRef = useRef(false);
  const [sdkUnavailable, setSdkUnavailable] = useState(false);

  // Open once the async SDK has attached and the container exists. Bounded and self-terminating: it
  // stops on success, on the max wait, and on unmount — never a free-running interval ([R7] no second
  // poller). The `requestId` is the mint site's, opened at most once.
  useEffect(() => {
    // POO-1135: never embed a real widget in mock mode (there is no SDK and no holdings rail behind
    // it); the placeholder below stands in instead.
    if (isMockMode || openedRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tryOpen = () => {
      if (cancelled || openedRef.current) return;
      const container = containerRef.current;
      const sdk = getPartnerExchangeWidget();
      // POO-1369: readiness is "can this SDK do embed", NOT `isLoaded`.
      //
      // `isLoaded` is set by the SDK once it has been DRIVEN, not when it is ready to be. Gating
      // `open()` on it deadlocked: we waited for a flag that only the call we were withholding could
      // produce, so after the 8s ceiling every purchase reported ONRAMP_UNAVAILABLE with the global
      // present and `isLoaded === false`. Observed in production on v1.2.1.
      //
      // `openInEmbed` is the honest signal: Paybis' bootstrap stub only implements `open` (popup),
      // so the method this app actually calls existing as a function IS the proof the real SDK
      // replaced the stub. Interface v1 never reads `isLoaded` either; it checks presence and calls.
      // POO-1370: `container.isConnected` is required, not defensive. Read from the vendor bundle:
      // `openInEmbed(e,t)` THROWS "`el` must be attached to the document" for a detached node, and a
      // ref can be non-null while its element is not yet in the document.
      // POO-1371: the balance baseline joins the SAME bounded poll, rather than `open()` refusing
      // outright. `open()` requires a trustworthy baseline ([R4]: a still-loading snapshot is a false
      // zero, and a delta measured against it would claim the user's whole wallet), but that
      // condition is TRANSIENT and was producing a TERMINAL failure: the frame called `open()` the
      // instant the SDK was ready, while `useTokenBalances` was still in flight. Waiting here keeps
      // the safety property and drops the false failure, with no second poller ([R7]).
      if (typeof sdk?.openInEmbed === "function" && container?.isConnected && isBaselineReady) {
        openedRef.current = true;
        open({ requestId, container, expectedToken, ...(wallet === undefined ? {} : { wallet }) });
        return;
      }
      if (Date.now() - startedAt >= SDK_READY_MAX_WAIT_MS) {
        // POO-1370: say WHY. Two production releases were spent discovering this state by hand
        // because the give-up path recorded nothing: v1.2.1 had the SDK present with a gate that
        // could never pass, v1.2.2 had no SDK at all. Those are opposite causes behind one identical
        // screen. The next occurrence should name itself.
        // `reportClientError`, NOT `logError`: this is a CLIENT component and `logger.ts` is
        // `server-only`, so importing it here breaks the build (caught by `pnpm build`, which is the
        // only gate that bundles). This path posts to `/api/client-error` and reaches the same Sentry
        // project, which is what the 13 other client report sites already do.
        reportClientError(
          "onramp.widget_sdk_unavailable",
          new Error("Paybis SDK never became usable"),
          {
            sdkPresent: sdk !== null,
            canEmbed: typeof sdk?.openInEmbed === "function",
            containerPresent: container !== null,
            containerConnected: container?.isConnected === true,
            waitedMs: Date.now() - startedAt,
          },
        );
        setSdkUnavailable(true);
        return;
      }
      timer = setTimeout(tryOpen, SDK_READY_POLL_MS);
    };
    timer = setTimeout(tryOpen, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [requestId, expectedToken, wallet, open, isBaselineReady]);

  // Report settlement / terminal to the host exactly once (POO-1135 re-derives the legs from here).
  //
  // POO-1136: EVERY dead end reports, not just the four widget-error states. The host awaits a promise
  // this frame is the only thing that can settle, so a state that reports neither leaves the buy step
  // pending forever behind a dismissal-locked modal, with a caption promising a restart the UI cannot
  // deliver. The two that used to do exactly that are `closed` (the ordinary "user shut the checkout
  // without paying") and the SDK-unavailable verdict below.
  useEffect(() => {
    if (notifiedRef.current) return;
    if (status === "settled") {
      notifiedRef.current = true;
      onSettled?.(deltaByToken);
      return;
    }
    // The SDK never attached inside the ceiling: `open()` was never called, so the hook stays `idle`
    // and no widget will ever render. Nothing else can end this wait.
    if (sdkUnavailable && status === "idle") {
      notifiedRef.current = true;
      onTerminal?.("unavailable");
      return;
    }
    if (TERMINAL_STATUSES.has(status)) {
      notifiedRef.current = true;
      onTerminal?.(status, terminalReason);
    }
  }, [status, sdkUnavailable, deltaByToken, onSettled, onTerminal, terminalReason]);

  const effectiveStatus: PaybisWidgetFrameStatus = isMockMode
    ? "mock"
    : sdkUnavailable && status === "idle"
      ? "unavailable"
      : status;

  return (
    <PaybisWidgetFrameView
      status={effectiveStatus}
      className={className}
      // POO-1377: reported as `closed`, the same terminal the widget's own Close emits, so the host
      // takes ONE path out whether the user left via Paybis or via us. Suppressed once a terminal has
      // already been reported ([R7] report exactly once) and after settlement, where the money has
      // moved and abandoning is not a thing the user may do.
      {...(notifiedRef.current || status === "settled"
        ? {}
        : {
            onExit: () => {
              if (notifiedRef.current) return;
              notifiedRef.current = true;
              onTerminal?.("closed");
            },
          })}
    >
      {/* POO-1405 / POO-1496: the widget injects its own iframe here, and a policy-gated feature
          needs BOTH halves. Our `Permissions-Policy` header must grant it to the widget origin (see
          `lib/security/headers.ts`, which previously denied `payment` to everyone) AND the element
          must delegate it. The SDK sets `allow="clipboard-read; clipboard-write *; payment *;
          camera *; microphone *"` on the element it builds, so the delegation half is the vendor's
          and needs nothing from us. The header is the only half we own. */}
      {/* POO-1372: `h-`, not just `min-h-`, and `relative`. Both are required by the vendor, read
          from its bundle rather than guessed:

            function r(e){ e.setAttribute("frameborder","0"); e.style.opacity="0";
                           e.style.height="100%"; e.style.width="100%"; ... }

          The SDK sizes its own iframe to `height: 100%`. A percentage height resolves against the
          containing block's HEIGHT, and `min-height` does not establish one, so under `min-h-` alone
          it computed to `auto` and the iframe collapsed to the browser default 150px inside a
          full-size box. `min-h-` is kept so the frame still reserves space before the iframe exists.

          `relative` because `openInEmbed` appends its preloader with `position: absolute`; without a
          positioned ancestor it escapes to the nearest one and overlays the wrong element. */}
      <div
        ref={containerRef}
        data-testid="paybis-widget-container"
        className="relative h-[26rem] min-h-[26rem] w-full"
      />
    </PaybisWidgetFrameView>
  );
}

/** Public props for {@link PaybisWidgetFrameView}. */
export interface PaybisWidgetFrameViewProps {
  /** Which lifecycle caption to show. */
  status: PaybisWidgetFrameStatus;
  /** The widget container (or, in a story, a placeholder). */
  children: ReactNode;
  /** Extra classes on the outer section. */
  className?: string;
  /**
   * POO-1377: abandon the purchase and release the modal. Absent means no escape is offered, which is
   * correct once the flow has left the widget behind.
   */
  onExit?: () => void;
}

/** The presentational shell: the framed container area, an aria-live caption, and the attribution. */
export function PaybisWidgetFrameView({
  status,
  children,
  className,
  onExit,
}: PaybisWidgetFrameViewProps) {
  const t = useTranslations("strategies");
  const isWarning = WARNING_STATES.has(status);
  return (
    <section
      aria-label={t("provisioning.onramp.title")}
      className={cn("flex w-full flex-col gap-3", className)}
    >
      {/* POO-1377: `rounded-3xl` on the shell and on the inner clip, so the vendor iframe corners follow
          the frame instead of squaring off inside it. */}
      {/* POO-1384: the ONE close control, on the frame itself.
          POO-1377 put a "Close checkout" text link below the attribution. On a phone that sits under
          the fold once the vendor iframe takes its full height, so the user still had no visible exit.
          This replaces it rather than joining it: two controls with the same accessible name doing the
          same thing is worse for a screen reader than the problem being fixed. This one sits above
          the iframe, so it is reachable without scrolling past it. */}
      {onExit ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onExit}
            aria-label={t("provisioning.onramp.exit")}
            // `after:-inset-3.5` grows the 36px box to ~44px of TOUCH target without moving the pixel
            // that is drawn, which is what `Dialog.tsx:107` does for its own X (POO-840 [R2]); the
            // focus ring is the repo convention (`Button.tsx`, `Dialog.tsx`), and a bare <button>
            // over a dark surface would otherwise rely on the UA default.
            className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-3.5 after:content-[''] hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-3xl border border-border bg-white/[0.04] p-2 [&>*]:overflow-hidden [&>*]:rounded-[1.25rem]">
        {children}
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "text-center text-sm",
          status === "settled"
            ? "text-success"
            : isWarning
              ? "text-warning"
              : "text-muted-foreground",
        )}
      >
        {t(CAPTION_KEY[status])}
      </p>
      <p className="text-center text-muted-foreground text-xs">
        {t("provisioning.poweredByPaybis")}
      </p>
    </section>
  );
}
