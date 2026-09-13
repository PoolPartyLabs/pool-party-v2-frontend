# The Privy on-ramp flow, module by module

> Placeholder narrative, recorded 2026-09-13. The module map is accurate to the tree; the prose is
> the working version.

## One decision table, two hosts

Which rail serves fiat is decided ONCE, in `decideOnRampRail(fiatOnRamp, privyOnRamp)`
(`src/lib/onramp/onRampProvider.ts`, `PP-CORE-LIB-105`), read by the server through
`resolveOnRampProvider()` and by the client through `useOnRampProvider()` (`PP-CORE-HOK-034`):

| `fiatOnRamp` | `privyOnRamp` | Rail |
|---|---|---|
| off | any | `none`: no purchase is offered anywhere |
| on | off | `paybis` (dormant in this fork) |
| on | on | **`privy`** (this fork's default) |

Both hosts, `/deposit` and the provisioning gate, read that one answer, so a Dev-menu override moves
them together. Mock mode is checked first on both and keeps its fixture path: the Privy checkout is
never opened against fixtures.

## Sign in and the embedded wallet

- `SignInScreen` (`PP-AUTH-SCR-001`): Continue with Google or Connect a wallet. `loginMethods` is
  `["google", "wallet"]` in production and adds `email` elsewhere (`src/app/providers.tsx`).
- `embeddedWallets.ethereum.createOnLogin: "users-without-wallets"` mints the wallet on first login.
- `showWalletUIs: false` (POO-1763 [R6]): the embedded wallet signs and sends headlessly, so the
  product's own sheet, with its stepper and "What am I signing?" disclosure, is the only confirmation.
- The session is SIWE to `pool-party-api`, JWT in an httpOnly cookie; the wallet address a server
  action acts on always comes from that session, never from the request body.

## `/deposit`, the standalone add-funds surface (`PP-DEP-SCR-001`)

Steps on the Privy rail: `amount` -> `onramp` -> `onramp-settling` -> `success`, with
`onramp-error`, `onramp-uncovered`, `onramp-currency-unsupported` and `onramp-unverified` as the
other exits. There is no payment-method surface and no review step: the provider prices the charge
inside its own modal.

Work done BEFORE the click, because the click must reach the SDK synchronously or the browser
blocks the popup:

- **Baseline balance** (`readBalance`, one `balanceOf` on Base). The delta the watcher measures is
  against a pre-purchase figure. A failed read shuts the confirm; it is never a zero.
- **Coverage** (`useOnRampCoverage`, `PP-CORE-HOK-036`, over `coverageProbe.ts`, `PP-CORE-LIB-108`):
  asks Privy's quotes route whether anyone will sell to this buyer, in this currency, at this
  amount. `uncovered` blocks; `unknown` does not (we could not find out, which is not a refusal).
- **Currency** (`resolveOnRampCurrency.ts`, `PP-CORE-LIB-096`, server-only): the buyer's own currency
  from the edge country header, then the profile, then USD. It is never guessed from the browser
  locale, and a currency the rail cannot charge in refuses rather than defaulting to USD.

Then `DepositPrivyCheckout` (`PP-DEP-CMP-006`) calls `usePrivyOnRamp` (`PP-CORE-HOK-035`):

1. Mints an **intent record** first (`onRampIntent.ts`, `PP-CORE-LIB-107`, `localStorage`,
   synchronous), so a popup can never exist without a record.
2. Calls `useAddFunds` with `fiat` only (never `crypto`), `defaultAsset` always set, the destination
   as CAIP-2 `eip155:8453` plus the USDC address, and the vendor environment DERIVED
   (`stripe-sandbox` unless production and real mode).
3. Classifies the exit with one question, **could money have moved?**
   (`classifyAddFundsOutcome.ts`, `PP-CORE-LIB-109`): a hard `no` only for the SDK's pre-flight
   guards and a popup that never opened; `User exited flow` and anything unknown are `maybe`.
4. `confirmed` and `maybe` both open the **observation window** (`awaitOnRampSettlement.ts`,
   `PP-CORE-LIB-110`, bound by `useOnRampSettlement`): a bounded, backing-off poll of the destination
   balance. `settled` prints the receipt from the observed delta; the visible ceiling ends in
   `unverified`, with its own honest screen, and the word "cancelled" appears on no path where money
   could have moved.

## The provisioning gate, second host (`PP-CORE-CMP-046`)

Every operation modal (invest, withdraw, collect, compound, move range, close) mounts
`ProvisioningPanel`. In real mode it reads live per-chain balances (`gateContext.ts`) and asks the
planner (`planner.ts` -> `buildPlan.ts`) for a plan. With `fiatOnRamp` on, the planner may emit a
**`buy` leg** (`planActions.ts`, `buildPlan.onRampEnabled`), and `resolveFundingRoutes` offers the
buy route from the SAME flag, so the plan behind a route and the route offered can never disagree.

`provisioningView.ts` maps the plan to screens; on the `privy` rail the buy slot renders
`PrivyBuyStep` (`PP-STR-CMP-029`), which composes the same four modules as `/deposit` and owns no
policy of its own. It resolves on the observed delta, never on the provider's claim, and at the
visible ceiling hands over to the panel's `settling` screen rather than holding a promise nobody
will settle. The next legs (swap, bridge) size themselves from the balance the buy actually produced
(`sizeFromRealBalance`), then the operation runs on `useWalletSignFlow`.

## Analytics: five classes, one emitter

`fundingBuyFunnel.ts` (`PP-CORE-LIB-111`) is the single emitter for the purchase on both hosts:
`funding_buy_started` (the checkout was asked to open), `funding_buy_submitted` (the provider's
CLAIM), `funding_buy_failed` (a hard no) and `funding_buy_settled` (the observed delta, the only
honest money-in number). `tx_amount_blocked` carries the blocked intents (`onramp_uncovered`,
`onramp_unverified`, `onramp_currency_unsupported`, `onramp_disabled`). The deposit funnel keeps
`started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`.

## Security surface

- CSP `script-src` gains `crypto-js.stripe.com` and `js.stripe.com`, both PROVEN from the shipped
  SDK bundle rather than a vendor guide; `connect-src` gains `*.rpc.privy.systems`, the embedded
  wallet's own RPC (`src/lib/security/csp.ts`).
- `/api/webhooks/privy/funds-deposited` (`PP-CORE-SEC-005`) is a byte-faithful relay of Privy's
  `wallet.funds_deposited` event to `pool-party-api`, the independent settlement channel; the
  browser never verifies a webhook and the API holds the signing secret.
- The Privy app id and client id are the only Privy values in the client bundle. Every quote or
  currency call that needs a credential runs in a server action.
