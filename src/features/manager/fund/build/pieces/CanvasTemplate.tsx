/**
 * @id PP-MGR-CMP-055
 * @name CanvasTemplate
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, presentational pieces; a press is reported through `onActivate` and the
 *   Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The two templates of the Build canvas, the dashed "+" that creates something (handoff v1.2
 * [BB6], [C15]). Two shapes, never the same:
 *
 * - {@link AddProtocolTemplate}: a 40 px circle, no fill, a 1.5 px dashed (5 5) `muted-foreground`
 *   stroke, a plus of 16. At the end of every row; it creates a chain (I1).
 * - {@link AddNetworkTemplate}: a 64 x 72 box, radius 16, `surface-raised`, a 1 px dashed (5 5)
 *   `border` stroke (the same fill and dash as a spoke group, because what it creates is a group), a
 *   plus of 16. At the end of the Idle input bus (I2).
 *
 * Active (the menu is open, or it is a valid drop target): stroke and plus in `primary`; the box's
 * stroke goes to 1.5 px. Every stroke is drawn inside, so neither template moves when it lights up.
 *
 * Both are buttons named by their tooltip (I10, C19), whose tooltip opens BELOW them (side bottom,
 * offset 8, [BB10]) so it never covers the line that feeds the template. A press hands the template
 * to the renderer as the menu's anchor. The empty-canvas captions under them belong to the renderer
 * (S6), not to these pieces. Both carry `data-canvas-interactive`.
 */
"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { canvasInteractive, PieceStroke, PieceTooltip } from "./pieceParts";

/** Public props for {@link AddProtocolTemplate} and {@link AddNetworkTemplate}. */
export interface CanvasTemplateProps {
  /** One line, also the button's name: "Add protocol on Arbitrum", "Add network". */
  tooltip: string;
  /** Its menu is open or it is a valid drop target. */
  active: boolean;
  /** Opens the template's menu; receives the template as the anchor. */
  onActivate(anchor: HTMLElement): void;
}

const BUTTON =
  "relative flex shrink-0 cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The plus of a template, 16 px, its stroke 2 px as drawn. */
function TemplatePlus({ tone }: { tone: string }) {
  return (
    <Plus
      aria-hidden="true"
      size={16}
      strokeWidth={2}
      absoluteStrokeWidth
      className={cn("transition-colors motion-reduce:transition-none", tone)}
    />
  );
}

/** The Add protocol circle, 40 px, at the end of a row. */
export function AddProtocolTemplate({ tooltip, active, onActivate }: CanvasTemplateProps) {
  const tone = active ? "text-primary" : "text-muted-foreground";
  return (
    <PieceTooltip content={tooltip} side="bottom" sideOffset={8}>
      <button
        type="button"
        {...canvasInteractive}
        data-canvas-template="addProtocol"
        data-active={active ? "" : undefined}
        aria-label={tooltip}
        aria-haspopup="menu"
        onClick={(event) => onActivate(event.currentTarget)}
        className={cn(BUTTON, "size-10 rounded-full bg-transparent")}
      >
        <PieceStroke width={1.5} radius={20} dash="5 5" className={tone} />
        <TemplatePlus tone={tone} />
      </button>
    </PieceTooltip>
  );
}

/** The Add network box, 64 x 72, at the end of the Idle input bus. */
export function AddNetworkTemplate({ tooltip, active, onActivate }: CanvasTemplateProps) {
  return (
    <PieceTooltip content={tooltip} side="bottom" sideOffset={8}>
      <button
        type="button"
        {...canvasInteractive}
        data-canvas-template="addNetwork"
        data-active={active ? "" : undefined}
        aria-label={tooltip}
        aria-haspopup="menu"
        onClick={(event) => onActivate(event.currentTarget)}
        className={cn(BUTTON, "h-[72px] w-16 rounded-lg bg-surface-raised")}
      >
        <PieceStroke
          width={active ? 1.5 : 1}
          radius={16}
          dash="5 5"
          className={active ? "text-primary" : "text-border"}
        />
        <TemplatePlus tone={active ? "text-primary" : "text-muted-foreground"} />
      </button>
    </PieceTooltip>
  );
}
