/**
 * @id PP-MGR-MOD-004
 * @name VerificationCodeModal
 * @implements-rules-version v1
 *
 * POO-745 [R4]: shown after a manager requests account verification (and re-shown while `pending`,
 * [R6]). Presents the staff-evaluation instruction plus the one-time code to DM to the Pool Party
 * official profile from a registered social account, with a copy-to-clipboard affordance. The FE owns
 * the copy (i18n across 11 locales, no em dash) — it does NOT render the server-authored `message`.
 * The same code is passed in on every open (from the idempotent request-verification response), so a
 * re-open shows the identical code — this component never generates or mutates anything.
 *
 * Mirrors {@link ManagerActionModal}'s Dialog structure; the copy control follows the ShareInviteButton
 * `navigator.clipboard.writeText` + transient `copied` pattern (no shared clipboard hook exists).
 */
"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";

/** Public props for {@link VerificationCodeModal}. */
export interface VerificationCodeModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The one-time verification code to display + copy (from the request-verification response). */
  code: string;
}

/** How long the "Copied" confirmation stays before reverting to "Copy code". */
const COPIED_RESET_MS = 2000;

/** Manager account-verification code dialog (PP-MGR-MOD-004). */
export function VerificationCodeModal({ open, onOpenChange, code }: VerificationCodeModalProps) {
  const t = useTranslations("manager");
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      // Revert the label after a beat; a failed copy leaves the code visible to select manually.
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard unavailable (insecure context / unsupported) — the code stays on screen to copy by hand.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("profileTab.verify.modal.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {t("profileTab.verify.modal.body", { code })}
        </p>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t("profileTab.verify.modal.codeLabel")}
          </span>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
            <code
              data-testid="verification-code"
              className="font-mono font-semibold text-foreground text-lg tracking-[0.3em]"
            >
              {code}
            </code>
            <Button variant="secondary" size="sm" onClick={copyCode}>
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? t("profileTab.verify.modal.copied") : t("profileTab.verify.modal.copy")}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("confirm.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
