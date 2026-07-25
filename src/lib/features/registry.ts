/**
 * @id PP-CORE-LIB-011
 * @name feature flag registry
 * @implements-rules-version v1
 *
 * The single catalog of product feature flags for the investor app — one entry per gateable area.
 * This is the source of truth the nav, route guards, and entry-point links all read through (via
 * {@link isFeatureEnabled} in "./index"); nothing re-reads `process.env` directly.
 *
 * v1 launches with the core areas + Rewards on and everything else off (dark-launched, built behind
 * its flag). Flip a flag per environment with `NEXT_PUBLIC_FEATURE_<KEY>` (see "./resolve"). Business
 * rules: the Linear doc "Feature Flags — v1 Launch & Progressive Rollout"; tech spec: docs/FEATURE_FLAGS.md.
 */

/**
 * Every gateable area. The flag key is the area name in camelCase. A few flags gate rendering
 * behavior on an already-launched surface rather than an area (e.g. `virtualize`); these are
 * noted on their {@link FEATURES} entry.
 */
export type FeatureKey =
  | "home"
  | "portfolio"
  | "strategies"
  | "deposit"
  | "profile"
  | "rewards"
  | "cards"
  | "savings"
  | "buyTokens"
  | "predictions"
  | "perps"
  | "adminConsole"
  | "provisioning"
  | "virtualize"
  | "strategyCategoryFilter";

/**
 * Lifecycle stage of an area:
 * - `core` — foundational; on by default, nav-level kill-switch only (route is NOT 404-guarded).
 * - `live` — launched and on in v1.
 * - `next` — in active build behind the flag (hidden until ready).
 * - `planned` — registered but not built yet.
 */
export type FeatureStage = "core" | "live" | "next" | "planned";

/** One entry in the {@link FEATURES} registry. */
export interface FeatureDefinition {
  /** Stable flag key (camelCase area name). */
  key: FeatureKey;
  /** Human-readable area name. */
  area: string;
  /** Baseline state when no env override is present — i.e. the v1 launch state. */
  defaultEnabled: boolean;
  /** Lifecycle stage. */
  stage: FeatureStage;
  /** The environment variable that overrides this flag per environment. */
  envVar: `NEXT_PUBLIC_FEATURE_${string}`;
  /** What the flag gates, plus any notes (e.g. an additional role gate). */
  description: string;
}

/**
 * The flag catalog. Insertion order is the display order (e.g. in the dev/QA panel). Editing a
 * `defaultEnabled` here changes the baseline launch state; per-environment overrides win at runtime.
 */
export const FEATURES: Record<FeatureKey, FeatureDefinition> = {
  home: {
    key: "home",
    area: "Home",
    defaultEnabled: true,
    stage: "core",
    envVar: "NEXT_PUBLIC_FEATURE_HOME",
    description: "Investor dashboard at `/`.",
  },
  portfolio: {
    key: "portfolio",
    area: "Portfolio",
    defaultEnabled: true,
    stage: "core",
    envVar: "NEXT_PUBLIC_FEATURE_PORTFOLIO",
    description: "Holdings & performance at `/portfolio`.",
  },
  strategies: {
    key: "strategies",
    area: "Strategies",
    defaultEnabled: true,
    stage: "core",
    envVar: "NEXT_PUBLIC_FEATURE_STRATEGIES",
    description: "Explore + invest flow at `/strategies` (and the mobile Invest tab).",
  },
  deposit: {
    key: "deposit",
    area: "Deposit",
    defaultEnabled: true,
    stage: "core",
    envVar: "NEXT_PUBLIC_FEATURE_DEPOSIT",
    description: "Fiat onramp + crypto receive at `/deposit`.",
  },
  profile: {
    key: "profile",
    area: "Profile",
    defaultEnabled: true,
    stage: "core",
    envVar: "NEXT_PUBLIC_FEATURE_PROFILE",
    description: "Account hub + settings sub-screens at `/profile`.",
  },
  rewards: {
    key: "rewards",
    area: "Rewards",
    defaultEnabled: true,
    stage: "live",
    envVar: "NEXT_PUBLIC_FEATURE_REWARDS",
    description:
      "Rubber Rush / ManagerIncentiveProgram / Referral at `/rewards`; also gates the header RewardsPill and the Profile reward rows.",
  },
  cards: {
    key: "cards",
    area: "Cards",
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_CARDS",
    description: "Virtual cards at `/cards` + the mobile Cards tab. Next area to build.",
  },
  savings: {
    key: "savings",
    area: "Savings",
    defaultEnabled: false,
    stage: "planned",
    envVar: "NEXT_PUBLIC_FEATURE_SAVINGS",
    description: "Abstracted lending markets at `/savings`. Not built.",
  },
  buyTokens: {
    key: "buyTokens",
    area: "Buy Tokens",
    defaultEnabled: false,
    stage: "planned",
    envVar: "NEXT_PUBLIC_FEATURE_BUY_TOKENS",
    description: "Spot token exposure at `/buy-tokens`. Not built.",
  },
  predictions: {
    key: "predictions",
    area: "Predictions",
    defaultEnabled: false,
    stage: "planned",
    envVar: "NEXT_PUBLIC_FEATURE_PREDICTIONS",
    description: "Prediction markets at `/predictions`. Not built.",
  },
  perps: {
    key: "perps",
    area: "Perps",
    defaultEnabled: false,
    stage: "planned",
    envVar: "NEXT_PUBLIC_FEATURE_PERPS",
    description: "Perpetual futures at `/perps`. Not built.",
  },
  adminConsole: {
    key: "adminConsole",
    area: "Admin Console",
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_ADMIN_CONSOLE",
    description:
      "Internal Admin / Ops Console at adm.pool-party.xyz (host-gated `/admin` route group). Own Google + TOTP 2FA auth, operator/admin/master RBAC. Dark-launched. See POO-143/144.",
  },
  provisioning: {
    key: "provisioning",
    area: "Provisioning (pre-flight gate)",
    // Dark-launched (premise 10), on a FLAT baseline like every other flag (POO-1042 [R5]).
    //
    // It used to be `process.env.NODE_ENV === "development"`, which was defensible only while the
    // real branch was a hard-disable stub: the gate could not fire outside a local mock demo no
    // matter what the flag said. POO-1042 wires it to live balances, so the same computed baseline
    // would now mean production behavior depends on how the image was BUILT rather than on a
    // decision anyone made. It ships off; go-live is `NEXT_PUBLIC_FEATURE_PROVISIONING=true`, per
    // environment, like every other area.
    //
    // Turning it on locally is the same env var (see `.env.example`), not a build mode.
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_PROVISIONING",
    description:
      "Pre-flight provisioning gate embedded in the op modals (invest/withdraw/collect/compound/move-range/close). Wired to live balances + the Uniswap funding rail (POO-1042). Not a route, so it is never route-guarded.",
  },
  virtualize: {
    key: "virtualize",
    area: "List virtualization",
    // POO-623 epic. Presentational rendering-strategy switch (windowed lists), NOT an area gate:
    // it flips how already-launched long lists render (windowed vs plain `.map()`), never whether
    // a route/nav is shown. Independent of `isManager` (role) and `isMockMode` (data). Default off
    // = the plain `.map()` baseline; per-env `NEXT_PUBLIC_FEATURE_VIRTUALIZE` turns windowing on.
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_VIRTUALIZE",
    description:
      "Presentational rendering-strategy switch (windowed lists) on already-launched surfaces. NOT a route gate, NOT isManager, NOT isMockMode. Default off = plain .map() baseline.",
  },
  strategyCategoryFilter: {
    key: "strategyCategoryFilter",
    area: "Strategy asset-category filter",
    // POO-830 PR2. Presentational control gate on the already-launched Strategies Explore surface
    // (NOT an area/route gate): it only decides whether the investor sees the multi-select asset-
    // category filter (Bitcoin / Ethereum / Stablecoins / Altcoins / Meme coins). Independent of
    // `isManager` (role) and `isMockMode` (data). Default off = the Explore screen behaves exactly as
    // today; per-env `NEXT_PUBLIC_FEATURE_STRATEGY_CATEGORY_FILTER` reveals the control.
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_STRATEGY_CATEGORY_FILTER",
    description:
      "The POO-830 category-tags surface (R5/R6/R8). PR2: the investor asset-category multi-select filter on the Strategies Explore screen. PR3: the read-only asset + objective tag preview in the strategy builder's DerivedMandateCard. NOT a route gate, NOT isManager, NOT isMockMode. Default off = today's Explore + builder behavior; on = the filter shows (client-side over loaded strategies) and the builder previews the derived tags.",
  },
};

/** All flag keys in registry (display) order. */
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
