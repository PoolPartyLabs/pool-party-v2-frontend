/**
 * @id PP-AUTH-SCR-001
 * @name FlyingIllustrations
 * @implements-rules-version v1
 * Decorative scatter of the Pool Party brand illustrations behind the pre-auth screens. Purely
 * visual: the layer is aria-hidden and non-interactive. Positions mirror the Figma sign-in frame
 * (percentages so the scatter scales across mobile + desktop). Static in MVP (no animation yet).
 */

/** One illustration placement: which SVG, where (percent of the viewport), size (px) and tilt. */
const ITEMS = [
  { n: 1, top: "3%", left: "4%", size: 30, rotate: 12 },
  { n: 2, top: "5%", left: "77%", size: 28, rotate: -14 },
  { n: 3, top: "21%", left: "11%", size: 34, rotate: -18 },
  { n: 4, top: "25%", left: "84%", size: 28, rotate: 10 },
  { n: 5, top: "34%", left: "2%", size: 36, rotate: -22 },
  { n: 6, top: "39%", left: "75%", size: 40, rotate: 18 },
  { n: 7, top: "50%", left: "10%", size: 44, rotate: -12 },
  { n: 8, top: "47%", left: "50%", size: 30, rotate: 22 },
  { n: 9, top: "57%", left: "83%", size: 32, rotate: -9 },
  { n: 10, top: "63%", left: "1%", size: 38, rotate: 16 },
  { n: 11, top: "67%", left: "72%", size: 26, rotate: -20 },
  { n: 12, top: "74%", left: "20%", size: 28, rotate: 8 },
  { n: 13, top: "86%", left: "83%", size: 32, rotate: -16 },
  { n: 14, top: "95%", left: "41%", size: 24, rotate: 14 },
] as const;

/** Renders the faint, non-interactive brand-illustration backdrop. */
export function FlyingIllustrations() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 select-none overflow-hidden"
    >
      {ITEMS.map((item) => (
        <img
          key={item.n}
          src={`/brand/illustrations/${item.n}.svg`}
          alt=""
          className="absolute opacity-[0.08]"
          style={{
            top: item.top,
            left: item.left,
            width: item.size,
            transform: `rotate(${item.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
