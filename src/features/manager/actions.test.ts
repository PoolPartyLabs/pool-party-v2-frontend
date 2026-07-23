/**
 * @id PP-MGR-SCR-001 (POO-555, POO-991) · PP-MGR-SCR-004 (POO-537)
 * @name Manager console server action tests
 * @implements-rules-version v1
 *
 * Two suites over the same `./actions` module (one shared, hoisted mock surface):
 *
 * - getManagerConsoleAction (POO-555 R1): windows the PLOTTED AUM series to the trailing 30 days, so
 *   the hero chart agrees with its "AUM over the last 30 days" aria-label and with the 30d change pill
 *   beside it (which was already windowed via changePctOverDays).
 * - getManagerStrategyDetailAction (POO-537): the manage-detail resolver — live path (catalog + pool
 *   detail) vs the synth-from-position fallback for a closed/wound-down strategy that dropped out of
 *   /pools. Only the I/O boundary is mocked; the real synth + mapper run, so the read-only closed
 *   detail is exercised end to end.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";
import { DEV_MANAGER_ADDRESS } from "@/mocks/data/manager";

const mocks = vi.hoisted(() => ({
  aumSeries: [] as { date: string; value_usd: number }[],
  strategies: [] as unknown[],
  positions: [] as unknown[],
  pool: null as unknown,
  // POO-753: when set, the fetchManagedPoolDetail mock THROWS it — simulating a non-404 from GET
  // /pools for a wound-down pool (POO-373), the exact 500 trigger for a closed strategy.
  poolError: null as unknown,
  // POO-753: how many times the live pool-detail endpoint was called — 0 proves a closed strategy
  // skipped the doomed read (positive proof, not the tautological `mocks.pool` null check).
  detailCalls: 0,
  wallet: "0xMANAGER" as string | null,
  // POO-559: per-pool value series keyed by id; the console action fetches one per managed row.
  poolSeriesById: {} as Record<string, { date: string; value_usd: number }[]>,
  // POO-742 R1: the manager's SAVED profile identity, driven per-test. The console must thread these
  // into dashboard.handle/name; before the fix it dropped them and fed the empty mock dashboard.
  profileHandle: "" as string,
  profileName: "" as string,
  // POO-779 R4: the managerWallet-scoped read result the console list is now built from. Defaults to
  // `mocks.strategies` (so the existing spark/tile suites drive the list via the scoped path); a test
  // sets it to `null` to model a scoped-read error and assert the legacy-compose fallback (Q4).
  managedScoped: undefined as unknown[] | null | undefined,
  // POO-782 R1/R2: record every fetchPoolTimeseries call ({ poolId, period }) so a test can assert
  // each spark read carries `period=1M` (R1) and that the fan-out is capped (R2).
  poolTimeseriesCalls: [] as { poolId: string; period?: string }[],
  // POO-781 R3 (site 2): an ordered log of which console dependency each mocked fetch ENTERED, plus a
  // gate on the manager-profile read. When `gateProfile` holds a deferred promise, the profile fetch
  // blocks until the test releases it — proving the 4-way batch is initiated WITHOUT awaiting the
  // profile first (a sequential `await profile` then batch would never enter the batch and would hang).
  callLog: [] as string[],
  gateProfile: null as null | { promise: Promise<void>; release: () => void },
  // B1 (POO-779): the mock-vs-real seam the console routes on. Defaults to `false` (real mode) so the
  // existing scoped-read suites are unchanged; the R5 mock-mode test flips it to `true` to prove the
  // console gates the FULL mock catalog to the manager's own `isPoolManager` position (not all fixtures).
  isMockMode: false as boolean,
}));

vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => ({ Authorization: "Bearer t" }),
}));
// POO-659: the dev-login manager is UNFILLED + ADDRESS-based — no handle/name yet.
vi.mock("@/lib/services", () => ({
  managerService: {
    getDashboard: async () => ({ name: "", handle: "", address: DEV_MANAGER_ADDRESS }),
    getProfile: async () => ({ handle: "", address: DEV_MANAGER_ADDRESS }),
  },
  // B1: a GETTER (not a literal) so a test can flip mock mode via `mocks.isMockMode`; the value import
  // in actions.ts reads this live binding each call. Defaults to `false` to preserve the real-mode suites.
  get isMockMode() {
    return mocks.isMockMode;
  },
}));
// POO-579: in real mode the console reads the manager's OWN profile from the deployed registry by the
// SESSION WALLET (not the mock service). Stub it so the console read stays hermetic.
// POO-781 R3: log entry + honor the profile gate so a timing test can prove the batch starts without
// awaiting this leg first.
vi.mock("@/lib/manager/profile/fetchManagerProfile", () => ({
  fetchManagerProfile: async () => {
    mocks.callLog.push("profile");
    if (mocks.gateProfile) await mocks.gateProfile.promise;
    return { handle: mocks.profileHandle, name: mocks.profileName, address: DEV_MANAGER_ADDRESS };
  },
}));
vi.mock("@/lib/portfolio/fetchPositions", () => ({
  fetchPositions: async () => {
    mocks.callLog.push("positions");
    return mocks.positions;
  },
}));
// POO-779 R4: the console list now comes from the managerWallet-scoped read (`listManagedStrategies`).
// It defaults to `mocks.strategies` so the existing suites drive rows through the scoped path; a test
// sets `mocks.managedScoped = null` to model a scoped-read error and assert the legacy-compose fallback,
// which reads `listStrategiesForHoldings` (still `mocks.strategies`). POO-781 R3: each leg logs its
// entry into `callLog` so the concurrency test can assert the batch was initiated without awaiting the
// profile leg first.
vi.mock("@/lib/strategies/strategyCatalog", () => ({
  listStrategiesForHoldings: async () => {
    mocks.callLog.push("strategies");
    return mocks.strategies;
  },
  listManagedStrategies: async () => {
    mocks.callLog.push("strategies");
    return mocks.managedScoped === undefined ? mocks.strategies : mocks.managedScoped;
  },
}));
vi.mock("@/lib/timeseries/fetchWalletTimeseries", () => ({
  fetchManagerAumTimeseries: async () => {
    mocks.callLog.push("aum");
    return mocks.aumSeries;
  },
}));
// POO-991: the legacy `@/lib/timeseries/fetchManagerSummary` read is removed — the console no longer
// fetches it, so there is no mock for it. The net-inflows / perf-earned / all-time-investors tiles now
// source from `financials` (fetchManagerFinancials, real mode) or degrade (mock mode → null financials).
vi.mock("@/lib/financials/fetchManagerFinancials", () => ({
  fetchManagerFinancials: async () => {
    mocks.callLog.push("financials");
    return null;
  },
}));
vi.mock("@/lib/manager/fetchDexPools", () => ({ fetchDexPools: vi.fn() }));
vi.mock("@/lib/manager/fetchManagedPoolDetail", () => ({
  fetchManagedPoolDetail: async () => {
    mocks.detailCalls += 1;
    // POO-753: a wound-down pool read can fail with a non-404 (POO-373); simulate that throw.
    if (mocks.poolError) throw mocks.poolError;
    return mocks.pool;
  },
}));
// POO-366 wove analytics into the detail action: stub the locale + pool timeseries so the read stays
// hermetic. An empty series leaves `analytics` undefined (the flat-mock path) — orthogonal to POO-537.
// POO-559: the console action also fetches one series per managed row for the card spark; key by id so
// a test can cover a pool that moved vs an uncovered one (empty series).
vi.mock("@/lib/timeseries/fetchPoolTimeseries", () => ({
  fetchPoolTimeseries: async (poolId: string, options?: { period?: string }) => {
    mocks.poolTimeseriesCalls.push({ poolId, period: options?.period });
    return mocks.poolSeriesById[poolId] ?? [];
  },
}));

import { getManagerConsoleAction, getManagerStrategyDetailAction } from "./actions";

beforeEach(() => {
  mocks.aumSeries = [];
  mocks.strategies = [];
  mocks.positions = [];
  mocks.pool = null;
  mocks.poolError = null;
  mocks.detailCalls = 0;
  mocks.wallet = "0xMANAGER";
  mocks.poolSeriesById = {};
  mocks.profileHandle = "";
  mocks.profileName = "";
  mocks.managedScoped = undefined;
  mocks.poolTimeseriesCalls = [];
  mocks.callLog = [];
  mocks.gateProfile = null;
  mocks.isMockMode = false;
});

/** A manually-released deferred promise, for the POO-781 R3 concurrency gate. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** `count` consecutive daily points ending 2026-07-04, values 1..count. */
function dailySeries(count: number): TimeseriesPoint[] {
  const end = Date.UTC(2026, 6, 4);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(end - (count - 1 - index) * 86_400_000).toISOString(),
    value_usd: index + 1,
  }));
}

describe("getManagerConsoleAction", () => {
  it("[R1] plots only the trailing 30 days of the AUM series", async () => {
    mocks.aumSeries = dailySeries(40);
    const payload = await getManagerConsoleAction();
    // 40 daily points in, only the last-30-days window plotted (31 daily closes).
    expect(payload.dashboard.chart).toHaveLength(31);
    // The 30d change pill stays windowed the same way: first-in-window 10 -> latest 40.
    expect(payload.dashboard.aumChangePct).toBeCloseTo(300);
  });

  it("[R1] gives a covered managed row a real trailing-30d value spark (measured)", async () => {
    // A managed pool whose analytics series moved: the row's spark is the windowed value series,
    // not the flat [tvl, tvl] placeholder, and is flagged measured.
    mocks.strategies = [
      { id: "0xcovered", name: "Covered", tvl: 1000, investors: 3, estReturn: 9 },
    ];
    mocks.positions = [{ strategyId: "0xcovered", isPoolManager: true, totalYield: 0 }];
    mocks.poolSeriesById = { "0xcovered": dailySeries(20) }; // rising 1..20 over 20d
    const payload = await getManagerConsoleAction();
    const row = payload.strategies.find((s) => s.id === "0xcovered");
    expect(row?.sparkMeasured).toBe(true);
    // Endpoints preserved: rises from the first windowed value to the latest (20).
    expect(row?.spark.at(-1)).toBe(20);
    expect((row?.spark.at(-1) ?? 0) > (row?.spark[0] ?? 0)).toBe(true);
    expect(row?.spark).not.toEqual([1000, 1000]);
  });

  it("[R2] leaves an uncovered managed row on the flat, not-measured placeholder", async () => {
    // The analytics indexer has no (or <2-point) series for this pool: the row keeps a schema-valid
    // 2-point [tvl, tvl] spark flagged NOT measured so the card hides it (never a fake flat trend).
    mocks.strategies = [{ id: "0xbare", name: "Bare", tvl: 5000, investors: 2, estReturn: 4 }];
    mocks.positions = [{ strategyId: "0xbare", isPoolManager: true, totalYield: 0 }];
    mocks.poolSeriesById = {}; // uncovered → empty series
    const payload = await getManagerConsoleAction();
    const row = payload.strategies.find((s) => s.id === "0xbare");
    expect(row?.spark).toEqual([5000, 5000]);
    expect(row?.sparkMeasured).toBe(false);
  });

  // POO-782 @rule R1: the spark fan-out passes `period=1M` so each spark pulls only the trailing
  // month, not the full history series. (The detail chart, which wants full history, keeps calling
  // fetchPoolTimeseries with NO period — locked in fetchPoolTimeseries.test.ts.)
  it("[POO-782 R1] requests each managed-row spark with period=1M", async () => {
    mocks.strategies = [
      { id: "0xa", name: "A", tvl: 1000, investors: 1, estReturn: 3 },
      { id: "0xb", name: "B", tvl: 2000, investors: 2, estReturn: 4 },
    ];
    mocks.positions = [
      { strategyId: "0xa", isPoolManager: true, totalYield: 0 },
      { strategyId: "0xb", isPoolManager: true, totalYield: 0 },
    ];

    await getManagerConsoleAction();

    expect(mocks.poolTimeseriesCalls).toHaveLength(2);
    for (const call of mocks.poolTimeseriesCalls) {
      expect(call.period).toBe("1M");
    }
    expect(new Set(mocks.poolTimeseriesCalls.map((c) => c.poolId))).toEqual(
      new Set(["0xa", "0xb"]),
    );
  });

  // POO-782 @rule R2: bound the spark fan-out (precedent MAX_ONCHAIN_BLOCK_READS = 10). Pools beyond
  // the cap fire NO spark request; the view model renders them on the not-measured placeholder (the
  // same path as an uncovered pool), never an unbounded burst of upstream reads.
  it("[POO-782 R2] caps the spark fan-out at 10 and renders the overflow without a spark", async () => {
    const managedCount = 14;
    mocks.strategies = Array.from({ length: managedCount }, (_, i) => ({
      id: `0x${i}`,
      name: `S${i}`,
      tvl: 1000 + i,
      investors: 1,
      estReturn: 3,
    }));
    mocks.positions = mocks.strategies.map((s) => ({
      strategyId: (s as { id: string }).id,
      isPoolManager: true,
      totalYield: 0,
    }));
    // Give every pool a moved series so, absent the cap, all 14 would be "measured".
    mocks.poolSeriesById = Object.fromEntries(
      mocks.strategies.map((s) => [(s as { id: string }).id, dailySeries(20)]),
    );

    const payload = await getManagerConsoleAction();

    // R2: at most 10 upstream spark reads regardless of the managed count.
    expect(mocks.poolTimeseriesCalls).toHaveLength(10);
    // Every managed pool still renders as a row (14), but only the first 10 carry a measured spark;
    // the overflow rows fall back to the not-measured placeholder.
    expect(payload.strategies).toHaveLength(managedCount);
    const measuredCount = payload.strategies.filter((s) => s.sparkMeasured === true).length;
    expect(measuredCount).toBe(10);
  });

  it("[POO-659] populates dashboard.address from the manager profile in real mode", async () => {
    // Real mode (isMockMode:false): the manager's profile is read from the deployed registry and its
    // `address` (walletAddress) fills `dashboard.address`. Before this fix buildManagerConsole never set
    // the field, so the middle term of the view's `handle || dashboard.address || address` fallback was
    // always undefined and the empty-handle `/m/<address>` branch was a fixture-only, production-impossible
    // state. With an empty handle, this real address is what the "Share your strategies" link resolves to.
    mocks.wallet = "0xMANAGER";
    const payload = await getManagerConsoleAction();
    expect(payload.dashboard.address).toBe(DEV_MANAGER_ADDRESS);
    // No handle set, so the invite/greeting identity is the address (not the connected wallet).
    expect(payload.dashboard.handle).toBe("");
  });

  it("[R4] keeps fees30d/flows30d at 0 even for a covered row (no windowable source yet)", async () => {
    mocks.strategies = [
      { id: "0xcovered", name: "Covered", tvl: 1000, investors: 3, estReturn: 9 },
    ];
    mocks.positions = [{ strategyId: "0xcovered", isPoolManager: true, totalYield: 0 }];
    mocks.poolSeriesById = { "0xcovered": dailySeries(10) };
    const payload = await getManagerConsoleAction();
    const row = payload.strategies.find((s) => s.id === "0xcovered");
    expect(row?.fees30d).toBe(0);
    expect(row?.flows30d).toBe(0);
  });

  // POO-742 R1 (the reported bug): the manager's saved handle is fetched into `profile` but was
  // DROPPED — the console fed `buildManagerConsole` the empty mock-dashboard handle, so the share
  // card always resolved to the wallet even with a handle set. The console must source the
  // dashboard identity from the loaded profile.
  it("[POO-742 R1] threads the saved profile handle + name into the dashboard (real mode)", async () => {
    mocks.profileHandle = "satoshi-desk";
    mocks.profileName = "Satoshi Desk";
    const payload = await getManagerConsoleAction();
    expect(payload.dashboard.handle).toBe("satoshi-desk");
    expect(payload.dashboard.name).toBe("Satoshi Desk");
  });

  it("[POO-742 R1] leaves the dashboard handle empty when the profile has none (wallet fallback)", async () => {
    // No saved handle → dashboard.handle stays "" so the card falls back to the wallet, never a bare /m/.
    mocks.profileHandle = "";
    mocks.profileName = "";
    const payload = await getManagerConsoleAction();
    expect(payload.dashboard.handle).toBe("");
  });

  // POO-781 @rule R1/R3 (site 2): the manager-profile read and the batch (positions, strategies,
  // AUM series, financials) must run concurrently — the profile no longer serializes ahead of the batch.
  // We GATE the profile read (block it until released): if the code still did `await profile` before the
  // batch, none of the batch legs would enter while the gate holds, and the assertions below fail.
  // POO-991: the legacy `summary` leg is gone; `financials` (fetchManagerFinancials, real mode) is the
  // leg that replaced it in the batch.
  it("[POO-781 R3] starts the read batch without awaiting the manager profile first", async () => {
    mocks.strategies = [{ id: "0xa", name: "A", tvl: 1000, investors: 1, estReturn: 3 }];
    mocks.positions = [{ strategyId: "0xa", isPoolManager: true, totalYield: 0 }];
    const gate = deferred();
    mocks.gateProfile = gate;

    const pending = getManagerConsoleAction();
    // Drain the microtask queue (a macrotask flush) so every NON-gated leg reaches its entry log while
    // the profile stays blocked on the gate. A fixed count of `Promise.resolve()` ticks is fragile —
    // the action has several intermediate awaits (getLocale, getAuthHeader) before the batch — so we
    // yield a full turn instead.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The profile leg is in flight (entered, blocked on the gate) AND all four batch legs have entered,
    // proving the batch was initiated without awaiting the profile.
    expect(mocks.callLog).toContain("profile");
    for (const leg of ["positions", "strategies", "aum", "financials"]) {
      expect(mocks.callLog).toContain(leg);
    }

    // Release the gate; the action completes with correct output.
    gate.release();
    const payload = await pending;
    expect(payload.strategies.map((s) => s.id)).toEqual(["0xa"]);
    expect(payload.profile.address).toBe(DEV_MANAGER_ADDRESS);
  });

  // --- POO-779 R4: the console LIST now comes from the managerWallet-scoped read -------------------

  // @rule R4: the list is the scoped read, independent of whether the manager still holds a position.
  // A manager who fully exited a strategy (no isPoolManager position) still sees it, sourced from the
  // scoped read — the old position-gated path would have dropped it.
  it("[R4] lists a scoped-read strategy the manager no longer holds a position for", async () => {
    mocks.managedScoped = [{ id: "0xkept", name: "Kept", tvl: 1000, investors: 2, estReturn: 5 }];
    mocks.positions = []; // fully exited: no managed position at all
    const payload = await getManagerConsoleAction();
    expect(payload.strategies.map((s) => s.id)).toEqual(["0xkept"]);
  });

  // @rule R4 (Q2, parity): a managed pool that VANISHED from the indexer (absent from the scoped read)
  // is recovered from the wallet's already-fetched position fallback and still listed (POO-455/537).
  it("[R4] still lists a vanished-but-held managed pool via the position fallback", async () => {
    mocks.managedScoped = [{ id: "0xlive", name: "Live", tvl: 500, investors: 1, estReturn: 3 }];
    mocks.positions = [
      {
        strategyId: "0xgone",
        isPoolManager: true,
        totalYield: 0,
        fallbackStrategy: {
          id: "0xgone",
          name: "Vanished",
          manager: "0xm",
          riskLevel: 3,
          minInvestment: 0,
          tvl: 2000,
          investors: 1,
          estReturn: 4,
          rateType: "APR",
          status: "closed",
        },
      },
    ];
    const payload = await getManagerConsoleAction();
    expect(payload.strategies.map((s) => s.id).sort()).toEqual(["0xgone", "0xlive"]);
  });

  // @rule R4 (Q3): yieldGenerated is left-joined from the held positions by strategy id; a listed
  // strategy with no held position contributes 0 (never drops the row).
  it("[R4] left-joins claimable yield from positions; a position-less row contributes 0", async () => {
    mocks.managedScoped = [
      { id: "0xa", name: "A", tvl: 1000, investors: 1, estReturn: 5 },
      { id: "0xb", name: "B", tvl: 1000, investors: 1, estReturn: 5 },
    ];
    mocks.positions = [{ strategyId: "0xa", isPoolManager: true, totalYield: 42 }];
    const payload = await getManagerConsoleAction();
    expect(payload.strategies.map((s) => s.id).sort()).toEqual(["0xa", "0xb"]);
    expect(payload.dashboard.yieldGenerated).toBe(42); // only 0xa's position; 0xb → 0
  });

  // @rule R4 (Q4): on a scoped-read error (managedScoped === null) the console falls back to the legacy
  // position-derived compose from the holdings catalog (`listStrategiesForHoldings` = mocks.strategies),
  // so the baseline list is preserved rather than blanking.
  it("[R4/Q4] falls back to the legacy position-derived compose when the scoped read errors", async () => {
    mocks.managedScoped = null; // scoped read errored
    mocks.strategies = [{ id: "0xleg", name: "Legacy", tvl: 700, investors: 2, estReturn: 6 }];
    mocks.positions = [{ strategyId: "0xleg", isPoolManager: true, totalYield: 10 }];
    const payload = await getManagerConsoleAction();
    expect(payload.strategies.map((s) => s.id)).toEqual(["0xleg"]);
    expect(payload.dashboard.yieldGenerated).toBe(10);
  });

  // @rule R4 (Q4): the legacy fallback stays ownership-scoped — a non-manager holding in the catalog is
  // never promoted into the console list (preserves the deep-link authorization gate).
  it("[R4/Q4] the error fallback never promotes a non-manager holding into the list", async () => {
    mocks.managedScoped = null;
    mocks.strategies = [
      { id: "0xmine", name: "Mine", tvl: 700, investors: 2, estReturn: 6 },
      { id: "0xtheirs", name: "Theirs", tvl: 900, investors: 3, estReturn: 8 },
    ];
    mocks.positions = [
      { strategyId: "0xmine", isPoolManager: true, totalYield: 0 },
      { strategyId: "0xtheirs", isPoolManager: false, totalYield: 0 },
    ];
    const payload = await getManagerConsoleAction();
    expect(payload.strategies.map((s) => s.id)).toEqual(["0xmine"]);
  });

  // @rule R4: a first-run manager with an empty scoped read and no managed positions gets an empty list.
  it("[R4] empty scoped read + no managed positions → empty console list", async () => {
    mocks.managedScoped = [];
    mocks.positions = [];
    const payload = await getManagerConsoleAction();
    expect(payload.strategies).toEqual([]);
    expect(payload.dashboard.aum).toBe(0);
  });

  // @rule R5 (B1): in MOCK MODE `listManagedStrategies` returns the FULL mock catalog (unscoped, no
  // managerWallet filter), so `scopedManaged` is non-null but is NOT ownership-scoped. The console must
  // NOT list every fixture; it must gate the catalog to the manager's own `isPoolManager` position via
  // `composeManagedFromPositions`. Here the catalog carries five strategies but the wallet manages only
  // `strat-delta-neutral`, so the list is that ONE row and the AUM/investor tiles sum only it, not all
  // five. (Without the mock-mode routing the action would take `resolveManagedStrategies`, listing all
  // five and inflating the tiles.)
  it("[R5] mock mode lists only the manager-held strategy, not the whole catalog", async () => {
    mocks.isMockMode = true;
    // The full mock catalog (the mock `listManagedStrategies` returns everything; five fixtures here).
    mocks.managedScoped = [
      { id: "strat-delta-neutral", name: "Delta Neutral", tvl: 1000, investors: 3, estReturn: 9 },
      { id: "strat-eth-usdc", name: "ETH/USDC", tvl: 2000, investors: 5, estReturn: 6 },
      { id: "strat-btc-yield", name: "BTC Yield", tvl: 3000, investors: 7, estReturn: 4 },
      { id: "strat-stable-farm", name: "Stable Farm", tvl: 4000, investors: 11, estReturn: 3 },
      { id: "strat-wide-range", name: "Wide Range", tvl: 5000, investors: 13, estReturn: 8 },
    ];
    // The mock manager only manages one of them (the sole `isPoolManager` position, POO-779 R5).
    mocks.positions = [{ strategyId: "strat-delta-neutral", isPoolManager: true, totalYield: 25 }];

    const payload = await getManagerConsoleAction();

    // The list is the single held strategy, never the whole catalog.
    expect(payload.strategies.map((s) => s.id)).toEqual(["strat-delta-neutral"]);
    // The KPI tiles reflect that single strategy's sums, NOT all five (which would be aum 15000 /
    // investors 39). Driven off the one gated row: aum 1000, active investors 3.
    expect(payload.dashboard.aum).toBe(1000);
    expect(payload.dashboard.totalInvestors).toBe(3);
    // Sanity: the claimable-yield left-join still comes from the held position.
    expect(payload.dashboard.yieldGenerated).toBe(25);
  });
});

const descriptor = {
  name: "ETH/USDC",
  manager: "0xmanager",
  tvl: 0,
  investors: 1,
  estReturn: 5,
  rateType: "APR",
  status: "closed",
  network: "arbitrum",
  poolPair: { token0: "WETH", token1: "USDC" },
};
const heldClosed = {
  strategyId: "0xclosed",
  decimals0: 18,
  decimals1: 6,
  tickCurrent: 1,
  currentValue: 0,
  uncollectedFeesUsd: 0,
  totalYield: 0,
  fallbackStrategy: descriptor,
};

describe("getManagerStrategyDetailAction", () => {
  beforeEach(() => {
    mocks.wallet = "0xWALLET";
  });

  it("live path: catalog hit + pool detail → maps the live pool (active)", async () => {
    mocks.strategies = [{ id: "0xopen", pool: "0xpoolAddr", network: "arbitrum" }];
    mocks.pool = {
      positionId: "0xopen",
      name: "Live Pool",
      poolManager: "0xm",
      poolTvlUsd: 1000,
      feesApr: 8,
      totalInvestors: "2",
      closed: false,
      currency0: { symbol: "WETH", decimals: 18 },
      currency1: { symbol: "USDC", decimals: 6 },
      network: "arbitrum",
      pool: "0xpoolAddr",
    };
    mocks.positions = [{ strategyId: "0xopen" }];

    const out = await getManagerStrategyDetailAction("0xopen");
    expect(out).toMatchObject({ id: "0xopen", name: "Live Pool", status: "active" });
  });

  // @rule R1 (POO-820): the loader threads the v2 catalog strategy's estReturn (Revert feesApr) into
  // mapManagerStrategyDetail so "Net APR" reads the v2 value, NOT the v1 on-chain pool.feesApr. This
  // is loader-level (wiring) coverage: the mapper test passes the override positionally and so cannot
  // catch a dropped `strategy.estReturn` argument at actions.ts. estReturn (55.9) and pool.feesApr (8)
  // are DIFFERENT so the assertion pins which source flowed through — dropping the thread returns 8.
  it("[POO-820 R1] live path threads the v2 catalog estReturn into Net APR (not v1 pool.feesApr)", async () => {
    mocks.strategies = [{ id: "0xopen", pool: "0xpoolAddr", network: "arbitrum", estReturn: 55.9 }];
    mocks.pool = {
      positionId: "0xopen",
      name: "Live Pool",
      poolManager: "0xm",
      poolTvlUsd: 1000,
      feesApr: 8, // v1 on-chain read — must NOT win over the threaded v2 estReturn
      totalInvestors: "2",
      closed: false,
      currency0: { symbol: "WETH", decimals: 18 },
      currency1: { symbol: "USDC", decimals: 6 },
      network: "arbitrum",
      pool: "0xpoolAddr",
    };
    mocks.positions = [{ strategyId: "0xopen" }];

    const out = await getManagerStrategyDetailAction("0xopen");
    // @rule R1 (POO-820): the threaded v2 estReturn wins over the v1 pool.feesApr.
    expect(out?.apy).toBe(55.9);
  });

  // @rule R1 (POO-820): fallback direction — a live catalog strategy WITHOUT estReturn leaves the
  // apy on the pool's own v1 feesApr (`estReturn ?? pool.feesApr`), locking the fallback at the
  // loader level (the same `?? pool.feesApr` used by the closed/synth-from-position path).
  it("[POO-820 R1] live path falls back to pool.feesApr when the catalog strategy has no estReturn", async () => {
    mocks.strategies = [{ id: "0xopen", pool: "0xpoolAddr", network: "arbitrum" }];
    mocks.pool = {
      positionId: "0xopen",
      name: "Live Pool",
      poolManager: "0xm",
      poolTvlUsd: 1000,
      feesApr: 8,
      totalInvestors: "2",
      closed: false,
      currency0: { symbol: "WETH", decimals: 18 },
      currency1: { symbol: "USDC", decimals: 6 },
      network: "arbitrum",
      pool: "0xpoolAddr",
    };
    mocks.positions = [{ strategyId: "0xopen" }];

    const out = await getManagerStrategyDetailAction("0xopen");
    // @rule R1 (POO-820): no v2 estReturn on the catalog row → the v1 pool.feesApr is the fallback.
    expect(out?.apy).toBe(8);
  });

  it("POO-537: catalog miss + held closed position → read-only closed detail (no 'not found')", async () => {
    mocks.strategies = []; // the closed strategy dropped out of /pools
    mocks.positions = [heldClosed];

    const out = await getManagerStrategyDetailAction("0xclosed");
    expect(out).not.toBeNull();
    expect(out).toMatchObject({ id: "0xclosed", name: "ETH/USDC", status: "closed" });
    // Resolved via the synth fallback: the pool-detail endpoint was never called (catalog miss).
    expect(mocks.detailCalls).toBe(0);
  });

  // @rule POO-753 R1: POO-721 re-armed the live /pools read for CLOSED strategies — the v2 holdings
  // catalog now returns the closed row WITH pool+network+status="closed". But /pools does NOT serve
  // wound-down pools (POO-373), so the live read threw a non-404 and the action 500'd BEFORE the synth
  // fallback. The fix SKIPS the live read for a closed strategy → it falls straight to the read-only
  // synth, never calling the doomed endpoint.
  it("POO-753: a closed strategy present in the catalog (POO-721) skips the live read and opens read-only (no 500)", async () => {
    mocks.strategies = [
      {
        id: "0xclosed",
        name: "ETH/USDC",
        pool: "0xpoolAddr",
        network: "arbitrum",
        status: "closed",
      },
    ];
    mocks.positions = [heldClosed];
    // The wound-down /pools read would THROW a non-404 — a closed strategy must never call it.
    mocks.poolError = new Error("boom: /pools 500 for a wound-down pool");

    const out = await getManagerStrategyDetailAction("0xclosed");
    expect(out).toMatchObject({ id: "0xclosed", name: "ETH/USDC", status: "closed" });
    // The gate SKIPPED the live read entirely — the throwing endpoint was never touched.
    expect(mocks.detailCalls).toBe(0);
  });

  it("returns null for an unknown/unheld id (still not found)", async () => {
    mocks.strategies = [];
    mocks.positions = [];
    expect(await getManagerStrategyDetailAction("0xghost")).toBeNull();
  });

  it("returns null when the held position lacks a synth descriptor", async () => {
    mocks.strategies = [];
    mocks.positions = [{ strategyId: "0xclosed", fallbackStrategy: undefined }];
    expect(await getManagerStrategyDetailAction("0xclosed")).toBeNull();
  });

  it("returns null when not signed in (no wallet → no positions to synth from)", async () => {
    mocks.wallet = null;
    mocks.strategies = [];
    // Even with rows in the payload, no wallet means the action never reads positions (uses []).
    mocks.positions = [heldClosed];
    expect(await getManagerStrategyDetailAction("0xclosed")).toBeNull();
  });
});
