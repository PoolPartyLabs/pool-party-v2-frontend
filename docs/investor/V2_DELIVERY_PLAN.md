# Investor V2 delivery plan

Owner decision: Murilo, 2026-10-04. Coordination: [POO-2214](https://linear.app/yeildbay/issue/POO-2214), rules v2.
Baseline: public `PoolPartyLabs/pool-party-v2-frontend` main `d292d83f8b888cddcc1d578d0169bc25fff2d7de`.
Primary reference: `PoolPartyV2Design/docs/handoff-investor-v2-2026-10-04.md` v1.0, read in full (686 lines).

## Current status, 2026-10-06

POO-2248 supersedes the original S3 unavailable execution boundary for **deposit only**. The current API provides the complete post-allowance deposit preview. Shared provisioning now continues into typed V2 review/signing with exact reviewed-share protection and transaction recovery. The dated Oct 4 rows and validation records below describe the historical presentation delivery. Payout, income, persistent social API and unsupported metrics remain separate capabilities.

## Precedence and scope

1. Murilo's decisions, including the explicit `Not available` fallback on 2026-10-04.
2. Current frontend layouts, interactions, transaction and provisioning hosts.
3. Real V2 schemas, units and execution behavior.
4. Retained Figma Details [before investment](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8275-2576) and [owned](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8252-2502).
5. Historical drafts only when compatible.

Strategies and Portfolio keep their current grids, table columns, mobile cards and navigation. Their only added decoration is an item-derived V2 tag. V1 financial schemas stay intact. Invest/Details changes apply to V2 only. The existing InvestModal, CollectModal, WithdrawModal and ProvisioningPanel remain the only transaction hosts. The 39 exploratory Figma modals are excluded.

Missing data or unsupported execution displays `Not available`, translated in the existing 11 public-main locales. This is an explicit delivery state, not a synthetic zero, estimated income, fabricated risk score or successful transaction. The public repository has 11 locales; adding a twelfth is outside this handoff.

## Phases, files, dependencies and tests

| Phase | Files / ownership | Dependencies and delivery rule | Focused validation |
|---|---|---|---|
| S0 Baseline/intake | `docs/DESIGN_INTAKE.md`, this plan, Linear POO-2214 | Done: public main/instructions and complete handoff audited; pending intake empty; new owner handoff triaged | Source/issue references and rule version |
| S1 Existing lists, [POO-2215](https://linear.app/yeildbay/issue/POO-2215) | `StrategiesExploreScreen`, `StrategyCard`, `PortfolioView`, `PositionCard`, `PositionLink`, `FundFamilySwitch`; separate investor list projection/loader/action | Typed V1/V2 presentation models; bounded metadata/holder enrichment; manager FundExplorer retained. Unknown financial metrics unavailable. Discovery coverage is incomplete by contract, so no claim of whole-wallet totals | V1 regression, V2 tag/routes, closed desktop return, mobile no new withdraw, null metrics, filter/page reset, wallet/family races and partial reads |
| S2 Details, [POO-2216](https://linear.app/yeildbay/issue/POO-2216) | `FundDetail`, preserved manager technical detail, `StrategyDetailScreen`, shared layout frame, typed projection/partial read action | Reuse layout slots; public success survives holder failure. Current position value is not cost or PnL. Partial composition stays partial; missing allowances do not mean wildcard permission | Before/owned/pending/closed, missing holder, stale core/wallet, partial composition and unavailable metrics; V1 layout behavior |
| S3 Existing Invest host, [POO-2217](https://linear.app/yeildbay/issue/POO-2217) | `InvestModal`, `StrategyMiniHeader`, `AmountField` | Discriminated V2 identity, hub USDC/Arbitrum, first-deposit mandate minimum, no V1 Permit2 or mock settlement. Signing remains unavailable until the investor guard/complete review contract is established in POO-2219 | Amount/resume, V1 minimum unchanged, no build/sign/provision on unavailable V2 capability, no invented balance/yield |
| S4 Funding return, POO-2217 | `deposit/lib/investContext`, `DepositScreen`, deposit route | Family/core/account/origin/from preserved; next-intl preserves locale. Wrong account or malformed context cannot resume. Return fills amount only; no automatic signing | Parser/return unit cases and existing DepositScreen resume regressions |
| S5 Withdraw capability | Existing WithdrawModal boundary and Details CTA | POO-2219: exact payout review, sale max-loss and settlement semantics. Open request blocks another; timer is not claimable; request receipt is not money received. Until enabled: Not available | No unsafe CTA, no V1 builder for V2; later request/claim/partial/closed receipt tests |
| S6 Income capability | Existing CollectModal boundary and Details CTA | POO-2219: tuple, net/gross, pending income and deferred/no-transaction semantics. Income owed is not PnL or guaranteed liquidity. Until enabled: Not available | No wallet prompt or claimed persisted request for a deferred/missing transaction |
| S7 Persistent Follow | Existing manager identity region | POO-2219: no real relationship service found. Demo local follow stays confined to its existing manager-profile scope; investor persistent action unavailable | No fake persistence or unsupported route |
| S8 Integration/docs | Registry, integration map, analytics, compliance, feature README and all touched locale namespaces | Small reviewed PRs to public repo; preserve feature gate/family preference and manager technical operations | Focused one-worker Vitest, touched-file lint, locale parity and CI static checks; user owns full browser acceptance |

## API contract and exact meanings

Read sources: `src/lib/api/v2/{schemas,fundSchemas,funds}.ts`, `src/features/funds/{fundActions,fundModel,fundFlow,fundTransactions}.ts`, and [current API flow specification](https://github.com/0xmvercosa/PoolParty_SCs_v2/blob/main/docs/engenharia/2026-10-03-api-v2-alpha-spec/flows.md).

- `GET /funds` advances a bounded discovery batch. `nextBlock` is an output cursor, explicitly not an input query parameter. No completion boolean/head is exposed. Display discovered scope and offer refresh; do not invent a paging endpoint or complete aggregate.
- `shareAssets`, holder `value`, `incomeOwed`, minimum: USDC raw6. Shares: raw18. Share price: raw24. Holder value is current principal, not invested cost; income owed is a separate entitlement.
- Risk/APR/investor count/cost/yield/history are absent from the typed fund contract. Unsupported sort/filter capabilities must be visibly unavailable.
- Public read and holder read are independent outcomes. Holder error does not mean no position; partial holdings never produce a complete wallet total.
- Deposit runs on Arbitrum hub (42161) in USDC, including funds with Robinhood/USDG spokes. Approval-only response must settle and rebuild. A changed preview requires renewed review. Do not import V1 permit or fee assumptions.
- The existing technical V2 runner already performs chain/account checks, receipt waiting and unknown-hash protection. It is preserved, not presented as a finished investor modal adapter.
- `claimable` is an API simulation, which may publish an order without paying immediately. Standard term expiry alone does not authorize payment. Deferred income must not open a wallet for a missing transaction.
- Persistent Follow, all-holder discovery and complete execution preview/receipt semantics are tracked in [POO-2219](https://linear.app/yeildbay/issue/POO-2219), assigned to Rafael. They do not block the approved unavailable presentation.

## Delivery controls

Maximum two workers plus coordinator, model gpt-6.1-sol for workers. Separate worktrees and file ownership. Coordinator reviews every change, handles Slack/Linear and merges small PRs. No full local test suite or heavy local build per Murilo. No wallet signing/broadcast/deploy or complete browser journey by Codex.

Read-only screens reuse existing view/navigation emitters. V2 Invest uses existing `strategy_invest_started`, `tx_amount_blocked` with `v2_execution_unavailable`, and `tx_flow_abandoned`; there is no submitted/completed financial event when execution is unavailable. Actual future completion must remain receipt/settlement-driven.

## Delivery evidence

Implementation PRs, exact focused test counts and remaining capability state are appended here as each slice is reviewed. POO-2214 must not imply all external API capabilities are enabled merely because the frontend presentation is complete.

### Implementation review, 2026-10-04

- [PR #90](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/90): merged at `852b6375`. Existing Invest V2 amount host and account-bound return; 78 focused tests, Biome/i18n and CI static checks passed.
- [PR #91](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/91): merged at `8bb15c11`. Existing list presenters, discriminated data/links and bounded loader. Initial 75 focused tests; review fixes covered wallet mismatch, closed pending duplication and unknown lifecycle (12 targeted tests). A further 47 tests cover preservation of the V1 public types. Final build review restored client directives in three existing presenters; 42 focused component tests and isolated Next server-component compilation passed. CI typecheck, lint, locale and configuration checks passed.
- [PR #92](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/92), POO-2216: shared Details frame, separate manager technical route, public/personal partial reads, real hub USDC balance read, mandate fields, identity-bound funding return and explicit unavailable actions. Initial 79 focused tests across Details/legacy Details/manager list/model, then 3 server trust-boundary tests and 8 investor Details cases. Another 24 focused tests cover model/action types and explicit manager launch links. All nine changed production TSX modules pass isolated Next server-component compilation. After rebasing on PR #91, 64 focused tests across investor Details, the list loader and V1 Details passed; all 11 locale namespaces passed parity and Biome. Counts describe overlapping validation runs, not unique tests.
- Static dependency audit remains the pre-existing POO-249 issue; these changes add no dependencies. No full local suite/build or complete browser journey was run.

Remaining enablement: investor V2 transaction review/signing, payout/collection semantics, persistent Follow, unavailable metrics/history and discovery completeness remain POO-2219. The frontend delivery intentionally exposes Not available until these are reliable. The existing manager technical operations remain available through manager navigation.

### Owner-approved delivery boundary

S0-S4 and S8 are covered by PRs #90, #91 and #92. S5-S7 ship their explicit unavailable capability state under rules v2; enabling investor signing, withdrawals, income collection and persistent Follow remains POO-2219. This completes the approved frontend presentation scope after the three PRs merge, without declaring external execution contracts complete. Existing manager operations are accessible through the explicit `?view=manager` route after manager identity validation. Deployment is handed to Rafael and complete browser acceptance to Murilo.

## Mobile follow-up, 2026-10-04

[POO-2220](https://linear.app/yeildbay/issue/POO-2220), rules v1, adds the existing family selector below the mobile header on investor list/fund routes, makes the V2 Details identity/price/metrics wrap, and preserves closed-only Portfolio history. The loader distinguishes known-empty history from a lazy history. Reuses existing IDs, strings, guards and analytics. A narrow Storybook fixture covers long identity and exact monetary display. Behavioral validation: 58 focused layout/toggle/paged-history tests, 21 loader/history tests after review, and 8 investor Details tests; runs overlap.

[POO-2221](https://linear.app/yeildbay/issue/POO-2221), rules v1, covers the shared amount input, mobile Deposit amount and provisioning skeleton widths in a separate PR. Amount fitting changes presentation only and preserves six-decimal Max values. Existing behavior passed 53 focused tests. Both slices use source review and targeted checks; browser acceptance remains with Murilo. No investor execution capability or API contract changes; POO-2219 remains the enablement dependency.

## Details presentation correction, 2026-10-04

[POO-2223](https://linear.app/yeildbay/issue/POO-2223) implements the missing Figma composition donut/legend with real position weights and reusable token, protocol and chain logos. Coverage stays partial, and the history slot shows the approved No history yet state because a price time series is still absent. Murilo explicitly superseded the unavailable Follow presentation: Details now supports a reversible local Follow/Following toggle without a mock label, synchronized across responsive mounts and scoped to the viewed manager. Persistent social API remains POO-2219. This owner update changes the S7 presentation boundary above; it does not enable persistence or V2 financial execution.

[POO-2224](https://linear.app/yeildbay/issue/POO-2224) separates public hub USDC wallet reads from SIWE/holder success when opening V2 Invest. No-session holdings returns unavailable so the public fallback can run; session/account mismatches cannot supply another wallet’s data. ETH and WETH remain distinct API assets, not spendable USDC. No independent ETH USD price exists in the stable-only public fallback, so it is not fabricated. V2 financial execution restrictions remain unchanged.

Verification: POO-2223 passed 29 focused presentation/model/profile tests after seven regression failures demonstrated the missing behavior. POO-2224 passed 62 focused Details/balance/onramp tests, including the stale refresh latch regression. A local typecheck exceeded the Node heap limit, so typing validation runs in GitHub CI. No full local suite, production build or browser acceptance was run.

## Deposit/provisioning enablement, 2026-10-06 (POO-2248 v1)

Evidence: API main `a8299b147eef1ab9b6ae9bc8c5498168006149e7`, deposit builder in `src/v2-alpha/v2-alpha.builders.ts`. Insufficient allowance returns exact-budget approval with `nextAction` and no preview. After allowance, a pinned-block simulation supplies `sharesMinted`, `usdcCharged`, `flowFee`, `refundToCaller`, and `sharePrice`. This replaces the earlier deposit-preview blocker without asserting support for unrelated operations.

1. **Amount/funding:** shared InvestModal dispatches to its typed FundInvestModal branch. A 15 USDC request with 2.01632 USDC available opens the existing ProvisioningPanel. Max remains below the 10 USDC first-deposit minimum. Holder status and balance ownership are independently verified; a failed Details holder read does not hide a known wallet address from the controller's fresh session read.
2. **Prepare/review:** funding completion retains the original raw6 budget and only prepares. Approval is exact-budget and has its own confirmation; confirmed approval rebuilds the deposit and pauses for review. All five preview fields are shown with their exact raw units. Gas is separately paid in ETH, quoted by the existing funding/wallet flows.
3. **Confirm:** the server builds again with `minShares` equal to the reviewed raw18 whole-share quantity. A changed preview or operation kind returns to review. The unprotected discovery simulation is never broadcast. A protected build failure needs a fresh review; no silent tolerance or V1 swap slippage is applied to shares.
4. **Recovery:** local wallet/core journal reserves before send and retains pending/unknown hashes. Duplicate confirms and remount resubmits are blocked. Explicit rejected signatures can be retried; uncertain sends require receipt reconciliation. Without a hash the UI directs the user to wallet activity and keeps the lock. No atomic cross-tab locking is claimed.
5. **Settlement:** confirmed approval/funding is not investment success. A confirmed deposit receipt shows confirmation and explorer evidence; the preview is never presented as an executed monetary receipt. Existing Details refreshes after settlement.
6. **Identity/errors:** account/core/session changes and unmount invalidate funding callbacks immediately. Late reads/builds cannot overwrite another session. Bounded reads/builds and actionable retry prevent indefinite loading. V1 remains behind its unchanged runner.

Validation is focused and serial, max one Vitest worker. No complete suite, coverage, build, browser journey or live wallet transaction was run for this fix. Browser acceptance remains with Murilo; deployment remains with Rafael.

POO-2248 local validation: 15 controller/model tests and 86 shared Invest/provisioning/Details regressions passed (101 tests across eight files). Scoped Biome, locale parity/ICU/usage and config checks passed. Independent GPT-6.1-sol review verified controller and funding-identity boundaries; coordinator added the unmount-callback regression.
