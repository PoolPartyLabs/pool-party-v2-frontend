/**
 * @id PP-MGR-MCK-001
 * @name manager mock data
 * @implements-rules-version v1
 *
 * Static fixtures for the Manager console: Overview (PP-MGR-SCR-001), the Manage-strategies list
 * (PP-MGR-SCR-003) and the per-strategy manage detail (PP-MGR-SCR-004). Figures mirror the Figma
 * reference (the dev-login manager: AUM $392,480 across 3 active strategies); the list adds one paused, one closed
 * and one draft strategy for state diversity (POO-180 R7). Typed against the domain schemas so the
 * UI has a stable shape to build against. Replace with the OAMS manager backend before production.
 *
 * PP-NOTE: the dashboard hero (AUM 392,480 / active investors 1,284) reconciles to the three ACTIVE
 * strategies, matching the Figma sample; the paused/closed residuals are deliberately excluded from
 * the hero figures to keep that reference intact.
 *
 * POO-502 (POO-483 v2 R2): the three active-strategy details gain a PP-MOCK per-token claimable
 * block + a raw reserve block (`totalSupply0/1` + `tickCurrent`) sized so the pool value reconciles
 * to the strategy AUM, so the manager Remove/Close per-token liquidity + fee-USD rows run in mock
 * mode on the SAME `positionTokenSplit` path as real.
 */
import type {
  FeePolicy,
  ManagePeriod,
  ManagerActivityEvent,
  ManagerAllocation,
  ManagerComment,
  ManagerDashboard,
  ManagerPosition,
  ManagerProfile,
  ManagerStrategy,
  ManagerStrategyDetail,
} from "@/lib/schemas";
import { maskAddress } from "@/lib/utils/address";

/**
 * PP-MOCK (POO-659): the dev-login manager's wallet address — the SAME session wallet that
 * `authService.loginWithGoogle` resolves (src/lib/services/index.ts). It is the manager's stable
 * identity: the profile is keyed by it, the public profile is reachable at `/m/<address>`, and its
 * masked form (`maskAddress`) stands in for the (empty) display name until the manager fills it in.
 * PP-INTEGRATION-POINT: the real manager identity is the authenticated wallet address.
 */
export const DEV_MANAGER_ADDRESS = "0x1A2b3C4d5E6f7890a1B2c3D4e5F6789012345678";

/** PP-MOCK: the dev-login manager's strategies. Active AUM sums to 392,480; active investors sum to 1,284. */
export const managerStrategies: ManagerStrategy[] = [
  {
    id: "stable-yield",
    name: "Stable Yield",
    description:
      "Conservative stablecoin yield across blue-chip lending markets, rebalanced for the best risk-adjusted rate. No lock-up.",
    initials: "SY",
    // PP-MOCK: a manager-uploaded logo so the card image branch is exercised (others fall to initials).
    logoUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    riskLevel: 2,
    category: "Stablecoin yield",
    aum: 210_400,
    investors: 642,
    flows30d: 4100,
    apy: 8.2,
    fees30d: 1840,
    spark: [188_200, 192_600, 195_100, 199_800, 203_400, 205_900, 208_700, 210_400],
    inRange: true,
    status: "active",
  },
  {
    id: "yield-plus",
    name: "Yield Plus",
    description:
      "A balanced mix of stablecoin yield and blue-chip LP, aiming for steady growth with moderate volatility.",
    initials: "YP",
    // PP-MOCK: a manager-uploaded logo so the card image branch is exercised.
    logoUrl: "https://assets.coingecko.com/coins/images/2518/large/weth.png",
    riskLevel: 3,
    category: "Balanced · Multi-strategy",
    aum: 128_600,
    investors: 431,
    flows30d: 2800,
    apy: 11.4,
    fees30d: 1120,
    spark: [112_300, 115_800, 117_200, 121_500, 119_900, 124_300, 126_800, 128_600],
    inRange: true,
    status: "active",
  },
  {
    id: "momentum",
    name: "Momentum",
    description:
      "Active, directional rotations across trending majors. Higher upside in exchange for larger drawdowns.",
    initials: "MO",
    riskLevel: 4,
    category: "Aggressive · Directional",
    aum: 53_480,
    investors: 211,
    flows30d: 1300,
    apy: 18.6,
    fees30d: 760,
    // Out of range → not earning fees; the list flags it "Rebalance suggested" (POO-180 R5).
    spark: [49_100, 51_400, 53_900, 55_200, 54_100, 52_700, 53_100, 53_480],
    inRange: false,
    status: "active",
  },
  {
    id: "eth-range",
    name: "ETH Range",
    description:
      "Concentrated ETH/USDC market-making that earns trading fees while the price stays in range.",
    initials: "ER",
    riskLevel: 3,
    category: "Balanced · LP market-making",
    aum: 14_200,
    investors: 38,
    flows30d: -1200,
    apy: 6.1,
    fees30d: 84,
    spark: [16_900, 16_400, 15_800, 15_500, 15_100, 14_800, 14_400, 14_200],
    inRange: true,
    status: "paused",
  },
  {
    id: "btc-weekender",
    name: "BTC Weekender",
    description:
      "Tactical BTC directional exposure run over weekly windows. High risk, high variance.",
    initials: "BW",
    riskLevel: 5,
    category: "Very aggressive · Directional",
    aum: 6850,
    investors: 12,
    flows30d: -9400,
    apy: 0,
    fees30d: 0,
    spark: [21_400, 19_800, 17_300, 14_600, 11_900, 9400, 7800, 6850],
    inRange: true,
    status: "closed",
  },
  {
    id: "stable-plus",
    name: "Stable Plus",
    description: "Capital-preservation stablecoin yield for idle cash, with no lock-up.",
    initials: "SP",
    riskLevel: 1,
    category: "Stablecoin yield",
    aum: 0,
    investors: 0,
    flows30d: 0,
    apy: 5.8,
    fees30d: 0,
    // POO-559 R2: a not-yet-funded draft has no measured 30d value trend, so the flat 2-point spark is
    // flagged not-measured and the card hides the sparkline (never a flat line read as zero movement).
    spark: [0, 0],
    sparkMeasured: false,
    inRange: true,
    status: "draft",
  },
];

/** PP-MOCK: the dev-login manager's dashboard overview (hero reconciles to the active strategies). */
export const managerDashboard: ManagerDashboard = {
  // POO-659: the unfilled, address-based identity. Name + handle are empty (the greeting/profile fall
  // back to the masked `address`); `address` is the manager's stable id the console reads by.
  name: "",
  address: DEV_MANAGER_ADDRESS,
  aum: 392_480,
  aumChangePct: 4.2,
  netInflows30d: 8200,
  yieldGenerated: 48_200,
  // PP-MOCK (POO-743): current/active investors (on-chain open positions) → the "Active investors"
  // tile. Realistically BELOW the all-time total: some investors have fully exited (churn), which is
  // exactly the monotonic-all-time vs decrements-on-withdrawal split this fix models.
  totalInvestors: 1980,
  // PP-MOCK (POO-743, rules-v2): all-time distinct investors (monotonic) → the "Total investors" tile.
  // >= the current/active count. `activeWoWPct` stays a number so the honest-mock R2 delta renders.
  totalInvestorsAllTime: 2140,
  activeWoWPct: 4.2,
  referrals: 12,
  // PP-MOCK: lifetime fee earnings; breakdown sums to the total (performance-heavy, V1 fee mix).
  earnings: { totalUsd: 10_210.45, performanceUsd: 8_420.1, entryUsd: 1_150.25, exitUsd: 640.1 },
  avgApy: 8.4,
  handle: "",
  chart: [
    { value: 318_000, label: "30d ago" },
    { value: 332_000, label: "25d" },
    { value: 345_000, label: "20d" },
    { value: 352_000, label: "15d" },
    { value: 368_000, label: "10d" },
    { value: 380_000, label: "5d" },
    { value: 392_480, label: "Today", display: "$392,480" },
  ],
};

/** Fractions of the final AUM used to shape each deterministic performance series. */
const PERF_SHAPES: Record<ManagePeriod, number[]> = {
  "7d": [0.988, 0.991, 0.99, 0.994, 0.996, 0.998, 1],
  "30d": [0.9, 0.918, 0.936, 0.95, 0.968, 0.984, 1],
  "90d": [0.78, 0.82, 0.86, 0.9, 0.94, 0.97, 1],
  all: [0.4, 0.52, 0.66, 0.78, 0.88, 0.95, 1],
};

/** Labels for each performance series, oldest → newest (last label is always "Today"). */
const PERF_LABELS: Record<ManagePeriod, string[]> = {
  "7d": ["7d ago", "6d", "5d", "4d", "3d", "2d", "Today"],
  "30d": ["30d ago", "25d", "20d", "15d", "10d", "5d", "Today"],
  "90d": ["90d ago", "75d", "60d", "45d", "30d", "15d", "Today"],
  all: ["Launch", "", "", "", "", "", "Today"],
};

/**
 * Builds the per-period AUM series for a strategy from its current AUM (deterministic). Mock mode
 * always carries a full series (POO-558: only the REAL path may leave `performance` undefined).
 */
function perfFrom(aum: number): NonNullable<ManagerStrategyDetail["performance"]> {
  const build = (period: ManagePeriod) =>
    PERF_SHAPES[period].map((fraction, index) => ({
      value: Math.round(aum * fraction),
      label: PERF_LABELS[period][index] ?? "",
    }));
  return { "7d": build("7d"), "30d": build("30d"), "90d": build("90d"), all: build("all") };
}

/** PP-MOCK: recent manager-side activity per strategy (newest first; epoch-ms timestamps). */
const activityByStrategy: Record<string, ManagerActivityEvent[]> = {
  "stable-yield": [
    {
      id: "sy-1",
      type: "deposit",
      tokenAmount: 2500,
      tokenSymbol: "USDC",
      usdValueAtTime: 2500,
      timestamp: 1_780_310_000_000,
    },
    { id: "sy-2", type: "collect", usdValueAtTime: 412.8, timestamp: 1_780_120_000_000 },
    {
      id: "sy-3",
      type: "deposit",
      tokenAmount: 980,
      tokenSymbol: "USDC",
      usdValueAtTime: 980,
      timestamp: 1_779_950_000_000,
    },
    { id: "sy-4", type: "compound", usdValueAtTime: 268.4, timestamp: 1_779_600_000_000 },
  ],
  "yield-plus": [
    {
      id: "yp-1",
      type: "deposit",
      tokenAmount: 1200,
      tokenSymbol: "USDC",
      usdValueAtTime: 1200,
      timestamp: 1_780_290_000_000,
    },
    {
      id: "yp-2",
      type: "withdraw",
      tokenAmount: 640,
      tokenSymbol: "USDC",
      usdValueAtTime: 640,
      timestamp: 1_780_080_000_000,
    },
    { id: "yp-3", type: "collect", usdValueAtTime: 388.2, timestamp: 1_779_840_000_000 },
    { id: "yp-4", type: "move_range", usdValueAtTime: 0, timestamp: 1_779_500_000_000 },
  ],
  momentum: [
    {
      id: "mo-1",
      type: "withdraw",
      tokenAmount: 1500,
      tokenSymbol: "USDC",
      usdValueAtTime: 1500,
      timestamp: 1_780_260_000_000,
    },
    {
      id: "mo-2",
      type: "deposit",
      tokenAmount: 2200,
      tokenSymbol: "USDC",
      usdValueAtTime: 2200,
      timestamp: 1_780_010_000_000,
    },
    { id: "mo-3", type: "collect", usdValueAtTime: 240.1, timestamp: 1_779_700_000_000 },
  ],
  "eth-range": [
    {
      id: "er-1",
      type: "withdraw",
      tokenAmount: 1200,
      tokenSymbol: "USDC",
      usdValueAtTime: 1200,
      timestamp: 1_780_200_000_000,
    },
    { id: "er-2", type: "collect", usdValueAtTime: 61.4, timestamp: 1_779_780_000_000 },
  ],
  "btc-weekender": [
    {
      id: "bw-1",
      type: "withdraw",
      tokenAmount: 4200,
      tokenSymbol: "USDC",
      usdValueAtTime: 4200,
      timestamp: 1_780_150_000_000,
    },
    {
      id: "bw-2",
      type: "withdraw",
      tokenAmount: 5200,
      tokenSymbol: "USDC",
      usdValueAtTime: 5200,
      timestamp: 1_779_900_000_000,
    },
  ],
  "stable-plus": [],
};

/** Per-strategy detail extras keyed by id (pool, range, fee earnings, investor counts). */
const detailExtras: Record<
  string,
  Pick<
    ManagerStrategyDetail,
    | "pool"
    | "range"
    | "aumChangePct"
    | "yieldGenerated"
    | "feesAllTime"
    | "claimableFeesUsd"
    | "managerStakeUsd"
    | "gasEstimateUsd"
    | "showInExplore"
    | "investorStats"
    // POO-502 (POO-483 v2 R2): the per-token claimable fees + the raw reserve block that let the
    // manager Remove/Close render per-token liquidity + fee rows in mock mode on the SAME split path
    // as real. Optional — fixtures without a stake omit the block and degrade to USD (R4).
    | "claimableFeeTokens"
    | "totalSupply0"
    | "totalSupply1"
    | "tickCurrent"
  >
> = {
  "stable-yield": {
    pool: {
      token0: "USDC",
      token1: "DAI",
      feeBps: 1,
      networkName: "Base",
      network: "base",
      decimals0: 6,
      decimals1: 18,
    },
    range: { full: false, minPrice: 0.998, maxPrice: 1.002, currentPrice: 0.9998 },
    aumChangePct: 5.1,
    yieldGenerated: 18_400,
    feesAllTime: 9640,
    claimableFeesUsd: 312.4,
    // The manager's own stake in the pool, a small slice of the ~$210K AUM.
    managerStakeUsd: 1420.5,
    gasEstimateUsd: 0.38,
    showInExplore: true,
    investorStats: { total: 880, active: 642 },
    // PP-MOCK (POO-502 / POO-483 v2 R2): per-token claimable + the WHOLE pool position's raw reserves
    // so positionTokenSplit runs in mock on the SAME path as real. USDC(6d)/DAI(18d) at ~1:1; sized so
    // the pool value (105,200 USDC + 105,200 DAI ≈ $210,400) reconciles to this strategy's AUM (the
    // split anchor), a ~50/50 stablecoin value split.
    claimableFeeTokens: [
      { symbol: "USDC", amount: 158.9 },
      { symbol: "DAI", amount: 153.4 },
    ],
    totalSupply0: "105200000000",
    totalSupply1: "105200000000000000000000",
    tickCurrent: 276_324,
  },
  "yield-plus": {
    // Mirrors the live `managerPosition` fixture (PP-MGR-SCR-005): in range, 2850 ≤ 3120.5 ≤ 3400.
    pool: {
      token0: "ETH",
      token1: "USDC",
      feeBps: 5,
      networkName: "Base",
      network: "base",
      decimals0: 18,
      decimals1: 6,
    },
    range: { full: false, minPrice: 2850, maxPrice: 3400, currentPrice: 3120.5 },
    aumChangePct: 3.6,
    yieldGenerated: 14_900,
    feesAllTime: 6980,
    claimableFeesUsd: 842.19,
    // Manager stake, a small slice of the ~$128K AUM.
    managerStakeUsd: 980.75,
    gasEstimateUsd: 0.42,
    showInExplore: true,
    investorStats: { total: 612, active: 431 },
    // PP-MOCK (POO-502 / POO-483 v2 R2): per-token claimable + the WHOLE pool position's raw reserves.
    // ETH(18d)/USDC(6d) at ~$3,120/ETH; sized so the pool value (24.72 WETH ≈ $77,160 + 51,440 USDC ≈
    // $128,600) reconciles to this strategy's AUM, a deliberately NON-even ~60/40 value split.
    claimableFeeTokens: [
      { symbol: "ETH", amount: 0.162 },
      { symbol: "USDC", amount: 336.5 },
    ],
    totalSupply0: "24720000000000000000",
    totalSupply1: "51440000000",
    tickCurrent: -195_863,
  },
  momentum: {
    // Price fell below the band → out of range, earning no fees (drives the rebalance alert).
    pool: {
      token0: "ETH",
      token1: "USDC",
      feeBps: 30,
      networkName: "Arbitrum",
      network: "arbitrum",
      decimals0: 18,
      decimals1: 6,
    },
    range: { full: false, minPrice: 3300, maxPrice: 3900, currentPrice: 3120.5 },
    aumChangePct: -1.8,
    yieldGenerated: 6200,
    feesAllTime: 3410,
    claimableFeesUsd: 95.32,
    // Manager stake, a small slice of the ~$53K AUM.
    managerStakeUsd: 640.0,
    gasEstimateUsd: 0.12,
    showInExplore: true,
    investorStats: { total: 343, active: 211 },
    // PP-MOCK (POO-502 / POO-483 v2 R2): per-token claimable + the WHOLE pool position's raw reserves.
    // ETH(18d)/USDC(6d) at ~$3,120/ETH; out of range (below band) so USDC-heavy. Sized so the pool
    // value (6.855 WETH ≈ $21,390 + 32,088 USDC ≈ $53,480) reconciles to this AUM, a ~40/60 split.
    claimableFeeTokens: [
      { symbol: "ETH", amount: 0.011 },
      { symbol: "USDC", amount: 60.9 },
    ],
    totalSupply0: "6855000000000000000",
    totalSupply1: "32088000000",
    tickCurrent: -195_863,
  },
  "eth-range": {
    pool: { token0: "ETH", token1: "USDC", feeBps: 5, networkName: "Ethereum" },
    range: { full: false, minPrice: 2600, maxPrice: 3600, currentPrice: 3120.5 },
    aumChangePct: -7.9,
    yieldGenerated: 940,
    feesAllTime: 1180,
    claimableFeesUsd: 61.07,
    // Manager stake, a small slice of the ~$14K AUM (paused strategy).
    managerStakeUsd: 312.85,
    gasEstimateUsd: 3.4,
    showInExplore: false,
    investorStats: { total: 64, active: 38 },
  },
  "btc-weekender": {
    pool: { token0: "WBTC", token1: "USDC", feeBps: 30, networkName: "Arbitrum" },
    range: { full: true, minPrice: null, maxPrice: null, currentPrice: 67_240 },
    aumChangePct: -42.4,
    yieldGenerated: 1870,
    feesAllTime: 2240,
    claimableFeesUsd: 0,
    // Closed strategy: the manager withdrew their stake (see the two withdraw activity entries).
    managerStakeUsd: 0,
    gasEstimateUsd: 0.12,
    showInExplore: false,
    investorStats: { total: 96, active: 12 },
  },
  "stable-plus": {
    pool: { token0: "USDC", token1: "USDT", feeBps: 1, networkName: "Base" },
    range: { full: false, minPrice: 0.999, maxPrice: 1.001, currentPrice: 1.0001 },
    aumChangePct: 0,
    yieldGenerated: 0,
    feesAllTime: 0,
    claimableFeesUsd: 0,
    // Draft strategy, not yet seeded: no AUM, no manager stake.
    managerStakeUsd: 0,
    gasEstimateUsd: 0.38,
    showInExplore: false,
    investorStats: { total: 0, active: 0 },
  },
};

/**
 * PP-MOCK: deployed-capital allocation per strategy (manage-detail Allocation card, POO-563 rules v1).
 * A strategy IS one Uniswap v3 position today, so every allocation is a single 100% Uniswap v3
 * protocol row + the position's two-token value split (percentages sum to 100). These mirror the
 * REAL client-side shape (see {@link buildManagerAllocation}); the earlier multi-protocol splits
 * (Aave/Morpho/Lido/Hyperliquid) were impossible in-product and were removed. The token pairs match
 * each strategy's mock pool (`detailExtras`): stable-yield USDC/DAI, yield-plus & momentum & eth-range
 * ETH/USDC — momentum is single-sided (out of range) so it renders 100/0 (R2). PP-INTEGRATION-POINT
 * (POO-380): the future MULTI-protocol version derives multiple rows from the indexer + mandate.
 */
const allocationByStrategy: Record<string, ManagerAllocation> = {
  "stable-yield": {
    protocols: [{ label: "Uniswap v3", pct: 100 }],
    tokens: [
      { label: "USDC", pct: 51 },
      { label: "DAI", pct: 49 },
    ],
  },
  "yield-plus": {
    protocols: [{ label: "Uniswap v3", pct: 100 }],
    tokens: [
      { label: "ETH", pct: 58 },
      { label: "USDC", pct: 42 },
    ],
  },
  momentum: {
    // Out of range (`inRange: false`) → the position sits entirely on one side: 100/0 (R2).
    protocols: [{ label: "Uniswap v3", pct: 100 }],
    tokens: [
      { label: "ETH", pct: 100 },
      { label: "USDC", pct: 0 },
    ],
  },
  "eth-range": {
    protocols: [{ label: "Uniswap v3", pct: 100 }],
    tokens: [
      { label: "ETH", pct: 52 },
      { label: "USDC", pct: 48 },
    ],
  },
};

/**
 * PP-MOCK: investor comment threads per strategy (manage-detail Comments card, POO-277 — read-only
 * preview in V1). 1 thread = 1 investor, private. PP-INTEGRATION-POINT: the OAMS comments service.
 */
const commentsByStrategy: Record<string, ManagerComment[]> = {
  "stable-yield": [
    {
      id: "sy-c1",
      author: "Maria L.",
      investedUsd: 3920,
      text: "Why did the strategy move out of range yesterday? Is my money safe?",
      timestamp: 1_780_300_000_000,
      unread: true,
    },
    {
      id: "sy-c2",
      author: "João P.",
      investedUsd: 200,
      text: "Is the 8.2% APR net of your fees, or do I still pay on top?",
      timestamp: 1_780_210_000_000,
      reply: {
        // POO-659: the manager reply is authored by the unfilled dev manager → the masked address
        // stands in for the (empty) display name, same as everywhere the manager identity renders.
        author: maskAddress(DEV_MANAGER_ADDRESS),
        text: "Yes, the APR you see is already net of all fees.",
        timestamp: 1_780_215_000_000,
      },
    },
    {
      id: "sy-c3",
      author: "Ana R.",
      text: "Can I increase my position from the app?",
      timestamp: 1_780_050_000_000,
    },
  ],
  "yield-plus": [
    {
      id: "yp-c1",
      author: "Diego S.",
      investedUsd: 1500,
      text: "How often do you rebalance this one?",
      timestamp: 1_780_280_000_000,
      unread: true,
    },
  ],
};

/** PP-MOCK: total comment counts (the preview shows a slice; "View all" uses this). */
const commentsTotalByStrategy: Record<string, number> = {
  "stable-yield": 12,
  "yield-plus": 4,
};

/**
 * PP-MOCK: the manage-detail payload per strategy (PP-MGR-SCR-004), derived from the list rows +
 * the per-id extras above. PP-INTEGRATION-POINT: read from the indexer + manager contracts (range,
 * uncollected fees) joined with the OAMS backend (fee accounting, investor counts, activity).
 */
/**
 * PP-MOCK (POO-649): maps each managed strategy to a resolvable investor-catalog id, so the console
 * share pill deep-links a public strategy page (`/strategies/<id>`) that actually resolves. Points at
 * NON-closed catalog strategies (`strategies.ts`) so `getStrategyById` never misses in mock mode.
 * PP-INTEGRATION-POINT: the real backend supplies the true console→catalog mapping.
 */
const PUBLIC_STRATEGY_ID_BY_ID: Record<string, string> = {
  "stable-yield": "strat-treasury-plus",
  // POO-659: strat-balanced-growth / strat-high-conviction were removed with the dev-manager persona, so
  // these repoint to remaining NON-closed catalog strategies (the pill only needs a resolvable page).
  "yield-plus": "strat-delta-neutral",
  momentum: "strat-degen-rotations",
  "eth-range": "strat-delta-neutral",
  "btc-weekender": "strat-degen-rotations",
  "stable-plus": "strat-treasury-plus",
};

export const managerStrategyDetails: ManagerStrategyDetail[] = managerStrategies.map((strategy) => {
  const extras = detailExtras[strategy.id];
  if (!extras) throw new Error(`manager mock: missing detail extras for "${strategy.id}"`);
  const publicStrategyId = PUBLIC_STRATEGY_ID_BY_ID[strategy.id];
  if (!publicStrategyId)
    throw new Error(`manager mock: missing publicStrategyId for "${strategy.id}"`);
  const comments = commentsByStrategy[strategy.id];
  return {
    ...strategy,
    ...extras,
    publicStrategyId,
    performance: perfFrom(strategy.aum),
    activity: activityByStrategy[strategy.id] ?? [],
    allocation: allocationByStrategy[strategy.id],
    comments,
    commentsTotal: commentsTotalByStrategy[strategy.id] ?? comments?.length,
  };
});

/**
 * PP-MOCK: Pool Party's platform cut, tiered by the manager's AUM (it lowers as AUM grows, toward
 * 0% for the largest managers). The dev manager's ~$392K AUM puts it in the entry tier. Shown read-only on
 * the builder's Review step. PP-INTEGRATION-POINT: source from the backend fee schedule.
 */
export const managerFeePolicy: FeePolicy = {
  platformCutPct: 30,
  tierLabel: "Under $1M AUM",
};

/**
 * PP-MOCK: public manager profiles, keyed by handle (→ /m/<handle>). Stats are headline figures
 * shown on the profile; the manager's strategies are looked up separately from the strategies mock
 * by `managerHandle`. PP-INTEGRATION-POINT: the OAMS manager registry.
 */
export const managerProfiles: ManagerProfile[] = [
  {
    // POO-659: the dev-login manager is an UNFILLED, ADDRESS-BASED identity. `address` is the stable
    // id (the profile is keyed by it; the public profile is reachable at `/m/<address>`); name / handle
    // / bio / socials are empty so the UI falls back to the masked address (POO-618). Nothing here is
    // persona data — a real new manager looks exactly like this until they fill their profile in.
    address: DEV_MANAGER_ADDRESS,
    handle: "",
    // PP-MOCK (POO-575 R7): starts UNLOCKED so the editable-handle claim state is reachable in mock
    // mode. The mock `updateProfile` flips this to `true` on the first save. The real handle lifecycle
    // (create + uniqueness + lock) is PP-INTEGRATION-POINT → POO-576.
    handleLocked: false,
    name: "",
    bio: "",
    // POO-593 / POO-659: the console loads this manager, so its state is what the Profile tab renders.
    // UNVERIFIED (`managerVerification: "none"`) with NO socials and NO pending
    // `ManagerVerificationRequest` (see src/mocks/data/verification.ts), so the "Request verification"
    // control starts DISABLED (the gate needs an X or Instagram link, POO-593) — the correct new-manager
    // state. Filling a social live demos the control enabling. The other managers below stay `valid` so
    // the badge still demos.
    // POO-745: never-requested account verification. Drives the "Request verification" control
    // (disabled until an X link is added) and keeps the badge off — the correct new-manager state.
    managerVerification: "none",
    sinceLabel: "Since 2023",
    socials: {},
    stats: { aum: 1_840_000, investors: 540, strategies: 2, avgApy: 12.1 },
  },
  {
    handle: "aave-labs",
    // PP-MOCK (POO-575): an established manager — handle already fixed (read-only in the console).
    handleLocked: true,
    name: "Aave Labs",
    bio: "Risk-managed lending and treasury strategies from the Aave ecosystem.",
    // POO-745: `valid` drives the public verified badge (the sole source since POO-809).
    managerVerification: "valid",
    sinceLabel: "Since 2022",
    socials: {},
    stats: { aum: 3_200_000, investors: 820, strategies: 1, avgApy: 4.8 },
  },
  {
    handle: "pool-party-labs",
    handleLocked: true,
    name: "Pool Party Labs",
    bio: "The Pool Party in-house desk — diversified, actively managed strategies.",
    managerVerification: "valid",
    sinceLabel: "Since 2024",
    socials: {},
    stats: { aum: 5_100_000, investors: 1_230, strategies: 1, avgApy: 7.4 },
  },
  {
    handle: "numen-capital",
    handleLocked: true,
    name: "Numen Capital",
    bio: "Quantitative, market-neutral strategies built for steady risk-adjusted returns.",
    managerVerification: "valid",
    sinceLabel: "Since 2023",
    socials: {},
    stats: { aum: 2_600_000, investors: 410, strategies: 1, avgApy: 9.6 },
  },
  {
    handle: "apex-quant",
    handleLocked: true,
    name: "Apex Quant",
    bio: "Directional and momentum strategies for investors with a higher risk appetite.",
    managerVerification: "none",
    sinceLabel: "Since 2024",
    socials: {},
    stats: { aum: 980_000, investors: 180, strategies: 1, avgApy: 18.2 },
  },
];

/**
 * PP-MOCK: the dev manager's live Uniswap v3 position for the "yield-plus" strategy — drives the operate
 * surface (PP-MGR-SCR-005 / PP-MGR-CMP-001). In range (2850 ≤ 3120.5 ≤ 3400). Liquidity mirrors the
 * strategy's AUM. PP-INTEGRATION-POINT: read from the indexer + position-manager contract.
 */
export const managerPosition: ManagerPosition = {
  strategyId: "yield-plus",
  networkName: "Base",
  token0: "ETH",
  token1: "USDC",
  feeBps: 5,
  currentPrice: 3120.5,
  rangeMin: 2850,
  rangeMax: 3400,
  liquidityUsd: 128_600,
  uncollectedFeesUsd: 842.19,
  feeAprPct: 14.2,
  gasCostUsd: 0.42,
};
