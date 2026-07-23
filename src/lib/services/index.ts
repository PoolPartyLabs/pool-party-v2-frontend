/**
 * @id PP-CORE-MCK-004
 * @name service factory
 * @implements-rules-version v1
 *
 * Single switch point between mock and real service implementations for the investor app.
 * Reads `process.env.NEXT_PUBLIC_MOCK_MODE` (unset is treated as mock mode) and exports one
 * instance per domain service (tokens, strategies, positions, savings, transactions) plus auth.
 * Mock services read the static fixtures in `@/mocks/data`; each export carries a
 * `// PP-INTEGRATION-POINT` comment describing the real replacement (indexer / OAMS contracts /
 * RPC / Privy) so the cutover is mechanical.
 */

import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
  type AdminRole,
  DEFAULT_ROLE_CAPABILITIES,
  type RoleCapabilityMapping,
} from "@/lib/admin/rbac";
import type { VerificationRequestResult } from "@/lib/manager/verification/managerVerificationSchema";
import { generateVerificationCode } from "@/lib/manager/verification/verificationCode";
import type {
  CardOffer,
  CardTransaction,
  FeePolicy,
  ManagerDashboard,
  ManagerIncentiveProgram,
  ManagerPosition,
  ManagerProfile,
  ManagerSocials,
  ManagerStrategy,
  ManagerStrategyDetail,
  ManagerVerificationRequest,
  ModerationImage,
  OwnedCard,
  Position,
  PositionEarnings,
  ProfileUser,
  ReferralProgram,
  RubberRush,
  SavingsMarket,
  Strategy,
  StrategyAccess,
  StrategyFees,
  Token,
  Transaction,
  UniswapPool,
} from "@/lib/schemas";
import { deriveAssetTagsForPair } from "@/lib/strategies/tags/deriveAssetTags";
import { referralUrl } from "@/lib/urls";
import { isEvmAddress, maskAddress } from "@/lib/utils/address";
import { getRangeStatus } from "@/lib/utils/rangeStatus";
import { cardOffers, cardTransactions, ownedCards } from "@/mocks/data/cards";
import {
  managerDashboard,
  managerFeePolicy,
  managerPosition,
  managerProfiles,
  managerStrategyDetails,
} from "@/mocks/data/manager";
import { moderationImages } from "@/mocks/data/moderation";
import { uniswapPools } from "@/mocks/data/pools";
import { exitedPositions, positionEarnings, positions } from "@/mocks/data/positions";
import { mockProfileUser } from "@/mocks/data/profile";
import { managerIncentiveProgram, referral, rubberRush } from "@/mocks/data/rewards";
import { strategies } from "@/mocks/data/strategies";
import { tokens } from "@/mocks/data/tokens";
import { transactions } from "@/mocks/data/transactions";
import { managerVerificationRequests } from "@/mocks/data/verification";

/**
 * `true` when the app should use mock services. Mock mode is the default: it is enabled when
 * `NEXT_PUBLIC_MOCK_MODE` is unset (e.g. local dev, tests, Storybook) or explicitly set to
 * `"true"`. Any other value (e.g. `"false"`) opts into the real implementations.
 */
export const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE !== "false";

/** Reads the catalog of supported on-chain tokens. */
export interface TokenService {
  /** List every token the app supports (e.g. USDC) across configured chains. */
  list(): Promise<Token[]>;
}

/** Reads the catalog of managed investment strategies. */
export interface StrategyService {
  /** List every strategy an investor can allocate into (discovery — excludes closed). */
  list(): Promise<Strategy[]>;
  /**
   * List every strategy regardless of status, including closed — for resolving a strategy a wallet
   * already holds or manages. Discovery uses {@link StrategyService.list}; holdings resolution uses
   * this so a closed position never drops out of the Portfolio / manager console (POO-455).
   */
  listAll(): Promise<Strategy[]>;
  /** Fetch a single strategy by id, or `null` when it does not exist. */
  getById(id: string): Promise<Strategy | null>;
}

/** Reads the current investor's positions. */
export interface PositionService {
  /** List the investor's positions across all strategies. */
  list(): Promise<Position[]>;
  /**
   * Fully-exited (already-withdrawn) closed positions — the Portfolio "Show closed strategies"
   * history (POO-460). Kept out of {@link PositionService.list} and served on demand. Real mode
   * reads `/portfolio/:wallet/all?closed=exited` instead.
   */
  listExited(): Promise<Position[]>;
  /**
   * Net amount earned by a position (fees + yield) over each share period (24h / 7d / 30d), in
   * USD. Feeds the share-yield card (PP-STR-MOD-009); values can be negative (loss).
   */
  getEarnings(positionId: string): Promise<PositionEarnings>;
}

/** Reads the connected wallet's spendable balance. */
export interface AccountService {
  /**
   * The investor's spendable USDC balance on `chainId`, in USD (1 USDC ≈ $1), at full token
   * precision. An operation settles on a single chain, so the balance is read per-network on the
   * operation's chain (POO-303); omit `chainId` for the mock. A bridge step adds cross-network funds
   * later. PP-INTEGRATION-POINT: cross-network spendable balance (zap/bridge).
   */
  getUsdcBalance(chainId?: number): Promise<number>;
  /**
   * The kind of wallet backing the session: an in-app `embedded` (Privy) wallet provisioned on
   * Google sign-in, or an `external` wallet the user connected (e.g. MetaMask). External-wallet
   * holders already control their crypto, so the in-app crypto-deposit (receive-to-address) flow is
   * hidden for them.
   */
  getWalletKind(): Promise<"embedded" | "external">;
}

/** Reads the available savings (lending) markets. */
export interface SavingsService {
  /** List every savings market the investor can deposit into. */
  list(): Promise<SavingsMarket[]>;
}

/** Reads the investor's historical transaction feed. */
export interface TransactionService {
  /** List the investor's transactions, most-recent-first by convention. */
  list(): Promise<Transaction[]>;
}

/** Result of the daily Say Quack check-in. */
export interface SayQuackResult {
  /** Quacks awarded by today's check-in. */
  quacksAwarded: number;
  /** Always `true` once the check-in is done. */
  quackedToday: true;
}

/** Result of one Duck Shoot try. */
export interface DuckShootResult {
  /** Index of the duck / target hit (0-based). */
  hitIndex: number;
  /** The multiplier won, in percent. */
  multiplierPct: number;
  /** Quacks awarded by the boost. */
  quacksWon: number;
  /** Tries remaining after this shot. */
  triesLeft: number;
}

/** Result of claiming the current tier's community roles. */
export interface ClaimRolesResult {
  /** Always `true` once claimed. */
  claimed: true;
  /** The roles granted. */
  roles: string[];
}

/** Reads the investor's rewards dashboards and runs the Rubber Rush actions. */
export interface RewardsService {
  /** The Rubber Rush rewards dashboard (Quacks, tier, streak, referral). */
  getRubberRush(): Promise<RubberRush>;
  /** The ManagerIncentiveProgram rewards dashboard (revenue, managed TVL, tier ladder, goals). */
  getManagerIncentiveProgram(): Promise<ManagerIncentiveProgram>;
  /** The referral / "invite & earn" program (give-get reward + invited friends). */
  getReferral(): Promise<ReferralProgram>;
  /**
   * Create the user's referral code — one-time and IMMUTABLE (POO-290 R2). Rejects when a code
   * already exists or the candidate isn't 6–10 alphanumerics (stored as typed; POO-853 [R2] caps at
   * 10 to match the pp-api validator).
   */
  createReferralCode(code: string): Promise<ReferralProgram>;
  /** Daily Say Quack check-in: signs once per day and awards Quacks. */
  sayQuack(): Promise<SayQuackResult>;
  /** Play one Duck Shoot try: hits a target and returns the won multiplier + boost. */
  playDuckShoot(): Promise<DuckShootResult>;
  /** Claim the community roles unlocked by the current tier. */
  claimRoles(): Promise<ClaimRolesResult>;
}

/** A manager's new-strategy submission from the builder's Review step. */
export interface CreateStrategyInput {
  /** Strategy display name. */
  name: string;
  /**
   * Optional plain-language description of the strategy's thesis (max 280 chars), POO-278 [R5].
   * Surfaces to investors as the prospectus "about" once the strategy is listed.
   */
  description: string | null;
  /** Optional manager-uploaded logo (data / remote URL). */
  logoUrl: string | null;
  /** The chosen Uniswap v3 pool id. */
  poolId: string;
  /** Auto-derived risk level (1–5). */
  riskLevel: 1 | 2 | 3 | 4 | 5;
  /** Auto-derived, already-localized category label. */
  category: string;
  /** Estimated APY for the listing, as a percent (from the pool's fee APR). */
  estApyPct: number;
  /** Chosen price range — full range, or an explicit min/max. */
  range: { full: boolean; minPrice: number | null; maxPrice: number | null };
  /** The manager-set fees. */
  fees: StrategyFees;
  /** Access model (V1: `public`). */
  access: StrategyAccess;
  /** Save as a draft instead of launching. */
  asDraft: boolean;
}

/** Result of creating a strategy: the listed/draft row + the auto-verification outcome. */
export interface CreateStrategyResult {
  /** The created strategy row (`draft` when saved as a draft, else `active`). */
  strategy: ManagerStrategy;
  /** Automatic verification outcome (pool exists + params valid). */
  verification: {
    /** `verified` lists the strategy immediately; `failed` blocks the launch. */
    status: "verified" | "failed";
    /** Internal-only risk flags — never shown to investors (general disclaimer only). */
    riskFlags: string[];
  };
}

/** Result of collecting a position's uncollected trading fees. */
export interface CollectFeesResult {
  /** Fees collected to the manager's balance, in USD. */
  collectedUsd: number;
  /** Network gas paid for the action, in USD. */
  gasCostUsd: number;
}

/** Result of compounding a position's uncollected fees back into the position. */
export interface CompoundResult {
  /** Fees reinvested into the position, in USD. */
  compoundedUsd: number;
  /** Network gas paid for the action, in USD. */
  gasCostUsd: number;
}

/** A manager's request to move a position's price range. */
export interface MoveRangeInput {
  /** New lower bound (token1 per token0). */
  rangeMin: number;
  /** New upper bound (token1 per token0). */
  rangeMax: number;
  /**
   * Full-range move (POO-518 R1): the bounds above then carry the prices derived from the widest
   * usable ticks (`fullRangePrices`, POO-394), not a manager-entered band.
   */
  full?: boolean;
  /** Max slippage tolerance for the rebalance, in percent (within the platform cap). */
  slippagePct: number;
}

/** Result of moving a position's range. */
export interface MoveRangeResult {
  /** The applied lower bound. */
  rangeMin: number;
  /** The applied upper bound. */
  rangeMax: number;
  /**
   * Whether the applied range is full-range (POO-518 R1). The bounds above then are the
   * fullRangeTicks-derived prices, and range surfaces render their full-range representation.
   */
  full: boolean;
  /** Network gas paid for the action, in USD. */
  gasCostUsd: number;
}

/** Reads the authenticated manager's console data and creates strategies from the builder. */
export interface ManagerService {
  /** The manager's dashboard overview (AUM, KPIs, AUM-over-time chart). */
  getDashboard(): Promise<ManagerDashboard>;
  /** List the strategies created by this manager. */
  listStrategies(): Promise<ManagerStrategy[]>;
  /** The Pool Party fee policy (AUM-tiered platform cut) shown on the Review step. */
  getFeePolicy(): Promise<FeePolicy>;
  /**
   * Create a strategy from the builder. Runs automatic verification (pool exists + params valid) and,
   * when verified, lists it immediately; `asDraft` saves a draft instead.
   */
  createStrategy(input: CreateStrategyInput): Promise<CreateStrategyResult>;
  /** The manager's live position for a strategy (the operate surface), or `null` if none. */
  getPosition(strategyId: string): Promise<ManagerPosition | null>;
  /** Collect a strategy's uncollected trading fees to the manager's balance (manager pays gas). */
  collectFees(strategyId: string): Promise<CollectFeesResult>;
  /** Compound a position's uncollected fees back into the position (manager pays gas). */
  compound(strategyId: string): Promise<CompoundResult>;
  /** Move a position's price range (re-center or custom), paying gas; returns the applied range. */
  moveRange(strategyId: string, input: MoveRangeInput): Promise<MoveRangeResult>;
  /** The manage-detail payload for one of the manager's strategies, or `null` when unknown. */
  getStrategyDetail(strategyId: string): Promise<ManagerStrategyDetail | null>;
  /** Set whether the strategy is listed on the investor Explore (the manager's discovery choice). */
  setShowInExplore(strategyId: string, visible: boolean): Promise<ManagerStrategyDetail>;
  /** Pause (true) or resume (false) NEW deposits only — the position and withdrawals continue. */
  setDepositsPaused(strategyId: string, paused: boolean): Promise<ManagerStrategyDetail>;
  /** Soft-close the strategy: freezes deposits; investors withdraw whenever (instant, no fee). */
  closeStrategy(strategyId: string): Promise<ManagerStrategyDetail>;
  /**
   * A manager's public profile by handle OR wallet address (POO-618), or `null` when none matches.
   * A handle record wins; an EVM address matches the profile's `address` (case-insensitive).
   */
  getProfile(handleOrAddress: string): Promise<ManagerProfile | null>;
  /**
   * POO-575 R5 / POO-659 R4: whether `handle` is free to claim, excluding the caller's own entry
   * (`selfId` = the manager's stable id — the lowercased address when present, else the handle). Mock
   * scans the local profile map; real mode hits the backend registry (POO-576).
   */
  isHandleAvailable(handle: string, selfId?: string): Promise<boolean>;
  /**
   * Update the authenticated manager's public profile (mock: in-session state only). POO-659: `id` is
   * the manager's stable id — the wallet address when present, else the handle.
   */
  updateProfile(id: string, input: UpdateManagerProfileInput): Promise<ManagerProfile>;
  /**
   * POO-745: self-request account verification (code-DM model, POO-744). From `none` it mints a
   * one-time code, moves the manager to `pending` and returns `{ status, code, message }`. On `pending`
   * it is IDEMPOTENT — the SAME code, no regeneration. Throws when already `valid`. `id` = the stable
   * id. Real mode goes through the signed `requestManagerVerificationAction`, not this mock.
   */
  requestVerification(id: string): Promise<VerificationRequestResult>;
}

/**
 * Manager verification lifecycle (POO-587): a manager self-requests, an admin reviews. Shared by the
 * manager console (request/status) and the Admin Console queue (list/approve/reject).
 */
export interface VerificationService {
  /**
   * The current verification request for a manager, or `null` when none exists. POO-659: `id` is the
   * manager's stable id (address when present, else handle) — the same key `requestVerification` used.
   */
  getRequest(id: string): Promise<ManagerVerificationRequest | null>;
  /**
   * Manager self-requests verification. From `unverified`/`rejected` (or no request) it creates a
   * `pending` request; throws when already verified or already pending. `id` = the manager's stable id.
   */
  requestVerification(id: string): Promise<ManagerVerificationRequest>;
  /** The admin queue: every `pending` request. */
  listPending(): Promise<ManagerVerificationRequest[]>;
  /**
   * Approve a `pending` request → `approved` + sets the manager's `managerVerification` to `valid`
   * (the sole badge source since POO-809). `id` is the request's `managerHandle` (the queue row's key).
   */
  approve(id: string, reviewer: string): Promise<ManagerVerificationRequest>;
  /** Reject a `pending` request → `rejected` (the badge stays off), with an optional reason. */
  reject(id: string, reviewer: string, reason?: string): Promise<ManagerVerificationRequest>;
}

/**
 * Image moderation for the Admin Console (POO-590). Post-publication queue over uploaded images
 * (strategy / manager avatar / manager banner): review-keep (approve) or soft-hide (remove).
 */
export interface ModerationService {
  /** The queue: images with status `pending`. */
  listQueue(): Promise<ModerationImage[]>;
  /** Approve a pending image → `approved` (reviewed-keep; leaves the queue). */
  approve(id: string, reviewer: string): Promise<ModerationImage>;
  /** Remove (soft-hide) a pending image → `removed`, reversible, with an optional reason. */
  remove(id: string, reviewer: string, reason?: string): Promise<ModerationImage>;
}

/** Reads + edits the role→capability mapping (the master Roles & Permissions page, POO-591). */
export interface RbacService {
  /** The current role→capability mapping. */
  getRoleCapabilities(): Promise<RoleCapabilityMapping>;
  /**
   * Grant or revoke a capability for a role. Rejects editing `master` or granting a `masterOnly`
   * capability to operator/admin. Returns the updated mapping.
   */
  setRoleCapability(
    role: AdminRole,
    capability: AdminCapability,
    granted: boolean,
  ): Promise<RoleCapabilityMapping>;
}

/** Editable fields of the manager's public profile (the console Profile tab). */
export interface UpdateManagerProfileInput {
  /** Display name. */
  name?: string;
  /** Short bio shown under the name. */
  bio?: string;
  /** Avatar image URL (data / remote) from the crop tool. */
  avatarUrl?: string;
  /** Banner image URL (data / remote) from the crop tool. */
  bannerUrl?: string;
  /** Public social links; pass the full object (unset keys clear the link). */
  socials?: ManagerSocials;
  /**
   * POO-575 R6: the chosen handle, sent ONLY on the first save while the profile is still unlocked.
   * When present and the current profile is not locked, the mock re-keys the entry to this handle and
   * sets `handleLocked: true`. Ignored once locked (rename is out of scope). `updateProfile` is keyed
   * by the OLD handle, so this threads the new one in the payload.
   */
  handle?: string;
  /**
   * POO-575 R6: request to lock the handle on this save. The client sends `true` alongside `handle`
   * on the first save; the mock also derives the lock from the transition, so this is advisory.
   */
  handleLocked?: boolean;
}

/** Reads the catalog of Uniswap v3 pools a manager can build a strategy on. */
export interface PoolService {
  /** List the available Uniswap v3 pools across the supported networks. */
  list(): Promise<UniswapPool[]>;
}

/** Referral handoff result: a partner card was requested → the user continues at the partner. */
export interface RequestCardResult {
  /** The partner that was requested. */
  partnerId: string;
  /** Always `"requested"` — issuance + KYC continue at the partner. */
  status: "requested";
  /** Partner onboarding URL to hand the user off to. */
  onboardingUrl: string;
}

/** Input to a card top-up (rechargeable balance). */
export interface TopUpInput {
  /** The held card to fund. */
  cardId: string;
  /** Amount to add, in USD. */
  amountUsd: number;
  /** Where the funds come from. */
  source: "wallet" | "portfolio";
}

/** Result of a card top-up: the new spendable balance. */
export interface TopUpResult {
  /** The funded card. */
  cardId: string;
  /** Amount added, in USD. */
  amountUsd: number;
  /** New spendable balance after the top-up, in USD. */
  newBalanceUsd: number;
}

/**
 * Cards marketplace + the investor's held cards. Pool Party is a marketplace + referral, not an
 * issuer: `requestCard` hands off to the partner; funding is a rechargeable balance (`topUp`).
 */
export interface CardsService {
  /** List the partner card offers for the Explore marketplace. */
  getCatalog(): Promise<CardOffer[]>;
  /** List the cards the investor holds (My cards). */
  getMyCards(): Promise<OwnedCard[]>;
  /** List a held card's transactions, most-recent-first. */
  getTransactions(cardId: string): Promise<CardTransaction[]>;
  /** Request a partner card → referral handoff to the partner's onboarding. */
  requestCard(partnerId: string): Promise<RequestCardResult>;
  /** Top up a held card's rechargeable balance from wallet / portfolio. */
  topUp(input: TopUpInput): Promise<TopUpResult>;
}

/**
 * A minimal authenticated session. The real shape is owned by Privy; the mock keeps just enough
 * for the UI flow (which persona, which provisioning path) to behave correctly.
 */
export interface Session {
  /** Opaque user identifier. */
  userId: string;
  /** How the session was created. */
  method: "google" | "wallet";
  /** Embedded (Privy) or connected (external) wallet address. */
  address: string;
  /** True when an embedded wallet was provisioned this session (Maria's first run → Wallet ready). */
  isNewWallet: boolean;
}

/** Authentication + wallet provisioning. Privy in production; deterministic mock today. */
export interface AuthService {
  /** Sign in with Google → provisions/loads a Privy embedded wallet (Maria). */
  loginWithGoogle(): Promise<Session>;
  /** Connect an external wallet by connector id, e.g. "metamask" (Carlos). */
  connectWallet(connectorId: string): Promise<Session>;
  /** Clear the current session. */
  logout(): Promise<void>;
}

/**
 * The editable subset of the investor profile this session can change (POO-222 [R3]): private Name +
 * public Display name (POO-693) + Email (POO-356) + Country (POO-410) + Phone (POO-675). All optional; an
 * omitted key leaves the stored field untouched, an empty patch is a no-op. A blank string on
 * name/displayName/email/country/phone is a real edit (clear the field), forwarded to the backend as ""
 * (POO-675/POO-693), not omitted.
 */
export interface ProfilePatch {
  /** New private comms-only name ("" clears it) (POO-693). */
  name?: string;
  /** New public display name ("" clears it) (POO-693). */
  displayName?: string;
  /** New email address ("" clears it). */
  email?: string;
  /** New country ("" clears it). */
  country?: string;
  /** New phone number ("" clears it) (POO-675). */
  phone?: string;
  /**
   * New avatar image URL — a trusted https CDN URL minted by the POO-580 media upload. Staged after a
   * successful upload; the write forwards it to the backend only when https (see `buildProfileWriteBody`).
   */
  avatarUrl?: string;
}

/** Reads + edits the authenticated investor's profile identity (POO-222). */
export interface ProfileService {
  /** The current session profile (identity + referral summary), as a structural clone. */
  get(): Promise<ProfileUser>;
  /** Persist the editable subset (name/email/country/phone) for the session; returns the updated clone. */
  update(patch: ProfilePatch): Promise<ProfileUser>;
}

// ---------------------------------------------------------------------------
// Mock implementations
//
// Thin wrappers over the static fixtures in "@/mocks/data" (validated against the domain schemas).
// They exist only so the UI has a stable, realistic shape to build against; the real
// implementations (see each PP-INTEGRATION-POINT below) replace them without touching callers.
// ---------------------------------------------------------------------------

// PP-INTEGRATION-POINT: token catalog. Replace with the indexer / token-list service
// (e.g. GET /tokens or a curated on-chain token registry) keyed by the configured chain ids.
const mockTokenService: TokenService = {
  list: async () => tokens,
};

/**
 * PP-MOCK (POO-830 R7): attach the derived `assetTags` (+ `unverifiedTokens`) to a mock strategy,
 * derived from the strategy's OWN pair EXACTLY as the real mappers do — `strategy.poolPair` first,
 * else `strategy.detail?.poolPair`. No parallel pair source, no invented pairs (real-mode-first: the
 * mock must mirror real). A fixture with no pair (a multi-asset mandate strategy, not a single
 * Uniswap pool) carries NO `assetTags`, mirroring a real pair-less / pending row. The fixture's
 * `poolPair` is read only, never mutated (no Invest zap / Receive-as / detail regression).
 */
function withMockAssetTags(strategy: Strategy): Strategy {
  const pair = strategy.poolPair ?? strategy.detail?.poolPair;
  if (!pair) return strategy;
  const { assetTags, unverified } = deriveAssetTagsForPair(
    { symbol: pair.token0 },
    { symbol: pair.token1 },
  );
  return { ...strategy, assetTags, unverifiedTokens: unverified || undefined };
}

// PP-INTEGRATION-POINT: strategy catalog. Replace with the OAMS strategy registry read via the
// indexer (list) and an RPC / contract `getStrategy` call (getById) against the manager contracts.
const mockStrategyService: StrategyService = {
  // Closed strategies are not allocatable, so they never list in Explore; holders still reach the
  // detail through their position (getById serves every status).
  list: async () =>
    strategies.filter((strategy) => strategy.status !== "closed").map(withMockAssetTags),
  // Holdings resolution keeps every status so a closed position a wallet holds/manages still
  // resolves to its real strategy instead of being dropped by the join (POO-455).
  listAll: async () => strategies.map(withMockAssetTags),
  getById: async (id: string) => {
    const strategy = strategies.find((entry) => entry.id === id);
    return strategy ? withMockAssetTags(strategy) : null;
  },
};

// PP-INTEGRATION-POINT: investor positions. Replace with the indexer query for the connected
// wallet's positions (subgraph / API), reconciled against OAMS vault balances over RPC.
// PP-INTEGRATION-POINT: per-period earned amounts (fees + yield). Replace with the fee-accounting
// endpoint's windowed earnings (24h / 7d / 30d) per position; mocked from a static table.
const mockPositionService: PositionService = {
  list: async () => positions,
  listExited: async () => exitedPositions,
  getEarnings: async (positionId) =>
    positionEarnings[positionId] ?? { "24h": 0, "7d": 0, "30d": 0 },
};

// PP-INTEGRATION-POINT: spendable balance. Replace with the connected wallet's USDC balance read
// over RPC (Privy embedded wallet or external connector). Mocked low ($50) so the invest flow can
// exercise the "needs deposit" branch (balance < amount → Deposit & invest).
const mockAccountService: AccountService = {
  getUsdcBalance: async () => 50,
  // PP-INTEGRATION-POINT: derive from the Privy session (embedded) vs the connected connector.
  getWalletKind: async () => "embedded",
};

// PP-INTEGRATION-POINT: savings markets. Replace with the indexer / market-data feed for the
// integrated lending venues (supply APY, liquidity). Empty today — Savings is out of v1.
const mockSavingsService: SavingsService = {
  list: async () => [],
};

// PP-INTEGRATION-POINT: transaction history. Replace with the indexer activity feed for the
// connected wallet (decoded OAMS / token transfer events) with price-at-time USD valuation.
const mockTransactionService: TransactionService = {
  list: async () => transactions,
};

/**
 * PP-MOCK: in-session referral state. The code starts unset (fixture `code: null`) and is created
 * once via {@link RewardsService.createReferralCode}; immutability is enforced HERE, not just in
 * the UI (POO-290 R2/R3). Resets with the session, like the manager mock state.
 */
let referralSession: ReferralProgram = referral;

/**
 * Accepted referral-code shape (murilo, 2026-06-11 — POO-290; max added POO-853 [R2]): 6 to 10
 * letters/numbers (min-6 product floor, max-10 backend hard limit). The code is stored AS TYPED
 * (display keeps the user's casing); the canonical `?ref=` link keeps the casing too (POO-853 [R3]).
 */
const REFERRAL_CODE_PATTERN = /^[a-zA-Z0-9]{6,10}$/;

// PP-INTEGRATION-POINT: rewards dashboards. Replace with the rewards/points backend (Quacks,
// tiers, streaks, referral program) joined with on-chain fee events for the ManagerIncentiveProgram view.
//
// NOTE (POO-661 / POO-426 pattern): the real REWARDS reads live OUTSIDE this factory (which is
// client-imported, and both `apiFetch` and `analyticsFetch` are server-only), selected by `isMockMode`
// in server-only resolvers/actions — mirroring how `profileService` stayed mock:mock while the real
// identity moved to `loadInvestorProfile`. Concretely:
//   - Quacks / Rubber Rush ← analytics indexer via `fetchRubberRush` + `getRubberRushAction` (POO-209).
//   - Referral ← pool-party-api `GET /referral/:wallet` via `fetchReferral` + `loadReferralProgram`
//     + `getReferralAction` (POO-661); `useReferral` reads the action in real mode, the mock here in
//     mock mode. The WRITE (`createReferralCode`) is still mock-only (real `POST /referral` is a
//     follow-up under POO-579). So this mock impl is the mock-mode branch; the factory export below
//     stays mock:mock on purpose.
const mockRewardsService: RewardsService = {
  getRubberRush: async () => rubberRush,
  getManagerIncentiveProgram: async () => managerIncentiveProgram,
  getReferral: async () => referralSession,
  createReferralCode: async (code) => {
    if (referralSession.code != null) throw new Error("Referral code already set");
    const candidate = code.trim();
    if (!REFERRAL_CODE_PATTERN.test(candidate)) throw new Error("Invalid referral code");
    referralSession = {
      ...referralSession,
      code: candidate,
      // POO-853 [R3][R7]: mock parity — the canonical `?ref=` invite link (code as-typed), not `/r/`.
      inviteLink: referralUrl(candidate),
    };
    return referralSession;
  },
  // PP-INTEGRATION-POINT: daily check-in. Replace with the rewards backend (signs a once-per-day
  // "quack" tx via the wallet seam, awards Quacks, and flips quackedToday until the next reset).
  sayQuack: async () => ({ quacksAwarded: 25, quackedToday: true }),
  // PP-INTEGRATION-POINT: Duck Shoot. Replace with the rewards backend (spends one try, resolves the
  // hit server-side, returns the won multiplier + the Quacks boost applied to today's balance).
  playDuckShoot: async () => {
    const { duckShoot, quacksToday } = rubberRush;
    const hitIndex = Math.floor(Math.random() * duckShoot.targets.length);
    const multiplierPct = duckShoot.targets[hitIndex]?.multiplierPct ?? 0;
    const quacksWon = Math.round((quacksToday * multiplierPct) / 100);
    return { hitIndex, multiplierPct, quacksWon, triesLeft: Math.max(0, duckShoot.triesLeft - 1) };
  },
  // PP-INTEGRATION-POINT: role claim. Replace with the community-roles backend (Discord/guild)
  // gated by the current tier.
  claimRoles: async () => ({ claimed: true, roles: ["Swimmer", "Early Quacker"] }),
};

/**
 * PP-MOCK: in-session manager strategy state, seeded lazily from the fixtures. Manage actions
 * (pause/resume, close, collect, Show-in-Explore) mutate these copies so the console reflects them
 * for the rest of the session; nothing persists (no localStorage — policy). The fixtures stay pure.
 */
const managerStrategyState = new Map<string, ManagerStrategyDetail>();

/** The seeded (or already-mutated) in-session manager strategy state. */
function managerState(): Map<string, ManagerStrategyDetail> {
  if (managerStrategyState.size === 0) {
    for (const detail of managerStrategyDetails) {
      managerStrategyState.set(detail.id, structuredClone(detail));
    }
  }
  return managerStrategyState;
}

/** Looks up a strategy in the session state or throws (mock-only guard). */
function managerStateEntry(strategyId: string): ManagerStrategyDetail {
  const detail = managerState().get(strategyId);
  if (!detail) throw new Error(`managerService: unknown strategy "${strategyId}"`);
  return detail;
}

const managerProfileMap = new Map<string, ManagerProfile>();

/**
 * POO-745: the per-manager verification code, keyed by the stable id. The code is a SECRET (the manager
 * DMs it to us) so it lives OUTSIDE the profile map — it is never returned on the public `getProfile`
 * read, only from `requestVerification`. Mirrors POO-744, where the code column is excluded from the
 * public projection. Cleared with the rest of the manager session state.
 */
const managerVerificationCodeMap = new Map<string, string>();

/**
 * POO-659: a manager's STABLE identity key — the lowercased wallet `address` when present, else the
 * `handle`. Handle is a mutable, possibly-empty display field, so it can't be the key; address is
 * immutable. Managers without an address (the seeded named managers) stay keyed by their handle, so
 * their handle-based lookups keep working unchanged.
 */
function managerProfileKey(profile: Pick<ManagerProfile, "address" | "handle">): string {
  return (profile.address ?? profile.handle).toLowerCase();
}

/** The seeded (or already-edited) in-session manager profile state, keyed by the stable id. */
function managerProfileState_(): Map<string, ManagerProfile> {
  if (managerProfileMap.size === 0) {
    for (const profile of managerProfiles) {
      managerProfileMap.set(managerProfileKey(profile), structuredClone(profile));
    }
  }
  return managerProfileMap;
}

/** PP-MOCK: test-only helper — reseeds the in-session manager state from the fixtures. */
export function resetMockManagerState(): void {
  managerStrategyState.clear();
  managerProfileMap.clear();
  managerVerificationCodeMap.clear();
}

// PP-INTEGRATION-POINT: manager console. Replace with the OAMS manager backend — the manager's
// aggregate dashboard (AUM, investors, yield, AUM series) and their strategy registry, read via the
// indexer + manager contracts for the authenticated manager address.
const mockManagerService: ManagerService = {
  getDashboard: async () => managerDashboard,
  listStrategies: async () => [...managerState().values()],
  getFeePolicy: async () => managerFeePolicy,
  // PP-INTEGRATION-POINT: real create = deploy/configure the OAMS strategy + on-chain verification
  // (pool exists, params valid) → the indexer lists it. The mock builds the row and auto-verifies,
  // computing internal-only risk flags the investor never sees.
  createStrategy: async (input: CreateStrategyInput) => {
    const name = input.name.trim();
    // POO-235 [R4]: the manager's description is carried with the strategy, trimmed on save; an
    // empty/whitespace value is dropped (the field is optional). It surfaces to investors as the
    // Strategy-detail "About" and the discovery-card subtitle once the strategy is listed.
    // PP-INTEGRATION-POINT: the real create persists `description` on the OAMS strategy metadata; the
    // indexer then serves it on the investor Strategy entity.
    const description = input.description?.trim() || undefined;
    const initials =
      name
        .split(/\s+/)
        .map((word) => word[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase() || "ST";
    const id =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "new-strategy";
    const riskFlags: string[] = [];
    if (input.riskLevel >= 4) riskFlags.push("high-volatility");
    if (!input.range.full) riskFlags.push("concentrated-range");
    const strategy: ManagerStrategy = {
      id,
      name,
      description,
      initials,
      riskLevel: input.riskLevel,
      category: input.category,
      aum: 0,
      investors: 0,
      flows30d: 0,
      apy: input.estApyPct,
      fees30d: 0,
      spark: [0, 0],
      inRange: true,
      logoUrl: input.logoUrl ?? undefined,
      status: input.asDraft ? "draft" : "active",
    };
    return { strategy, verification: { status: "verified", riskFlags } };
  },
  // PP-INTEGRATION-POINT: read the manager's live LP position from the indexer (range, current price,
  // uncollected fees, deployed liquidity) for the given strategy.
  getPosition: async (strategyId: string) =>
    managerPosition.strategyId === strategyId ? managerPosition : null,
  // PP-INTEGRATION-POINT: collect = the manager-signed collect() on the position-manager contract;
  // the mock pays out the strategy's accrued fees (zeroing them) with a flat gas estimate.
  collectFees: async (strategyId: string) => {
    const detail = managerStateEntry(strategyId);
    const collectedUsd = detail.claimableFeesUsd;
    detail.claimableFeesUsd = 0;
    return { collectedUsd, gasCostUsd: managerPosition.gasCostUsd };
  },
  // PP-INTEGRATION-POINT: compound = collect + re-add liquidity in one manager-signed action.
  compound: async () => ({
    compoundedUsd: managerPosition.uncollectedFeesUsd,
    gasCostUsd: managerPosition.gasCostUsd,
  }),
  // PP-INTEGRATION-POINT: move range = the manager-signed decrease + re-mint (reposition) on the
  // position-manager contract within the slippage cap; the mock echoes the requested range + gas.
  // POO-518 R2: it also persists the applied range on the in-session detail (when the strategy is
  // known — the operate-surface fixture shares an id with the manage state), so a manage-view
  // refetch reads the new band back instead of the stale fixture. Full-range lands as the schema's
  // full representation (no bounds); in/out-of-range re-derives from the shared rule.
  moveRange: async (strategyId: string, input: MoveRangeInput) => {
    const full = input.full ?? false;
    const detail = managerState().get(strategyId);
    if (detail) {
      detail.range = {
        ...detail.range,
        full,
        minPrice: full ? null : input.rangeMin,
        maxPrice: full ? null : input.rangeMax,
      };
      detail.inRange = getRangeStatus(detail.range.currentPrice, detail.range) === "in";
    }
    return {
      rangeMin: input.rangeMin,
      rangeMax: input.rangeMax,
      full,
      gasCostUsd: managerPosition.gasCostUsd,
    };
  },
  // PP-INTEGRATION-POINT: manage detail = indexer + manager contracts (range, uncollected fees)
  // joined with the OAMS backend (fee accounting, investor counts, activity feed).
  getStrategyDetail: async (strategyId: string) => managerState().get(strategyId) ?? null,
  // PP-INTEGRATION-POINT: discovery toggle. Real impl flips the strategy's Explore listing in the
  // OAMS registry (manager-signed metadata update).
  setShowInExplore: async (strategyId: string, visible: boolean) => {
    const detail = managerStateEntry(strategyId);
    detail.showInExplore = visible;
    return detail;
  },
  // PP-INTEGRATION-POINT: pause/resume = manager-signed deposit gate on the strategy contract.
  // Pausing stops NEW deposits only; the position keeps running and withdrawals stay open.
  setDepositsPaused: async (strategyId: string, paused: boolean) => {
    const detail = managerStateEntry(strategyId);
    if (detail.status !== "closed" && detail.status !== "draft") {
      detail.status = paused ? "paused" : "active";
    }
    return detail;
  },
  // PP-INTEGRATION-POINT: soft close on the strategy contract — freezes deposits permanently, no
  // forced unwind; each investor withdraws whenever they want (instant, no fee). Irreversible.
  closeStrategy: async (strategyId: string) => {
    const detail = managerStateEntry(strategyId);
    detail.status = "closed";
    detail.showInExplore = false;
    return detail;
  },
  // PP-INTEGRATION-POINT: manager registry lookup by handle OR wallet address (POO-618) — profile +
  // aggregate stats. An EVM address is checked first (matched against the profile's `address`);
  // otherwise the param is treated as a handle and looked up in the registry.
  getProfile: async (handleOrAddress: string) => {
    const map = managerProfileState_();
    if (isEvmAddress(handleOrAddress)) {
      const target = handleOrAddress.toLowerCase();
      for (const profile of map.values()) {
        if (profile.address?.toLowerCase() === target) return profile;
      }
      return null;
    }
    // POO-659: a NON-EMPTY handle matches the mutable display handle. An empty/blank param never
    // matches (no wildcard) — the map is keyed by the stable id, so the unfilled manager (handle "")
    // is only reachable by its address, never by an accidental empty lookup.
    if (!handleOrAddress) return null;
    for (const profile of map.values()) {
      if (profile.handle === handleOrAddress) return profile;
    }
    return null;
  },
  // PP-INTEGRATION-POINT (POO-576): handle availability = the backend manager-profile registry's
  // uniqueness check (a cheap "is this slug taken?" query as the manager types). The mock scans the
  // in-session profile map for any OTHER manager already on that handle (self excluded).
  isHandleAvailable: async (handle: string, selfId?: string) => {
    // POO-659 R4: an empty handle is never "taken" (the unfilled manager has none yet).
    if (!handle) return true;
    const self = selfId?.toLowerCase();
    const map = managerProfileState_();
    for (const [key, profile] of map) {
      if (self !== undefined && key === self) continue; // the caller's own entry never self-collides
      if (profile.handle === handle) return false;
    }
    return true;
  },
  // PP-INTEGRATION-POINT: profile write goes to the manager registry/backend, and the avatar/banner
  // uploads to real media storage (CDN). The mock merges into in-session state only.
  // POO-575 R6: on the FIRST save while unlocked, the chosen `input.handle` is committed and the
  // profile locks (`handleLocked: true`). PP-INTEGRATION-POINT (POO-576): the real registry enforces
  // the uniqueness + the immutable lock server-side; the mock enforces both here so the lifecycle is
  // honest. Once locked, `input.handle` is ignored (rename is out of scope).
  updateProfile: async (id: string, input: UpdateManagerProfileInput) => {
    const map = managerProfileState_();
    // POO-659 R5: the manager is identified by the STABLE id (lowercased address, else handle).
    const key = id.toLowerCase();
    const current = map.get(key);
    if (!current) throw new Error(`managerService: unknown manager "${id}"`);
    const next: ManagerProfile = { ...current };
    if (input.name !== undefined) next.name = input.name.trim() || current.name;
    if (input.bio !== undefined) next.bio = input.bio;
    if (input.avatarUrl !== undefined) next.avatarUrl = input.avatarUrl;
    if (input.bannerUrl !== undefined) next.bannerUrl = input.bannerUrl;
    if (input.socials !== undefined) next.socials = { ...input.socials };

    // POO-575 R6: claim the chosen handle only when still unlocked and a new one is provided.
    const claimingHandle =
      current.handleLocked !== true &&
      input.handle !== undefined &&
      input.handle !== current.handle;
    if (claimingHandle) {
      // Enforce uniqueness server-side too: reject a handle another manager already holds.
      for (const [otherKey, profile] of map) {
        if (otherKey === key) continue;
        if (profile.handle === input.handle) {
          throw new Error(`managerService: handle "${input.handle}" is already taken`);
        }
      }
      next.handle = input.handle as string;
    }
    // Lock on the first successful save while unlocked (a handle was set / confirmed).
    if (current.handleLocked !== true) next.handleLocked = true;

    // POO-659 R5: the map is keyed by the STABLE id (address when present), so claiming or changing
    // the handle never re-keys the entry — write in place.
    map.set(key, next);
    return structuredClone(next);
  },
  // PP-INTEGRATION-POINT (POO-744): request-verification ← POST /api/v1/managers/me/verification/request
  // (signed write). The real path goes through requestManagerVerificationAction; this mock mirrors the
  // API lifecycle in session state (POO-745 R3/R6). The code is SECRET — stored in the code map, never
  // on the profile — so `getProfile` never leaks it (matches the POO-744 secret-exposure constraint).
  requestVerification: async (id: string) => {
    const key = id.toLowerCase();
    const profile = managerProfileState_().get(key);
    if (!profile) throw new Error(`managerService: unknown manager "${id}"`);
    // Reject a re-request once verified (POO-744 R6): no new code, no mutation.
    if (profile.managerVerification === "valid") {
      throw new Error("verification: manager is already verified");
    }
    // Idempotent while pending (POO-744 R4): return the existing code, do not regenerate or mutate.
    const existing = managerVerificationCodeMap.get(key);
    if (profile.managerVerification === "pending" && existing) {
      return { status: "pending", code: existing, message: buildVerificationMessage(existing) };
    }
    // none -> pending (POO-744 R3): mint a fresh code, flip status, persist.
    const code = generateVerificationCode();
    managerVerificationCodeMap.set(key, code);
    profile.managerVerification = "pending";
    return { status: "pending", code, message: buildVerificationMessage(code) };
  },
};

/**
 * PP-MOCK: the server-authored instruction the API returns alongside the code (POO-744 R7). The FE
 * re-renders its OWN i18n copy in the modal (POO-745 R4), so this is only for response-shape parity.
 */
function buildVerificationMessage(code: string): string {
  return `Send this code to the Pool Party official profile from a registered social account: ${code}`;
}

// PP-INTEGRATION-POINT: Uniswap v3 pool catalog. Replace with the indexer / subgraph pool list
// (pair, fee tier, TVL, APR, current price) across the supported chains.
const mockPoolService: PoolService = {
  list: async () => uniswapPools,
};

// PP-INTEGRATION-POINT: cards marketplace + held cards. Replace `getCatalog` with the partner-card
// registry (curated list + partner availability), `getMyCards`/`getTransactions` with the partner
// card-program APIs (aggregated balances + authorizations), `requestCard` with the partner referral
// / application handoff, and `topUp` with the wallet/portfolio → card funding rail.
const mockCardsService: CardsService = {
  getCatalog: async () => cardOffers,
  getMyCards: async () => ownedCards,
  getTransactions: async (cardId: string) =>
    cardTransactions.filter((transaction) => transaction.cardId === cardId),
  requestCard: async (partnerId: string) => {
    const offer = cardOffers.find((candidate) => candidate.partnerId === partnerId);
    return {
      partnerId,
      status: "requested",
      onboardingUrl: offer?.onboardingUrl ?? `https://partners.poolparty.app/cards/${partnerId}`,
    };
  },
  topUp: async ({ cardId, amountUsd }: TopUpInput) => {
    const card = ownedCards.find((candidate) => candidate.id === cardId);
    if (!card) throw new Error(`topUp: unknown card "${cardId}"`);
    return { cardId, amountUsd, newBalanceUsd: card.balanceUsd + amountUsd };
  },
};

// PP-INTEGRATION-POINT: authentication. Replace with Privy (social login + embedded wallets) for
// `loginWithGoogle`, and the external wallet connectors (wagmi / Privy) for `connectWallet`. The
// mock resolves a deterministic fake session so the UI flow (Google → Wallet ready; wallet → Home)
// can be built and tested without network or SDK.
const mockAuthService: AuthService = {
  loginWithGoogle: async () => ({
    userId: "mock-maria",
    method: "google",
    address: "0x1A2b3C4d5E6f7890a1B2c3D4e5F6789012345678",
    isNewWallet: true,
  }),
  connectWallet: async (connectorId: string) => ({
    userId: `mock-${connectorId}`,
    method: "wallet",
    address: "0x9F8e7D6c5B4a39281706F5e4D3c2B1a098765432",
    isNewWallet: false,
  }),
  logout: async () => {},
};

/**
 * PP-MOCK: in-session investor profile, seeded lazily from the fixture. Profile edits (Name / Email /
 * Country on /profile/personal) mutate this copy so the hub + greeting reflect them for the rest of
 * the session; nothing persists (no localStorage — policy). The fixture stays pure. Mirrors the
 * manager-profile mock state.
 */
let profileSession: ProfileUser | null = null;

/** The seeded (or already-edited) in-session investor profile. */
function profileState(): ProfileUser {
  if (!profileSession) {
    profileSession = structuredClone(mockProfileUser);
  }
  return profileSession;
}

/** PP-MOCK: test-only helper — reseeds the in-session investor profile from the fixture. */
export function resetMockProfileState(): void {
  profileSession = null;
}

// PP-INTEGRATION-POINT (POO-222 [R7] / POO-426): the REAL investor identity now lives outside this
// factory (server-only, so `apiFetch` never reaches a client bundle) and is selected by `isMockMode`
// in the resolver, mirroring `strategyCatalog`:
//   - read  → `loadInvestorProfile` / `fetchInvestorProfile` (`GET /api/v1/users/:address`, POO-232;
//             referral/Quacks composed from the rewards read — single source, POO-426).
//   - write → the client signs via the `signWrite` helper (POO-637) and forwards to
//             `updateMyProfileAction` (`PATCH /api/v1/users/me`).
// This mock impl is the mock-mode branch ONLY: `get` clones the seed; `update` shallow-merges the
// editable subset (name/displayName/email/country/phone). Real avatar upload stays a PP-INTEGRATION-POINT (POO-232/233).
const mockProfileService: ProfileService = {
  get: async () => structuredClone(profileState()),
  update: async (patch: ProfilePatch) => {
    profileSession = { ...profileState(), ...patch };
    return structuredClone(profileSession);
  },
};

// ---------------------------------------------------------------------------
// The switch point
//
// Every export below resolves to the mock today. When `isMockMode` is false the right-hand side
// of each ternary becomes the real implementation; for now both branches are the mock so the
// factory stays the single, type-safe place to flip each service over.
// ---------------------------------------------------------------------------

/** On-chain token catalog service (mock today; see PP-INTEGRATION-POINT above). */
export const tokenService: TokenService = isMockMode ? mockTokenService : mockTokenService;

/** Managed-strategy catalog service (mock today; see PP-INTEGRATION-POINT above). */
export const strategyService: StrategyService = isMockMode
  ? mockStrategyService
  : mockStrategyService;

/** Investor positions service (mock today; see PP-INTEGRATION-POINT above). */
export const positionService: PositionService = isMockMode
  ? mockPositionService
  : mockPositionService;

/** Spendable-balance service (mock today; see PP-INTEGRATION-POINT above). */
export const accountService: AccountService = isMockMode ? mockAccountService : mockAccountService;

/** Savings markets service (mock today; see PP-INTEGRATION-POINT above). */
export const savingsService: SavingsService = isMockMode ? mockSavingsService : mockSavingsService;

/** Transaction history service (mock today; see PP-INTEGRATION-POINT above). */
export const transactionService: TransactionService = isMockMode
  ? mockTransactionService
  : mockTransactionService;

/**
 * Rewards dashboards service. Intentionally mock:mock (POO-661 / POO-426 pattern): the real rewards
 * READS live outside this client-imported factory — Rubber Rush/Quacks via `fetchRubberRush`, referral
 * via `fetchReferral`/`loadReferralProgram`/`getReferralAction` — because `apiFetch`/`analyticsFetch`
 * are server-only. This export is the mock-mode source + the still-mocked WRITE (`createReferralCode`).
 * See the NOTE above `mockRewardsService`.
 */
export const rewardsService: RewardsService = isMockMode ? mockRewardsService : mockRewardsService;

/**
 * Manager console service. Intentionally mock:mock. The strategies/dashboard/manage surface has no
 * real source yet (stays mock). The PROFILE sub-surface (getProfile / isHandleAvailable /
 * updateProfile) IS wired to the deployed manager-profile registry (POO-579), but the real path CANNOT
 * live inside this client-imported factory: the reads use the server-only `apiFetch` (importing it here
 * would break the client bundle) and the write needs a CLIENT wallet signature the factory has no
 * access to. So — exactly like the rewards service (POO-661/POO-426) and the v2 strategy write
 * (POO-308) — the real profile path lives OUTSIDE the factory and is selected at the call site:
 *   - reads  → `fetchManagerProfile` (server-only), used by `/m/[handle]` + `getManagerConsoleAction`;
 *   - write  → `useManagerProfileWrite` (client hook) signs `manager.update` + `updateManagerProfileAction`;
 *   - check  → `checkManagerHandleAction`.
 * This export remains the mock-mode source AND the still-mock strategies/dashboard/manage surface.
 * PP-INTEGRATION-POINT (POO-579): manager-profile registry `GET/PATCH /api/v1/managers` — see
 * `src/lib/manager/profile/`.
 */
export const managerService: ManagerService = isMockMode ? mockManagerService : mockManagerService;

// --- Manager verification (POO-587) ---------------------------------------------------------------
const verificationRequestMap = new Map<string, ManagerVerificationRequest>();

/** The seeded (or already-mutated) in-session verification requests. */
function verificationState(): Map<string, ManagerVerificationRequest> {
  if (verificationRequestMap.size === 0) {
    for (const request of managerVerificationRequests) {
      // POO-659: key by the lowercased id so approve/reject (which lowercase their arg) resolve it.
      verificationRequestMap.set(request.managerHandle.toLowerCase(), structuredClone(request));
    }
  }
  return verificationRequestMap;
}

/** PP-MOCK: test-only helper — reseeds the in-session verification requests from the fixtures. */
export function resetMockVerificationState(): void {
  verificationRequestMap.clear();
}

// PP-INTEGRATION-POINT: verification lifecycle ← pool-party-api admin endpoints via apiFetch, never
// the DB: GET /admin/verifications (pending), POST /admin/verifications/:handle/{approve,reject}
// (the API writes the audit log + sets the manager's managerVerification to 'valid' — the staff
// pending→valid step; POO-809 removed the legacy `verified` boolean), POST /manager/verification/request.
const mockVerificationService: VerificationService = {
  getRequest: async (id) => verificationState().get(id.toLowerCase()) ?? null,

  requestVerification: async (id) => {
    // POO-659 R6: the caller passes the manager's stable id (address, else handle); key by it.
    const key = id.toLowerCase();
    const profile = managerProfileState_().get(key);
    if (profile?.managerVerification === "valid") {
      throw new Error("verification: manager is already verified");
    }
    if (verificationState().get(key)?.status === "pending") {
      throw new Error("verification: a request is already pending");
    }
    const request: ManagerVerificationRequest = {
      // Keep the invariant `managerHandle === the map key` so the admin queue's approve/reject (keyed
      // off the row's managerHandle) resolve. For the unfilled manager that is the wallet address.
      managerHandle: key,
      // Fall back to the masked address when the profile has no display name yet (POO-659).
      managerName: profile?.name || (isEvmAddress(id) ? maskAddress(id) : id),
      avatarUrl: profile?.avatarUrl,
      status: "pending",
      submittedAt: new Date().toISOString(),
      aum: profile?.stats.aum ?? 0,
      strategyCount: profile?.stats.strategies ?? 0,
    };
    verificationState().set(key, request);
    return request;
  },

  listPending: async () =>
    [...verificationState().values()].filter((request) => request.status === "pending"),

  approve: async (id, reviewer) => {
    const key = id.toLowerCase();
    const request = verificationState().get(key);
    if (request?.status !== "pending") {
      throw new Error(`verification: no pending request for "${id}"`);
    }
    const decided: ManagerVerificationRequest = {
      ...request,
      status: "approved",
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer,
    };
    verificationState().set(key, decided);
    // Set the badge source to `valid` (the pending→valid staff step) when this manager exists in the
    // mock profiles. POO-809: managerVerification is the sole badge source; the legacy `verified` is gone.
    const profile = managerProfileState_().get(key);
    if (profile) managerProfileState_().set(key, { ...profile, managerVerification: "valid" });
    return decided;
  },

  reject: async (id, reviewer, reason) => {
    const key = id.toLowerCase();
    const request = verificationState().get(key);
    if (request?.status !== "pending") {
      throw new Error(`verification: no pending request for "${id}"`);
    }
    const decided: ManagerVerificationRequest = {
      ...request,
      status: "rejected",
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer,
      reason,
    };
    verificationState().set(key, decided);
    return decided;
  },
};

/** Manager verification service (mock today; see PP-INTEGRATION-POINT above). */
export const verificationService: VerificationService = isMockMode
  ? mockVerificationService
  : mockVerificationService;

// --- Image moderation (POO-590) -------------------------------------------------------------------
const moderationImageMap = new Map<string, ModerationImage>();

/** The seeded (or already-mutated) in-session moderation images. */
function moderationState(): Map<string, ModerationImage> {
  if (moderationImageMap.size === 0) {
    for (const image of moderationImages) {
      moderationImageMap.set(image.id, structuredClone(image));
    }
  }
  return moderationImageMap;
}

/** PP-MOCK: test-only helper — reseeds the in-session moderation images from the fixtures. */
export function resetMockModerationState(): void {
  moderationImageMap.clear();
}

// PP-INTEGRATION-POINT: image moderation ← pool-party-api admin endpoints via apiFetch, never the DB:
// GET /admin/moderation/images (pending), POST /admin/moderation/images/:id/{approve,remove} (the API
// writes the audit log + soft-hides). Real image URLs come from the image-hosting backend (POO-580).
const mockModerationService: ModerationService = {
  listQueue: async () =>
    [...moderationState().values()].filter((image) => image.status === "pending"),

  approve: async (id, reviewer) => {
    const image = moderationState().get(id);
    if (image?.status !== "pending") {
      throw new Error(`moderation: no pending image "${id}"`);
    }
    const decided: ModerationImage = {
      ...image,
      status: "approved",
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer,
    };
    moderationState().set(id, decided);
    return decided;
  },

  remove: async (id, reviewer, reason) => {
    const image = moderationState().get(id);
    if (image?.status !== "pending") {
      throw new Error(`moderation: no pending image "${id}"`);
    }
    const decided: ModerationImage = {
      ...image,
      status: "removed",
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer,
      removedReason: reason,
    };
    moderationState().set(id, decided);
    return decided;
  },
};

/** Image moderation service (mock today; see PP-INTEGRATION-POINT above). */
export const moderationService: ModerationService = isMockMode
  ? mockModerationService
  : mockModerationService;

// --- RBAC role→capability mapping (POO-591) --------------------------------------------------------
let roleCapabilities: RoleCapabilityMapping | null = null;

/** The in-session mapping, seeded from the defaults on first use. */
function rbacState(): RoleCapabilityMapping {
  if (!roleCapabilities) {
    roleCapabilities = structuredClone(DEFAULT_ROLE_CAPABILITIES);
  }
  return roleCapabilities;
}

/** PP-MOCK: test-only helper — reseeds the in-session role→capability mapping. */
export function resetMockRbacState(): void {
  roleCapabilities = null;
}

// PP-INTEGRATION-POINT: role→capability mapping ← pool-party-api admin endpoints via apiFetch, never
// the DB: GET /admin/roles, PUT /admin/roles/:role/:capability. The API owns the store (Neon).
const mockRbacService: RbacService = {
  getRoleCapabilities: async () => structuredClone(rbacState()),

  setRoleCapability: async (role, capability, granted) => {
    if (role === "master") {
      throw new Error("rbac: master capabilities are fixed");
    }
    const grants = rbacState()[role];
    if (!grants) {
      throw new Error(`rbac: unknown role "${role}"`);
    }
    const def = ADMIN_CAPABILITIES.find((entry) => entry.key === capability);
    if (!def) {
      throw new Error(`rbac: unknown capability "${capability}"`);
    }
    if (def.masterOnly) {
      throw new Error(`rbac: "${capability}" is master-only and cannot be delegated`);
    }
    const next = new Set(grants);
    if (granted) {
      next.add(capability);
    } else {
      next.delete(capability);
    }
    rbacState()[role] = [...next];
    return structuredClone(rbacState());
  },
};

/** RBAC mapping service (mock today; see PP-INTEGRATION-POINT above). */
export const rbacService: RbacService = isMockMode ? mockRbacService : mockRbacService;

/** Uniswap v3 pool catalog service (mock today; see PP-INTEGRATION-POINT above). */
export const poolService: PoolService = isMockMode ? mockPoolService : mockPoolService;

/** Cards marketplace + held-cards service (mock today; see PP-INTEGRATION-POINT above). */
export const cardsService: CardsService = isMockMode ? mockCardsService : mockCardsService;

/** Authentication / wallet-provisioning service (mock today; see PP-INTEGRATION-POINT above). */
export const authService: AuthService = isMockMode ? mockAuthService : mockAuthService;

/** Investor profile identity service (mock today; see PP-INTEGRATION-POINT above). */
export const profileService: ProfileService = isMockMode ? mockProfileService : mockProfileService;
