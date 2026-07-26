import type { ActiveReserveState } from "@/lib/aqua/api/vaultState";
import { COPY } from "../copy";
import { formatUsdc, shareOfTotal } from "../format";

type Live = Extract<ActiveReserveState, { status: "live" }>;

/**
 * The split between capital earning interest and capital on hand.
 *
 * Deliberately NOT a "90/10" claim: the actual ratio is whatever the vault currently holds,
 * and stating a designed ratio next to different real numbers is the kind of small dishonesty
 * that costs credibility in a demo. The bar renders the measured split or nothing (FE-R7).
 */
export function SleevesCard({
  sleeves,
  price,
}: {
  sleeves: Live["sleeves"];
  price: Live["price"];
}) {
  const parked = BigInt(sleeves.parkedUsdc);
  const buffer = BigInt(sleeves.hotBufferUsdc);
  const totalUsdc = parked + buffer;
  const parkedShare = shareOfTotal(parked, totalUsdc);

  if (totalUsdc <= BigInt(0)) return null;

  return (
    <section
      aria-labelledby="sleeves-title"
      className="rounded-lg border border-border bg-surface p-6"
    >
      <h2 id="sleeves-title" className="text-lg font-semibold">
        {COPY.sleeves.title}
      </h2>

      {parkedShare === null ? null : (
        <div
          className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-border"
          role="img"
          aria-label={`${parkedShare.toFixed(1)} percent earning interest, the rest held as cash`}
        >
          <div className="bg-primary h-full" style={{ width: `${parkedShare}%` }} />
        </div>
      )}

      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <dt className="font-medium">{COPY.sleeves.carry}</dt>
            <dd className="text-muted-foreground">{COPY.sleeves.carryHelp}</dd>
          </div>
          <span className="tabular-nums font-medium whitespace-nowrap">
            {formatUsdc(parked)}
            {parkedShare === null ? null : (
              <span className="ml-1 text-muted-foreground">({parkedShare.toFixed(1)}%)</span>
            )}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <div>
            <dt className="font-medium">Cash on hand</dt>
            <dd className="text-muted-foreground">
              Ready to settle a purchase immediately, without touching Aave.
            </dd>
          </div>
          <span className="tabular-nums font-medium whitespace-nowrap">{formatUsdc(buffer)}</span>
        </div>
      </dl>

      {price.stale ? null : (
        <p className="mt-4 text-xs text-muted-foreground">{COPY.sleeves.bandHelp}</p>
      )}
    </section>
  );
}
