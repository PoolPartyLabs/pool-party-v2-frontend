/**
 * @id PP-MGR-CMP-036
 * @name ProtocolMark
 * @implements-rules-version v4 (POO-2167)
 * @analytics-events none, decorative; the steps that render it emit through the shell
 *
 * A protocol's leading mark, shared by the Mandate steps that list protocols as rows (POO-2128,
 * epic POO-2119).
 *
 * POO-2167 v4: every known protocol uses a committed canonical brand asset. The assets' sources
 * are recorded in docs/MANDATE_PROTOCOLS_FIGMA_2026-10-04.md. Each is decorative because the
 * row title supplies its accessible name. Both row sizes share the same mark.
 */
"use client";

import type { ProtocolId } from "../mandateDraft";

/** Committed brand assets for every protocol the mandate can display (POO-2167 v4). */
const PROTOCOL_LOGOS: Record<ProtocolId, string> = {
  "uniswap-v3-swap": "/protocols/uniswap.svg",
  "uniswap-v3": "/protocols/uniswap.svg",
  "uniswap-v4": "/protocols/uniswap.svg",
  across: "/protocols/across.svg",
  "aave-v3": "/tokens/aave.png",
  gmx: "/protocols/gmx.svg",
  pendle: "/protocols/pendle.png",
};

/** Public props for the decorative protocol logo. */
export interface ProtocolMarkProps {
  id: ProtocolId;
  /** Kept for shared row callers; the accessible protocol name belongs to the row. */
  name: string;
  /** Edge length in px. 24 on step 2, 28 on the taller step 5 rows. */
  size?: number;
}

/** The protocol's canonical local brand mark, hidden from assistive technology. */
export function ProtocolMark({ id, size = 24 }: ProtocolMarkProps) {
  return (
    // biome-ignore lint/performance/noImgElement: a small local brand asset; matches the network logos.
    <img
      src={PROTOCOL_LOGOS[id]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className="shrink-0 object-contain"
    />
  );
}
