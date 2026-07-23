/**
 * @id PP-MGR-CMP-025
 * @name TokenSplitBar
 * @implements-rules-version v1
 *
 * The estimated value split between a Uniswap v3 position's two tokens for a chosen range: a two-tone
 * composition bar plus a legend with each token's percent (and optional logo). Extracted from
 * {@link BuildStep} so both the strategy builder's Build step and the Move Range modal (POO-387 [R5])
 * render the same "Estimated balance" visual. Purely presentational — the percentages come from
 * {@link tokenSplit} (rangeMath), this only draws them.
 *
 * POO-501 (@issue POO-501): optional per-token logos already existed (icon0/icon1); this adds an
 * optional pre-formatted amount/USD sub-line (`sub0`/`sub1`) rendered as a muted second line under
 * each legend side (R2). The sub-lines are computed + formatted upstream (MoveRangeModal derives them
 * from the reserve-value split); this stays purely presentational and unchanged when they are absent
 * (percent-only legend, R4).
 */
"use client";

/** Public props for {@link TokenSplitBar}. */
export interface TokenSplitBarProps {
  /** Percent of position value held as token0 (0–100). */
  pct0: number;
  /** Percent of position value held as token1 (0–100). */
  pct1: number;
  /** token0 symbol shown in the legend. */
  token0: string;
  /** token1 symbol shown in the legend. */
  token1: string;
  /** Optional token0 logo URL. */
  icon0?: string;
  /** Optional token1 logo URL. */
  icon1?: string;
  /** Optional pre-formatted token0 amount + USD sub-line (POO-501 R2), e.g. "~0.5 ETH (~$1,500)". */
  sub0?: string;
  /** Optional pre-formatted token1 amount + USD sub-line (POO-501 R2). */
  sub1?: string;
}

/** Estimated value split between the two tokens (logos + a two-tone bar + percent legend + optional
 *  per-token amount/USD sub-lines). */
export function TokenSplitBar({
  pct0,
  pct1,
  token0,
  token1,
  icon0,
  icon1,
  sub0,
  sub1,
}: TokenSplitBarProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-raised">
        <div className="bg-info" style={{ width: `${pct0}%` }} aria-hidden="true" />
        <div className="bg-info/40" style={{ width: `${pct1}%` }} aria-hidden="true" />
      </div>
      <div className="flex items-start justify-between text-muted-foreground text-xs">
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            {icon0 ? <img src={icon0} alt="" className="size-4 rounded-full" /> : null}
            <span className="font-medium text-foreground">{Math.round(pct0)}%</span>
            {token0}
          </span>
          {sub0 ? <span className="text-[11px] text-muted-foreground">{sub0}</span> : null}
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="flex items-center gap-1.5">
            {token1}
            <span className="font-medium text-foreground">{Math.round(pct1)}%</span>
            {icon1 ? <img src={icon1} alt="" className="size-4 rounded-full" /> : null}
          </span>
          {sub1 ? (
            <span className="text-right text-[11px] text-muted-foreground">{sub1}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
