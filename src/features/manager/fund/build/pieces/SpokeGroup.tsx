/**
 * @id PP-MGR-CMP-053
 * @name SpokeGroup
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; a removal is reported through `onRemove` and the
 *   Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The dashed group of a spoke network, drawn behind its blocks, with the network chip on its top
 * border (handoff v1.2 [BB5], [C3]). Hub chains have no group; one group per spoke network. The
 * blocks are NOT children of this box: the renderer (S6) places them at their own layout rects, the
 * group only draws the box of the size the layout gives it.
 *
 * Box: radius 16, `surface-raised`, a 1 px dashed (5 5) `border` stroke drawn inside.
 *
 * Chip: 21 high, padding 2 top and bottom, 6 left, 8 right, gap 6, radius full, `background`; the
 * network logo at 12 (the renderer passes it: this piece imports no network data) and the network
 * name in capitals by CSS (so the copy keeps its natural case), Label/Small in `muted-foreground`.
 * Placed 12 px from the box's left border and centred on its top border. It names its network the
 * way `NetworkDots` does (R10 of the Mandate handoff): a tooltip, side top, offset 4, plus the
 * `title` attribute. The chip is not a tab stop of its own; its close control, when it has one,
 * is, and focusing it opens the chip's tooltip.
 *
 * Close control (I7, default D5): a spoke with no chain can be removed from a small button on its
 * chip, named by `removeLabel` ("Remove Robinhood Chain"). It is drawn only when both `onRemove` and
 * `removeLabel` are given, so it never appears without a name.
 *
 * Invalid (D6, the network left the mandate): the dashes and the name in `destructive`. The look is
 * not drawn in the handoff; it follows the invalid card of D27.
 *
 * The box is canvas BACKGROUND (a press on it pans, plan section 3.2); only the chip carries
 * `data-canvas-interactive`.
 */
"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { canvasInteractive, PieceStroke, PieceTooltip } from "./pieceParts";

/** Public props for {@link SpokeGroup}. */
export interface SpokeGroupProps {
  /** The box, from the layout (S3), in px. */
  width: number;
  height: number;
  /** The network name in natural case: "Robinhood Chain". Shown in capitals. */
  networkName: string;
  /** The 12 px network logo (decorative: the name is next to it). */
  networkLogo: ReactNode;
  /** The chip's tooltip and `title`: the network name. */
  chipTooltip: string;
  /** The network is no longer in the mandate (D6). */
  invalid?: boolean;
  /** Removes the spoke (I7, D5: only offered while it has no chain). */
  onRemove?(): void;
  /** The close control's accessible name: "Remove Robinhood Chain". */
  removeLabel?: string;
}

/** A spoke network's dashed group and its chip. */
export function SpokeGroup({
  width,
  height,
  networkName,
  networkLogo,
  chipTooltip,
  invalid = false,
  onRemove,
  removeLabel,
}: SpokeGroupProps) {
  const closable = onRemove !== undefined && removeLabel !== undefined;
  return (
    <div
      data-spoke-group=""
      data-invalid={invalid ? "" : undefined}
      className="relative shrink-0 rounded-lg bg-surface-raised"
      style={{ width, height }}
    >
      <PieceStroke
        width={1}
        radius={16}
        dash="5 5"
        className={invalid ? "text-destructive" : "text-border"}
      />
      <PieceTooltip content={chipTooltip}>
        <div
          {...canvasInteractive}
          data-network-chip=""
          title={chipTooltip}
          className="absolute top-0 left-3 flex h-[21px] -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-background py-0.5 pr-2 pl-1.5"
        >
          <span
            aria-hidden="true"
            className="flex size-3 shrink-0 items-center justify-center overflow-hidden rounded-full"
          >
            {networkLogo}
          </span>
          <span
            className={cn(
              "font-medium text-[11px] uppercase leading-normal",
              invalid ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {networkName}
          </span>
          {closable ? (
            <button
              type="button"
              aria-label={removeLabel}
              onClick={() => onRemove?.()}
              className="flex size-3 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <X aria-hidden="true" size={12} strokeWidth={1.5} absoluteStrokeWidth />
            </button>
          ) : null}
        </div>
      </PieceTooltip>
    </div>
  );
}
