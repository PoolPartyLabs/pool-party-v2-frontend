/**
 * @id PP-MGR-MOD-002
 * @name ManagerActionModal
 * @implements-rules-version v2 (POO-807 rules v1)
 *
 * Generic confirm dialog for the manager-signed V1 actions (Collect fees, Compound, Pause deposits,
 * Close strategy, Launch). Shows what the action does, optional summary rows and the shared gas
 * note, then runs `onConfirm`. Resolving with a message switches to an in-dialog success view
 * (the "confirm → success" pair); resolving with `undefined` just closes, leaving any follow-up UI
 * to the caller. Actions from other protocols stay behind feature flags (POO-173) — this set is V1.
 *
 * POO-524 (rules v1, R1): gains a `children` slot rendered between the detail rows and the gas
 * note, so a caller can add richer receipt content (the launch confirm's per-token seed rows +
 * consolidated Fee row) without this generic modal hardcoding any flow-specific rows.
 *
 * POO-550 (rules v1): gains an optional header settings gear (`onOpenSettings` + `settingsLabel`),
 * mirroring the transactional modals' TransactionModalHeader, so the Launch confirm can host the
 * Max slippage / deadline controls at the point of signing instead of the Review page (murilo
 * 2026-07-04). Absent → no gear (the other manager confirms are unchanged).
 *
 * POO-807 (rules v1): this modal hand-rolls its header/success (it composes neither
 * TransactionModalHeader nor TransactionStatus), so it mounts the shared {@link MockBadge} itself —
 * next to the title on confirm and above the success message (self-gated; nothing in real mode).
 *
 * @integration-points
 * - onConfirm callers wrap managerService methods (collectFees / compound / setDepositsPaused /
 *   closeStrategy / createStrategy), each a mock behind the service factory today.
 */
"use client";

import { CheckCircle2, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { MockBadge } from "@/components/ui/MockBadge";
import { formatUsd } from "@/lib/utils/format";

/** One label/value row in the confirm summary. */
export interface ManagerActionDetail {
  /** Row label, already translated. */
  label: string;
  /** Row value, pre-formatted. Accepts a node so a row can carry a logo/badge (e.g. NetworkLogo). */
  value: ReactNode;
}

/** Public props for {@link ManagerActionModal}. */
export interface ManagerActionModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Collect fees?". */
  title: string;
  /** What the action does, in one short paragraph. */
  description: string;
  /** Optional summary rows shown between the description and the gas note. */
  details?: ManagerActionDetail[];
  /** Estimated network gas in USD; when set, renders the shared "you pay the gas" note. */
  gasCostUsd?: number;
  /** Confirm button label. */
  confirmLabel: string;
  /** Destructive styling for irreversible actions (Close strategy). Default: false. */
  destructive?: boolean;
  /**
   * Runs the action. Resolve with a message to show the in-dialog success view; resolve with
   * `undefined` to close the dialog and let the caller surface the outcome.
   */
  onConfirm: () => Promise<string | undefined>;
  /**
   * Extra confirm-view content rendered between the detail rows and the gas note (POO-524 R1),
   * e.g. the launch confirm's seed-amount rows + consolidated Fee row. Not shown in the success view.
   */
  children?: ReactNode;
  /**
   * POO-550: opens the transaction settings (Max slippage / deadline). When provided, a settings gear
   * shows in the header (top-right of the title). The caller owns the settings dialog. Absent → no gear.
   */
  onOpenSettings?: () => void;
  /** POO-550: already-translated accessible label for the settings gear (required with onOpenSettings). */
  settingsLabel?: string;
}

/** Manager action confirm dialog (PP-MGR-MOD-002). */
export function ManagerActionModal({
  open,
  onOpenChange,
  title,
  description,
  details,
  gasCostUsd,
  confirmLabel,
  destructive = false,
  onConfirm,
  children,
  onOpenSettings,
  settingsLabel,
}: ManagerActionModalProps) {
  const t = useTranslations("manager");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function close() {
    setError(null);
    setSuccess(null);
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) close();
    else onOpenChange(true);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const message = await onConfirm();
      if (message) setSuccess(message);
      else close();
    } catch {
      setError(t("operate.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        {success ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
            {/* POO-807 R1: the mock-mode indicator on the success view (nothing in real mode). */}
            <MockBadge />
            <p className="font-medium text-foreground">{success}</p>
            <Button onClick={close}>{t("confirm.done")}</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              {/* POO-550: optional settings gear next to the title (Max slippage / deadline), so a
                  confirm like Launch strategy hosts the tx controls at the point of signing. */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <DialogTitle>{title}</DialogTitle>
                  {/* POO-807 R1: the mock-mode indicator (nothing renders in real mode). */}
                  <MockBadge />
                </div>
                {onOpenSettings ? (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    aria-label={settingsLabel}
                    className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </DialogHeader>
            <p className="text-muted-foreground text-sm">{description}</p>

            {details && details.length > 0 ? (
              <dl className="flex flex-col gap-2 rounded-lg bg-surface-raised px-3 py-2.5 text-sm">
                {details.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3">
                    {/* POO-841 R4: min-w-0 + break-words so a long strategyName / two-price
                        rangeSummary wraps right-aligned instead of overflowing the row. */}
                    <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                    <dd className="min-w-0 break-words text-right font-medium text-foreground">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {/* POO-524 R1: caller-provided receipt content (e.g. seed rows + Fee row on Launch). */}
            {children}

            {gasCostUsd === undefined ? null : (
              <p className="text-muted-foreground text-xs">
                {t("operate.gasNote", { amount: formatUsd(gasCostUsd) })}
              </p>
            )}
            {error ? <p className="text-destructive text-xs">{error}</p> : null}

            <DialogFooter>
              <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={busy}>
                {t("operate.cancel")}
              </Button>
              <Button
                variant={destructive ? "destructive" : "primary"}
                onClick={confirm}
                disabled={busy}
              >
                {busy ? t("confirm.working") : confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
