/**
 * @id PP-MGR-SCR-002 (POO-309)
 * @name SeedZeroBalanceModal
 * @implements-rules-version v1
 *
 * Shown on the Review step's Seed liquidity card when the manager has zero balance of a token the
 * new pool needs, so they cannot seed it yet. Offers two ways out: Deposit (the fiat on-ramp at
 * /deposit) and Swap (button only, disabled "coming soon", matching the wallet modal's Swap). No
 * funds move here; it just routes the manager to get the missing token.
 */
"use client";

import { ArrowDownToLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { useRouter } from "@/i18n/navigation";

/** Public props for {@link SeedZeroBalanceModal}. */
export interface SeedZeroBalanceModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** Symbols of the needed tokens the manager has no balance of (one or two). */
  tokens: string[];
}

/** Zero-balance prompt for the seed-liquidity step (Deposit / Swap). */
export function SeedZeroBalanceModal({ open, onOpenChange, tokens }: SeedZeroBalanceModalProps) {
  const t = useTranslations("manager");
  const tProfile = useTranslations("profile");
  const router = useRouter();
  const tokenList = tokens.join(" & ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("review.seed.zeroBalance.title", { token: tokenList })}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {t("review.seed.zeroBalance.body", { token: tokenList })}
        </p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <Button
            className="flex-1"
            onClick={() => {
              onOpenChange(false);
              router.push("/deposit");
            }}
          >
            <ArrowDownToLine className="size-4" aria-hidden="true" />
            {t("review.seed.zeroBalance.deposit")}
          </Button>
          {/* Swap is deferred (POO-240); shown disabled with a "coming soon" badge, like the wallet modal. */}
          <Button variant="secondary" className="flex-1" disabled>
            {t("review.seed.zeroBalance.swap")}
            <span className="rounded-full bg-surface-raised px-2 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              {tProfile("security.comingSoon")}
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
