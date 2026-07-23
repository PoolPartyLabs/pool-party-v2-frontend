/**
 * @id PP-CORE-CMP-010
 * @name Button
 * @implements-rules-version v1
 * Core button primitive with cva-driven variants, sizes, and a loading state.
 */
"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { type ButtonHTMLAttributes, forwardRef, type MouseEvent } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Variant + size recipe for the Button. Token utility classes only (no hardcoded hex).
 * Shared base covers layout, focus ring, rounded corners, and disabled affordance.
 */
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "bg-transparent hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

/** Public props for {@link Button}. */
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Visual style of the button. Defaults to `primary`. */
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  /** Control height, padding, and text size. Defaults to `md`. */
  size?: "sm" | "md" | "lg";
  /**
   * When true, renders a spinner, disables the button, and blocks `onClick`.
   * The button is also disabled (and `onClick` blocked) when `disabled` is true.
   */
  loading?: boolean;
  /**
   * Soft-disabled mode: the button looks disabled (dimmed) but stays focusable and tappable, and a
   * click fires {@link onBlockedClick} instead of `onClick`. Use to reveal *why* a primary CTA is
   * not yet actionable (e.g. which required fields are missing) — a native `disabled` button can't
   * be tapped or focused, so it can't surface a reason. Ignored when `disabled` or `loading`.
   */
  blocked?: boolean;
  /** Fired when the button is clicked while `blocked` (and not disabled/loading). */
  onBlockedClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Button primitive. Forwards all native button props; `type` defaults to `"button"`.
 * `onClick` is suppressed while `disabled` or `loading` is true.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      blocked = false,
      disabled,
      type = "button",
      children,
      onClick,
      onBlockedClick,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    // Soft-blocked: looks disabled but stays tappable/focusable so it can reveal why (mobile-first).
    const isBlocked = blocked && !isDisabled;

    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={isDisabled}
        aria-disabled={isBlocked || undefined}
        aria-busy={loading || undefined}
        onClick={(event) => {
          if (isDisabled) {
            event.preventDefault();
            return;
          }
          if (isBlocked) {
            event.preventDefault();
            onBlockedClick?.(event);
            return;
          }
          onClick?.(event);
        }}
        {...props}
      >
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
