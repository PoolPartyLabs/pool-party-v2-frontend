/**
 * @id PP-CORE (SETUP-014 / POO-82)
 * @name analytics events
 * @implements-rules-version v1
 *
 * Typed event catalog for Pool Party analytics. The living source of truth is
 * `docs/ANALYTICS_EVENTS.md`; this list must stay in sync with it (the `consistency-checker` skill
 * enforces the match). Taxonomy: `<area>_<object>_<action>`, snake_case, max 40 chars
 * (`docs/09_ANALYTICS.md` + `02_NAMING_CONVENTION.md` Part H).
 *
 * PP-SECURITY [R5]: only names in this union may be tracked; a typo will not compile.
 */
import type { AnalyticsErrorOrigin } from "./errorOrigin";
import type { AnalyticsBlockReason, AnalyticsTxExit, AnalyticsTxStep } from "./txFlowKit";

export const ANALYTICS_EVENTS = [
  // Auth and wallet
  "auth_signin_started",
  "auth_signin_completed",
  "auth_signin_failed",
  "auth_wallet_ready_viewed",
  "auth_logout",
  "wallet_connect_started",
  "wallet_connect_completed",
  "wallet_connect_failed",
  "wallet_disconnected",
  // Dashboard and portfolio
  "home_viewed",
  "portfolio_viewed",
  // POO-829 R7: a Portfolio positions sort-column/direction change (parity with strategy_sort_changed).
  "portfolio_sort_changed",
  "position_detail_viewed",
  // Strategies
  "strategy_list_viewed",
  "strategy_filter_applied",
  "strategy_sort_changed",
  "strategy_detail_viewed",
  "strategy_invest_started",
  "strategy_invest_submitted",
  "strategy_invest_completed",
  "strategy_invest_failed",
  "strategy_invest_resumed",
  "strategy_collect_started",
  // POO-1177 [R3]: collect was the ONLY money flow in this union with no mid-funnel step, while its
  // UI has had a full Review with its own approve CTA since POO-615. The gap was a defect in the
  // catalog, not a property of the flow, and it made collect the lone exception in a nine-flow
  // family. Fires on APPROVING the Review, matching `strategy_withdraw_submitted`.
  "strategy_collect_submitted",
  "strategy_collect_completed",
  "strategy_collect_failed",
  "strategy_withdraw_started",
  "strategy_withdraw_submitted",
  "strategy_withdraw_completed",
  "strategy_withdraw_failed",
  "strategy_share_opened",
  "strategy_share_period_changed",
  "strategy_share_target_clicked",
  "strategy_share_link_copied",
  "strategy_share_card_saved",
  // POO-906 [R5]: the Yield Receipt PNG export (or the native file-attach) failed - surfaced to the
  // user AND to analytics, never a silent no-op. Params carry ids only, never error text.
  "strategy_share_export_failed",
  // Manager — Launch strategy (create pool). POO-599: fired ONCE from the Launch-confirm approve (the
  // build→review→sign flow start, before the signatures); carries the pool id (the strategy has no id
  // yet at launch). No dedicated completed/failed event yet — the outcome surfaces via the console.
  "strategy_launch_submitted",
  // Transaction flows (cross-modal). POO-499: fired once per AUTOMATIC slippage retry (never on a
  // user-initiated retry); params carry the flow name + strategy id only, never any error text/code.
  "tx_slippage_retry",
  // Savings (POO-966). All TEN names survive POO-1250, because all ten are declared ahead of their
  // MERGE, not ahead of their build. `SavingsView.tsx`, `SavingsMarketDetailView.tsx` and
  // `SavingsTransactionModal.tsx` on `feat/sav-aave` and `feat/sav-poo-1200-sparklend-ethereum`
  // (both In Review) already emit every one of them; the modal pins the eight transaction names in
  // a `satisfies Record<SavingsPanelMode, Record<string, AnalyticsEvent>>` map. A union member is a
  // compile-time constraint, so deleting any of them breaks both branches on rebase, and the cheap
  // fix under pressure is to drop the emitter: exactly the silence this guard exists to catch.
  // Allow-listed under POO-966; they flip to `stale-allowlist` the moment the surface lands.
  "savings_list_viewed",
  "savings_market_viewed",
  "savings_deposit_started",
  "savings_deposit_submitted",
  "savings_deposit_completed",
  "savings_deposit_failed",
  "savings_withdraw_started",
  "savings_withdraw_submitted",
  "savings_withdraw_completed",
  "savings_withdraw_failed",
  // POO-1250: 23 names deleted here (10 token_*, 6 prediction_*, 7 perp_*) plus their seven orphan
  // params. They were declared years ahead of three surfaces that do not exist as code
  // (`src/features/{buy-tokens,predictions,perps}` hold one `.gitkeep` each), and anyone building a
  // GA4 dashboard from the catalog waited forever for rows that could never arrive. Deletion costs
  // zero history: none of these names ever had an emitter, so each has sent exactly zero rows
  // whether or not GTM is live (the prod container went live 2026-07-31).
  // Cards
  "card_explore_viewed",
  "card_detail_viewed",
  "card_freeze_toggled",
  "card_request_started",
  "card_request_completed",
  "card_topup_started",
  "card_topup_completed",
  // Deposit
  "deposit_started",
  "deposit_method_selected",
  "deposit_submitted",
  "deposit_completed",
  "deposit_failed",
  "deposit_crypto_started",
  "deposit_crypto_completed",
  // Universal Funding (epic POO-1022, POO-1048). The pre-flight provisioning funnel: can a user who
  // holds the money somewhere else actually find it, choose it, and land it on the operation's chain.
  // Emitted by PP-CORE-LIB-058; the ONE place the whole funnel is defined.
  "funding_gate_triggered",
  // POO-1501: screen 1, "Where from". The funnel had no step for the ROUTE choice at all, so a user
  // who opened the picker and left was indistinguishable from one who never reached it, and there
  // was no way to tell whether the `Recommended` chip is actually followed. `_viewed` is the view
  // class, `_chosen` the funnel step, `_abandoned` the abandonment. Emitted by PP-CORE-CMP-064.
  "funding_route_viewed",
  "funding_route_chosen",
  "funding_route_abandoned",
  // POO-1576: the method step between the buy amount and the Paybis checkout. The funnel had no step
  // for HOW the buyer pays, because the app never asked: a card was prefilled by regex and sent to
  // the mint. `_viewed` is the view class AND the step's start (the screen opens with the list;
  // there is no separate starting gesture, exactly as on `funding_route_viewed`), `_chosen` the
  // submission, `_abandoned` the abandonment, `_blocked` the blocked intent (a row the provider
  // would not price for this order), `_unavailable` the error class. Emitted by PP-CORE-LIB-058.
  "funding_method_viewed",
  "funding_method_chosen",
  "funding_method_abandoned",
  "funding_method_blocked",
  "funding_method_unavailable",
  // POO-1618: the buyer chose the fiat currency they pay in, which decides the method set they are
  // offered (`directa24_pix` is BRL-only, `poolparty-trustly` is USD-only) as much as the symbol on
  // the figures. Emitted by PP-CORE-LIB-058.
  "funding_method_currency_changed",
  // POO-1811 [R1]: how much of the run's shared price-move buffer each leg's re-quote asked for,
  // and what was left. MEASUREMENT ONLY: [R2] forbids it influencing sizing until a decision is
  // taken, and [R3] leaves the 5% rate to P4-3. Emitted by PP-CORE-CMP-046 through
  // PP-CORE-HOK-013's funnel, once per ask, held or refused.
  "funding_buffer_consumed",
  "funding_sources_listed",
  "funding_sources_selected",
  "funding_plan_quoted",
  "funding_plan_started",
  // POO-1048 [R3]: fired when a leg SETTLES, never when it broadcasts. A bridge leg has a hash
  // minutes before it has arrived, and reporting the hash as the outcome is the same lie as firing a
  // completion on a click.
  "funding_leg_settled",
  "funding_plan_completed",
  "funding_plan_failed",
  "funding_plan_abandoned",
  // POO-1507 [R29]: the mid-run `Stop here?` confirmation opened — a close attempt intercepted
  // rather than let through silently. Premise 11's blocked-intent event for this screen.
  "funding_run_stop_blocked",
  // POO-1506 [R40]: the mid-run `8b` prompt appeared (second slippage failure, raise-or-stop asked).
  // Premise 11's blocked-intent event for this screen.
  "funding_slippage_raise_blocked",
  // Tools — Uniswap v4 hook risk scan (PP-TOOLS-SCR-001 / PP-TOOLS-CMP-001). `completed` fires when
  // the REPORT is in hand, never on the Analyze click: a scan takes minutes, and a click reported as
  // a completion would make the funnel show a 100% success rate against a tool that can fail.
  "tools_hookrisk_viewed",
  "tools_hookrisk_started",
  "tools_hookrisk_completed",
  "tools_hookrisk_failed",
  // Blocked intent: the user asked for a scan and the product said no (bad address, chain we do not
  // read). Distinct from `failed`, which is a scan that was attempted and could not finish.
  "tools_hookrisk_blocked",
  // Rewards
  "reward_program_viewed",
  "reward_referral_shared",
  "reward_claimed",
  // App and navigation
  "page_viewed",
  "locale_changed",
  "web_vitals",
  "app_error_shown",

  // ===========================================================================================
  // POO-1171 (LANE-0): declared ahead of their emitters, each with an owner.
  //
  // Union members are inert (`as const` feeding a type), so landing names before the call sites
  // costs nothing at runtime. What it buys is that sixteen parallel lanes cannot each narrow
  // `flow` and `error_code` on their own branch, which is atomic by nature.
  //
  // EVERY name below is allow-listed in `scripts/analytics-check.ts` against the lane that owns
  // it. `pnpm analytics:check` fails a declared name with no emitter, so a lane cannot quietly
  // skip one: it either wires the emitter or the entry stays and names the owner. That interlock
  // is the whole reason this list is safe to land ahead of the work.
  // ===========================================================================================

  // LANE-1, the shared instrumentation kit (POO-1172). Cross-modal by construction:
  // `usePriceImpactGate` alone has five consumers, which is why these do not live in a feature lane.
  "tx_flow_abandoned",
  "tx_signature_requested",
  "tx_review_reached",
  "tx_impact_gate_blocked",
  "tx_impact_gate_acknowledged",
  "tx_amount_blocked",
  "tx_amount_preset_used",
  "tx_slippage_changed",
  "tx_receive_as_changed",
  "tx_fee_detail_expanded",
  "tx_retry_clicked",
  "app_cta_blocked",
  "app_unsaved_guard_shown",
  // LANE-16, app-level (POO-1183).
  "auth_signin_viewed",
  "nav_item_clicked",
  // LANE-12, InvestModal (POO-1175). `strategy_invest_confirmed` is ADDED at the Review Confirm
  // CTA rather than moving `strategy_invest_submitted`, so the existing series stays continuous.
  "strategy_invest_confirmed",
  "strategy_invest_deferred",
  // LANE-9, manager launch (POO-1180). `strategy_launch_submitted` has shipped without a
  // completion partner, so the entire supply-side funnel has had no conversion rate.
  "strategy_launch_completed",
  "strategy_launch_failed",
  // LANE-10, Move Range (POO-1181). A 1347-line modal that can currently emit exactly one event.
  "strategy_move_range_started",
  "strategy_move_range_submitted",
  "strategy_move_range_completed",
  "strategy_move_range_failed",
  "strategy_range_rejected",
  // LANE-11, Remove liquidity and Close (POO-1182). Close is NOT a separate family: it is this one
  // with `flow: "close"`, because `planRemoval` promotes a partial above 50% into a full close.
  "strategy_remove_started",
  "strategy_remove_submitted",
  "strategy_remove_completed",
  "strategy_remove_failed",
  // LANE-6, manager console entry (POO-1186). The manage detail is client-side state under an
  // unchanged pathname, so `page_viewed` cannot see it and every per-operation rate in LANE-9/10/11
  // is a numerator with no denominator.
  "strategy_manage_viewed",
  "wallet_action_blocked",
  // LANE-5, discovery (POO-1185). Never carries the query string: a free-text field can hold a
  // pasted address.
  "strategy_search_used",
  "strategy_search_no_results",
  "strategy_notify_requested",
  // LANE-4, rewards (POO-1184).
  "reward_game_played",
  "reward_claim_failed",
  "reward_referral_attached",
  "reward_code_created",
  // LANE-7, the fiat rail (POO-1178). These four bracket the cross-origin iframe we cannot see
  // into. `funding_buy_submitted` is named `submitted`, not `completed`, because it is the
  // provider's CLAIM that payment happened; `funding_buy_settled` is the observed balance delta and
  // is the only honest money-in number in the repository.
  "funding_buy_started",
  "funding_buy_submitted",
  "funding_buy_settled",
  "funding_buy_failed",
  // POO-1174, deposit. `deposit_address_copied` carries `chain_id` ONLY: the address is excluded by
  // derivation, never left to `sanitizeParams` to scrub.
  "deposit_address_copied",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Which transaction flow an event belongs to (POO-1171, gate POO-1169 [R4]).
 *
 * Closed on purpose, and load-bearing rather than decorative. POO-1169 [R4] settled that a
 * cross-flow lifecycle moment gets ONE generic event carrying this discriminator, never a per-flow
 * event name: deposit abandonment is `tx_flow_abandoned{flow:"deposit"}`, not `deposit_abandoned`.
 * That decision makes this union the axis the whole funnel is cut on, so an unlisted value is a
 * funnel row that silently lands nowhere.
 *
 * `deposit` is here because of that same decision, not because a `deposit` operation signs a
 * transaction like the others do.
 */
export const ANALYTICS_FLOWS = [
  "invest",
  "withdraw",
  "collect",
  "compound",
  "moveRange",
  "removeLiquidity",
  /**
   * A full wind-down. NOT a separate event family (POO-1182): Close is Remove liquidity with this
   * flow, because `planRemoval` promotes any partial above 50%, or one leaving dust, into a full
   * close. `strategy_remove_completed{flow:"close"}` IS the supply-side churn series.
   */
  "close",
  "createPool",
  "deposit",
] as const;

/**
 * `ProvisioningOp` / `FundingOperationKind` -> `AnalyticsFlow`. Total by construction, so a new op
 * cannot be added without the compiler forcing a flow decision. One map serves both, because
 * `FundingOperationKind` is `ProvisioningOp` plus `deposit` and they share the same spelling.
 *
 * Exists because closing the union caught a live inconsistency: the SAME `flow` param was being fed
 * two vocabularies for the same operation. `tx_slippage_retry` ships `"moveRange"` (from
 * `MoveRangeModal`) while the funding funnel ships `"move-range"` (from `ProvisioningOp`), so one
 * operation reports under two names and no GA4 filter can see both. `AnalyticsFlow` is camelCase,
 * matching the vocabulary this file already documented, and this map is the single boundary where
 * the provisioning spelling is converted.
 *
 * Fixing it costs near-zero history: the prod GTM container (GTM-T85DB3PL) went live on
 * 2026-07-31, so only a few days of rows carry either spelling, and POO-1168 is still
 * re-baselining. The rename was signed off deliberately rather than assumed free.
 */
export const PROVISIONING_OP_TO_FLOW = {
  invest: "invest",
  withdraw: "withdraw",
  collect: "collect",
  compound: "compound",
  "move-range": "moveRange",
  close: "close",
  deposit: "deposit",
} as const satisfies Record<string, AnalyticsFlow>;

export type AnalyticsFlow = (typeof ANALYTICS_FLOWS)[number];

/**
 * Which product surface produced the event (POO-1169 [R3]).
 *
 * Without it an investor `strategy_invest_completed` and a manager one are the same row, so every
 * manager engagement number is uncomputable. Landed with the taxonomy rather than a lane later,
 * because an event emitted before this exists is born without the discriminator and has to be
 * retrofitted across every manager surface.
 */
export const ANALYTICS_SURFACES = ["investor", "manager"] as const;

export type AnalyticsSurface = (typeof ANALYTICS_SURFACES)[number];

/**
 * Whether a money `value` is the amount that SETTLED or the amount we expected to settle
 * (POO-1176 [R2]).
 *
 * This exists because on withdraw the executed figure genuinely does not always exist. Only a USDC
 * leg carries a USD value (`receivedAmounts.ts`), since the frontend has no price source for
 * anything else, so a payout in the pool's token pair can be decoded into per-token amounts and
 * still have no truthful USD total. An OWNED position is pair-only by mandate (POO-804 [R1]), which
 * means the executed total NEVER exists for a manager withdrawal.
 *
 * The alternatives were both worse. Reporting `usdcUsd` regardless would ship a number understated
 * by the whole non-USDC half; omitting `value` would drop every manager withdrawal out of the
 * series entirely. So the estimate is reported and the row says it is an estimate.
 *
 * Read it as a qualifier on `value`, never as a funnel dimension: `executed` means the number came
 * from the mined receipt, `estimated` means it came from the pre-broadcast figure the user was
 * shown. A report that must not mix the two filters on this.
 */
export const ANALYTICS_VALUE_BASES = ["executed", "estimated"] as const;

export type AnalyticsValueBasis = (typeof ANALYTICS_VALUE_BASES)[number];

/**
 * How the user signed in (POO-1183 [R4]).
 *
 * The activation funnel's whole question is "Google vs Wallet", and without a discriminator both
 * methods land in one undifferentiated `auth_signin_*` row. A per-method event NAME was rejected:
 * this taxonomy answers a cross-flow lifecycle moment with ONE generic event plus a discriminator
 * param, the same rule that cut `deposit_abandoned` and `strategy_collect_submitted`.
 *
 * Closed at the two methods `SignInScreen` actually offers. Privy's `loginResult.loginMethod` is
 * deliberately NOT the source: it is an unbounded string (`string | null` in `useAuth`) carrying
 * every method Privy supports, so feeding it here would reopen the union to values no screen can
 * produce. The emitter sends the button the user pressed, or omits the param when there was none.
 */
export const ANALYTICS_AUTH_METHODS = ["google", "wallet"] as const;

export type AnalyticsAuthMethod = (typeof ANALYTICS_AUTH_METHODS)[number];

/**
 * Which navigation entry was activated (POO-1183 [R7]).
 *
 * A SUPERSET of `AppShell`'s `NavLabelKey`, on purpose: the manager console and the admin shell have
 * their own navigation and will join this union without touching the investor shell's type.
 *
 * The direction of the relationship is load-bearing. `NavLabelKey` must NOT be widened to this
 * union: it keys `Record<NavLabelKey, string>` for the literal `t()` calls the static i18n scan
 * depends on, so widening it would demand label entries for keys that shell has no nav item for.
 * The emitter proves assignability with a `satisfies` check instead, which makes adding a nav item
 * without an analytics key a compile error rather than a silently untracked tab.
 */
export const ANALYTICS_NAV_ITEMS = [
  "home",
  "invest",
  "portfolio",
  "strategies",
  "cards",
  "deposit",
  "profile",
  "rubberRush",
  "managerIncentive",
] as const;

export type AnalyticsNavItem = (typeof ANALYTICS_NAV_ITEMS)[number];

/**
 * The error codes THIS repository produces, for a failure that never reached the API.
 *
 * Closed on purpose: these are ours, so a typo should not compile. Codes originating in the API are
 * NOT listed (see `error_code` on {@link AnalyticsParams} for why mirroring 67 backend codes across
 * a repo boundary was rejected); they pass through validated by shape instead.
 *
 * Sourced from `src/lib/uniswap/errors.ts` and `src/lib/tx/diagnostics.ts`, verified against the API
 * catalog on 2026-08-01: every name here is one the backend does NOT define.
 */
export const ANALYTICS_ERROR_CODES = [
  /** Ours: `errorCode.ts` `KIND_CODES.chainUnavailable`, POO-1385, the wallet lacks the network. */
  "CHAIN_UNAVAILABLE",
  /** Ours: `errorCode.ts` `KIND_CODES.rangeUnchanged`, POO-1711, the move-range "nothing to move" guard. */
  "MOVE_RANGE_UNCHANGED",
  /**
   * The PAYBIS-era codes, MINTED BY TEMPLATE from the widget's terminal states:
   * `StandaloneOnRampRail.tsx:136` and `ProvisioningPanel.tsx`'s copy of the same function both
   * build `` `ONRAMP_${status.toUpperCase()}` `` out of `PaybisWidgetTerminalStatus`. No literal for
   * them exists anywhere in `src`, which is why `errorCodeUnion.test.ts` has to exempt exactly these
   * five by name, and pins the template that produces them so the exemption cannot outlive it.
   *
   * @deprecated PP-TODO(POO-1809): they serve the live Paybis rail (decision D13) and go with the
   * last Paybis module. Nothing here is deleted before then, because deleting a code that is still
   * thrown would make a live failure unreportable.
   */
  "ONRAMP_CANCELLED",
  "ONRAMP_CLOSED",
  /** @deprecated PP-TODO(POO-1809): the widget's `error` terminal state. */
  "ONRAMP_ERROR",
  /** Ours: the rail's `fallbackErrorCode` (`StandaloneOnRampRail.tsx`). Written, not minted. */
  "ONRAMP_FAILED",
  /** Ours: `onRampActions.ts`, a mint refused locally before any upstream call. */
  "ONRAMP_INVALID_REQUEST",
  /** @deprecated PP-TODO(POO-1809): the widget's `rejected` terminal state. */
  "ONRAMP_REJECTED",
  /** Paid but not yet on chain. Rail-neutral, and it outlives Paybis. */
  "ONRAMP_SETTLING",
  /** @deprecated PP-TODO(POO-1809): the widget's `unavailable` terminal state. */
  "ONRAMP_UNAVAILABLE",

  /**
   * POO-1813 [R1]: the codes this repo ALREADY throws and never listed.
   *
   * Found by grepping every `ONRAMP_` literal in `src/`, which is the evidence, our own tree rather
   * than a number from a spec: this list was 8 names against 20 reachable codes when the issue was
   * written. Five of the remainder are backend-originated and correctly excluded (they appear only
   * in tests that exercise an API failure). The rest are OURS and were simply missing, which is the
   * same omission POO-1173 fixed once already, by hand, and the reason `errorCodeUnion.test.ts` now
   * pins the list in BOTH directions rather than in neither.
   */
  /** Ours: `DepositScreen.tsx` rejects a pending resume question on unmount (POO-1642 [R8]). */
  "ONRAMP_ABANDONED",
  /** Ours: `onRampActions.ts`, the supported-currency read failed. */
  "ONRAMP_CURRENCIES_UNAVAILABLE",
  /** Ours: `useProvisioningRail.ts`, a priced ETH target too small to transact with. */
  "ONRAMP_ETH_AMOUNT_UNUSABLE",
  /** Ours: `onRampActions.ts`, no ETH price to size the gas-first leg against. */
  "ONRAMP_ETH_PRICE_UNAVAILABLE",
  /** Ours: `schemas.ts`, the shared name for an ETH order that could not be priced. */
  "ONRAMP_ETH_UNPRICED",
  /** Ours: POO-1808 [R4], this rail does not sell the native coin. */
  "ONRAMP_NATIVE_UNAVAILABLE",
  /** Ours: POO-1808 [R6], no provider will sell to this buyer right now. */
  "ONRAMP_UNCOVERED",
  /** Ours: POO-1808 [R7], the buyer's resolved currency is not one this rail can charge in. */
  "ONRAMP_CURRENCY_UNSUPPORTED",
  /** Ours: POO-1808, the observation loop itself broke. Our failure, and never the buyer's. */
  "ONRAMP_OBSERVER_FAILED",

  /**
   * POO-1813 [R1]: the PRIVY-era family, one code per classifier reason
   * (`classifyAddFundsOutcome.ts`), mapped in `fundingBuyFunnel.ts` and never folded:
   * `popup_blocked` and `not_authenticated` are both hard noes that call for opposite fixes.
   */
  /** We sent a destination address the SDK rejected before opening anything. */
  "ONRAMP_INVALID_DESTINATION_ADDRESS",
  /** The same, for the CAIP-2 chain. */
  "ONRAMP_INVALID_DESTINATION_CHAIN",
  /** The same, for the token address. */
  "ONRAMP_INVALID_DESTINATION_ASSET",
  /** The buyer is not signed in, so no checkout can be opened for them. */
  "ONRAMP_NOT_AUTHENTICATED",
  /** A purchase is already open: a hard no for THIS call, which opened nothing. */
  "ONRAMP_FLOW_ALREADY_OPEN",
  /** We passed an empty supported-currency list. Ours to fix, not the provider's. */
  "ONRAMP_EMPTY_FIAT_ASSETS",
  /** Neither a fiat nor a crypto config reached the SDK. */
  "ONRAMP_NO_FUNDING_CONFIG",
  /** The browser refused the window, usually because an await crept in before the call. */
  "ONRAMP_POPUP_BLOCKED",
  /** The adapter's own refusal: no `defaultAsset` at all, before the SDK is reached. */
  "ONRAMP_MISSING_DEFAULT_ASSET",
  /** The adapter's other refusal: a currency present, but outside the rail's own union. */
  "ONRAMP_UNSUPPORTED_FIAT_ASSET",
  /** The deposit checkout had no destination to watch. Ours, and unreachable while Base ships. */
  "ONRAMP_DESTINATION_UNAVAILABLE",
  /** The inconclusive exit: the buyer closed the surface and we do not know what happened. */
  "ONRAMP_USER_EXITED",
  /**
   * The other inconclusive exit: the provider surface never settled at all, so the visible wait
   * gave up after its bound (POO-1923 [R2], `PROVIDER_TIMEOUT_MS`). Like `ONRAMP_USER_EXITED` and
   * unlike every refusal above it, this asserts only that we stopped waiting, never that the card
   * was not charged.
   */
  "ONRAMP_PROVIDER_TIMEOUT",
  /** A rejection we could not classify at all. */
  "ONRAMP_UNKNOWN_ERROR",
  /** A success shape we do not recognise, which is not the same as a success. */
  "ONRAMP_UNKNOWN_SUCCESS_STATUS",
  /**
   * The visible observation window closed with no claim and no delta (ADR-0006). It asserts only
   * that we never saw the money, never that nothing was charged, which is why it rides a blocked
   * intent rather than a failure.
   */
  "ONRAMP_UNVERIFIED",
  /**
   * A classifier reason with no entry in the map yet.
   *
   * Deliberate rather than a throw: a provider that adds a rejection message must not be able to
   * break a purchase through the analytics path, and this appearing in a report IS the signal that
   * `ONRAMP_REASON_CODES` needs a row.
   */
  "ONRAMP_UNMAPPED",
  /** Ours: `errorCode.ts` `KIND_CODES.gasBlocked`, raised by the provisioning planner. */
  "PROVISIONING_GAS_BLOCKED",
  "SYSTEM_NETWORK_ERROR",
  "SYSTEM_PARSE_ERROR",
  "SYSTEM_TIMEOUT",
  "SYSTEM_UNAVAILABLE",
  "SYSTEM_UNKNOWN",
  "TX_ALREADY_USED",
  "TX_FAILED",
  "TX_NOT_FOUND_FOR_WALLET",
  "TX_REVERTED",
  /** Ours: `errorCode.ts` `KIND_CODES.userRejected`, the name a provider `4001` resolves to. */
  "USER_REJECTED",
  "WALLET_NOT_FOUND",
  /**
   * POO-1173 D1 [R3]: ours, thrown at `sendTransaction.ts:82` when the connected account is not the
   * one the transaction was built for. This list is meant to be exactly the codes we produce, and
   * it was already incomplete: the code has shipped for months and was simply never added here.
   *
   * The seven entries added beside it are the rest of that same omission, found by reading the two
   * places that actually mint our codes: `KIND_CODES` (`errorCode.ts`), whose fallback names ARE
   * emitted on every failure the classifier folds, and the `ONRAMP_${status.toUpperCase()}` map in
   * `StandaloneOnRampRail.tsx`, which produces four names of which only `ONRAMP_CLOSED` was listed.
   * The list has no runtime or compile-time teeth (`error_code` widens to `| string`), so being
   * exhaustive is its only value; an incomplete list is a false inventory of what we emit.
   */
  "WRONG_ACCOUNT",
  /** Ours: `errorCode.ts` `KIND_CODES.wrongChain`, raised by `assertProviderOnChain`. */
  "WRONG_CHAIN",
] as const;

export type AnalyticsErrorCode = (typeof ANALYTICS_ERROR_CODES)[number];

/**
 * Whether a value is shaped like an error code: `<DOMAIN>_<REASON>`, uppercase snake_case.
 *
 * This is the guard that replaces a mirrored union for API-originated codes. It is a SHAPE check,
 * not a membership check, and the distinction is the whole design: it lets a new backend code reach
 * GA4 the day the API ships it, while refusing the thing POO-1171 was actually worried about, an
 * unbounded string landing in `error_code` and generating a `(other)` bucket per distinct message.
 *
 * The 40-character ceiling matches the event-name limit in `docs/09_ANALYTICS.md`.
 *
 * POO-1173 D1 [R4] corrects what stood here. It claimed "free prose fails it on the first space",
 * which overstates the guarantee: the API's `toMachineCode(label)` is
 * `label.trim().replace(/\W+/g, "_").toUpperCase()`, applied UPSTREAM of this check, so it converts
 * spaces to underscores before the value ever arrives. Any label of six words or fewer therefore
 * reaches us shape-compliant, and `"Insufficient funds for gas"` passes as
 * `INSUFFICIENT_FUNDS_FOR_GAS`.
 *
 * What holds: prose that has NOT been through `toMachineCode` fails on its first space, and
 * cardinality stays low in practice because the field carries HTTP status text rather than free
 * user input. What does not hold is the absolute claim. The real floor is that a value reaching GA4
 * is uppercase snake_case under 40 characters, which is the backend's published contract, not that
 * it is a member of any enumerable set.
 */
export function isAnalyticsErrorCodeShape(value: string): boolean {
  return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,5}$/.test(value) && value.length <= 40;
}

/**
 * How a MULTI-VALUED param spells "nothing selected" (POO-1882 [R2]).
 *
 * An empty string will not do. GA4 reports an empty-string parameter value as `(not set)`, which is
 * indistinguishable from the parameter never having been sent, so "the user cleared every filter"
 * would arrive as an absence of data rather than as the deliberate signal it is. An explicit
 * sentinel keeps the cleared state a first-class, countable row.
 *
 * It can never collide with a real value: it is not a member of any canonical identifier set this
 * param carries, and a non-empty join always contains at least one identifier.
 */
export const ANALYTICS_MULTI_VALUE_EMPTY = "none";

/**
 * The repo's ONE encoding for a multi-valued GA4 parameter (POO-1882 [R4] [R6]). Every multi-select
 * event uses this; a second convention would make two dimensions that cannot be compared.
 *
 * Sorted, comma-joined, no spaces, {@link ANALYTICS_MULTI_VALUE_EMPTY} when empty.
 *
 * WHY a string and not an array: a GA4 event parameter value must be a scalar (string, number or
 * boolean). An array survives the `sanitizeParams` scrub untouched and reaches the dataLayer, where
 * the GTM → GA4 boundary either drops it or stringifies it in a way this repo does not control.
 * Committing to the string here makes the wire format ours and testable.
 *
 * WHY sorted: without a canonical order, `{bitcoin, equities}` and `{equities, bitcoin}` are two
 * distinct GA4 rows for one selection, and the dimension's cardinality doubles for every additional
 * option. Sorting is what makes the dimension groupable at all.
 *
 * GA4 LIMITS, checked before committing to this shape ([R6]): a text parameter value is capped at
 * 100 characters and TRUNCATED past it, and an event may carry at most 25 parameters. One string
 * costs one parameter slot regardless of how many values it holds, where a boolean-per-option
 * encoding would cost one slot each and still could not express order. The widest selection this
 * param carries today (all seven `AssetTag`s) is 55 characters, well inside the ceiling; a future
 * caller with a much larger value space must re-check that headroom rather than assume it.
 */
export function joinAnalyticsMultiValue(values: readonly string[]): string {
  // Copy before sorting: `Array.prototype.sort` mutates in place, and the caller's array here is
  // React state (the live selection), which must never be reordered by an analytics call.
  return [...values].sort().join(",") || ANALYTICS_MULTI_VALUE_EMPTY;
}

export interface AnalyticsParams {
  /** Monetary value, denominated in {@link currency} (GA4 standard). Exact values are allowed. */
  value?: number;
  /**
   * ISO-4217 code {@link value} is denominated in. Required by GA4 whenever `value` is present.
   *
   * POO-1576 widened this from the `"USD"` literal it had been, because since POO-1512 this app no
   * longer charges everyone in dollars: a payment method's own floor arrives in the buyer's
   * resolved currency (`minCurrencyCode`), and reporting a EUR 500 minimum as USD would be a wrong
   * number rather than an imprecise one. GA4 converts per currency at report time, which is exactly
   * why it requires this field beside `value`, so a mixed-currency series is handled by the
   * platform rather than by pretending. Every figure that IS dollars still sends `"USD"`, and the
   * whole shipped funnel does.
   */
  currency?: string;
  /** USD value at the moment of the transaction (price-at-time rule). */
  usd_value_at_time?: number;
  token_amount?: number;
  token_symbol?: string;
  strategy_id?: string;
  position_id?: string;
  /**
   * Which transaction flow an event belongs to (POO-499 `tx_slippage_retry`): the flow's operation
   * name, e.g. "invest" / "withdraw" / "collect" / "compound" / "moveRange" / "removeLiquidity" /
   * "createPool" (POO-510: the manager Launch strategy flow).
   */
  flow?: AnalyticsFlow;
  /** Which product surface produced the event (POO-1169 [R3]). */
  surface?: AnalyticsSurface;
  /**
   * Whether `value` settled or was expected to settle (POO-1176 [R2]). Values in
   * {@link ANALYTICS_VALUE_BASES}. Only meaningful on an event that carries `value`.
   */
  value_basis?: AnalyticsValueBasis;
  /**
   * Where a user was when they abandoned a transaction flow (POO-1172). Values in
   * `ANALYTICS_TX_EXITS`; the union lives in `txFlowKit.ts` beside the observer that emits it,
   * because it was derived from the five modal `Phase` machines rather than declared ahead of them.
   */
  tx_exit?: AnalyticsTxExit;
  /**
   * How far `useProvisioningGate`'s live context read had got when `evaluate()` declined to gate an
   * operation (POO-1552 [R1]). Mirrors `ProvisioningGateStatus` (`useProvisioningGate.ts`) as a
   * literal union rather than importing it, so this file never depends on a client hook. Carried on
   * `strategy_invest_deferred` so production telemetry can tell "the flag is off" apart from "we
   * could not read the wallet" apart from "we read it and nothing was missing" instead of every
   * decline reading the same: a funded wallet sent to `/deposit` looked identical to an empty one.
   */
  gate_status?: "inert" | "loading" | "ready" | "unavailable";
  /**
   * Which wallet prompt a `tx_signature_requested` is for (POO-1172). Values in
   * `ANALYTICS_TX_STEPS`: the prompts only, never the server `build` step and never the provisioning
   * legs, which already report through `leg_kind`.
   */
  tx_step?: AnalyticsTxStep;
  /**
   * Why a CTA could not act (POO-1172). Values in `ANALYTICS_BLOCK_REASONS`.
   *
   * A CODE, never a label. The one enumerated set of block reasons in the repo builds TRANSLATED
   * strings, and sending those would produce eleven variants of one reason and leak product copy
   * into an analytics property.
   */
  block_reason?: AnalyticsBlockReason;
  /**
   * The cross-service trace id (POO-1212 [1]). Makes a GA4 row joinable to the Sentry issue holding
   * the stack trace and to the indexer log line holding the cause.
   *
   * Merged automatically in `useAnalytics` from `browserTraceId()`; callers do not pass it.
   *
   * PP-ANALYTICS: send it, read it in BigQuery, and **never register it as a GA4 report dimension**.
   * It is high-cardinality random hex and would blow the `(other)` row bucketing. It is not
   * identity, so there is no privacy question.
   */
  trace_id?: string;
  /** Savings market the event is about (POO-966). Every `savings_*` name but the list view passes it. */
  market_id?: string;
  risk_level?: 1 | 2 | 3 | 4 | 5;
  /**
   * The Explore asset-category selection AFTER the toggle that fired `strategy_filter_applied`
   * (POO-1882 [R1]), encoded by {@link joinAnalyticsMultiValue}.
   *
   * The resulting SET, not the chip that was clicked ([R1]). A per-click record cannot answer "what
   * were people filtering to" without replaying a whole session, and it is fragile to out-of-order
   * clicks; the set answers it directly and is order-independent. Every toggle emits in both
   * directions, and clearing the last chip emits {@link ANALYTICS_MULTI_VALUE_EMPTY} ([R2]).
   *
   * Values are CANONICAL `AssetTag` identifiers, never the translated label ([R3]). Two reasons,
   * either one sufficient: a label would fork one selection into twelve locale-dependent strings,
   * and `equities` ("Stock Tokens") and `rwa` ("Real-world assets") are compliance-constrained copy
   * (`docs/COMPLIANCE_REGISTER.md` CR-MGR-008 (b)) that must not become analytics keys.
   *
   * PP-ANALYTICS: `equities` and `rwa` are FEATURE-GATED behind `robinhoodChain` (POO-1880 [R7],
   * POO-1890 [R5]), so those two values are absent from production data until that flag flips. That
   * is the gate working, not broken instrumentation.
   */
  asset_categories?: string;
  /**
   * The Explore strategy-type selection after the change that fired `strategy_filter_applied`
   * (POO-1882 [R5]). A canonical `StrategyType` (`yield` / `trading` / `index` / `market-neutral`),
   * never the translated option label, and {@link ANALYTICS_MULTI_VALUE_EMPTY} when the filter is
   * cleared back to "All" — for the same reason the category param has a sentinel: GA4 reports an
   * empty string as `(not set)`, erasing the difference between "cleared" and "never sent".
   *
   * Deliberately a `string` rather than the `StrategyType` union: this file must not import from
   * `@/lib/schemas` (the existing params follow the same rule, mirroring unions as literals or
   * widening), and the caller is the one screen that owns the control.
   */
  strategy_type?: string;
  // POO-1250 deleted seven params orphaned by the 23 deleted names: `order_type`, `order_status`,
  // `side`, `outcome`, `leverage`, `prediction_id`, `perp_market`. Four neighbours that LOOK like
  // they belong to the same cleanup were deliberately kept, each because something still needs it:
  // `market_id` (above), `card_issuer` (the seven card_* names stay declared, POO-1115),
  // `risk_level` (live in StrategiesExploreScreen + StrategyDetailScreen) and
  // `token_symbol` / `token_amount` (live in DepositScreen).
  card_issuer?: string;
  /** Which rewards program: rubber_rush / manager_incentive_program / referral. */
  reward_program?: "rubber_rush" | "manager_incentive_program" | "referral";
  /** Earnings window selected on the share-yield modal (PP-STR-MOD-009). */
  share_period?: "24h" | "7d" | "30d";
  /** Share destination chosen on the share-yield modal. */
  share_target?: "x" | "telegram" | "whatsapp" | "instagram" | "save";
  /**
   * How a deposit is funded. POO-1513 widened the VALUE SPACE from a local
   * `pix | card | applePay | bank` union to the Paybis payment-method identifier
   * (`poolparty-credit-card`, `poolparty-sepa`, ...), because the picker is now built from the
   * provider's live list and a closed union could not name a method Paybis added. `"crypto"` stays as
   * the non-fiat path's own value. `docs/ANALYTICS_EVENTS.md` records the discontinuity so the series
   * either side of it is not read as continuous.
   *
   * POO-1813 [R2]: TWO vocabularies live here at once, and which one you get depends on the rail.
   *
   *   * Paybis (`/deposit`'s method picker): a payment-method ID, e.g. `poolparty-credit-card`.
   *     That rail lets us choose the method, so it can report which one.
   *   * Privy: the top-level CHOICE only, `"onramp"` or `"crypto"`. The provider owns the picker
   *     inside its own surface and never tells us which method was used, so any value narrower than
   *     that would be invented.
   *
   * Widened rather than deleted on purpose: the name is live and carries a real Paybis series, and
   * deleting it would take the history with it. PP-TODO(POO-1809): when the last Paybis module goes,
   * narrow this to `"onramp" | "crypto"` and say so in `docs/ANALYTICS_EVENTS.md`.
   */
  deposit_method?: string;
  /**
   * Which sign-in method the user chose (POO-1183 [R4]). Omitted, never guessed, when the session
   * arrived already authenticated and there was no button press to attribute.
   */
  auth_method?: AnalyticsAuthMethod;
  /** Which navigation entry was activated (POO-1183 [R7]). */
  nav_item?: AnalyticsNavItem;
  chain_id?: number;

  // --- Universal Funding funnel (POO-1048 [R2]) --------------------------------------------------
  // What a funding route IS, in the three dimensions the funnel is analysed on: its shape, its
  // length and its size. Deliberately no wallet, no token address and no transaction hash: the
  // question these answer is "do users complete cross-chain funding", not "who funded what".
  /**
   * The route's shape. `same-chain` a swap where the operation lives · `cross-chain` one bridge of
   * an asset the user already holds · `decomposed` a swap feeding a bridge, which is what a
   * different-token cross-chain pair becomes because the Trading API does not route it directly.
   *
   * First knowable at `funding_plan_quoted`: before a route is quoted there is no shape, and
   * guessing one at the gate would report an intention as a fact.
   */
  route_shape?: "same-chain" | "cross-chain" | "decomposed";
  /** Executable legs in the plan, never counting the `op` display anchor. */
  leg_count?: number;
  /**
   * The route leg a funnel event is about. Tracks `ProvisioningStepType` minus its `op` anchor, with
   * ONE deliberate exception: the step type `"buy-usdc"` was renamed to `"buy"` (POO-1131), but this
   * GA4 wire value stays `"buy-usdc"` ([R9]). Renaming it would split the live funnel into two series
   * with no historical bridge, and funnel continuity beats naming symmetry. `provisioningFunnel.ts`
   * maps the `buy` step to this pinned string; a future author must NOT "fix" the apparent mismatch.
   */
  leg_kind?: "buy-usdc" | "bridge" | "bridge-gas" | "swap-gas" | "swap-token";
  /** The leg's position in the route, 0-based. Which leg users lose money and patience on. */
  leg_index?: number;
  /**
   * POO-1813 [R3]: the fiat purchase funnel's shared shape (`fundingBuyFunnel.ts`).
   *
   * `attempt_id` is OUR intent id and never a provider reference: ours is an opaque key we mint,
   * while a provider's may encode an account or a session. It is not PII and it is what joins the
   * four `funding_buy_*` rows into one purchase.
   */
  rail?: "paybis" | "privy";
  attempt_id?: string;
  /**
   * The classifier's verdict at the time of the row: `no`, `maybe` or `confirmed`.
   *
   * `maybe` is not a lesser `confirmed`. On the Stripe path a charged card and an abandonment are
   * the same rejection (ADR-0006), so `maybe` is where a real charge lands; the popup providers
   * still report `provider-confirming` and arrive as `confirmed`. Reported so the asymmetry is
   * measurable, never so that anything branches on it.
   */
  moved?: "no" | "maybe" | "confirmed";
  /** The classifier's own reason string, beside the mapped {@link error_code}. */
  reason?: string;
  /** ISO-4217, the currency the buyer is CHARGED in. Never the currency a figure is sized in. */
  fiat_currency?: string;
  /**
   * [R4] The figures POO-1811's purchase half needs, all USD. The gap between `requested_usd` and
   * `prefill_usd` is our buffer; the gap between `prefill_usd` and `delivered_usd` is the provider's
   * spread. `delivered_usd` is the OBSERVED delta and nothing else.
   *
   * `prefill_usd` is OMITTED, never `0`, when we prefilled nothing: a buyer paying in another
   * currency is sent no amount at all, and a zero there would be averaged into the buffer series as
   * a figure we never asked for.
   */
  requested_usd?: number;
  prefill_usd?: number;
  delivered_usd?: number;
  /**
   * POO-1811 [R1] The buffer measurement, in BASIS POINTS throughout: bps is the unit the gate
   * already decides in, so reporting anything else would make the series need a conversion before
   * it could be compared against the thing it measures. No fiat amount rides along beyond the
   * headroom, and no address.
   */
  buffer_asked_bps?: number;
  /** The run's running total AFTER this ask. Unchanged when the ask was refused. */
  buffer_cumulative_bps?: number;
  /**
   * The whole budget for the run, in bps: the rate the run was SEEDED with (POO-1812 [R4]), which is
   * `DEFAULT_SOURCE_BUFFER_RATE * 10_000` (500) wherever no slippage reached the seed. Pinned for the
   * life of the run, so a mid-run raise is visible as {@link rate_bps} above this, never as a budget
   * that moved after the fact.
   */
  buffer_budget_bps?: number;
  /** What is left. Never negative: the ask that would have gone under was refused instead. */
  buffer_headroom_bps?: number;
  /** Whether the ask was absorbed. `false` is the leg that tripped the gate. */
  buffer_held?: boolean;
  /**
   * Which ASK this is within the run, 0-based, so the series can be read back in order.
   *
   * Deliberately NOT `leg_index`, which is the leg's position in the ROUTE and is what
   * `funding_leg_settled` reports. The two do not coincide: `gateRequote` only asks the buffer once
   * a re-quote is materially worse, so legs that did not move never ask, and a leg retried after a
   * failure asks twice. The rail's `consumeBuffer` is `(worseBps) => boolean` and carries no leg
   * identity, so this ordinal is all there is until that signature changes.
   */
  buffer_ask_index?: number;
  /**
   * POO-1812 [R6]: the slippage tolerance in force when the ask happened, in PERCENT.
   *
   * Reported as the buyer set it (`sanitizeSlippageInput` already holds the control to one decimal),
   * so it carries no arithmetic of its own and cannot drift. OMITTED, never zeroed, when the surface
   * that asked has not threaded a slippage figure into the provisioning gate: a zero here would read
   * as "the buyer accepts no slippage", which is a different fact from "nobody told us".
   */
  slippage_pct?: number;
  /**
   * POO-1812 [R6]: the buffer rate that tolerance implies, in BASIS POINTS and always an integer.
   *
   * The panel derives it once as `Math.round(rate * 10_000)` over a rate already quantised to whole
   * percentage points, because `0.06 * 10_000` is `699.9999999999999` and a dimension carrying that
   * is one nobody can group by. Read against {@link buffer_budget_bps}, which stays pinned to the
   * SEEDED rate: equal on an ordinary run, and above it exactly when the buyer raised slippage
   * mid-run. Omitted, never zeroed, on the same rule as {@link slippage_pct}.
   */
  rate_bps?: number;
  /** Funding sources listed or selected. Zero listed is the signal a funded wallet found nothing. */
  source_count?: number;
  /**
   * Where a `funding_plan_abandoned` session was when the user left it.
   *
   * POO-1384 added `buy`, split out of `pending`. That release deliberately made the fiat checkout
   * dismissable, and without its own value the new escape hatch was indistinguishable from abandoning
   * a bridge wait: we would have opened an exit on a money flow and been unable to count it.
   */
  funding_exit?: "sources" | "plan" | "pending" | "buy" | "settling" | "error";
  /**
   * POO-1501, screen 1. Which route the user took, and whether it was the recommended one.
   *
   * `funding_route_followed_recommendation` is the pair's whole point. `Recommended` ([R6]) is a
   * claim the product makes about the cheapest path, and without this we could count route choices
   * forever and never learn whether the badge changes any of them. `"none"` is a real value on
   * `_recommended`, not a gap: a one-card screen deliberately carries no chip.
   */
  funding_route?: "tokens" | "tokens-plus-buy" | "buy" | "deposit";
  funding_route_recommended?: "tokens" | "tokens-plus-buy" | "buy" | "none";
  funding_route_followed_recommendation?: boolean;
  /** How many CARD routes were on screen. The deposit ghost link ([R7]) is not one of them. */
  funding_route_count?: number;
  /**
   * POO-1576: the Paybis identifier of the payment method a buyer picked (`poolparty-credit-card`).
   *
   * Deliberately NOT a closed union, and bounded by its SOURCE rather than by a literal list: the
   * value set is the vendor's own method catalogue, which varies per currency and changes without a
   * release, so a hand-mirrored union here would drift exactly like the 67-code table
   * {@link error_code} refuses to keep. It is never free text and never user-entered: every value
   * comes from `getOnRampPaymentMethodsAction`'s normalized list, so cardinality is the provider's
   * method count and nothing in it can carry an address, an amount or a name.
   *
   * POO-1813 [R2]: the same two vocabularies as {@link deposit_method}, on the provisioning funnel.
   * A Paybis method id today; on the Privy rail there is nothing narrower than the top-level choice
   * to report, because the provider owns the picker. PP-TODO(POO-1809): narrow when Paybis goes.
   */
  funding_method?: string;
  /** How many methods the step offered. Zero is the signal that the provider returned nothing. */
  funding_method_count?: number;
  /**
   * POO-1618: the ISO-4217 code the buyer ASKED to pay in, on the step's currency control.
   *
   * Distinct from {@link currency}, which is the denomination of a `value` beside it. This one is
   * the CHOICE itself, on an event that carries no monetary figure, and it is what says whether the
   * control is used - and, against `onramp.currency_resolved`'s server-side source, whether the
   * resolution chain is landing where buyers would have chosen anyway.
   */
  funding_method_currency?: string;
  /** Whether the operation needed a gas top-up at all, which is what `1c` turns off ([R9]). */
  funding_gas_needed?: boolean;
  /** SHA-256 hash of the wallet address. PP-SECURITY: never the raw address. */
  user_id?: string;
  // App / navigation params.
  page_path?: string;
  metric_name?: string;
  metric_value?: number;
  metric_rating?: string;
  /**
   * Why a `*_failed` event failed (POO-1171).
   *
   * **Deliberately NOT a closed union of every code the app can see, and that is a decision, not an
   * omission.** POO-1171 asked for a closed `error_code`. Measured against the API repo
   * (`uBits-Capital/pool-party-api`, `main` at 2026-07-31) that would be **67 backend codes spread
   * across eight files** (`common/errors/error-codes.ts` plus seven `<feature>.errors.ts`, which
   * that file's own header says stay separate on purpose) **plus 14 frontend-local codes**, mirrored
   * by hand across a repo boundary. POO-1212 [2] rejected a parallel table of TEN values in ONE repo
   * as something that "will drift within a quarter"; the same objection is far stronger here.
   *
   * What POO-1171 actually needed was to stop `deposit_failed` sending an UNBOUNDED string off
   * `TxError.code` once `fiatOnRamp` flips. That is achieved by bounding the shape and the source:
   *
   * - Codes the FRONTEND itself produces are closed: see {@link AnalyticsErrorCode}. A typo in one
   *   of ours is a compile error, which is the guarantee that was worth having.
   * - Codes that arrive FROM the API pass through, validated by shape in `sanitizeParams`
   *   ({@link isAnalyticsErrorCodeShape}). They cannot be free text, cannot carry an address, and
   *   cannot become a high-cardinality `(other)` bucket, without this repo having to track another
   *   repo's eight files.
   */
  error_code?: AnalyticsErrorCode | string;
  /** Who caused the failure. Derived from `TxErrorKind`, never invented (POO-1212 [2]). */
  error_origin?: AnalyticsErrorOrigin;
  /**
   * Whether a failure ENDED the attempt (POO-1212 [2]).
   *
   * This is the field `pending` was deleted to make room for, and the separation is the whole point.
   * `error_origin` answers *"who caused this?"*; this answers *"did it finish?"*. They are orthogonal
   * axes, and the seven-value origin enum collapsed them: with `pending` sitting alongside `app` and
   * `upstream`, the query `error_origin IN ("app","upstream")` **silently excluded every failure that
   * was pending because our own watcher gave up**, which is an app defect wearing a `pending` label
   * and exactly the class the metric should surface.
   *
   * `false` means the attempt is still alive and resumable, so it must NOT be counted as a lost
   * user. The concrete case that forced this field: the fiat rail's `ONRAMP_SETTLING`, paid but not
   * yet on-chain, where no retry is offered precisely so the user cannot be charged twice.
   *
   * Omitted means terminal. A failure event with no opinion is the common case, and defaulting the
   * rare state to the common one keeps every existing emitter correct.
   */
  terminal?: boolean;
  /**
   * Next.js's server-side error digest, from a route error boundary (POO-1171).
   *
   * Its own field rather than `error_code`, and the separation is load-bearing rather than tidy. A
   * digest is an opaque hash (`"2989057395"`), so it fails {@link isAnalyticsErrorCodeShape} and
   * would be silently DROPPED if it kept riding on `error_code`, taking the boundary's only
   * correlation handle with it. They are also different things: `error_code` is a closed-ish
   * taxonomy you group by, a digest is a high-cardinality pointer you look up.
   *
   * PP-ANALYTICS: same handling as `trace_id`. Read it in BigQuery, never register it as a GA4
   * report dimension. It is the server-side correlation id, never `error.message`, which can carry
   * wallet detail and upstream payloads.
   */
  error_digest?: string;
  /** BCP-47 locale the user switched to (e.g. "pt-BR"). */
  locale?: string;
  /** BCP-47 locale active before the switch. */
  previous_locale?: string;
}
