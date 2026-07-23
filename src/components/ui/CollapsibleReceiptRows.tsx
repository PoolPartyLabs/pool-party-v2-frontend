/**
 * @id PP-CORE-CMP-060
 * @name CollapsibleReceiptRows
 * @implements-rules-version v1 (POO-800 rules v1)
 *
 * The shared collapsible Review/Receipt card of the transactional modals (POO-800 R1, 0710
 * overhaul): the summary rows (hero figures) stay always visible and compact, and a centered
 * "Show more / Show less" toggle reveals the fee detail (Est. fee · Max. slippage · Price impact)
 * on demand, Uniswap-style. Optional `after` groups (e.g. Receive as) and a caption `footer`
 * ("after fees…", the arrival line) sit below the toggle and never collapse. Composes
 * {@link ReceiptRows} per section, so rows keep the receipt metrics, tones and info (ⓘ) tooltips
 * (POO-279 R5-R7). Presentational and props-based: the consumer passes already-translated labels
 * and prebuilt rows (see FeeBreakdown's buildFeeRow / buildMaxSlippageRow / buildPriceImpactRow).
 */
"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { type ReceiptRowItem, ReceiptRows } from "@/components/ui/ReceiptRows";
import { cn } from "@/lib/utils/cn";

/** Strip ReceiptRows' own card chrome: this component provides the single outer card. */
const SECTION_CLASSES = "rounded-none bg-transparent px-0 py-0";

/** Public props for {@link CollapsibleReceiptRows}. */
export interface CollapsibleReceiptRowsProps {
  /** Row groups always visible above the toggle (the compact summary). */
  summary: ReceiptRowItem[][];
  /** Row groups revealed by "Show more", between the summary and the toggle. */
  details: ReceiptRowItem[][];
  /** Optional row groups always visible below the toggle (e.g. Receive as). */
  after?: ReceiptRowItem[][];
  /** Already-translated toggle label shown while collapsed. */
  showMoreLabel: string;
  /** Already-translated toggle label shown while expanded. */
  showLessLabel: string;
  /** Whether the detail starts revealed. Defaults to collapsed (compact). */
  defaultOpen?: boolean;
  /** Always-visible caption content under the rows (e.g. "after fees…" / the arrival line). */
  footer?: ReactNode;
  /** Extra classes on the outer card. */
  className?: string;
}

/** The collapsible Review/Receipt card. See {@link CollapsibleReceiptRowsProps}. */
export function CollapsibleReceiptRows({
  summary,
  details,
  after,
  showMoreLabel,
  showLessLabel,
  defaultOpen = false,
  footer,
  className,
}: CollapsibleReceiptRowsProps) {
  const [open, setOpen] = useState(defaultOpen);
  const detailsId = useId();
  const hasDetails = details.some((group) => group.length > 0);
  const hasAfter = after != null && after.some((group) => group.length > 0);
  return (
    <section className={cn("rounded-xl bg-surface-raised px-4 py-1 text-left", className)}>
      <ReceiptRows groups={summary} className={SECTION_CLASSES} />
      {hasDetails ? (
        <>
          {/* Kept mounted (hidden) so the toggle's aria-controls always resolves. */}
          <div id={detailsId} hidden={!open} className="border-border border-t">
            <ReceiptRows groups={details} className={SECTION_CLASSES} />
          </div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={detailsId}
            className="flex w-full items-center justify-center gap-1 border-border border-t py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? showLessLabel : showMoreLabel}
            <ChevronDown
              className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </>
      ) : null}
      {hasAfter ? (
        <ReceiptRows groups={after} className={cn(SECTION_CLASSES, "border-border border-t")} />
      ) : null}
      {footer ? (
        // testid lets a caller assert the footer BLOCK is absent (POO-923 R3: the pair payout drops
        // the caption AND has no arrival, so the whole bordered footer must not render).
        <div
          data-testid="receipt-footer"
          className="border-border border-t py-2.5 text-center text-muted-foreground text-xs"
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}
