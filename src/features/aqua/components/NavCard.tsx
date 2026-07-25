import type { ActiveReserveState } from "@/lib/aqua/api/vaultState";
import { COPY } from "../copy";
import { formatUsdc, formatUsdPrice, formatWeth } from "../format";

type Live = Extract<ActiveReserveState, { status: "live" }>;

/**
 * Total value, and the three things it is made of.
 *
 * The breakdown is shown rather than just the total because the whole point of the product is
 * that the money is in two places at once: earning interest and standing ready to buy. A
 * single NAV number hides exactly the thing worth seeing.
 */
export function NavCard({
  nav,
  sleeves,
  price,
}: {
  nav: Live["nav"];
  sleeves: Live["sleeves"];
  price: Live["price"];
}) {
  return (
    <section aria-labelledby="nav-title" className="rounded-lg border border-border bg-surface p-6">
      <h2 id="nav-title" className="text-sm font-medium text-muted-foreground">
        {COPY.nav.title}
      </h2>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{formatUsdc(nav.totalAssetsUsdc)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{COPY.nav.help}</p>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{COPY.sleeves.carry}</dt>
          <dd className="tabular-nums font-medium">{formatUsdc(sleeves.parkedUsdc)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Cash on hand</dt>
          <dd className="tabular-nums font-medium">{formatUsdc(sleeves.hotBufferUsdc)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{COPY.sleeves.acquired}</dt>
          <dd className="tabular-nums font-medium">
            {formatWeth(sleeves.acquiredWeth)}
            {/* IDX-R6: a token amount always carries its USD value at display time. */}
            <span className="ml-1 text-muted-foreground">({formatUsdc(nav.wethValuedUsdc)})</span>
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-muted-foreground">
        ETH valued at {formatUsdPrice(price.ethUsdE8)} (Chainlink, {price.ageSeconds}s ago)
      </p>
    </section>
  );
}
