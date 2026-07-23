/**
 * @id PP-CORE-CMP-018
 * @name EmptyState
 * @implements-rules-version v1
 * Presentational empty-state primitive: centered icon, title, description, and a CTA slot.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link EmptyState}; forwards all native `<div>` attributes. */
export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional leading visual (e.g. a lucide icon) shown above the title. */
  icon?: ReactNode;
  /** Already-translated headline describing the empty condition. Required. */
  title: string;
  /** Optional already-translated supporting copy shown beneath the title. */
  description?: string;
  /** Optional call-to-action slot (e.g. a Button) rendered below the text. */
  action?: ReactNode;
}

/**
 * Centered vertical layout for "nothing here yet" states. Purely presentational and
 * props-based: the consumer passes already-translated strings (no i18n inside this primitive).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
