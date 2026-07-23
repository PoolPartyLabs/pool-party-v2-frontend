/**
 * @id PP-CORE-CMP-013
 * @name Dialog
 * @implements-rules-version v1
 * Accessible modal dialog primitive built on @radix-ui/react-dialog (focus trap, Esc, overlay
 * click, and portalling come from Radix); styled with Pool Party design tokens.
 */
"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
  type HTMLAttributes,
} from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Root of the dialog. Controls open state and wires the trigger, content, and close together.
 * Pass `open`/`onOpenChange` to control it, or `defaultOpen` for an uncontrolled dialog.
 */
export const Dialog = DialogPrimitive.Root;

/**
 * The element that opens the dialog when activated. Renders a native `<button>` by default;
 * pass `asChild` to merge the trigger behavior onto a custom child element.
 */
export const DialogTrigger = DialogPrimitive.Trigger;

/**
 * Closes the dialog when activated. Renders a native `<button>` by default; pass `asChild` to
 * merge close behavior onto a custom child (e.g. a footer action button).
 */
export const DialogClose = DialogPrimitive.Close;

/**
 * Props for {@link DialogContent}. Forwards all native props of the underlying Radix Content.
 */
export interface DialogContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Hide the built-in top-right close (X) button when a custom close affordance is provided. */
  showClose?: boolean;
}

/**
 * The dialog surface, rendered in a Radix Portal above a dimmed overlay. Includes a focus trap,
 * Esc-to-close, and overlay-click-to-close out of the box. Renders a top-right X close button
 * unless `showClose` is set to false.
 */
export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
      )}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // POO-839 R1: cap height + scroll so content taller than the viewport keeps its CTA
        // reachable (a short phone no longer clips both edges). R3: w-[calc(100%-2rem)] keeps a
        // 1rem gutter each side below max-w-lg, never flush against the physical screen edge.
        "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
        "max-h-[calc(100dvh-2rem)] overflow-y-auto",
        "border border-border bg-surface p-6 rounded-lg shadow-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
        className,
      )}
      {...props}
    >
      {children}
      {showClose ? (
        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 top-4 rounded-sm text-muted-foreground transition-colors",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-ring disabled:pointer-events-none",
            // POO-840 R2: ::after hit-area takes the 16px X to a ~44px touch target (icon
            // position unchanged) — since POO-801 it is the only dismissal of success receipts.
            "after:absolute after:-inset-3.5 after:content-['']",
          )}
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * Layout container for the dialog's leading section (title + description). Stacks its children
 * and centers them on small screens, left-aligning from `sm` upward.
 */
export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)} {...props} />
  );
}
DialogHeader.displayName = "DialogHeader";

/**
 * Layout container for the dialog's trailing actions. Stacks buttons in reverse on small screens
 * and aligns them to the end of a row from `sm` upward.
 */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
DialogFooter.displayName = "DialogFooter";

/**
 * Accessible title of the dialog, wired to the dialog via `aria-labelledby` by Radix.
 */
export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

/**
 * Supporting description of the dialog, wired via `aria-describedby` by Radix.
 */
export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
