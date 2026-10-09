/**
 * @id PP-MGR-CMP-056
 * @name BlockMark
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events none, decorative
 *
 * The leading mark of a palette row, a menu row and the panel stub head (handoff v1.2 AN8, BB9,
 * AN10): a protocol logo, a network logo or a flow block icon. Filed under the palette's id, where
 * the marks first appear; the menus and the panel stub reuse it.
 *
 * Decorative in every caller (the row's name carries the meaning), so every branch is `aria-hidden`.
 * Protocols reuse the Mandate steps' `ProtocolMark` (the Uniswap asset, else a monogram on the raised
 * surface); Pendle and GMX have no `ProtocolId`, so they take the same monogram here. Networks reuse
 * `NetworkLogo`. Flow blocks draw the pill's own icon (`swap`, `coins`) from the canvas pieces.
 */
"use client";

import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { ProtocolMark } from "../../components/ProtocolMark";
import { BlockIconGlyph } from "../pieces/pieceParts";
import { BLOCK_KIND_PROTOCOL, type BlockKind } from "../plan/buildPlan";

/** Public props for {@link BlockMark}. */
export interface BlockMarkProps {
  logo: "protocol" | "network" | "flow";
  /** A block kind, a network id or a flow kind, as `logo` says. */
  markId: string;
  /** The row's name: the monogram's letter. */
  name: string;
  /** Edge in px: 20 in a palette card, a menu row and the panel head. */
  size?: number;
}

/** A protocol, network or flow mark, decorative. */
export function BlockMark({ logo, markId, name, size = 20 }: BlockMarkProps) {
  if (markId === "jupiter") return <ProtocolMark id="jupiter" name={name} size={size} />;
  if (logo === "network" && markId === "solana")
    return (
      // biome-ignore lint/performance/noImgElement: committed external protocol mark.
      <img
        src="/protocols/solana-preview/solana.svg"
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full"
      />
    );
  if (logo === "network") return <NetworkLogo network={markId} name={name} size={size} />;
  if (logo === "flow") {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center text-muted-foreground"
      >
        <BlockIconGlyph icon={markId === "collectFees" ? "coins" : "swap"} size={16} />
      </span>
    );
  }
  const protocol = BLOCK_KIND_PROTOCOL[markId as BlockKind] ?? null;
  if (protocol) return <ProtocolMark id={protocol} name={name} size={size} />;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-surface-raised font-semibold text-[10px] text-foreground"
    >
      {(name.charAt(0) || "?").toUpperCase()}
    </span>
  );
}
