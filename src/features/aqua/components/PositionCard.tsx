import type { AquaPosition } from "@/lib/aqua/api/vaultState";
import { COPY } from "../copy";
import { formatUnits, formatUsdc } from "../format";

/**
 * "Your position", lime-tinted like the strategy detail screen's owned card so an investor who
 * knows that screen recognises this one immediately.
 *
 * Value comes from the vault's own `convertToAssets` (IDX-R3), so what is shown is what the
 * contract would actually pay, not a share price recomputed here.
 */
export function PositionCard({
  position,
  totalShares,
}: {
  position: AquaPosition;
  totalShares: string;
}) {
  const share = ownershipPct(position.shares, totalShares);

  return (
    <div className="rounded-xl border border-success/40 bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-base text-foreground">{COPY.position.title}</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-medium text-success text-xs">
          {COPY.position.active}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="text-muted-foreground text-xs">{COPY.position.value}</p>
          <p className="font-semibold text-foreground">{formatUsdc(position.valueUsdc)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{COPY.position.shares}</p>
          <p className="font-semibold text-foreground">
            {share === null ? "-" : `${share.toFixed(2)}%`}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Share of the vault, or null when the vault reports no shares at all (FE-R7). */
function ownershipPct(shares: string, totalShares: string): number | null {
  const mine = BigInt(shares || "0");
  const total = BigInt(totalShares || "0");
  if (total <= BigInt(0)) return null;
  return Number((mine * BigInt(1_000_000)) / total) / 10_000;
}

export { formatUnits, ownershipPct };
