/**
 * @id PP-CORE-CMP-027
 * @name ReceiptRows
 * @implements-rules-version v1
 *
 * The shared data-driven receipt for every transactional confirm / status modal (POO-279 R5-R7).
 * Replaces the hard-coded label/value JSX previously duplicated across Invest / Collect /
 * Compound / Withdraw and the success receipts. Rows come in GROUPS: a divider renders only
 * between groups, never between rows of the same group (R6). Standard metrics per R6:
 * row py 12 · container radius 12 · label 13 secondary · value 14 with semantic weight.
 *
 * Tones: `default` (metadata, Medium) · `positive` (yield/earnings, SemiBold success) ·
 * `negative` (fees/costs, destructive) · `emphasis` (totals, SemiBold). A row with `onAction`
 * renders its value as a tappable settings-style button (Action variant). A row with `tooltip`
 * renders an info (ⓘ) trigger next to its label (POO-384 R3): the trigger reveals the explanation
 * on hover/focus and exposes it as its accessible name, so screen readers get it without opening.
 */
"use client";

import { Info, Settings2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";

/** Semantic weight/color of a receipt value (POO-279 R5). */
export type ReceiptRowTone = "default" | "positive" | "negative" | "emphasis" | "warning";

/**
 * The explanation behind a row's info (ⓘ) trigger (POO-384 R3). A plain string serves as both the
 * visible tooltip body and the trigger's accessible name. To show a richer body (e.g. the 3-line
 * combined-fees breakdown) while keeping a flat accessible name, pass `{ label, body }`.
 */
export type ReceiptRowTooltip = string | { label: string; body: ReactNode };

/** One label/value line of a receipt. */
export interface ReceiptRowItem {
  /** Left-hand label (13px secondary). */
  label: string;
  /** Right-hand value. */
  value: ReactNode;
  /** Semantic tone; defaults to `default`. */
  tone?: ReceiptRowTone;
  /** When set, the value renders as a tappable settings-style button (Action variant). */
  onAction?: () => void;
  /** When set, an info (ⓘ) trigger renders next to the label, revealing this explanation. */
  tooltip?: ReceiptRowTooltip;
}

/** Public props for {@link ReceiptRows}. */
export interface ReceiptRowsProps {
  /** Row groups; a divider renders only BETWEEN groups (R6). Empty groups are skipped. */
  groups: ReceiptRowItem[][];
  /** Extra classes on the container. */
  className?: string;
}

const VALUE_TONE: Record<ReceiptRowTone, string> = {
  default: "font-medium text-foreground",
  positive: "font-semibold text-success",
  negative: "font-medium text-destructive",
  emphasis: "font-semibold text-foreground",
  // POO-613: amber (not red) so a high price impact reads as a caution to weigh, not an error.
  warning: "font-semibold text-warning",
};

/** Info (ⓘ) trigger for a row label: tap/hover/focus reveals `body`, `label` is the accessible name. */
function RowInfoTip({ label, body }: { label: string; body: ReactNode }) {
  // POO-840 R1: Radix tooltips never open on a plain tap (the pointerdown suppresses the
  // focus-open), so the open state is controlled: onClick opens it on touch while Radix keeps
  // hover/keyboard-focus and outside-tap/Esc close via onOpenChange (the AprTooltip POO-485
  // pattern). The fee breakdown is exposed ONLY here, so a tap-dead (i) hid it from phones.
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen(true)}
            // POO-840 R2: the ::after hit-area takes the 14px icon to a ~44px touch target
            // without changing its visual size or the row layout.
            className="relative inline-flex shrink-0 rounded-full text-muted-foreground transition-colors after:absolute after:-inset-3.5 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">{body}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A single receipt line; `divider` draws the between-groups rule above it (R6). */
function Row({
  label,
  value,
  tone = "default",
  onAction,
  tooltip,
  divider,
}: ReceiptRowItem & { divider?: boolean }) {
  // A string tooltip is both body and accessible name; the object form keeps a flat label.
  const tip =
    tooltip == null
      ? null
      : typeof tooltip === "string"
        ? { label: tooltip, body: tooltip }
        : tooltip;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-3",
        divider && "border-border border-t",
      )}
    >
      <dt className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        {label}
        {tip ? <RowInfoTip label={tip.label} body={tip.body} /> : null}
      </dt>
      {/* POO-839 R4: min-w-0 lets both cells shrink and break-words wraps a long value
          (unbounded strategy names) right-aligned instead of overflowing the receipt. */}
      <dd className={cn("min-w-0 break-words text-right text-sm", VALUE_TONE[tone])}>
        {onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-1 transition-colors hover:text-primary"
          >
            {value}
            <Settings2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/** Grouped, data-driven receipt rows. See {@link ReceiptRowsProps}. */
export function ReceiptRows({ groups, className }: ReceiptRowsProps) {
  const visible = groups.filter((group) => group.length > 0);
  // Conforming <dl> content model: each div child wraps exactly one dt+dd pair (a wrapper div per
  // GROUP holding row divs is invalid HTML). The between-groups divider (R6) renders as a top
  // border on the first row of every group after the first.
  return (
    <dl className={cn("rounded-xl bg-surface-raised px-4 py-1 text-left", className)}>
      {visible.flatMap((group, groupIndex) =>
        group.map((row, rowIndex) => (
          <Row key={row.label} {...row} divider={groupIndex > 0 && rowIndex === 0} />
        )),
      )}
    </dl>
  );
}
