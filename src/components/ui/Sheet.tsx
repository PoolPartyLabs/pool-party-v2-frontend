/**
 * @id PP-CORE-CMP-038
 * @name Sheet
 * @implements-rules-version v1
 *
 * Responsive modal surface built on @radix-ui/react-dialog (focus trap, Esc, overlay-click, and
 * portalling come from Radix). On mobile it is a bottom sheet with a grab handle and swipe-down-to-
 * dismiss (via `motion`); from `sm` up it is a centered card like {@link Dialog}. Mirrors the Dialog
 * primitive's exports so a transactional modal can adopt the sheet affordance without restructuring.
 *
 * PP-A11Y: the grabber is decorative (`aria-hidden`); dismissal is still keyboard/Esc/overlay driven,
 * and focus trap + restore are Radix's. The swipe threshold needs on-device QA (jsdom has no gestures).
 */
"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { motion, type PanInfo, useDragControls, useReducedMotion } from "motion/react";
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
  type HTMLAttributes,
  useEffect,
  useState,
} from "react";
import { cn } from "@/lib/utils/cn";

/** Root: controls open state. Pass `open`/`onOpenChange` (controlled) or `defaultOpen`. */
export const Sheet = DialogPrimitive.Root;
/** Opens the sheet when activated. */
export const SheetTrigger = DialogPrimitive.Trigger;
/** Closes the sheet when activated. */
export const SheetClose = DialogPrimitive.Close;

/** `true` once mounted on a viewport below the `sm` breakpoint (640px). SSR-safe (starts false). */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

/** Props for {@link SheetContent}. */
export interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Hide the built-in top-right close (X) button when a custom close affordance is provided. */
  showClose?: boolean;
  /** Disable swipe-to-dismiss on mobile (e.g. while a transaction is in flight). */
  disableSwipe?: boolean;
}

/** Downward drag past this many px (or a fast flick) dismisses the sheet on mobile. */
const SWIPE_CLOSE_PX = 120;
const SWIPE_CLOSE_VELOCITY = 500;

/**
 * The sheet surface: bottom-anchored + draggable on mobile, centered on desktop. Rendered in a Radix
 * Portal above a dimmed overlay with a focus trap, Esc-to-close, and overlay-click-to-close.
 */
export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, showClose = true, disableSwipe = false, ...props }, ref) => {
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const swipeable = isMobile && !disableSwipe;
  // POO-839 R2: drive the drag from the grab handle only (dragListener=false). With the listener
  // on the whole sheet, framer sets touch-action:none across it, so clipped content could never be
  // scrolled. Starting the drag from the handle keeps the body's native vertical scroll intact.
  const dragControls = useDragControls();

  function onDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.y > SWIPE_CLOSE_PX || info.velocity.y > SWIPE_CLOSE_VELOCITY) {
      // Dispatch Esc so Radix runs its close + focus-restore path (keeps a single close mechanism).
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  }

  return (
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
        asChild
        className={cn(
          // Mobile: full-width bottom sheet. Desktop (sm+): centered card.
          "fixed z-50 flex flex-col gap-4 border border-border bg-surface shadow-lg",
          // POO-839 R2: cap height + scroll so a tall sheet keeps its CTA reachable.
          "max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-[calc(100dvh-2rem)]",
          "inset-x-0 bottom-0 rounded-t-2xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[420px]",
          "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      >
        <motion.div
          initial={reduceMotion ? false : { y: isMobile ? "100%" : 0, opacity: isMobile ? 1 : 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? undefined : { y: isMobile ? "100%" : 0, opacity: isMobile ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
          drag={swipeable ? "y" : false}
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={swipeable ? onDragEnd : undefined}
        >
          {/* Grab handle — mobile only, decorative. It is the ONLY drag starter (POO-839 R2): a
              full-width top strip with a touch-action:none lock so a downward pan here dismisses the
              sheet, while pans over the body below scroll it natively. */}
          <div
            aria-hidden="true"
            onPointerDown={swipeable ? (event) => dragControls.start(event) : undefined}
            style={swipeable ? { touchAction: "none" } : undefined}
            className="-mt-1 mb-1 flex shrink-0 cursor-grab justify-center py-2 sm:hidden"
          >
            <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          {children}
          {showClose ? (
            <DialogPrimitive.Close
              className={cn(
                "absolute right-4 top-4 rounded-sm text-muted-foreground transition-colors",
                "hover:text-foreground focus-visible:outline-none focus-visible:ring-2",
                "focus-visible:ring-ring disabled:pointer-events-none",
                // POO-840 R2: ::after hit-area takes the 16px X to a ~44px touch target
                // (icon position unchanged).
                "after:absolute after:-inset-3.5 after:content-['']",
              )}
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          ) : null}
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = "SheetContent";

/** Leading section (title + description); centered on mobile, left-aligned from `sm` up. */
export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)} {...props} />
  );
}
SheetHeader.displayName = "SheetHeader";

/** Trailing actions; stacked on mobile, row-aligned to the end from `sm` up. */
export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
SheetFooter.displayName = "SheetFooter";

/** Accessible title, wired via `aria-labelledby` by Radix. */
export const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-semibold text-foreground text-lg", className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

/** Supporting description, wired via `aria-describedby` by Radix. */
export const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;
