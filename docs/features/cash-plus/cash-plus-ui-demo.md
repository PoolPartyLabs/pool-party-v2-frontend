# Cash+ UI demo delivery

13 September 2026. Current scope: a complete interactive UI demonstration inside the existing Pool Party frontend. Contract deployment is outside this delivery.

## Run

```bash
pnpm install --frozen-lockfile
pnpm cash-plus:ui
```

Open `http://localhost:3049/en/cash-plus` or `http://localhost:3049/pt-BR/cash-plus`. The command explicitly enables the Cash+ feature, keeps the application in mock mode and selects `NEXT_PUBLIC_CASH_PLUS_MODE=preview`. It does not start a fork, read an RPC, request a wallet or need an API key.

Cash+ has its own sidebar entry and page. It does not add a Portfolio position, strategy-catalog card, Home balance, API route or database table. The UI reuses the current shell, typography, gold accent, cards, buttons, charts, sheets and localization.

## Demonstrate

1. Show the product explanation, current position, composition and two return sources.
2. Invest 1,000 USDC from the simulated 25,000 USDC wallet. Review, confirm, observe the pending state and success. Wallet cash decreases by exactly 1,000; the same principal enters the pool and buys proportional shares. A deposit does not create a return.
3. Close the confirmation and select **Simulate 1 day**. The pool, account value, chart and activity update together. The assumptions can be expanded beside the controls.
4. Withdraw a partial amount or choose the full withdrawal. Full withdrawal burns every simulated user share and credits the exact USDC receipt amount to the demo wallet.
5. Optionally choose a proportional exit. Its review and receipt list each asset. Aave receipt tokens and the secondary stablecoin appear separately under the demo controls; they are not counted as wallet USDC.
6. Select **Reset demo** to restore the starting scenario. Refresh preserves completed actions within the current browser session.

The initial pool value is 1,000,123.40 USDC equivalent; the investor owns 100,012.34 after contributing 100,000.00. Initial pool return attribution is 73.40 of illustrative interest plus 50.00 of illustrative conversion spread. These are explicitly labeled fixtures, not historical protocol results.

## Assumptions and boundaries

The day control models 95% of current pool value earning 4% yearly lending interest, conversion volume of 40 times current pool value yearly and a 0.05% gross conversion spread, divided by 365. This totals a 5.8% simple yearly gross scenario before costs and losses. It is not a quoted APY, guaranteed return or measured onchain performance. Only the explicit day control advances this scenario. Refresh does not accrue rewards.

The expandable annual calculator is separate: its default business scenario includes conversion execution costs, fixed costs and an illustrative performance fee, yielding 4.48%. Changing those assumptions does not alter the demo ledger, orders or transaction amounts. The two views have different stated cost assumptions.

Simulated receipts have `simulated: true` and no transaction hash. The UI displays no network confirmations or explorer link for them. The current preview creates no RPC client and calls no wallet provider. A missing or failed live configuration never falls back to this demo ledger.

Session storage uses `pool-party:cash-plus:preview-demo:v1` and an explicit BigInt encoding. Invalid saved state is ignored. Private-browser storage restrictions leave the demo functional in memory. Reset invalidates delayed actions so an earlier pending animation cannot overwrite the reset state.

## Implementation and verification

The controller selects `useCashPlusDemo` only for preview. `cashPlusDemo.ts` owns exact share, cashflow and composition accounting; the existing direct-chain modules remain isolated for separately configured modes. One raw USDC unit of rounding dust may remain after ceil-rounded partial exits, following proportional share arithmetic.

Relevant checks:

```bash
pnpm typecheck
pnpm lint
pnpm i18n:check
pnpm exec vitest run src/features/cash-plus src/lib/cash-plus src/mocks/services/cashPlusDemo.test.ts tests/cash-plus src/components/layout/AppShell.test.tsx src/lib/features tests/hackathonDocs.test.ts
```

Tests cover exact deposits and cashflows, partial/full/proportional exits, explicit day arithmetic, review invalidation, double confirmation, session restoration, reset during a delayed action and zero wallet/RPC calls in preview. Existing tests cover the separate chain intent, receipt and pending-recovery paths. All eleven locales include the demo copy. English and Portuguese are the primary presentation QA languages.

The retained `playwright.cash-plus.config.ts` and `e2e/cash-plus/` scripts exercise the earlier local-fork workflow. They require an intentionally prepared fork and are not a prerequisite for this UI demo. Earlier fork receipts and performance observations must not be presented as transactions produced by the mock UI. Build and full-suite results should be reported for the actual revision tested, rather than inferred from the visual demonstration.
