/**
 * @id PP-MGR-CMP-048
 * @name SpineCard
 * @implements-rules-version v1 (POO-2154 rules v1); POO-2235 rules v1
 * @analytics-events none, a presentational piece that reports nothing; the Build screen
 *   (PP-MGR-SCR-002, S7) owns every event
 *
 * A fixed block of the hub's spine (handoff v1.2 [BB2], [C2]): Deposit, Idle input, Idle output,
 * Income (fees) or Withdraw. Which one it is, and so its title, caption and icon, comes from props
 * (S6 reads the `spine.*` keys); this piece only draws.
 *
 * 236 x 62 with the position card's anatomy (radius 20, `surface`, a 1 px `border` stroke drawn
 * inside, padding 11 / 13, gap 10, the 28 x 28 icon box, title over caption). All fixed spine roles
 * carry a 14 px lock in `muted-foreground` at the right end, with the tooltip "Fixed: USDC on
 * Arbitrum" on hover and on focus ([C19]).
 *
 * Not selectable, no ports, no hover look: the card is not a control. The lock has no action, so
 * under the review's focus policy it is an `Explained` element, not a button: a tab stop so a
 * keyboard reaches its tooltip, an image named by that tooltip. Without `lockTooltip` the lock is
 * drawn as a decorative icon and is no tab stop. The card still carries `data-canvas-interactive`,
 * like every card, so a press on it never pans.
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
  Explained,
  PieceStroke,
} from "./pieceParts";
import type { BlockIcon } from "./pieceTypes";

/** Public props for {@link SpineCard}. */
export interface SpineCardProps {
  title: string;
  caption: string;
  icon: BlockIcon;
  /** Fixed spine roles cannot be removed, moved or configured (POO-2235). */
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
  // The lock only explains itself: focusable, not a button (the review's focus policy). It shows no
  // text, so its tooltip is its NAME (an image named "Fixed: USDC on Arbitrum"); describing it by
  // the same sentence as well would make a screen reader read it twice.
  return (
    <Explained
      tooltip={tooltip}
      describe={false}
      role="img"
      aria-label={tooltip}
      className="flex shrink-0 rounded-full text-muted-foreground"
    >
      {glyph}
    </Explained>
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
