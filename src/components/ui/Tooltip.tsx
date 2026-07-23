/**
 * @id PP-CORE-CMP-015
 * @name Tooltip
 * @implements-rules-version v1
 * Tooltip primitive built on @radix-ui/react-tooltip; opens on hover and keyboard focus.
 */
"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Wraps a subtree so its tooltips share timing and singleton behavior. Place once high in the
 * tree (or per story/example). Forwards all Radix `Provider` props (delayDuration, etc.).
 */
export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Root of a single tooltip. Holds open/controlled state and pairs a trigger with its content.
 * Forwards all Radix `Root` props (open, defaultOpen, onOpenChange, delayDuration).
 */
export const Tooltip = TooltipPrimitive.Root;

/**
 * The element that, on hover or focus, reveals the tooltip. Use `asChild` to project the
 * behavior onto your own button/element. Forwards all Radix `Trigger` props.
 */
export const TooltipTrigger = TooltipPrimitive.Trigger;

/** Props for {@link TooltipContent}: Radix content props plus an optional `sideOffset`. */
export interface TooltipContentProps
  extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> {
  /** Gap in pixels between the trigger and the content. Defaults to 4. */
  sideOffset?: number;
}

/**
 * The floating tooltip surface, portaled above the page. `side` and `align` are forwarded to
 * Radix to control placement. Styled with design tokens only.
 */
export const TooltipContent = forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-xs rounded-md bg-surface-raised px-2 py-1 text-sm text-foreground shadow-md",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));

TooltipContent.displayName = "TooltipContent";
