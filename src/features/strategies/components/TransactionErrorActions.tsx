/**
 * @id PP-STR-MOD-008 (POO-1107, POO-1251, POO-1387, POO-1403)
 * @name TransactionErrorActions
 * @implements-rules-version v7 (POO-1786 rules v1) · v6 (POO-1763 rules v2 [R9]: the `transient` kind gets its own body) · v5 (POO-1711 rules v1 [R5]: the `rangeUnchanged` kind gets its own body,
 *   because nothing failed) · v1 (POO-1403 rules v1) · v2 (POO-1385 rules v2) · v4 (POO-1387 rules v1) · v3 (POO-1251 rules v1) · v2 (POO-1107 rules v1) · v1
 *
 * The shared error block for a failed transaction, rendered inside TransactionStatus (phase
 * "error") across the invest / collect / compound / withdraw flows. v2 (POO-279): an
 * "Error details" box shows the raw provider message plus the environment diagnostics
 * (Code · Browser · Wallet · OS · Language) [R1] with "Copy error" copying the FULL payload
 * (message + code + diagnostics + timestamp; clipboard only, never analytics) [R2]. Buttons:
 * Try again (gold) + Get help on Discord (blurple, the sanctioned exception to the 1-CTA
 * policy) [R3]. Tints come from the status/error tokens [R4].
 *
 * POO-461 R3/R4: `useTxErrorBody` resolves the error-view BODY from the error's classification
 * (`TxError.kind`): a classified kind swaps the generic "didn't go through" copy for actionable
 * localized copy; unknown/unclassified errors keep the generic body. Every host modal feeds its
 * TransactionStatus body through it; the raw provider message stays in the details box + clipboard.
 *
 * ## v3 (POO-1251): the REFERENCE
 *
 * The box showed Code / Browser / Wallet / OS / Language and never the correlation id, so a user
 * reporting a failure could not hand support the one value that resolves it. That matters more than
 * it sounds: a failed money-path operation is thrown by the backend as an `HttpException`, which
 * `@SentryExceptionCaptured` treats as expected and never files as an Issue, and the money path is
 * trace-sampled below 1, so most failures record no spans either. It lands in Sentry LOGS, and the
 * correlation id is the only way to find it.
 *
 * [R1] The reference resolves in one order: the backend's `error.correlationId` falling back to the
 * echoed `x-request-id` (both already merged into `TxError.correlationId` by `apiFetch`), then the
 * BROWSER's own Sentry trace id for a failure that never reached the API. What that second source
 * buys is the FRONTEND CONTAINER LOGS, not a Sentry event: see `clientContext.ts` for why, and for
 * the caveat that it is a PER-PAGELOAD id, so two failures on one route share a reference. It renders
 * de-emphasised, and never as an empty or "undefined" row: with nothing resolvable the row is not
 * rendered at all.
 *
 * [R4] Discord channel URLs cannot pre-fill message text. That is a platform limitation, not a
 * missing parameter, so the button copies and opens the invite; the user pastes it. It copies the
 * FULL report rather than the bare reference: the reference already leads that payload, and writing
 * only the reference destroyed whatever the user had just copied with "Copy error".
 *
 * ## POO-1403: a SECOND reference, for the one class where a third party holds the answer
 *
 * The reference above is OURS. For an on-ramp failure Paybis has never heard of it, and the only id
 * their support can act on is the server-minted `requestId`, which was on no report at all: the
 * escalation path for a failed purchase was "ask the user to read their own localStorage". A host
 * that has one passes it as `paybisRequestId` and it joins the box, the copy payload and the Sentry
 * event, labelled with the vendor's name so nobody has to guess whose id is whose.
 *
 * [R4] is why it arrives as a VALUE and not as a flag: this block renders on eleven surfaces, ten of
 * which have no purchase behind them, so an absent id must be structurally unable to grow a row.
 */
"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { chainDisplayName, getChainById } from "@/lib/chains/config";
import { DISCORD_INVITE_URL } from "@/lib/constants/links";
import { browserTraceId, sentryRelease } from "@/lib/observability/sentry/clientContext";
import { useReportRenderedError } from "@/lib/observability/useReportRenderedError";
import { buildErrorReport, type TxError } from "@/lib/tx/diagnostics";
import { useTxDiagnostics } from "@/lib/tx/useTxDiagnostics";
import { isChainFailure, SwitchNetworkAction } from "./SwitchNetworkAction";

/** Discord brand mark (filled, currentColor). */
function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true" focusable="false">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

/**
 * The error-view body for a failed transaction (POO-461 R3/R4): kind-specific localized copy when
 * the failure classified, the generic "didn't go through" body otherwise.
 */
export function useTxErrorBody(error: TxError | null | undefined): string {
  const t = useTranslations("strategies");
  // Explicit per-kind calls (not a dynamic key) so i18n:check registers every key as used.
  switch (error?.kind) {
    case "slippage":
      return t("flow.error.kinds.slippage");
    case "deadlineExpired":
      return t("flow.error.kinds.deadlineExpired");
    case "insufficientFunds":
      return t("flow.error.kinds.insufficientFunds");
    case "userRejected":
      return t("flow.error.kinds.userRejected");
    case "unauthorized":
      return t("flow.error.kinds.unauthorized");
    // POO-1763 [R9]: the chain, the RPC or the wallet did not answer in time. Nothing moved, and a
    // second attempt is the remedy, so the copy says exactly that instead of "something went wrong".
    case "transient":
      return t("flow.error.kinds.transient");
    // POO-1763 [R9]: we broadcast and could not confirm, so the copy must NOT say the funds are
    // untouched (they may not be) and must send the user to check their own wallet first. Like
    // `alreadyBroadcast` above, it relies on its copy to hold back the unconditional Try again (the
    // per-kind button suppression is the separate PP-DEBT noted there).
    case "confirmationTimeout":
      return t("flow.error.kinds.confirmationTimeout");
    // POO-1026 [R3]: name the target network so the copy is actionable ("Switch to Arbitrum"). The
    // name derives from the single chain config, never a local literal. [R4]: an unknown or
    // unsupported chain id degrades to the network-less variant, never "Switch to undefined".
    case "wrongChain": {
      const network = error.targetChainId ? getChainById(error.targetChainId)?.name : undefined;
      return network
        ? t("flow.error.kinds.wrongChain", { network })
        : t("flow.error.kinds.wrongChainUnknown");
    }
    /**
     * POO-1385 [R5]: the wallet does not HAVE this network, so the copy must not say "switch to" it.
     * The remedy is in the wallet app (enable the network, reconnect), and the same network-naming
     * and same degradation as wrongChain apply, for the same reason.
     */
    case "chainUnavailable": {
      // `chainDisplayName`, NOT `chain.name`: viem says "Arbitrum One" and every other surface in the
      // app says "Arbitrum" (`chains/config.ts` states the rule). The Switch button two lines below
      // this copy already uses it, and one dialog naming one network two ways reads as two networks.
      const network = chainDisplayName(error.targetChainId);
      return network
        ? t("flow.error.kinds.chainUnavailable", { network })
        : t("flow.error.kinds.chainUnavailableUnknown");
    }
    // POO-1044 [R3]: the operation's chain cannot pay for its own transaction. Same network-naming
    // treatment and the same degradation as wrongChain, because the remedy is chain-specific and
    // "you need gas somewhere" is not something anyone can act on.
    case "gasBlocked": {
      const network = error.targetChainId ? getChainById(error.targetChainId)?.name : undefined;
      return network
        ? t("flow.error.kinds.gasBlocked", { network })
        : t("flow.error.kinds.gasBlockedUnknown");
    }
    // POO-1093 [R3]: the guard fired. Nothing is lost and nothing needs re-sending, so the copy must
    // not say "didn't go through" and must not invite another attempt.
    case "alreadyBroadcast":
      return t("flow.error.kinds.alreadyBroadcast");
    // POO-1107: the upstream could not price a route, so nothing was attempted and retrying is
    // exactly right. That is the opposite of `alreadyBroadcast`, where the money is already moving
    // and pressing the button again is the one thing that must not happen.
    // PP-DEBT(SEV:LOW): the "Try again" button itself is unconditional for every kind, so
    // `alreadyBroadcast` relies on its copy alone to hold the user back. Suppressing the button per
    // kind is a product call, tracked separately, not something to change on this path.
    case "upstreamUnavailable":
      return t("flow.error.kinds.upstreamUnavailable");
    // POO-1711: nothing failed, so the copy must not say the transaction did not go through. The
    // remedy is entirely in the manager's hands and takes one sentence to state.
    case "rangeUnchanged":
      return t("flow.error.kinds.rangeUnchanged");
    default:
      return t("flow.error.body");
  }
}

/** Public props for {@link TransactionErrorActions}. */
export interface TransactionErrorActionsProps {
  /** Re-run the transaction (returns the modal to its confirm step). */
  onRetry: () => void;
  /** The structured error to display; falls back to the legacy support reference. */
  error?: TxError;
  /**
   * POO-1387: which flow is showing this, e.g. `"provisioning"`, `"invest"`, `"withdraw"`. Becomes
   * the `surface` field on the Sentry event, so "which flow is failing" is a filter rather than a
   * guess. Optional with a generic default so the eleven existing call sites keep working unchanged;
   * pass a real one when touching a flow.
   */
  surface?: string;
  /**
   * POO-1403 [R1]: the VENDOR's own id for a failed fiat purchase (the server-minted Paybis
   * `requestId`), resolved from the on-ramp journal by the host.
   *
   * [R4] Opt-in by VALUE, not by a boolean, and deliberately so: this block renders on eleven
   * surfaces and ten of them have no purchase behind them, so the default has to be "no such id
   * exists" and an absent value has to be structurally incapable of producing a blank row. The host
   * also owns the decision of WHEN a failure is a purchase's, because only it can tell an on-ramp
   * screen from an on-ramp-adjacent one (see `isOnRampFailure`).
   */
  paybisRequestId?: string;
}

/** Error-details box + Try again / Discord actions for the transaction error state. */
export function TransactionErrorActions({
  onRetry,
  error,
  surface = "transaction",
  paybisRequestId,
}: TransactionErrorActionsProps) {
  const t = useTranslations("strategies");
  const diagnostics = useTxDiagnostics();
  const [copied, setCopied] = useState(false);
  const txError: TxError = error ?? { code: "PP-TX-ERR", message: t("flow.error.body") };

  // [R1] The support handle, in source order. Memoized on the backend id alone: `browserTraceId()`
  // reads the live propagation context, and a reference that changed between renders is one the user
  // could copy differently from the one they read.
  const reference = useMemo(
    () => txError.correlationId ?? browserTraceId(),
    [txError.correlationId],
  );

  /**
   * POO-1387 [R1]: this component is the ONE place every transaction failure becomes visible to a
   * user (eleven call sites render it), which makes it the one place worth reporting from. Until now
   * a caught-and-rendered failure reached no Sentry channel at all, so the reference printed two
   * lines below was an id with nothing behind it.
   *
   * Deliberately reported with the SAME `reference` the box displays, so the value the user reads is
   * the value that finds the event ([R3]).
   */
  useReportRenderedError(surface, error, reference, paybisRequestId);

  /**
   * Write to the clipboard and confirm ONLY on a real write: the API may be absent (insecure
   * context) or reject (document unfocused), and flipping to "Copied" then would send the user to
   * support empty-handed. Shared by both buttons so there is one confirmation affordance, not two.
   */
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // keep the idle label; the raw details stay visible/selectable in the box
    }
  }

  /** The [R2] payload both buttons write. Built at click time so the timestamp is the copy's own. */
  function errorReport(): string {
    return buildErrorReport(txError, diagnostics, {
      reference,
      // POO-1403 [R1]/[R4]: present only when the host resolved one, and an absent value omits the
      // line rather than writing it blank.
      ...(paybisRequestId ? { paybisRequestId } : {}),
      release: sentryRelease(),
    });
  }

  function copyError() {
    void copyToClipboard(errorReport());
  }

  /**
   * [R4] Copy the report, then open Discord. The write is STARTED and not awaited on purpose:
   * `window.open` after an await has lost the user-gesture context and is what a popup blocker
   * stops, so the open stays in the same synchronous turn as the click while the confirmation
   * lands on its own.
   *
   * It writes the FULL report, not the bare reference. The natural sequence is "Copy error" and then
   * "Get help on Discord" to go paste it, and a Discord click that wrote only the reference DESTROYED
   * the payload the user had just copied. The reference already LEADS the report, so nothing the
   * button existed to hand over is buried, and the destructive overwrite disappears.
   */
  function openDiscord() {
    void copyToClipboard(errorReport());
    window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer");
  }

  const diagRows: [string, string][] = [
    [t("flow.error.codeLabel"), txError.code],
    [t("flow.error.browserLabel"), diagnostics.browser],
    [t("flow.error.walletLabel"), diagnostics.wallet],
    [t("flow.error.osLabel"), diagnostics.os],
    [t("flow.error.languageLabel"), diagnostics.language],
  ];

  return (
    <>
      {/* Error details box [R1]: raw message + environment rows, tinted via status/error tokens [R4] */}
      <div className="rounded-xl border border-error-border bg-error-surface p-3 text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("flow.error.details")}
          </p>
          <button
            type="button"
            onClick={copyError}
            className="inline-flex items-center gap-1 font-medium text-primary text-xs transition-opacity hover:opacity-80"
          >
            {copied ? (
              <Check className="size-3" aria-hidden="true" />
            ) : (
              <Copy className="size-3" aria-hidden="true" />
            )}
            {/* POO-1786 [R1]: the label is an element React owns. The icon beside it swaps types, so React
                inserts the new one BEFORE its sibling, and a bare text node that Chrome page translation rewrote
                is no longer where React left it (the POO-1762 crash, see `Button.tsx`). A bare span is one flex
                item where the anonymous one was, so the layout is unchanged. */}
            <span>{copied ? t("flow.error.copied") : t("flow.error.copy")}</span>
          </button>
        </div>
        {/* PP-A11Y: the "Copied" affordance is a label swap on the button, which a screen reader only
            reads if the user happens to move focus back onto it, so both copy paths confirmed
            silently. The live region announces the same word the sighted user sees; it is separate
            from the button so the announcement fires on the STATE change rather than on focus. */}
        <p role="status" aria-live="polite" className="sr-only">
          {copied ? t("flow.error.copied") : ""}
        </p>
        {/* POO-839 R5: hex calldata / viem URLs are unbroken tokens far wider than a phone —
            break-words keeps them inside the dialog instead of painting past its edge. */}
        <p className="mt-2 break-words text-foreground/85 text-xs">{txError.message}</p>
        <dl className="mt-3 flex flex-col gap-1.5">
          {diagRows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground text-xs">{label}</dt>
              {/* POO-839 R5: min-w-0 + break-words so long UA/wallet strings wrap, not overflow. */}
              <dd className="min-w-0 break-words text-right text-foreground text-xs">{value}</dd>
            </div>
          ))}
          {/* [R1] The support handle. De-emphasised to the same muted tone as the row LABELS, because
              it is a value for support and not information for the user, and monospaced + break-all
              so 32 hex characters stay readable and stay inside the dialog. Rendered only when one
              resolved: a "Reference: undefined" row is worse than no row.

              PP-A11Y: the SIZE stays `text-xs`, matching every other value in this list, and it is
              `select-all`. Muted tone is the de-emphasis; 10px is not, it is a legibility floor
              breach — and this is the one value a user may have to read and hand-select by eye,
              because `copyToClipboard`'s catch exists precisely for the insecure-context case where
              the Clipboard API is absent and no button can hand it over. */}
          {reference ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground text-xs">
                {t("flow.error.referenceLabel")}
              </dt>
              <dd className="min-w-0 select-all break-all text-right font-mono text-muted-foreground text-xs">
                {reference}
              </dd>
            </div>
          ) : null}
          {/* POO-1403 [R1] The VENDOR's handle, directly under ours and named after them, because the
              two are only useful read together and a support agent has to know which one to quote to
              whom: ours finds our trace, theirs finds the purchase, and Paybis has never heard of
              ours. Same treatment as the row above for the same reasons ([R4]: rendered only when
              the host resolved one, so ten of the eleven surfaces never see it). */}
          {paybisRequestId ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground text-xs">
                {t("flow.error.paybisReferenceLabel")}
              </dt>
              <dd className="min-w-0 select-all break-all text-right font-mono text-muted-foreground text-xs">
                {paybisRequestId}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* POO-1385 [R6]: the manual way out, ABOVE Try again, because on a chain failure retrying the
          whole operation re-runs the build and the quote to arrive back at a switch the user could
          have made directly.

          MOUNTED only for a chain failure, not mounted-and-self-hiding. It reads the connected
          wallet, and this block renders for every failed transaction across surfaces that have no
          wallet concern at all, so an unconditional mount would make the wagmi provider a
          precondition for showing a slippage error. */}
      {isChainFailure(txError) ? (
        <SwitchNetworkAction error={txError} onSwitched={onRetry} />
      ) : null}
      <Button className="w-full" size="lg" onClick={onRetry}>
        {t("flow.error.retry")}
      </Button>
      <Button
        className="w-full gap-2 bg-[#5865f2] text-white hover:bg-[#5865f2]/90"
        size="lg"
        onClick={openDiscord}
      >
        <DiscordIcon />
        {t("flow.error.help")}
      </Button>
    </>
  );
}
