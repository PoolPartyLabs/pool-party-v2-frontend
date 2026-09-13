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
| `wallet_action_blocked` | SwitchNetworkAction: the operation's chain is not in the wallet at all, so no switch can reach it: a WalletConnect session (Ledger Live) carries only the networks its owner paired. Fires once per rendered failure, when the manual switch action mounts on a `chainUnavailable` error. NOT fired for `wrongChain`, which is not blocked, just one prompt away. / SiweFailureNotice: the SIWE handshake refused a wallet and the blocking notice rendered (POO-1461). Fires once per failure OCCURRENCE, keyed on the failure object rather than on the mount, because this notice lives above every route and re-renders for the whole life of the page. Only for the two kinds POO-1425 made non-fatal: `unsupported-chain` (the wallet is on a network we do not serve, and since POO-1449 only after the app has already tried to move it and failed, so this now counts users who are GENUINELY blocked rather than every wrong initial network) and `user-rejected` (the human dismissed the prompt). NOT fired for `auth-rejected` or `unavailable`, which still raise to a route error boundary and are already counted there as `app_error_shown`. No wallet address, `reference`, `recoveredSigner` or `signedEncoding` in the payload, per POO-243 [R3]; that detail lives on the first-party `auth.siwe_failed` report instead. | `block_reason` (`chain_unavailable`, `unsupported_chain`, `user_rejected`) | PP-STR-CMP-026 (SwitchNetworkAction), PP-AUTH-CMP-004 (SiweFailureNotice) |

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
| `tx_amount_blocked` | **This screen's blocked intent (premise 11). POO-1609 (second and standing reversal, 2026-08-14) replaced the raise this event used to fire on.** The buyer ACTIVATED a payment-method row whose provider minimum their order does not reach; the product refuses the activation rather than raising the order to clear it (there is no raise any more, and the row renders BLOCKED, unselectable, before this fires). Fires on the refusal itself, exactly once per activation, and only on an activation: it is a click-time event with no latch, because the refusal stores nothing that could be counted twice (#897's `blockGuardRef` existed to de-duplicate an EFFECT and went with it). Deliberately NOT fired for the auto-picked default, which the buyer never chose: since PP-DEP-SCR-001 rules v2 a below-floor method cannot BE the active method at all (`activeMethod` filters the refused set before `pickDefaultPaymentMethod` runs), so there is no silent default refusal left to report. Not fired once the purchase is running (the amount step, where the row lives, is gone by then). No `value`: the order is USDC to receive and the floor is fiat in the buyer's own currency, so one number cannot carry both. **POO-1642 (2026-08-16) added the screen's SECOND blocked intent to this same name, under two new reasons.** The buyer pressed `Confirm & pay` and the product refused to mint, because the journal holds a purchase intent for this wallet that it cannot verify: `purchase_paid_unsettled` (we observed the payment and it has not landed) or `purchase_unverified` (we never saw it paid, and it is past `ONRAMP_REQUEST_RESUMABLE_MS`). It fires on the INTERCEPTION, exactly once per question, and never on either answer: `Resume` / `Keep waiting` and `Start a new purchase` are two answers to ONE blocked attempt, and counting them separately would lose the denominator, which is how often we interrupt a buyer at all. Split into two reasons because they point at opposite fixes: a paid intent that never landed is our settlement observer missing a delta, while an unverified one asks whether our own 15-minute resumability window is too short. This one CAN fire after the purchase is running (the mint is where the question is asked), unlike the row-refusal case above. Same `deposit_method` when the provider gave a list to name one from. **POO-1624 (2026-08-17) added the screen's THIRD blocked intent, on the CRYPTO path this time.** `transfer_unobserved`: the buyer pressed "I've sent the funds" asking us to confirm their transfer landed, and the product answered that it cannot, because nothing watches the address (POO-604). It fires once per arrival at that wait, in real mode only, de-duplicated by a ref because it is an EFFECT rather than a click (the `blockGuardRef` role POO-1609's own removal retired). Deliberately NOT `deposit_failed`: nothing failed, the transfer is very probably arriving, and folding a missing OBSERVATION into the fiat funnel's failure rate would corrupt the one number week one reconciles against Paybis' own dashboard. Its count is the denominator for whether extending POO-1129's balance-delta reconcile to the crypto path is worth building; it replaces the `deposit_crypto_completed` rows that used to be emitted by a timer. No `value`: the whole point is that we hold no measured figure. **POO-1794 (2026-09-04) added the screen's FOURTH blocked intent, back on the FIAT path.** `onramp_disabled`: the buyer pressed `Confirm & pay` in REAL mode while the `fiatOnRamp` flag was dark, so the on-ramp is not launched and there is no purchase to make; the confirm refuses rather than fabricating a `deposit_completed` for a purchase that never happened (the defect this issue closed, and a premise-11 violation). It fires on the refusal itself, once per press, and CONCLUDES the abandonment, so it is the deposit funnel's fifth settlement term: `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`. Deliberately NOT `transfer_unobserved` (a real flow missing its watcher, reconciled against Paybis' dashboard) and NOT `deposit_failed` (nothing failed, because nothing ran). A non-zero count is the alarm that a real buyer met a dark on-ramp before the flag was flipped. **POO-1806 (2026-09-04) added an INVEST emitter under an existing reason.** `PP-STR-MOD-001` (`InvestModal`) reports `exceeds_balance` when settle-then-size refuses: the investor asked for an amount that was never below the minimum, the fresh balance came up short, and the sized figure landed under the platform minimum, so the build does not run and a screen explains why (ADR-0005). Deliberately NOT `below_minimum`, which this taxonomy defines as being about what the USER entered; the invest surface still emits that one, from its own latch, for an amount typed under the minimum. The two run as separate `useTxAmountBlocked` calls so one refusal loop cannot re-fire the other's latch. **POO-1808 (2026-09-05) added the PROVISIONING buy step's four, on the Privy rail, which is the first emitter of this name outside `/deposit`.** All four fire BEFORE a checkout opens, and all four are facts about what can be bought rather than failures of an attempt, which is why none of them reaches the generic "try again" copy. `onramp_native_unavailable`: the gas-first leg asks for the native coin and this rail does not sell it (POO-1820), so it is refused rather than sent to a checkout that cannot fill the order; the count is what tells whoever takes the paymaster-versus-disclosure decision how often a real buyer hits the wall. `onramp_uncovered`: POO-1805's probe answered that no provider will sell to this buyer, in this currency, for this amount, right now; deliberately separate from the native one because they point at opposite fixes (a capability gap versus a coverage gap). `onramp_currency_unsupported`: the SERVER-resolved buyer currency is not one the rail can charge in, and the alternative was the POO-1512 class, a silent fallback to dollars that charges someone in money nobody chose for them and looks like a successful purchase from every angle we can see. `onramp_baseline_unreadable`: the destination `balanceOf` failed, so there is no zero mark to subtract a delivery from and the CTA will not open a checkout; it is the only one of the four with no refusal screen behind it (the buyer just sees a line that never resolves), which is exactly why it is reported, and it fires once per mount because it is a read that failed rather than something the buyer did. These four carry `flow` (the operation being provisioned, e.g. `invest`) and `strategy_id` rather than `deposit_method`: there is no method picker on this rail, the checkout picks the method itself. **POO-1807 (2026-09-04) added `/deposit`'s FIFTH and SIXTH blocked intents, on the same Privy rail, from `PP-DEP-SCR-001`.** `onramp_uncovered` on this surface: the coverage probe (`PP-CORE-LIB-108`) answered that nobody will sell to this buyer, in this currency, at this amount, so the confirm refuses BEFORE any checkout opens (same reason as the provisioning step's above, same probe, a different host). Deliberately not `deposit_failed` (nothing ran) and not `below_minimum` (that is our own floor; this is the market's answer, and the two lead to different actions). `onramp_unverified`, which only `/deposit` reports: the ADR-0006 VISIBLE observation window closed with no provider claim and no on-chain delta, so the screen is released on an honest state rather than a cancellation. **Neither CONCLUDES the abandonment**, unlike `transfer_unobserved` and `onramp_disabled`: they are denominators, like `below_minimum`. The flow is not over when they fire, because the PASSIVE window (`PP-CORE-LIB-110`) keeps observing for the rest of the session and may still settle the purchase, so concluding at the visible ceiling would let one `deposit_started` produce two settlement terms. The identity is therefore unchanged at five terms: `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`, with a released screen resolving later as `completed` (the delta landed) or `abandoned` (the buyer left). That `abandoned` then covers a buyer who paid and is waiting is a known imprecision, recorded here rather than papered over: the alternative, a sixth settlement term, double-counts every late settlement. `onramp_paid_unsettled` is declared alongside them for the released-`settling` case. **POO-1807's review (2026-09-05, from the POO-1801 review's F10) added `/deposit`'s SEVENTH, which is the same `onramp_currency_unsupported` the provisioning step reports.** The rail does not sell in the buyer's own currency, or the server chain that resolves one (`PP-CORE-LIB-096`) could not answer, so the confirm refuses before any checkout opens. What it replaced was a silent `?? "usd"` at the host, which opened a dollar-denominated checkout for a buyer whose money is not dollars: the POO-1512 [R5] defect with a new rail behind it. Kept apart from `onramp_uncovered` because the two point at opposite fixes and one of them is ours, so folded together an outage in currency resolution would read as demand from an unserved country. A DENOMINATOR, like the two above: nothing ran, nothing was charged, and the abandonment is not concluded. `/deposit` does not report `onramp_native_unavailable` or `onramp_baseline_unreadable`: the first is the provisioning step's gas leg, which this screen has none of, and an unreadable baseline here disables the CTA rather than refusing a press, so there is no attempt to count. | `flow` (`deposit`, `invest`, or the provisioned operation: `withdraw`, `collect`, `compound`, `create_pool`, `move_range`, `close_position`), `block_reason` (`below_minimum`, `exceeds_balance`, `purchase_paid_unsettled`, `purchase_unverified`, `transfer_unobserved`, `onramp_disabled`, `onramp_native_unavailable`, `onramp_uncovered`, `onramp_currency_unsupported`, `onramp_baseline_unreadable`, `onramp_paid_unsettled`, `onramp_unverified`), `deposit_method` (fiat rail only), `strategy_id` (invest and provisioning) | PP-DEP-SCR-001, PP-STR-MOD-001, PP-STR-CMP-029 |

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
| `funding_route_viewed` | Screen 1, "Where from", appeared (POO-1501). Fires on the OPEN rather than on the arrival of the figures, so a session that left while the quote was still in flight is counted (D1); it does NOT fire when the picker renders nothing, which is every gate open in the crypto-only cut where `resolveFundingRoutes` returns one route. `funding_route_count` counts CARD routes only: the deposit ghost link ([R7]) hands off to another surface entirely and is not one of the options being compared. `funding_route_recommended` is `"none"` on a one-card screen, a real value and not a gap ([R6]). **POO-1541:** moved out of `FundingRoutePicker` into the panel's own effect, so it now carries the shared params like every other row in this table. **Fires once per ENTRY to screen 1, never once per panel session:** the [R20] back chevron on step 2 and the buy route's impact-gate ghost both return to screen 1 mid-session, and each return emits a fresh view (the panel advances an entry key on every false-to-true edge of `pickingRoutes`, and the funnel's `emitOnce` dedupes within an entry only). This preserves the picker's original per-mount semantics, so the series is continuous across POO-1541; `chosen` and `abandoned` are per-action, so a per-session view would let chosen/viewed exceed 1. | `flow`, `chain_id`, `funding_route_count`, `funding_route_recommended`, `funding_gas_needed` | PP-CORE-CMP-046 (`ProvisioningPanel`) + PP-CORE-LIB-058 (emitter) |
| `funding_route_chosen` | The user tapped a route. One tap is the whole interaction, so this is the choice and the commitment at once. `funding_route_followed_recommendation` is the point of the pair: `Recommended` ([R6]) is a claim the product makes about the fewest-steps path, and without it route choices could be counted forever without ever learning whether the chip moves any of them. The deposit link reports as `deposit` and never as followed, since it can never carry the chip. **POO-1541:** moved out of `FundingRoutePicker` into the panel's `onSelect` handler. | `flow`, `chain_id`, `funding_route`, `funding_route_recommended`, `funding_route_followed_recommendation` | PP-CORE-CMP-046 (`ProvisioningPanel`) + PP-CORE-LIB-058 (emitter) |
| `funding_method_viewed` | POO-1576: the "Choose how to pay" step appeared, between the buy amount and the Paybis checkout. The funnel had no step for HOW a buyer pays because the app never asked: `resolveWidgetPrefill` prefilled a card by regex and sent it to the mint. This is the VIEW class and the step's START at once, deliberately and on the same reasoning `funding_route_viewed` carries: the screen opens with its list and there is no separate starting gesture, so a second event would be a duplicate under another name. Fires on the OPEN rather than on the arrival of the figures, so a buyer who left while the quote was still in flight is counted. Once per ENTRY to the step (one per run today; a future retry would count as the fresh view it is). | `flow`, `chain_id`, `funding_method_count` | PP-STR-CMP-028 (`OnRampMethodStep`) + PP-CORE-CMP-046 (host) + PP-CORE-LIB-058 (emitter) |
| `funding_buy_started` | POO-1813 [R3]. The fiat checkout was ASKED to open: the call itself, not the gesture and not a purchase. It is the denominator every later rate is measured against. Emitted once per attempt by the adapter, on the PRIVY rail; the Paybis rail keeps its own events until POO-1809 retires it, so this series describes one rail and `rail` is carried anyway, because a conversion rate that silently mixes two providers is worse than two rates. | `rail`, `attempt_id`, `fiat_currency` | PP-CORE-LIB-111 (called by PP-CORE-HOK-035) |
| `funding_buy_submitted` | POO-1813 [R3]. The provider CLAIMED it charged. Named `submitted` and never `completed` on purpose: funds take minutes to arrive and this says nothing about money existing. `moved` carries the classifier's verdict, and the two values are not a confidence ranking: on the Stripe path a charged card and an abandonment are the same rejection (ADR-0006), so a real charge lands on `maybe`, while the popup providers still report `provider-confirming` and arrive as `confirmed`. Nothing branches on the difference. The Privy rail only; see `funding_buy_started`. | `rail`, `attempt_id`, `fiat_currency`, `moved` | PP-CORE-LIB-111 (called by PP-CORE-HOK-035) |
| `funding_buy_failed` | POO-1813 [R1]/[R3]. A hard no: nothing was charged and nothing is coming. `reason` is the classifier's own string and `error_code` its 1:1 mapping, never folded, so `popup_blocked` and `not_authenticated` stay separable (they call for opposite fixes). An unmapped reason reports `ONRAMP_UNMAPPED` rather than throwing, so a provider that adds a rejection message cannot break a purchase through the analytics path. `attempt_id` is absent when the adapter refused before minting one, because there is no purchase to join to. The Privy rail only; see `funding_buy_started`. | `rail`, `attempt_id`, `fiat_currency`, `reason`, `error_code` | PP-CORE-LIB-111 (called by PP-CORE-HOK-035) |
| `funding_buy_settled` | POO-1813 [R4]. **The only honest money-in number in the repository.** Fires on the OBSERVED balance delta (`PP-CORE-LIB-110`) and never on the promise resolving, a modal closing or a provider status. The figures are what POO-1811's purchase half needs: the gap between `requested_usd` and `prefill_usd` is OUR buffer, the gap between `prefill_usd` and `delivered_usd` is the provider's spread. `prefill_usd` is OMITTED, never zeroed, for a buyer we prefilled nothing for (a non-USD purchase carries no `defaultAmount` at all), so the buffer query skips that row instead of averaging a figure nobody asked for. `fiat_currency` is what the card was CHARGED in, not the currency the USD figures are sized in. `value` mirrors `delivered_usd` because the honest GA4 value is what arrived. The Privy rail only; see `funding_buy_started`. | `rail`, `attempt_id`, `fiat_currency`, `requested_usd`, `prefill_usd`, `delivered_usd`, `value`, `currency` | PP-CORE-LIB-111 (called by PP-DEP-SCR-001 and PP-STR-CMP-029) |

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
