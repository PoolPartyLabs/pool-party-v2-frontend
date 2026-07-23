/**
 * @id PP-AUTH-SCR-001
 * @name AuthMethodButton
 * @implements-rules-version v1
 * The bespoke pill buttons on the sign-in screen: a white "Continue with Google" button and a
 * translucent "Connect a wallet" button (brand-grape diamond). Token-driven, with a loading state.
 */
"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

/** Pill recipe for the two auth methods. Token utility classes only (no hardcoded hex). */
const authMethodButtonVariants = cva(
  "inline-flex h-14 w-full cursor-pointer items-center justify-center gap-3 rounded-full font-semibold text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        google: "bg-brand-foam text-brand-lagoon hover:bg-brand-foam/90",
        wallet: "border border-input bg-surface-raised/60 text-foreground hover:bg-surface-raised",
      },
    },
    defaultVariants: { variant: "google" },
  },
);

/** The multicolor Google "G" mark. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/** The leading icon for a method: spinner while loading, else the method's mark. */
function MethodIcon({ variant, loading }: { variant: "google" | "wallet"; loading: boolean }) {
  if (loading) {
    return <Loader2 className="size-5 animate-spin" aria-hidden="true" />;
  }
  if (variant === "google") {
    return <GoogleMark />;
  }
  return <span aria-hidden="true" className="size-3 rotate-45 rounded-[2px] bg-brand-grape" />;
}

/** Public props for {@link AuthMethodButton}. */
export interface AuthMethodButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof authMethodButtonVariants> {
  /** Which auth method this button represents. Defaults to `google`. */
  variant?: "google" | "wallet";
  /** When true, shows a spinner and blocks `onClick`. */
  loading?: boolean;
}

/** Pill button for a single sign-in method. */
export const AuthMethodButton = forwardRef<HTMLButtonElement, AuthMethodButtonProps>(
  (
    {
      className,
      variant = "google",
      loading = false,
      disabled,
      type = "button",
      children,
      onClick,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        type={type}
        className={cn(authMethodButtonVariants({ variant }), className)}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        onClick={(event) => {
          if (isDisabled) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        {...props}
      >
        <MethodIcon variant={variant} loading={loading} />
        {children}
      </button>
    );
  },
);

AuthMethodButton.displayName = "AuthMethodButton";
