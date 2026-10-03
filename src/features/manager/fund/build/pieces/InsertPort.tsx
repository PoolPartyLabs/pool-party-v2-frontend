/**
 * @id PP-MGR-CMP-052
 * @name InsertPort
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; a press is reported through `onActivate` and the
 *   Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The small dashed "+" on the top or bottom edge of a configured position card, where a block can
 * be inserted in that chain (handoff v1.2 [BB7], [C17], [I4]). Where it sits and which slot it opens
 * is the layout's (S3) and the registry's (S5) business; this piece only draws it.
 *
 * A 16 px circle on `background`, a 1 px dashed (3 3) `muted-foreground` stroke drawn inside, a
 * plus of 8. Active (its menu is open, or it is a valid drop target): stroke and plus in `primary`.
 * Always visible, not on hover only (C17).
 *
 * A button named by its tooltip (I10, C19): the tooltip names what the slot's menu offers (D13,
 * "Insert a flow block: Swap"). A press hands the port itself to the renderer as the menu's anchor.
 * It carries `data-canvas-interactive`, so a press on it never pans.
 */
"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { canvasInteractive, PieceStroke, PieceTooltip } from "./pieceParts";

/** Public props for {@link InsertPort}. */
export interface InsertPortProps {
  /** One line, also the button's name: "Insert a flow block: Swap". */
  tooltip: string;
  /** Its menu is open or it is a valid drop target. */
  active: boolean;
  /** Opens the port menu; receives the port as the anchor. */
  onActivate(anchor: HTMLElement): void;
}

/** An insert port, 16 px. */
export function InsertPort({ tooltip, active, onActivate }: InsertPortProps) {
  const tone = active ? "text-primary" : "text-muted-foreground";
  return (
    <PieceTooltip content={tooltip}>
      <button
        type="button"
        {...canvasInteractive}
        data-insert-port=""
        data-active={active ? "" : undefined}
        aria-label={tooltip}
        aria-haspopup="menu"
        onClick={(event) => onActivate(event.currentTarget)}
        className="relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PieceStroke width={1} radius={8} dash="3 3" className={tone} />
        <Plus
          aria-hidden="true"
          size={8}
          strokeWidth={2.5}
          absoluteStrokeWidth
          className={cn("transition-colors motion-reduce:transition-none", tone)}
        />
      </button>
    </PieceTooltip>
  );
}
