import type { ActiveReserveState } from "@/lib/aqua/api/vaultState";
import { BandCard } from "./components/BandCard";
import { FillsFeed } from "./components/FillsFeed";
import { NavCard } from "./components/NavCard";
import { SleevesCard } from "./components/SleevesCard";
import { VerifyBlock } from "./components/VerifyBlock";
import { COPY, PRODUCT_DESCRIPTION, PRODUCT_NAME } from "./copy";

/**
 * @id PP-AQUA-SCR-001
 * @name Active Reserve investor page (read-only)
 * @implements-rules-version v3
 *
 * The investor surface for POO-1067, minimal-first: everything on it is read live from
 * Arbitrum on each request. There is no deposit or redeem here yet; those are the second
 * cut, and shipping the read-only view first means the page can never show a control that
 * does not work.
 *
 * FE-R7 is the rule that shapes the structure: a section whose real data is missing is
 * hidden, never filled with a placeholder. The whole page collapses to an honest
 * "not deployed yet" state before launch rather than rendering zeros.
 *
 * PP-INTEGRATION-POINT: state comes from the internal Aqua API module (server-only, over
 * Arbitrum plus the ships/fills tables). Post-hackathon this seam moves to pool-party-api.
 */
export function ActiveReserveScreen({
  state,
  now,
}: {
  state: ActiveReserveState;
  /** Injected so the epoch countdown is deterministic in tests and in a server render. */
  now: Date;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{PRODUCT_NAME}</h1>
          <p className="text-sm text-muted-foreground">{COPY.tagline}</p>
        </div>
        {/* FE-R10: verbatim, and the same string the submission uses. */}
        <p className="text-sm leading-relaxed">{PRODUCT_DESCRIPTION}</p>
      </header>

      {state.status === "not-launched" ? (
        <section
          aria-labelledby="not-launched-title"
          className="rounded-lg border border-border bg-surface p-6"
        >
          <h2 id="not-launched-title" className="text-lg font-semibold">
            {COPY.notLaunched.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{COPY.notLaunched.body}</p>
        </section>
      ) : (
        <>
          {state.price.stale ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground"
            >
              {COPY.stalePrice}
            </p>
          ) : null}

          <NavCard nav={state.nav} sleeves={state.sleeves} price={state.price} />
          <SleevesCard sleeves={state.sleeves} price={state.price} />

          {state.bands.length > 0 ? (
            <section aria-labelledby="bands-title" className="flex flex-col gap-3">
              <div>
                <h2 id="bands-title" className="text-lg font-semibold">
                  {COPY.band.title}
                </h2>
                <p className="text-sm text-muted-foreground">{COPY.band.help}</p>
              </div>
              {state.bands.map((band) => (
                <BandCard key={band.strategyHash} band={band} price={state.price} now={now} />
              ))}
            </section>
          ) : null}

          <FillsFeed fills={state.fills} />
          <VerifyBlock vault={state.vault} adapter={state.adapter} />
        </>
      )}

      <section aria-labelledby="disclosure-title" className="rounded-lg border border-border p-6">
        <h2 id="disclosure-title" className="text-lg font-semibold">
          {COPY.disclosure.title}
        </h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
          {COPY.disclosure.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
