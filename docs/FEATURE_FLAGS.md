# Feature Flags

How the investor app ships features incrementally: launch v1 with a known-good subset, dark-launch
everything else, and turn features on **gradually** per environment — without big-bang releases.

This is the **technical spec**. The business/product contract (matrix, decisions, lifecycle policy)
lives in the Linear doc **"Feature Flags — v1 Launch & Progressive Rollout"** (Foundation project),
companion to **Product Rules — v1**. Code: [`src/lib/features`](../src/lib/features).

## TL;DR

- One **registry** ([`src/lib/features/registry.ts`](../src/lib/features/registry.ts), `PP-CORE-LIB-011`) is the single source of truth: one entry per area with its default state.
- Read flags through **`isFeatureEnabled(key)`** (server) or the **`useFeatureFlags()`** hook (`PP-CORE-HOK-011`, client). Never read `process.env.NEXT_PUBLIC_FEATURE_*` directly in a component.
- Override per environment with **`NEXT_PUBLIC_FEATURE_<KEY>=on|off`**. Flipping a prod flag = a redeploy with the env change.
- Flag **off** → area hidden from nav + entry links, and its route 404s via **`requireFeature(key)`**.

## Concepts — and what is NOT a flag

| Thing | Question it answers | Source |
|---|---|---|
| **Feature flag** | Is this *area* switched on in this environment? | this registry + env |
| **Role gate** (`isManager`) | Does *this user* get to see it? | backend identity (mock today) |
| **Mock mode** (`isMockMode`) | Mock or real data? | `NEXT_PUBLIC_MOCK_MODE` |

The Manager area ships in v1 and is **not** feature-flagged (murilo 2026-06-11): the sidebar
entry is always visible and `/manager/*` always resolves; only the **role** decides which state
shows ("Become a manager" vs "Manager"), via `isManager` (mocked by the Dev-menu toggle today).

## Resolution precedence (highest wins)

1. **Dev/QA session override** — non-prod only; layered **client-side** in `useFeatureFlags` (see [Dev/QA override panel](#devqa-override-panel) below). Flips nav + entry-link visibility live; does **not** reach the server `requireFeature` guard (`resolveFeature` stays env-pure).
2. **Per-flag env** — `NEXT_PUBLIC_FEATURE_<KEY>` (`on`/`off`/`true`/`false`/`1`/`0`).
3. **`NEXT_PUBLIC_FEATURE_ALL=on`** — non-prod only; reveals every off area (dev/staging dogfooding).
4. **Registry default** — `defaultEnabled` (the v1 launch state).
5. **Backend / remote value** — when the backend lands (POO-137). *Not built yet.*

Env reads are written as **static** `process.env.NEXT_PUBLIC_FEATURE_*` literals (one per flag in
[`resolve.ts`](../src/lib/features/resolve.ts)) so Next.js inlines them into the client bundle — a
dynamic `process.env[name]` would be `undefined` in the browser. They are read at **call time** so
tests can `vi.stubEnv(...)` without resetting modules.

## v1 launch matrix

| Flag | Env var | v1 prod | Stage | Gates |
|---|---|---|---|---|
| `home` | `NEXT_PUBLIC_FEATURE_HOME` | ✅ on | core | `/`, Home nav |
| `portfolio` | `NEXT_PUBLIC_FEATURE_PORTFOLIO` | ✅ on | core | `/portfolio`, Portfolio nav |
| `strategies` | `NEXT_PUBLIC_FEATURE_STRATEGIES` | ✅ on | core | `/strategies` (+ `/[id]`), Invest nav |
| `deposit` | `NEXT_PUBLIC_FEATURE_DEPOSIT` | ✅ on | core | `/deposit`, Deposit nav |
| `profile` | `NEXT_PUBLIC_FEATURE_PROFILE` | ✅ on | core | `/profile/*`, Profile nav |
| `rewards` | `NEXT_PUBLIC_FEATURE_REWARDS` | ✅ on | live | `/rewards/*`, RewardsPill, Profile reward rows |
| `cards` | `NEXT_PUBLIC_FEATURE_CARDS` | ⛔ off | next | `/cards`, mobile Cards tab |
| `savings` | `NEXT_PUBLIC_FEATURE_SAVINGS` | ⛔ off | planned | `/savings/*` |
| `buyTokens` | `NEXT_PUBLIC_FEATURE_BUY_TOKENS` | ⛔ off | planned | `/buy-tokens/*` |
| `predictions` | `NEXT_PUBLIC_FEATURE_PREDICTIONS` | ⛔ off | planned | `/predictions/*` |
| `perps` | `NEXT_PUBLIC_FEATURE_PERPS` | ⛔ off | planned | `/perps/*` |
| `adminConsole` | `NEXT_PUBLIC_FEATURE_ADMIN_CONSOLE` | ⛔ off | next | `/admin/*` (whole internal Admin Console, `adm.` host-gated). See POO-143/144 |
| `provisioning` | `NEXT_PUBLIC_FEATURE_PROVISIONING` | ⛔ off | next | Pre-flight provisioning gate inside the op modals (invest/withdraw/collect/compound/move-range/close). **Not a route** — never route-guarded. Baseline is a flat `false` (POO-1042 [R5]); it used to be computed from `NODE_ENV`, which made production behavior depend on how the image was built. In real mode it reads live balances and quotes real Uniswap routes, so it also needs `UNISWAP_API_KEY`. |
| `swapScreen` | `NEXT_PUBLIC_FEATURE_SWAP_SCREEN` | ⛔ off | next | The standalone swap + bridge screen at `/swap` (POO-1046, hackathon POO-1022), **and** the wallet modal's Swap action that routes to it. Route-guarded: a deep link 404s while off, and the modal keeps the inert "coming soon" it has had since POO-240. Independent of `provisioning`: that gates the pre-flight gate EMBEDDED in the six op modals, this gates a ROUTE. They share the whole rail below them and are still two separate launch decisions. A live route also needs real mode + the server-side Uniswap credentials. **Needs a design pass before launch** (no Figma exists for the screen). |
| `fiatOnRamp` | `NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP` | ✅ on | live | **Hackathon fork (public repository, 2026-09): default ON**, so a fresh clone runs the Privy rail with no env file; the env var still wins per environment. Original launch posture follows. The Paybis fiat on-ramp as a first-class funding option **inside provisioning** (epic POO-1129): buy USDC/ETH on Base, then swap/bridge toward the operation's chain. The **one authority** on whether a buy leg exists — the planner reads it to emit the `buy` step (`computePlanAction` → `buildPlan.onRampEnabled`, POO-1135) and `resolveFundingRoutes` reads the SAME flag for its `onRampEnabled`, so the plan behind a buy route and the route the picker offers can never disagree. **Not a route gate**, not `isManager`, not `isMockMode`. Distinct from `provisioning` (the pre-flight gate as a whole) and `deposit` (the standalone `/deposit` route). Ships off until the on-ramp execution rail (POO-1136 widget/settlement) and CTA repoint (POO-1137) land, so a buy route is never offered before it can execute. |
| `privyOnRamp` | `NEXT_PUBLIC_FEATURE_PRIVY_ON_RAMP` | ✅ on | live | **Hackathon fork (public repository, 2026-09): default ON**, so a fresh clone runs the Privy rail with no env file; the env var still wins per environment. Original launch posture follows. **Which rail serves the fiat on-ramp**, once `fiatOnRamp` above has offered it at all (POO-1800, epic POO-1793): off = Paybis (today's rail), on = Privy. **[R1] never turns fiat on by itself**: the pair resolves through `resolveOnRampProvider()` / `useOnRampProvider()` (`src/lib/onramp/onRampProvider.ts`, `PP-CORE-LIB-105` / `PP-CORE-HOK-034`) to one of three states, `none` / `paybis` / `privy`, and a host must read that helper rather than test the two booleans itself. Safe to promote per environment ahead of the migration, because with `fiatOnRamp` off it changes nothing a buyer can see. **Not a route gate**, not `isManager`, not `isMockMode`: the vendor environment is DERIVED ([R3], `resolveOnRampEnvironment` = production only when the app env is production/prod AND `NEXT_PUBLIC_MOCK_MODE=false`) and mock-vs-real stays the hosts' own `realRail` guard. **[R2] DEATH CONDITION: deleted in the same PR that deletes the last Paybis module**, a migration switch rather than a release flag, and `registry.test.ts` pins the sentence so it cannot be quietly dropped. |
| `onRampCapture` | `NEXT_PUBLIC_FEATURE_ON_RAMP_CAPTURE` | ⛔ off | next | **Temporary diagnostics, not a product surface.** On, `paybisCapture.ts` (`PP-CORE-LIB-102`, POO-1598 S3/S4) records the Paybis widget's `postMessage` stream as an ordered, allow-list-redacted sequence on the existing first-party rail (`shipClientErrorReport` → `/api/client-error` → container log + Sentry Logs), joined to the API's own Paybis capture by `browserTraceId()` and the Paybis `requestId`. Off, the module ships **nothing at all**. **Not a route gate**, not `isManager`, not `isMockMode`. Exists because dev runs Paybis **sandbox**, which sells almost nothing, so the geofencing and in-widget-change questions (POO-1426 Q1 / POO-1577 / POO-1578) are only answerable from one real production purchase. Read ONCE per widget session at arm time, so a flip mid-purchase cannot split a capture in half. **Lifecycle: ship off → prove inert on dev → release → on in prod for ONE purchase → off → delete the instrument with the fixtures (POO-1598 S5).** Known and accepted: `NEXT_PUBLIC_FEATURE_ALL=on` sweeps it on, but that switch is non-prod only and dev has no real buyer. |
| `robinhoodChain` | `NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN` | ⛔ off | next | **Chain participation gate, not an area gate** (POO-1776, epic POO-1766). Gates **two** things for Robinhood Chain (Arbitrum Orbit, id 4663, ETH gas, USDG stable). **(1) Selectors** - the strategy builder's network chips (`MandateStep`) and the `/swap` destination pills, via `selectableChainMetas` / `isNetworkSelectable`. **(2) Data fan-out** - every per-network enumeration that talks to the network, via `activeChainMetas`: `fetchStrategies` (`pools?network=robinhood`), `fetchWalletHoldings` (`wallet/{addr}?network=robinhood`), `getRealTokenBalances` (the 4663 USDG RPC read) and `fundingInventory`'s `reachableChainIds` (the funding route's destination chains, inert until Uniswap routes to 4663). Off, none of those calls is made: an environment whose backend has never heard of the slug would otherwise answer 400 to one catalog call per page load and one wallet call per user. What is **never** gated: wagmi `supportedChains` + its transport, `defaultChain`, the wallet `NETWORKS` presentation list and every by-id/by-slug lookup - a wallet already sitting on 4663 connects, signs SIWE and switches whatever the flag says, and a holding on it still renders with a name and a logo. Dropping it out of wagmi would break exactly the user the alpha exists for; offering it in a picker is the product RECOMMENDING it, and fanning out to it is spending every user's page load on it. **Not a route gate** (there is no `/robinhood` route), not `isManager`, not `isMockMode`. Off in dev AND prod; dev turns it on with `NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN=on` in its untracked `.env.dev` **before the image build** (`NEXT_PUBLIC_*` is baked, not read at boot) - the fan-out reads it through `isFeatureEnabled`, so the Dev menu's client-side QA toggle moves the selectors but **not** the server-side reads. Robinhood is deliberately NOT a deposit / on-ramp network in the alpha ([R4]). **Retire the flag once the chain leaves alpha.** |
| `virtualize` | `NEXT_PUBLIC_FEATURE_VIRTUALIZE` | ⛔ off | next | Presentational **rendering-strategy** switch (windowed lists) on already-launched surfaces. **Not a route gate**, not `isManager`, not `isMockMode` - it only flips how long lists render (windowed vs plain `.map()`). Default off = plain `.map()` baseline. POO-623 epic; see ADR-0001. |
| `strategyCategoryFilter` | `NEXT_PUBLIC_FEATURE_STRATEGY_CATEGORY_FILTER` | ⛔ off | next | Presentational **control** gate for the whole POO-830 category-tags surface. **Investor (PR2):** the multi-select asset-category filter (Bitcoin / Ethereum / Stablecoins / Altcoins / Meme coins) on the already-launched Strategies Explore screen. **Manager (PR3):** the read-only asset + objective tag rows in the strategy builder's `DerivedMandateCard` preview. **Not a route gate**, not `isManager`, not `isMockMode` - it only decides whether these controls show. Off = today's Explore + builder behavior; on reveals both (Explore filters client-side, OR semantics, over the loaded strategies). POO-830 PR2 + PR3. |
| ~~`financialsV2`~~ | ~~`NEXT_PUBLIC_FEATURE_FINANCIALS_V2`~~ | **REMOVED** | — | **Retired (POO-990 / PP-CORE-LIB-048).** Was the POO-936 data-source switch for the analytics `/financials` cutover. The flag + its legacy OFF branch (the `/metrics` path, the `invested ?? balance` / `feesEarned ?? collectedFees` fallbacks, the cross-backend Total-Yield join, the FE `Math.max` re-clamps) were DELETED — FE v2 now reads the C1 `/financials` endpoint UNCONDITIONALLY in real mode (a null read renders "not available yet", never a legacy figure). No env override exists any more. Do NOT re-introduce a flag-gated legacy financials fallback. |

**core** = on by default, nav-level kill-switch only (route is *not* 404-guarded) · **live** =
launched · **next** = in active build behind the flag · **planned** = registered, not built.

> **`virtualize` tuning knob (POO-660):** the flag only decides *whether* windowing is allowed; a list
> still renders plainly until its row count exceeds a threshold (default **500**). `THRESHOLD` reads
> `NEXT_PUBLIC_VIRTUALIZE_THRESHOLD` (a static, build-time-inlined value; unset/invalid → 500). Dev
> sets it to **5** in `.env.dev` so the windowed path is exercised on the small dev dataset; prod
> leaves it unset. This is *not* a feature flag (it is not in the registry) — it is a plain
> `NEXT_PUBLIC_*` build value, like `NEXT_PUBLIC_CHAIN_ID`. See `useVirtualizeGate.ts`.

## How to gate something

**A route** (server component — `page.tsx` or `layout.tsx`):

```tsx
import { requireFeature } from "@/lib/features/requireFeature";

export default async function CardsPage(/* … */) {
  // …
  requireFeature("cards"); // 404s when off; deep-links + SSR gated server-side
  return <CardsView />;
}
```

For a multi-page area, guard once in the area `layout.tsx` (see [`(app)/rewards/layout.tsx`](../src/app/[locale]/(app)/rewards/layout.tsx)).

**A nav item** — add `flag` to the `NavItem` in [`AppShell.tsx`](../src/components/layout/AppShell.tsx); items whose flag is off are filtered out.

**An entry link / widget** (client component):

```tsx
const { isEnabled } = useFeatureFlags();
return isEnabled("rewards") ? <RewardsPill … /> : null;
```

## How to add a new flag

1. Add an entry to `FEATURES` in [`registry.ts`](../src/lib/features/registry.ts) (`defaultEnabled: false`, `stage: "next"`).
2. Add its `case` to `envOverride()` in [`resolve.ts`](../src/lib/features/resolve.ts) (a static `process.env.NEXT_PUBLIC_FEATURE_<KEY>` line).
3. Document it in [`.env.example`](../.env.example).
4. Gate the nav item / route / links as above.
5. Open the area build issue; reference the flag.

## How to launch (flip on) / retire a flag

- **Flip on:** set `NEXT_PUBLIC_FEATURE_<KEY>=on` in the target environment and redeploy. Promote dev → staging → prod.
- **Retire:** once an area is stable and permanent, **remove the flag** — delete the gate, make the area unconditional, drop the registry entry + env var, and update this matrix. No long-lived release flags → no flag debt.

## Local development

- Defaults are prod-like. Reveal an area locally in `.env.local`: `NEXT_PUBLIC_FEATURE_CARDS=on`.
- Reveal everything at once (non-prod): `NEXT_PUBLIC_FEATURE_ALL=on`.

## Dev/QA override panel

The **Dev menu** (top bar, non-prod only — [`DevMenu.tsx`](../src/components/layout/DevMenu.tsx), `PP-CORE-CMP-024`) has a **Feature flags** section that flips any area on/off **live** — no env var, no rebuild. Useful for QA-ing launch gating (which areas appear) without a redeploy.

- **Store:** [`devOverrides.ts`](../src/lib/features/devOverrides.ts) — a client-only, non-prod session store persisted to `localStorage` (`pp:ff-overrides`) and exposed reactively via `useSyncExternalStore`. `useFeatureFlags` layers it on top of the env/registry resolution; **`resolveFeature` stays env-pure**.
- **Scope:** overrides affect the **client** read (nav, entry links, any `useFeatureFlags` consumer) live. They do **not** reach the **server** `requireFeature` guard — a forced-on area shows in the nav, but its route still 404s. For direct route access in dev, use `NEXT_PUBLIC_FEATURE_<KEY>=on` (or `NEXT_PUBLIC_FEATURE_ALL=on`).
- **Hydration-safe:** the SSR snapshot is env-only, so overrides apply after mount (no hydration mismatch).
- **Production:** the whole Dev menu (and this store) is gated by `isDevPanelEnabled()` (non-prod, via `NEXT_PUBLIC_APP_ENV`) and is **removed before launch** (`PP-INTEGRATION-POINT`).

## Out of scope (future)

- **Backend / remote flags** (per-user targeting, % rollout, live flips without a deploy) — POO-137; adopt via the service-factory seam. A 3rd-party (LaunchDarkly / PostHog / GrowthBook / Unleash) can plug in there if ever needed.
