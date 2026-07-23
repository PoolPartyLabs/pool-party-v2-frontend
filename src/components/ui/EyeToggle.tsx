/**
 * @id PP-CORE-CMP-029
 * @name EyeToggle
 * @implements-rules-version v1
 *
 * Eye / eye-off icon button that flips the nearest mask provider ({@link useMaskValue}). Pass an
 * already-translated `label` for the aria-label (mirrors the props-in-i18n convention of EmptyState /
 * ImageCropModal). Place one per masked scope (per section in the manager, once per page elsewhere).
 */
"use client";

import { Eye, EyeOff } from "lucide-react";
import { useMaskValue } from "@/lib/hooks/maskValue";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link EyeToggle}. */
export interface EyeToggleProps {
  /** Already-translated aria-label (e.g. "Hide values"). */
  label: string;
  /** Extra classes on the button. */
  className?: string;
}

/** Toggles value masking for the nearest {@link useMaskValue} scope. */
export function EyeToggle({ label, className }: EyeToggleProps) {
  const { masked, toggle } = useMaskValue();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={masked}
      aria-label={label}
      className={cn(
        "inline-flex items-center text-muted-foreground transition-colors hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {masked ? (
        <EyeOff className="size-4" aria-hidden="true" />
      ) : (
        <Eye className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
