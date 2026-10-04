/**
 * @id PP-MGR-CMP-071
 * @name RangeSplitBar
 * @implements-rules-version v1 (POO-2189)
 * @analytics-events none (the panel shell emits)
 * Estimated token value split and current price marker in the displayed orientation.
 */
"use client";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import type { PanelToken } from "./panelCatalogView";
import type { RangeMarker, RangeSplit } from "./poolRangeMath";

export interface RangeSplitBarProps {
  base: PanelToken;
  quote: PanelToken;
  split: RangeSplit;
  marker: RangeMarker;
  fullRange: boolean;
}
export function RangeSplitBar({ base, quote, split, marker, fullRange }: RangeSplitBarProps) {
  const markerX = Math.min(
    200,
    Math.max(0, (fullRange ? 0 : 40) + marker.ratio * (fullRange ? 200 : 120)),
  );
  return (
    <div className="flex items-center justify-between gap-2">
      <TokenLogo symbol={base.symbol} className="size-[18px] shrink-0" />
      <span className="w-8 shrink-0 text-right text-xs lining-nums tabular-nums">
        {split.basePct}%
      </span>
      <span aria-hidden="true" className="relative h-3.5 w-[200px] shrink-0">
        <span className="absolute top-1 h-1.5 w-full rounded-full bg-surface-raised" />
        <span
          className="absolute top-1 h-1.5 rounded-full bg-primary"
          style={{ left: fullRange ? 0 : 40, width: fullRange ? 200 : 120 }}
        />
        <span
          data-range-marker=""
          className="absolute top-0 h-3.5 w-0.5 bg-foreground"
          style={{ left: markerX, transform: "translateX(-50%)" }}
        />
      </span>
      <span className="w-8 shrink-0 text-xs lining-nums tabular-nums">{split.quotePct}%</span>
      <TokenLogo symbol={quote.symbol} className="size-[18px] shrink-0" />
    </div>
  );
}
