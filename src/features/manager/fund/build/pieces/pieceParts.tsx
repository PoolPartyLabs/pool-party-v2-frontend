/**
 * @id PP-MGR-CMP-049
 * @name pieceParts
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, presentational helpers; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * What every Build canvas piece shares (slice S4, POO-2154). Filed under PP-MGR-CMP-049, the
 * slice's main id.
 *
 * 1. **{@link PieceStroke}: the stroke is drawn inside and takes no layout space ([A3]).** A CSS
 *    border is part of the box, so a 1 px card that turns 2 px when selected would either grow or
 *    move its content by a pixel, and the line under the card would no longer start at its edge.
 *    The stroke is an SVG overlay instead: a rect on the piece's edge with TWICE the stroke width,
 *    clipped by the overlay's own rounded box, so exactly the inner half (the stroke width) shows.
 *    SVG is also the only way to draw the handoff's exact dash patterns (6 6, 5 5, 3 3); CSS
 *    `dashed` picks its own. The colour is `currentColor`, set by a token class (`text-border`,
 *    `text-primary`...), so no literal colour exists here.
 * 2. **{@link BlockIconGlyph}: the closed icon set.** The Figma icons are Lucide glyphs; their stroke
 *    is 1.33 px at every size (16 in a card, 12 in a pill), hence `absoluteStrokeWidth`.
 * 3. **{@link PieceTooltip}: the app Tooltip on one line ([BB10]).** The app's `TooltipContent`
 *    wraps at `max-w-xs`; the handoff says a tooltip is one line, so it is `whitespace-nowrap` with
 *    no max width. Side top, offset 4 by default; the templates pass bottom, 8. Each tooltip brings
 *    its own provider (as `NetworkDots` does), so a piece renders alone in a story or a test.
 * 4. **{@link canvasInteractive}: the attribute that keeps the viewport off a piece** (plan section
 *    3.2). Spread on cards, pills, templates, ports, share labels and network chips; never on a
 *    group box or the SVG of lines, which are canvas background.
 */
"use client";

import {
  ArrowLeftRight,
  Coins,
  Download,
  Hourglass,
  Landmark,
  Layers,
  type LucideIcon,
  Route,
  Upload,
} from "lucide-react";
import type { ReactElement, Ref } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";
import { CANVAS_INTERACTIVE_ATTR } from "../canvas/useCanvasViewport";
import type { BlockIcon } from "./pieceTypes";

/** Spread on every interactive piece: a press on it never pans and never clears the selection. */
export const canvasInteractive: Readonly<Record<string, string>> = {
  [CANVAS_INTERACTIVE_ATTR]: "",
};

/** Public props for {@link PieceStroke}. */
export interface PieceStrokeProps {
  /** The VISIBLE stroke width in px (1, 1.5 or 2), all of it inside the piece. */
  width: number;
  /** Corner radius in px. A pill or circle passes half its height. */
  radius: number;
  /** An SVG dash pattern ("6 6"); omitted for a solid stroke. */
  dash?: string;
  /** Token colour classes (`text-border`, `group-hover:text-muted-foreground`, ...). */
  className?: string;
}

/** A stroke drawn inside its piece: an overlay that takes no layout space ([A3]). */
export function PieceStroke({ width, radius, dash, className }: PieceStrokeProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-piece-stroke=""
      data-stroke-width={width}
      data-stroke-dash={dash ?? "solid"}
      className={cn(
        "pointer-events-none absolute inset-0 size-full overflow-hidden rounded-[inherit] transition-colors motion-reduce:transition-none",
        className,
      )}
    >
      <rect
        width="100%"
        height="100%"
        rx={radius}
        ry={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={width * 2}
        strokeDasharray={dash}
      />
    </svg>
  );
}

const ICONS: Readonly<Record<BlockIcon, LucideIcon>> = {
  layers: Layers,
  bank: Landmark,
  swap: ArrowLeftRight,
  coins: Coins,
  bridge: Route,
  depositIn: Download,
  withdrawOut: Upload,
  hourglass: Hourglass,
};

/** Public props for {@link BlockIconGlyph}. */
export interface BlockIconGlyphProps {
  icon: BlockIcon;
  /** Edge in px: 16 in a card, 12 in a pill. */
  size: number;
  className?: string;
}

/** One icon of the closed set, decorative (the piece's text or name carries the meaning). */
export function BlockIconGlyph({ icon, size, className }: BlockIconGlyphProps) {
  const Icon = ICONS[icon];
  return (
    <Icon
      aria-hidden="true"
      data-block-icon={icon}
      size={size}
      strokeWidth={1.33}
      absoluteStrokeWidth
      className={cn("shrink-0", className)}
    />
  );
}

/** The radius of a position or spine card ([BB1], [BB2]). */
export const CARD_RADIUS = 20;

/**
 * The box of a position or spine card, without its width: 62 high, radius 20, `surface`, padding
 * 11 / 13, gap 10 ([BB1], [BB2]). No border class: the stroke is a {@link PieceStroke}.
 */
export const CARD_BOX =
  "relative flex h-[62px] shrink-0 items-center gap-2.5 rounded-xl bg-surface px-[13px] py-[11px] text-left";

/** The 28 x 28 icon box of a card (radius 12, `surface-raised`) with its 16 px icon. */
export function CardIconBox({ icon, tone }: { icon: BlockIcon; tone: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-raised">
      <BlockIconGlyph
        icon={icon}
        size={16}
        className={cn("transition-colors motion-reduce:transition-none", tone)}
      />
    </span>
  );
}

/** Public props for {@link CardCopy}. */
export interface CardCopyProps {
  title: string;
  caption: string;
  /** The caption colour token. */
  captionTone: string;
  /** Lets a card measure whether its caption overflows (D11). */
  captionRef?: Ref<HTMLSpanElement>;
}

/** Title (Body/Medium) over caption (Caption/Default), gap 1, each on one line with an ellipsis. */
export function CardCopy({ title, caption, captionTone, captionRef }: CardCopyProps) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-px">
      <span className="truncate font-medium text-foreground text-sm leading-normal">{title}</span>
      <span ref={captionRef} className={cn("truncate text-xs leading-normal", captionTone)}>
        {caption}
      </span>
    </span>
  );
}

/** Public props for {@link PieceTooltip}. */
export interface PieceTooltipProps {
  /** One line of text. */
  content: string;
  side?: "top" | "bottom";
  /** Gap between the piece and the tooltip, in px. */
  sideOffset?: number;
  /** Controlled open state, for a trigger that opens only on some condition (D11). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The trigger: one element, which receives the hover and focus handlers. */
  children: ReactElement;
}

/** The app Tooltip, one line, on hover and focus ([BB10], [C19]). */
export function PieceTooltip({
  content,
  side = "top",
  sideOffset = 4,
  open,
  onOpenChange,
  children,
}: PieceTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          sideOffset={sideOffset}
          data-tooltip-offset={sideOffset}
          className="max-w-none whitespace-nowrap"
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
