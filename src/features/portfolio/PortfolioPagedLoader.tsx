/**
 * @id PP-PORT-SCR-001 (POO-668, POO-829)
 * @name Portfolio paged loader
 * @implements-rules-version v3 (POO-829 rules v2)
 *
 * The real-mode client boundary for the Portfolio (POO-668), superseding the previous drain-everything
 * real-mode loader. Used only when isMockMode is false; mock mode SSRs the Portfolio directly (unchanged).
 *
 * v3 design (POO-829 — BOTH lists server-paged):
 * - the ACTIVE "Your positions" list is SERVER-paged (useServerPage over `loadPortfolioPageAction`,
 *   `closed=none`, page size 5, short-page termination, its own "Load more") and SERVER-sorted:
 *   the sort tuple (default Yield descending, [R2]) keys the page loader, so a header/mobile-control
 *   change from PortfolioView (`onSortChange`) re-keys `loadPage` and RESETS the pager to page 0 with
 *   the new `sorting=<field>:<dir>` (POO-828 sorts the FULL holdings before slicing, so accumulated
 *   pages form one globally-sorted list). This retires the POO-668 v2 active drain (useActivePortfolio),
 *   unblocked by POO-696 serving the avgApy/allocation grand aggregates ([R1]).
 * - [R4] the KPI header reads balance / fees / claimable AND avgApy + allocation from the backend
 *   GRAND aggregates ({@link mapAggregatesToKpis}); avgApy/allocation keep a client-compute fallback
 *   over the LOADED active rows while the aggregate is absent (deploy-order-independent, POO-696).
 *   The aggregates are page-independent, captured from every page read (latest wins).
 * - the on-demand "Show closed strategies" history stays BACKEND-PAGED (`closed=exited`, its own
 *   short-page "Load more"), lazy until the first reveal, backend closed-with-balance-first order
 *   verbatim, NEVER sorted (out of POO-829's scope).
 * - freshness: both lists re-read their loaded pages IN PLACE on a 45s interval + focus/visibility
 *   (paused while hidden, POO-329) via `useServerPage.refresh()` — never a reset (scroll survives).
 * - the SIWE session gates the active read (POO-270): signed-out renders the skeleton (never a false
 *   empty state); the wallet is derived server-side inside the action, never passed from the client.
 * - a real INITIAL active error bubbles to the route error boundary; a failed refresh/loadMore keeps
 *   the last-good rows (useServerPage never wipes `items` on failure).
 *
 * PP-CORE-LIB-048 (POO-990, legacy excision): the legacy `/metrics` read (useWalletMetrics) is gone.
 * "Total yield" now comes from the C1 `/financials` payload (`useWalletFinancials`) EXCLUSIVELY, via
 * {@link mapAggregatesToKpis} — no cross-backend collected-fees join. A financials read that is
 * unavailable renders Invested / Total yield as "not available yet" (never a legacy number). The
 * "unclaimed fees" pill (`totalEarned`) stays CLAIMABLE-ONLY (POO-898 R1), sourced from the C1 served
 * claimable with the pp_api grand aggregate as the non-legacy non-null fallback.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerPage } from "@/lib/api/useServerPage";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { useWalletFinancials } from "@/lib/financials/useWalletFinancials";
// Type-only: fetchPortfolioPage is server-only, but its sort TYPES are erased at compile time.
import type { PortfolioSort } from "@/lib/portfolio/fetchPortfolioPage";
import { mapPortfolioAggregates, type PortfolioAggregates } from "@/lib/portfolio/positionsSchema";
import { useInvestorPortfolioSeries } from "@/lib/portfolio/useInvestorPortfolioSeries";
import { buildInvestorPortfolioSeries } from "@/lib/timeseries/investorSeries";
import { PortfolioSkeleton } from "./components/PortfolioSkeleton";
import { computeApyAndAllocation } from "./computeApyAndAllocation";
import { mapAggregatesToKpis } from "./mapAggregatesToKpis";
import { PortfolioView, type PortfolioViewPosition } from "./PortfolioView";
import { loadPortfolioPageAction } from "./portfolioPagedActions";

/** The "Load more" stride for BOTH lists (POO-668 decision: 5, like the v1 interface + Explore). */
const PAGE_SIZE = 5;

/** How often the loaded pages silently re-read (paused while hidden, POO-329). */
const REFRESH_MS = 45_000;

/** POO-829 [R2]: the default active sort — Yield (position PnL in USD) descending. */
const DEFAULT_SORT: PortfolioSort = { key: "yield", dir: "desc" };

/** Public props for {@link PortfolioPagedLoader}. */
export interface PortfolioPagedLoaderProps {
  /**
   * Active locale (label formatting), threaded into the view for the hero chart series. The
   * position→strategy join runs SERVER-SIDE in the portfolio actions (POO-668), so this loader needs
   * no client-side strategy catalog (the route no longer fetches one for the real path).
   */
  locale: string;
}

/** Renders the connected wallet's Portfolio (active + closed both server-paged, active sorted). */
export function PortfolioPagedLoader({ locale }: PortfolioPagedLoaderProps) {
  // The real per-investor value series (POO-368); `[]` while loading / not signed in → honest-empty hero.
  const investorSeries = useInvestorPortfolioSeries();

  // PP-CORE-LIB-048: the C1 `/financials` payload — the SOLE analytics money source. Null while in
  // mock mode, not signed in, or on an unavailable read → mapAggregatesToKpis renders Invested / Total
  // yield as "not available yet" (never a legacy number, never $0). Non-null → the source of truth for
  // Invested / Total yield (the SAME field Home reads) + the preferred hero total / claimable pill.
  const financials = useWalletFinancials();

  // POO-829 [R2]: the active sort tuple, default Yield desc. PortfolioView's headers/mobile control
  // write it via paged.active.onSortChange; the change re-keys `loadActive`, which resets the pager
  // to page 0 with the new `sorting` (useServerPage re-reads on loader-identity change).
  const [sort, setSort] = useState<PortfolioSort>(DEFAULT_SORT);

  // The SIWE session gates the reads (POO-270): before it resolves, the loader serves empty pages
  // locally (no backend call) and the skeleton below covers the wait; the sign-in flip re-keys the
  // loader → a real page-0 read. The wallet itself is derived server-side inside the action.
  const { isSignedIn } = useSiweSession();

  // The backend GRAND aggregates (page-independent) that drive the KPI header. Captured from every
  // active page read (latest wins — a refresh keeps them current). Zeroed until the first read.
  const [aggregates, setAggregates] = useState<PortfolioAggregates>(() =>
    mapPortfolioAggregates(null),
  );

  // PP-INTEGRATION-POINT: active investor positions + grand aggregates ← pool-party-api
  // `GET /portfolio/:wallet/all?closed=none&page&limit&sorting` via loadPortfolioPageAction (POO-828).
  const loadActive = useCallback(
    async (page: number) => {
      if (!isSignedIn) return { items: [], total: 0 };
      const result = await loadPortfolioPageAction({
        closed: "none",
        page,
        limit: PAGE_SIZE,
        // POO-829 [R2]: every page carries the active sort, so the accumulated pages form one
        // globally-sorted list (the backend sorts the FULL holdings before slicing).
        sorting: sort,
      });
      setAggregates(result.aggregates);
      return { items: result.items, total: result.total };
    },
    [isSignedIn, sort],
  );
  const active = useServerPage<PortfolioViewPosition>({
    loadPage: loadActive,
    pageSize: PAGE_SIZE,
    pageMode: "short-page",
  });

  // The closed history loader: LAZY — until revealed, `loadPage` returns an empty page so no
  // `closed=exited` read happens on the initial Portfolio load. Flipping `closedRevealed` re-keys the
  // loader (a new `loadClosed` identity), which triggers useServerPage to read page 0 (POO-668 R2).
  // NEVER sorted: the exited feed renders the backend order verbatim (closed-with-balance-first).
  const [closedRevealed, setClosedRevealed] = useState(false);
  const loadClosed = useCallback(
    async (page: number) => {
      if (!closedRevealed) return { items: [], total: 0 };
      const result = await loadPortfolioPageAction({ closed: "exited", page, limit: PAGE_SIZE });
      return { items: result.items, total: result.total };
    },
    [closedRevealed],
  );
  const closed = useServerPage<PortfolioViewPosition>({
    loadPage: loadClosed,
    pageSize: PAGE_SIZE,
    pageMode: "short-page",
  });

  // Keep the loaded pages fresh: re-read them IN PLACE on a 45s interval + focus/visibility (paused
  // while hidden, POO-329). `refresh()` keeps the cursor + scroll — a same-ids refetch is a refresh,
  // not a reset (also covers a write that busts the positions tag, POO-453). Never `reset()` (that
  // would jump the user back to page 0).
  const refreshActive = active.refresh;
  const refreshClosed = closed.refresh;
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const refreshBoth = () => {
      void refreshActive();
      if (closedRevealed) void refreshClosed();
    };
    const start = () => {
      if (intervalId === undefined) intervalId = setInterval(refreshBoth, REFRESH_MS);
    };
    const stop = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshBoth();
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => refreshBoth();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshActive, refreshClosed, closedRevealed]);

  // A real INITIAL active failure bubbles to the route error boundary. A failed refresh / Load-more
  // keeps the last-good rows (useServerPage never wipes `items` on failure), so a populated view is
  // never torn down by a transient blip. The closed read is on-demand and its failure is non-fatal.
  if (active.error && active.items.length === 0) throw active.error;

  // Skeleton until the SIWE session resolves AND the first active page settles — never a false
  // empty state for a signed-out/still-loading wallet.
  if (!isSignedIn || (active.loading && active.items.length === 0)) return <PortfolioSkeleton />;

  // [R4] the hero/pill/apy KPIs from the pp_api grand aggregates: balance/fees (POO-668 R3) and, since
  // POO-696, avgApy + allocation too — with a client-compute fallback over the LOADED active rows while
  // the aggregate is absent (deploy-order-independent; a backend 0 / [] is a real value and wins).
  // PP-CORE-LIB-048: Invested / Total yield come from the C1 `financials` payload EXCLUSIVELY.
  const kpis = mapAggregatesToKpis(aggregates, computeApyAndAllocation(active.items), financials);

  return (
    <PortfolioView
      {...kpis}
      chartData={buildInvestorPortfolioSeries(investorSeries, locale).all}
      positions={active.items}
      paged={{
        active: {
          // POO-829 [R1]: the active list's own "Load more" (short-page termination).
          hasMore: active.hasMore,
          loading: active.loading,
          onLoadMore: () => void active.loadMore(),
          // POO-829 [R2]: a sort change re-keys `loadActive` → pager reset to page 0 (new sorting).
          onSortChange: setSort,
        },
        closed: {
          // `null` until the first reveal, then the loaded closed pages (backend order verbatim).
          entries: closedRevealed ? closed.items : null,
          loading: closed.loading,
          hasMore: closed.hasMore,
          onReveal: () => setClosedRevealed(true),
          onLoadMore: closed.loadMore,
        },
      }}
    />
  );
}
