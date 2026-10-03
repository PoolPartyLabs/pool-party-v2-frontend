/**
 * @id PP-MGR-CMP-036
 * @name ProtocolMark
 * @implements-rules-version v1
 * @analytics-events none, decorative; the steps that render it emit through the shell
 *
 * A protocol's leading mark, shared by the Mandate steps that list protocols as rows (POO-2128,
 * epic POO-2119).
 *
 * Only Uniswap has a committed asset under `public/protocols`, so everything else takes a monogram
 * on the raised surface rather than a brand colour this repo would be inventing. Decorative in every
 * caller: the row title carries the name, so the mark is `aria-hidden` like every other logo in the
 * app, and it is deliberately NOT a `ProtocolBadge` (that one pairs the asset with the protocol's
 * name as text, at 13 px, for the pool rows; this one is the 24 to 28 px row avatar and prints no
 * text of its own).
 *
 * Lifted here from the two step files that each carried a copy: `ProtocolsStep.tsx` (S3) declared it
 * module-private, and `LimitsStep.tsx` (S6) repeated the twelve lines behind a `PP-DEBT(SEV:LOW)`
 * because a slice may not edit another slice's file. The ID stays `PP-MGR-CMP-036`, the Protocols
 * step's, because that is where the mark was designed and it is the registry row that already
 * describes it. The only difference between the two copies was the edge, which is why `size` is a
 * prop: step 2's rows are 24 px and step 5's are taller at 28 px.
 */
"use client";

import type { ProtocolId } from "../mandateDraft";

/** The protocols whose brand mark is committed under `public/protocols`. */
const UNISWAP_PROTOCOLS: readonly ProtocolId[] = ["uniswap-v3-swap", "uniswap-v3", "uniswap-v4"];

/** Public props for {@link ProtocolMark}. */
export interface ProtocolMarkProps {
  /** Which protocol, which decides whether a committed asset exists. */
  id: ProtocolId;
  /** The protocol's display name; only its first letter is used, for the monogram fallback. */
  name: string;
  /** Edge length in px. 24 matches the step 2 rows, 28 the taller step 5 ones. */
  size?: number;
}

/** The committed Uniswap asset for a Uniswap protocol, else a monogram of the protocol's name. */
export function ProtocolMark({ id, name, size = 24 }: ProtocolMarkProps) {
  if (UNISWAP_PROTOCOLS.includes(id)) {
    return (
      // biome-ignore lint/performance/noImgElement: a small committed SVG from our own origin, the same call NetworkLogo and ProtocolBadge make; next/image would add a loader round trip for no payload saving.
      <img
        src="/protocols/uniswap.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className="shrink-0"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-surface-raised font-semibold text-foreground text-xs"
    >
      {(name.charAt(0) || "?").toUpperCase()}
    </span>
  );
}
