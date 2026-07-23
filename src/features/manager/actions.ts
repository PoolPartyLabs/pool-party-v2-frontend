/**
 * @id PP-MGR-SCR-001 (POO-224, POO-742, POO-779, POO-781, POO-782, POO-991) · PP-CORE-LIB-049 (POO-991)
 * @name Manager console server action
 * @implements-rules-version v3 · v1 (POO-991: drop the legacy /analytics/wallets manager read)
 *
 * Builds the manager console Overview for the signed-in wallet. POO-779 R4 (v3): the managed-strategy
 * LIST now comes from the managerWallet-scoped v2 read (`listManagedStrategies`, server-paged, POO-777)
 * UNION any vanished-but-held managed pool recovered from the wallet's positions — retiring the second
 * full-catalog drain (POO-669). The positions read stays only for the tiles/spark that need live
 * amounts (claimable yield left-joined by id). KPIs are derived from those. POO-742 R1: the manager
 * identity (name / handle) is sourced from the manager's OWN profile so the "Share your strategies"
 * card prefers the saved handle; only the derived-metrics scaffold stays mock, flagged.
 *
 * POO-659 v1: manager reads/writes key off the stable id (address when present, else handle). The
 * console reads the profile by `mockDashboard.address ?? mockDashboard.handle`, so the unfilled,
 * address-based dev manager (empty handle) still resolves. In real mode this is the session wallet.
 *
 * POO-781 R1/R2 (perf): the manager-profile read joins the 4-way console `Promise.all` (no data
 * dependency), so its RTT overlaps the batch instead of serializing ahead of it. The `!wallet` guard
 * order is preserved (wallet is known synchronously before the batch).
 * POO-782 R1/R2 (perf): the row-spark fan-out requests `period=1M` (trailing month, not full history)
 * and is capped at {@link MAX_SPARK_FETCHES}; pools past the cap render on the not-measured placeholder.
 *
 * PP-INTEGRATION-POINT: manager console list ← GET /api/v2/strategies?managerWallet=<wallet> (POO-777).
 * PP-INTEGRATION-POINT: manager console ← isPoolManager positions ⋈ /pools (POO-224).
 */
"use server";

import { getLocale } from "next-intl/server";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { fetchManagerFinancials } from "@/lib/financials/fetchManagerFinancials";
import type { ManagerFinancials } from "@/lib/financials/financialsSchema";
import { fetchDexPoolState } from "@/lib/manager/dexPoolState";
import { fetchDexPools } from "@/lib/manager/fetchDexPools";
import { fetchManagedPoolDetail } from "@/lib/manager/fetchManagedPoolDetail";
import { fetchManagerProfile } from "@/lib/manager/profile/fetchManagerProfile";
import { tickToPrice } from "@/lib/manager/tickPrice";
import { fetchPositions } from "@/lib/portfolio/fetchPositions";
import type {
  ManagerDashboard,
  ManagerProfile,
  ManagerStrategyDetail,
  UniswapPool,
} from "@/lib/schemas";
import { isMockMode, managerService } from "@/lib/services";
import { listManagedStrategies, listStrategiesForHoldings } from "@/lib/strategies/strategyCatalog";
import { fetchPoolTimeseries } from "@/lib/timeseries/fetchPoolTimeseries";
import { fetchManagerAumTimeseries } from "@/lib/timeseries/fetchWalletTimeseries";
import {
  buildManagePerformance,
  changePctOverDays,
  sliceByDays,
} from "@/lib/timeseries/manageSeries";
import { mapTimeseries } from "@/lib/timeseries/mapTimeseries";
import { type SparkResult, sparkFromSeries } from "./lib/buildSpark";
import { synthesizeManagerProfile } from "./lib/synthesizeManagerProfile";
import { buildManagerConsole, type ManagerConsoleViewModel } from "./managerConsoleViewModel";
import { mapDexPool } from "./mapDexPool";
import { mapManagerStrategyDetail } from "./mapManagerStrategyDetail";
import { composeManagedFromPositions, resolveManagedStrategies } from "./resolveManagedStrategies";
import { synthesizeApiPoolFromPosition } from "./synthesizeApiPoolFromPosition";

/** The manager console payload: derived Overview + a (placeholder) profile for the Profile tab. */
export interface ManagerConsolePayload extends ManagerConsoleViewModel {
  profile: ManagerProfile;
}

/**
 * POO-782 R2: cap on the per-render row-spark fan-out. One analytics GET per managed pool is issued via
 * `Promise.all`; the set grows linearly with managed pools and is otherwise unbounded, so we trim it to
 * the first {@link MAX_SPARK_FETCHES} pools (mirrors `MAX_ONCHAIN_BLOCK_READS = 10` in
 * strategiesV2Actions). Real managed-pool counts are single-digit today, so the cap only bounds a
 * pathological growth case; pools past it render on the not-measured placeholder rather than firing a
 * spark read.
 */
const MAX_SPARK_FETCHES = 10;

/**
 * Resolve the manager's OWN profile for the console Profile tab (POO-579). Real mode reads the deployed
 * registry (`GET /managers/:address`) by the session wallet; a wallet with no saved profile yet gets an
 * empty, editable profile (unclaimed handle) to fill on the first save. Mock mode (and the degenerate
 * no-wallet case) keeps the placeholder mock profile, keyed by the dashboard's stable id (POO-659).
 */
async function loadConsoleManagerProfile(
  mockDashboard: ManagerDashboard,
  wallet: string | null,
): Promise<ManagerProfile> {
  if (!isMockMode && wallet) {
    // PP-INTEGRATION-POINT (POO-579): manager profile ← pool-party-api GET /api/v1/managers/:address.
    return (await fetchManagerProfile(wallet)) ?? synthesizeManagerProfile(wallet, []);
  }
  const managerId = mockDashboard.address ?? mockDashboard.handle;
  const profile = await managerService.getProfile(managerId);
  if (!profile) throw new Error("manager placeholder profile missing");
  return profile;
}

/** The dashboard identity terms the "Share your strategies" card and the invite/greeting fallback use. */
interface ManagerIdentity {
  managerName: string;
  managerHandle: string;
  managerAddress: string | undefined;
}

/**
 * Derive the dashboard identity from the manager's OWN (real) profile, falling back to the mock
 * dashboard only for the still-mock metrics scaffold (POO-742 R1). Before POO-742 the console fed
 * `buildManagerConsole` the empty `mockDashboard.handle`/`.name` (managerService is the mock in BOTH
 * modes), so a saved handle was dropped and the share card always resolved to the wallet even with a
 * handle set. The display-side precedence (ManagerDashboardView) was already correct — it was just fed
 * an empty handle. An unfilled manager (no handle) keeps the wallet fallback.
 *
 * POO-659: `managerAddress` fills `dashboard.address`, the invite/greeting identity the view uses when
 * no handle is set (`/m/<address>`). Prefer the fetched profile's wallet (`fetchManagerProfile` →
 * `walletAddress`, or the 404 `synthesizeManagerProfile` → session wallet); fall back to the session
 * wallet directly. Empty → undefined so the view's connected-wallet last resort still holds.
 */
function resolveManagerIdentity(
  profile: ManagerProfile,
  mockDashboard: ManagerDashboard,
  wallet: string | null,
): ManagerIdentity {
  return {
    managerName: profile.name || mockDashboard.name,
    managerHandle: profile.handle || mockDashboard.handle,
    managerAddress: profile.address || wallet || undefined,
  };
}

/**
 * Fetch the signed-in wallet's managed strategies + derived dashboard, plus the manager's profile.
 *
 * PP-NOTE (POO-779 R4, closing the POO-669 gap): the console strategy list is the managerWallet-scoped
 * v2 read (`listManagedStrategies` → GET /api/v2/strategies?managerWallet=<wallet>, server-paged), no
 * longer the second full-catalog drain. The one case the scoped read cannot cover — a wound-down
 * managed pool that dropped out of the indexer (POO-373 `missing`, POO-455/537) — is recovered from the
 * wallet's held position (`fallbackStrategy`, POO-526) and UNIONed in, so parity holds regardless of
 * whether the backend returns `missing` rows (Q2). The console "Load more" is still a CLIENT-SIDE reveal
 * (`useRevealCount`, PP-CORE-HOK-022) over the drained list; the status filter stays client-side in
 * `ManageStrategiesView`. On a scoped-read error the list degrades to the legacy position-derived
 * compose (Q4). POO-991: the money KPIs come from the C1 /financials payload and the positions (yield
 * left-join), no longer the removed legacy `/analytics/wallets/:addr` manager summary.
 */
export async function getManagerConsoleAction(): Promise<ManagerConsolePayload> {
  // PP-MOCK: the dashboard display name/handle + the derived-metrics scaffold still come from the mock
  // service (strategies/manage stay mock, POO-579). Only the manager's OWN editable profile is wired.
  const mockDashboard = await managerService.getDashboard();
  const wallet = await getSessionWallet();

  // POO-579: the manager's own profile. Real mode reads the deployed registry by the SESSION WALLET —
  // killing the dev bug where every manager shared the one in-memory mock profile (evaporating on
  // pp_api restart, leaking across wallets). A wallet with no saved profile yet gets an empty, editable
  // profile (handle unclaimed) to fill on first save. Mock mode keeps the placeholder mock profile.
  //
  // POO-781 R1/R2: this read is INITIATED here but NOT awaited yet — it has no data dependency on the
  // batch below, so it runs concurrently with it (saving +1 cold-path RTT). The `!wallet` guard uses
  // `wallet` (known synchronously above), so guard order is preserved; the profile is only CONSUMED
  // after the guard/batch resolve, never before it.
  const profilePromise = loadConsoleManagerProfile(mockDashboard, wallet);

  if (!wallet) {
    const profile = await profilePromise;
    const { managerName, managerHandle, managerAddress } = resolveManagerIdentity(
      profile,
      mockDashboard,
      wallet,
    );
    return { ...buildManagerConsole([], [], managerName, managerHandle, managerAddress), profile };
  }

  // Analytics-derived dashboard extras (POO-366): the AUM hero series (real manager_aum; a <2-point
  // series hides the chart rather than showing a flat point) and the trailing-30d AUM change derived
  // from it. POO-991: the net-30d-inflows + performance earnings now come from the C1 /financials
  // payload (below), not the removed legacy `/analytics/wallets/:addr` manager summary.
  //
  // POO-779 R4: the console LIST now comes from the managerWallet-scoped read (`listManagedStrategies`,
  // server-paged) instead of the second full-catalog drain (`listStrategiesForHoldings`, POO-669). The
  // positions read stays (below) ONLY because the tiles/spark need live amounts: `yieldGenerated` is
  // left-joined from positions by id (in buildManagerConsole), and the vanished-but-held pool recovery
  // (Q2) reuses those same positions — so the drain the scoped read replaces is the CATALOG one.
  //
  // POO-781 R2: the manager profile joins this Promise.all so its RTT overlaps the batch's slowest
  // (cold-drain) leg.
  const locale = await getLocale();
  // PP-CORE-LIB-048 (POO-990): the C1 manager /financials payload — read UNCONDITIONALLY in real mode
  // (the `financialsV2` flag was removed). Mock mode does not read the analytics indexer, so it stays
  // null (the console builds from the mock scaffold). POO-991: null (mock / unavailable) → the money
  // tiles degrade per buildManagerConsole's [R3] posture (on-chain Σ for AUM/investors/yield; honest
  // null for netInflows30d + earnings), no longer the removed legacy manager-summary fallback.
  const financialsPromise: Promise<ManagerFinancials | null> = isMockMode
    ? Promise.resolve(null)
    : fetchManagerFinancials(wallet);
  const [positions, scopedManaged, aumSeries, profile, financials] = await Promise.all([
    // `closed=all` so a manager whose managed position is fully exited (they withdrew their own
    // stake) still yields a console row instead of the first-run empty state (POO-456), and so the
    // vanished-but-held recovery (Q2) and the yield left-join (Q3) see the closed managed positions.
    fetchPositions(wallet, await getAuthHeader(), "all"),
    // POO-779 R4: the managerWallet-scoped strategy list (real mode); the full mock catalog in mock
    // mode. `null` signals a real-mode scoped-read error → we degrade to the legacy compose (Q4).
    listManagedStrategies(wallet),
    fetchManagerAumTimeseries(wallet),
    // POO-991: the legacy `fetchManagerSummary(wallet)` leg (net inflows / perf earned / all-time
    // investors from `/analytics/wallets/:addr`) is removed — those tiles read `financials` below.
    profilePromise,
    financialsPromise,
  ]);

  // POO-742 R1: source the dashboard's identity from the manager's own (real) profile, falling back to
  // the mock dashboard only for the still-mock metrics scaffold.
  const { managerName, managerHandle, managerAddress } = resolveManagerIdentity(
    profile,
    mockDashboard,
    wallet,
  );

  // POO-779 R4: resolve the managed-strategy LIST. Real-mode scoped read → union it with any
  // vanished-but-held managed pool recovered from the wallet's positions (Q2), deduped by id. On a
  // scoped-read error (`null`) → the legacy position-derived compose from the holdings catalog (Q4),
  // which also covers mock mode's position-gated join (R5). Both keep the list ownership-scoped, so the
  // deep-link manage-detail authorization gate (ManagerConsoleScreen) still holds.
  //
  // B1 (mock-mode fix): in mock mode `listManagedStrategies` returns the FULL mock catalog (unscoped,
  // there is no managerWallet filter on the mock service), so `scopedManaged` is non-null but is NOT
  // ownership-scoped. Routing it through `resolveManagedStrategies` would list every fixture, breaking
  // R5 and mis-driving the AUM/investor tiles. So mock mode goes through the position-gated
  // `composeManagedFromPositions` (the full mock catalog is exactly the `catalog` arg it expects; it
  // gates to the `isPoolManager` position → `strat-delta-neutral` only). Real mode keeps the scoped read.
  const managed =
    isMockMode || scopedManaged === null
      ? composeManagedFromPositions(scopedManaged ?? (await listStrategiesForHoldings()), positions)
      : resolveManagedStrategies(scopedManaged, positions);

  // POO-559 R1: a real trailing-30d value spark per managed row. Keyed off the RESOLVED managed list
  // (R4) rather than the positions, so a listed pool the manager no longer holds still gets its series;
  // fetch each in parallel (fetchPoolTimeseries is analyticsFetch-cached 300s, so the fan-out collapses
  // to one indexer round-trip per pool per 5min) and window+downsample it. An uncovered / <2-point
  // series yields a not-measured result (R2) the view renders as the hidden flat placeholder.
  const managedIds = [...new Set(managed.map((strategy) => strategy.id))];
  // POO-782 R2: bound the spark fan-out (precedent: MAX_ONCHAIN_BLOCK_READS in strategiesV2Actions).
  // The fan-out grows linearly with managed pools and is otherwise uncapped, so pools past the cap fire
  // NO spark read; the view model already renders a row with no `sparksById[id]` on the not-measured
  // placeholder (the same path as an uncovered pool), never an unbounded burst of upstream reads.
  const sparkIds = managedIds.slice(0, MAX_SPARK_FETCHES);
  // POO-782 R1: sparks only ever plot the trailing 30d, so request `period=1M` — each read pulls the
  // last month, not the full history. This splits the spark cache key from the full-series detail chart
  // (accepted: sparks are tiny and 300s-cached); see fetchPoolTimeseries.
  const sparkResults = await Promise.all(
    sparkIds.map((id) => fetchPoolTimeseries(id, { period: "1M" })),
  );
  const sparksById: Record<string, SparkResult> = {};
  sparkIds.forEach((id, index) => {
    sparksById[id] = sparkFromSeries(sparkResults[index] ?? []);
  });

  // POO-936 [R4]: when the cutover is on, the hero chart series comes from the SAME /financials source
  // as the AUM KPI (`charts.aumSeries`, dropping honest-NULL points), windowed to the trailing 30d so
  // it agrees with the "AUM over the last 30 days" label. Null financials → the legacy manager_aum
  // series. The view model reads the served 30d change % + scalar tiles from `financials` directly.
  const financialsChart =
    financials && financials.charts.aumSeries.length > 0
      ? mapTimeseries(
          sliceByDays(
            financials.charts.aumSeries
              .filter((p): p is { date: string; valueUsd: number } => p.valueUsd !== null)
              .map((p) => ({ date: p.date, value_usd: p.valueUsd })),
            30,
          ),
          locale,
        )
      : null;
  // POO-936 [R4]: the AUM tile, its 30d change %, and the hero chart MUST read the SAME source. The
  // served /financials AUM series is only plottable when it holds >= 2 non-null points; when it is
  // sparse (0-1 points) we plot the LEGACY manager_aum series instead — so in that case the AUM
  // headline + change % must ALSO fall back to legacy (never a served AUM over a legacy trend line).
  // `aumChartFromFinancials` carries that single decision into the view model so it picks the matching
  // AUM + change-% source; the other served money tiles (yield/perf-fees/inflows/investors) are
  // independent of the chart and keep their own served-else-legacy resolution.
  const aumChartFromFinancials = (financialsChart?.length ?? 0) >= 2;
  const chart = aumChartFromFinancials
    ? // biome-ignore lint/style/noNonNullAssertion: aumChartFromFinancials implies financialsChart is set
      financialsChart!
    : aumSeries.length >= 2
      ? mapTimeseries(sliceByDays(aumSeries, 30), locale)
      : [];
  const vm = buildManagerConsole(positions, managed, managerName, managerHandle, managerAddress, {
    // POO-555 R1: the plotted series is windowed to the trailing 30 days so it agrees with the
    // "AUM over the last 30 days" chart label and the 30d change pill beside it. POO-936: the served
    // /financials series when it plots (>= 2 points); else the legacy manager_aum (see chart above).
    chart,
    aumChangePct: changePctOverDays(aumSeries, 30),
    // POO-991: netInflows30d / perfEarned / totalInvestorsAllTime are no longer passed as legacy-summary
    // extras — buildManagerConsole reads them from `financials` (C1 /financials), degrading netInflows30d
    // + earnings to honest-null and totalInvestorsAllTime to the on-chain Σ when the payload is absent.
    // PP-INTEGRATION-POINT: manager card spark ← analytics GET /analytics/pools/:id/timeseries (POO-559).
    sparksById,
    // POO-936: the served ledger financials (the source of truth for the money tiles + change % when on).
    financials,
    // POO-936 [R4]: whether the served /financials AUM series is what we plotted — the AUM headline +
    // change % follow the SAME source as the chart (served when true, legacy when the served series is
    // too sparse to plot).
    aumChartFromFinancials,
  });
  return { ...vm, profile };
}

/**
 * Fetch the real manage-detail for one of the signed-in wallet's managed strategies. The live path
 * looks up an ACTIVE strategy's pool + network in the catalog, reads the full pool detail, and maps it
 * (with the manager's position for the claimable proxy + POO-366 analytics). POO-537: a closed/
 * wound-down strategy falls back to a READ-ONLY detail synthesized from the wallet's held position
 * (POO-526). POO-753: the live read is now GATED on `status !== "closed"` — POO-721 made the v2
 * holdings catalog return closed rows WITH pool+network, which re-armed the live `/pools` read for a
 * wound-down pool that endpoint doesn't serve (POO-373), throwing a non-404 that 500'd the action
 * before the synth fallback could run. Returns null only for an unknown/unheld strategy.
 */
export async function getManagerStrategyDetailAction(
  strategyId: string,
): Promise<ManagerStrategyDetail | null> {
  const authHeader = await getAuthHeader();
  const wallet = await getSessionWallet();
  const locale = await getLocale();
  // Holdings catalog + the wallet's positions (closed=all) + the pool's AUM series (POO-366) so a
  // manager can open the manage detail of a strategy they closed (POO-455/537), with the real
  // per-period charts. POO-558 R1: a <2-point series leaves the analytics UNDEFINED (no flat mock) so
  // the view renders the explicit no-history state instead of a fake flat line at current AUM.
  const [strategies, positions, series] = await Promise.all([
    listStrategiesForHoldings(),
    wallet ? fetchPositions(wallet, authHeader, "all") : Promise.resolve([]),
    fetchPoolTimeseries(strategyId),
  ]);
  const position = positions.find((p) => p.strategyId === strategyId) ?? null;
  const analytics =
    series.length >= 2
      ? {
          performance: buildManagePerformance(series, locale),
          aumChangePct: changePctOverDays(series, 30),
        }
      : undefined;

  // Live path: an ACTIVE strategy (live in /pools) → read its full single-pool detail. POO-753: gate
  // on `status !== "closed"`. POO-721 made listStrategiesForHoldings drain the v2 catalog with NO
  // lifecycle filter, so a CLOSED/wound-down strategy is now returned here WITH pool+network — but GET
  // /pools/:pool does NOT serve wound-down pools (POO-373) and answers with a non-404 that
  // fetchManagedPoolDetail rethrows, 500ing the action BEFORE the synth fallback below could run. A
  // closed strategy has no live pool detail, so skip the read and fall through to the read-only synth.
  const strategy = strategies.find((s) => s.id === strategyId);
  if (strategy?.pool && strategy.network && strategy.status !== "closed") {
    const pool = await fetchManagedPoolDetail(strategy.pool, strategy.network, authHeader);
    // POO-715: the pool-detail read carries no logo, so thread the manager-uploaded logo from the
    // joined catalog Strategy (mapStrategyV2) into the detail header.
    if (pool)
      return mapManagerStrategyDetail(
        pool,
        position,
        analytics,
        strategy.logoUrl,
        strategy.nftPositionId,
        // POO-820: the v1 pool-detail read has on-chain feesApr only; thread the v2 catalog
        // strategy's Revert feesApr (estReturn) so "Net APR" matches the strategies-list "Est. return".
        strategy.estReturn,
      );
  }

  // POO-537: a closed/wound-down strategy drops out of /pools (POO-373) — or is returned as a closed
  // catalog row (POO-721) whose live read we skip above — so build a READ-ONLY manage detail from the
  // wallet's held position (closed=all) + its synth-from-position descriptor (POO-526). A full close
  // leaves no residual, so the existing `isClosed` treatment (operations disabled) applies. A
  // genuinely unknown/unheld id still resolves to null (not found).
  if (!position) return null;
  const synthPool = synthesizeApiPoolFromPosition(position);
  return synthPool ? mapManagerStrategyDetail(synthPool, position, analytics) : null;
}

/**
 * Fetch the candidate Uniswap pools for a token pair (the builder's pool picker). `/dex-pools` is
 * pair-keyed, so the manager picks `currency0` (+ optional `currency1`) from the static token list.
 */
export async function getDexPoolsAction(
  network: string,
  currency0: string,
  currency1?: string,
): Promise<UniswapPool[]> {
  const pools = await fetchDexPools(network, currency0, currency1, await getAuthHeader());
  return pools.map((pool) => mapDexPool(pool, network));
}

/** The live on-chain price + tick of the selected builder pool (POO-861 R1/R3). */
export interface LivePoolPrice {
  /** Current price, token1 per 1 token0 (same convention as `UniswapPool.currentPrice`). */
  currentPrice: number;
  /** The pool's current on-chain tick (the value the seed-side + mint mins are derived from). */
  tickCurrent: number;
}

/**
 * Read the selected pool's FRESH on-chain price for the builder's live refresh (POO-861 R1/R3). Reads
 * the SAME `fetchDexPoolState` source the create-pool build uses for its mint mins, and derives the
 * human price from the on-chain `tickCurrent` (tickToPrice), so the builder's displayed price and its
 * seed-side decision match exactly what the mint will see. Returns null when the pool state can't be
 * read (404 / unsupported), so the caller keeps its last known price.
 *
 * PP-INTEGRATION-POINT (POO-861): live pool price ← pool-party-api single dex-pool state (POO-315).
 */
export async function getPoolCurrentPriceAction(input: {
  network: string;
  currency0: string;
  currency1: string;
  feeTier: number;
}): Promise<LivePoolPrice | null> {
  const state = await fetchDexPoolState(
    input.network,
    input.currency0,
    input.currency1,
    input.feeTier,
    await getAuthHeader(),
  );
  if (!state) return null;
  return {
    currentPrice: tickToPrice(
      state.tickCurrent,
      state.currency0.decimals,
      state.currency1.decimals,
    ),
    tickCurrent: state.tickCurrent,
  };
}
