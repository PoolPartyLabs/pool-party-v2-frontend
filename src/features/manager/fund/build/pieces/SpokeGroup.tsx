/**
 * @id PP-MGR-CMP-053
 * @name SpokeGroup
 * @implements-rules-version v2 (POO-2272); v1 (POO-2154)
 * @implements-rules-version v1 (POO-2302 lifted engine chip)
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
 * `title` attribute. The chip has no action of its own, so under the review's focus policy it is an
 * `Explained` element: a tab stop (not a button) whose tooltip opens on focus too and describes it.
 *
 * Close control (I7, default D5): a spoke with no chain can be removed from a small button on its
 * chip, named by `removeLabel` ("Remove Robinhood Chain"). It is drawn only when both `onRemove` and
 * `removeLabel` are given, so it never appears without a name. It is drawn at 12 px; its hit area
 * reaches 8 px further on every side (F4, the app's `InfoTip` pattern).
 *
 * Invalid (D6, the network left the mandate): the dashes and the name in `destructive`. The look is
 * not drawn in the handoff; it follows the invalid card of D27. Colour is not the only signal (F3):
 * the caller's `invalidLabel` is read on the chip and shown in the tooltip.
 *
 * The box is canvas BACKGROUND (a press on it pans, plan section 3.2); only the chip carries
 * `data-canvas-interactive`.
 */
"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { canvasInteractive, Explained, FOCUS_RING, PieceStroke } from "./pieceParts";

/** Public props for {@link SpokeGroup}. */
export interface SpokeGroupProps {
  /** Engine renderers lift the same chip independently from its background stacking context. */
  part?: "all" | "body" | "chip";
  /** The box, from the layout (S3), in px. */
  width: number;
  height: number;
  /** The network name in natural case: "Robinhood Chain". Shown in capitals. */
  networkName: string;
  /** The 12 px network logo (decorative: the name is next to it). */
  networkLogo: ReactNode;
  /** Manage opts into a natural 32px chip; Build keeps its original miniature. */
  context?: "build" | "manage";
  /** The chip's tooltip and `title`: the network name. */
  chipTooltip: string;
  /** The network is no longer in the mandate (D6). */
  invalid?: boolean;
  /**
   * What `invalid` means, in the caller's words ("No longer in your mandate"): read by a screen
   * reader on the chip and shown in its tooltip, so invalid is never told by colour alone (F3).
   */
  invalidLabel?: string;
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
  context = "build",
  part = "all",
  chipTooltip,
  invalid = false,
  invalidLabel,
  onRemove,
  removeLabel,
}: SpokeGroupProps) {
  const closable = onRemove !== undefined && removeLabel !== undefined;
  const saysInvalid = invalid && invalidLabel !== undefined;
  const isManage = context === "manage";
  // The tooltip names the network and, when invalid, says why in the caller's words (F3).
  const tooltip = saysInvalid ? (
    <>
      {chipTooltip} <span className="text-destructive">{invalidLabel}</span>
    </>
  ) : (
    chipTooltip
  );
  const chip = (
    <Explained
      tooltip={tooltip}
      {...canvasInteractive}
      data-network-chip=""
      title={chipTooltip}
      className={cn(
        "absolute top-0 left-3 flex -translate-y-1/2 items-center whitespace-nowrap rounded-full bg-background",
        isManage ? "min-h-8 gap-2 px-3 py-1.5" : "h-[21px] gap-1.5 py-0.5 pr-2 pl-1.5",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-full",
          isManage ? "size-5" : "size-3",
        )}
      >
        {networkLogo}
      </span>
      <span
        data-network-name=""
        className={cn(
          "uppercase leading-normal",
          isManage ? "font-semibold text-sm" : "font-medium text-[11px]",
          invalid ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {networkName}
      </span>
      {saysInvalid ? <span className="sr-only">{invalidLabel}</span> : null}
      {closable ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={() => onRemove?.()}
          // F4: the drawn control is 12 px; ::after extends the hit area by 8 on every side.
          className={cn(
            "relative flex size-3 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[''] hover:text-foreground motion-reduce:transition-none",
            FOCUS_RING,
          )}
        >
          <X aria-hidden="true" size={12} strokeWidth={1.5} absoluteStrokeWidth />
        </button>
      ) : null}
    </Explained>
  );
  if (part === "chip") return chip;
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
      {isManage ? (
        <span
          data-spoke-watermark=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-4 flex items-center justify-center overflow-clip break-words text-center font-semibold text-foreground text-5xl opacity-[0.035]"
        >
          {networkName}
        </span>
      ) : null}
      {part === "all" ? chip : null}
    </div>
  );
}
