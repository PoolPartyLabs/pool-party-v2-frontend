/**
 * @id PP-CORE-CMP-043
 * @name PlanStepRow
 * @implements-rules-version v1
 *
 * One row of the provisioning wizard's Plan card (PP-CORE-MOD-011): a numbered badge + title +
 * optional caption + optional right-aligned amount, with a dotted connector rail to the next row.
 * Presentational; the parent resolves i18n and passes an optional inline slot via `children` (the gas
 * row renders the `GasAmountSelector` there).
 */
"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";

/** Public props for {@link PlanStepRow}. */
export interface PlanStepRowProps {
  /** 1-based badge number. */
  index: number;
  /** Resolved row title. */
  title: string;
  /** Resolved caption (may include the Paybis attribution). */
  caption?: ReactNode;
  /** USD amount to show on the right, or omit. */
  amountUsd?: number;
  /** Last row → no connector rail. */
  isLast?: boolean;
  /** Inline slot under the row (e.g. the gas selector). */
  children?: ReactNode;
}

/** A single numbered step row in the Plan card. */
export function PlanStepRow({
  index,
  title,
  caption,
  amountUsd,
  isLast,
  children,
}: PlanStepRowProps) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary text-xs">
          {index}
        </span>
        {!isLast ? (
          <span
            aria-hidden="true"
            className="my-1 w-px flex-1 border-border border-l border-dashed"
          />
        ) : null}
      </div>
      <div className={cn("flex flex-1 flex-col", isLast ? "pb-0" : "pb-4")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-foreground text-sm">{title}</p>
            {caption ? <p className="mt-0.5 text-muted-foreground text-xs">{caption}</p> : null}
          </div>
          {amountUsd !== undefined ? (
            <span className="shrink-0 font-medium text-foreground text-sm">
              {formatUsd(amountUsd)}
            </span>
          ) : null}
        </div>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </li>
  );
}
