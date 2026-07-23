# Pool Party V2 Frontend, Architecture Ground Truth (2026-06-28)

Built by a read-only agent swarm over `src/`. Anchors the CLAUDE.md + skills rebuild.
This is the REAL state, which supersedes the "everything mocked, no API/RPC/wallet" narrative in the old CLAUDE.md.

## One-line summary
Mock-first by default (`NEXT_PUBLIC_MOCK_MODE`), but auth, analytics, and web-security are already REAL;
data services are fully wired behind a toggle and 151 `PP-INTEGRATION-POINT` seams.

## Integration status by surface

| Surface | Status | Evidence |
|---|---|---|
| Wallet / auth (Privy + wagmi/viem) | REAL | `@privy-io/react-auth` 3.29.2, `@privy-io/wagmi` 4.0.11; `src/app/providers.tsx:74-109` (gated on `!isMockMode`) |
| Chains | Arbitrum (42161), Base (8453), Polygon (137) | `src/lib/chains/config.ts:54,59,74` |
| Session auth | REAL | SIWE → JWT in httpOnly cookie `pp_access_token`; `src/lib/auth/session.ts:21,47-70` |
| Analytics (GTM/GA4) | REAL | `@next/third-parties`; `src/app/[locale]/layout.tsx:66`; Consent Mode v2 `src/lib/analytics/consentSnippet.ts`; ~60 events `src/lib/analytics/events.ts` |
| Analytics user-id (pseudonym) | REAL | HMAC-SHA256 of address, `src/app/api/analytics/user-id/route.ts` (POO-164) |
| Web security (headers + CSP) | REAL | `src/lib/security/headers.ts`, per-request nonce `src/middleware.ts` + `src/lib/security/csp.ts` (Report-Only), `/api/csp-report` |
| Main API client | BUILT, mock-by-default | `apiFetch` server-only, x-api-key, GET retries, Next cache tags; `src/lib/api/client.ts:128-255` |
| Analytics indexer client | BUILT, mock-by-default | `analyticsFetch`; `src/lib/analytics-api/client.ts:56-146` |
| Data services (tokens, strategies, positions, balances, rewards, manager, cards, tx) | MOCKED-ONLY | `src/lib/services/index.ts` ternary; real branch placeholder; fixtures in `src/mocks/` |
| Paybis (fiat on/off-ramp) | MOCKED-ONLY (CSP-ready) | `src/features/deposit/DepositScreen.tsx:192-205`; allowlisted `src/lib/security/csp.ts:66,76`; SDK not installed |
| CoinGecko (prices) | ABSENT | logo CDN only; no price feed |

## The mock toggle
`export const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE !== "false"` — `src/lib/services/index.ts:57`.
Default = mock. Flip to real: set `NEXT_PUBLIC_MOCK_MODE=false` + populate `PP_API_URL`, `PP_API_KEY`, `ANALYTICS_API_URL`, and uncomment the real ternary branches.

## Env vars (integration layer)
Server-only: `PP_API_URL`, `PP_API_KEY`, `PP_API_URL_LEGACY`, `ANALYTICS_API_URL`, `PP_ANALYTICS_USER_ID_SECRET`.
Client (`NEXT_PUBLIC_`): `MOCK_MODE`, `CHAIN_ID`, `APP_ENV`, `GTM_ID`, `PRIVY_APP_ID`, `PRIVY_CLIENT_ID`, `MIN_AMOUNT_FOR_ADD_LIQUIDITY`, `MIN_AMOUNT_FOR_CREATE_POOL`, `FEATURE_<KEY>`, `FEATURE_ALL`.

## Comment-tag census (src/)
`PP-INTEGRATION-POINT` 151 · `PP-MOCK` 52 · `PP-TODO` 3 · `PP-FIXME` 1 · `PP-DEBT` 1.

## Feature surfaces
Modules: auth, home, portfolio, strategies, deposit, profile, rewards, manager, cards, wallet.
Flags (`src/lib/features/registry.ts`): launched (on) = home, portfolio, strategies, deposit, profile, rewards.
Dark-launched (off) = cards, savings, buyTokens, predictions, perps.
Three orthogonal gates: `isMockMode` (data source) · feature flag (is area launched) · `isManager` (role, derived from positions, `src/lib/account/useIsManager.ts`).

## Cross-cutting (all MATCH current config)
- i18n: 11 locales in `src/i18n/config.ts` (en, pt-BR, es, fr, de, nl, ja, ko, zh-CN, zh-TW, vi); per-locale dirs `src/i18n/messages/`; `i18n:check` script.
- Tailwind v4 CSS-first `@theme` in `src/app/globals.css`; no `tailwind.config.ts`; primitives in `src/components/ui/` (NOT `src/design-system/primitives/`, which is a placeholder).
- Tests: vitest 4 + coverage thresholds (global 75/70/82/78; utils 95/95/90; schemas 100); Storybook 10 + addon-a11y.
- Formatting: `src/lib/utils/format.ts` = ID **PP-CORE-LIB-013** (config drift: number-formatting skill says 011). Native `Intl`, pinned en-US.

## Config drift to fix
1. CLAUDE.md "everything mocked / no API / no RPC / no real wallet" → false; rewrite to mock-first-with-real-seams.
2. CLAUDE.md claims 12 agents / 16 skills; disk has 19 agents / 42 skills (26 skills + 11 agents are EVM/Solana/protocol).
3. `format.ts` ID 011 → 013 in number-formatting skill.
4. INDEX.md "active subset" is fiction at runtime (all 42 surface every session) until protocol fleet is moved out of `.claude/skills/`.
