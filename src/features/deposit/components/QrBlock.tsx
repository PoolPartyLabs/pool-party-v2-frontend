/**
 * @id PP-DEP-CMP-004
 * @name QrBlock
 * @implements-rules-version v1
 *
 * A REAL, scannable QR of the crypto deposit address (POO-507 R1): the plain checksummed address
 * (exchange convention - works on any supported EVM network; EIP-681 payment URIs are explicitly
 * out of v1). Encoded client-side with `uqr` (zero network calls - PP-SECURITY: the address never
 * leaves the device for rendering) and drawn as an SVG module grid over a white background with the
 * encoder's quiet zone, so it scans on the dark theme (R2). Deterministic output keeps SSR and the
 * client in agreement. The Copy/Share buttons remain alongside; the graphic itself stays
 * presentational (`aria-hidden`) since the address is printed as text below it.
 */

import { encode } from "uqr";

/** Public props for {@link QrBlock}. */
export interface QrBlockProps {
  /** The value to encode (the plain deposit address). */
  value: string;
  /** Extra classes on the svg. */
  className?: string;
}

/** Scannable QR graphic of the given value. */
export function QrBlock({ value, className }: QrBlockProps) {
  // ECC + version are auto-selected by the encoder; border=2 keeps the quiet zone inside the svg.
  const { size, data } = encode(value, { border: 2 });
  const modules: { r: number; c: number }[] = [];
  for (let r = 0; r < size; r += 1) {
    const row = data[r];
    if (!row) continue;
    for (let c = 0; c < size; c += 1) {
      if (row[c]) modules.push({ r, c });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <rect x="0" y="0" width={size} height={size} fill="#ffffff" />
      {modules.map((m) => (
        <rect key={`${m.r}-${m.c}`} x={m.c} y={m.r} width="1" height="1" fill="#0a0a0a" />
      ))}
    </svg>
  );
}
