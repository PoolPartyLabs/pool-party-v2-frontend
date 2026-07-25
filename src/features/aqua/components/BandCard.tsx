import type { ActiveReserveState, BandView } from "@/lib/aqua/api/vaultState";
import { COPY } from "../copy";
import {
  arbiscanTx,
  formatCountdown,
  formatUsdc,
  formatUsdPrice,
  formatWeth,
  percentFromSpot,
  shortHash,
} from "../format";

type Live = Extract<ActiveReserveState, { status: "live" }>;

/**
 * One buy band, positioned against the live market price.
 *
 * The visual is the point of this card: the band is a range strictly BELOW spot, and seeing
 * the marker sitting above the shaded range is what makes "it only fills when the market
 * comes down to it" obvious without a paragraph of explanation.
 *
 * Band edges come from the ship record (they were computed against the Chainlink spot at ship
 * time and are not recoverable from chain). When that record is missing the geometry is
 * omitted and only the live money is shown, per FE-R7.
 */
export function BandCard({
  band,
  price,
  now,
}: {
  band: BandView;
  price: Live["price"];
  now: Date;
}) {
  const hasEdges = band.lowE8 !== "" && band.highE8 !== "";
  const lowPct = hasEdges ? percentFromSpot(band.lowE8, price.ethUsdE8) : null;
  const highPct = hasEdges ? percentFromSpot(band.highE8, price.ethUsdE8) : null;
  const countdown = formatCountdown(band.deadline, now);
  const expired = countdown === "expired";

  return (
    <article className="rounded-lg border border-border bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium capitalize">{band.mandate} band</h3>
        <span className="text-sm text-muted-foreground">
          {COPY.band.epochEnds}:{" "}
          <span className={expired ? "text-muted-foreground" : "font-medium"}>
            {countdown || "unknown"}
          </span>
        </span>
      </div>

      {hasEdges ? (
        <>
          <p className="mt-3 text-sm">
            Buys between{" "}
            <span className="font-medium tabular-nums">{formatUsdPrice(band.lowE8)}</span> and{" "}
            <span className="font-medium tabular-nums">{formatUsdPrice(band.highE8)}</span>
            {lowPct !== null && highPct !== null ? (
              <span className="text-muted-foreground">
                {" "}
                ({lowPct.toFixed(1)}% to {highPct.toFixed(1)}% from market)
              </span>
            ) : null}
          </p>
          <BandGeometry lowPct={lowPct} highPct={highPct} />
          <p className="mt-2 text-xs text-muted-foreground">
            {COPY.band.current}: {formatUsdPrice(price.ethUsdE8)}
          </p>
        </>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{COPY.sleeves.band}</dt>
          <dd className="tabular-nums font-medium">{formatUsdc(band.committedUsdc)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{COPY.sleeves.acquired}</dt>
          <dd className="tabular-nums font-medium">{formatWeth(band.acquiredWeth)}</dd>
        </div>
      </dl>

      {band.shipTxHash ? (
        <p className="mt-4 text-xs">
          <a
            className="text-muted-foreground underline"
            href={arbiscanTx(band.shipTxHash)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Opened on-chain: {shortHash(band.shipTxHash)}
          </a>
        </p>
      ) : null}
    </article>
  );
}

/**
 * Market price as a marker, the band as a shaded range below it. Percentages are relative to
 * spot, so spot is always the right edge and the band extends left by its distance below.
 */
function BandGeometry({ lowPct, highPct }: { lowPct: number | null; highPct: number | null }) {
  if (lowPct === null || highPct === null) return null;

  // Give the axis a little air beyond the band's far edge so the shading never touches the
  // frame; a band flush against the edge reads as "clipped" rather than "bounded".
  const span = Math.max(Math.abs(lowPct) * 1.25, 1);
  const toX = (pct: number) => ((span + pct) / span) * 100;
  const left = toX(lowPct);
  const right = toX(highPct);

  return (
    <div className="mt-3">
      <div className="relative h-8 w-full rounded bg-border/40">
        <div
          className="bg-primary/30 absolute inset-y-0 rounded"
          style={{ left: `${left}%`, width: `${Math.max(right - left, 1)}%` }}
        />
        <div
          className="bg-foreground absolute inset-y-0 w-0.5"
          style={{ left: "100%" }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{lowPct.toFixed(1)}%</span>
        <span>market</span>
      </div>
    </div>
  );
}
