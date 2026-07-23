/**
 * @id PP-CORE-CMP-016
 * @name Toast
 * @implements-rules-version v1
 * Toast primitive built on sonner: a dark-themed <Toaster /> wired to Pool Party design tokens,
 * plus a re-exported `toast` imperative API for triggering notifications anywhere.
 */
"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { cn } from "@/lib/utils/cn";

/**
 * Maps sonner's internal CSS custom properties onto Pool Party design tokens so toasts inherit
 * the live theme instead of sonner's built-in palette. Cast to React.CSSProperties because these
 * are sonner-specific custom properties, not standard style keys.
 */
const toasterTokenStyle = {
  "--normal-bg": "var(--color-surface-raised)",
  "--normal-text": "var(--color-foreground)",
  "--normal-border": "var(--color-border)",
  "--success-bg": "var(--color-surface-raised)",
  "--success-text": "var(--color-success)",
  "--success-border": "var(--color-border)",
  "--error-bg": "var(--color-surface-raised)",
  "--error-text": "var(--color-destructive)",
  "--error-border": "var(--color-border)",
  "--info-bg": "var(--color-surface-raised)",
  "--info-text": "var(--color-foreground)",
  "--info-border": "var(--color-border)",
} as React.CSSProperties;

/** Public props for {@link Toaster}. Forwards all of sonner's `ToasterProps`. */
export type ToastProps = ToasterProps;

/**
 * Themed sonner Toaster. Mount this once near the root of the app (e.g. in the root layout) so the
 * imperative {@link toast} API has a render target. Defaults to dark theme and bottom-right
 * placement; both, and every other sonner prop, can be overridden by the consumer.
 */
export function Toaster({ className, style, theme = "dark", ...props }: ToastProps) {
  return (
    <SonnerToaster
      theme={theme}
      className={cn("toaster group", className)}
      style={{ ...toasterTokenStyle, ...style }}
      {...props}
    />
  );
}
Toaster.displayName = "Toaster";

/**
 * Imperative toast API re-exported from sonner. Call `toast.success(...)`, `toast.error(...)`,
 * `toast.info(...)`, etc. from any client component to enqueue a notification on the mounted
 * {@link Toaster}.
 */
export { toast } from "sonner";
