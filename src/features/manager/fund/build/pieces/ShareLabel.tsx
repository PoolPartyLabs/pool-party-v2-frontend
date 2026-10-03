/**
 * @id PP-MGR-CMP-051
 * @name ShareLabel
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; a press is reported through `onActivate` and the
 *   Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The share of the strategy's capital a chain or a spoke receives, on the stub above it (handoff
 * v1.2 [BB4], [C8]). The share lives on the line, not on the card.
 *
 * A pill 20 high, padding 1 x 7 inside a 1 px `border`, radius full, `background`, the text in
 * Numeric/Label (13 semibold, tabular) in `foreground`: "60%"; an empty block shows "0%".
 * Highlighted (its edge or itself is hovered, [BB8]) it takes a 1.5 px `primary` border and
 * `primary` text. The stroke is drawn inside, so the label keeps its size when it lights up and
 * stays centred on its stub.
 *
 * Stroke (review F6, measured in Figma on 2026-10-03, node 8220:2556 of canvas C): the label frame
 * is 45 x 20 for "60%", its 1 px stroke is INSIDE and COUNTS in layout, padding 1 / 7, so the text
 * box (16 high) sits at x 8, y 2. Here the stroke is an overlay (it must grow to 1.5 px without
 * moving anything), so the inset is written out instead: height 20, padding 8 left and right, the
 * 16 px line centred, which puts the text at x 8, y 2 and keeps the outer width at 16 + the text.
 *
 * With `onActivate` it is a button named by its tooltip (I10: "60% of the strategy's capital"); a
 * press hands the element to the renderer as the anchor (I5: a hub chain's label selects the block
 * it feeds). Without it (a spoke's label selects nothing, D26) it only explains itself, so under the
 * review's focus policy it is an `Explained` element: a tab stop, not a button, described by its
 * tooltip. Either way the tooltip opens on hover and on focus ([C19]), and the label carries
 * `data-canvas-interactive`.
 *
 * Hover and keyboard focus are reported through `onHoverChange`, so the renderer (S6) lights the
 * edge and the label together; the label never decides its own highlight.
 *
 * PP-NOTE: Numeric/Label is Inter in Figma; the app loads only Poppins, so the label uses Poppins
 * semibold with tabular, lining figures (the app wins on type).
 */
"use client";

import { cn } from "@/lib/utils/cn";
import { canvasInteractive, Explained, FOCUS_RING, PieceStroke, PieceTooltip } from "./pieceParts";

/** Public props for {@link ShareLabel}. */
export interface ShareLabelProps {
  /** The formatted share: "60%". */
  text: string;
  /** One line: "60% of the strategy's capital". Also the button's name. */
  tooltip: string;
  /** The lit look ([BB8]): its edge or the label is hovered. */
  highlighted: boolean;
  /** Makes the label a button; receives the label element as the anchor. */
  onActivate?(anchor: HTMLElement): void;
  /** Hover or keyboard focus entered (true) or left (false). */
  onHoverChange?(hovered: boolean): void;
}

const LABEL_BOX = "relative inline-flex h-5 shrink-0 items-center rounded-full bg-background px-2";

/** The share label of a chain or a spoke. */
export function ShareLabel({
  text,
  tooltip,
  highlighted,
  onActivate,
  onHoverChange,
}: ShareLabelProps) {
  const hoverHandlers = {
    onPointerEnter: () => onHoverChange?.(true),
    onPointerLeave: () => onHoverChange?.(false),
    onFocus: () => onHoverChange?.(true),
    onBlur: () => onHoverChange?.(false),
  };
  const marks = {
    ...canvasInteractive,
    "data-share-label": "",
    "data-highlighted": highlighted ? "" : undefined,
  };
  const face = (
    <>
      <PieceStroke
        width={highlighted ? 1.5 : 1}
        radius={10}
        className={highlighted ? "text-primary" : "text-border"}
      />
      <span
        className={cn(
          "whitespace-nowrap font-semibold text-[13px] lining-nums tabular-nums leading-4 transition-colors motion-reduce:transition-none",
          highlighted ? "text-primary" : "text-foreground",
        )}
      >
        {text}
      </span>
    </>
  );

  if (!onActivate) {
    // A spoke's label only explains itself (D26): focusable, not a button (focus policy).
    return (
      <Explained tooltip={tooltip} {...marks} {...hoverHandlers} className={LABEL_BOX}>
        {face}
      </Explained>
    );
  }
  return (
    <PieceTooltip content={tooltip}>
      <button
        type="button"
        {...marks}
        {...hoverHandlers}
        aria-label={tooltip}
        onClick={(event) => onActivate(event.currentTarget)}
        className={cn(LABEL_BOX, "cursor-pointer", FOCUS_RING)}
      >
        {face}
      </button>
    </PieceTooltip>
  );
}
