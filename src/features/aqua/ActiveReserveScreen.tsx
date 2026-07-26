"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { MetricTile } from "@/components/data-display/MetricTile";
import type { ActiveReserveState, AquaPosition } from "@/lib/aqua/api/vaultState";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/utils/cn";
import { AquaLiquidityModal } from "./components/AquaLiquidityModal";
import { BandCard } from "./components/BandCard";
import { CompositionCard } from "./components/CompositionCard";
import { FillsFeed } from "./components/FillsFeed";
import { MandateCard } from "./components/MandateCard";
import { PositionCard } from "./components/PositionCard";
import { SleevesCard } from "./components/SleevesCard";
import { VerifyBlock } from "./components/VerifyBlock";
import { COPY, PRODUCT_DESCRIPTION, PRODUCT_NAME } from "./copy";
import { formatUsdc, formatUsdPrice, formatWeth } from "./format";

/**
 * @id PP-AQUA-SCR-001
 * @name Active Reserve detail
 * @implements-rules-version v3
 *
 * The investor surface for POO-1067, laid out to match StrategyDetailScreen: a 2/3 main column
 * with a sticky action rail on desktop, the same hero shape, the same metric tile grid, and the
 * same collapsed-by-default Composition and Investment mandate cards (POO-903). Someone who
 * knows the Uniswap strategy pages should recognise this one without being told it is a
 * different strategy class.
 *
 * Everything is read live from Arbitrum on each request. FE-R7 shapes the structure: a section
 * whose real data is missing is hidden rather than filled with a placeholder, and the whole
 * page collapses to an honest "not deployed yet" state before launch.
 *
 * Add and remove liquidity are real vault calls signed by the investor's own wallet. There is
 * no mock path on this screen.
 *
 * PP-INTEGRATION-POINT: state comes from the internal Aqua API module (server-only, over
 * Arbitrum plus the ships/fills tables). Post-hackathon this seam moves to pool-party-api.
 */
export function ActiveReserveScreen({
  state,
  now,
  position,
}: {
  state: ActiveReserveState;
  /** Injected so the epoch countdown is deterministic in tests and in a server render. */
  now: Date;
  position?: AquaPosition | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address } = useAuth();
  const [modal, setModal] = useState<"add" | "remove" | null>(null);

  /**
   * Carry the connected wallet into the URL so the server render can read its position.
   *
   * The position is read SERVER-side from `?investor=`, which keeps the page a single server read
   * with no client waterfall, but leaves it blind to who is connected. Without this the investor
   * deposits successfully and then sees no position and a permanently disabled "Remove liquidity",
   * because `router.refresh()` re-runs the same parameterless request.
   *
   * `replace` rather than `push`, so the back button is not littered with address states, and the
   * comparison is what stops it looping: the effect only fires when the URL disagrees with the
   * wallet, which after one replace it no longer does.
   */
  const investorParam = searchParams.get("investor");
  useEffect(() => {
    if (!address) return;
    if (investorParam?.toLowerCase() === address.toLowerCase()) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("investor", address);
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [address, investorParam, searchParams, router]);

  if (state.status === "not-launched") {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <Hero />
        <section
          aria-labelledby="not-launched-title"
          className="rounded-xl border border-border bg-surface p-6"
        >
          <h2 id="not-launched-title" className="font-semibold text-base text-foreground">
            {COPY.notLaunched.title}
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">{COPY.notLaunched.body}</p>
        </section>
        <Disclosure />
      </div>
    );
  }

  const cap = BigInt(state.maxTvlUsdc);
  const held = BigInt(state.nav.totalAssetsUsdc);
  const roomUsdc = (cap > held ? cap - held : BigInt(0)).toString();
  const capReached = roomUsdc === "0";
  // A cap of zero is not "full", it is closed: the manager has wound the reserve down. Saying
  // "at its deposit cap" there would suggest waiting for room that is never coming.
  const closedToDeposits = cap === BigInt(0);

  // One action group, rendered in the desktop rail and again in the mobile flow.
  const actions = (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <Row label={COPY.metrics.tvl} value={formatUsdc(state.nav.totalAssetsUsdc)} />
      <Row label={COPY.metrics.cap} value={formatUsdc(state.maxTvlUsdc)} />
      <button
        type="button"
        className={cn(primaryBtn, "w-full")}
        disabled={!state.seeded || capReached}
        onClick={() => setModal("add")}
      >
        {COPY.actions.add}
      </button>
      {!state.seeded ? (
        <p className="text-center text-muted-foreground text-xs">{COPY.actions.notSeeded}</p>
      ) : closedToDeposits ? (
        <p className="text-center text-muted-foreground text-xs">{COPY.actions.closed}</p>
      ) : capReached ? (
        <p className="text-center text-muted-foreground text-xs">{COPY.actions.capReached}</p>
      ) : null}
      {position ? (
        <button
          type="button"
          className={cn(outlineBtn, "w-full")}
          onClick={() => setModal("remove")}
        >
          {COPY.actions.remove}
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Hero price={state.price.ethUsdE8} protocols={state.mandate.protocols} />

          {state.price.stale ? (
            <p
              role="status"
              className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-foreground text-sm"
            >
              {COPY.stalePrice}
            </p>
          ) : null}

          {position ? (
            <div className="lg:hidden">
              <PositionCard position={position} totalShares={state.nav.totalShares} />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <MetricTile label={COPY.metrics.tvl} value={formatUsdc(state.nav.totalAssetsUsdc)} />
            <MetricTile label={COPY.metrics.carry} value={formatUsdc(state.sleeves.parkedUsdc)} />
            <MetricTile label={COPY.metrics.fee} value="0.80%" />
            <MetricTile
              label={COPY.sleeves.acquired}
              value={formatWeth(state.sleeves.acquiredWeth)}
            />
          </div>

          <section aria-labelledby="about-title">
            <h2 id="about-title" className="mb-3 font-semibold text-base text-foreground">
              About
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">{PRODUCT_DESCRIPTION}</p>
          </section>

          {state.composition ? <CompositionCard slices={state.composition} /> : null}
          <MandateCard mandate={state.mandate} />
          <SleevesCard sleeves={state.sleeves} price={state.price} />

          {state.bands.length > 0 ? (
            <section aria-labelledby="bands-title" className="flex flex-col gap-3">
              <div>
                <h2 id="bands-title" className="font-semibold text-base text-foreground">
                  {COPY.band.title}
                </h2>
                <p className="text-muted-foreground text-sm">{COPY.band.help}</p>
              </div>
              {state.bands.map((band) => (
                <BandCard key={band.strategyHash} band={band} price={state.price} now={now} />
              ))}
            </section>
          ) : null}

          <FillsFeed fills={state.fills} />
          <Provenance />
          <VerifyBlock vault={state.vault} adapter={state.adapter} />
          <Disclosure />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-6 flex flex-col gap-4">
            {position ? (
              <PositionCard position={position} totalShares={state.nav.totalShares} />
            ) : null}
            {actions}
          </div>
        </aside>
      </div>

      <div className="lg:hidden">{actions}</div>

      <AquaLiquidityModal
        mode={modal ?? "add"}
        open={modal !== null}
        onClose={() => setModal(null)}
        // A confirmed transaction changes chain state, so re-render the server component
        // rather than patching a local copy that could drift from the vault.
        onDone={() => router.refresh()}
        positionShares={position?.shares ?? null}
        positionValueUsdc={position?.valueUsdc ?? null}
        liquidUsdc={state.liquidUsdc}
        seeded={state.seeded}
        roomUsdc={roomUsdc}
      />
    </div>
  );
}

/** Hero: name, tagline, pair and venue badges, and the live ETH price on the right. */
function Hero({ price, protocols }: { price?: string; protocols?: Array<{ label: string }> } = {}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 lg:p-6">
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-lg text-primary">
          AR
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-bold text-foreground text-xl">{PRODUCT_NAME}</h1>
          <p className="mt-0.5 text-muted-foreground text-sm">{COPY.tagline}</p>
          {protocols ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border px-2.5 py-0.5 font-medium text-foreground text-xs">
                WETH / USDC
              </span>
              {protocols.map((protocol) => (
                <span
                  key={protocol.label}
                  className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground text-xs"
                >
                  {protocol.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {price ? (
          <div className="text-right">
            <p className="font-bold text-2xl text-foreground">{formatUsdPrice(price)}</p>
            <p className="text-[10px] text-muted-foreground uppercase">ETH / USD</p>
          </div>
        ) : null}
      </div>
      {protocols ? null : <p className="mt-4 text-sm leading-relaxed">{PRODUCT_DESCRIPTION}</p>}
    </section>
  );
}

/**
 * FE-R11 v2: what is live and what is not, on the page itself.
 *
 * A submission that claims "everything is on-chain" and quietly ships one checked-in list is
 * making the reader do the auditing. Saying it here costs a paragraph and removes the question.
 */
function Provenance() {
  return (
    <section
      aria-labelledby="provenance-title"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <h2 id="provenance-title" className="font-semibold text-base text-foreground">
        {COPY.provenance.title}
      </h2>
      <p className="mt-2 text-muted-foreground text-sm">{COPY.provenance.live}</p>
      <p className="mt-2 text-muted-foreground text-sm">{COPY.provenance.fixed}</p>
    </section>
  );
}

function Disclosure() {
  return (
    <section aria-labelledby="disclosure-title" className="rounded-xl border border-border p-6">
      <h2 id="disclosure-title" className="font-semibold text-base text-foreground">
        {COPY.disclosure.title}
      </h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-muted-foreground text-sm">
        {COPY.disclosure.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm disabled:cursor-not-allowed disabled:opacity-50";
const outlineBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 font-medium text-foreground text-sm";
