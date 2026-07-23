/**
 * @id PP-CORE-CMP-019
 * @name ErrorState
 * @implements-rules-version v1
 * Presentational error-state primitive: a circular alert badge, title, description, an optional retry
 * button, and an optional secondary action (e.g. a "Contact support" link). Purely props-based: the
 * consumer passes already-translated strings and any link node (no i18n inside this primitive),
 * mirroring EmptyState.
 */
import { CircleAlert } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ErrorState}; forwards all native `<div>` attributes. */
export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Already-translated headline describing the failure. Required. */
  title: string;
  /** Optional already-translated supporting copy shown beneath the title. */
  description?: string;
  /** Invoked when the user clicks the retry button. The button renders only with `retryLabel`. */
  onRetry?: () => void;
  /** Already-translated retry button label. The button renders only when both this and `onRetry` are set. */
  retryLabel?: string;
  /** Optional already-built secondary action (e.g. a "Contact support" link) shown beneath retry. */
  secondaryAction?: ReactNode;
}

/**
 * Centered vertical layout for "something went wrong" states. Renders a circular alert badge, a title,
 * an optional description, a retry button when both `onRetry` and `retryLabel` are supplied, and an
 * optional secondary action below it.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  secondaryAction,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      <div
        className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive"
        aria-hidden="true"
      >
        <CircleAlert className="size-7" />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {onRetry && retryLabel ? (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2",
            "text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {retryLabel}
        </button>
      ) : null}
      {secondaryAction ? <div className="mt-1">{secondaryAction}</div> : null}
    </div>
  );
}
