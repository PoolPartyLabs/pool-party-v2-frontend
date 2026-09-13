# Cash+

The dedicated `/cash-plus` page contains the full investor journey: understand, invest, monitor and withdraw. The `cashPlus` feature flag gates the route and both navigation surfaces. Cash+ does not change the strategy catalog, Home aggregation, Portfolio models or platform API.

Namespace: `cashPlus`. Current delivery: an interactive, explicitly simulated investor demo. Start it with `pnpm cash-plus:ui`, then open `http://localhost:3049/en/cash-plus`. No wallet connection, RPC endpoint, contract deployment, API or database is required. The prior direct-chain controller and local-fork tools remain available separately; they are not used by this demo. See the [current UI delivery guide](../../../docs/features/cash-plus/cash-plus-ui-demo.md). No external issue number was created for this authorized implementation.

## Artifacts

| ID | Name | Type | Status / verification |
|---|---|---|---|
| PP-CP-SCR-001 | CashPlusScreen / CashPlusView | Screen | Responsive view; loading, safe error, stale read, pending receipt recovery and preview states |
| PP-CP-CMP-001 | CashPlusDashboard | Component group | Hero, personal position, observed normalized history, pool return sources and explanatory flow |
| PP-CP-CMP-002 | CashPlusInvestPanel | Form | Exact USDC input, locale normalization, real-balance Max and explicit withdrawal modes |
| PP-CP-MOD-001 | CashPlusTransactionSheet | Modal | Review, exact approval, signing, pending, decoded receipt and recoverable error presentation |
| PP-CP-CMP-003 | CashPlusSimulation | Calculator | Isolated annual assumptions, persistent illustrative label and no mutation of chain state |
| PP-CP-CMP-004 | CashPlusDetails | Component group | Bounded activity, receipt references, underlying composition, liquidity and fee disclosures |
| PP-CP-CMP-005 | CashPlusDemoControls | Component | Explicit one-day simulation, assumptions, reset and non-USDC wallet components |
| PP-CP-CMP-006 | CashPlusDemoWallet | Component | Clearly labeled simulated USDC wallet and balance sheet |
| PP-CP-HOOK-002 | useCashPlusDemo | Hook | Review, pending, success, session persistence and duplicate-confirm protection |
| PP-CP-MCK-002 | cashPlusDemo | Mock service | Exact integer accounting for deposits, withdrawals, proportional exits and explicit simulated returns |

`CashPlusScreen` obtains a `CashPlusController` through `useCashPlus`. Preview routes to `useCashPlusDemo`; real modes retain the direct-chain path. The pure `CashPlusView` accepts that controller explicitly for tests and Storybook. `CashPlusProvider` belongs to the direct-chain integration boundary; the route wraps the screen with it. No wallet operation is implemented inside a presentation component.

## Presentation rules

- Reuses existing Poppins, semantic color tokens, `Card`, `Button`, `Sheet`, `PerformanceChart`, token logos and the investor privacy preference (`pp.hideValues`).
- At mobile widths the action card precedes the chart. Desktop uses the shell's existing content padding, a 2:1 main/action layout and a sticky rail.
- Cash+ follows Strategies in the sidebar. Mobile retains five destinations by suppressing the mock-only Cards tab while Cash+ is enabled.
- A missing amount remains unavailable. Partial attribution is disclosed and never assigned to a fabricated zero or fee figure.
- The normalized chart shows the value of an initial 100 USDC. Fewer than two observations show an insufficient-history state. Timestamps carry explicit UTC and localized dates.
- Pool interest is accrued Aave interest valued at current token prices. It is not labeled as realized dollar profit.
- Investor dollar displays state the USDC equals $1 assumption. Exact transaction token amounts remain visible independently of rounded dollar displays.
- The comparison is collapsed by default, keeps an illustrative label when open and never changes observed balances, history or signing amounts.
- Preview fixtures remain visibly marked and cannot be treated as proof of a real transaction.
- Preview operations run review, pending and success locally. They produce no transaction hash or explorer link, and never request a wallet or create an RPC client.
- Demo state persists in session storage. Reset restores the initial balances. The one-day control is the only action that simulates new returns; page refresh does not accrue them.
- Local-fork hashes show local receipt details and never link to a public explorer.
- Pending operations can be dismissed and reopened without clearing the controller journal or sending again.

## Requirement coverage

Tests use CP identifiers from the delivery acceptance matrix. The amount form was written through a red/green cycle; the sheet's focus regression was reproduced before the focus callbacks were fixed.

| Requirement | Automated evidence |
|---|---|
| CP-UI01, CP-UI02, CP-UI05 | `AppShell.test.tsx`, feature registry/resolver tests and route guard test |
| CP-UI07, CP-UI09, CP-UI10, CP-UI12 | `CashPlusDashboard.test.tsx`, `CashPlusView.test.tsx` and sheet focus test |
| CP-UI11, CP-D10, CP-D11 | `CashPlusSimulation.test.tsx`; default $44,800 / 4.48% and 0/$10m/$20m volume cases |
| CP-UI13 | Form and calculator Portuguese decimal-comma tests; all 11 namespaces have key/ICU parity |
| CP-TX03, CP-TX04 | Amount validation rejects unavailable Max, exponent notation, negative/zero and excess precision |
| CP-TX08, CP-TX10 | Pending hash remains visible, duplicate confirmation absent, receipt amount replaces reviewed estimate |
| CP-TX12 | Proportional review names each component and explains receipt-token liquidity limits |
| CP-D05 | Partial history offers the controller's bounded load-earlier action |

Stories cover nine page states and seven transaction-sheet states. Storybook fixtures are explicitly synthetic and do not send transactions. Automated UI tests do not replace the separate real-fork rehearsal.

## Localization

English is canonical. Portuguese and Vietnamese copy were authored locally; the other eight translations received a machine-assisted first pass and glossary/brand corrections. All 11 namespaces contain nonempty values with matching ICU placeholders. English and Portuguese are the primary demo QA locales; broader native-language editorial review remains advisable before a production launch.

## Integration points

- `useCashPlus`: snapshot reads, bounded event history and current-wallet operation state.
- `controller.review`: refresh and simulate the canonical exact decimal amount or explicit all-shares exit.
- `controller.confirm`: execute the reviewed transaction using the current wallet and semantic checks.
- `controller.loadEarlierHistory`: one explicit bounded extension to the current event window.
- `CASH_PLUS_PREVIEW_SNAPSHOT`: explicitly illustrative fixtures under `src/mocks/data`, used by component stories and tests.

Canonical chain calculations belong to `src/lib/cash-plus`. The explicit demo ledger lives in `src/mocks/services/cashPlusDemo.ts`, uses exact integers and never enters fork/live mode. Presentation converts to numeric display only at the rendering boundary. The simulator uses the separate Decimal-based comparison module.

## Current UI demo

Run `pnpm cash-plus:ui`. Invest from the simulated 25,000 USDC wallet, inspect the updated position, select **Simulate 1 day**, then withdraw a partial amount or all shares. A proportional exit returns each simulated asset separately; receipt tokens are not credited as spendable USDC. **Reset demo** starts again. The application header's unrelated mock wallet is hidden on this page so only the Cash+ demo wallet is presented.

The daily assumptions are explicit: 95% of pool value in lending at 4% yearly, conversion turnover of 40 times pool value yearly and a 5 bps gross spread. The daily update excludes costs and losses. The annual business calculator remains separate, includes its own cost/fee assumptions and does not change demo balances. Neither view promises a return.

## Separate protocol rehearsal tools

This section describes the previously implemented optional fork workflow, not the default UI demonstration. Do not run it when preparing a UI-only presentation.

Start a fresh public-RPC fork immediately before a rehearsal with `pnpm cash-plus:demo --step start`. Then use the generated manifest and run the page with `NEXT_PUBLIC_MOCK_MODE=true NEXT_PUBLIC_FEATURE_CASH_PLUS=true NEXT_PUBLIC_CASH_PLUS_MODE=fork pnpm exec next dev --turbopack --port 3049`. This keeps the rest of the app in its established mock mode while Cash+ reads actual contracts and signs with an injected local-fork wallet. The existing app header remains the mock app session; the Cash+ investment form uses the injected signing account and its real fork USDC balance.

`pnpm exec playwright test --config playwright.cash-plus.config.ts` performs the real-fork wallet rehearsal and locale/read-error captures. Its explicitly local test wallet delegates to Anvil's unlocked test account. No private key is included in browser code. A presenter can instead use an EIP1193 browser wallet on the manifest's network.

The normalized chart begins at the first investor deposit, after disclosed sponsor seed/inventory funding. It never annualizes these short observations. Pool interest is reconstructed only when the queried history and both inventory reads are available and no unsolicited receipt-token transfers are detected. Earlier windows and excess rendered events are explicitly partial.

A public RPC may prune state needed by an old fork. The operator stops on that error; create a new run or use an archival provider. Existing receipts remain evidence of the run that produced them. Do not describe an expired/docked order as ready for a new fill.
