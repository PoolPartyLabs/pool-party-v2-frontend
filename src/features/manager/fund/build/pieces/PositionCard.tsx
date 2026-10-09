/**
 * @id PP-MGR-CMP-049
 * @name PositionCard
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @implements-rules-version v1 (POO-2301 shared local runtime; POO-2302 measured engine)
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
 * piece never builds a title or a caption. A long title or caption stays on one line with an
 * ellipsis; the full text opens in a tooltip, but only for the line the ellipsis actually cut (D11,
 * review F5: the Soon tag narrows the title's room): the card measures both lines when the tooltip
 * asks to open, so a card whose text fits never shows a tooltip that repeats it. Both cut: the
 * tooltip carries the title, then the caption, on one line.
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
  CARD_BOX,
  CARD_RADIUS,
  CardCopy,
  CardIconBox,
  canvasInteractive,
  FOCUS_RING,
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

const HOVER = "group-hover:text-muted-foreground";

/** Which of the card's two lines the ellipsis cut. */
interface CutLines {
  title: boolean;
  caption: boolean;
}

/** Whether an ellipsis cut this line: its text is wider than its box. */
function isCut(element: HTMLElement | null): boolean {
  return element !== null && element.scrollWidth > element.clientWidth;
}

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
  const titleRef = useRef<HTMLSpanElement>(null);
  const captionRef = useRef<HTMLSpanElement>(null);
  // Which lines the ellipsis cut, measured when the tooltip asks to open; null while closed.
  const [cutLines, setCutLines] = useState<CutLines | null>(null);
  const interactive = onSelect !== undefined;

  // D11 and review F5: open only when the ellipsis cut the title or the caption (the Soon tag
  // narrows the title's room), measured at the moment the tooltip asks.
  const handleTooltipChange = useCallback((next: boolean) => {
    const lines = { title: isCut(titleRef.current), caption: isCut(captionRef.current) };
    setCutLines(next && (lines.title || lines.caption) ? lines : null);
  }, []);
  const tooltip =
    cutLines === null ? (
      (fullCaption ?? caption)
    ) : (
      <>
        {cutLines.title ? <span className="font-medium">{title}</span> : null}
        {cutLines.title && cutLines.caption ? " " : null}
        {cutLines.caption ? (fullCaption ?? caption) : null}
      </>
    );

  const stroke = cardStroke(state, selected, interactive);
  const body = (
    <>
      <PieceStroke {...stroke} radius={CARD_RADIUS} />
      {content.mark ? (
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-raised"
        >
          {content.mark}
        </span>
      ) : (
        <CardIconBox icon={icon} tone={selected ? "text-primary" : "text-muted-foreground"} />
      )}
      <CardCopy
        title={title}
        caption={caption}
        captionTone={captionTone(state)}
        titleRef={titleRef}
        captionRef={captionRef}
      />
      {state === "comingSoon" && soonTag ? <SoonTag text={soonTag} /> : null}
    </>
  );

  const marks = {
    ...canvasInteractive,
    "data-card-state": state,
    "data-selected": selected ? "" : undefined,
  };
  const boxClass = cn(CARD_BOX, "group w-[176px]");

  return (
    <PieceTooltip content={tooltip} open={cutLines !== null} onOpenChange={handleTooltipChange}>
      {interactive ? (
        <button
          type="button"
          {...marks}
          aria-label={accessibleName}
          aria-pressed={selected}
          onClick={() => onSelect?.()}
          className={cn(boxClass, "cursor-pointer", FOCUS_RING)}
        >
          {body}
        </button>
      ) : (
        // Not a control: the name is read from a visually hidden line, the visible copy is hidden
        // from assistive technology so it is not read twice.
        <div {...marks} className={boxClass}>
          <span className="sr-only">{accessibleName}</span>
          <span aria-hidden="true" className="contents rounded-[inherit]">
            {body}
          </span>
        </div>
      )}
    </PieceTooltip>
  );
}
