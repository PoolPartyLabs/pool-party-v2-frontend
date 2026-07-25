# Analytics Events

Living catalog of every tracked event in the Pool Party Frontend. Kept in sync with the typed `AnalyticsEvent` union in `src/lib/analytics/events.ts` (the `consistency-checker` skill enforces this). Taxonomy and rules: `docs/09_ANALYTICS.md` + the `analytics-tracking` skill. Naming: `02_NAMING_CONVENTION.md` Part H.

Convention: `<area>_<object>_<action>`, snake_case, max 40 chars. Transactional flows use `started` then `submitted` then `completed` (or `failed`). "Emitting artifact" is the `PP-` ID that fires the event; filled in as features are built.

## Auth and wallet

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `auth_signin_started` | User taps Continue with Google | | PP-AUTH-SCR-001 |
| `auth_signin_completed` | Privy session established | `user_id`, `chain_id` | PP-AUTH-SCR-001 |
| `auth_signin_failed` | Sign-in error | | PP-AUTH-SCR-001 |
| `auth_wallet_ready_viewed` | Privy embedded-wallet ready screen shown | | PP-AUTH-SCR-003 |
| `auth_logout` | User logs out | | PP-PROF-SCR-001 |
| `wallet_connect_started` | User starts a connector attempt | | PP-AUTH-SCR-004 |
| `wallet_connect_completed` | External wallet connected | `user_id`, `chain_id` | PP-AUTH-SCR-004 |
| `wallet_connect_failed` | Connection error or rejection | | PP-AUTH-SCR-004 |
| `wallet_disconnected` | Wallet disconnected | | PP-PROF-* |

## Dashboard and portfolio

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `home_viewed` | Home rendered | | PP-DASH-SCR-001 |
| `portfolio_viewed` | Portfolio rendered | | PP-PORT-SCR-001 |
| `portfolio_sort_changed` | Positions sort column/direction changed (POO-829 R7) | | PP-PORT-SCR-001 |
| `position_detail_viewed` | A position opened | `strategy_id`, `position_id` | PP-PORT-* |

## Strategies

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `strategy_list_viewed` | Explore list rendered | | PP-STR-SCR-001 |
| `strategy_filter_applied` | A risk/category filter changed | `risk_level` | PP-STR-SCR-001 |
| `strategy_sort_changed` | Sort column changed | | PP-STR-SCR-001 |
| `strategy_detail_viewed` | Strategy detail rendered | `strategy_id`, `risk_level` | PP-STR-SCR-002 |
| `strategy_invest_started` | Invest flow opened | `strategy_id` | PP-STR-MOD-* |
| `strategy_invest_submitted` | Invest amount confirmed | `strategy_id`, `value`, `currency` | PP-STR-MOD-* |
| `strategy_invest_completed` | Investment confirmed | `strategy_id`, `value`, `usd_value_at_time` | PP-STR-MOD-* |
| `strategy_invest_failed` | Invest error | `strategy_id` | PP-STR-MOD-* |
| `strategy_invest_resumed` | Invest reopened at Confirm & sign after a Deposit & invest top-up (POO-494 R6) | `strategy_id`, `value`, `usd_value_at_time` | PP-STR-MOD-001 |
| `strategy_collect_started` | Collect opened | `position_id` | PP-STR-MOD-* |
| `strategy_collect_completed` | Yield collected | `position_id`, `value`, `usd_value_at_time` | PP-STR-MOD-* |
| `strategy_collect_failed` | Collect error | `position_id` | PP-STR-MOD-* |
| `strategy_withdraw_started` | Withdraw opened | `position_id` | PP-STR-MOD-* |
| `strategy_withdraw_submitted` | Withdraw confirmed | `position_id`, `value` | PP-STR-MOD-* |
| `strategy_withdraw_completed` | Withdraw confirmed on-chain | `position_id`, `value`, `usd_value_at_time` | PP-STR-MOD-* |
| `strategy_withdraw_failed` | Withdraw error | `position_id` | PP-STR-MOD-* |
| `strategy_share_opened` | Share-yield modal opened from the Owned detail | `strategy_id`, `position_id` | PP-STR-SCR-002 |
| `strategy_share_period_changed` | Earnings window switched (24h/7d/30d) | `strategy_id`, `share_period` | PP-STR-MOD-009 |
| `strategy_share_target_clicked` | A share destination chosen (X/Telegram/WhatsApp/Instagram) | `strategy_id`, `share_target`, `share_period` | PP-STR-MOD-009 |
| `strategy_share_link_copied` | Referral link copied from the share modal | `strategy_id`, `share_period` | PP-STR-MOD-009 |
| `strategy_share_card_saved` | Yield Receipt PNG exported | `strategy_id`, `share_target`, `share_period` | PP-STR-MOD-009 |
| `strategy_share_export_failed` | Yield Receipt PNG export (or the native file-attach) failed on Save or a share target (POO-906 R5); surfaced to the user, ids only in params | `strategy_id`, `share_target`, `share_period` | PP-STR-MOD-009 |
| `strategy_launch_submitted` | Manager Launch strategy (create pool) confirmed — fired once from the Launch-confirm approve (the build→review→sign flow start, before the signatures). Carries the pool id (the strategy has no id yet at launch). | `strategy_id` (pool id) | PP-MGR-SCR-002 |

## Transaction flows (cross-modal)

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `tx_slippage_retry` | A slippage-classified tx failure auto-retries once (fired on the AUTOMATIC retry only, never on a user-initiated retry). No error message/code in params, per the privacy rule. | `flow` (invest/withdraw/collect/compound/moveRange/removeLiquidity), `strategy_id` | PP-STR-HOK-001 (useSlippageAutoRetry) |

## Savings

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `savings_list_viewed` | Savings markets list rendered | | PP-SAV-SCR-001 |
| `savings_market_viewed` | A market detail rendered | `market_id` | PP-SAV-SCR-002 |
| `savings_deposit_started` | Deposit opened | `market_id` | PP-SAV-* |
| `savings_deposit_submitted` | Deposit confirmed | `market_id`, `value` | PP-SAV-* |
| `savings_deposit_completed` | Deposit confirmed on-chain | `market_id`, `value`, `usd_value_at_time` | PP-SAV-* |
| `savings_deposit_failed` | Deposit error | `market_id` | PP-SAV-* |
| `savings_withdraw_started` | Withdraw opened | `market_id` | PP-SAV-* |
| `savings_withdraw_submitted` | Withdraw confirmed | `market_id`, `value` | PP-SAV-* |
| `savings_withdraw_completed` | Withdraw confirmed | `market_id`, `value`, `usd_value_at_time` | PP-SAV-* |
| `savings_withdraw_failed` | Withdraw error | `market_id` | PP-SAV-* |

## Buy tokens

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `token_list_viewed` | Buy-tokens list rendered | | PP-TOK-SCR-001 |
| `token_detail_viewed` | Token detail rendered | `token_symbol` | PP-TOK-SCR-002 |
| `token_buy_started` | Buy ticket opened | `token_symbol`, `order_type` | PP-TOK-MOD-* |
| `token_buy_submitted` | Buy confirmed | `token_symbol`, `order_type`, `value` | PP-TOK-MOD-* |
| `token_buy_completed` | Buy filled or placed | `token_symbol`, `order_status`, `token_amount`, `usd_value_at_time` | PP-TOK-MOD-* |
| `token_buy_failed` | Buy error | `token_symbol` | PP-TOK-MOD-* |
| `token_sell_started` | Sell ticket opened | `token_symbol`, `order_type` | PP-TOK-MOD-* |
| `token_sell_submitted` | Sell confirmed | `token_symbol`, `order_type`, `value` | PP-TOK-MOD-* |
| `token_sell_completed` | Sell filled or placed | `token_symbol`, `order_status`, `token_amount`, `usd_value_at_time` | PP-TOK-MOD-* |
| `token_sell_failed` | Sell error | `token_symbol` | PP-TOK-MOD-* |

## Predictions

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `prediction_market_viewed` | A prediction market rendered | `prediction_id` | PP-PRED-SCR-* |
| `prediction_bet_started` | Bet ticket opened | `prediction_id`, `side`, `outcome` | PP-PRED-MOD-* |
| `prediction_bet_submitted` | Bet confirmed | `prediction_id`, `side`, `value` | PP-PRED-MOD-* |
| `prediction_bet_completed` | Bet placed | `prediction_id`, `outcome`, `value`, `usd_value_at_time` | PP-PRED-MOD-* |
| `prediction_bet_failed` | Bet error | `prediction_id` | PP-PRED-MOD-* |
| `prediction_cashout_completed` | Position cashed out | `prediction_id`, `value`, `usd_value_at_time` | PP-PRED-* |

## Perps

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `perp_market_viewed` | Perp market/trade page rendered | `perp_market` | PP-PERP-SCR-* |
| `perp_leverage_changed` | Leverage changed | `perp_market`, `leverage` | PP-PERP-MOD-* |
| `perp_trade_started` | Order ticket opened | `perp_market`, `side` | PP-PERP-MOD-* |
| `perp_trade_submitted` | Order confirmed | `perp_market`, `side`, `leverage`, `value` | PP-PERP-MOD-* |
| `perp_trade_completed` | Order opened | `perp_market`, `side`, `leverage`, `usd_value_at_time` | PP-PERP-MOD-* |
| `perp_trade_failed` | Order error | `perp_market` | PP-PERP-MOD-* |
| `perp_position_closed` | Position closed | `perp_market`, `value`, `usd_value_at_time` | PP-PERP-MOD-* |

## Cards

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `card_explore_viewed` | Explore cards rendered | | PP-CARD-SCR-* |
| `card_detail_viewed` | Card detail rendered | `card_issuer` | PP-CARD-SCR-* |
| `card_request_started` | Request flow opened | `card_issuer` | PP-CARD-* |
| `card_request_completed` | Card requested | `card_issuer` | PP-CARD-* |
| `card_topup_started` | Top-up opened | `card_issuer` | PP-CARD-* |
| `card_topup_completed` | Top-up confirmed | `card_issuer`, `value`, `usd_value_at_time` | PP-CARD-* |
| `card_freeze_toggled` | Card frozen/unfrozen | `card_issuer` | PP-CARD-* |

## Deposit

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `deposit_started` | Deposit screen opened | | PP-DEP-SCR-001 |
| `deposit_method_selected` | Onramp method chosen | `deposit_method` | PP-DEP-* |
| `deposit_submitted` | Deposit confirmed | `deposit_method`, `value` | PP-DEP-* |
| `deposit_completed` | Deposit credited | `deposit_method`, `value`, `usd_value_at_time` | PP-DEP-* |
| `deposit_failed` | Deposit error | `deposit_method` | PP-DEP-* |
| `deposit_crypto_started` | Crypto-transfer path opened | | PP-DEP-* |
| `deposit_crypto_completed` | Crypto deposit credited | `token_symbol`, `token_amount`, `usd_value_at_time` | PP-DEP-* |

## Universal Funding (provisioning funnel)

Epic POO-1022 · issue POO-1048. Pay for any Pool Party operation with any token on any supported chain: the funnel measures whether a user who holds the money somewhere else can find it, choose it, and land it on the operation's chain. Every event is emitted by **PP-CORE-LIB-058** (`src/lib/analytics/provisioningFunnel.ts`), the single definition of the funnel; the gate hook and `ProvisioningPanel` only call it.

**Shared params.** `flow` (the operation: invest / withdraw / collect / compound / move-range / close), `chain_id` (the chain the operation runs on), `strategy_id` where there is one. `route_shape` ∈ `same-chain` (a swap where the operation lives) · `cross-chain` (one bridge of an asset already held) · `decomposed` (a swap feeding a bridge, which is what a different-token cross-chain pair becomes, since the Trading API answers `404` to it). `leg_count` counts executable steps and never the `op` display anchor. `value` is USD with `currency: "USD"`.

**Never in a payload:** a wallet address, a token address, or a transaction hash. `user_id` (server-HMAC, consent-gated) rides along exactly as on every other event.

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `funding_gate_triggered` | The pre-flight gate decided the operation cannot proceed unfunded. Fired from the gate hook, so all six operations are covered even if the user never reaches the panel. `value` = what is MISSING (USDC + gas shortfall), not what the operation is worth. No `route_shape`: before a route is quoted there is no shape, and guessing one would report an intention as a fact. | `flow`, `chain_id`, `value` | PP-CORE-HOK-017 |
| `funding_sources_listed` | The funding-source picker rendered. `source_count` / `value` are the SPENDABLE sources (routable to the operation's chain), so "six tokens listed, none of them can get there" reads as zero. Once per session. | `source_count`, `value` | PP-CORE-CMP-046 |
| `funding_sources_selected` | The user committed to a selection. Totals come from the same micro-dollar helper the CTA gates on. | `source_count`, `value` | PP-CORE-CMP-046 |
| `funding_plan_quoted` | A priced plan came back. Once per quote, keyed on the quote's own `quotedAt`, so a TTL re-quote is reported (it is a new price the user then approves) and a re-render is not. | `route_shape`, `leg_count`, `value` | PP-CORE-CMP-046 |
| `funding_plan_started` | The user approved the route and execution began. **The only funnel event the confirm click emits.** | `route_shape`, `leg_count`, `value` | PP-CORE-CMP-046 |
| `funding_leg_settled` | One leg SETTLED, i.e. its `run()` resolved, which for a bridge means arrival was detected on the destination chain. Never on broadcast: a hash exists minutes before the money does. Once per leg however many renders observe it. | `leg_kind`, `leg_index`, `route_shape`, `value` | PP-CORE-CMP-046 |
| `funding_plan_completed` | Every leg settled. **[R3]** Fired from the flow-status effect, never from a click, and at most once per session. Still fires for a route that failed, was retried, and landed. | `route_shape`, `leg_count`, `value` | PP-CORE-CMP-046 |
| `funding_plan_failed` | A terminal failure: a rejected or reverted leg, or a planner failure (a BLOCKED gas chain) that priced no route at all. **[R4]** Fires on EVERY terminal failure, so a retry that fails again is a second event. A bridge still in flight at the poll ceiling is deliberately NOT one. Typed `error_code` only, never error text. | `error_code`, `route_shape`, `leg_kind`, `leg_index` | PP-CORE-CMP-046 |
| `funding_plan_abandoned` | The session ended with no outcome recorded: the user cancelled, closed the modal, or left a bridge still settling. Emitted on unmount, so `started = completed + failed + abandoned`. | `funding_exit` (`sources`/`plan`/`pending`/`settling`/`error`) | PP-CORE-CMP-046 |

**Known baseline shift (POO-1025, documented here because it moves an existing funnel).** `strategy_invest_submitted` now fires for cross-chain-funded invests that previously early-returned to `/deposit` and never entered the invest funnel at all. The `started → submitted → completed` conversion baseline steps up and a cohort is reclassified from deposit-intent to invest-start. Inherent to the feature working; anything trending against the old baseline will show a discontinuity at the flag flip.

## Rewards

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `reward_program_viewed` | A rewards program rendered | `reward_program` | PP-REW-SCR-001/002/003 |
| `reward_referral_shared` | Referral link/code shared (share or copy) | | PP-REW-CMP-012/014 |
| `reward_claimed` | Quacks claimed — Say Quack check-in / Duck Shoot boost | `value` | PP-REW-SCR-001 / PP-REW-MOD-001 |

## App and navigation

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `page_viewed` | Route changed (custom; **GA4 native `page_view` is canonical** for reports — this is optional/secondary) | `page_path` | PP-CORE-* (provider) |
| `locale_changed` | Locale switched | `previous_locale`, `locale` | PP-CORE-CMP-021 |
| `web_vitals` | A Core Web Vital reported | `metric_name`, `metric_value`, `metric_rating` | PP-CORE-* (provider) |
| `app_error_shown` | An error boundary/state shown | `error_code` | PP-CORE-CMP-019 |
