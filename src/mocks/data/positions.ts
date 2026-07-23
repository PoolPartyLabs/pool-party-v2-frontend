/**
 * @id PP-CORE-MCK-003
 * @name position mock data
 * @implements-rules-version v1
 *
 * Static, in-memory investor portfolio for the mocks: three positions whose totals reconcile to a
 * funded portfolio (invested $3,920.00 → current value $4,532.50 → total yield +$612.50), matching
 * the Figma Home/Portfolio reference. Each `strategyId` references a strategy in {@link strategies}.
 * Validated against `positionSchema`. Replace with the indexer's wallet-scoped positions feed.
 *
 * POO-498 (POO-483 rules v2): the two owned positions gain a PP-MOCK raw reserve block
 * (`totalSupply0/1` + `tickCurrent` + `decimals0/1`) sized so the pool value reconciles to the
 * strategy's `tvl`, so `positionTokenSplit` (PP-CORE-LIB-022) runs on the SAME path in mock and real
 * mode for the Withdraw "receive as pair" per-token rows.
 */
import type { Position, PositionEarnings } from "@/lib/schemas";

/**
 * PP-MOCK: the connected investor's positions. Totals are intentionally reconciled (see tests).
 * `pos-stable-yield` is the closed-position reference (POO-185, Drafts 5369:244): its strategy was
 * closed by the manager, so the full final value sits ready to withdraw (instant, no fee) and
 * nothing is collectible. The repartition keeps the reference totals untouched.
 */
export const positions: Position[] = [
  {
    id: "pos-stable-yield",
    strategyId: "strat-stable-yield",
    invested: 1890,
    currentValue: 2038.6,
    totalYield: 148.6,
    available: 0,
    reinvestment: "manual-payout",
    status: "closed",
    // PP-MOCK (POO-226 R4): wallet's first entry into this strategy (epoch ms), earlier than the
    // activity feed. Real mode leaves this undefined until POO-641 serves it.
    openedAt: 1_772_000_000_000,
  },
  {
    id: "pos-balanced-growth",
    // POO-659: repointed from the removed strat-balanced-growth to the dev manager's re-attributed
    // strategy (strat-delta-neutral, ETH/USDC — matches this position's reserve block). Figures are
    // unchanged, so the portfolio reconciliation ($3,920 → $4,532.50) holds.
    strategyId: "strat-delta-neutral",
    invested: 1210,
    currentValue: 1500.4,
    totalYield: 290.4,
    available: 80,
    reinvestment: "manual-payout",
    status: "active",
    // PP-MOCK (POO-226 R4): wallet's first entry into this strategy (epoch ms).
    openedAt: 1_775_000_000_000,
    // PP-NOTE: one position the mock investor manages, so the "Owned" pill (vs "Invested") is
    // QA-able in mock mode (POO-353). Ideally this would follow the TEMP Dev-menu Manager-mode
    // toggle, but that toggle is client-only React state in AppShell, while mock positions are
    // read server-side (the routes SSR the mock directly via positionService.list()). A server
    // render can't see the client toggle, so this is seeded unconditionally: the mock investor IS
    // the manager persona, consistent with how `isPoolManager` derives the manager role (POO-224).
    isPoolManager: true,
    // PP-MOCK: per-token claimable so the "receive as token pair" rows are demoable in mock mode
    // (POO-417 R3). A plausible ETH/USDC split of the claimable fees — amounts only, no per-token USD.
    claimableFeeTokens: [
      { symbol: "ETH", amount: 0.0482 },
      { symbol: "USDC", amount: 145.2 },
    ],
    // PP-MOCK (POO-498 / POO-483 R3 v2): the WHOLE pool position's raw reserves so positionTokenSplit
    // runs in mock mode on the SAME path as real. token0=ETH (18d), token1=USDC (6d), tick at
    // ~$3000/ETH, giving a ~55/45 value split (not an even 50/50). The split RATIO (not the absolute
    // pool value) drives the per-token rows, so the strategy repoint above leaves the withdraw demo intact.
    totalSupply0: "160000000000000000000",
    totalSupply1: "400000000000",
    tickCurrent: -196256,
    decimals0: 18,
    decimals1: 6,
  },
  {
    id: "pos-high-conviction",
    // POO-659: repointed from the removed strat-high-conviction to a remaining active strategy
    // (strat-degen-rotations). Figures unchanged, preserving the portfolio totals.
    strategyId: "strat-degen-rotations",
    invested: 820,
    currentValue: 993.5,
    totalYield: 173.5,
    available: 50,
    reinvestment: "manual-payout",
    status: "paused",
    // PP-MOCK (POO-226 R4): wallet's first entry into this strategy (epoch ms).
    openedAt: 1_776_500_000_000,
    // PP-MOCK: WBTC/USDC per-token claimable for the pair-payout rows (POO-417 R3).
    claimableFeeTokens: [
      { symbol: "WBTC", amount: 0.00131 },
      { symbol: "USDC", amount: 88.5 },
    ],
    // PP-MOCK (POO-498 / POO-483 R3 v2): WHOLE pool position raw reserves for the reserve split.
    // token0=WBTC (8d), token1=USDC (6d), tick at ~$65,000/WBTC, giving a ~70/30 value split. The
    // split RATIO drives the per-token rows, so the strategy repoint above leaves the withdraw demo intact.
    totalSupply0: "440000000",
    totalSupply1: "124000000000",
    tickCurrent: 64773,
    decimals0: 8,
    decimals1: 6,
  },
];

/**
 * PP-MOCK: fully-exited positions — closed strategies the investor ALREADY withdrew from (zero
 * balance). Kept OUT of {@link positions} (the live portfolio) on purpose: they only surface behind
 * the Portfolio "Show closed strategies" toggle as read-only history (POO-460). In real mode this is
 * the `/portfolio/:wallet/all?closed=exited` feed.
 */
export const exitedPositions: Position[] = [
  {
    id: "pos-eth-momentum-exited",
    strategyId: "strat-eth-momentum",
    invested: 600,
    currentValue: 0,
    totalYield: 74.2,
    available: 0,
    reinvestment: "manual-payout",
    status: "closed",
    // PP-MOCK (POO-226 R4): wallet's first entry into this (now fully-exited) strategy (epoch ms).
    openedAt: 1_770_000_000_000,
  },
];

/**
 * PP-MOCK: per-period earned amounts (fees + yield) for the share-yield card, keyed by position id.
 * Scales are consistent with each position's `totalYield` (a 30d window is a slice of lifetime
 * yield, 7d a slice of that, and so on). `pos-high-conviction` runs a negative 24h window on
 * purpose so the LOSS card variant is reachable from the mocks (POO-275 R6).
 */
export const positionEarnings: Record<string, PositionEarnings> = {
  "pos-stable-yield": { "24h": 1.85, "7d": 12.4, "30d": 48.9 },
  "pos-balanced-growth": { "24h": 3.21, "7d": 21.74, "30d": 86.52 },
  "pos-high-conviction": { "24h": -4.12, "7d": 9.83, "30d": 42.31 },
};

/**
 * PP-MOCK (POO-896 rules v1): per-window FEES EARNED (collected + accrued share of uncollected,
 * investor-net USD) per live position - the mock counterpart of the analytics metrics map's
 * `feesEarned` (POO-731 endpoint), feeding Home "Earned today" (24h) / "Last 30 days" (30d).
 * [R6] fee-plausible against each position's scale (roughly a 30d slice of its yield with 24h ≤ 7d
 * ≤ 30d, since nested rolling windows of a non-negative fee stream are monotone) and NON-NEGATIVE:
 * unlike {@link positionEarnings} (net fees+value for the share card, which deliberately keeps a
 * negative 24h for the LOSS variant), fees earned can never be negative.
 */
export const positionFeesEarned: Record<string, PositionEarnings> = {
  "pos-stable-yield": { "24h": 0.82, "7d": 5.9, "30d": 24.6 },
  "pos-balanced-growth": { "24h": 1.44, "7d": 10.15, "30d": 41.8 },
  "pos-high-conviction": { "24h": 1.05, "7d": 7.32, "30d": 30.1 },
};

/**
 * PP-MOCK (POO-714 rules v1): LIFETIME collected fees (investor-net USD) per position — the mock
 * counterpart of the analytics metrics map's `collectedFees.all` (POO-731), so the mock "Total
 * Yield" / "Total earned" KPIs behave like real mode: all-time collected + currently available.
 * Keyed like the real metrics map: it also carries positions the wallet FULLY EXITED (absent from
 * the live portfolio read) — their realized yield still counts toward the lifetime figure. The
 * exited entry mirrors {@link exitedPositions}' `pos-eth-momentum-exited` realized yield (74.2).
 */
export const positionCollectedFees: Record<string, number> = {
  "pos-stable-yield": 36.4,
  "pos-balanced-growth": 118.75,
  "pos-high-conviction": 52.11,
  "pos-eth-momentum-exited": 74.2,
};
