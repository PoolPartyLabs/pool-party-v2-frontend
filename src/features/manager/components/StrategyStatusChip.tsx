/**
 * @id PP-MGR-CMP-013
 * @name StrategyStatusChip
 * @implements-rules-version v1
 *
 * Lifecycle chip for a manager strategy (Active / Paused / Closed / Draft). Used on the console's
 * Overview table, the Manage-strategies cards and the manage-detail header so a non-active strategy
 * is never mistaken for a running one.
 */
import { useTranslations } from "next-intl";
import type { ManagerStrategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";

/** Chip classes per lifecycle status. */
const STATUS_CLASSES: Record<ManagerStrategy["status"], string> = {
  active: "bg-success/10 text-success",
  paused: "bg-warning/10 text-warning",
  closed: "bg-surface-raised text-muted-foreground",
  draft: "border border-border text-muted-foreground",
};

/** Public props for {@link StrategyStatusChip}. */
export interface StrategyStatusChipProps {
  /** The strategy's lifecycle status. */
  status: ManagerStrategy["status"];
  /** Extra classes on the chip. */
  className?: string;
}

/** A small lifecycle-status chip. */
export function StrategyStatusChip({ status, className }: StrategyStatusChipProps) {
  const t = useTranslations("manager");
  // Literal t() calls (the i18n usage scan is static — no dynamic keys).
  const labels: Record<ManagerStrategy["status"], string> = {
    active: t("status.active"),
    paused: t("status.paused"),
    closed: t("status.closed"),
    draft: t("status.draft"),
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs",
        STATUS_CLASSES[status],
        className,
      )}
    >
      {labels[status]}
    </span>
  );
}
