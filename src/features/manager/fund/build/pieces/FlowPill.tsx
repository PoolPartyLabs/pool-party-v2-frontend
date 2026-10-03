/**
 * @id PP-MGR-CMP-050
 * @name FlowPill
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece that reports nothing; the Build screen
 *   (PP-MGR-SCR-002, S7) owns every event
 *
 * A flow block of the Build canvas (handoff v1.2 [BB3], [C7]): Swap · auto, Swap, Collect fees, or
 * the Bridge · auto of a spoke. Position blocks are cards and flow blocks are pills, all the same
 * size, so a reader tells the family by the shape.
 *
 * 176 x 26, radius full, `surface`, 1 px `border`, padding 0 x 10, gap 6, a 12 px icon in
 * `muted-foreground`, one line of Caption/Default in `muted-foreground`. The icon is plain on every
 * pill: the small disc the drawings show behind the Swap icon is an artefact the handoff discards.
 * Collect fees uses `coins` (the handoff gives it no icon; `coins` is the nearest of `BlockIcon`).
 *
 * The pill never changes its stroke, so its 1 px border is a real CSS border: content starts at 11,
 * exactly where the Figma frames draw it. Its tooltip opens on hover and on focus ([C19]): the pill
 * is a button so a keyboard reaches it (the app's `InfoTip` pattern). It selects nothing in this
 * batch (I5: pills are not selectable); its name is its text.
 */
"use client";

import { BlockIconGlyph, canvasInteractive, PieceTooltip } from "./pieceParts";
import type { FlowContent } from "./pieceTypes";

/** Public props for {@link FlowPill}. */
export interface FlowPillProps {
  /** Text, tooltip and icon, from the registry (S5) or, for the Bridge, the renderer (S6). */
  content: FlowContent;
}

/** A flow block on the Build canvas, 176 x 26. */
export function FlowPill({ content }: FlowPillProps) {
  const { text, tooltip, icon } = content;
  return (
    <PieceTooltip content={tooltip}>
      <button
        type="button"
        {...canvasInteractive}
        data-flow-pill=""
        className="flex h-[26px] w-[176px] shrink-0 cursor-default items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BlockIconGlyph icon={icon} size={12} className="text-muted-foreground" />
        <span className="truncate whitespace-nowrap text-muted-foreground text-xs leading-normal">
          {text}
        </span>
      </button>
    </PieceTooltip>
  );
}
