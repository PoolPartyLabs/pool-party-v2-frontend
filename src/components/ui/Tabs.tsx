"use client";

/**
 * @id PP-CORE-CMP-014
 * @name Tabs
 * @implements-rules-version v1
 * Accessible tab primitive (Root/List/Trigger/Content) built on Radix, token-styled.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Root container for a set of tabs. Controlled via `value` + `onValueChange`, or uncontrolled
 * via `defaultValue`. Forwards all native Radix Root props (orientation, dir, activationMode).
 */
export const Tabs = forwardRef<
  ElementRef<typeof TabsPrimitive.Root>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Root ref={ref} className={cn("flex flex-col gap-4", className)} {...props} />
));
Tabs.displayName = "Tabs";

/**
 * The horizontal list that holds the triggers. Renders with role="tablist" from Radix and
 * provides the surface track the active trigger sits on.
 */
export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-lg bg-surface p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

/**
 * A single selectable tab. Active state lifts to `bg-surface-raised` with `text-foreground`;
 * inactive triggers use `text-muted-foreground`. Keyboard navigation is handled by Radix.
 */
export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5",
      "text-sm font-medium text-muted-foreground transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-surface-raised data-[state=active]:text-foreground",
      "data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

/**
 * The panel associated with a trigger. Only the panel matching the active value is rendered
 * visible by Radix; the rest are hidden. Receives a focus ring when focused programmatically.
 */
export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
