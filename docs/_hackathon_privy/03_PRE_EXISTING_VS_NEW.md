# Pre-existing vs new

> The honest continuity record for evaluators. Recorded 2026-09-13.

## Part 1. Before this branch

The public repository (`PoolPartyLabs/pool-party-v2-frontend`) was a July 2026 snapshot: the
investor app with the Universal Funding rail (Uniswap Trading API) and the Active Reserve track
(1inch Aqua). Its `/deposit` was a three-step Paybis stub, it had no `src/lib/onramp/`, no `buy` leg
in provisioning and Privy SDK `^3.29`.

The Privy on-ramp rail itself was **built in the private `interface-v2` repository between August
and September 2026** (epic POO-1793 and the Paybis foundation epic POO-1129 before it), by the same
team, against production traffic on the dev environment. This branch does not claim that work as
written during the event.

## Part 2. What this branch did

| Area | What landed | Where |
|---|---|---|
| On-ramp modules | 61 files: intents, settlement watcher, coverage probe, currency resolution, the Privy adapter and classifier, the Paybis foundation (dormant) | `src/lib/onramp/` |
| Deposit surface | The full state machine with the Privy path, `DepositPrivyCheckout`, currency select, standalone rail | `src/features/deposit/` |
| Provisioning | The `buy` leg in the planner, `provisioningView`, `PrivyBuyStep`, route picker, execution carousel, sticky footer | `src/lib/provisioning/`, `src/features/strategies/components/provisioning/`, `ProvisioningPanel.tsx`, `useProvisioningRail.ts` |
| Drifted shared modules | 7 modules gained the exports the port imports (`formatFiat`, `stableSymbol`, `getWrappedNative`, `AnalyticsFlow`, ...), plus the tx result and API error shapes, three UI components, the built-tx schema, the chain guard | `src/lib/utils/format.ts`, `src/lib/chains/config.ts`, `src/lib/analytics/events.ts`, `src/lib/tx/*`, `src/lib/api/*`, `src/components/ui/ExplorerTxLink.tsx`, `src/features/strategies/components/Transaction*.tsx` |
| Flags | `fiatOnRamp`, `privyOnRamp` (**default on** in this fork), `onRampCapture`, `robinhoodChain` (off) merged into the public registry; `activeReserve` kept | `src/lib/features/registry.ts`, `resolve.ts`, `docs/FEATURE_FLAGS.md` |
| Dependencies | `@privy-io/react-auth` 3.42.0, `@privy-io/wagmi` 4.0.17, `@sentry/nextjs` 10.73.0 as a library (never initialised) | `package.json`, `pnpm-lock.yaml`, `tests/__mocks__/sentry-nextjs.ts` |
| Wallet UX | `showWalletUIs: false` for headless embedded signing | `src/app/providers.tsx` |
| Security | Stripe loader hosts and Privy RPC host in CSP; Permissions-Policy allowlist; the Privy webhook relay | `src/lib/security/csp.ts`, `headers.ts`, `src/app/api/webhooks/privy/funds-deposited/route.ts` |
| Copy | Every key the ported code uses, in all 11 locales, values taken from the private repository's curated and machine-translated files | `src/i18n/messages/*/{deposit,strategies,common,errors,auth}.json` |
| Docs | Registry rows for 62 artifacts, 14 analytics events, flag rows, integration seams, env template, this package | `docs/` |
| hookrisk | Snapshot of the tool at `d256e91a`, provenance banner, excluded from the app's toolchain | `hookrisk/` |

Nothing under `src/` was rewritten by hand: files are the private main's versions, so a future sync
is a diff, not an archaeology.

## Part 3. What is deliberately not here

- `PaybisWidgetScript` is not mounted in the app layout; the Paybis rail is code, not a surface.
- Sentry is not initialised (no DSN, no instrumentation files, no source maps).
- `pt-PT` is not a configured locale in the public app.
- The Robinhood Chain flag exists so `src/lib/chains/config.ts` compiles verbatim; it ships off.
- The `ProvisioningWizardModal`, which the private repository deleted, is deleted here too; the
  panel is the single mount point.
