/**
 * @id PP-STR-MOD-008
 * @name TransactionErrorActions
 * @implements-rules-version v1
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
 */
"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DISCORD_INVITE_URL } from "@/lib/constants/links";
import { buildErrorReport, type TxError } from "@/lib/tx/diagnostics";
import { useTxDiagnostics } from "@/lib/tx/useTxDiagnostics";

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
}

/** Error-details box + Try again / Discord actions for the transaction error state. */
export function TransactionErrorActions({ onRetry, error }: TransactionErrorActionsProps) {
  const t = useTranslations("strategies");
  const diagnostics = useTxDiagnostics();
  const [copied, setCopied] = useState(false);
  const txError: TxError = error ?? { code: "PP-TX-ERR", message: t("flow.error.body") };

  async function copyError() {
    // Confirm only on a real copy: clipboard may be absent (insecure context) or reject
    // (document unfocused) — flipping to "Copied" then would send the user to support empty-handed.
    try {
      await navigator.clipboard.writeText(buildErrorReport(txError, diagnostics));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // keep the idle label; the raw details stay visible/selectable in the box
    }
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
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
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
            {copied ? t("flow.error.copied") : t("flow.error.copy")}
          </button>
        </div>
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
        </dl>
      </div>

      <Button className="w-full" size="lg" onClick={onRetry}>
        {t("flow.error.retry")}
      </Button>
      <Button
        className="w-full gap-2 bg-[#5865f2] text-white hover:bg-[#5865f2]/90"
        size="lg"
        onClick={() => window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer")}
      >
        <DiscordIcon />
        {t("flow.error.help")}
      </Button>
    </>
  );
}
