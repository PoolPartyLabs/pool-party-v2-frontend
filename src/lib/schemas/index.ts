/**
 * @id PP-CORE-MCK-002
 * @name domain schemas
 * @implements-rules-version v1 · v1 (POO-905: top-level protocolFeePct)
 *
 * Zod schemas (and their inferred TypeScript types) for the core Pool Party domain entities used
 * across the investor app mocks: tokens, strategies, positions, savings markets, and transactions.
 * Each entity exposes a `<entity>Schema` (runtime validator) and a matching `<Entity>` type via
 * `z.infer`, so mock data and any future API payloads validate against a single source of truth.
 */
import { z } from "zod";

/** Ethereum-style address: `0x` followed by exactly 40 hexadecimal characters. */
const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;

/**
 * An on-chain token (e.g. USDC) referenced by strategies, positions, and transactions.
 */
export const tokenSchema = z.object({
  /** Contract address, `0x` + 40 hex chars. */
  address: z.string().regex(evmAddressRegex, "Invalid EVM address"),
  /** Ticker symbol, e.g. "USDC". */
  symbol: z.string(),
  /** Human-readable token name, e.g. "USD Coin". */
  name: z.string(),
  /** Number of decimal places; non-negative integer. */
  decimals: z.number().int().min(0),
  /** Absolute URL to the token logo. */
  logoUrl: z.string().url(),
  /** EVM chain id the token lives on; integer. */
  chainId: z.number().int(),
});

/** An on-chain token referenced across the domain. */
export type Token = z.infer<typeof tokenSchema>;

/**
 * The richer "prospectus" detail of a strategy, shown on the strategy detail screen
 * (PP-STR-SCR-002/003) but not needed by list surfaces. Optional on {@link strategySchema} so list
 * payloads stay lean; the mocks populate it for every strategy.
 */
export const strategyDetailSchema = z.object({
  /** Lock-up in days before the principal can be withdrawn; `0` means none. */
  lockupDays: z.number().int().min(0),
  /** Whether the manager is verified (drives the badge). */
  managerVerified: z.boolean(),
  /**
   * The manager's own allocation in this strategy (initial seed + any later top-ups), in USD —
   * surfaced on the manager card as a skin-in-the-game signal. Optional: absent until known.
   * PP-INTEGRATION-POINT: the real figure comes from the analytics indexer (pp-analytics), which
   * tracks the manager's seed deposit and top-ups; `/pools` does not carry it.
   */
  managerStakeUsd: z.number().min(0).optional(),
  /** Plain-language description of what the strategy does. */
  about: z.string(),
  /** Portfolio composition for the stacked bar + legend; `weight` is a percentage (sums ~100). */
  composition: z.array(z.object({ label: z.string(), weight: z.number().min(0).max(100) })),
  /** Investment mandate: max exposure caps per asset and per protocol, plus the networks used. */
  mandate: z.object({
    assets: z.array(z.object({ label: z.string(), maxPct: z.number().min(0).max(100) })),
    protocols: z.array(z.object({ label: z.string(), maxPct: z.number().min(0).max(100) })),
    networks: z.array(z.string()),
  }),
  /** Risk limits & terms shown in the prospectus. `maxDrawdown.pct` is negative (a loss bound). */
  riskLimits: z.object({
    maxDrawdown: z.array(z.object({ period: z.string(), pct: z.number() })),
    leverage: z.string(),
    rebalancing: z.string(),
    liquidity: z.string(),
    strategyType: z.string(),
    benchmark: z.string(),
    custody: z.string(),
  }),
  /** Fees, in percent. Shown in the mandate/fees section and again at confirmation. */
  fees: z.object({ managementPct: z.number().min(0), performancePct: z.number().min(0) }),
  /**
   * Assets the investor may choose to receive when collecting or withdrawing (manager-defined).
   * The first entry is the default (typically USDC). Optional so list payloads stay lean; the
   * transaction-settings "Receive as" picker falls back to USDC-only when absent.
   */
  receiveTokens: z.array(z.string()).min(1).optional(),
  /**
   * The pool pair behind a single-pool (Manager V1, Uniswap v3) strategy. Drives the invest
   * confirm's zap line: USDC in → auto-converted into these two tokens (POO-184). Absent on
   * multi-asset mandate strategies, which deploy across their mandate instead.
   */
  poolPair: z.object({ token0: z.string(), token1: z.string() }).optional(),
});

/** The strategy detail prospectus. */
export type StrategyDetail = z.infer<typeof strategyDetailSchema>;

/** The managed-strategy categories used by the Explore type filter. */
export const strategyTypeSchema = z.enum(["yield", "trading", "index", "market-neutral"]);

/** A managed-strategy category. */
export type StrategyType = z.infer<typeof strategyTypeSchema>;

/** All strategy categories, in display order (drives the Explore type chips). */
export const STRATEGY_TYPES = strategyTypeSchema.options;

/**
 * Canonical asset-class tags derived from a strategy's token pair (POO-830 R2/R7). Two-dimensional
 * tagging: this is the ASSET dimension (the objective dimension is separate and not on this schema
 * yet). Canonical keys only — localization happens in the UI layer, not here. Derived from the token
 * classes via {@link file://../strategies/tags/deriveAssetTags.ts}. ADDITIVE: separate from and
 * unrelated to `type` (StrategyType) and the risk classifier.
 */
export const assetTagSchema = z.enum(["bitcoin", "ethereum", "stablecoins", "altcoins", "meme"]);

/** A canonical asset-class tag. */
export type AssetTag = z.infer<typeof assetTagSchema>;

/**
 * Canonical OBJECTIVE tags (POO-830 R3/R4/R7) — the SECOND tagging dimension (what a strategy does),
 * derived at CREATION from the position's mint composition (two-sided → `income`; single-sided →
 * `gradualBuy` / `gradualSell` per R4). Canonical keys only — localization happens in the UI layer.
 * Unlike `assetTags` (a pure function of the pair, re-derivable client-side), the objective is NOT
 * derivable from the pair, so it must be PERSISTED by the backend and served on the strategy read
 * (see the PP-INTEGRATION-POINT in `mapStrategyV2`). The single source of truth for the union, reused
 * by `deriveStrategyTags` (the derivation) and `StrategyMetadataInput` (the create payload).
 */
export const objectiveTagSchema = z.enum(["income", "gradualBuy", "gradualSell"]);

/** A canonical objective tag. */
export type ObjectiveTag = z.infer<typeof objectiveTagSchema>;

/**
 * A managed investment strategy an investor can allocate into.
 */
export const strategySchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** Display name of the strategy. */
  name: z.string(),
  /** Manager's plain-language description (stored with the name; drives the detail "About"). Optional. */
  description: z.string().optional(),
  /**
   * Manager-uploaded strategy logo (https CDN URL from POO-580/POO-701 media hosting). Drives the
   * circular avatar on the investor Home lists (POO-713) and the Manager Console (POO-715); the UI
   * falls back to an initials monogram when absent. Optional: only the v2 read carries it
   * (`mapStrategyV2`) — the legacy v1 `/pools` payload has no logo column, and mock rows set it only
   * to exercise the image branch. PP-INTEGRATION-POINT: `logo_url` on the v2 strategy DTO. */
  logoUrl: z.string().optional(),
  /** Manager (name or identifier) responsible for the strategy. */
  manager: z.string(),
  /** Manager's public-profile handle, for linking the name to `/m/<handle>`. Optional on lean payloads. */
  managerHandle: z.string().optional(),
  /**
   * POO-771: the manager's PUBLIC avatar URL (https CDN), embedded by the backend on the catalog /
   * detail / portfolio payloads (POO-758) and mapped through by `mapStrategyV2` / `mapStrategy` /
   * `synthesizeStrategyFromPosition`. Drives the manager avatar on the Strategy Detail (ManagerCard +
   * hero); absent → the initials monogram fallback (POO-702 leaves many NULL until the save-path fix).
   */
  managerAvatarUrl: z.string().optional(),
  /**
   * POO-771: the manager's derived verified flag (true only for the fully verified `valid` state,
   * POO-744/745), embedded by the backend (POO-758). The single badge source across investor surfaces
   * (StrategyCard, PositionCard, the detail hero + ManagerCard, and the text-only attribution cells),
   * replacing the old `detail.managerVerified` gate. Optional: absent on lean/older payloads → no badge.
   */
  managerVerified: z.boolean().optional(),
  /**
   * Manager's wallet address (EVM). Attributes + links a strategy to the manager's public profile by
   * address (`/m/<address>`) when no handle is set, and lets a manager's strategies be listed by
   * address. PP-INTEGRATION-POINT: the real manager address comes from the `/pools` payload.
   */
  managerAddress: z.string().optional(),
  /** Risk band from 1 (lowest) to 5 (highest); integer. */
  riskLevel: z.number().int().min(1).max(5),
  /** Minimum investment in USD; non-negative. */
  minInvestment: z.number().min(0),
  /** Total value locked in USD; non-negative. */
  tvl: z.number().min(0),
  /**
   * Investor-facing Uniswap pool TVL in USD (the underlying pool's `reserve_in_usd`), shown as "TVL"
   * on investor surfaces (POO-390 R1/R2). Distinct from `tvl`, which is the PP-managed position value
   * that drives the manager's AUM (R3) — the two never re-merge. Optional: absent when the API omits
   * it, on lean rows, and on fixtures that predate the field. Missing/zero renders a dash (R5).
   */
  uniswapPoolTvlUsd: z.number().min(0).optional(),
  /** Count of investors; non-negative integer. */
  investors: z.number().int().min(0),
  /** Estimated return expressed against `rateType` (can be negative). */
  estReturn: z.number(),
  /** Whether `estReturn` is an annual percentage rate or yield. */
  rateType: z.enum(["APR", "APY"]),
  /** Current lifecycle status. `closed` = the manager ended it; investors only withdraw. */
  status: z.enum(["active", "paused", "closed"]),
  /** Strategy category (drives the Explore type filter). Optional on lean list payloads. */
  type: strategyTypeSchema.optional(),
  /** API network slug the pool lives on (e.g. "arbitrum"), needed to build on-chain operations and
   * the receipt explorer /tx/ links (POO-514). Mock strategies carry a plausible slug too. */
  network: z.string().optional(),
  /** Pool contract address (the Permit2 spender + `poolPartyPositionAddress` for invest). Absent on mock data. */
  pool: z.string().optional(),
  /**
   * The Uniswap v3 position NFT token id (a numeric string), for the manager "View on Uniswap" deep
   * link (POO-750). Changes when the range is moved (a new NFT is minted). Only the v2 read carries it
   * (`mapStrategyV2` ← `tokenId`); absent on the v1 `/pools` payload and on mock rows.
   */
  nftPositionId: z.string().optional(),
  /**
   * The pool's pair tokens (real symbols from `/pools`), independent of the full `detail` prospectus.
   * Drives the single-pool Composition + Investment-mandate cards on the Strategy Detail in real mode.
   */
  poolPair: z.object({ token0: z.string(), token1: z.string() }).optional(),
  /**
   * The underlying pool's fee tier in basis points (30 = 0.30%), mapped from the API's `poolFeeTier`
   * label. INTERIM DEX-fee source for the collect minimum math (POO-516 R2) until the backend
   * exposes the swap route's fee tier on build/simulation responses (POO-521). Absent on mock data
   * and on rows without the label — never fabricated.
   */
  poolFeeBps: z.number().int().positive().optional(),
  /**
   * POO-819: the manager-declared lock-up in days before the principal can be withdrawn (`0` = none),
   * mirrored TOP-LEVEL (like `poolPair` / `poolFeeBps`) so the real v2 mapper can carry it WITHOUT
   * synthesizing a partial `detail` prospectus (`strategyDetailSchema` requires many siblings, which
   * would violate no-mock-in-real). The lock-up-aware consumers (Invest Review, Strategy Detail,
   * Withdraw) read `strategy.lockupDays ?? strategy.detail?.lockupDays`. Optional: the v1 `/pools` path
   * and lean/older payloads leave it undefined (honest → the row renders "None").
   * PP-INTEGRATION-POINT: `lockupDays` on the v2 strategy DTO (already exposed; POO-812).
   */
  lockupDays: z.number().int().min(0).optional(),
  /**
   * POO-902: the manager's performance fee in PERCENT (10 = 10%), mirrored TOP-LEVEL (like
   * `lockupDays`) so the real v2 mapper can carry the DTO's `managerFee` (basis points, / 100)
   * WITHOUT synthesizing a partial `detail` prospectus. The Strategy Detail "Performance fee" tile
   * reads `strategy.performanceFeePct ?? detail?.fees.performancePct`. Optional: the v1 `/pools`
   * path has no fee source → undefined → the tile is omitted (never fabricated, POO-799).
   */
  performanceFeePct: z.number().min(0).optional(),
  /**
   * POO-905: the protocol fee RATE in percent (0.25 today, the pp-api `PROTOCOL_FEE` constant),
   * served top-level on v2 strategy rows so the Invest Review can estimate the protocol fee
   * pre-build (`amount × protocolFeePct / 100`). The built `swapInfo.protocolFee` stays
   * authoritative once the server build lands. Optional: the v1 `/pools` path and older payloads
   * leave it undefined (honest → the Review shows no protocol line, never a client constant).
   */
  protocolFeePct: z.number().min(0).optional(),
  /**
   * Raw on-chain pool-position state for the DISCOVERY (not-invested) Composition split (POO-897
   * rules v1 [R2]/[R4]): the pool's current reserves (`totalSupply0/1`, raw base units) + token
   * decimals feed `positionTokenSplit`, and the tick bounds + current tick feed the range-math
   * fallback (`tokenSplitFromTicks`) when reserves are missing or zero ([R5]). Already on the wire
   * (v2 `StrategyOnchainDto`, v1 `/pools` ticks): previously dropped by the mappers. Optional and
   * never fabricated: absent on mock, lean and pending rows (the card degrades per [R4]). The
   * invested variant reads the SAME fields from `Position` instead (POO-437 block below).
   */
  onchain: z
    .object({
      /** token0 reserve, raw base units (wei string). */
      totalSupply0: z.string().optional(),
      /** token1 reserve, raw base units (wei string). */
      totalSupply1: z.string().optional(),
      /** The position's lower tick bound. */
      tickLower: z.number().int().optional(),
      /** The position's upper tick bound. */
      tickUpper: z.number().int().optional(),
      /** The pool's current tick. */
      tickCurrent: z.number().int().optional(),
      /** token0 decimals. */
      decimals0: z.number().int().optional(),
      /** token1 decimals. */
      decimals1: z.number().int().optional(),
    })
    .optional(),
  /** Prospectus detail for the strategy detail screen. Optional on list payloads. */
  detail: strategyDetailSchema.optional(),
  /**
   * Canonical ASSET tags derived from the pool pair (POO-830 R7), populated by BOTH real mappers
   * (`mapStrategy` / `mapStrategyV2`) and the mock strategy service. Additive discovery surface,
   * distinct from `type`/riskLevel. Optional: absent on lean rows and pending v2 rows with no pair.
   */
  assetTags: z.array(assetTagSchema).optional(),
  /**
   * True when either pool token is absent from the curated token-class registry (POO-830 R1/R2), so
   * the derived `assetTags` folded an unknown token into `altcoins`. Lets discovery surface an
   * "unverified token" signal. Optional: omitted when both tokens are verified.
   */
  unverifiedTokens: z.boolean().optional(),
  /**
   * Canonical OBJECTIVE tags (POO-830 R3/R4/R7) — the second tagging dimension, derived at CREATION
   * from the manager's mint composition and PERSISTED (unlike `assetTags`, the objective is NOT
   * pair-derivable). Populated on the mock fixtures that carry a real pool pair; on real reads it
   * arrives only once the backend serves it (PP-INTEGRATION-POINT in `mapStrategyV2`). Optional:
   * absent on lean rows and until the backend persists it. NOT yet consumed by the investor filter
   * (a deferred follow-up) — this PR only wires the data.
   */
  objectiveTags: z.array(objectiveTagSchema).optional(),
});

/** A managed investment strategy. */
export type Strategy = z.infer<typeof strategySchema>;

/**
 * An investor's position in a given strategy.
 */

/**
 * One leg of the per-token claimable-fee breakdown (POO-417 R3): a pool token symbol and the human
 * fee amount owed in it. Amounts only — the backend exposes no per-token USD.
 */
export const claimableFeeTokenSchema = z.object({
  /** Token symbol, e.g. "ETH". */
  symbol: z.string(),
  /** Human fee amount in this token (raw base units / 10^decimals). */
  amount: z.number(),
});
/** One leg of the per-token claimable-fee breakdown. */
export type ClaimableFeeToken = z.infer<typeof claimableFeeTokenSchema>;

export const positionSchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** Foreign key to the related strategy. */
  strategyId: z.string(),
  /** Principal invested in USD. */
  invested: z.number(),
  /** Current mark-to-market value in USD. */
  currentValue: z.number(),
  /** Cumulative yield earned in USD. */
  totalYield: z.number(),
  /** Amount currently available to withdraw or reinvest in USD. */
  available: z.number(),
  /** How yield is handled for this position. */
  reinvestment: z.enum(["auto-compound", "manual-payout"]),
  /** Current lifecycle status of the position. */
  status: z.enum(["active", "paused", "closed"]),
  /**
   * Epoch-ms of the wallet's FIRST entry into this strategy (POO-226 R4) — distinct from the
   * strategy's own creationTime (which arrives via POO-633/636). Optional: mock fixtures provide it;
   * real mode leaves it UNDEFINED (never fabricated) until the indexer serves it.
   * PP-INTEGRATION-POINT (POO-641): openedAt ← analytics indexed movements, backfillable for existing
   * positions.
   */
  openedAt: z.number().int().positive().optional(),
  /** Whether the connected wallet is the manager of this position's pool (drives the manager role). */
  isPoolManager: z.boolean().optional(),
  /** Uncollected (claimable) trading fees in USD — the manager Collect preview (POO-318). Absent on mock. */
  uncollectedFeesUsd: z.number().optional(),
  /**
   * Per-token breakdown of the claimable fees for the "receive as token pair" collect option
   * (POO-417 R3): one entry per pool token (token0, token1) with the human amount. Amounts only,
   * no USD (the backend exposes none per token). Absent when the per-token source is missing (R6c).
   */
  claimableFeeTokens: z.array(claimableFeeTokenSchema).length(2).optional(),
  /**
   * Raw on-chain state used only by the legacy (Arbitrum/Base) move-range to size its rebalance swap
   * (POO-437): the pool position's current reserves (`totalSupply0/1`, raw base units), the current
   * pool tick, and the token decimals. Real mode only; absent on mock and lean reads.
   */
  totalSupply0: z.string().optional(),
  totalSupply1: z.string().optional(),
  tickCurrent: z.number().int().optional(),
  decimals0: z.number().int().optional(),
  decimals1: z.number().int().optional(),
  /**
   * Real-data Strategy synthesized from the position's own pool descriptor (POO-526). The holdings
   * catalog (`/pools`) omits closed/wound-down pools, so a closed-with-balance holding has no catalog
   * match; the Portfolio join falls back to this so the closed strategy stays on screen (pending
   * Withdraw) instead of being dropped. Real mode only — absent on mock (which resolves via the mock
   * catalog) and on lean reads. Never a fabricated prospectus (structural fields only).
   */
  fallbackStrategy: strategySchema.optional(),
});

/** An investor's position in a strategy. */
export type Position = z.infer<typeof positionSchema>;

/** Selectable earnings windows on the share-yield modal (PP-STR-MOD-009). */
export const sharePeriodSchema = z.enum(["24h", "7d", "30d"]);

/** A selectable earnings window. */
export type SharePeriod = z.infer<typeof sharePeriodSchema>;

/**
 * Net amount earned by a position (fees + yield) over each share period, in USD.
 * Negative values are real: the share card renders them as a loss (POO-275 R6).
 */
export const positionEarningsSchema = z.object({
  "24h": z.number(),
  "7d": z.number(),
  "30d": z.number(),
});

/** Per-period earned amounts for the share-yield card. */
export type PositionEarnings = z.infer<typeof positionEarningsSchema>;

/**
 * The MOCK share-period windows the mock Home builder sums for "Earned today" (24h) / "Last 30 days"
 * (30d). Each window is nullable so a missing entry threads in as null; a null window contributes 0 to
 * the sum (honest-empty), never a fabricated number. The mock feesEarned table (all-number) is
 * assignable to this wider type. Mock-harness-only — real mode reads the C1 `/financials` payload
 * (PP-CORE-LIB-048); the legacy analytics `/metrics` schemas that once fed the real path were removed.
 */
export type NullableEarningsWindows = {
  "24h": number | null;
  "7d"?: number | null;
  "30d": number | null;
};

/**
 * A savings (lending) market the investor can deposit into.
 */
export const savingsMarketSchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** Asset symbol or identifier supplied to the market. */
  asset: z.string(),
  /** Venue / protocol providing the market. */
  venue: z.string(),
  /** Net annual percentage yield (after fees). */
  netApy: z.number(),
  /** Available liquidity in the market, in USD. */
  liquidity: z.number(),
  /** Amount the investor has deposited, in USD. */
  deposited: z.number(),
});

/** A savings / lending market. */
export type SavingsMarket = z.infer<typeof savingsMarketSchema>;

/**
 * The kind of an investor activity-feed transaction (POO-226 R1). Semantics: `invest` = strategy
 * entry, `deposit` = cash-in / top-up, `withdraw` = strategy exit, `yield` = rewards collected,
 * `swap` = reserved (no producer yet). The real mapper derives these from OAMS liquidity events
 * (POO-226 R2); mock fixtures already carry them.
 */
export const transactionTypeSchema = z.enum(["deposit", "withdraw", "invest", "yield", "swap"]);

/** An investor activity-feed transaction kind. */
export type TransactionType = z.infer<typeof transactionTypeSchema>;

/** All transaction kinds, in canonical order. */
export const TRANSACTION_TYPES = transactionTypeSchema.options;

/**
 * The settlement status of an activity-feed transaction (POO-226 R3). `failed` is forward-compatible:
 * no producer emits it yet (the feed is mined-events-only), but the UI renders a destructive chip if
 * it ever appears, so the schema accepts it now.
 */
export const transactionStatusSchema = z.enum(["completed", "pending", "failed"]);

/** An activity-feed transaction settlement status. */
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

/**
 * A historical transaction in the investor's activity feed.
 */
export const transactionSchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** Transaction kind (POO-226 R1). */
  type: transactionTypeSchema,
  /** Ticker symbol of the token moved. */
  tokenSymbol: z.string(),
  /** Token amount moved (in token units). */
  tokenAmount: z.number(),
  /** USD value of the transaction at the moment it occurred (price-at-time). */
  usdValueAtTime: z.number(),
  /** Current settlement status (POO-226 R3). */
  status: transactionStatusSchema,
  /** Unix epoch timestamp (milliseconds). */
  timestamp: z.number(),
});

/** A historical transaction record. */
export type Transaction = z.infer<typeof transactionSchema>;

/** A single Duck Shoot prize target (a multiplier the player can win). */
export const duckShootTargetSchema = z.object({
  /** The boost multiplier this target awards, in percent (e.g. 300 → +300%). */
  multiplierPct: z.number().min(0),
});

/** A Duck Shoot prize target. */
export type DuckShootTarget = z.infer<typeof duckShootTargetSchema>;

/**
 * Duck Shoot mini-game state (PP-REW-MOD-001): a target-shooting game that grants a boost on today's
 * Quacks. Tries are earned by protocol transactions (deposit / withdraw / collect).
 */
export const duckShootSchema = z.object({
  /** Tries remaining to PLAY this week (each protocol transaction earns one). */
  triesLeft: z.number().int().min(0),
  /** Tries still available to EARN this week (drives the "N more tries this week" copy). */
  weeklyTriesLeft: z.number().int().min(0),
  /** Tries granted per week at the cap. */
  triesPerWeek: z.number().int().min(1),
  /** The prize targets shown on the board (one badge per duck). */
  targets: z.array(duckShootTargetSchema).min(1),
  /** The most recent shot's outcome, when the player has just played. */
  lastResult: z
    .object({
      /** The multiplier won, in percent. */
      multiplierPct: z.number().min(0),
      /** Quacks awarded by the boost. */
      quacksWon: z.number().min(0),
    })
    .optional(),
});

/** The Duck Shoot mini-game state. */
export type DuckShoot = z.infer<typeof duckShootSchema>;

/**
 * Rubber Rush rewards dashboard (PP-REW-SCR-001): the investor's Quacks balance, loyalty tier,
 * daily-boost streak and referral program. Gamification is mocked end-to-end today; the real
 * figures come from the rewards/points backend.
 */
export const rubberRushSchema = z.object({
  /** Lifetime Quacks balance. */
  quacks: z.number().min(0),
  /** Active tier as a 0-based index into the five tiers (Paddler … Party Captain). */
  tierIndex: z.number().int().min(0).max(4),
  /** Leaderboard standing for the active tier, e.g. `57.8` → "Top 57.8%". */
  tierTopPercent: z.number().min(0).max(100),
  /** Marker position along the full tier bar, as a percentage (0–100). */
  tierProgressPct: z.number().min(0).max(100),
  /** Number of people who used the investor's referral code. */
  totalReferrals: z.number().int().min(0),
  /** Daily-boost multiplier, e.g. `0` → "0x". */
  dailyBoostX: z.number().min(0),
  /** Quacks earned so far today. */
  quacksToday: z.number().min(0),
  /** Current consecutive-day streak. */
  streakDays: z.number().int().min(0),
  /** Streak length that reaches the max boost (e.g. 7). */
  streakTarget: z.number().int().min(1),
  /** The investor's referral code. */
  referralCode: z.string(),
  /** Shareable referral link. */
  referralLink: z.string(),
  /** Who invited this investor, or `null` if nobody. */
  invitedBy: z.string().nullable(),
  /** Referred friends counted toward the next referral-reward tier. */
  referralFriends: z.number().int().min(0),
  /** Friends needed to reach the next referral-reward tier. */
  referralFriendsTarget: z.number().int().min(1),
  /** Multiplier unlocked at the next referral-reward tier, e.g. `1.5` → "1.5x". */
  nextMultiplierX: z.number().min(0),
  /** Whether the once-per-day Say Quack check-in has already been done today. */
  quackedToday: z.boolean(),
  /** Duck Shoot mini-game state (tries + prize targets). */
  duckShoot: duckShootSchema,
});

/** The Rubber Rush rewards dashboard. */
export type RubberRush = z.infer<typeof rubberRushSchema>;

/** A single ManagerIncentiveProgram tier row (threshold → bonus-fee share). */
export const managerIncentiveProgramTierSchema = z.object({
  /** Tier number; Tier 1 is the top tier (highest TVL threshold, highest bonus). */
  tier: z.number().int().min(1),
  /** Minimum managed TVL (USD) to reach the tier. */
  minTvl: z.number().min(0),
  /** Bonus-fee share earned at the tier, in percent. */
  bonusFeesPct: z.number().min(0),
});

/** An ManagerIncentiveProgram tier row. */
export type ManagerIncentiveProgramTier = z.infer<typeof managerIncentiveProgramTierSchema>;

/** A first-month onboarding goal for an ManagerIncentiveProgram. */
export const managerIncentiveProgramGoalSchema = z.object({
  /** Stable goal identifier (drives the label + whether progress is shown). */
  key: z.enum(["referrals", "posts", "communityPool"]),
  /** Current progress, when tracked in-app. */
  current: z.number().int().min(0).optional(),
  /** Target value, when tracked in-app. */
  target: z.number().int().min(0).optional(),
  /** True when the goal is verified outside the app (no in-app progress). */
  trackedExternally: z.boolean(),
});

/** An ManagerIncentiveProgram onboarding goal. */
export type ManagerIncentiveProgramGoal = z.infer<typeof managerIncentiveProgramGoalSchema>;

/**
 * ManagerIncentiveProgram dashboard (PP-REW-SCR-002): the manager-side rewards view — revenue, managed TVL,
 * the bonus-fee tier ladder, accrued/earned fees, and first-month onboarding goals. Mocked today;
 * the real figures come from the rewards backend joined with on-chain fee events.
 */
export const managerIncentiveProgramSchema = z.object({
  /** Display name of the managerIncentiveProgram. */
  name: z.string(),
  /** Bonus revenue accrued this month, in USD. */
  revenueThisMonth: z.number(),
  /** When the investor became an managerIncentiveProgram, pre-formatted (e.g. "May 2026"). */
  sinceLabel: z.string(),
  /** Number of strategies this managerIncentiveProgram has created. */
  strategiesCreated: z.number().int().min(0),
  /** Total value locked across the managerIncentiveProgram's strategies, in USD. */
  managedTvl: z.number().min(0),
  /** Number of people who used the managerIncentiveProgram's referral code. */
  referrals: z.number().int().min(0),
  /** Current bonus-fee share, in percent (on top of normal fees). */
  bonusFeesPct: z.number().min(0),
  /** Size of the managerIncentiveProgram token pool being distributed. */
  tokensToDistribute: z.number().int().min(0),
  /** The managerIncentiveProgram's current tier number. */
  currentTier: z.number().int().min(1),
  /** Progress toward the next tier, as a percentage (0–100). */
  tierProgressPct: z.number().min(0).max(100),
  /** The full tier ladder, top tier first. */
  tiers: z.array(managerIncentiveProgramTierSchema),
  /** Revenue breakdown shown in the Revenue card. */
  revenue: z.object({
    /** Estimated bonus accrued this month, in USD (paid end of month). */
    estimatedAccrued: z.number(),
    /** Total fees generated by the managerIncentiveProgram's strategies this month, in USD. */
    feesThisMonth: z.number(),
    /** All-time fees generated by the managerIncentiveProgram's strategies, in USD. */
    totalFees: z.number(),
  }),
  /** First-month onboarding goals. */
  goals: z.array(managerIncentiveProgramGoalSchema),
});

/** The ManagerIncentiveProgram rewards dashboard. */
export type ManagerIncentiveProgram = z.infer<typeof managerIncentiveProgramSchema>;

/** A single referred friend in the invite list. */
export const referralInviteSchema = z.object({
  /** Friend's display name. */
  name: z.string(),
  /** Reward/progress state; drives the status badge. */
  status: z.enum(["earned", "invested", "pending"]),
  /** What the friend has invested so far, in USD (absent until they invest). */
  investedUsd: z.number().min(0).optional(),
});

/** A referred friend. */
export type ReferralInvite = z.infer<typeof referralInviteSchema>;

/**
 * Referral / "invite & earn" program (PP-REW-SCR-003): the give-get reward, lifetime earnings, the
 * investor's code + share link, and the list of invited friends with their status. Mocked today.
 */
export const referralProgramSchema = z.object({
  /** Give-get reward per qualified referral, in USD (e.g. 10 → "$10"). */
  rewardUsd: z.number().min(0),
  /** Minimum first investment a friend must make to qualify, in USD (e.g. 50). */
  minInvestUsd: z.number().min(0),
  /** Lifetime rewards earned by this investor, in USD. */
  totalEarnedUsd: z.number().min(0),
  /** Count of friends who have joined (qualified). */
  friendsJoined: z.number().int().min(0),
  /** The investor's referral code — `null` until they create it (one-time, immutable; POO-290). */
  code: z.string().nullable(),
  /** Shareable invite link — `null` until the code exists. */
  inviteLink: z.string().nullable(),
  /**
   * The code of whoever referred THIS investor, when they were themselves invited (POO-579, Feature A).
   * Sourced from the pp-api `referredBy.code`; `null`/absent for a non-referred user. Optional +
   * nullable (nullish) so existing `ReferralProgram` objects/fixtures stay valid without edits.
   */
  invitedByCode: z.string().nullish(),
  /** The invited friends. */
  invites: z.array(referralInviteSchema),
});

/** The referral / invite-and-earn program. */
export type ReferralProgram = z.infer<typeof referralProgramSchema>;

// ---------------------------------------------------------------------------
// Cards (PP-CARD): partner crypto debit-card marketplace
//
// Pool Party is a marketplace + referral, not an issuer (Linear doc "Cards — Business Rules &
// Scope"). A CardOffer is a partner card in the Explore catalog; an OwnedCard is a card the
// investor holds (rechargeable balance); a CardTransaction is a spend/credit on a held card.
// ---------------------------------------------------------------------------

/** Hex color string, `#` + exactly 6 hex digits (drives the card visual; maps to a PP color token). */
const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

/** The card network a partner card runs on (drives the network logo). */
export const cardNetworkSchema = z.enum(["visa", "mastercard"]);

/** A card network. */
export type CardNetwork = z.infer<typeof cardNetworkSchema>;

/**
 * A partner card offer shown in the Explore marketplace (PP-CARD-SCR-001). `ctaState` drives the
 * call-to-action and `badge` the status pill; "Request card" hands off to the partner's onboarding
 * (referral) at `onboardingUrl`, where KYC + issuance happen.
 */
export const cardOfferSchema = z.object({
  /** Stable partner identifier, e.g. "ether-fi". */
  partnerId: z.string(),
  /** Partner / product name, e.g. "Ether.fi". */
  name: z.string(),
  /** Short descriptor under the name, e.g. "Cash · crypto debit". */
  subtitle: z.string(),
  /** Card network (Visa / Mastercard). */
  network: cardNetworkSchema,
  /** Brand color for the card visual, as a hex string. */
  brandColor: z.string().regex(hexColorRegex, "Invalid hex color"),
  /**
   * Selling-point bullets shown on the offer (the design uses three). Stored as `cards`-namespace
   * i18n keys (e.g. `explore.perks.noAnnualFee`), resolved at render by CardOffer so they localize —
   * partner integrations should map to these keys (or add new ones) rather than raw display copy.
   */
  perks: z.array(z.string()).min(1),
  /** Status pill; absent for a plain, requestable offer. */
  badge: z.enum(["popular", "requested", "active"]).optional(),
  /** Which call-to-action to render. */
  ctaState: z.enum(["request", "activating", "manage"]),
  /** Partner onboarding URL for the referral handoff. */
  onboardingUrl: z.string().url().optional(),
});

/** A partner card offer in the Explore marketplace. */
export type CardOffer = z.infer<typeof cardOfferSchema>;

/**
 * A card the investor holds (PP-CARD-SCR-002). Funding is a rechargeable balance: the investor tops
 * up from wallet / portfolio and spend debits `balanceUsd`.
 */
export const ownedCardSchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** Foreign key to the partner offer / catalog entry. */
  partnerId: z.string(),
  /** Brand wordmark on the card face, e.g. "ether.fi". */
  brand: z.string(),
  /** Card network. */
  network: cardNetworkSchema,
  /** Last four digits of the card number (masked PAN), e.g. "4242". */
  maskedPan: z.string().regex(/^\d{4}$/, "maskedPan must be the last 4 digits"),
  /** Spendable card balance in USD; non-negative (rechargeable model). */
  balanceUsd: z.number().min(0),
  /** Card funding type. */
  type: z.enum(["debit"]),
  /** Current lifecycle status. */
  status: z.enum(["active", "frozen", "requested"]),
  /** Brand color for the card visual, hex. */
  brandColor: z.string().regex(hexColorRegex, "Invalid hex color"),
});

/** A card the investor holds. */
export type OwnedCard = z.infer<typeof ownedCardSchema>;

/**
 * A spend or credit on a held card, for the My-cards activity feed. Follows the transaction-display
 * rule: per-token amount (`tokenAmount`, negative = spend, positive = credit) plus the USD value at
 * the moment of the transaction (price-at-time).
 */
export const cardTransactionSchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** Foreign key to the held card the transaction belongs to. */
  cardId: z.string(),
  /** Merchant or counterparty, e.g. "Spotify" (or "Cashback" / "Top up" for credits). */
  merchant: z.string(),
  /** Category / source shown under the merchant, e.g. "Music". */
  category: z.string(),
  /** Ticker symbol of the token moved, e.g. "USDC". */
  tokenSymbol: z.string(),
  /** Token amount moved; negative for a spend (debit), positive for a credit. */
  tokenAmount: z.number(),
  /** USD value at the moment of the transaction (price-at-time), as a magnitude. */
  usdValueAtTime: z.number().min(0),
  /** Unix epoch timestamp (milliseconds). */
  timestamp: z.number(),
});

/** A card spend / credit record. */
export type CardTransaction = z.infer<typeof cardTransactionSchema>;

/**
 * The manager console dashboard (Overview): aggregate KPIs + the AUM-over-time chart for the
 * authenticated manager. Figures mirror the Figma reference (PP-MGR-SCR-001).
 */
export const managerDashboardSchema = z.object({
  /** The manager's display name (for the greeting). */
  name: z.string(),
  /** Total assets under management across the manager's strategies, in USD. */
  aum: z.number().min(0),
  /** AUM change over the trailing 30 days, as a percentage (can be negative). */
  aumChangePct: z.number(),
  /**
   * Net inflows over the trailing 30 days, in USD (can be negative). PP-CORE-LIB-049 (POO-991): nullable
   * because the only source is the C1 `/financials` field (11) — no on-chain Σ exists — so a null payload
   * (mock / unavailable) or a served-null field renders `common.unavailable`, never a fabricated $0.
   */
  netInflows30d: z.number().nullable(),
  /** Lifetime yield generated for investors, in USD. */
  yieldGenerated: z.number().min(0),
  /**
   * Current/active investors: the sum of the on-chain OPEN-position counts across the manager's
   * strategies. Feeds the "Active investors" tile; decrements on a full withdrawal (POO-743).
   */
  totalInvestors: z.number().int().min(0),
  /**
   * POO-743 (rules-v2): all-time distinct investors (monotonic, dedup'd across the manager's
   * strategies), from `manager_metrics.n_investors`. Feeds the "Total investors" tile; a full
   * withdrawal does NOT decrement it. Degrades to the on-chain `totalInvestors` sum when analytics is
   * unavailable. INTERIM [R5]: still counts the manager's own wallet until POO-755 lands.
   */
  totalInvestorsAllTime: z.number().int().min(0),
  /**
   * Week-over-week change in current investors, as a percentage (can be negative), or `null` when no
   * weekly-active source exists. Real mode has no weekly-active metric yet (POO-561), so it is `null`
   * and the tile renders no delta; the honest mock (POO-560 R2) keeps a plain number.
   */
  activeWoWPct: z.number().nullable(),
  /** Referrals attributed to the manager's invite link. */
  referrals: z.number().int().min(0),
  /** Fees earned by the manager, in USD, with the per-type breakdown. */
  earnings: z.object({
    /**
     * All-time fees earned by the manager, in USD (the card's "All-time" label). PP-CORE-LIB-049
     * (POO-991): the only source is the C1 `/financials` field (15, `performanceFees`, Σ measured
     * manager_receipt legs) — no on-chain Σ exists — so nullable: a null payload or served-null field
     * renders `common.unavailable`, never a fabricated $0. V1 locks entry/exit fees at 0, so
     * total == performance.
     */
    totalUsd: z.number().min(0).nullable(),
    /** All-time performance-fee share, in USD. Nullable for the same reason as `totalUsd`. */
    performanceUsd: z.number().min(0).nullable(),
    /** Entry-fee share, in USD (hidden today, always 0). */
    entryUsd: z.number().min(0),
    /** Exit-fee share, in USD (hidden today, always 0). */
    exitUsd: z.number().min(0),
  }),
  /** Blended average APY across the manager's strategies, as a percentage. */
  avgApy: z.number(),
  /** The manager's shareable page handle (pool-party.xyz/m/<handle>). Empty for an unfilled manager. */
  handle: z.string(),
  /**
   * POO-659: the manager's wallet address (EVM) — the stable identity the console reads the profile
   * by, and the invite/greeting fallback when no `handle` is set (identity=address). Optional.
   * PP-INTEGRATION-POINT: the authenticated wallet address.
   */
  address: z.string().optional(),
  /** AUM-over-time series for the hero chart (matches the PerformanceChart point shape). */
  chart: z.array(
    z.object({ value: z.number(), label: z.string(), display: z.string().optional() }),
  ),
});

/** The manager console dashboard overview. */
export type ManagerDashboard = z.infer<typeof managerDashboardSchema>;

/** A strategy created by the manager, as shown in the console's "Your strategies" table. */
export const managerStrategySchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** Strategy display name. */
  name: z.string(),
  /** Manager's plain-language description (stored with the name). Optional. */
  description: z.string().optional(),
  /** 1–2 letter avatar initials. */
  initials: z.string(),
  /** Risk level 1 (very conservative) – 5 (very aggressive), auto-derived from the mandate. */
  riskLevel: z.number().int().min(1).max(5),
  /** Auto-derived category label, e.g. "Stablecoin yield". */
  category: z.string(),
  /** Assets under management in this strategy, in USD. */
  aum: z.number().min(0),
  /** Investors currently in this strategy. */
  investors: z.number().int().min(0),
  /** Net flows over the trailing 30 days, in USD (can be negative). */
  flows30d: z.number(),
  /** Net APY for this strategy, as a percentage. */
  apy: z.number(),
  /** The manager's fee earnings from this strategy over the trailing 30 days, in USD. */
  fees30d: z.number().min(0),
  /** Tiny 30d value sparkline, oldest → newest (at least two points). */
  spark: z.array(z.number()).min(2),
  /**
   * Whether `spark` is a REAL measured trend (POO-559 R2). Absent = measured (mock rows carry real
   * shapes). Explicit `false` marks a placeholder (real mode with a <2-point / uncovered series): the
   * card hides the sparkline rather than presenting a flat 2-point line as a measured 30d trend.
   */
  sparkMeasured: z.boolean().optional(),
  /** Whether the position sits inside its price range (out of range → earning no fees + alert). */
  inRange: z.boolean(),
  /** Optional manager-uploaded logo (data / remote URL); the UI falls back to initials. */
  logoUrl: z.string().optional(),
  /** Lifecycle status. */
  status: z.enum(["active", "paused", "closed", "draft"]),
});

/** A manager-created strategy row. */
export type ManagerStrategy = z.infer<typeof managerStrategySchema>;

/** One event in a strategy's manager-side activity feed (newest first in fixtures). */
export const managerActivityEventSchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** What happened: investor flows (deposit/withdraw) or manager actions (collect/compound/move_range). */
  type: z.enum(["deposit", "withdraw", "collect", "compound", "move_range"]),
  /** Token amount moved, for flows (absent on move_range). */
  tokenAmount: z.number().optional(),
  /** Symbol for `tokenAmount`. */
  tokenSymbol: z.string().optional(),
  /** USD value at the moment of the event (price-at-time rule). */
  usdValueAtTime: z.number().min(0),
  /** Epoch milliseconds. */
  timestamp: z.number().int().positive(),
});

/** A manager-side activity event. */
export type ManagerActivityEvent = z.infer<typeof managerActivityEventSchema>;

/** One protocol- or token-level slice of a strategy's deployed capital (manage-detail Allocation card). */
export const managerAllocationSliceSchema = z.object({
  /** Display label — a protocol name (e.g. "Aave v3") or a token symbol (e.g. "USDC"). */
  label: z.string(),
  /** Share of the strategy's allocated capital, as a percentage (0–100). */
  pct: z.number().min(0).max(100),
});

/** A strategy's capital allocation across protocols and tokens (manage-detail Allocation card). */
export const managerAllocationSchema = z.object({
  /** Allocation by protocol. */
  protocols: z.array(managerAllocationSliceSchema),
  /** Allocation by token. */
  tokens: z.array(managerAllocationSliceSchema),
});

/** A strategy's capital allocation breakdown. */
export type ManagerAllocation = z.infer<typeof managerAllocationSchema>;

/**
 * One investor comment thread on a strategy, as the manager sees it (1 thread = 1 investor, private).
 * V1 surfaces a read-only preview on the manage detail (POO-277); the reply composer is a follow-up.
 */
export const managerCommentSchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** The investor's display name. */
  author: z.string(),
  /** How much the investor has invested in this strategy, in USD (shown next to the name). */
  investedUsd: z.number().min(0).optional(),
  /** The investor's message. */
  text: z.string(),
  /** Epoch milliseconds of the investor's message. */
  timestamp: z.number().int().positive(),
  /** Whether the thread has an unread investor message (drives the gold dot + "N new"). */
  unread: z.boolean().optional(),
  /** The manager's reply, when present (carries the gold "Manager" badge). */
  reply: z
    .object({
      author: z.string(),
      text: z.string(),
      timestamp: z.number().int().positive(),
    })
    .optional(),
});

/** A manager-side investor comment thread. */
export type ManagerComment = z.infer<typeof managerCommentSchema>;

/** A point on the manage-detail performance chart (PerformanceChart-compatible). */
const manageChartPointSchema = z.object({
  value: z.number(),
  label: z.string(),
  display: z.string().optional(),
  /**
   * The point's raw ISO date, when the series is real (POO-558): lets the view window the chart and
   * pill by calendar time. Absent on date-less mock series (which read the whole series per tab).
   */
  date: z.string().optional(),
});

/**
 * The manage-detail AUM series per selectable chart period, oldest → newest (≥ 2 points each). Named
 * so {@link ManagePeriod} derives from it independently of `performance` being optional (POO-558 R1:
 * the real path leaves the whole object undefined when the analytics series is too short to plot).
 */
const managePerformanceSchema = z.object({
  "7d": z.array(manageChartPointSchema).min(2),
  "30d": z.array(manageChartPointSchema).min(2),
  "90d": z.array(manageChartPointSchema).min(2),
  all: z.array(manageChartPointSchema).min(2),
});

/**
 * Everything the manage-detail view (PP-MGR-SCR-004) needs for one strategy: the list row plus the
 * fixed pool, the live price range, per-period performance, the manager's fee earnings, the latest
 * activity and investor counts. The pool is fixed at creation (only the range ever changes).
 */
export const managerStrategyDetailSchema = managerStrategySchema.extend({
  /**
   * POO-649: the investor-catalog id this managed strategy maps to, so the console share pill can
   * deep-link the PUBLIC strategy page (`/strategies/<publicStrategyId>`) instead of the manager's
   * `detail.id` (a private console id that has no public route → 404).
   * PP-INTEGRATION-POINT: the real backend supplies the true console→catalog mapping; the mock points
   * each managed strategy at a resolvable catalog id.
   */
  publicStrategyId: z.string(),
  /** The fixed Uniswap v3 pool this strategy manages. */
  pool: z.object({
    /** Base token symbol (token0). */
    token0: z.string(),
    /** Quote token symbol (token1). */
    token1: z.string(),
    /** Fee tier in basis points. */
    feeBps: z.number().int().positive(),
    /** Network display name, e.g. "Base". */
    networkName: z.string(),
    /** API network slug (e.g. "base"), needed to build the on-chain move-range. Absent on mock data. */
    network: z.string().optional(),
    /** token0 decimals — needed for price→tick on move-range (POO-310). Absent on mock data. */
    decimals0: z.number().int().min(0).optional(),
    /** token1 decimals — needed for price→tick on move-range (POO-310). Absent on mock data. */
    decimals1: z.number().int().min(0).optional(),
    /** Underlying Uniswap DEX pool address, for the "View on Uniswap" deep link (#8). Absent on mock data. */
    address: z.string().optional(),
    /** The Uniswap v3 position NFT token id (numeric string) for the "View on Uniswap" deep link
     *  (POO-750). Threaded from the v2 catalog (same channel as the logo); absent on v1/mock/closed. */
    nftPositionId: z.string().optional(),
  }),
  /** The current price range. Full-range positions have no bounds. */
  range: z.object({
    /** Whether the position is full range. */
    full: z.boolean(),
    /** Lower bound, token1 per 1 token0 (null when full range). */
    minPrice: z.number().nullable(),
    /** Upper bound, token1 per 1 token0 (null when full range). */
    maxPrice: z.number().nullable(),
    /** Current pool price, token1 per 1 token0. */
    currentPrice: z.number().positive(),
  }),
  /**
   * AUM change as a percentage. POO-558 R2: `number | undefined` — the real path leaves it undefined
   * when there is no analytics series, and the view renders NO pill (never a coerced +0.0%). When a
   * series is present, the view recomputes the pill per selected period (R3); this carried value is
   * the trailing-30d change used as the mock/summary fallback.
   */
  aumChangePct: z.number().optional(),
  /** Lifetime yield generated for this strategy's investors, in USD. */
  yieldGenerated: z.number().min(0),
  /** The manager's lifetime fee earnings from this strategy, in USD. */
  feesAllTime: z.number().min(0),
  /** Trading fees accrued and not yet collected (Collect zeroes this), in USD. */
  claimableFeesUsd: z.number().min(0),
  /**
   * Per-token breakdown of the claimable fees for the manager's "receive as token pair" collect
   * (POO-417 R3/R5). Sourced from the manager's underlying position; absent → manager Collect stays
   * USDC-only (R6c).
   */
  claimableFeeTokens: z.array(claimableFeeTokenSchema).length(2).optional(),
  /**
   * Raw on-chain reserve block of the manager's pool position, threaded from the underlying
   * `Position` (POO-483 v2 R2 / POO-502): the pool position's current reserves (`totalSupply0/1`,
   * raw base units), and the current pool tick. Decimals live on `pool.decimals0/1`. Feeds the
   * client-side value split (`positionTokenSplit`, PP-CORE-LIB-022) that renders the manager
   * Remove/Close liquidity leg and the estimated per-token USD; kept GENERAL (raw strings, not human
   * numbers) so POO-501 Move Range can consume the same block. Real mode only; absent on mock/lean
   * reads → the modal degrades to the honest single USD figure (R4).
   * PP-INTEGRATION-POINT (POO-325): backend-verified per-token USD figures replace the client
   * estimate when they land; this block stays as the cross-check source.
   */
  totalSupply0: z.string().optional(),
  totalSupply1: z.string().optional(),
  tickCurrent: z.number().int().optional(),
  /** Flat gas estimate for a manage action on this pool's network, in USD (the manager pays gas). */
  gasEstimateUsd: z.number().min(0),
  /** The manager's own stake in this strategy, in USD — drives the remove-liquidity preview (POO-312). */
  managerStakeUsd: z.number().min(0).optional(),
  /** Whether the strategy is listed on the investor Explore (the manager's discovery choice). */
  showInExplore: z.boolean(),
  /**
   * AUM series per selectable chart period, oldest → newest (≥ 2 points each). POO-558 R1:
   * `undefined` on the real path when the analytics series has <2 points — the view then renders the
   * explicit no-history state instead of a fabricated flat line. Always present in mock mode.
   */
  performance: managePerformanceSchema.optional(),
  /** Latest events, newest first. */
  activity: z.array(managerActivityEventSchema),
  /**
   * Deployed-capital allocation across protocols and tokens (manage-detail Allocation card, POO-361
   * follow-up). PP-MOCK until the indexer serves it; optional so lean/legacy payloads stay valid.
   */
  allocation: managerAllocationSchema.optional(),
  /** Latest investor comment threads — read-only preview in V1 (POO-277). Optional. */
  comments: z.array(managerCommentSchema).optional(),
  /** Total comment count for the "View all (N)" link; defaults to the preview length. Optional. */
  commentsTotal: z.number().int().min(0).optional(),
  /** Investor counts (read-only in V1). */
  investorStats: z.object({
    /** Investors who have ever invested. */
    total: z.number().int().min(0),
    /** Investors currently invested. */
    active: z.number().int().min(0),
  }),
});

/** The manage-detail payload for one manager strategy. */
export type ManagerStrategyDetail = z.infer<typeof managerStrategyDetailSchema>;

/** The selectable periods on the manage-detail performance chart. */
export type ManagePeriod = keyof z.infer<typeof managePerformanceSchema>;

/**
 * A manager's live Uniswap v3 position — the operate surface (PP-MGR-SCR-005). Capital is always
 * 100% deployed in V1; `inRange` is derived from `currentPrice` against the range bounds.
 */
export const managerPositionSchema = z.object({
  /** The strategy this position belongs to ({@link ManagerStrategy} id). */
  strategyId: z.string(),
  /** Network display name, e.g. "Base". */
  networkName: z.string(),
  /** Base token symbol (token0), e.g. "ETH". */
  token0: z.string(),
  /** Quote token symbol (token1), e.g. "USDC". */
  token1: z.string(),
  /** Fee tier in basis points: 1 (0.01%), 5 (0.05%), 30 (0.30%), 100 (1.00%). */
  feeBps: z.number().int().positive(),
  /** Current pool price: token1 per 1 token0. */
  currentPrice: z.number().positive(),
  /** Lower bound of the position's price range (token1 per token0). */
  rangeMin: z.number().positive(),
  /** Upper bound of the position's price range. */
  rangeMax: z.number().positive(),
  /** Deployed liquidity value, in USD. */
  liquidityUsd: z.number().min(0),
  /** Uncollected trading fees available to collect or compound, in USD. */
  uncollectedFeesUsd: z.number().min(0),
  /** Trailing fee APR for the position, as a percent. */
  feeAprPct: z.number().min(0),
  /** Estimated network gas for an on-chain action (the manager pays gas), in USD. */
  gasCostUsd: z.number().min(0),
});

/** A manager's live Uniswap v3 position. */
export type ManagerPosition = z.infer<typeof managerPositionSchema>;

/**
 * A Uniswap v3 pool a manager can build a strategy on. The catalog is permissionless (any pool / any
 * pair); the builder surfaces the pair, fee tier, liquidity and current price for the range picker.
 */
export const uniswapPoolSchema = z.object({
  /** Stable unique identifier. */
  id: z.string(),
  /** Network id, e.g. "base". */
  network: z.string(),
  /** Network display name, e.g. "Base". */
  networkName: z.string(),
  /** Base token symbol (token0), e.g. "ETH". */
  token0: z.string(),
  /** Quote token symbol (token1), e.g. "USDC". */
  token1: z.string(),
  /** Fee tier in basis points: 1 (0.01%), 5 (0.05%), 30 (0.30%), 100 (1.00%). */
  feeBps: z.number().int().positive(),
  /** Raw Uniswap fee tier (hundredths of a bip, e.g. 500/3000/10000), sent verbatim to create-pool
   * to avoid the lossy feeBps round-trip. Absent on mock data → derived from feeBps. */
  feeTier: z.number().int().positive().optional(),
  /** Total value locked in the pool, in USD. */
  tvlUsd: z.number().min(0),
  /** Trailing fee APR for the pool, as a percentage. */
  aprPct: z.number().min(0),
  /** Current price: token1 per 1 token0 (the range picker centers on this). */
  currentPrice: z.number().positive(),
  /** Pool contract address (searchable in the builder). */
  address: z.string(),
  /** token0 contract address (searchable in the builder). */
  token0Address: z.string(),
  /** token1 contract address (searchable in the builder). */
  token1Address: z.string(),
  /** Per-token USD prices (from the dex-pools API base/quote prices) — used to value the create-pool
   *  seed against the USD minimum. Absent on mock data or when the API omits them. */
  token0PriceUsd: z.number().positive().optional(),
  token1PriceUsd: z.number().positive().optional(),
  /** token0 / token1 decimals (from the dex-pools API). Enable the exact on-chain usable-tick snap in
   *  the builder range UI (POO-408); absent on mock data, where the snap uses the relative grid. */
  decimals0: z.number().int().min(0).optional(),
  decimals1: z.number().int().min(0).optional(),
});

/** A Uniswap v3 pool in the manager's pool catalog. */
export type UniswapPool = z.infer<typeof uniswapPoolSchema>;

/**
 * The four fees a manager sets on a strategy (V1 Review step). Entry / exit / management are
 * uncapped percentages; the performance fee is a share of the LP fees the strategy generates,
 * bounded 5–90%. Performance is charged on fees generated, so there is NO high-water mark.
 */
export const strategyFeesSchema = z.object({
  /** One-off fee on deposits, as a percent (≥ 0, uncapped). */
  entryPct: z.number().min(0),
  /** One-off fee on withdrawals, as a percent (≥ 0, uncapped). */
  exitPct: z.number().min(0),
  /** Annual management fee, as a percent (≥ 0, uncapped). */
  managementPct: z.number().min(0),
  /** Performance fee as a share of generated LP fees, 10–90% (no high-water mark). */
  performancePct: z.number().min(10).max(90),
});

/** The fees a manager charges on a strategy. */
export type StrategyFees = z.infer<typeof strategyFeesSchema>;

/**
 * The Pool Party platform cut shown on the builder's Review step. The cut is a share of the
 * manager's performance fee, tiered by the manager's AUM (it lowers as AUM grows). Sourced from the
 * backend (mocked today).
 */
export const feePolicySchema = z.object({
  /** Pool Party's cut, as a percent of the manager's performance fee (0–100). */
  platformCutPct: z.number().min(0).max(100),
  /** Human label for the manager's current AUM tier, e.g. "Under $1M AUM". */
  tierLabel: z.string(),
});

/** The Pool Party platform fee policy (AUM-tiered cut). */
export type FeePolicy = z.infer<typeof feePolicySchema>;

/** How investors access a strategy. V1 ships `public` only; the rest are reserved (behind a flag). */
export const strategyAccessSchema = z.enum(["public", "allowlist", "nft", "password"]);

/** A strategy's access model. */
export type StrategyAccess = z.infer<typeof strategyAccessSchema>;

/**
 * A manager's public profile (/m/<handle>): the identity + headline stats shown to investors, and
 * what the manager edits in the console. The manager's strategies are looked up separately by handle.
 * Mocked today; PP-INTEGRATION-POINT: the OAMS manager registry.
 */
/**
 * A manager's public social links (unset = hidden on the profile). POO-579: mirrors the deployed
 * registry columns exactly (x/telegram/discord/youtube/website) — NO instagram, which the backend does
 * not persist (a link there would be silently stripped). Backend Instagram support is a separate
 * product/schema decision (POO-593 note). PP-TODO(POO-748): the console profile form shows a disabled
 * "coming soon" Instagram field (display-only, nothing persisted); add `instagram` here when the
 * backend column lands (POO-747).
 */
export const managerSocialsSchema = z.object({
  /** X profile URL. */
  x: z.string().optional(),
  /** Telegram channel / group URL. */
  telegram: z.string().optional(),
  /** Discord server invite URL. */
  discord: z.string().optional(),
  /** YouTube channel URL. */
  youtube: z.string().optional(),
  /** Personal / fund website URL. */
  website: z.string().optional(),
});

/** A manager's public social links. */
export type ManagerSocials = z.infer<typeof managerSocialsSchema>;

/**
 * POO-745: the manager's account-verification lifecycle (the code-DM model, POO-744). `none` = never
 * requested; `pending` = a request is in flight (the manager has been issued a one-time code to DM);
 * `valid` = verified, which drives the public verified badge — the SOLE badge source (POO-809 removed
 * the legacy `verified` boolean; the admin-queue model {@link managerVerificationRequestSchema} now
 * sets this enum to `valid` on approval). Distinct from `managerVerificationRequestSchema` (the
 * admin-queue request shape). Exposed on the manager profile read (public projection — a status, not
 * the secret code).
 */
export const managerVerificationStatusSchema = z.enum(["none", "pending", "valid"]);

/** A manager's account-verification status (POO-745). */
export type ManagerVerificationStatus = z.infer<typeof managerVerificationStatusSchema>;

export const managerProfileSchema = z.object({
  /** URL handle, e.g. "carlos" → /m/carlos. */
  handle: z.string(),
  /**
   * POO-575: whether the handle is fixed. It is editable until the manager saves a valid handle the
   * first time, then locks (`true`) and renders read-only. Optional/absent is treated as unlocked by
   * the UI (`handleLocked === true` gates read-only). PP-INTEGRATION-POINT (POO-576): the real
   * lock/lifecycle lives in the backend manager-profile registry.
   */
  handleLocked: z.boolean().optional(),
  /**
   * The manager's wallet address (EVM). Drives the masked-address display-name fallback and lets the
   * public profile be addressed by `/m/<address>` before a handle exists. Optional.
   * PP-INTEGRATION-POINT: sourced from the manager-profile DB (Rafael, POO-576 / POO-579).
   */
  address: z.string().optional(),
  /** Display name. May be empty for an unfilled manager (the UI falls back to the masked address). */
  name: z.string(),
  /** Optional avatar / logo URL; the UI falls back to initials. */
  avatarUrl: z.string().optional(),
  /** Short bio shown under the name. */
  bio: z.string(),
  /**
   * POO-745: account-verification status (code-DM model, POO-744). `valid` drives the public verified
   * badge — the SOLE badge source since POO-809 removed the legacy `verified` boolean. Read from the
   * profile projection; the one-time code is NEVER on this read (secret — only on the
   * request-verification response). Tolerant default `none` when the API/mocks omit it.
   */
  managerVerification: managerVerificationStatusSchema,
  /** Human "managing since" label, e.g. "Since 2024". */
  sinceLabel: z.string(),
  /** Optional banner image URL (YouTube-style channel art: 16:9 upload, wide crop, never stretched). */
  bannerUrl: z.string().optional(),
  /** Public social links, rendered as logo chips (unset links are hidden). */
  socials: managerSocialsSchema,
  /** Headline stats shown on the profile. */
  stats: z.object({
    /** Assets under management across the manager's strategies, in USD. */
    aum: z.number().min(0),
    /** Total investors. */
    investors: z.number().int().min(0),
    /** Number of public strategies. */
    strategies: z.number().int().min(0),
    /** Blended average APY, as a percentage. */
    avgApy: z.number(),
  }),
});

/** A manager's public profile. */
export type ManagerProfile = z.infer<typeof managerProfileSchema>;

/**
 * A manager's verification request lifecycle (POO-587). The public badge is
 * {@link ManagerProfile.managerVerification}; approving a `pending` request sets it to `valid`
 * (POO-809 removed the legacy `verified` boolean). `pending` requests populate the admin
 * Operations > Managers queue. Managed by the verification service.
 */
export const managerVerificationRequestSchema = z.object({
  /** Manager handle the request belongs to. */
  managerHandle: z.string(),
  /** Display name (denormalized for the admin queue row). */
  managerName: z.string(),
  /** Optional avatar for the queue row (falls back to initials). */
  avatarUrl: z.string().optional(),
  /** Request state; `pending` requests populate the admin queue. */
  status: z.enum(["pending", "approved", "rejected"]),
  /** ISO timestamp when the manager submitted the request. */
  submittedAt: z.string(),
  /** ISO timestamp of the admin decision, when decided. */
  reviewedAt: z.string().optional(),
  /** Identifier (email) of the admin who decided. */
  reviewedBy: z.string().optional(),
  /** Optional reason recorded on rejection. */
  reason: z.string().optional(),
  /** AUM context shown in the admin queue, in USD. */
  aum: z.number().min(0),
  /** Strategy-count context shown in the admin queue. */
  strategyCount: z.number().int().min(0),
});

/** A manager's verification request. */
export type ManagerVerificationRequest = z.infer<typeof managerVerificationRequestSchema>;

/**
 * An uploaded image in the Admin Console moderation queue (POO-590). Post-publication: images are
 * live on upload; the queue is for review/removal. `removed` is a soft-hide (reversible, reason
 * logged) — nothing is hard-deleted.
 */
export const moderationImageSchema = z.object({
  /** Stable moderation-item id. */
  id: z.string(),
  /** Which surface the image belongs to. */
  kind: z.enum(["strategy", "manager-avatar", "manager-banner"]),
  /** Image URL; absent until real image hosting lands (POO-580) — the UI shows a placeholder. */
  imageUrl: z.string().optional(),
  /** The strategy id or manager handle the image belongs to. */
  subjectId: z.string(),
  /** Display name of the subject (strategy name / manager name). */
  subjectName: z.string(),
  /** ISO timestamp of the upload. */
  uploadedAt: z.string(),
  /** Review state; `pending` items populate the queue. */
  status: z.enum(["pending", "approved", "removed"]),
  /** ISO timestamp of the admin decision, when decided. */
  reviewedAt: z.string().optional(),
  /** Identifier (email) of the admin who decided. */
  reviewedBy: z.string().optional(),
  /** Optional reason recorded on a soft-hide removal. */
  removedReason: z.string().optional(),
});

/** An image in the moderation queue. */
export type ModerationImage = z.infer<typeof moderationImageSchema>;

/**
 * The authenticated investor's profile (identity + referral summary) shown across the Profile area
 * (PP-PROF-SCR-001/002) and the Home/Console greeting. PII-shaped: private `name`, public `displayName`,
 * email, username, country, phone. The editable subset (`name` / `displayName` / `email` / `country`) is
 * optional-by-value (an empty string is allowed — the Personal-info form lets a user clear them), so those
 * are plain strings, not `.email()`/required. Referral + `quacks` + `isManager` round out the identity.
 * POO-693 split the single `name` into the PRIVATE comms-only `name` and the PUBLIC `displayName`.
 *
 * PP-INTEGRATION-POINT (POO-222 [R7] / POO-426): the real shape comes from the authenticated backend
 * identity endpoint (`GET /me` on `PP_API_URL`, wallet from the SIWE session) and may additionally
 * carry fields such as date-of-birth, mapped when wired.
 */
export const profileUserSchema = z.object({
  /**
   * Private comms-only name (POO-693): owner-projection + PATCH only, never shown publicly and never on
   * the public read. Editable; may be empty. Was the single `name` field before POO-693 split it from the
   * public `displayName`.
   */
  name: z.string(),
  /**
   * Public display name (POO-693): shown publicly on the profile / greeting; the backend masks the
   * default to the wallet address. Editable; may be empty. Feeds the avatar `initial`.
   */
  displayName: z.string(),
  /** Email address (editable; may be empty). */
  email: z.string(),
  /** Whether the email is verified. */
  emailVerified: z.boolean(),
  /** Handle without the leading `@`. */
  username: z.string(),
  /** Single-letter avatar fallback (shown when there is no `avatar`). */
  initial: z.string(),
  /** Avatar image URL (editable via upload; empty when unset — the UI falls back to `initial`). */
  avatar: z.string(),
  /** Country (editable). */
  country: z.string(),
  /** Phone number. */
  phone: z.string(),
  /** Referral invite code. */
  referralCode: z.string(),
  /** Friends who joined via the referral; non-negative integer. */
  referralJoined: z.number().int().min(0),
  /** Total referral earnings in USD; non-negative. */
  referralEarned: z.number().min(0),
  /** Quacks balance (Rubber Rush), shown on the desktop identity aside; non-negative integer. */
  quacks: z.number().int().min(0),
  /** Whether the user manages strategies (drives the conditional Manager row). */
  isManager: z.boolean(),
});

/** A Pool Party investor's profile (identity + referral summary). */
export type ProfileUser = z.infer<typeof profileUserSchema>;
