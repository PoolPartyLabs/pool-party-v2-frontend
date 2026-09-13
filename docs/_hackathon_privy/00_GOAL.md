# Goal

> Placeholder narrative, recorded 2026-09-13. Refine before submission.

## The goal statement

**A company creates its account with Google and adds liquidity to its funds with almost no effort.**
Concretely, one continuous session in the public build of the investor app:

1. **Sign in with Google** (`PP-AUTH-SCR-001`). Privy creates an embedded wallet for a user who has
   none (`createOnLogin: "users-without-wallets"`). No extension, no seed phrase.
2. **Add funds with a card** at `/deposit` (`PP-DEP-SCR-001`). The Privy fiat checkout opens inside
   the product, priced in the buyer's own currency, delivering USDC on Base to the embedded wallet.
   The receipt prints the **observed** on-chain delta, never the amount typed.
3. **Invest in a strategy.** If the wallet is short for the strategy's chain, the provisioning gate
   emits a `buy` leg, rendered by `PrivyBuyStep` (`PP-STR-CMP-029`), then swaps and bridges through
   the Universal Funding rail already in this repository. The embedded wallet signs headlessly
   (`showWalletUIs: false`), so the product's own confirmation sheet is the only prompt.
4. **Settlement is the truth.** Every `completed` event and every receipt fires on a balance read,
   not on a provider callback or a click (ADR-0004, ADR-0006 in the private repository; premise 11).

## Scope of this branch (`hackathon/privy-institutional-onramp`)

Two lanes, both landing on the public repository `PoolPartyLabs/pool-party-v2-frontend`:

- **Lane 1, the Privy on-ramp.** Port the fiat on-ramp lineage (Paybis foundation plus the Privy rail,
  epic POO-1793) from the private `interface-v2` repository onto the public July baseline, as new
  commits, never as a tree replacement. Flip `fiatOnRamp` and `privyOnRamp` to **default on** so a
  fresh clone runs the flow without an env file. Keep Paybis in the tree, dormant behind the flag.
- **Lane 2, hookrisk.** Bring the `hookrisk` tool (developed during the hackathon in a private
  repository) into `hookrisk/` at the repository root, with no link to the app, so the risk analysis
  of a Uniswap v4 hook and its full report can be presented from the same public repository.

## Decisions taken, and why

| Decision | Alternatives considered | Why |
|---|---|---|
| Port the **whole** on-ramp lineage (~94 source files, ~265 tests) rather than a Privy-only surgical port | Hand-written glue into the July `DepositScreen` / `ProvisioningPanel` | The Privy rail sits on the planner's `buy` leg, the intent journal, the settlement watcher and the currency resolver, none of which the public baseline had. Copying tested modules and adding ~14 helper exports to 7 drifted shared modules was mechanical; bespoke glue would have diverged from the private main and shipped untested |
| `fiatOnRamp` + `privyOnRamp` **default on** in this fork | Env-only documentation | The public repository is the demo. A flag that ships off makes a fresh clone show nothing |
| Demo against the **dev API and a Privy dev app** (`NEXT_PUBLIC_APP_ENV=development`) | Production; mock-first | The vendor environment is derived: development means Stripe sandbox, so no real card is ever charged on stage. Mock mode deliberately bypasses Privy |
| Privy SDK pinned to **3.42.0** (+ wagmi adapter 4.0.17) | Stay on ^3.29 | `useAddFunds` ships from 3.40; the outcome classifier reads the 3.40 bundle's error strings |
| `@sentry/nextjs` added **as a library only**, never initialised | Rewrite the five ported modules that import it | Keeps the ported files byte-identical to the private main; without a DSN the SDK is inert |
| hookrisk as a **snapshot** with a provenance banner, not a subtree | `git subtree add` | The source repository is private; a snapshot carries no private history into a public tree |
| **No tree replacement** of the public main | Force-push the private history | The public main carries the Aqua track, which the private main never merged, and a public history should not become a mirror of a private one |

## Out of scope (named so it is not assumed)

- Paybis widget mounting (`PaybisWidgetScript`) and the Paybis capture diagnostics stay unmounted.
- Sentry initialisation, source maps and the error-report UI.
- The `pt-PT` locale (the public app ships 11 locales; the private app 12).
- Cross-session resumption of a settlement window (POO-1833 in the private tracker).
