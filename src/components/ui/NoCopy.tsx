/**
 * @id PP-CORE-CMP-055
 * @name NoCopy
 * @implements-rules-version v1
 * Wraps content so it cannot be selected or copied: applies `select-none` and cancels the copy, cut,
 * context-menu and drag events. This is a client-side deterrent only, it cannot stop a determined
 * user (screenshots, reader mode, or disabling JavaScript still work). Used by the legal pages
 * (Risk disclosure, and later Terms of Service and Privacy Policy).
 */
"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link NoCopy}. Forwards every native div attribute. */
export interface NoCopyProps extends HTMLAttributes<HTMLDivElement> {}

/**
 * Region whose text cannot be selected or copied. Each blocked event still forwards to a
 * consumer-supplied handler (after `preventDefault`) so composition is preserved.
 */
export const NoCopy = forwardRef<HTMLDivElement, NoCopyProps>(function NoCopy(
  { className, onCopy, onCut, onContextMenu, onDragStart, children, ...props },
  ref,
) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the copy/cut/context-menu/drag handlers are defensive (preventDefault only), not user affordances; this stays a plain text container.
    <div
      ref={ref}
      className={cn("select-none", className)}
      onCopy={(event) => {
        event.preventDefault();
        onCopy?.(event);
      }}
      onCut={(event) => {
        event.preventDefault();
        onCut?.(event);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.(event);
      }}
      onDragStart={(event) => {
        event.preventDefault();
        onDragStart?.(event);
      }}
      {...props}
    >
      {children}
    </div>
  );
});

NoCopy.displayName = "NoCopy";
