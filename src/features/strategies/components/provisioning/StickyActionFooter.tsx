/**
 * @id PP-STR-CMP-027
 * @name StickyActionFooter
 * @implements-rules-version v1 (POO-1525 rules v1)
 * @analytics-events none, deliberately. Purely a layout wrapper around whatever CTA the caller already
 *   renders (and already instruments, or deliberately does not — `FundingRoutePicker`'s own screen has
 *   none).
 *
 * POO-1525 [M3.3]/[M3.5]/[M3.6]: pins a phase's terminal action(s) to the bottom of the panel's HOST
 * scroll container below `sm`, so the amount and the button that commits it can always be on screen
 * together, even on the tallest state (`2c`, ~1039px against an 812px phone viewport).
 *
 * The scroll container is never this component's own: `Dialog.tsx` / `Sheet.tsx` already put
 * `overflow-y-auto` on the element every host mounts `ProvisioningPanel` inside, so `position: sticky`
 * anchors correctly with no new wrapper anywhere in the six hosts (confirmed against both today's
 * `DialogContent` and the `SheetContent` `#856` introduces — same overflow pattern on both).
 *
 * Above `sm` the panel sits in a fixed-size card with none of this pressure (POO-839 caps height, but
 * a desktop card never approaches these figures): `sm:static` returns the footer to normal flow,
 * `sm:border-t-0 sm:pb-0 sm:pt-0 sm:shadow-none` strip every mobile-only cue, so nothing above `sm`
 * changes from before this issue.
 */
"use client";

import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { useStickyFooterShadow } from "./useStickyFooterShadow";

export interface StickyActionFooterProps {
  /** The phase's own CTA(s), unmodified: this wraps, it never re-renders what a button does. */
  children: ReactNode;
  className?: string;
}

/** Wrap a phase's terminal CTA(s) so it stays reachable while its screen's body scrolls (POO-1525). */
export function StickyActionFooter({ children, className }: StickyActionFooterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isStuck = useStickyFooterShadow(ref);

  return (
    <div
      ref={ref}
      data-testid="provisioning-sticky-footer"
      data-stuck={isStuck ? "true" : "false"}
      className={cn(
        "sticky bottom-0 flex flex-col gap-2 bg-surface pt-4",
        // [M3.6] Live: POO-1523 landed `viewportFit: "cover"` on the root layout (PR #854), so
        // `env(safe-area-inset-bottom)` reserves the real inset on notched iOS and resolves to
        // plain `1rem` everywhere else. The class lives HERE because the inset belongs to the
        // footer, not the sheet root: the footer's own background is what has to reach the notch,
        // not empty trailing padding on a container this component does not own.
        "pb-[max(1rem,env(safe-area-inset-bottom))]",
        // [M3.5] The border is unconditional (the footer must read as opaque at rest, not only once
        // "stuck"); the shadow is the one piece that tracks the scroll container's own position.
        "border-t border-border",
        isStuck && "shadow-[0_-8px_16px_-8px_rgba(0,0,0,0.35)]",
        "sm:static sm:border-t-0 sm:bg-transparent sm:pt-0 sm:pb-0 sm:shadow-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
