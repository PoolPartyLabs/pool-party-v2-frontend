/**
 * @id PP-MGR-CMP-065
 * @name PanelStatusRow
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, presentational. Discard reports `builder_block_discarded` through the
 *   panel's draft (`usePanelDraft`), and the notice's `builder_block_leave_blocked` fires where the
 *   refusal happens; the Build screen (PP-MGR-SCR-002) emits both.
 *
 * The row above Apply changes (handoff P5), always present in Mode 4, in one of three states:
 *
 * - `pending` (the draft differs from what is applied): a 6 px `primary` dot and "Changes not
 *   applied" on the left, a text button "Discard" on the right.
 * - `applied`: a 14 px check in `success` and "All changes applied" (muted).
 * - `leaveBlocked` (P6): the row becomes a notice: a box (radius 12, `surface-raised`, 1 px `warning`
 *   stroke, padding 16, gap 8) with its title, its body and the outline pill "Discard changes". It is
 *   `role="alert"`, and on every refused exit (`attempt` changes) it scrolls into view and takes
 *   focus: the panel can be taller than the viewport, and the click that was refused would otherwise
 *   look like nothing happened.
 *
 * Props only: the strings arrive translated, Discard is the caller's.
 */
"use client";

import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { OUTLINE_PILL, PANEL_FOCUS_RING } from "./panelStyles";

/** P5: the three states of the row. */
export type PanelStatus = "pending" | "applied" | "leaveBlocked";

/** Public props for {@link PanelStatusRow}. */
export interface PanelStatusRowProps {
  status: PanelStatus;
  copy: {
    /** "Changes not applied". */
    pending: string;
    /** "All changes applied". */
    applied: string;
    /** "Discard". */
    discard: string;
    /** The notice's title, body and pill (P6). */
    leaveTitle: string;
    leaveBody: string;
    leaveDiscard: string;
  };
  /** Discard the draft: back to the applied values (and, from the notice, on with the navigation). */
  onDiscard(): void;
  /** A counter the caller bumps on every refused exit, so the notice comes back into view each time. */
  attempt?: number;
}

/** The status row of the configuration panel. */
export function PanelStatusRow({ status, copy, onDiscard, attempt = 0 }: PanelStatusRowProps) {
  const notice = useRef<HTMLDivElement>(null);

  // [P6] Each refusal (a new `attempt`) brings the notice into view and moves focus to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the trigger, read on purpose.
  useEffect(() => {
    if (status !== "leaveBlocked") return;
    const node = notice.current;
    if (!node) return;
    node.scrollIntoView?.({ block: "nearest" });
    node.focus({ preventScroll: true });
  }, [status, attempt]);

  if (status === "leaveBlocked") {
    return (
      <div
        ref={notice}
        role="alert"
        tabIndex={-1}
        data-panel-status="leaveBlocked"
        className={cn(
          "flex flex-col items-start gap-2 rounded-xl border border-warning bg-surface-raised p-4",
          PANEL_FOCUS_RING,
        )}
      >
        <p className="font-medium text-foreground text-sm">{copy.leaveTitle}</p>
        <p className="text-muted-foreground text-xs">{copy.leaveBody}</p>
        <button type="button" onClick={onDiscard} className={OUTLINE_PILL}>
          {copy.leaveDiscard}
        </button>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div data-panel-status="pending" className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-foreground text-xs">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
          {copy.pending}
        </span>
        <button
          type="button"
          onClick={onDiscard}
          className={cn(
            "rounded-sm font-medium text-foreground text-xs hover:underline",
            PANEL_FOCUS_RING,
          )}
        >
          {copy.discard}
        </button>
      </div>
    );
  }

  return (
    <div
      data-panel-status="applied"
      className="flex items-center gap-2 text-muted-foreground text-xs"
    >
      <Check aria-hidden="true" className="size-3.5 shrink-0 text-success" />
      {copy.applied}
    </div>
  );
}
