/**
 * @id PP-PROF-CMP-009
 * @name ExportKeyDialog
 * @implements-rules-version v2
 *
 * The "Export private key" flow. A clear risk warning gates the reveal behind a deliberate
 * press-and-hold (HoldToConfirmButton) so a single stray tap can never expose a key. On completion:
 *  - Mock mode  -> reveals the throwaway 0xMOCK... value in-app (display + copy only).
 *  - Real mode  -> closes THIS dialog first, then calls Privy's exportWallet(), which shows the key
 *    inside its own cross-origin iframe modal. Our app never receives the key (POO-544 R1). We close
 *    first so this Radix modal's focus-trap / aria-hidden does not make Privy's modal inert (which
 *    would leave the user unable to interact with, or exit, the Privy modal).
 *
 * Security: the key-display subtree is structurally gated on the mock branch (`mockKey`), which is
 * always null in a real build; exportReal() resolves to void so there is no real key to render, log,
 * clipboard, or track. The only in-app error (no embedded wallet) surfaces a static, non-secret
 * message (R4); nothing secret is ever logged or shown.
 */
"use client";

import { AlertTriangle, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { HoldToConfirmButton } from "@/components/ui/HoldToConfirmButton";
import { useExportPrivateKey } from "@/lib/account/useExportPrivateKey";

/** Public props for {@link ExportKeyDialog}. */
export interface ExportKeyDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
}

/** Hold-to-reveal export-private-key dialog. */
export function ExportKeyDialog({ open, onOpenChange }: ExportKeyDialogProps) {
  const t = useTranslations("profile");
  const exporter = useExportPrivateKey();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errored, setErrored] = useState(false);

  // A revealed key only ever exists on the mock branch. In a real build `exporter.isMock` is false, so
  // this is null and the key-display block never renders — and exportReal() returns void, so there is
  // no real key value to place here even by mistake (POO-544 R1).
  const mockKey = exporter.isMock ? revealedKey : null;

  function reset() {
    setRevealedKey(null);
    setCopied(false);
    setErrored(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleHoldComplete() {
    setErrored(false);
    if (exporter.isMock) {
      setRevealedKey(exporter.revealMockKey());
      return;
    }
    if (!exporter.canExport) {
      // No embedded wallet to export (should not happen: the row is gated to embedded wallets).
      // R4: static, non-secret message; keep the dialog open.
      setErrored(true);
      return;
    }
    // Close OUR dialog first so its focus-trap / aria-hidden does not make Privy's modal inert, then
    // hand off on the next tick once this dialog has unmounted. Privy renders the key in its own modal.
    handleOpenChange(false);
    setTimeout(() => {
      void exporter.exportReal().catch(() => {
        // Post-handoff failure is rare and Privy surfaces its own errors; nothing secret to show here.
      });
    }, 0);
  }

  function copyMockKey() {
    if (!mockKey) return;
    navigator.clipboard?.writeText(mockKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        {mockKey ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("security.exportReveal.title")}</DialogTitle>
              <DialogDescription className="text-warning">
                {t("security.exportReveal.warning")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-foreground text-xs">
                {mockKey}
              </code>
              <button
                type="button"
                onClick={copyMockKey}
                aria-label={t("security.exportReveal.copy")}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Copy className="size-4" aria-hidden="true" />
              </button>
            </div>
            {copied ? (
              <p className="text-success text-xs">{t("security.exportReveal.copied")}</p>
            ) : null}
            <Button className="w-full" size="lg" onClick={() => handleOpenChange(false)}>
              {t("security.exportReveal.done")}
            </Button>
          </>
        ) : (
          <>
            <DialogHeader className="items-center text-center sm:text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <AlertTriangle className="size-6" aria-hidden="true" />
              </span>
              <DialogTitle className="mt-2">{t("security.exportConfirm.title")}</DialogTitle>
              <DialogDescription>{t("security.exportConfirm.body")}</DialogDescription>
            </DialogHeader>
            <HoldToConfirmButton
              label={t("security.exportConfirm.hold")}
              onComplete={handleHoldComplete}
            />
            {errored ? (
              <p role="alert" className="text-center text-destructive text-sm">
                {t("security.exportError")}
              </p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
