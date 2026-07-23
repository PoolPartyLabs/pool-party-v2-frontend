/**
 * @id PP-CORE-CMP-028
 * @name MaskableValue
 * @implements-rules-version v1
 *
 * Wraps a rendered value (USD, %, a price range, etc.) so it shows as dots when the nearest mask
 * provider (see {@link useMaskValue}) is on. Masking lives at the render layer, so the formatters
 * stay pure and only the boolean preference is ever persisted, so no value is stored.
 */
"use client";

import type { ReactNode } from "react";
import { useMaskValue } from "@/lib/hooks/maskValue";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link MaskableValue}. */
export interface MaskableValueProps {
  /** The value to show when not masked. */
  children: ReactNode;
  /** Extra classes on the dot placeholder. */
  className?: string;
  /** The masked glyph run (defaults to four dots). */
  dots?: string;
}

/** Renders `children` normally, or a dot placeholder when the scope is masked. */
export function MaskableValue({ children, className, dots = "••••" }: MaskableValueProps) {
  const { masked } = useMaskValue();
  if (!masked) return <>{children}</>;
  return (
    <span aria-hidden="true" className={cn("select-none tracking-widest", className)}>
      {dots}
    </span>
  );
}
