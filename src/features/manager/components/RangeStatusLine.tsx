/**
 * @id PP-MGR-SCR-002
 * @name RangeStatusLine
 * @implements-rules-version v1
 *
 * POO-278 [R6] / POO-236: the live in/out-of-range status line shown under a price-range editor.
 * `in` renders the success treatment; `below` / `above` both render a directionless "Out of range"
 * warning. POO-337 (2026-06-26): the spelled-out direction ("— below" / "— above") was removed from
 * the UI everywhere — the underlying `getRangeStatus` direction stays (it still drives the seed-token
 * side), it's just not surfaced here. Renders nothing while the range is undecidable (`status === null`).
 */
"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import type { RangeStatus } from "@/lib/utils/rangeStatus";

/** Public props for {@link RangeStatusLine}. */
export interface RangeStatusLineProps {
  /** The computed range status, or null when the range is incomplete. */
  status: RangeStatus | null;
  /** Extra classes merged after the defaults. */
  className?: string;
}

/** Live range status: ● In range / ● Out of range (no direction). */
export function RangeStatusLine({ status, className }: RangeStatusLineProps) {
  const t = useTranslations("manager");
  if (status === null) return null;
  const inRange = status === "in";
  const label = inRange ? t("mandate.rangeStatusIn") : t("mandate.rangeStatusOut");
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-xs",
        inRange ? "text-success" : "text-warning",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", inRange ? "bg-success" : "bg-warning")}
      />
      {label}
    </p>
  );
}
