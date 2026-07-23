/**
 * @id PP-ADM-CMP-011
 * @name ManagerVerificationQueue
 * @implements-rules-version v1
 *
 * The Admin Console Operations > Managers verification queue (POO-587). Renders the pending requests
 * and drives Approve / Reject through the server actions, each behind a confirmation modal
 * (`ConfirmDialog`, the default for every admin mutation). Reject is only rendered when the session
 * holds the `verification.reject` capability (admin/master). After a decision the route is refreshed
 * so the server re-reads the queue.
 *
 * POO-670: this queue is mock/thin-backed with NO backend paging, so it pages via a CLIENT-SIDE
 * "Load more" reveal ({@link useRevealCount}), replacing the POO-628 windowing (the shared
 * VirtualTableBody primitive and its own tests stay intact for other consumers). The `<tbody>` is a
 * plain map over `rows.slice(0, count)`: the first page shows 5 rows and each "Load more" reveals the
 * next 5 from the already-loaded set ([R1]). A queue of <= 5 rows shows no button.
 *
 * [R2] DRAIN + DO-NOT-RESET: the queue calls `router.refresh()` after a decision, and the server
 * re-renders one fewer row. The reveal `count` is component state with NO `resetKey` (this queue has
 * no status filter), so a same-set refresh keeps the revealed count instead of snapping back to 5
 * (POO-628 DO-NOT-RESET); `slice(0, count)` clamps naturally when the drain yields fewer rows than
 * are revealed, so no phantom row renders past the new end. The Approve/Reject confirmation modal
 * renders OUTSIDE the list.
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  approveVerificationAction,
  rejectVerificationAction,
} from "@/features/admin/verificationActions";
import { useRevealCount } from "@/hooks/useRevealCount";
import { useRouter } from "@/i18n/navigation";

/** A display-ready pending-verification row (strings formatted on the server). */
export interface VerificationQueueRow {
  handle: string;
  name: string;
  /** Submitted date, `YYYY-MM-DD` (formatted server-side to avoid hydration drift). */
  submitted: string;
  /** AUM, pre-formatted as a currency string. */
  aum: string;
  strategyCount: number;
}

interface PendingDialog {
  kind: "approve" | "reject";
  handle: string;
  name: string;
}

export function ManagerVerificationQueue({
  rows,
  canReject,
}: {
  rows: readonly VerificationQueueRow[];
  canReject: boolean;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  // POO-670 [R1]: client-side reveal over the loaded queue. No status filter here, so no resetKey —
  // the count only grows and a same-set refresh preserves it ([R2] DO-NOT-RESET, POO-628).
  const { count, revealMore } = useRevealCount();
  const revealed = rows.slice(0, count);
  const hasMore = rows.length > revealed.length;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border border-dashed bg-surface p-8 text-center">
        <p className="text-muted-foreground text-sm">{t("verificationQueue.empty")}</p>
      </div>
    );
  }

  const isReject = dialog?.kind === "reject";

  const onConfirm = async () => {
    if (!dialog) return;
    if (dialog.kind === "approve") {
      await approveVerificationAction(dialog.handle);
    } else {
      await rejectVerificationAction(dialog.handle);
    }
    router.refresh();
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* `overflow-x-auto` keeps the min-width table horizontally scrollable on narrow viewports. */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-border border-b bg-surface text-muted-foreground text-xs">
              <tr>
                <th className="px-4 py-3 font-medium">{t("verificationQueue.colManager")}</th>
                <th className="px-4 py-3 font-medium">{t("verificationQueue.colSubmitted")}</th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("verificationQueue.colAum")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("verificationQueue.colStrategies")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("verificationQueue.colActions")}
                </th>
              </tr>
            </thead>
            {/* POO-670 [R1]: plain <tbody> over the revealed slice (first 5, +5 per "Load more"). */}
            <tbody>
              {revealed.map((row) => (
                <tr key={row.handle} className="border-border border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{row.name}</div>
                    <div className="text-muted-foreground text-xs">@{row.handle}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.submitted}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.aum}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.strategyCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canReject ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDialog({ kind: "reject", handle: row.handle, name: row.name })
                          }
                        >
                          {t("verificationQueue.reject")}
                        </Button>
                      ) : null}
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() =>
                          setDialog({ kind: "approve", handle: row.handle, name: row.name })
                        }
                      >
                        {t("verificationQueue.approve")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* POO-670 [R1]: reveal the next 5; hidden once everything loaded is on screen. */}
        {hasMore ? (
          <button
            type="button"
            onClick={revealMore}
            className="self-center rounded-lg border border-border bg-surface px-5 py-2.5 font-medium text-foreground text-sm transition-colors hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("loadMore")}
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        tone={isReject ? "destructive" : "info"}
        title={isReject ? t("verificationQueue.rejectTitle") : t("verificationQueue.approveTitle")}
        body={
          isReject
            ? t("verificationQueue.rejectBody", { name: dialog?.name ?? "" })
            : t("verificationQueue.approveBody", { name: dialog?.name ?? "" })
        }
        confirmLabel={isReject ? t("verificationQueue.reject") : t("verificationQueue.approve")}
        cancelLabel={t("verificationQueue.cancel")}
        onConfirm={onConfirm}
      />
    </>
  );
}
