/**
 * @id PP-CORE-MOD-004
 * @name StatusModal
 * @implements-rules-version v1
 *
 * Shared status modal that surfaces a transactional/system state in a consistent, branded way:
 * a semantic-colored icon, a title and a supporting line over the standard dimmed dialog. Six
 * states — confirm · loading · pending · success · warning · error — cover the cross-page modal
 * system. Today it is driven by the Dev menu's "Test modal states" QA grid; real flows wire to it
 * as they land.
 */
"use client";

import {
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  type LucideIcon,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/utils/cn";

/** The semantic states the shared modal can present. */
export type ModalStatus = "confirm" | "loading" | "pending" | "success" | "warning" | "error";

/** Ordered list of states — drives the Dev menu's QA grid. */
export const MODAL_STATUSES: readonly ModalStatus[] = [
  "confirm",
  "loading",
  "pending",
  "success",
  "warning",
  "error",
] as const;

/**
 * Per-state icon + tone, using semantic color tokens (no hardcoded hex). Exported so the Dev
 * menu's test grid renders the same icon/color for each state as the modal it opens.
 */
export const STATUS_STYLE: Record<
  ModalStatus,
  { icon: LucideIcon; tint: string; fg: string; spin?: boolean }
> = {
  confirm: { icon: HelpCircle, tint: "bg-muted", fg: "text-muted-foreground" },
  loading: { icon: Loader2, tint: "bg-info/15", fg: "text-info", spin: true },
  pending: { icon: Clock, tint: "bg-brand-mango/15", fg: "text-brand-mango" },
  success: { icon: CheckCircle2, tint: "bg-success/15", fg: "text-success" },
  warning: { icon: TriangleAlert, tint: "bg-warning/15", fg: "text-warning" },
  error: { icon: XCircle, tint: "bg-destructive/15", fg: "text-destructive" },
};

/** Public props for {@link StatusModal}. */
export interface StatusModalProps {
  /** The state to present, or `null` when the modal is closed. */
  status: ModalStatus | null;
  /** Called when the modal requests to close (overlay click, Esc, or dismiss). */
  onClose: () => void;
}

/** Shared, token-styled status modal. Renders nothing visible when `status` is null. */
export function StatusModal({ status, onClose }: StatusModalProps) {
  const t = useTranslations("shell");

  // Literal keys per state so the static i18n scan counts every one as used.
  const copy: Record<ModalStatus, { title: string; body: string }> = {
    confirm: { title: t("status.confirm.title"), body: t("status.confirm.body") },
    loading: { title: t("status.loading.title"), body: t("status.loading.body") },
    pending: { title: t("status.pending.title"), body: t("status.pending.body") },
    success: { title: t("status.success.title"), body: t("status.success.body") },
    warning: { title: t("status.warning.title"), body: t("status.warning.body") },
    error: { title: t("status.error.title"), body: t("status.error.body") },
  };

  const style = status ? STATUS_STYLE[status] : null;
  const text = status ? copy[status] : null;
  const Icon = style?.icon;

  return (
    <Dialog
      open={status !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          {Icon && style ? (
            <span
              className={cn(
                "flex size-14 items-center justify-center rounded-full",
                style.tint,
                style.fg,
              )}
            >
              <Icon className={cn("size-7", style.spin && "animate-spin")} aria-hidden="true" />
            </span>
          ) : null}
          <DialogHeader className="items-center sm:text-center">
            <DialogTitle>{text?.title}</DialogTitle>
            {text ? <DialogDescription>{text.body}</DialogDescription> : null}
          </DialogHeader>
          <Button variant="secondary" className="w-full" onClick={onClose}>
            {t("status.dismiss")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
