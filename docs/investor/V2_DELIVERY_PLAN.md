# Investor V2 delivery plan

Owner decision: Murilo, 2026-10-04. Coordination: [POO-2214](https://linear.app/yeildbay/issue/POO-2214), rules v2.
Baseline: public `PoolPartyLabs/pool-party-v2-frontend` main `d292d83f8b888cddcc1d578d0169bc25fff2d7de`.
Primary reference: `PoolPartyV2Design/docs/handoff-investor-v2-2026-10-04.md` v1.0, read in full (686 lines).

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
