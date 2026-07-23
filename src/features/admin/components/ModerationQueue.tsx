/**
 * @id PP-ADM-CMP-012
 * @name ModerationQueue
 * @implements-rules-version v1
 *
 * The Admin Console Moderation > Images queue (POO-590). A grid of pending images (strategy / manager
 * avatar / manager banner) with a thumbnail (placeholder until real image hosting, POO-580). Each card
 * drives Approve (confirm modal) and Remove (soft-hide via {@link RemoveImageDialog}), through server
 * actions that re-check the session + capability. After a decision the route is refreshed.
 *
 * POO-670: this queue is mock/thin-backed with NO backend paging, so it pages via a CLIENT-SIDE
 * "Load more" reveal ({@link useRevealCount}), replacing the POO-628 windowing (the shared
 * VirtualCardList primitive and its own tests stay intact for other consumers). The grid is a plain
 * `<ul>` map over `items.slice(0, count)`: the first page shows 5 cards and each "Load more" reveals
 * the next 5 from the already-loaded set ([R1]). A queue of <= 5 cards shows no button.
 *
 * [R2] DRAIN + DO-NOT-RESET: the queue calls `router.refresh()` after a decision, and the server
 * re-renders one fewer card. The reveal `count` is component state with NO `resetKey` (this grid has
 * no filter), so a same-set refresh keeps the revealed count instead of snapping back to 5 (POO-628
 * DO-NOT-RESET); `slice(0, count)` clamps naturally when the drain yields fewer cards than are
 * revealed, so no phantom card renders past the new end. The Approve confirm modal and the Remove
 * dialog render OUTSIDE the list.
 */
"use client";

import { ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RemoveImageDialog } from "@/features/admin/components/RemoveImageDialog";
import { approveImageAction, removeImageAction } from "@/features/admin/moderationActions";
import { useRevealCount } from "@/hooks/useRevealCount";
import { useRouter } from "@/i18n/navigation";

/** A display-ready pending image row (strings formatted on the server). */
export interface ModerationImageRow {
  id: string;
  kind: "strategy" | "manager-avatar" | "manager-banner";
  subjectName: string;
  subjectId: string;
  /** Upload date, `YYYY-MM-DD`. */
  uploaded: string;
  imageUrl?: string;
}

interface Target {
  id: string;
  subject: string;
}

export function ModerationQueue({
  items,
  canApprove,
  canRemove,
}: {
  items: readonly ModerationImageRow[];
  canApprove: boolean;
  canRemove: boolean;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [approveTarget, setApproveTarget] = useState<Target | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Target | null>(null);
  // POO-670 [R1]: client-side reveal over the loaded queue. No filter here, so no resetKey — the
  // count only grows and a same-set refresh preserves it ([R2] DO-NOT-RESET, POO-628).
  const { count, revealMore } = useRevealCount();
  const revealed = items.slice(0, count);
  const hasMore = items.length > revealed.length;

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border border-dashed bg-surface p-8 text-center">
        <p className="text-muted-foreground text-sm">{t("imageModeration.empty")}</p>
      </div>
    );
  }

  // Literal t() calls so the static i18n usage scan resolves every key.
  const kindLabels: Record<ModerationImageRow["kind"], string> = {
    strategy: t("imageModeration.kindStrategy"),
    "manager-avatar": t("imageModeration.kindAvatar"),
    "manager-banner": t("imageModeration.kindBanner"),
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* POO-670 [R1]: plain responsive grid over the revealed slice (first 5, +5 per "Load more"). */}
        <ul
          aria-label={t("imageModeration.listLabel")}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {revealed.map((item) => (
            <li
              key={item.id}
              className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface"
            >
              <div className="relative flex h-40 items-center justify-center bg-gradient-to-br from-primary/20 via-surface to-brand-grape/20 text-muted-foreground">
                {item.imageUrl ? (
                  // biome-ignore lint/performance/noImgElement: moderation thumbnail of a user-uploaded image on an arbitrary host / data URL, not a Next-optimizable asset
                  <img
                    src={item.imageUrl}
                    alt={t("imageModeration.thumbAlt", { subject: item.subjectName })}
                    className="size-full object-cover"
                  />
                ) : (
                  <ImageIcon className="size-8" aria-hidden="true" />
                )}
                <span className="absolute top-2 left-2 rounded bg-background/70 px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  {kindLabels[item.kind]}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <div className="font-medium text-foreground text-sm">{item.subjectName}</div>
                  <div className="text-muted-foreground text-xs">
                    @{item.subjectId} · {item.uploaded}
                  </div>
                </div>
                <div className="mt-auto flex gap-2">
                  {canRemove ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoveTarget({ id: item.id, subject: item.subjectName })}
                    >
                      {t("imageModeration.remove")}
                    </Button>
                  ) : null}
                  {canApprove ? (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      onClick={() => setApproveTarget({ id: item.id, subject: item.subjectName })}
                    >
                      {t("imageModeration.approve")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

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
        open={approveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setApproveTarget(null);
        }}
        tone="info"
        title={t("imageModeration.approveTitle")}
        body={t("imageModeration.approveBody", { subject: approveTarget?.subject ?? "" })}
        confirmLabel={t("imageModeration.approve")}
        cancelLabel={t("imageModeration.cancel")}
        onConfirm={async () => {
          if (!approveTarget) return;
          await approveImageAction(approveTarget.id);
          router.refresh();
        }}
      />

      <RemoveImageDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        subject={removeTarget?.subject ?? ""}
        onConfirm={async (reason) => {
          if (!removeTarget) return;
          await removeImageAction(removeTarget.id, reason);
          router.refresh();
        }}
      />
    </>
  );
}
