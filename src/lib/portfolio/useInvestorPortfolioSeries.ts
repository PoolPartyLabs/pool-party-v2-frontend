/**
 * @id PP-PORT (POO-367)
 * @name useInvestorPortfolioSeries
 * @implements-rules-version v1
 *
 * Real-mode client hook for the connected wallet's per-investor portfolio value-over-time series
 * (`investor_portfolio.series`, POO-368), read via getInvestorPortfolioSeriesAction once the SIWE
 * session is up (the wallet is derived server-side, POO-270). Feeds the Home + Portfolio hero charts.
 *
 * The series is a low-stakes read: it only shapes the hero chart, which degrades to honest-empty on
 * an empty series (POO-556 R1 / POO-367 R3). So — unlike usePositions — there is no retry/last-good
 * machinery: any not-yet-resolved / not-signed-in / failed read simply yields `[]`, and the chart
 * renders its honest-empty affordance. A later refresh naturally replaces it (the effect re-runs on
 * session changes). Mock-safe like the other wallet-scoped hooks: mock mode never reads (returns []),
 * because in mock mode the view models fabricate the design-harness series themselves.
 *
 * PP-INTEGRATION-POINT: per-investor portfolio value series ← analytics investor_portfolio.series (POO-368).
 */
"use client";

import { useEffect, useState } from "react";
import { getInvestorPortfolioSeriesAction } from "@/features/portfolio/actions";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { isMockMode } from "@/lib/services";
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";

/**
 * The signed-in wallet's per-investor value series, or `[]` while it is loading / not signed in / the
 * read failed. Hooks run unconditionally (mock mode is gated inside, not by an early return) so the
 * hook order is stable every render.
 */
export function useInvestorPortfolioSeries(): TimeseriesPoint[] {
  const { isSignedIn, status } = useSiweSession();
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);

  useEffect(() => {
    if (isMockMode) return;
    // Not (yet / ever) signed in, or a failed SIWE handshake: no wallet to read → stay honest-empty.
    if (status === "error" || !isSignedIn) {
      setSeries([]);
      return;
    }
    let active = true;
    getInvestorPortfolioSeriesAction()
      .then((next) => {
        if (active) setSeries(next);
      })
      .catch(() => {
        // The action never throws for an upstream failure (it coalesces to []); a thrown Server Action
        // invocation (network blip) is still non-fatal here — the hero just stays honest-empty.
        if (active) setSeries([]);
      });
    return () => {
      active = false;
    };
  }, [isSignedIn, status]);

  return isMockMode ? [] : series;
}
