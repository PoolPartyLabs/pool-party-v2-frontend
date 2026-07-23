---
name: analytics-tracking
description: Implement event tracking in the Pool Party Frontend with GTM + GA4. Defines the dataLayer schema, the OAMS event taxonomy, the useAnalytics() hook, Consent Mode v2, privacy rules (server-HMAC wallet addresses, never track secrets), Web Vitals, and how to test tracking. Stack-agnostic at the component level.
---

# Analytics Tracking

How to instrument the Pool Party Frontend so every meaningful user action is tracked, privacy-first, via Google Tag Manager (GTM) as the hub and GA4 as the destination. Canonical spec: `docs/09_ANALYTICS.md`. Living event list: `docs/ANALYTICS_EVENTS.md`.

## Principle

Track behavior, never identity secrets. The app pushes events to a `dataLayer`; GTM reads it and dispatches to GA4 (and future destinations). Components never know the destination: they call `useAnalytics()`.

## Architecture

```
Component / Hook  ->  useAnalytics().track(event, params)  ->  window.dataLayer.push(...)
                                                                      |
                                                                     GTM (hub)
                                                                      |
                                                                     GA4 (destination today)
                                                                     + future: pixels, product analytics
```

## Stack

- `@next/third-parties/google` for the `GoogleTagManager` component (optimized script loading).
- A single GTM container ID in `NEXT_PUBLIC_GTM_ID`.
- GA4 configured as a tag inside the GTM container (not in code).
- Consent Mode v2 wired before any tag fires.

If `NEXT_PUBLIC_GTM_ID` is absent (local dev), `useAnalytics()` becomes a no-op that logs to console in debug mode. Tracking never breaks the app.

## Event taxonomy (OAMS)

### Naming rule
```
<area>_<object>_<action>
```
- snake_case (GA4 requirement), max 40 chars.
- `area`: an OAMS surface: `auth`, `wallet`, `nav`, `app`, `dashboard`, `portfolio`, `strategy`, `savings`, `token`, `prediction`, `perp`, `card`, `deposit`, `reward`.
- `object`: the thing acted on (signin, connect, invest, deposit, withdraw, buy, sell, bet, trade, request, topup, etc.).
- `action`: past tense for completion, present for attempt/intent. Transactional flows: `started` then `submitted` then `completed` (or `failed`).

There are no `pool_*`, `liquidity_*`, or `swap_*` events; Pool Party has no Uniswap-style primitives.

### Canonical examples
| Event name | When it fires |
|------------|---------------|
| `auth_signin_started` | User taps Continue with Google |
| `wallet_connect_completed` | External wallet connected (Carlos) |
| `strategy_detail_viewed` | Strategy detail screen rendered |
| `strategy_invest_started` | Invest flow opened |
| `strategy_invest_submitted` | User confirmed the invest amount |
| `strategy_invest_completed` | Investment confirmed (mock today) |
| `strategy_collect_completed` | Yield collected |
| `savings_deposit_completed` | Deposit into a savings market confirmed |
| `token_buy_submitted` | Buy order confirmed (see `order_type`) |
| `prediction_bet_completed` | Prediction bet placed |
| `perp_trade_submitted` | Perp order confirmed (see `side`, `leverage`) |
| `deposit_completed` | Fiat onramp deposit confirmed |
| `card_request_completed` | Card requested |

### Standard parameters
| Param | Type | Notes |
|-------|------|-------|
| `value` | number | USD value. GA4 standard. Exact allowed. |
| `currency` | string | Always `'USD'` when `value` present (GA4 requires it). |
| `usd_value_at_time` | number | USD value at the moment of the transaction (price-at-time rule). |
| `token_amount` | number | Per-token amount, paired with `usd_value_at_time`. |
| `token_symbol` | string | USDC, ETH, BTC, HYPE, etc. |
| `strategy_id` | string | Managed strategy. |
| `position_id` | string | A held strategy position. |
| `market_id` | string | Savings market. |
| `risk_level` | number | 1 to 5. |
| `order_type` | string | `'market'` or `'limit'`. |
| `order_status` | string | `'filled'` or `'open'`. |
| `side` | string | `'long'`/`'short'` (perps) or `'yes'`/`'no'` (predictions). |
| `outcome` | string | Prediction outcome label. |
| `leverage` | number | Perps leverage. |
| `prediction_id`, `perp_market`, `card_issuer`, `deposit_method` | string | Per-surface ids/labels. |
| `reward_program`, `share_period`, `share_target` | string | Rewards / sharing surface labels. |
| `chain_id` | number | 8453 (Base), etc. |
| `user_id` | string | Server-side **HMAC-SHA-256** of the wallet address (via `/api/analytics/user-id`). Never the raw address; the browser never hashes it. |
| `page_path` | string | Route path (`page_viewed`). |
| `locale`, `previous_locale` | string | Target / prior locale (`locale_changed`). |
| `error_code` | string | Error **digest** (`app_error_shown`). Never the message. |
| `metric_name`, `metric_value`, `metric_rating` | string/number | Web Vitals (`web_vitals`). |

## Privacy rules (mandatory)

### Never track (absolute blacklist)
Seed phrases, private keys, anything that could reconstruct wallet control. These never touch the dataLayer, never get logged, never get hashed-and-sent. Not even in debug. The `analytics-instrumenter` agent and `security-reviewer` hard-fail any PR that does.

### Pseudonymize
- **Wallet address**: `user_id` is a server-side **HMAC-SHA-256** of the address (keyed by `PP_ANALYTICS_USER_ID_SECRET`), obtained from the first-party `/api/analytics/user-id` route. The browser **never** hashes the address itself and never sends the raw address to analytics. (A plain SHA-256 of a 20-byte address is reversible by precomputation, which is why a keyed HMAC is used.)

### Allowed (exact)
- Transaction values, balances, USD amounts (including `usd_value_at_time`). Numbers, not PII; balances are public on-chain.

### Identified analytics (the user_id flow, POO-164 / POO-352)

`user_id` is a **server-derived, keyed HMAC**, not a client hash:

1. The client sends the raw address **only** to the first-party route `POST /api/analytics/user-id` (`src/app/api/analytics/user-id/route.ts`), never to the dataLayer.
2. The route computes `HMAC-SHA-256(address, PP_ANALYTICS_USER_ID_SECRET)` server-side (`src/lib/analytics/hashWalletAddress.ts`), guards with a `Sec-Fetch-Site` same-origin check, and returns `null` gracefully when the secret is unset. The secret is server-only (never `NEXT_PUBLIC_`).
3. `AnalyticsIdentify` (`src/components/analytics/AnalyticsIdentify.tsx`) requests the hash and stores it in module state **only when the wallet is connected AND `consent === 'granted'`**; it never holds the raw address.
4. `useAnalytics` merges that stored `user_id` into params, and `sanitizeParams` drops it again if consent is not granted.

**Never** reintroduce a browser-side `crypto.subtle.digest('SHA-256', address)`: a 20-byte address has too little entropy, so an unkeyed hash is trivially reversible. The server secret is what makes the pseudonym non-reversible.

## The useAnalytics() hook

```ts
// src/lib/analytics/useAnalytics.ts
/**
 * @id PP-CORE-HOK-010
 * @description Single tracking entry point. Pushes typed events to the dataLayer.
 * @implements-rules-version v1
 */
'use client'
import { useCallback } from 'react'
import type { AnalyticsEvent, AnalyticsParams } from './events'

export function useAnalytics() {
  const track = useCallback((event: AnalyticsEvent, params?: AnalyticsParams) => {
    if (typeof window === 'undefined') return
    // PP-INTEGRATION-POINT: GTM reads this dataLayer; GA4 is the configured destination.
    const granted = readConsent() === 'granted'
    const withId = { ...params, ...(granted ? { user_id: getStoredUserId() } : {}) }
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push({ event, ...sanitizeParams(withId, granted) })
  }, [])
  return { track }
}
```

`sanitizeParams(params, consentGranted)` (`src/lib/analytics/sanitizeParams.ts`) drops blacklist keys, drops any value that looks like a raw address or private key, and drops `user_id` unless `consentGranted`. It is a backstop, not permission to pass secrets.

### Typed events
```ts
// src/lib/analytics/events.ts
export type AnalyticsEvent =
  | 'auth_signin_started'
  | 'wallet_connect_completed'
  | 'strategy_invest_submitted'
  | 'savings_deposit_completed'
  | 'token_buy_submitted'
  | 'prediction_bet_completed'
  | 'perp_trade_submitted'
  | 'deposit_completed'
  // ... full union, kept in sync with docs/ANALYTICS_EVENTS.md
export interface AnalyticsParams {
  value?: number
  currency?: 'USD'
  usd_value_at_time?: number
  token_amount?: number
  token_symbol?: string
  strategy_id?: string
  position_id?: string
  market_id?: string
  risk_level?: 1 | 2 | 3 | 4 | 5
  order_type?: 'market' | 'limit'
  order_status?: 'filled' | 'open'
  side?: 'long' | 'short' | 'yes' | 'no'
  outcome?: string
  leverage?: number
  prediction_id?: string
  perp_market?: string
  card_issuer?: string
  deposit_method?: 'pix' | 'card' | 'applePay' | 'bank' | 'crypto'
  reward_program?: string
  share_period?: string
  share_target?: string
  chain_id?: number
  user_id?: string // server HMAC only, attached after consent
}
```

The union forces every event to exist in the canonical list. A typo will not compile.

## Component usage

```tsx
const { track } = useAnalytics()

const handleInvest = async () => {
  track('strategy_invest_started', { strategy_id, risk_level })
  try {
    await invest(amount)
    track('strategy_invest_completed', { strategy_id, value: amount, currency: 'USD' })
  } catch {
    track('strategy_invest_failed', { strategy_id })
  }
}
```

For testability, complex components may receive `track` via props (injected), defaulting to the hook.

## Consent Mode v2

- Consent banner is a client component, translated via next-intl (namespace `consent`).
- Before consent: GTM loads, Consent Mode `denied` for `analytics_storage` and `ad_storage`. GA4 sends only cookieless pings.
- After consent: update to `granted`, full tracking. `user_id` (hashed wallet) only attaches after `granted`.
- Choice persists in the `pp_consent` first-party cookie.

```ts
// default, before any interaction
gtag('consent', 'default', {
  ad_storage: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500,
})
```

The default-deny snippet (`src/lib/analytics/consentSnippet.ts`) is injected inline before GTM in `layout.tsx` and is **pinned by SHA-256 hash in the CSP** (`src/lib/security/csp.ts`); editing the snippet text requires updating that hash (guarded by `csp.test.ts`).

## Web Vitals

Report Core Web Vitals (LCP, INP, CLS, FCP, TTFB) via `useReportWebVitals` from `next/web-vitals`, pushed as `web_vitals` with `metric_name`, `metric_value`, `metric_rating`.

## View, navigation, and lifecycle events

### View events from Server Components — `<TrackView>` / `useTrackView`
Most screens are **Server Components** (the route fetches data and passes it in) and cannot call hooks. To emit a `*_viewed` event, drop the tiny client wrapper `<TrackView>` into the route `page.tsx` (or any server subtree); it fires once on mount and renders nothing.

```tsx
// src/app/[locale]/(app)/page.tsx — a Server Component
import { TrackView } from '@/components/analytics/TrackView'

return (
  <>
    <TrackView event="home_viewed" />
    <HomeView {...props} />
  </>
)
```

`<TrackView>` is backed by `useTrackView(event, params)` (`PP-CORE-HOK-012`): a fire-once hook that snapshots the event/params at mount and guards with a ref, so re-renders and React's dev double-invoke never re-fire. Call the hook directly inside components that are already Client Components (e.g. an error boundary). Never convert a Server Component to a Client Component just to track a view — use `<TrackView>`.

### Click / navigation events from Server Components
When the action is a link rendered by a Server Component (e.g. a card that navigates), wrap the locale-aware `Link` in a tiny client component that tracks on click, keeping the parent server. Example: `PositionLink` fires `position_detail_viewed`, then navigates.

```tsx
'use client'
export function PositionLink({ positionId, strategyId, className, children }: PositionLinkProps) {
  const { track } = useAnalytics()
  return (
    <Link
      href={`/strategies/${strategyId}`}
      className={className}
      onClick={() =>
        track('position_detail_viewed', { position_id: positionId, strategy_id: strategyId })
      }
    >
      {children}
    </Link>
  )
}
```

### page_view (decision — murilo 2026-06-08)
GA4 **Enhanced Measurement** sends the native `page_view` (including SPA history changes); that is the **canonical** pageview metric for standard reports. The app's custom `page_viewed` (fired by `AnalyticsListener` on pathname change) is a **different** event name — no double count — and is **optional/secondary**: keep it only for its `page_path` parameter, do not build pageview reporting on it.

### locale_changed
`LocaleSwitcher` fires `locale_changed` with `previous_locale` and `locale` on switch (before navigating).

### app_error_shown (error boundary)
`src/app/[locale]/error.tsx` (a Client Component error boundary) renders `ErrorState` and fires `app_error_shown` once via `useTrackView`, carrying only `error_code` (the error **digest**) — never `error.message`, which can carry sensitive detail.

## How to instrument an existing component (step by step)

1. Identify user actions (clicks, submits, views, errors).
2. For each, pick or create a canonical OAMS event following the taxonomy.
3. If new, add it to the `AnalyticsEvent` union AND to `docs/ANALYTICS_EVENTS.md`.
4. Call `track(event, params)` at the right moment.
5. Never send the raw address. `user_id` comes from the server HMAC flow and attaches only after consent (see "Identified analytics").
6. Add a test asserting the dataLayer push.
7. Mark the file header with `@analytics-events` listing the events it fires.

## How to test tracking

```ts
beforeEach(() => { window.dataLayer = [] })

it('pushes strategy_invest_started on invest click', async () => {
  render(<InvestButton strategyId="str_1" />)
  await userEvent.click(screen.getByRole('button'))
  expect(window.dataLayer).toContainEqual(
    expect.objectContaining({ event: 'strategy_invest_started' })
  )
})

it('never pushes a raw address', async () => {
  // ... assert no dataLayer entry contains a 0x-prefixed 40-hex string
})
```

### Test gotchas
- Reset `window.dataLayer = []` in `beforeEach`.
- Components rendering the locale-aware `Link` (`@/i18n/navigation`) must **mock** it — next-intl's client navigation cannot resolve `next/navigation` under vitest. Use the project-wide Link-as-anchor mock so `href`/`onClick` pass through:

```tsx
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
```

## Anti-patterns

- Calling `gtag()` or pushing to `dataLayer` directly in a component (always via `useAnalytics()`).
- Sending the raw wallet address.
- Tracking before consent for identified events.
- Free-text event names not in the canonical union, or pre-OAMS names (`pool_*`, `liquidity_*`, `swap_*`).
- Tracking a value without `currency`.
- Putting any blacklist item anywhere near analytics, even in a comment.
- Configuring the GA4 tag in code instead of in the GTM container (defeats the hub).
- Converting a Server Component to a Client Component just to fire a view event (use `<TrackView>` / `useTrackView`).
