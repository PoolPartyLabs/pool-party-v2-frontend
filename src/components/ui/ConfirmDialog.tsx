/**
 * @id PP-CORE-MOD-003
 * @name ConfirmDialog
 * @implements-rules-version v1
 *
 * A reusable confirm dialog (icon + title + body + stacked confirm/cancel). Destructive by default
 * (Log out, Delete account); `tone="info"` renders a neutral, non-destructive notice (e.g. the
 * blocked-delete "withdraw first"). Focus trap, Esc and overlay-click come from the Dialog
 * primitive.
 */
"use client";

import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";

/** Public props for {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** Dialog title. */
  title: string;
  /** Supporting body copy. */
  body: string;
  /** Label for the confirm action. */
  confirmLabel: string;
  /** Label for the cancel action. */
  cancelLabel: string;
  /** Called when the confirm action is taken. May be async; the dialog awaits it before closing. */
  onConfirm: () => void | Promise<void>;
  /** Visual tone: red destructive confirm (default) or a neutral informational notice. */
  tone?: "destructive" | "info";
}

/** A confirmation dialog (destructive by default). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  tone = "destructive",
}: ConfirmDialogProps) {
  const isInfo = tone === "info";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showClose={false}>
        <DialogHeader className="items-center text-center sm:text-center">
          <span
            className={
              isInfo
                ? "mx-auto flex size-12 items-center justify-center rounded-full bg-info/15 text-info"
                : "mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive"
            }
          >
            {isInfo ? (
              <Info className="size-6" aria-hidden="true" />
            ) : (
              <AlertTriangle className="size-6" aria-hidden="true" />
            )}
          </span>
          <DialogTitle className="mt-2">{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant={isInfo ? "primary" : "destructive"}
            size="lg"
            className="w-full"
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" size="lg" className="w-full" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
