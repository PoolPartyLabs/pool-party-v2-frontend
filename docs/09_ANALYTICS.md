# 09, Analytics and Tracking

Canonical specification for event tracking in the Pool Party Frontend. Operational detail lives in the `analytics-tracking` skill; this document defines the principles, stack, taxonomy, canonical events, and the privacy contract. The living event list is `docs/ANALYTICS_EVENTS.md`, kept in sync with the typed event union in code.

## Principles

1. **Privacy-first.** Track behavior, never identity secrets. Seed phrases and private keys never touch analytics, ever.
2. **Pseudonymize identifiers.** Wallet addresses go to analytics only as a SHA-256 hash. The raw address never leaves for GA.
3. **Exact values allowed.** Transaction amounts and balances are numbers (and balances are public on-chain), so exact USD values are tracked, including the USD value at the moment of the transaction (per the price-at-time rule).
4. **GTM as hub, GA4 as destination.** The app emits to a dataLayer; GTM dispatches. Adding a future destination needs no app deploy.
5. **Decoupled at the component level.** Components call `useAnalytics()`, never gtag or dataLayer directly.
6. **Consent-gated.** Consent Mode v2 governs what fires before and after the user's choice.
7. **Product-accurate taxonomy.** Events name real OAMS surfaces (strategies, savings, tokens, predictions, perps, cards, deposit), never generic DeFi primitives.

## Stack and rationale

- **GTM** (`@next/third-parties/google` `GoogleTagManager`): single container, optimized loading, hub for current and future tags.
- **GA4**: configured as a tag inside the GTM container, not in code.
- **Consent Mode v2**: wired before any tag fires.
- **next/web-vitals**: Core Web Vitals reporting.

GTM + GA was chosen over GA-direct because Pool Party will add destinations (campaign pixels, product analytics) later, and the hub avoids re-deploying the app for each. The `useAnalytics()` abstraction keeps the component layer independent of this choice.

## Architecture

```
Component / Hook
   |  track(event, params)
   v
useAnalytics()  -->  window.dataLayer.push({ event, ...params })
                                   |
                                   v
                                  GTM container (NEXT_PUBLIC_GTM_ID)
                                   |  (tags configured in the GTM UI)
                                   v
                                  GA4  (+ future destinations)
```

## Event taxonomy

Naming rule: `<area>_<object>_<action>`, snake_case, max 40 chars. Full detail in `02_NAMING_CONVENTION.md`, Part H.

- `area`: the OAMS product surface. One of: `auth`, `wallet`, `nav`, `app`, `dashboard`, `portfolio`, `strategy`, `savings`, `token`, `prediction`, `perp`, `card`, `deposit`, `reward`.
- `object`: the thing acted on (signin, connect, list, detail, invest, deposit, withdraw, buy, sell, bet, trade, request, topup, etc.).
- `action`: past tense for completion (`viewed`, `completed`, `failed`, `closed`), present for attempt/intent (`started`, `submitted`).
- Transactional flows use the funnel pattern: `started` then `submitted` then `completed` (or `failed`).

## Canonical events (OAMS)

The complete, living list is `docs/ANALYTICS_EVENTS.md`. The set below is the source of truth for the typed union.

### Auth and wallet
- `auth_signin_started`, `auth_signin_completed`, `auth_signin_failed`, `auth_wallet_ready_viewed`, `auth_logout`.
- `wallet_connect_started`, `wallet_connect_completed`, `wallet_connect_failed`, `wallet_disconnected`.

### Dashboard and portfolio
- `home_viewed`, `portfolio_viewed`, `position_detail_viewed`.

### Strategies (managed investing)
- `strategy_list_viewed`, `strategy_filter_applied`, `strategy_sort_changed`, `strategy_detail_viewed`.
- `strategy_invest_started`, `strategy_invest_submitted`, `strategy_invest_completed`, `strategy_invest_failed`.
- `strategy_collect_started`, `strategy_collect_completed`, `strategy_collect_failed`.
- `strategy_withdraw_started`, `strategy_withdraw_submitted`, `strategy_withdraw_completed`, `strategy_withdraw_failed`.

### Savings (abstracted lending markets)
- `savings_list_viewed`, `savings_market_viewed`.
- `savings_deposit_started`, `savings_deposit_submitted`, `savings_deposit_completed`, `savings_deposit_failed`.
- `savings_withdraw_started`, `savings_withdraw_submitted`, `savings_withdraw_completed`, `savings_withdraw_failed`.

### Buy tokens (spot exposure)
- `token_list_viewed`, `token_detail_viewed`.
- `token_buy_started`, `token_buy_submitted`, `token_buy_completed`, `token_buy_failed`.
- `token_sell_started`, `token_sell_submitted`, `token_sell_completed`, `token_sell_failed`.

### Predictions
- `prediction_market_viewed`.
- `prediction_bet_started`, `prediction_bet_submitted`, `prediction_bet_completed`, `prediction_bet_failed`.
- `prediction_cashout_completed`.

### Perps (futures)
- `perp_market_viewed`, `perp_leverage_changed`, `perp_position_closed`.
- `perp_trade_started`, `perp_trade_submitted`, `perp_trade_completed`, `perp_trade_failed`.

### Cards
- `card_explore_viewed`, `card_detail_viewed`, `card_freeze_toggled`.
- `card_request_started`, `card_request_completed`.
- `card_topup_started`, `card_topup_completed`.

### Deposit (onramp + crypto transfer)
- `deposit_started`, `deposit_method_selected`, `deposit_submitted`, `deposit_completed`, `deposit_failed`.
- `deposit_crypto_started`, `deposit_crypto_completed`.

### Rewards
- `reward_program_viewed`, `reward_referral_shared`, `reward_claimed`.

### App / navigation
- `page_viewed`, `locale_changed`, `web_vitals`, `app_error_shown`.

## Standard parameters

| Param | Type | Notes |
|-------|------|-------|
| `value` + `currency` | number + 'USD' | GA4 monetary standard. Exact allowed. |
| `usd_value_at_time` | number | USD value at the moment of the transaction (price-at-time rule). |
| `token_amount` | number | Per-token amount, paired with `usd_value_at_time`. |
| `token_symbol` | string | USDC, ETH, BTC, HYPE, etc. |
| `strategy_id` | string | Managed strategy. |
| `position_id` | string | A held strategy position. |
| `market_id` | string | Savings market (asset + venue). |
| `risk_level` | number | 1 to 5. |
| `order_type` | string | `'market'` or `'limit'` (tokens, perps). |
| `order_status` | string | `'filled'` or `'open'` (limit orders). |
| `side` | string | `'long'`/`'short'` (perps) or `'yes'`/`'no'` (predictions). |
| `outcome` | string | Prediction outcome label (multi-outcome markets). |
| `leverage` | number | Perps leverage multiple. |
| `prediction_id` | string | Prediction market id. |
| `perp_market` | string | e.g. `BTC-PERP`. |
| `card_issuer` | string | etherfi, gnosispay, metamask, etc. |
| `deposit_method` | string | `'pix'`, `'card'`, `'crypto'`. |
| `chain_id` | number | 8453 (Base), etc. |
| `user_id` | string | SHA-256 hash of the wallet address. Never raw. |

Removed from the old (pre-OAMS) set: `pool_id`, `fee_tier`. Pool Party has no Uniswap-style pools, liquidity, or swaps.

## Privacy contract

### Absolute blacklist (never, anywhere)
- Seed phrases.
- Private keys.
- Any data that could reconstruct wallet control.

### Pseudonymized
- Wallet address as SHA-256 hash (`user_id`). The raw address stays in the backend with a hash-to-address mapping if cross-referencing is ever needed.

### Allowed exact
- Monetary values and balances, including `usd_value_at_time`.

### Consent
- Before consent: GTM loaded, Consent Mode `denied` for `analytics_storage` and `ad_storage`, only cookieless pings.
- After consent: `granted`, full tracking, `user_id` attached.
- Persisted in the `pp_consent` first-party cookie. Banner translated (next-intl namespace `consent`).

This satisfies GA's "no PII" policy (hashed identifiers, monetary values are standard) and gives a defensible LGPD/GDPR posture (pseudonymized identifier + consent gating).

## How to add a new event

1. Confirm it follows the taxonomy `<area>_<object>_<action>` (Part H).
2. Add it to the `AnalyticsEvent` union in `src/lib/analytics/events.ts`.
3. Add it to `docs/ANALYTICS_EVENTS.md` with: name, when it fires, parameters, the emitting artifact ID.
4. Implement the `track()` call.
5. Add a test asserting the dataLayer push.
6. Configure the corresponding tag/trigger in the GTM container (UI), if it needs special routing.

## Testing

- Mock `window.dataLayer = []` in `beforeEach`.
- Assert the expected push on the action.
- Assert no raw address (no `0x` + 40 hex) ever appears in any push.
- `consistency-checker` verifies the `AnalyticsEvent` union matches `docs/ANALYTICS_EVENTS.md`.

## Recommended dashboards (GA4)

- Activation funnel: `auth_signin_started` to first `strategy_invest_completed` or `savings_deposit_completed`.
- Invest funnel drop-off: `strategy_invest_started` to `submitted` to `completed`, grouped by `strategy_id` and `risk_level`.
- Deposit (onramp) funnel: `deposit_started` to `deposit_completed`, grouped by `deposit_method`.
- Buy-tokens conversion: `token_detail_viewed` to `token_buy_completed`, grouped by `token_symbol` and `order_type`.
- Predictions: `prediction_market_viewed` to `prediction_bet_completed`.
- Active wallets (unique `user_id`), and Web Vitals by route.

## Reading analytics later

The Google Analytics MCP server (configured in Claude Code) lets you query this data in natural language without leaving the workflow. It is read-only and does not implement tracking; tracking is what this document and the `analytics-tracking` skill define.
