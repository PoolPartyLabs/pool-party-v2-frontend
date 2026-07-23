/**
 * @id PP-STR-SCR-002 (POO-300)
 * @name Strategy detail data loader
 * @implements-rules-version v4 (POO-906 rules v1)
 *
 * POO-847 (rules v1, Murilo 2026-07-11): the managed surface is DESKTOP-ONLY for now, so the
 * POO-224 owner→manage redirect fires only at/above `lg` (R1) and the skeleton hold for an owned
 * position applies only while the redirect can still happen — desktop or unmeasured (R2). Below
 * `lg` an owned position falls through to the investor detail (Owned chip, investor flows; the
 * manager full exit closes the pool via POO-847 R4 in useWithdraw).
 *
 * Real-mode client boundary for the strategy detail screen. The strategy itself is
 * fetched server-side (wallet-independent) and passed in; this loader adds the two
 * wallet-scoped reads: the investor's position in this strategy (usePositions) and the
 * spendable USDC balance for the invest flow (useAccountService). Skeleton until both
 * resolve; a real failure bubbles to the route error boundary.
 *
 * v2 (POO-557 R3/R5): when the route provides no real series (analytics 404/empty/error,
 * already degraded to nothing upstream) the loader passes an EMPTY series, and the screen
 * renders its explicit no-history state. The synthetic buildStrategyChartData projection
 * is never plotted as if it were real data (it stays a mock-mode-only concern in the page).
 *
 * PP-CORE-LIB-048 (POO-990, legacy excision): the legacy `/metrics` read (useWalletMetrics) is gone.
 * The share card sources its per-window figures from the C1 `/financials` per-strategy block
 * (`financials.byStrategy[position.id].feesEarned`) EXCLUSIVELY — the serving layer already outer-clamps
 * these ≥ 0 (financialsSchema D5/A4), so there is no FE `Math.max` re-clamp and no legacy `collectedFees`
 * fallback. A served NULL window is honest-absent → the whole card stays hidden for that position rather
 * than fabricating a $0; a financials read that is unavailable (not-signed-in / outage) likewise hides
 * the card, never showing a legacy figure.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useRouter } from "@/i18n/navigation";
import { useAccountService } from "@/lib/account/useAccountService";
import { networkToChainId } from "@/lib/chains/config";
import { useWalletFinancials } from "@/lib/financials/useWalletFinancials";
import { usePositions } from "@/lib/positions/usePositions";
import type { PositionEarnings, Strategy } from "@/lib/schemas";
import { StrategyDetailSkeleton } from "./components/StrategyDetailSkeleton";
import { StrategyDetailScreen } from "./StrategyDetailScreen";

/** Public props for {@link StrategyDetailDataLoader}. */
export interface StrategyDetailDataLoaderProps {
  /** The strategy, fetched server-side (wallet-independent). */
  strategy: Strategy;
  /**
   * The real pool AUM series (server-fetched, wallet-independent, POO-366). When present it drives
   * the performance chart; when absent (new/empty pool, or analytics unavailable) the screen shows
   * its explicit no-history state (POO-557 R3), never a synthetic series dressed as real.
   * PP-INTEGRATION-POINT: per-investor personal series is POO-368.
   */
  chartData?: ChartPoint[];
}

/** Adds the wallet-scoped position + balance to the server-fetched strategy and renders it. */
export function StrategyDetailDataLoader({
  strategy,
  chartData: realChartData,
}: StrategyDetailDataLoaderProps) {
  const { positions, error, refresh } = usePositions();
  // PP-CORE-LIB-048: the C1 `/financials` payload — the SOLE source for the "Your position" figures +
  // the share-card windows. Null while in mock mode, not signed in, or on an unavailable read → the
  // "Your position" card renders "not available yet" and the share card stays hidden (no legacy path).
  // Non-null → the per-strategy `byStrategy[id]` block sources the figures, and the POO-468 zeroed-
  // override is disabled ([R3]).
  const financials = useWalletFinancials();
  // Destructure the stable getUsdcBalance callback (memoized on the wallet address) rather than the
  // whole account-service object: that object's identity churns on every `chainChanged` event, so a
  // dep on it would re-run the balance effect mid-flow. An invest's `switchChain` (to a non-default
  // chain like Base) fires `chainChanged`, which would reset `balance` to null and collapse the
  // whole screen to the skeleton, unmounting the open transaction modal (POO-350).
  const { getUsdcBalance } = useAccountService();
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<unknown>(null);

  // POO-847 R1: the managed surface is desktop-only, so the redirect gates on the measured `lg`
  // split (null = not measured yet → wait, never guess). The FIRST measurement is LATCHED for this
  // mount: a live resize/rotation across `lg` must never re-fire the redirect and tear down an open
  // transactional modal mid wallet-sign; a navigation remounts the loader and re-measures.
  const measuredDesktop = useIsDesktop();
  const latchedDesktop = useRef<boolean | null>(null);
  if (latchedDesktop.current === null && measuredDesktop !== null) {
    latchedDesktop.current = measuredDesktop;
  }
  const isDesktop = latchedDesktop.current;

  // A manager who opens their OWN strategy from an investor surface (Explore / Home / Portfolio) is
  // routed to the manager manage view instead of the investor detail (POO-224) — DESKTOP only
  // (POO-847 R1); below `lg` the position renders as a plain invested strategy.
  useEffect(() => {
    if (!positions || isDesktop !== true) return;
    const owned = positions.find((entry) => entry.strategyId === strategy.id);
    if (owned?.isPoolManager) router.replace(`/manager?manage=${strategy.id}`);
  }, [positions, strategy.id, router, isDesktop]);

  // The invest settles on the strategy's chain, so the spendable balance is read there (POO-303),
  // not summed across networks — the Permit2 must not authorize more than the wallet holds here.
  const chainId = strategy.network ? networkToChainId(strategy.network) : undefined;

  useEffect(() => {
    let active = true;
    setBalance(null);
    setBalanceError(null);
    getUsdcBalance(chainId)
      .then((next) => {
        if (active) setBalance(next);
      })
      .catch((err) => {
        if (active) setBalanceError(err);
      });
    return () => {
      active = false;
    };
  }, [getUsdcBalance, chainId]);

  if (error) throw error;
  if (balanceError) throw balanceError;
  if (!positions || balance === null) return <StrategyDetailSkeleton />;

  const position = positions.find((entry) => entry.strategyId === strategy.id) ?? null;
  // Managed strategy: hold the skeleton while the effect above redirects to the manage view —
  // POO-847 R2: only on desktop or while the viewport is unmeasured (an eternal skeleton
  // otherwise); below `lg` the owned position falls through to the investor detail.
  if (position?.isPoolManager && isDesktop !== false) return <StrategyDetailSkeleton />;

  // The per-strategy /financials block for this position (POO-936), keyed by the on-chain position id
  // (the SAME key the /metrics map uses). Present only when the cutover is on AND the payload carries
  // this position; null otherwise → the legacy path below.
  const positionFinancials =
    financials && position ? (financials.byStrategy[position.id] ?? null) : null;

  // The share-card windows per period. PP-CORE-LIB-048: read `positionFinancials.feesEarned` DIRECTLY
  // — the serving layer already applied the D5/A4 OUTER clamp (>= 0 by construction), so there is NO
  // `?? collectedFees` fallback and NO FE `Math.max` re-clamp. A served NULL window (or a null
  // positionFinancials = financials unavailable / this position uncovered) means honest-absent → the
  // share card stays hidden (never a fabricated 0, never a legacy figure).
  let earnings: PositionEarnings | null = null;
  if (positionFinancials) {
    const { feesEarned } = positionFinancials;
    // Only build the earnings object when every window is a served number; a null window is
    // honest-absent, so keep the whole card hidden rather than fabricating a $0 for that period.
    if (feesEarned["24h"] !== null && feesEarned["7d"] !== null && feesEarned["30d"] !== null) {
      earnings = { "24h": feesEarned["24h"], "7d": feesEarned["7d"], "30d": feesEarned["30d"] };
    }
  }
  // POO-557 R3/R5: real mode only ever plots the real pool AUM series. No (or a short) series →
  // honest-empty, and the screen renders its explicit no-history state; the upstream fetch already
  // swallowed analytics errors (fetchPoolTimeseries → []), so degradation stays throw-free.
  const chartData = realChartData ?? [];

  return (
    <StrategyDetailScreen
      strategy={strategy}
      position={position}
      balance={balance}
      chartData={chartData}
      earnings={earnings}
      positionFinancials={positionFinancials}
      onPositionChanged={refresh}
    />
  );
}
