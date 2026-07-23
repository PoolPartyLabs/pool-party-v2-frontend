/**
 * @id PP-CORE-CMP-035
 * @name CollapsibleCard
 * @implements-rules-version v1
 *
 * A titled card whose body collapses behind its header. The header (title + optional `aside`) stays
 * visible and toggles the body; an chevron rotates to signal the state. Open by default. Used for the
 * manager strategy-detail sections (About / Composition / Investment mandate / Range / Recent activity
 * / Investors) — every card there except the always-open Performance hero. Presentational and
 * props-based: the consumer passes an already-translated `title` (mirrors EyeToggle / EmptyState).
 */
"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link CollapsibleCard}. */
export interface CollapsibleCardProps {
  /** Already-translated card title shown in the (always-visible) header. */
  title: string;
  /** Whether the body starts expanded. Defaults to open. */
  defaultOpen?: boolean;
  /**
   * Optional already-rendered content shown in the header beside the title (e.g. a status chip).
   * Keep it non-interactive — the whole header is a toggle button.
   */
  aside?: ReactNode;
  /**
   * Optional content shown *only when collapsed*, below the header (a compact preview of the body,
   * e.g. a range bar without its numbers). Hidden when expanded, where `children` takes over.
   */
  peek?: ReactNode;
  /** The collapsible body. */
  children: ReactNode;
  /** Extra classes on the outer card. */
  className?: string;
}

/** A card with a collapsible body. See {@link CollapsibleCardProps}. */
export function CollapsibleCard({
  title,
  defaultOpen = true,
  aside,
  peek,
  children,
  className,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("rounded-xl border border-border bg-surface", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex flex-1 flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-foreground">{title}</h3>
          {aside}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-4 px-5 pb-5">{children}</div>
      ) : peek ? (
        // Collapsed preview: a compact glance at the body (no interactive content).
        <div className="px-5 pb-5">{peek}</div>
      ) : null}
    </section>
  );
}
