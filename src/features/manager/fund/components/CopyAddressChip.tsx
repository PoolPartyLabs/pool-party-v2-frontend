/**
 * @id PP-MGR-CMP-043
 * @name CopyAddressChip
 * @implements-rules-version v1
 * @analytics-events none, the shell emits
 *
 * POO-2125 [R11], epic POO-2119. A shortened contract address that copies the real one.
 *
 * Every pool card on the Mandate's Pools step prints two token addresses, and an address is the one
 * thing on that screen a manager cannot verify from the screen itself: `WETH` is a name anyone can
 * mint, the address is what a block explorer answers for. So the address is shown, and it is shown
 * shortened because two full 42-character strings would be the widest thing on the card.
 *
 * That shortening is also the hazard this component exists to close. `0xaf88…5831` pasted anywhere
 * resolves to nothing, so the text on screen and the text on the clipboard MUST differ: the ellipsis
 * is drawn, the full `address` is written. Nothing here ever hands the shortened form to the
 * clipboard.
 *
 * **A refused write says nothing.** `navigator.clipboard` is absent in an insecure context and
 * rejects inside several in-app WebViews, and a chip that flipped to Check regardless would be
 * asserting a copy that did not happen. The failure is swallowed rather than toasted (R11): the
 * address stays on screen to select by hand, which is the fallback a manager already knows.
 *
 * The acknowledgement is a controlled Radix tooltip rather than a hover one. It is not a hint about
 * what the button does, it is the answer to a click, so it opens on the copy and closes itself 1.5 s
 * later; the Check icon carries the same answer for anyone the tooltip does not reach.
 *
 * It is said a third time, in an `sr-only` polite live region, because the first two are visual: the
 * tooltip is read only if focus happens to be where it opened, and an icon swap is announced by
 * nothing at all. The a11y checklist asks copy controls to announce success through a live region
 * rather than through a check mark, so the STATE CHANGE is what speaks.
 */
"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";

/** How long the Check and the "Copied" tooltip stay up, per R11. */
const COPIED_RESET_MS = 1500;

/** Leading characters kept (`0x` plus four), matching the app's address convention. */
const HEAD = 6;

/** Trailing characters kept. */
const TAIL = 4;

/**
 * `0xaf88…5831`, or the whole string when it is already shorter than the two ends plus an ellipsis.
 *
 * Exported so the shortening is unit-testable without a render, and so nothing else in the step
 * re-derives it with a different arithmetic.
 */
export function shortenAddress(address: string): string {
  return address.length > HEAD + TAIL
    ? `${address.slice(0, HEAD)}…${address.slice(-TAIL)}`
    : address;
}

/** Public props for {@link CopyAddressChip}. */
export interface CopyAddressChipProps {
  /** The FULL address. Drawn shortened, written to the clipboard whole. */
  address: string;
  /** Extra classes on the chip. */
  className?: string;
}

/** A shortened token address that copies the full one on click (R11). */
export function CopyAddressChip({ address, className }: CopyAddressChipProps) {
  const t = useTranslations("manager");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A chip unmounted inside the 1.5 s window (a pool added, a tab switched, a search refetched)
  // would otherwise leave a timer that sets state on a gone component.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      // NOT `navigator.clipboard?.writeText(...)`. That form returns `undefined` where there is no
      // clipboard, `await undefined` RESOLVES, and the chip would then flip to Check and say
      // "Copied" in exactly the browsers that copied nothing (an insecure context, several in-app
      // WebViews). A missing clipboard is a failed copy and takes the same path as a refused one.
      const clipboard = navigator.clipboard;
      if (!clipboard) return;
      await clipboard.writeText(address);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // R11: swallowed on purpose. No toast, no state change; the address stays selectable by hand.
    }
  }

  return (
    <TooltipProvider>
      {/* Controlled: this is the answer to a click, not a hover hint, so it opens on the copy and
          closes with the Check. `onOpenChange` is deliberately absent: a hover must not open an
          acknowledgement of something that did not happen. */}
      <Tooltip open={copied}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("fundBuilder.common.copyAddress")}
            onClick={() => {
              void copy();
            }}
            className={cn(
              // 32 px hit area (R11): the text alone is 16 px tall, which is under every touch
              // guideline, so the padding is the control rather than an aesthetic.
              "inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-mono text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              copied ? "text-success" : "text-muted-foreground hover:text-foreground",
              className,
            )}
          >
            {shortenAddress(address)}
            {copied ? (
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5 shrink-0" aria-hidden="true" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t("fundBuilder.common.copied")}
        </TooltipContent>
      </Tooltip>
      {/* PP-A11Y: the Check icon and a tooltip anchored to the trigger are both visual. The tooltip
          is read only if focus happens to be where it opened, and an icon swap is announced by
          nothing, so the STATE CHANGE speaks here instead. A span rather than a p: the chip sits
          inside the pool card's inline text, where a block element is invalid nesting. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t("fundBuilder.common.copied") : ""}
      </span>
    </TooltipProvider>
  );
}
