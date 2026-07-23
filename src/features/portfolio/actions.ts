/**
 * @id PP-STR (POO-216, POO-270, POO-453)
 * @name Portfolio server actions
 * @implements-rules-version v2
 *
 * Server Action for the connected wallet's positions. The wallet identity is derived
 * server-side from the SIWE session cookie (POO-270), not trusted from the client, and the
 * session token is forwarded as a Bearer so pool-party-api can bind the read to the wallet.
 * The API read runs server-side in fetchPositions, so the browser never calls the API directly.
 *
 * v2 (POO-453): [R3] returns a discriminated result instead of throwing. A thrown Server Action
 * error loses its status in production (Next sends only a digest), so the client could not tell a
 * transient throttle/timeout from a genuine failure and hard-failed the page on the first 429. By
 * returning `{ ok, retryable }` the client can back off and retry a transient failure while keeping
 * the last-good view, and surface only real errors ([R4]/[R5]).
 */
"use server";

import { isTransientApiError } from "@/lib/api/errors";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { fetchPositions } from "@/lib/portfolio/fetchPositions";
import type { Position } from "@/lib/schemas";
import { isMockMode, positionService } from "@/lib/services";
import { listStrategiesForHoldings } from "@/lib/strategies/strategyCatalog";
import { fetchInvestorPortfolioTimeseries } from "@/lib/timeseries/fetchWalletTimeseries";
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";
import { joinPositionsToStrategies } from "./joinPositionsToStrategies";
import type { PortfolioViewPosition } from "./PortfolioView";

/**
 * [R3] Outcome of a positions read. `retryable` marks a transient upstream failure (throttle 429,
 * gateway/DB blip 502/503/504, timeout 408, network) the client should retry rather than surface.
 */
export type PositionsResult =
  | { ok: true; positions: Position[] }
  | { ok: false; retryable: boolean };

/**
 * Fetch the signed-in wallet's positions. Not signed in → empty list. Never throws for an upstream
 * failure: a transient failure returns `{ ok: false, retryable: true }`, anything else
 * `{ ok: false, retryable: false }`.
 */
export async function getPositionsAction(): Promise<PositionsResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return { ok: true, positions: [] };
  try {
    const positions = await fetchPositions(wallet, await getAuthHeader());
    return { ok: true, positions };
  } catch (error) {
    // [R3] Classify: transient upstream failures are retryable; everything else is a hard error.
    return { ok: false, retryable: isTransientApiError(error) };
  }
}

/**
 * Fetch the signed-in wallet's per-investor portfolio value-over-time series (its TOTAL value across
 * all positions, POO-368), for the Home + Portfolio hero charts. The wallet is derived server-side
 * from the SIWE session (POO-270), never trusted from the client. Not signed in → `[]` (no read).
 *
 * Never throws: the fetcher coalesces the pending stub / absent field / empty series / analytics
 * outage all to `[]` (POO-367 R2), so a caller degrades to the honest-empty hero (R3). The series is
 * wallet-scoped so the client loader (reads the connected wallet) invokes this action, mirroring the
 * manager-console action pattern (getManagerConsoleAction → fetchManagerAumTimeseries).
 *
 * PP-INTEGRATION-POINT: per-investor portfolio value series ← analytics investor_portfolio.series (POO-368).
 */
export async function getInvestorPortfolioSeriesAction(): Promise<TimeseriesPoint[]> {
  const wallet = await getSessionWallet();
  if (!wallet) return [];
  return fetchInvestorPortfolioTimeseries(wallet);
}

/**
 * Fetch the wallet's fully-exited (already-withdrawn) closed strategies for the Portfolio "Show
 * closed strategies" history (POO-460), each joined to its strategy for the name/risk. These are
 * hidden from the main portfolio and are read-only (nothing left to withdraw).
 *
 * Real wiring (POO-476): reads the exited feed `/portfolio/:wallet/all?closed=exited` (fully
 * withdrawn = zero balance). Cannot be seen "working" against a live API — the `closed=exited`
 * semantics are per the pool-party-api contract (portfolio.controller.ts). Mock mode serves the
 * static exited fixture through the service factory.
 */
export async function getClosedStrategiesAction(): Promise<PortfolioViewPosition[]> {
  // Mock: the static exited fixture. Real: the signed-in wallet's exited positions (closed=exited).
  const raw = isMockMode
    ? await positionService.listExited()
    : await (async () => {
        const wallet = await getSessionWallet();
        return wallet ? fetchPositions(wallet, await getAuthHeader(), "exited") : [];
      })();
  if (raw.length === 0) return [];

  // Join to the holdings catalog, then fall back to the Strategy synthesized from the position's own
  // pool descriptor (POO-526 R1). Exited positions are closed pools, which `/pools` omits, so the
  // catalog cannot resolve them — the fallback keeps the read-only history instead of dropping it. A
  // position with neither is DROPPED, never shown with fabricated data (no-mock-in-real). The join is
  // the shared helper (POO-668) so the paged reads and this one-shot read resolve identically.
  const strategies = await listStrategiesForHoldings();
  return joinPositionsToStrategies(raw, strategies);
}
