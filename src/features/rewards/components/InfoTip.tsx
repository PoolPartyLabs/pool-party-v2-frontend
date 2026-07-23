/**
 * @id PP-REW-CMP-016
 * @name InfoTip
 * @implements-rules-version v1
 *
 * A small "(i)" tooltip trigger for stat sublabels (design-policies P3): hover or keyboard focus
 * reveals a short explanation. The info text doubles as the trigger's accessible name, so screen
 * readers get the explanation even without opening the tooltip.
 */
"use client";

import { Info } from "lucide-react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";

/** Public props for {@link InfoTip}. */
export interface InfoTipProps {
  /** The explanation shown in the tooltip (also the trigger's aria-label). */
  text: string;
}

/** An "(i)" icon that reveals a short explanation on tap, hover, or focus. */
export function InfoTip({ text }: InfoTipProps) {
  // POO-840 R5: Radix tooltips never open on a plain tap, so the open state is controlled —
  // onClick opens it on touch while Radix keeps hover/focus and outside-tap/Esc close via
  // onOpenChange (the AprTooltip POO-485 pattern). This is the only explanation of the Manager
  // Incentive Program stats, so it must be reachable on phones.
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={text}
            onClick={() => setOpen(true)}
            // POO-840 R2: ::after hit-area takes the 14px icon to a ~44px touch target without
            // changing its visual size or the surrounding layout.
            className="relative inline-flex shrink-0 rounded-full text-muted-foreground transition-colors after:absolute after:-inset-3.5 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
