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
  | "swapScreen"
  | "fiatOnRamp"
  | "privyOnRamp"
  | "onRampCapture"
  | "robinhoodChain"
  | "activeReserve"
  | "cashPlus"
  | "virtualize"
  | "strategyCategoryFilter"
  | "hookTools";

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
  swapScreen: {
    key: "swapScreen",
    area: "Swap & bridge",
    // POO-1046, hackathon POO-1022. Dark-launched (premise 10) on a flat baseline: `/swap` 404s
    // until an environment turns it on, and the wallet modal's Swap action stays exactly the inert
    // "coming soon" it has been since POO-240.
    //
    // Distinct from `provisioning`, deliberately. That flag gates the pre-flight gate EMBEDDED in
    // the six operation modals; this one gates a standalone ROUTE. They share the whole rail below
    // them, and they are still two independent launch decisions: the funding gate can ship inside
    // invest long before a user-facing "move my money" screen does, or the other way round.
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_SWAP_SCREEN",
    // The description ships to the browser (this registry is client-imported), so it deliberately
    // does NOT name the server-only Uniswap key env var: UF-28 [R1] proves the boundary with a grep
    // over the build output, and a mention here would be a false positive in that gate.
    description:
      "Standalone swap + bridge screen at `/swap`, and the wallet modal's Swap action that routes to it. Runs on the shipped provisioning rail (ProvisioningPanel → buildPlanSteps), so a live route also needs real mode and the server-side Uniswap credentials. Route-guarded (404 while off).",
  },
  activeReserve: {
    key: "activeReserve",
    area: "Active Reserve",
    // POO-1067, hackathon POO-1057 (1inch Aqua). Dark-launched, and unlike every other flag here
    // this one is expected to be REMOVED rather than promoted: the entry ships to dev for judging
    // and does not go to production. The flag is therefore the removal seam. Turning it off must
    // leave zero trace on any other surface, which is why exactly two places read it: the two
    // routes (404 while off) and the promoted card at the top of the strategies list.
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_ACTIVE_RESERVE",
    description:
      "Active Reserve, an always-earning vault that buys ETH below market through a 1inch Aqua strategy. Reads Arbitrum directly rather than the Pool Party API, so it also needs NEXT_PUBLIC_AQUA_VAULT_ADDRESS pointed at a deployed PartyVault. Route-guarded (404 while off).",
  },
  cashPlus: {
    key: "cashPlus",
    area: "Cash+",
    // HACKATHON (public repository, 2026-09): default ON, like `hookTools` and the on-ramp pair, so a
    // fresh clone shows both products of the submission without an env file. `NEXT_PUBLIC_CASH_PLUS_MODE`
    // still selects preview (simulated ledger) unless set otherwise; the env var wins per environment.
    defaultEnabled: true,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_CASH_PLUS",
    description:
      "Dedicated Cash+ investment page and responsive navigation. Reads the selected chain directly; no catalog or portfolio integration.",
  },
  fiatOnRamp: {
    key: "fiatOnRamp",
    area: "Fiat on-ramp (Paybis)",
    // POO-1129 (epic), dark-launched (premise 10) on a flat baseline. This is the ONE authority on
    // whether the Paybis fiat on-ramp is a real funding option: the provisioning planner reads it to
    // decide whether to emit a `buy` leg (POO-1135, `computePlanAction` -> `buildPlan.onRampEnabled`),
    // and `resolveFundingRoutes` reads the SAME flag for its `onRampEnabled` input, so the plan behind
    // a buy route and the route the picker offers can never disagree.
    //
    // Ships OFF: POO-1135 lands the plan + picker surfaces, but execution (the widget, settlement,
    // leg re-sizing) is POO-1136 and the CTA repoint is POO-1137. Turning it on before those exist
    // would offer a buy route that dead-ends. Phase 6 (POO-1137) flips it per environment with
    // `NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP=true`, once the rail behind it is real.
    //
    // Distinct from `provisioning` (which gates the pre-flight gate as a whole) and `deposit` (the
    // standalone /deposit route): those can be on while fiat funding inside the gate is still off.
    //
    // HACKATHON (public repository, 2026-09): default ON. The Privy rail behind this pair is the
    // e2e flow the submission demonstrates (Google sign-in, embedded wallet, fiat checkout, add
    // liquidity), so a fresh clone runs it without an env file. The per-environment env var still
    // wins, and the decision table in `resolveOnRampProvider()` is unchanged.
    defaultEnabled: true,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP",
    description:
      "The Paybis fiat on-ramp as a first-class funding option inside provisioning (buy USDC/ETH on Base, then swap/bridge). Gates both the planner's `buy` leg and the FundingRoutePicker's buy route from one flag. Off until the on-ramp execution rail (POO-1136/1137) ships.",
  },
  privyOnRamp: {
    key: "privyOnRamp",
    area: "Privy on-ramp rail",
    // POO-1800, epic POO-1793. WHICH rail serves fiat, never WHETHER fiat is offered. That split is
    // the whole design: `fiatOnRamp` above stays the ONE authority on whether a buy is a funding
    // option at all, and this flag is only consulted after that one said yes ([R1]). Turning this on
    // alone changes nothing a buyer can see, which is what makes it safe to promote per environment
    // ahead of the migration.
    //
    // Read through `resolveOnRampProvider()` / `useOnRampProvider()` (PP-CORE-LIB-105,
    // PP-CORE-HOK-034), never as a second flag test at a host: the pair has three states
    // (`none` / `paybis` / `privy`) and a host that reads both booleans itself will eventually get
    // the table wrong in one place only.
    //
    // [R2] DEATH CONDITION, and it is a promise with a date rather than a hope: this flag is
    // deleted in the same PR that deletes the last Paybis module. A migration switch outlives its
    // migration exactly when nobody wrote down what ends it, so it is written here, in
    // docs/FEATURE_FLAGS.md, and pinned by a test in `registry.test.ts`. When the last Paybis module
    // goes, `resolveOnRampProvider` collapses to the `fiatOnRamp` read and this entry goes with it.
    //
    // KNOWN AND ACCEPTED, as for `onRampCapture` below: `NEXT_PUBLIC_FEATURE_ALL=on` sweeps this on
    // like every other flag, but only outside production (`resolve.ts` -> `isNonProdEnv`), and a dev
    // build swept on still buys against SANDBOX because `resolveOnRampEnvironment()` reads
    // `NEXT_PUBLIC_APP_ENV=development` ([R3]). Production requires the explicit
    // `NEXT_PUBLIC_FEATURE_PRIVY_ON_RAMP=on`, baked at build like every other NEXT_PUBLIC value.
    //
    // NOT a route gate, NOT `isManager`, NOT `isMockMode`: the vendor environment is DERIVED
    // (`resolveOnRampEnvironment`, [R3]) and mock-vs-real stays the hosts' own guard.
    //
    // HACKATHON (public repository, 2026-09): default ON. The Privy rail behind this pair is the
    // e2e flow the submission demonstrates (Google sign-in, embedded wallet, fiat checkout, add
    // liquidity), so a fresh clone runs it without an env file. The per-environment env var still
    // wins, and the decision table in `resolveOnRampProvider()` is unchanged.
    defaultEnabled: true,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_PRIVY_ON_RAMP",
    description:
      "Which rail serves the fiat on-ramp once `fiatOnRamp` has offered it: off = Paybis (today's rail), on = Privy. Never turns fiat on by itself, so it is safe to promote per environment before the migration lands. Deleted in the same PR that deletes the last Paybis module.",
  },
  onRampCapture: {
    key: "onRampCapture",
    area: "Paybis widget capture (diagnostics)",
    // POO-1598 S3/S4. NOT an area gate, NOT a control, NOT isManager, NOT isMockMode: it is a
    // TEMPORARY diagnostics instrument. On, the Paybis widget's postMessage stream is recorded as an
    // ordered, allow-list-redacted sequence on the first-party diagnostics rail
    // (`paybisCapture.ts`, PP-CORE-LIB-102). Off, not one record is shipped and the module is inert.
    //
    // It is in this registry rather than being a bare `NEXT_PUBLIC_*` value for the reason the
    // registry exists: one place answers "is this switched on in this environment", and a diagnostic
    // that reads a real buyer's checkout is exactly the thing that should not be discoverable only
    // by grepping for an env literal.
    //
    // Deliberately dark on a flat baseline, and the plan it serves is: ship off, deploy dev to prove
    // it is inert, cut a release, turn it on in production for ONE real purchase, turn it off, then
    // delete the whole instrument once the fixtures land (POO-1598 S5).
    //
    // KNOWN AND ACCEPTED: `NEXT_PUBLIC_FEATURE_ALL=on` sweeps this on like every other flag. That
    // switch is non-prod ONLY (`resolve.ts` -> `isNonProdEnv`), and dev runs Paybis SANDBOX with no
    // real buyer, so the population it can reach there is us. Production requires the explicit
    // `NEXT_PUBLIC_FEATURE_ON_RAMP_CAPTURE=on`, baked at build like every other NEXT_PUBLIC value.
    //
    // The Dev panel CANNOT flip this one, and that is a property of the reader rather than of this
    // entry: `paybisCapture.ts` arms through `isFeatureEnabled` -> `resolveFeature`, which reads the
    // registry default plus env and never consults `devOverrides.ts`. Only the `useFeatureFlags`
    // hook layers the Dev menu's QA overrides on top. So turning this on is a BUILD, deliberately,
    // and there is no in-session toggle that could start recording a live checkout by accident.
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_ON_RAMP_CAPTURE",
    description:
      "Temporary diagnostics: record the Paybis widget's postMessage stream as an ordered, redacted, retrievable sequence so one real purchase becomes a fixture set (POO-1598). NOT a route gate, NOT isManager, NOT isMockMode. Off = the module ships nothing at all.",
  },
  robinhoodChain: {
    key: "robinhoodChain",
    area: "Robinhood Chain (4663)",
    // POO-1776, epic POO-1766. A CHAIN PARTICIPATION gate, and the distinction is the whole design:
    // Robinhood stays in wagmi `supportedChains` unconditionally, so a wallet already sitting on
    // 4663 connects, signs SIWE and switches to it whatever this flag says. What the flag decides is
    // narrower, and it is two things: whether a network SELECTOR offers the chain as a place to put
    // money, and whether the app FANS OUT to it for data (`pools?network=robinhood`, the wallet
    // holdings read, the 4663 USDC RPC read). An alpha deployment that is reachable is fine; one the
    // product recommends is not, and one that every user's page load queries in an environment whose
    // backend has never heard of the slug is just a 400 per user.
    //
    // Off in dev AND prod on a flat baseline. Dev turns it on with
    // `NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN=on` in its untracked env BEFORE the image build, because
    // NEXT_PUBLIC_* is baked at build time rather than read at boot.
    //
    // NOT a route gate (there is no /robinhood route), NOT `isManager`, NOT `isMockMode`. Retire it
    // once the chain leaves alpha, per the launch checklist in docs/FEATURE_FLAGS.md.
    defaultEnabled: false,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN",
    description:
      "Whether network selectors OFFER Robinhood Chain (Arbitrum Orbit, id 4663, ETH gas, USDG stable) AND whether the app fans out to it for data (catalog, wallet holdings, on-chain balance reads). The chain stays a wagmi supported chain either way, so connecting and switching to it always works, and a holding on it still resolves a name and a logo. Off = the alpha deployment is reachable but never recommended and never queried.",
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
  hookTools: {
    key: "hookTools",
    area: "Tools (Uniswap v4 hook risk)",
    // ON by default, which no other `next` flag here is, and the exception is deliberate: this is
    // the HACKATHON DEMO FORK. The Tools page is the submission's front door, so a judge opening
    // the deployed app has to find it without anybody setting an env var first.
    //
    // That also makes the flag the removal seam, the same role `activeReserve` plays. If this page
    // ever merges toward production it ships OFF and is turned on per environment like everything
    // else; turning it off must leave no trace on any other surface, which is why exactly two
    // places read it, the route guard and the sidebar entry.
    defaultEnabled: true,
    stage: "next",
    envVar: "NEXT_PUBLIC_FEATURE_HOOK_TOOLS",
    description:
      "The Tools page at `/tools`: paste a deployed Uniswap v4 hook address and get the hookrisk report for it. Route-guarded (404 while off) and gates the sidebar entry. The scan runs server-side and needs the hookrisk toolchain plus ETHERSCAN_API_KEY on the host; without them the page reports what is missing rather than a clean bill of health.",
  },
};

/** All flag keys in registry (display) order. */
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
