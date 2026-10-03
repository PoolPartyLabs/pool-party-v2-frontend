/**
 * @id PP-MGR-CMP-049
 * @name PositionCard
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; a selection is reported through `onSelect` and the
 *   Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The card of a position block on the Build canvas: a Uniswap pool, an Aave Supply or Borrow, or a
 * coming-soon kind (handoff v1.2 [BB1], [C7], [A3], defaults D11 and D27).
 *
 * 176 x 62, radius 20, `surface`, padding 11 / 13, gap 10: a 28 x 28 icon box (radius 12,
 * `surface-raised`, icon 16) and the title (Body/Medium) over the caption (Caption/Default), gap 1.
 *
 * | State | Stroke | Caption |
 * |---|---|---|
 * | default, coming soon | 1 px `border`, hover `muted-foreground` | muted |
 * | selected | 2 px `primary`, icon `primary` | as its state |
 * | empty | 1.5 px dashed 6 6, `primary` when selected, `border` (hover `muted-foreground`) when not | `primary` |
 * | invalid (D27) | 1 px `destructive` | `destructive` ("No longer in your mandate") |
 *
 * A coming-soon card adds the "Soon" tag at the right end (D27). The stroke is drawn inside
 * (`PieceStroke`), so the card is 176 x 62 in every state and the line under it always starts at
 * its bottom edge ([A3]).
 *
 * Everything it shows comes from `content`, which S5 derives from the block's `config` (HU2): this
 * piece never builds a title or a caption. A long caption stays on one line with an ellipsis; the
 * full text opens in a tooltip, but only when the ellipsis actually cut it (D11): the card measures
 * the caption when the tooltip asks to open, so a caption that fits never shows a tooltip that
 * repeats it.
 *
 * With `onSelect` the card is a button named by `accessibleName` (I10: "WETH / USDC, Uniswap v4 ·
 * 0.05%, on Arbitrum, 60% of the capital") and announced as pressed while selected; without it, a
 * plain box whose name is read from a visually hidden line. Either way it carries
 * `data-canvas-interactive`, so a press on it never pans.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  BlockIconGlyph,
  canvasInteractive,
  PieceStroke,
  type PieceStrokeProps,
  PieceTooltip,
} from "./pieceParts";
import type { BlockContent, CardState } from "./pieceTypes";

/** Public props for {@link PositionCard}. */
export interface PositionCardProps {
  /** What the card shows, derived by S5 from the block's `config`. */
  content: BlockContent;
  /** The selected look (I5: one block at a time). Independent of `content.state`. */
  selected: boolean;
  /** Selects the block (I5). Without it the card is not a button. */
  onSelect?(): void;
}

const CARD_RADIUS = 20;
const HOVER = "group-hover:text-muted-foreground";

/** The stroke of the card for a state and a selection ([BB1], D27). */
function cardStroke(
  state: CardState,
  selected: boolean,
  hoverable: boolean,
): Omit<PieceStrokeProps, "radius"> {
  const resting = hoverable ? cn("text-border", HOVER) : "text-border";
  if (state === "empty") {
    return { width: 1.5, dash: "6 6", className: selected ? "text-primary" : resting };
  }
  if (selected) return { width: 2, className: "text-primary" };
  if (state === "invalid") return { width: 1, className: "text-destructive" };
  return { width: 1, className: resting };
}

/** The caption colour: `primary` while empty, `destructive` when invalid, muted otherwise. */
function captionTone(state: CardState): string {
  if (state === "empty") return "text-primary";
  if (state === "invalid") return "text-destructive";
  return "text-muted-foreground";
}

/** The "Soon" tag at the right end of a coming-soon card (D27, the palette's tag). */
function SoonTag({ text }: { text: string }) {
  return (
    <span
      data-soon-tag=""
      className="relative flex h-[21px] shrink-0 items-center rounded-full px-1.5"
    >
      <PieceStroke width={1} radius={10.5} className="text-border" />
      <span className="whitespace-nowrap font-medium text-[11px] text-muted-foreground leading-normal">
        {text}
      </span>
    </span>
  );
}

/** A position block on the Build canvas, 176 x 62 in every state. */
export function PositionCard({ content, selected, onSelect }: PositionCardProps) {
  const { title, caption, icon, state, accessibleName, fullCaption, soonTag } = content;
  const captionRef = useRef<HTMLSpanElement>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const interactive = onSelect !== undefined;

  // D11: open only when the ellipsis cut the caption, measured at the moment the tooltip asks.
  const handleTooltipChange = useCallback((next: boolean) => {
    const element = captionRef.current;
    setTooltipOpen(next && element !== null && element.scrollWidth > element.clientWidth);
  }, []);

  const stroke = cardStroke(state, selected, interactive);
  const body = (
    <>
      <PieceStroke {...stroke} radius={CARD_RADIUS} />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-raised">
        <BlockIconGlyph
          icon={icon}
          size={16}
          className={cn(
            "transition-colors motion-reduce:transition-none",
            selected ? "text-primary" : "text-muted-foreground",
          )}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate font-medium text-foreground text-sm leading-normal">{title}</span>
        <span
          ref={captionRef}
          className={cn("truncate text-xs leading-normal", captionTone(state))}
        >
          {caption}
        </span>
      </span>
      {state === "comingSoon" && soonTag ? <SoonTag text={soonTag} /> : null}
    </>
  );

  const marks = {
    ...canvasInteractive,
    "data-card-state": state,
    "data-selected": selected ? "" : undefined,
  };
  const boxClass =
    "group relative flex h-[62px] w-[176px] shrink-0 items-center gap-2.5 rounded-xl bg-surface px-[13px] py-[11px] text-left";

  return (
    <PieceTooltip
      content={fullCaption ?? caption}
      open={tooltipOpen}
      onOpenChange={handleTooltipChange}
    >
      {interactive ? (
        <button
          type="button"
          {...marks}
          aria-label={accessibleName}
          aria-pressed={selected}
          onClick={() => onSelect?.()}
          className={cn(
            boxClass,
            "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {body}
        </button>
      ) : (
        // Not a control: the name is read from a visually hidden line, the visible copy is hidden
        // from assistive technology so it is not read twice.
        <div {...marks} className={boxClass}>
          <span className="sr-only">{accessibleName}</span>
          <span aria-hidden="true" className="contents">
            {body}
          </span>
        </div>
      )}
    </PieceTooltip>
  );
}
