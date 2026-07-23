/**
 * @id PP-ADM-CMP-013
 * @name RemoveImageDialog
 * @implements-rules-version v1
 *
 * The confirm-remove dialog for image moderation (POO-590 R4): a destructive confirmation with an
 * OPTIONAL reason (the removal is a reversible soft-hide, and the reason is logged). Distinct from
 * the plain `ConfirmDialog` because it captures free text.
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";

export interface RemoveImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Subject name shown in the body copy. */
  subject: string;
  /** Awaited before the dialog closes; receives the trimmed reason (or undefined). */
  onConfirm: (reason?: string) => void | Promise<void>;
}

export function RemoveImageDialog({
  open,
  onOpenChange,
  subject,
  onConfirm,
}: RemoveImageDialogProps) {
  const t = useTranslations("admin");
  const [reason, setReason] = useState("");

  const close = () => {
    onOpenChange(false);
    setReason("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("imageModeration.removeTitle")}</DialogTitle>
          <DialogDescription>{t("imageModeration.removeBody", { subject })}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-muted-foreground text-xs">
            {t("imageModeration.reasonLabel")}
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={t("imageModeration.reasonPlaceholder")}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="destructive"
            size="lg"
            className="w-full"
            onClick={async () => {
              await onConfirm(reason.trim() || undefined);
              close();
            }}
          >
            {t("imageModeration.remove")}
          </Button>
          <Button variant="ghost" size="lg" className="w-full" onClick={close}>
            {t("imageModeration.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
