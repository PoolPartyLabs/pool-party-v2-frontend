# Demo runbook: dev API + Privy dev app

> Recorded 2026-09-13 against the ported tree. Steps 1 to 3 are configuration; steps 4 to 8 are the
> demo itself. Refine the timings and screenshots before the talk.

## 1. Privy dashboard (one time)

- Create (or reuse) a **development** app. Copy its App ID and Client ID.
- **Login methods:** enable Google (and Email for non-production convenience).
- **Embedded wallets:** create on login for users without wallets; leave confirmation modals
  off (the app also sets `showWalletUIs: false`).
- **Funding:** enable fiat on-ramp. The checkout in a development build runs against the
  `stripe-sandbox` environment, derived by `resolveOnRampEnvironment()`; no real card is charged.
- **Allowed origins:** add `http://localhost:3000` and the deployed dev host.
- Optional, for the independent settlement channel: a webhook for `wallet.funds_deposited` pointing
  at `pool-party-api` (`POST /api/v1/webhooks/privy/funds-deposited`), or at this app's relay
  `/api/webhooks/privy/funds-deposited` when the API is not directly reachable.

## 2. Environment

`.env.local` (never committed):

```bash
NEXT_PUBLIC_MOCK_MODE=false            # the Privy checkout never opens against fixtures
NEXT_PUBLIC_APP_ENV=development        # => stripe-sandbox, and the non-prod login methods
NEXT_PUBLIC_PRIVY_APP_ID=<dev-privy-app-id>
NEXT_PUBLIC_PRIVY_CLIENT_ID=<dev-privy-client-id>
PP_API_URL=<dev pool-party-api base url>
PP_API_KEY=<dev api key>
ANALYTICS_API_URL=<dev analytics indexer base url>
# The two rail flags DEFAULT ON in this fork; set them only to turn the rail off:
# NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP=off
# NEXT_PUBLIC_FEATURE_PRIVY_ON_RAMP=off
# NEXT_PUBLIC_FEATURE_PROVISIONING=on   # the pre-flight gate inside the operation modals
```

`NEXT_PUBLIC_FEATURE_PROVISIONING` still ships off in the registry (it is the whole gate, not this
track's flag). Set it `on` for step 7; without it the invest modal has no buy leg to show.

## 3. Run

```bash
pnpm install
pnpm dev             # http://localhost:3000
```

Sanity before going on stage: `pnpm typecheck && pnpm lint && pnpm test && pnpm i18n:check`.

## 4. Sign in with Google

Open the app, Continue with Google. A first-time user lands on Wallet ready
(`PP-AUTH-SCR-003`): the embedded wallet exists, no seed phrase was shown.

## 5. Add funds

Deposit -> type an amount (say 50) -> Continue. Watch for two things on the amount step: the
confirm stays disabled until the baseline balance is read, and the coverage answer arrives
debounced (~750 ms) as you type. Then the secure checkout opens inside the product, priced in the
buyer's currency. Use a Stripe sandbox test card.

## 6. Settlement

Close the checkout. The screen enters **settling** whether the provider said `confirmed` or the
exit was ambiguous: the observation window polls the Base balance and prints the receipt from the
OBSERVED delta. Point out that the receipt amount is what arrived, not what was typed, and that
`funding_buy_settled` is the only "money in" analytics row.

## 7. Invest, with the buy leg

Strategies -> pick a strategy on a chain other than Base -> Invest -> an amount above the wallet's
spendable balance on that chain. The provisioning gate opens with a plan: `buy` (Privy), then swap
or bridge, then the operation. `PrivyBuyStep` opens the same checkout; on settlement the next legs
size themselves from the real balance and the embedded wallet signs each step headlessly.

## 8. What to say about honesty

Nothing in the flow fabricates a success: no timer-based receipts, no provider claim treated as
money, no dimension scored without a read. The same posture runs through `hookrisk/`, which is why
the two are presented together.

## Known limits on stage

- The settlement window does not survive a page reload yet (cross-session resume is tracked
  separately); do not refresh during step 6.
- `ETH-BASE` (native gas) is not for sale on the Privy rail; the step refuses before opening rather
  than opening a checkout that cannot fill the order.
- Coverage depends on the buyer's country and currency; rehearse from the network you will present on.
