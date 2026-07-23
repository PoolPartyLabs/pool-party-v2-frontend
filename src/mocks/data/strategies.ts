/**
 * @id PP-CORE-MCK-003
 * @name strategy mock data
 * @implements-rules-version v1 · v1 (POO-771: embedded managerVerified + managerAvatarUrl) · v1 (POO-819: top-level lockupDays) · v1 (POO-905: protocolFeePct)
 *
 * POO-771 R10: each fixture carries the top-level `managerVerified` (consistent with its
 * `detail.managerVerified`) and, on some, `managerAvatarUrl`, so mock mode exercises the EXACT fields
 * real mode renders (the badge + avatar embedded per POO-758). Diverse states: verified-with-avatar
 * (Treasury Plus), verified-without-avatar (Stable Yield), unverified-with-handle (Degen Rotations),
 * handleless wallet-only (Delta-Neutral, the dev manager), and identity-absent (ETH Momentum, closed).
 *
 * Static, in-memory catalog of managed strategies for the investor-app mocks. Spans all five risk
 * bands and both rate types, with one paused strategy so the UI can exercise the paused state. Each
 * strategy carries a full `detail` prospectus (about / composition / mandate / risk limits / fees)
 * so the strategy detail screen always renders complete. Validated against `strategySchema` (the
 * single source of truth). Replace with the OAMS strategy registry (indexer + RPC) before production.
 */
import type { Strategy } from "@/lib/schemas";
import { maskAddress } from "@/lib/utils/address";
import { DEV_MANAGER_ADDRESS } from "./manager";

/** PP-MOCK: plausible managed strategies. Ids are stable and referenced by {@link positions}. */
export const strategies: Strategy[] = [
  {
    id: "strat-treasury-plus",
    // PP-MOCK: a manager-uploaded logo so Home/discovery exercises the image branch (POO-713); the
    // fixtures without a logoUrl exercise the initials-monogram fallback.
    logoUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    type: "yield",
    name: "Treasury Plus",
    description:
      "Capital-preservation play for idle stablecoins: tokenized US T-bills and the deepest lending markets. Built for treasuries and cautious savers who want a steady, low-volatility return on cash without taking directional risk.",
    manager: "Aave Labs",
    managerHandle: "aave-labs",
    // POO-771 R10: verified manager WITH an avatar — exercises the avatar image + badge branch in
    // mock mode with the SAME field shape real mode renders (embedded via POO-758). Consistent with
    // detail.managerVerified below.
    managerAvatarUrl: "https://assets.coingecko.com/coins/images/12645/large/AAVE.png",
    managerVerified: true,
    riskLevel: 1,
    minInvestment: 50,
    tvl: 3_200_000,
    // PP-MOCK: underlying Uniswap pool TVL (reserve_in_usd) — pool-scale, distinct from and larger
    // than the PP-managed `tvl` above; this is what investors read as "TVL" (POO-390 R1/R2).
    uniswapPoolTvlUsd: 44_500_000,
    investors: 820,
    estReturn: 4.8,
    rateType: "APY",
    status: "active",
    // POO-514 R3: the pool network so mock receipts assemble a real explorer /tx/ link.
    network: "base",
    // POO-819 R5: the lock-up mirrored TOP-LEVEL (matching the real v2 mapper shape), consistent with
    // detail.lockupDays below, so mock mode exercises the EXACT field the consumers now read first.
    lockupDays: 0,
    // POO-905 R2: the protocol-wide fee rate (percent), matching the live PROTOCOL_FEE constant, so
    // the mock Invest Review exercises the exact pre-build estimate path real mode renders.
    protocolFeePct: 0.25,
    detail: {
      lockupDays: 0,
      managerVerified: true,
      managerStakeUsd: 52_000,
      about:
        "Capital-preservation strategy that parks stablecoins in tokenized US Treasury bills and the most liquid lending markets. Built for investors who want a steady, low-volatility return on idle cash.",
      receiveTokens: ["USDC", "USDT"],
      composition: [
        { label: "US Treasury Bills", weight: 60 },
        { label: "Money market funds", weight: 30 },
        { label: "Stablecoin lending", weight: 10 },
      ],
      mandate: {
        assets: [
          { label: "USDC", maxPct: 70 },
          { label: "USDT", maxPct: 40 },
          { label: "US T-Bills", maxPct: 70 },
        ],
        protocols: [
          { label: "Ondo", maxPct: 60 },
          { label: "Aave v3", maxPct: 40 },
        ],
        networks: ["Ethereum"],
      },
      riskLimits: {
        maxDrawdown: [
          { period: "30D", pct: -0.5 },
          { period: "90D", pct: -1 },
          { period: "1Y", pct: -2 },
          { period: "Max", pct: -2.5 },
        ],
        leverage: "None",
        rebalancing: "Weekly",
        liquidity: "Instant",
        strategyType: "Fixed income",
        benchmark: "US 3M T-Bill",
        custody: "Non-custodial (OAMS vault)",
      },
      fees: { managementPct: 0.5, performancePct: 0 },
    },
  },
  {
    id: "strat-stable-yield",
    type: "yield",
    name: "Stable Yield",
    manager: "Pool Party Labs",
    managerHandle: "pool-party-labs",
    // POO-771 R10: verified manager WITHOUT an avatar — exercises the monogram fallback + badge branch
    // (POO-702 leaves many registry avatars null). Consistent with detail.managerVerified below.
    managerVerified: true,
    riskLevel: 2,
    minInvestment: 100,
    tvl: 1_250_000,
    uniswapPoolTvlUsd: 12_800_000,
    investors: 312,
    estReturn: 7.4,
    rateType: "APY",
    // PP-MOCK: the closed-strategy reference (POO-185) — the manager ended it; holders only withdraw.
    status: "closed",
    // POO-514 R3: the pool network so mock receipts assemble a real explorer /tx/ link.
    network: "base",
    // POO-819 R5: lock-up mirrored top-level (consistent with detail.lockupDays), matching real shape.
    lockupDays: 0,
    // POO-905 R2: the protocol-wide fee rate (percent), matching the live PROTOCOL_FEE constant.
    protocolFeePct: 0.25,
    detail: {
      lockupDays: 0,
      managerVerified: true,
      managerStakeUsd: 18_500,
      about:
        "Diversified stablecoin yield across blue-chip lending markets, rebalanced to capture the best risk-adjusted rates. A dependable core holding with no lock-up.",
      receiveTokens: ["USDC", "USDT", "DAI"],
      composition: [
        { label: "US Treasury Bills", weight: 55 },
        { label: "Money market funds", weight: 30 },
        { label: "Stablecoin lending", weight: 15 },
      ],
      mandate: {
        assets: [
          { label: "USDC", maxPct: 60 },
          { label: "USDT", maxPct: 40 },
          { label: "DAI", maxPct: 40 },
          { label: "sDAI", maxPct: 50 },
        ],
        protocols: [
          { label: "Aave v3", maxPct: 40 },
          { label: "Morpho", maxPct: 30 },
          { label: "Sky", maxPct: 30 },
        ],
        networks: ["Ethereum", "Base"],
      },
      riskLimits: {
        maxDrawdown: [
          { period: "30D", pct: -1 },
          { period: "90D", pct: -2 },
          { period: "1Y", pct: -3 },
          { period: "Max", pct: -3.5 },
        ],
        leverage: "None",
        rebalancing: "Daily",
        liquidity: "Instant",
        strategyType: "Stablecoin yield",
        benchmark: "Aave USDC supply APY",
        custody: "Non-custodial (OAMS vault)",
      },
      fees: { managementPct: 1, performancePct: 10 },
    },
  },
  {
    id: "strat-delta-neutral",
    // PP-MOCK: a manager-uploaded logo so Home/discovery exercises the image branch (POO-713).
    logoUrl: "https://assets.coingecko.com/coins/images/2518/large/weth.png",
    type: "market-neutral",
    name: "Delta-Neutral Farming",
    description:
      "Market-neutral farming that hedges price exposure while harvesting funding and LP fees. Aims for a steady return that holds up whether the market rises or falls.",
    // POO-659: re-attributed to the dev-login manager (was Carlos, whose strat-balanced-growth /
    // strat-high-conviction catalog entries were removed with the persona). Unfilled identity → the
    // masked address stands in for the display name; `managerAddress` links Explore + the held
    // position to the manager's `/m/<address>` profile. No `managerHandle` (none claimed yet).
    manager: maskAddress(DEV_MANAGER_ADDRESS),
    managerAddress: DEV_MANAGER_ADDRESS,
    // POO-771 R10: the handleless dev manager stays WALLET-ONLY — no handle, no avatar, unverified
    // (consistent with detail.managerVerified below). Exercises the no-identity fallback in mock mode.
    managerVerified: false,
    riskLevel: 3,
    minInvestment: 500,
    tvl: 640_000,
    uniswapPoolTvlUsd: 9_600_000,
    investors: 142,
    estReturn: 11.2,
    rateType: "APR",
    status: "active",
    // POO-514 R3: the pool network so mock receipts assemble a real explorer /tx/ link.
    network: "arbitrum",
    // POO-819 R5: the 14-day lock-up mirrored top-level (consistent with detail.lockupDays below), so
    // mock mode still renders the lock-up row via the top-level source the consumers now read first.
    lockupDays: 14,
    // POO-905 R2: the protocol-wide fee rate (percent), matching the live PROTOCOL_FEE constant.
    protocolFeePct: 0.25,
    // POO-830 R3/R7: a plausible persisted OBJECTIVE for the one fixture with a real pool pair
    // (ETH/USDC, detail.poolPair below). Two-sided income-style LP → ['income']. The asset tags stay
    // pair-derived by `withMockAssetTags`; the pool-less mandate strategies carry no objective (honest).
    objectiveTags: ["income"],
    detail: {
      lockupDays: 14,
      // POO-659: the dev manager is unverified (profile `managerVerification: "none"`) → badge off.
      managerVerified: false,
      managerStakeUsd: 9_800,
      about:
        "Harvests funding-rate and liquidity-provision yield while hedging price exposure, aiming for a return that is largely independent of market direction.",
      receiveTokens: ["USDC"],
      // PP-MOCK: the single-pool (Manager V1) reference — drives the invest zap line (POO-184).
      poolPair: { token0: "ETH", token1: "USDC" },
      composition: [
        { label: "Derivatives", weight: 55 },
        { label: "Liquidity provision", weight: 35 },
        { label: "Stablecoin reserves", weight: 10 },
      ],
      mandate: {
        assets: [
          { label: "USDC", maxPct: 60 },
          { label: "ETH perp hedge", maxPct: 50 },
          { label: "BTC perp hedge", maxPct: 50 },
        ],
        protocols: [
          { label: "Hyperliquid", maxPct: 50 },
          { label: "Uniswap v3", maxPct: 40 },
          { label: "Aave v3", maxPct: 30 },
        ],
        networks: ["Arbitrum", "Ethereum"],
      },
      riskLimits: {
        maxDrawdown: [
          { period: "30D", pct: -3 },
          { period: "90D", pct: -6 },
          { period: "1Y", pct: -10 },
          { period: "Max", pct: -13 },
        ],
        leverage: "Up to 3x (hedged)",
        rebalancing: "Continuous",
        liquidity: "14-day unwind",
        strategyType: "Market-neutral",
        benchmark: "Cash + funding",
        custody: "Non-custodial (OAMS vault)",
      },
      fees: { managementPct: 2, performancePct: 20 },
    },
  },
  {
    id: "strat-degen-rotations",
    type: "trading",
    name: "Degen Rotations",
    manager: "Apex Quant",
    managerHandle: "apex-quant",
    // POO-771 R10: unverified manager WITH a handle — the badge stays off (consistent with
    // detail.managerVerified below), while the @handle attribution still links to /m/<handle>.
    managerVerified: false,
    riskLevel: 5,
    minInvestment: 1_000,
    tvl: 150_000,
    uniswapPoolTvlUsd: 2_400_000,
    investors: 37,
    estReturn: 24.0,
    rateType: "APR",
    // POO-659: this aggressive strategy carries the catalog's `paused` state (inherited from the
    // removed strat-high-conviction) so the paused UI state stays exercised; its repointed held
    // position (pos-high-conviction) is likewise paused.
    status: "paused",
    // POO-514 R3: the pool network so mock receipts assemble a real explorer /tx/ link.
    network: "arbitrum",
    // POO-819 R5: lock-up mirrored top-level (consistent with detail.lockupDays), matching real shape.
    lockupDays: 0,
    // POO-905 R2: the protocol-wide fee rate (percent), matching the live PROTOCOL_FEE constant.
    protocolFeePct: 0.25,
    detail: {
      lockupDays: 0,
      managerVerified: false,
      managerStakeUsd: 6_450,
      about:
        "A high-octane systematic strategy that rotates aggressively across emerging tokens and leveraged positions. Maximum return potential — and the largest risk of loss. Only for investors who can stomach deep drawdowns.",
      receiveTokens: ["USDC", "SOL"],
      composition: [
        { label: "Spot crypto", weight: 60 },
        { label: "Perpetuals", weight: 30 },
        { label: "Stablecoin reserves", weight: 10 },
      ],
      mandate: {
        assets: [
          { label: "Majors basket", maxPct: 60 },
          { label: "Small-cap basket", maxPct: 50 },
          { label: "Perp positions", maxPct: 60 },
        ],
        protocols: [
          { label: "Hyperliquid", maxPct: 70 },
          { label: "Jupiter", maxPct: 50 },
        ],
        networks: ["Solana", "Arbitrum"],
      },
      riskLimits: {
        maxDrawdown: [
          { period: "30D", pct: -25 },
          { period: "90D", pct: -45 },
          { period: "1Y", pct: -60 },
          { period: "Max", pct: -68 },
        ],
        leverage: "Up to 5x",
        rebalancing: "Continuous",
        liquidity: "Instant",
        strategyType: "Aggressive systematic",
        benchmark: "None",
        custody: "Non-custodial (OAMS vault)",
      },
      fees: { managementPct: 2, performancePct: 25 },
    },
  },
  {
    // PP-MOCK: a wound-down strategy the mock investor already fully withdrew from — drives the
    // "Show closed strategies" history section (POO-460). Excluded from Explore (closed); no
    // prospectus detail (fully closed), so it renders as read-only history only.
    id: "strat-eth-momentum",
    name: "ETH Momentum",
    manager: "Numen Capital",
    managerHandle: "numen-capital",
    riskLevel: 4,
    minInvestment: 100,
    tvl: 0,
    investors: 0,
    estReturn: 0,
    rateType: "APR",
    status: "closed",
    // POO-514 R3: the pool network so mock receipts assemble a real explorer /tx/ link.
    network: "base",
    // POO-905 R2: the protocol-wide fee rate (percent), matching the live PROTOCOL_FEE constant.
    protocolFeePct: 0.25,
  },
];
