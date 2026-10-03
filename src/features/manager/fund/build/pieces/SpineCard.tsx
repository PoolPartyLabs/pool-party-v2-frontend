/**
 * @id PP-MGR-CMP-048
 * @name SpineCard
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece that reports nothing; the Build screen
 *   (PP-MGR-SCR-002, S7) owns every event
 *
 * A fixed block of the hub's spine (handoff v1.2 [BB2], [C2]): Deposit, Idle input, Idle output,
 * Income (fees) or Withdraw. Which one it is, and so its title, caption and icon, comes from props
 * (S6 reads the `spine.*` keys); this piece only draws.
 *
 * 236 x 62 with the position card's anatomy (radius 20, `surface`, a 1 px `border` stroke drawn
 * inside, padding 11 / 13, gap 10, the 28 x 28 icon box, title over caption). Deposit and Withdraw
 * carry a 14 px lock in `muted-foreground` at the right end, with the tooltip "Fixed: USDC on
 * Arbitrum" on hover and on focus ([C19]).
 *
 * Not selectable, no ports, no hover look: the card is not a control. The lock is a button only so
 * a keyboard can reach its tooltip (the app's `InfoTip` pattern); it is named by that tooltip. The
 * card still carries `data-canvas-interactive`, like every card, so a press on it never pans.
 */
"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  CARD_BOX,
  CARD_RADIUS,
  CardCopy,
  CardIconBox,
  canvasInteractive,
  PieceStroke,
  PieceTooltip,
} from "./pieceParts";
import type { BlockIcon } from "./pieceTypes";

/** Public props for {@link SpineCard}. */
export interface SpineCardProps {
  title: string;
  caption: string;
  icon: BlockIcon;
  /** Deposit and Withdraw: cannot be removed, moved or configured (C2). */
  locked: boolean;
  /** The lock's tooltip and accessible name ("Fixed: USDC on Arbitrum"). */
  lockTooltip?: string;
}

/** The 14 px lock at the right end of Deposit and Withdraw. */
function SpineLock({ tooltip }: { tooltip: string | undefined }) {
  const glyph = <Lock aria-hidden="true" size={14} strokeWidth={2.5} />;
  if (tooltip === undefined) {
    return <span className="flex shrink-0 text-muted-foreground">{glyph}</span>;
  }
  return (
    <PieceTooltip content={tooltip}>
      <button
        type="button"
        aria-label={tooltip}
        className="flex shrink-0 cursor-default rounded-full text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {glyph}
      </button>
    </PieceTooltip>
  );
}

/** A fixed block of the spine, 236 x 62. */
export function SpineCard({ title, caption, icon, locked, lockTooltip }: SpineCardProps) {
  return (
    <div {...canvasInteractive} data-spine-card="" className={cn(CARD_BOX, "w-[236px]")}>
      <PieceStroke width={1} radius={CARD_RADIUS} className="text-border" />
      <CardIconBox icon={icon} tone="text-muted-foreground" />
      <CardCopy title={title} caption={caption} captionTone="text-muted-foreground" />
      {locked ? <SpineLock tooltip={lockTooltip} /> : null}
    </div>
  );
}
