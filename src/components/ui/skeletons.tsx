/**
 * @id PP-CORE-CMP-017
 * @name Skeleton building blocks
 * @implements-rules-version v1
 *
 * Composable loading-skeleton pieces built on {@link Skeleton}. Route-level `loading.tsx` files
 * compose these to mirror each screen's layout, so a navigation or data load shows a shaped
 * placeholder with no layout shift. Every piece is decorative and text-free (the underlying
 * {@link Skeleton} is `aria-hidden`), so they need no i18n and convey nothing to assistive tech.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Skeleton } from "./Skeleton";

/** Stable, non-index React keys for repeated placeholders (avoids array-index keys). */
function placeholderKeys(count: number, prefix = "sk"): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

/** Page heading: a title bar with an optional subtitle and an optional round back button. */
export function SkeletonHeading({ subtitle = true, back = false }: SkeletonHeadingProps) {
  return (
    <div className="flex items-center gap-3">
      {back ? <Skeleton width={36} height={36} radius="9999px" className="shrink-0" /> : null}
      <div className="flex flex-col gap-2">
        <Skeleton width={180} height={26} />
        {subtitle ? <Skeleton width={240} height={14} /> : null}
      </div>
    </div>
  );
}
/** Props for {@link SkeletonHeading}. */
export interface SkeletonHeadingProps {
  /** Render the smaller subtitle line under the title. */
  subtitle?: boolean;
  /** Render a round back-button placeholder before the title. */
  back?: boolean;
}

/** A metric tile placeholder (small label line over a larger value line) in a bordered box. */
export function SkeletonTile() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <Skeleton width="55%" height={12} />
      <Skeleton width="70%" height={22} className="mt-3" />
    </div>
  );
}

/** A grid of {@link SkeletonTile}s. */
export function SkeletonTiles({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {placeholderKeys(count, "tile").map((key) => (
        <SkeletonTile key={key} />
      ))}
    </div>
  );
}

/** A tall hero block (e.g. a balance/revenue header card). */
export function SkeletonHero() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 lg:p-6">
      <Skeleton width={120} height={12} />
      <Skeleton width={220} height={40} className="mt-3" />
      <Skeleton width={160} height={14} className="mt-3" />
    </div>
  );
}

/** A generic bordered card with a heading line and `lines` body lines of decreasing width. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-5", className)}>
      <Skeleton width="40%" height={16} />
      <div className="mt-4 flex flex-col gap-2.5">
        {placeholderKeys(lines, "line").map((key, index) => (
          <Skeleton key={key} width={`${88 - index * 12}%`} height={12} />
        ))}
      </div>
    </div>
  );
}

/** A list/settings row: leading square icon, two stacked lines, trailing chevron. */
export function SkeletonListRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <Skeleton width={40} height={40} radius="0.75rem" className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton width="45%" height={13} />
        <Skeleton width="68%" height={11} />
      </div>
      <Skeleton width={18} height={18} className="shrink-0" />
    </div>
  );
}

/** A stack of {@link SkeletonListRow}s. */
export function SkeletonRows({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {placeholderKeys(count, "row").map((key) => (
        <SkeletonListRow key={key} />
      ))}
    </div>
  );
}

/** A desktop table placeholder (header strip + `rows` body rows). Hidden below `lg` by default. */
export function SkeletonTable({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div
      className={cn("hidden overflow-hidden rounded-xl border border-border lg:block", className)}
    >
      <div className="border-border border-b bg-surface px-4 py-3">
        <Skeleton width="30%" height={12} />
      </div>
      {placeholderKeys(rows, "trow").map((key) => (
        <div key={key} className="flex items-center gap-4 border-border border-t px-4 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton width="40%" height={13} />
            <Skeleton width="25%" height={10} />
          </div>
          <Skeleton width={80} height={14} className="shrink-0" />
          <Skeleton width={72} height={28} radius="0.5rem" className="shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Mirrors {@link SettingsLayout}: a mobile back-link + title, a desktop left nav rail, and a detail
 * panel. Pass `children` to shape the detail; defaults to two generic section cards.
 */
export function SettingsLayoutSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
      {/* Mobile: back link + title */}
      <div className="lg:hidden">
        <Skeleton width={120} height={14} />
        <Skeleton width={180} height={26} className="mt-3" />
      </div>

      {/* Desktop: nav rail */}
      <aside className="hidden w-60 shrink-0 lg:block">
        <Skeleton width={120} height={14} className="mb-4" />
        <div className="flex flex-col gap-4">
          {placeholderKeys(3, "grp").map((group) => (
            <div key={group} className="flex flex-col gap-1.5">
              <Skeleton width="40%" height={11} className="mb-1" />
              {placeholderKeys(2, `${group}-item`).map((item) => (
                <Skeleton key={item} width="80%" height={16} />
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* Detail */}
      <div className="min-w-0 flex-1">
        <Skeleton width={180} height={26} className="mb-5 hidden lg:block" />
        <div className="flex flex-col gap-6">
          {children ?? (
            <>
              <SkeletonCard lines={3} />
              <SkeletonCard lines={2} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
