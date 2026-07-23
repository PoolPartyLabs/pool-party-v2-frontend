/**
 * @id PP-DEP-CMP-001
 * @name AmountKeypad
 * @implements-rules-version v1
 *
 * The custom in-app numeric keypad (Cash App / Revolut style) used for amount entry on mobile, so we
 * never raise the device keyboard. Emits raw keys ("0"–"9", ".", "backspace"); the parent owns the
 * amount string and decides how to apply them. Desktop uses a typed input instead (this is hidden).
 */
"use client";

import { Delete } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Keys in display order (3 columns). */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"] as const;

/** Public props for {@link AmountKeypad}. */
export interface AmountKeypadProps {
  /** Called with the pressed key: a digit, ".", or "backspace". */
  onKey: (key: string) => void;
  /** Extra classes on the grid. */
  className?: string;
}

/** A 3×4 numeric keypad. */
export function AmountKeypad({ onKey, className }: AmountKeypadProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onKey(key)}
          aria-label={key === "backspace" ? "Delete" : key}
          className="flex h-12 items-center justify-center rounded-lg font-medium text-foreground text-xl transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {key === "backspace" ? <Delete className="size-5" aria-hidden="true" /> : key}
        </button>
      ))}
    </div>
  );
}
