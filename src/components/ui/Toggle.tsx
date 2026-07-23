/**
 * @id PP-CORE-CMP-008
 * @name Toggle
 * @implements-rules-version v1
 * An accessible iOS-style switch (role="switch"). Controlled; green when on.
 */
"use client";

import { cn } from "@/lib/utils/cn";

/** Public props for {@link Toggle}. */
export interface ToggleProps {
  /** Whether the toggle is on. */
  checked: boolean;
  /** Called with the next checked state. */
  onCheckedChange: (checked: boolean) => void;
  /** Accessible label (the visible row title). */
  label: string;
  /** When true, the switch is locked: greyed out and non-interactive (e.g. a not-yet-live setting). */
  disabled?: boolean;
  /**
   * Soft-disabled mode: the switch looks disabled (dimmed) but stays keyboard-FOCUSABLE, and a click
   * does nothing (`onCheckedChange` is suppressed). Mirrors {@link Button}'s `blocked`: a native
   * `disabled` switch drops out of the tab order, so a focus/hover-triggered reason (e.g. a "coming
   * soon" tooltip on the wrapper) could never be reached by keyboard. Ignored when `disabled` is true.
   */
  blocked?: boolean;
}

/** A controlled switch. */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  blocked = false,
}: ToggleProps) {
  // Soft-blocked: looks disabled but stays focusable so a wrapper hint (e.g. "coming soon") stays
  // reachable by keyboard; the click is inert. A native `disabled` always wins.
  const isBlocked = blocked && !disabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      aria-disabled={isBlocked || undefined}
      onClick={() => {
        if (isBlocked) return;
        onCheckedChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-success" : "bg-input",
        (disabled || isBlocked) && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
