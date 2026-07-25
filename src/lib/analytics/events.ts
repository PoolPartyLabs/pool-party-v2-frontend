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
  // Savings
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
  // Buy tokens
  "token_list_viewed",
  "token_detail_viewed",
  "token_buy_started",
  "token_buy_submitted",
  "token_buy_completed",
  "token_buy_failed",
  "token_sell_started",
  "token_sell_submitted",
  "token_sell_completed",
  "token_sell_failed",
  // Predictions
  "prediction_market_viewed",
  "prediction_bet_started",
  "prediction_bet_submitted",
  "prediction_bet_completed",
  "prediction_bet_failed",
  "prediction_cashout_completed",
  // Perps
  "perp_market_viewed",
  "perp_leverage_changed",
  "perp_position_closed",
  "perp_trade_started",
  "perp_trade_submitted",
  "perp_trade_completed",
  "perp_trade_failed",
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
  // Rewards
  "reward_program_viewed",
  "reward_referral_shared",
  "reward_claimed",
  // App and navigation
  "page_viewed",
  "locale_changed",
  "web_vitals",
  "app_error_shown",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export interface AnalyticsParams {
  /** USD value (GA4 monetary standard). Exact values are allowed. */
  value?: number;
  /** Required by GA4 whenever `value` is present. */
  currency?: "USD";
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
  flow?: string;
  market_id?: string;
  risk_level?: 1 | 2 | 3 | 4 | 5;
  order_type?: "market" | "limit";
  order_status?: "filled" | "open";
  side?: "long" | "short" | "yes" | "no";
  outcome?: string;
  leverage?: number;
  prediction_id?: string;
  perp_market?: string;
  card_issuer?: string;
  /** Which rewards program: rubber_rush / manager_incentive_program / referral. */
  reward_program?: "rubber_rush" | "manager_incentive_program" | "referral";
  /** Earnings window selected on the share-yield modal (PP-STR-MOD-009). */
  share_period?: "24h" | "7d" | "30d";
  /** Share destination chosen on the share-yield modal. */
  share_target?: "x" | "telegram" | "whatsapp" | "instagram" | "save";
  deposit_method?: "pix" | "card" | "applePay" | "bank" | "crypto";
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
  /** Mirrors `ProvisioningStepType` minus its `op` anchor (PP-CORE-LIB-016). */
  leg_kind?: "buy-usdc" | "bridge" | "swap-gas" | "swap-token";
  /** The leg's position in the route, 0-based. Which leg users lose money and patience on. */
  leg_index?: number;
  /** Funding sources listed or selected. Zero listed is the signal a funded wallet found nothing. */
  source_count?: number;
  /** Where a `funding_plan_abandoned` session was when the user left it. */
  funding_exit?: "sources" | "plan" | "pending" | "settling" | "error";
  /** SHA-256 hash of the wallet address. PP-SECURITY: never the raw address. */
  user_id?: string;
  // App / navigation params.
  page_path?: string;
  metric_name?: string;
  metric_value?: number;
  metric_rating?: string;
  error_code?: string;
  /** BCP-47 locale the user switched to (e.g. "pt-BR"). */
  locale?: string;
  /** BCP-47 locale active before the switch. */
  previous_locale?: string;
}
