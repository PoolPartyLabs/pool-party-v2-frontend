/**
 * @id PP-CORE-CMP-043
 * @name PlanStepRow
 * @implements-rules-version v2 (POO-1088 rules v2) · v1
 *
 * One row of the provisioning wizard's Plan card (PP-CORE-MOD-011): a numbered badge + title +
 * optional caption + optional right-aligned amount, with a dotted connector rail to the next row.
 * Presentational; the parent resolves i18n and passes an optional inline slot via `children` (the gas
 * row renders the `GasAmountSelector` there).
 *
 * v2 (POO-1088): the row is also an EXECUTION row, so it can be marked as the current step and can
 * carry the signing disclosure for it. Both are passed in, not derived: which step is live and what
 * a signature authorizes are the card's to know.
 */
"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";

/** Public props for {@link PlanStepRow}. */
export interface PlanStepRowProps {
  /** 1-based badge number. */
  index: number;
  /**
   * Replaces the numbered badge (POO-1088 [F5-R1]).
   *
   * The execution screens swap the number for a status mark: a check for a settled step, the number
   * with a spinner for the running one, a cross for the one that failed. Passed in rather than
   * derived here, because this row is presentational and the status vocabulary belongs to the card.
   */
  badge?: ReactNode;
  /** Resolved row title. */
  title: string;
  /** Resolved caption (may include the Paybis attribution). */
  caption?: ReactNode;
  /** USD amount to show on the right, or omit. */
  amountUsd?: number;
  /** Last row → no connector rail. */
  isLast?: boolean;
  /**
   * The step the wallet is asking about right now (POO-1088 [F5-R4]).
   *
   * Marks the row `aria-current="step"`, which is how a screen reader is told which of four rows is
   * live, and how this card's callers assert the active row is matched by KEY rather than by
   * position.
   */
  isActive?: boolean;
  /**
   * The clear-vs-blind signing disclosure for this row (UF-28 [R4], POO-1088 [F5-R4]).
   *
   * Sits directly under the sub-line, because the question it answers ("what am I about to sign?")
   * is only ever asked about the step that is currently in the wallet. Passed in rather than derived
   * here: this row is presentational, and only the card knows whether a step grants an allowance or
   * moves funds.
   */
  disclosure?: ReactNode;
  /**
   * The step's own key, which makes this row addressable to the e2e harness (POO-1109 [R3]/[R5]).
   *
   * Set only on the rows that represent a FUNDING LEG while the route runs. `e2e/helpers/provisioning.ts`
   * scopes its read to the provisioning panel and maps every `[data-testid^="wallet-step-"]` to a leg,
   * so an op-anchor row carrying one would be counted as a leg the rail never runs. Keyed rather than
   * indexed because the rail expands one plan step into an approval plus its leg.
   */
  stepKey?: string;
  /**
   * Execution status in the harness's vocabulary. It POLLS this to follow a leg to completion rather
   * than sleeping for a bridge, so it is a contract and not decoration: stop rendering it and the
   * harness sees a route with no legs and reports "nothing to verify on chain" for a bridge that
   * really ran.
   */
  stepStatus?: string;
  /**
   * The broadcast hash, once there is one. The harness verifies these receipts ON CHAIN: a leg the
   * app shows as "done" with no mined, non-reverted transaction behind it is the exact failure a
   * success screen cannot tell you about.
   */
  txHash?: string;
  /** Inline slot under the row (e.g. the gas selector). */
  children?: ReactNode;
}

/** A single numbered step row in the Plan card. */
export function PlanStepRow({
  index,
  badge,
  title,
  caption,
  amountUsd,
  isLast,
  isActive,
  disclosure,
  stepKey,
  stepStatus,
  txHash,
  children,
}: PlanStepRowProps) {
  return (
    <li
      className="flex gap-3"
      aria-current={isActive ? "step" : undefined}
      {...(stepKey === undefined ? {} : { "data-testid": `wallet-step-${stepKey}` })}
      {...(stepStatus === undefined ? {} : { "data-status": stepStatus })}
      {...(txHash === undefined ? {} : { "data-tx-hash": txHash })}
    >
      <div className="flex flex-col items-center">
        {badge ?? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary text-xs">
            {index}
          </span>
        )}
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
            <p className="min-w-0 break-words font-medium text-foreground text-sm">{title}</p>
            {caption ? (
              <p className="mt-0.5 min-w-0 break-words text-muted-foreground text-xs">{caption}</p>
            ) : null}
            {/* Under the sub-line and inside the text column, so it wraps with the copy it belongs
                to instead of colliding with the amount on a 375px sheet. */}
            {disclosure ? <div className="flex flex-col">{disclosure}</div> : null}
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
