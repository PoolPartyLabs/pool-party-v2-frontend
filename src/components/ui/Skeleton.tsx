/**
 * @id PP-CORE-CMP-017
 * @name Skeleton
 * @implements-rules-version v1
 * Presentational loading placeholder with a pulsing surface and configurable dimensions.
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/** Props for the {@link Skeleton} placeholder; forwards all native `<div>` attributes. */
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** CSS `width` applied via inline style (e.g. `120`, `"100%"`, `"8rem"`). */
  width?: string | number;
  /** CSS `height` applied via inline style (e.g. `16`, `"1rem"`). */
  height?: string | number;
  /** CSS `border-radius` applied via inline style; e.g. `"9999px"` for a circle or `0` for a square. */
  radius?: string | number;
}

/**
 * Pulsing placeholder shown while real content loads. Defaults to a rounded bar; pass `width`,
 * `height`, and `radius` to shape it into lines, boxes, or circles. Hidden from assistive tech
 * via `aria-hidden` and `role="presentation"` since it conveys no meaningful content.
 */
export function Skeleton({ width, height, radius, className, style, ...props }: SkeletonProps) {
  const dimensionStyle: CSSProperties = {
    width,
    height,
    borderRadius: radius,
    ...style,
  };

  return (
    <div
      aria-hidden="true"
      role="presentation"
      className={cn("animate-pulse rounded-md bg-surface-raised", className)}
      style={dimensionStyle}
      {...props}
    />
  );
}
