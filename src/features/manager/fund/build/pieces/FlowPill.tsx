/**
 * @id PP-MGR-CMP-050
 * @name FlowPill
 * @implements-rules-version v1 (POO-2154 rules v1); POO-2235 rules v1; POO-2237 rules v1
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
 * Stroke (review F6, measured in Figma on 2026-10-03, nodes 8220:2482 and 8220:2501 of canvas C):
 * the pill frame is 176 x 26, its 1 px stroke is INSIDE and COUNTS in layout
 * (`strokesIncludedInLayout`), padding 0 / 10, gap 6, so the icon sits at x 11, y 7 and the text
 * at x 29. A CSS border on a border-box element is exactly that: the outer size stays 176 x 26 and
 * the content starts at 1 + 10 = 11. The card is different (its stroke does not count in layout,
 * so it is an overlay there). The pill never changes its stroke, so nothing moves.
 *
 * Manual Swap is a selectable button (POO-2237). Automatic flows only explain themselves; their focus
 * policy it is an `Explained` element: focusable (a keyboard reaches its tooltip, [C19]) but not a
 * button, with a tooltip on hover/focus wired as its description. Its name is its text.
 */
"use client";

import {
  BlockIconGlyph,
  canvasInteractive,
  Explained,
  FOCUS_RING,
  PieceTooltip,
} from "./pieceParts";
import type { FlowContent } from "./pieceTypes";

/** Public props for {@link FlowPill}. */
export interface FlowPillProps {
  /** Text, tooltip and icon, from the registry (S5) or, for the Bridge, the renderer (S6). */
  content: FlowContent;
  selected?: boolean;
  onActivate?(anchor: HTMLElement): void;
}

/** A flow block on the Build canvas, 176 x 26. */
export function FlowPill({ content, selected = false, onActivate }: FlowPillProps) {
  const { text, tooltip, icon } = content;
  const face = (
    <>
      <BlockIconGlyph icon={icon} size={12} className="text-muted-foreground" />
      <span className="truncate whitespace-nowrap text-muted-foreground text-xs leading-normal">
        {text}
      </span>
    </>
  );
  if (onActivate)
    return (
      <PieceTooltip content={tooltip}>
        <button
          type="button"
          {...canvasInteractive}
          data-flow-pill=""
          aria-label={tooltip}
          aria-pressed={selected}
          onClick={(event) => onActivate(event.currentTarget)}
          className={`box-border flex h-[26px] w-[176px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border ${selected ? "border-primary" : "border-border"} bg-surface px-2.5 cursor-pointer ${FOCUS_RING}`}
        >
          {face}
        </button>
      </PieceTooltip>
    );
  return (
    <Explained
      tooltip={tooltip}
      {...canvasInteractive}
      data-flow-pill=""
      className="box-border flex h-[26px] w-[176px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2.5"
    >
      <BlockIconGlyph icon={icon} size={12} className="text-muted-foreground" />
      <span className="truncate whitespace-nowrap text-muted-foreground text-xs leading-normal">
        {text}
      </span>
    </Explained>
  );
}
