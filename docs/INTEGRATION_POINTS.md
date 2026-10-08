# Integration Points

## Local Solana visual editor (POO-2281, rules v2)

The route-scoped store in `src/lib/experiments/solanaPreviewStore.ts` (PP-CORE-LIB-125) shares only
visual mode. The editor in `src/features/manager/fund/solana-preview/` has no API/RPC/wallet/launch
imports. No new entitlement endpoint is required. POO-2282 and the earlier unmounted grant modules
were canceled/removed before release when Murilo simplified the scope.

Future real wiring remains POO-2239/2240 (tokens/markets), POO-2262 (binding/quotes/launch) and POO-2261
(relays/reports). Local token/pair/percentage choices are not financial or transaction inputs. Missing
prices, amounts, reserve data, quotes and execution stay Not available. `solanaSpoke` remains off.
See the [current delivery plan](solana-preview-preparation-plan-2026-10-07.md) and
[ADR 0009](adr/0009-local-solana-visual-preview.md).

## Solana protocol range context (POO-2291 S3/S4)

`solanaRangeModel.ts` and `SolanaRangePresenter.tsx` validate and display an injected same-snapshot Orca/Raydium context. `SolanaPreviewBlockPanel.tsx` passes no live context by default, mounts the section only for positive LP allocation and keeps a context without a draft handler read-only. POO-2240/2261 must provide verified cluster, program, pool, ordered mint bytes, token programs/extensions, decimals, protocol fee/grid configuration, current Q64/tick, position identity/liquidity and source metadata. A separate liquidity quote owns composition/amounts. Missing data never receives a default price, range, token split or execution capability.

## Solana custody and Jupiter inspection (POO-2291 S5)

`solanaHoldingModel.ts` and `SolanaHoldingPresenter.tsx` accept injected custody identities, exact quantities, Buy/Sell intentions, quotes and independent timestamp/block-height evidence. POO-2239/2240 supply verified tokens and custody reads; POO-2261/2262 supply origin/revision-bound quotes, costs, authority and transaction details. No API, RPC or wallet client is imported. Included-input costs cannot exceed total input, and unknown clocks cannot establish quote/blockhash validity.

The live Configure host supplies null origins, reads, intentions, quotes and clock. Holding is a separate local custody drawing control, not a new protocol or LP. Same-token USDC bypasses conversion; the WSOL drawing shows gray principal conversions only. Drawing labels never manufacture mint, account, price or signing authority. Buy/Sell remains unavailable without custody identity, and Confirm stays disabled even with harness-injected data. Standalone review is inline; this bounded slice does not implement editable transaction amounts or live execution.

## Solana local Manage foundation (POO-2291 S6)

| Artifact / seam | Foundation contract | Remaining integration |
| --- | --- | --- |
| PP-MGR-LIB-071, `solanaManageModel.ts` | Case-sensitive canonical identity and local instance identity are separate. Local configuration, draft/revision/mode, Current, After, selection and journal have independent ownership. Current/After physical token quantities fit u64; absent observations remain absent. After binds to identity, base snapshot, revision, mode and host clock. | Authorized canonical reads, source/freshness evidence, separate simulation and journal reconciliation under POO-2239/2240/2261/2262. The model cannot attest external ownership or submit transactions. |
| PP-MGR-CMP-097, `SolanaManagePresenter.tsx` | Injected Current, complete source/slot/commitment metadata and independently valid After. Inline exclusive modes and Review expose local intentions. Current range context must match the canonical Current ticks and identity. Confirm is disabled. | Supply verified canonical reads/context, preview and operation journal. No financial value or execution capability is inferred from a drawing or fixture. |
| PP-MGR-CMP-098, `SolanaLocalManageHost.tsx`, host read/context seam | The standalone host keeps each presenter mounted through selection/hiding and synchronizes drawing baselines without resetting another draft. It supplies unavailable Current/After and null context/clock. | Subsequent Screen/Canvas selector and analytics integration; then separately verified canonical reads/context/clock. The foundation does not mount this host in the screen. |
| PP-MGR-CMP-098, local range/apply seam | Non-null ranges fail closed without verified protocol context. Whole-percent drafts must stay within 100%. Applying one block checks other blocks' applied baselines, not unapplied reductions, and requires `onApplyDrawing(localId, config) === true` before local state/success changes. | Parent drawing owner acknowledges accepted writes. Verified protocol domain/grid context is required before ranges can be applied. This callback confers no signing capability. |

Drawing Apply never writes canonical Current or the operation journal. Rejected acknowledgement retains draft and Review; a synchronized baseline that reaches the draft ends its obsolete mode/review binding and invalidates After without altering Current/journal. Bounded callbacks contain protocol/action only; the config callback is application data, not analytics. The foundation declares analytics `none` with host ownership reasons; screen emitters remain in the subsequent integration PR. Real discovery, custody, quotation, authority, transaction details, signing and settlement remain unavailable under POO-2239/2240/2261/2262.

## Launch report countdown (POO-2233, rules v1)

`launch/useLaunchReportWait.ts` records first report building/waiting observation in browser-local metadata keyed by normalized manager, draft and report step, separate from the execution journal. `useV2Launch.ts` projects this optional timestamp to `FundLaunchJourney`; an isolated display clock derives a 19-minute estimate. Polling, retry and reopening preserve the timestamp. Storage failure uses an in-memory fallback.

Readiness remains `readLaunchFundAction(core).lastReport` in `driver.ts`, polled by the existing binding every 10 seconds. A received report advances the active serial run immediately; zero on the display clock only shows the delayed message. No new endpoint, admin trigger, wallet operation or analytics event. Closing pauses continuation; reopening requires explicit Resume.

## Conditional fallback Review (POO-2183, rules v1)

`fallback/allocation.ts` resolves today's zero-share canvas into launch-only `chain.sharePct` (whole-fund percentages) and `launchExecution[blockId].leafSharePct` (percentage of its chain). Missing position shares split remaining 100% equally, integer remainder to the first; flow blocks have no shares. Root defaults split remaining hub/spoke budgets, preserving positive written root/leaf shares read-only. A missing spoke root uses only the explicit Mandate `spokeCapPercent` / selected network percentage, never an invented network split. Final root budgets and leaf sums are validated; fractional whole-fund leaf budgets remain blockers. `applyFallbackExecutionAtLaunch` applies config and allocation together without writing canvas or storage. The fund #2 zero-share/empty-config test produces the exact 11-signature hub/Aave/spoke journey without signing.

The same-gated index `/manager/fund-launch/review` reads `listDrafts` / `subscribe` without writing the browser-local Mandate store. `FallbackReviewIndex.tsx` combines wallet-local persisted journeys, `useV2LaunchStatus` Resume links and pure `draftReadiness.ts` live-catalog/balance previews. The Mandate store has no wallet ownership metadata; this limitation is visible. Our `FundExplorer` manager V2 section links to the index; Murilo's draft list/page files remain unchanged. Demo date: October 4, 2026, cutoff 09:00 BST, demo 16:00 BST. Exact confirmed pool/reserve IDs and clicks are in the fallback README.

`src/features/manager/fund/launch/fallback/FallbackReview.tsx` binds only POO-2177's `useV2ReviewDraft` and `startFundLaunch`. The separate route `/manager/fund-launch/review/[draftId]` requires `fundContracts` and real V2; no signatures on mount. Review persistence and staged logo upload stay in the existing hook.

`fallback/execution.ts` is an immutable launch-time snapshot adapter. Empty Pool config receives manager-visible catalog-aligned finite full range and slippage 1%; empty Aave Supply receives an explicitly selected Mandate reserve assetKey. Zero/absent roots fill the remaining known Mandate budget, and zero/absent position leaves split the remaining chain budget. Positive panel-written roots/leaves and nonempty config win read-only. Unsupported Aave swaps, unknown network splits and invalid allocations remain blocked. No canvas/store schema changes. See `src/features/manager/fund/launch/fallback/README.md` for direct-URL demo clicks.

**Temporary fallback for the October 4, 2026 demo; Murilo's POO-2172 Review replaces it**. Murilo confirmed the 09:00 BST cutoff would be missed, and Rafael authorized landing this separate route. Panel-written configuration and shares remain authoritative and read-only; the launch adapter only fills gaps.

## Created v2 funds and launch status (POO-2181, rules v2)

| Boundary | Owned files | Contract |
|---|---|---|
| List enrichment | `src/features/funds/fundActions.ts`, `fundListModel.ts`, `FundListCard.tsx`, `FundExplorer.tsx` | Existing server-only `readFunds` and `readFund`; v2-only cards, authoritative manager filter, missing metrics preserved. |
| Local launch status | `src/features/manager/fund/launch/journey.ts`, `journal.ts`, `useV2LaunchStatus.ts`, `FundLaunchJourneysList.tsx` | Existing browser persistence, wallet isolation, completion/focus/storage revalidation. No new discover write. |
| Review exports and launch checks | `launch/index.ts`, `plan.ts`, `driver.ts`, `startFundLaunch.ts`, `useV2LaunchBinding.ts` | Public helpers unchanged; catalog tick alignment fails closed, privacy-safe existing analytics entry point. Murilo's Review/canvas files untouched. |

## V2 fund explorer records (POO-2179, rules v1)

| Boundary | Files | Real / mock behavior |
|---|---|---|
| Wallet broadcast and receipt | `src/features/funds/fundTransactions.ts`, `FundActionsPanel.tsx` | Existing account/chain-checked `sendBuiltTransaction`, followed by `waitForReceipt`. A full hash is displayed before polling; confirmed blocks, mined reverts and uncertain receipts retain the record. Mock actions never fabricate a hash. |
| Revert diagnostics | `fundTransactions.ts` | Error-only signatures from the API's CoreVault/SpokeVault/ShareToken ABI, 168 unique signatures. Replay is read-only `eth_call` at the receipt block, bounded to five seconds. Only decoded error names and translated categories reach the UI; raw RPC messages never do. |
| Explorer context | `ExplorerFields.tsx`, `src/lib/chain/explorer.ts` | Position/deployment chain IDs, transit source/destination and fund hub context. Unknown chains remain text. Report publication uses the sole configured spoke; delivery and protocol acknowledgement events use the hub. Existing launch exports remain stable. |

Report-job views whitelist identifiers/status/publication/delivery hashes from server responses; admin payloads are never rendered. Receipt records survive the authoritative refresh and input edits, but reset on fund/wallet change. No manager write capability is introduced.

## V2 fund investor and manager pages (POO-2175, rules v2)

| Boundary | Files | Real / mock behavior |
|---|---|---|
| Fund reads | `src/lib/api/v2/funds.ts`, `fundSchemas.ts` | Existing server-only v2 client; no V1 joins. Isolated `v2Funds` fixtures in mock mode. |
| Investor builders | `src/features/funds/fundActions.ts`, `FundActionsPanel.tsx` | SIWE-derived wallet, simulated API transactions, explicit wallet confirmation, approval receipt then rebuild; optional authoritative preview / fees rollout. |
| Fresh reports | `fundTransport.ts`, `fundFlow.ts` | Server-only admin key, verified bearer, rate-limited start, 15-second polling, reread acceptance/freshness before rebuild. |
| Manager reads | `FundDetail.tsx`, `fundActions.ts` | Transits and spoke balances from API PR #180; no new manager writes. |

See `src/features/funds/README.md`. `PP_API_ADMIN_KEY` remains server-only; never put it in a public variable or browser request.

## Launch submission recovery (POO-2222, rules v1)

`launchReconciliationActions.ts` verifies SIWE session ownership before reading API transit history or bounded chain logs. `launch/driver.ts` validates successful receipt emitters, planned identities and saved calldata before recovering hashes and bridge transit IDs. Wallet callbacks persist submission hashes before analytics; automatic reconciliation is read-only and cannot send replacement transactions. Missing evidence stays fail-closed.

Inventory of the front-end seams that run mocked or placeholder logic today and are replaced by a real
integration later. Each `// PP-INTEGRATION-POINT: <description>` comment in the code maps to this document.

To list them all:

```bash
git grep -n 'PP-INTEGRATION-POINT' -- src   # 527 markers across 303 files (2026-10-08 foundation tree)
```

This foundation tree contains the model merged in PR #140 plus CMP097/CMP098 and 11 locale additions. The model retains the base 524 markers in 301 files; CMP097 adds one marker and CMP098 adds two. Screen/Canvas/previewModel/analytics integration follows in a separate PR.

> Most data-layer points funnel through the single service factory `src/lib/services/index.ts`: swap
> `isMockMode` or each service implementation there and callers stay untouched.

> **The Universal Funding rail is the exception** (epic POO-1022, 2026-07-24/25). It does not funnel
> through the service factory and has no mock branch of its own in real mode: it calls the Uniswap
> Trading API directly from the Next server layer, through a server-only credential (`UNISWAP_API_KEY`).
> Its seams have their own section below.

> **Scope note for this public repository.** This document covers the **front-end** seams only, which is
> what the code in this repository owns. The request/response contracts of the Pool Party backend
> services live with those services in their own repositories and are intentionally not reproduced here.

## Build configuration panel data (POO-2185, rules v1; panels POO-2171)

| Seam | Owned files | Contract and remaining integration |
|------|-------------|------------------------------------|
| Panel live pool read | `src/features/manager/fund/build/panel/usePanelPool.ts`, `panelCatalogView.ts`; mock `src/mocks/data/buildPanelFixtures.ts` | Existing server action `getCatalogPoolAction(chainId, poolId)` (`GET /api/v2/catalog/uniswap-v4/pools/{poolId}?chainId=`), on mount and 15 s (`LIVE_POOL_PRICE_REFRESH_MS`) after each read settles while a panel is open; reads never overlap and one that never settles ends as a timeout after 30 s. Only the bare PoolId reaches it (`config.poolId`); anything else is `INVALID_POOL_ID` before a call, and an answer for another pool or chain is `V2_INVALID_RESPONSE`. The price is derived from `sqrtPriceX96` and the served price only cross-checks it (0.5%). Use and Apply require the hook's `applicable`. Real mode never falls back to fixtures: errors surface with a retry. Mock mode serves `buildPanelFixtures.ts` (every hookless mock v4 pool) with no network. The Aave reserve rows (`usePanelReserves.ts`) select over the reserves of the shell's `useV2MandateCatalog` instance, passed in (no second load); re-reading the supply APY while a panel is open is an open decision. No new API client. |

## Fund Review/launch integration (POO-2177, rules v1; page POO-2172)

| Seam | Owned file | Contract and remaining integration |
|------|------------|------------------------------------|
| Just-in-time launch builders | `src/lib/api/v2/launch.ts` | Server-only v2 API writes with `x-api-key`; admin routes additionally require server-only `PP_API_ADMIN_KEY` as `x-admin-key`. API PR #180 provides payoutFeeBps/transits/balances. |
| Real wallet/receipts | `src/features/manager/fund/launch/useV2LaunchWallet.ts` | Headless Privy/wagmi binding, chain proof, mined receipts and hub USDC balance. Real-only provider mount; mock mode never signs. |
| Agreed public seam | `src/features/manager/fund/launch/index.ts` | `startFundLaunch(draft: FundLaunchDraft): Promise<{journeyId: string}>`; pure `getLaunchSteps(draft): LaunchStepPreview[]`; `useV2ReviewDraft(draftId)` => review/setField/errors/launchBlockers/isReady; `useV2Launch(journeyId)` => steps/current/sign/retry/resume/cancel/outcome; `FundLaunchJourney`; `explorerTxUrl(chainId, hash)`. Exports ReviewDraft/FundLaunchDraft/LaunchStepPreview/LaunchJourney types. |
| Review DATA / Launch JOURNEY split | `src/features/manager/fund/launch/useV2ReviewDraft.ts`, `FundLaunchJourney.tsx` | Murilo owns Review PAGE (POO-2172). Review setters preserve latest MandateDraft.review beside plan. Our start entry freezes/resumes and navigates to manager/fund-launch/[journeyId]; Journey owns outcomes and immediate explorer hashes/receipt statuses. No builder page/shell edits. Flow fee fallback is labelled until detail fees exist. |
| Canvas BuildPlan v1 | `src/features/manager/fund/launch/plan.ts` | Reads `draft.plan` from origin/feat/mgr-poo-2144-canvas-integration (PR #31/POO-2151 roll-up) through owned structural adapter, no competing reducers. POO-2144/2171 must provide canonical range/loss/leaf execution fields; empty config/Borrow fail closed. Since POO-2184 (slice PA1) the pool config carries the bare v4 PoolId (stored as the row's own, lowercase), canonical `tickLower`/`tickUpper`, `fullRange`, `displayInverted` and `slippagePct` 0.1 to 5 (`build/plan/blockConfig.ts`): the panels write them, and the reducer refuses ticks off the pool's spacing and Full off its aligned extremes on a row with its pool key. One chain holds one position, and `launchAgreement.test.ts` checks that every plan `planReadiness` calls ready is accepted by `getLaunchSteps`. |
| Browser checkpoint journal | `src/features/manager/fund/launch/journal.ts` | Per manager/draft immutable steps, hashes, receipt state, addresses and actual net principal. Durable API launch-plan and cross-device coordination are later work. |

See `src/features/manager/fund/launch/README.md` for the adapter gaps, recovery rules and operational waits.

## Fiat on-ramp (Privy rail, default on; Paybis dormant behind `privyOnRamp=off`)

Ported from the private repository for the hackathon (epic POO-1793 over the POO-1129 foundation); the narrative is `docs/_hackathon_privy/`. **Read the section through one fact:** money is counted only when a balance read says so. The provider's `submitted` / `confirmed` is a claim; `settled` is the observed on-chain delta, and every receipt and every `completed` event fires from it.

**Three orthogonal gates.** `isMockMode` keeps the fixture path on both hosts (the Privy checkout never opens against fixtures); `fiatOnRamp` decides whether a purchase is offered at all (the planner's `buy` leg and the picker's buy route read the SAME flag); `privyOnRamp` decides WHICH rail serves it. Both ship **on** in this repository (`docs/FEATURE_FLAGS.md`). The vendor environment is DERIVED, `stripe-sandbox` unless `NEXT_PUBLIC_APP_ENV=production` and real mode, so a development build cannot charge a real card.

| Marker | File | Status today | Expected real call / remaining gap |
|---|---|---|---|
| Rail decision | `src/lib/onramp/onRampProvider.ts` (PP-CORE-LIB-105) + `useOnRampProvider.ts` (PP-CORE-HOK-034) | **REAL, pure.** One decision table, `none` / `paybis` / `privy`, read by the server resolver and the client hook so the two hosts move together | none |
| Privy fiat checkout | `src/lib/onramp/usePrivyOnRamp.ts` (PP-CORE-HOK-035), `useAddFunds` from `@privy-io/react-auth@3.42.0` | **REAL in real mode.** Fiat only (`crypto` never passed), `defaultAsset` always set or the adapter refuses, the call synchronous inside the click so the popup is not blocked, an intent record minted first (`onRampIntent.ts`, PP-CORE-LIB-107) | Privy's checkout surface (Stripe inside the modal; MoonPay / Coinbase / Meld as popups). `useAddFunds` is marked experimental by the vendor, which is why one adapter absorbs it |
| Exit classification | `src/lib/onramp/classifyAddFundsOutcome.ts` (PP-CORE-LIB-109) | **REAL, pure.** One question, could money have moved: `no` only for the SDK's pre-flight guards and a popup that never opened; everything else `maybe` | Literal-message table read from the shipped bundle; a reworded message degrades to an observation window, never to a cancellation |
| Settlement | `src/lib/onramp/awaitOnRampSettlement.ts` (PP-CORE-LIB-110), bound by `useOnRampSettlement.ts` (PP-CORE-HOK-025) | **REAL.** One `balanceOf` on the destination chain, polled with backoff against a baseline read BEFORE the checkout opened | The window does not survive a reload yet; cross-session resume is tracked in the private backlog (POO-1833) |
| Coverage question | `src/lib/onramp/coverageProbe.ts` (PP-CORE-LIB-108) + `useOnRampCoverage.ts` (PP-CORE-HOK-036) | **REAL.** `PUT https://auth.privy.io/api/v1/onramp/fiat/quotes` through `fetch` (not the SDK, which swallows failures), so a rail outage and an uncovered country are told apart | `unknown` never blocks; `uncovered` does |
| Buyer currency | `src/lib/onramp/resolveOnRampCurrency.ts` (PP-CORE-LIB-096), `buyerCurrency.ts`, `currencyPairs.ts` | **REAL, server-only.** Edge country header, then profile country, then USD; validated against the fiat set the rail sells in | Needs `PP_API_URL` / `PP_API_KEY` for the profile read; a currency the rail cannot charge in refuses rather than defaulting |
| `/deposit` host | `src/features/deposit/DepositScreen.tsx` (PP-DEP-SCR-001) -> `DepositPrivyCheckout.tsx` (PP-DEP-CMP-006) | **REAL in real mode.** `amount` -> `onramp` -> `onramp-settling` -> `success`, plus the four honest exits; no review step, the provider prices the charge | Paybis path (`StandaloneOnRampRail`, `PaymentMethodDialog`, `PaymentMethodList`) stays in the tree, unmounted while `privyOnRamp` is on |
| Provisioning host | `src/features/strategies/components/ProvisioningPanel.tsx` (PP-CORE-CMP-046) -> `provisioning/provisioningView.ts` -> `PrivyBuyStep.tsx` (PP-STR-CMP-029) | **REAL in real mode.** The planner's `buy` leg (`src/lib/provisioning/planActions.ts`, `buildPlan.onRampEnabled`) rendered on the Privy rail; the next legs size themselves from the balance the buy actually produced | `ETH-BASE` (native) is not for sale on the rail; the step refuses before opening |
| Purchase funnel | `src/lib/analytics/fundingBuyFunnel.ts` (PP-CORE-LIB-111) | **REAL.** `funding_buy_started` / `submitted` / `failed` / `settled`, one emitter for both hosts, `settled` only from the watcher | Declared in `docs/ANALYTICS_EVENTS.md` |
| Settlement webhook relay | `src/app/api/webhooks/privy/funds-deposited/route.ts` (PP-CORE-SEC-005) | **REAL.** Byte-faithful relay of `wallet.funds_deposited` to `pool-party-api`, which holds the signing secret | Optional for the demo; the browser-side watcher settles on its own |
| Paybis foundation (dormant) | `src/lib/onramp/onRampActions.ts`, `paybisWidget.ts`, `paybisCapture.ts`, `src/app/api/onramp/method-icon/route.ts`, `src/features/strategies/components/provisioning/PaybisWidgetFrame.tsx` | **Code, not a surface.** Reachable only with `privyOnRamp=off`; the widget loader is not mounted in this repository | Kept so the tree matches the private main file for file; deleted together with the `privyOnRamp` flag when the Paybis rail retires |

## Fund contracts builder (Manager Console V2, epic POO-2119)

The Mandate step of the fund-contracts strategy builder (hub Arbitrum, spoke Robinhood Chain,
PoolPartyLabs/smartcontract-v2): five list-picking screens, reached from the header's V1/V2
`ContractFamilyToggle` (`PP-CORE-CMP-075`) behind the `fundContracts` flag, that persist a local
draft and sign nothing on chain. POO-2133 wires the real catalog behind server actions with
`v2Mandate` (`PP-MGR-LIB-025`), `useV2MandateCatalog` (`PP-MGR-HOK-011`) and
`MandateCatalogStatus` (`PP-MGR-CMP-060`); mock fixtures
remain the local preview harness. Draft persistence and Review/launch remain separate slices.

The Build canvas (epic POO-2144, `src/features/manager/fund/build/`, mounted by the Build phase of the builder
since POO-2157) sits on the same draft. The canvas itself writes only the draft: it calls no API and requests no
transaction. Its rows below say what each block becomes when a plan is launched. The launch journey of POO-2177
(`src/features/manager/fund/launch/`, section above) already compiles a stored plan into API builder calls through
its own structural adapter, but the Review page that starts it (POO-2172) and the panel that writes a block's
range and slippage (POO-2171) are not built, so no manager can launch a plan from the canvas yet. The on-chain
facts come from the block sheets POO-2160 to POO-2166 (read from the API v2 alpha specification and the contracts
on 2026-10-03, not measured here), corrected where the API and this repository have moved since. The canvas rows
carry no marker in code, except the plan storage row.

| Marker | File | Mocked today | Expected real call |
|---|---|---|---|
| Mandate catalog (networks, protocols, tokens, price source) | `src/features/manager/fund/useV2MandateCatalog.ts`, `v2Mandate.ts`, `mandateCatalog.ts` | Mock fixtures unchanged; real mode resolved in POO-2133. In both modes Uniswap v3 positions are listed but unavailable, "Coming soon" (rules v3, POO-2167: the fund contracts have no Uniswap v3 position adapter; the required Uniswap v3 swap is unaffected) | Versioned Arbitrum/Robinhood capabilities plus server-only `/api/v2/catalog/tokens` and `/catalog/aave-v3/reserves`; `hubPriced` and live Aave supply availability. No generalized capability-registry route exists. |
| Mandate draft persistence (draft API) | `src/features/manager/fund/mandateDraftStore.ts` (`PP-MGR-STO-001`); `src/features/manager/fund/useMandateDraft.ts` (`PP-MGR-HOK-006`); `src/features/manager/fund/components/MandateDraftsList.tsx` (`PP-MGR-CMP-044`) | A draft is read/written as versioned JSON in `localStorage` key `pp.manager.mandateDrafts.v1` (`{ version: 1, drafts: Record<id, MandateDraft> }`); every access in try/catch, a corrupt payload reads as empty and is left alone until the next real write (handoff open point 1) | the backend draft API: `listDrafts` becomes a fetch, `upsertDraft` a PUT, `deleteDraft` a DELETE, `subscribe` a cache invalidation. The store's six-function API is the seam and does not change shape. Wiring issue: POO-2132 |
| Build canvas plan (rides the draft seam) | `src/features/manager/fund/build/plan/planStorage.ts` (`PP-MGR-LIB-021`, `normalizePlan`, `planFingerprint`) | The Build canvas plan is an OPTIONAL field of the mandate draft (`MandateDraft.plan?`, with `lastPhase?`), so it is stored in the same `localStorage` payload by the same `save()`, payload version unchanged (1); `useBuildPlan` (`PP-MGR-HOK-007`) only writes it through the draft hook and never touches storage. On read, `normalizePlan` checks its structure; an unreadable plan is left out of the draft, which is kept and marked `planUnreadable`, and the store writes the raw plan back untouched on every write until a save with a new plan replaces it. The canvas sends nothing on chain or to an API: product owner ruling 2026-10-03, no backend strategy drafts (POO-2151); fund creation through the API was decided for the demo the same day (POO-2147) and belongs to the launch journey, not to the canvas | travels inside the draft payload of the backend draft API, with no seam of its own. Wiring issue: POO-2132, not needed for the buildathon MVP (product owner ruling 2026-10-03: no backend strategy drafts). This is the only `PP-INTEGRATION-POINT` marker inside `src/features/manager/fund/build/`; the other canvas seams in the rows below carry none, because the canvas itself calls nothing |
| Build canvas block configuration (`config`; no marker in code) | `src/features/manager/fund/build/plan/buildPlan.ts` (`PoolBlockConfig`, `AaveBlockConfig`, `PP-MGR-LIB-021`); `src/features/manager/fund/build/blocks/blockRegistry.ts` (`describeBlock`, `configField`, `PP-MGR-LIB-024`) | Every block a manager adds on the canvas is EMPTY (`config: null`, a dashed card, share 0%, "Pick a pool" or "Pick an asset"); a configured block exists only in the fixtures of `src/mocks/data/buildCanvasFixtures.ts` (`PP-MGR-MCK-004`), in stories, and in a stored plan edited by hand. The canvas-facing minimum is `{ poolId }` (the id of a pool in the mandate draft) for a pool and `{ assetKey }` (`network:address` of a mandate token) for Aave, coordinator default D14; a manager Swap has no config. The launch journey needs more (a price range and `maxLossBps` per v4 block, `leafSharePct` per leaf) and reads it from the optional `draft.launchExecution[blockId]` until the panel writes it | the configuration panel batch (handoff POO-2171) writes `config` through `setBlockConfig` and extends the two interfaces without renaming them, so a card's title and caption, the shares and the Swap · auto above it re-derive from it (HU2; block sheets POO-2160 and POO-2161) |
| Build canvas pool and asset sources: Uniswap v4 pools and Aave v3 reserves (no marker in the canvas; the panel batch reads them) | `src/features/manager/fund/mandatePoolSource.ts`, `src/lib/api/v2/catalog.ts` and `src/mocks/data/fundPools.ts` (`PP-MGR-MCK-003`); the "Mandate pool catalog, Uniswap v4" row below | The canvas lists no pool and no reserve: a block's pool is a pool already in the mandate draft (`draft.pools`) and its asset a token already in it (`draft.tokens`). In real mode the Mandate reads the v4 pools and the Aave reserves from the backend catalog through server actions (POO-2133, backend POO-2146, both delivered), with TVL and APR left null when the API has none; in mock mode `fundPoolFixtures().uniswapV4` serves them. No sample data in real mode (product owner ruling 2026-10-03) | the configuration panel (handoff POO-2171) lists, for a block, the pools and tokens the Mandate already holds, so the canvas needs no catalog read of its own (block sheets POO-2160 and POO-2161) |
| Build canvas block availability table (coming soon) | `src/features/manager/fund/build/plan/buildPlan.ts` (`BLOCK_KIND_STATUS`, `BLOCK_KIND_PROTOCOL`, `PP-MGR-LIB-021`) | Static data: `uniswapV4Pool`, `aaveSupply` and `aaveBorrow` are enabled, `uniswapV3Pool`, `pendle` and `gmxPerp` are coming soon and are never created (every reducer refuses them with `coming_soon`). `ProtocolId` has neither Pendle nor GMX, so these rows come from a table, not from the mandate. Aave Borrow is enabled as coordinator default D29 although the fund contracts are supply only; the Borrow row below records the decision of 2026-10-04 to make it coming soon, which the code does not do yet | a read of the fund contracts' adapter registry, so that enabling or disabling a kind is a data change rather than an edit of this table (wiring issue POO-2134; block sheets POO-2165 and POO-2166; compliance `CR-MGR-016` and `CR-MGR-017`) |
| Block to on-chain builder: Uniswap v4 pool (`uniswapV4Pool`) | `src/features/manager/fund/build/blocks/blockRegistry.ts` (`BLOCK_REGISTRY`); compiled by `src/features/manager/fund/launch/plan.ts` and `driver.ts` (POO-2177) | The canvas stores the block and calls nothing; the launch journey turns a configured v4 block into a `swap` step and an `open` step, but needs a price range (ticks or prices) and `maxLossBps` that the canvas does not store (the optional `draft.launchExecution[blockId]` supplies them until the panel does), and no Review page starts it yet (POO-2172) | `POST /funds/{core}/positions/build` with `{ action: "open", side, adapter, poolKey (the bytes32 pool id), amount0, amount1, a tick or price range, amount0Min, amount1Min }`, simulated by the API and signed by the manager on that chain, event `PositionOpened`, on Arbitrum and on Robinhood Chain (block sheet POO-2160) |
| Block to on-chain builder: Aave v3 Supply (`aaveSupply`) | `src/features/manager/fund/build/blocks/blockRegistry.ts` (`BLOCK_REGISTRY`); compiled by `src/features/manager/fund/launch/plan.ts` and `driver.ts` (POO-2177) | The canvas stores the block; the launch journey opens it as one `open` step on the hub, for the hub's base token (USDC) only (`UNSUPPORTED_AAVE_ASSET` otherwise), always as a parallel leaf that never funds a block under it | `POST /funds/{core}/build` `{ action: "allocate-to-hub", amount }` then `POST /funds/{core}/positions/build` `{ action: "open", side: "hub", adapter (Aave), poolKey (the reserve address padded to bytes32), amount }`, event `PositionOpened`, supply only, USDC only and Arbitrum only, where several Supply blocks of one asset execute as one Aave position and a Supply funds nothing under it (handoff v1.3, Rafael's decision 4; block sheet POO-2161) |
| Block to on-chain builder: Swap · auto and Swap (`swap`, `auto: true` or `false`) | `src/features/manager/fund/build/blocks/blockRegistry.ts` (`describeFlow`); `src/features/manager/fund/build/plan/planReducers.ts` (`reconcileAutoBlocks`); `src/features/manager/fund/launch/driver.ts` (POO-2177) | The canvas prints a tooltip and no quote, and a Swap pill is a plan block only. The launch journey does not compile a plan Swap one to one: it derives one `swap` step before each v4 `open` from the pool's tokens and refuses a plan whose chain holds a Swap but no v4 pool (`BUILD_EXECUTION_GAP`), so a standalone manual Swap fails closed | `POST /funds/{core}/build-swap` `{ action: "swap", from, side, tokenIn, tokenOut, amount (raw units), maxLossBps 1 to 500 }` (one direct Uniswap v3 path, event `Swapped`), called with the server-only `PP_API_ADMIN_KEY` as `x-admin-key`, where an API-key-only unsigned quote with `quotedAmountOut` and `priceImpactBps` has existed since POO-2148 (deployed on dev) and the canvas does not read it (block sheet POO-2162) |
| Block to on-chain builder: Collect fees (`collectFees`) | `src/features/manager/fund/build/blocks/blockRegistry.ts` (`describeFlow`) | A pill that creates the Income (fees) block and the income line in the picture; the launch journey ignores it, because collecting is a later operation on an open position and adds no launch step, and no code in this repository calls the collect builder | `POST /funds/{core}/positions/build` `{ action: "collect-income", side, adapter (v4), positionKey }` with no amount, where income on a spoke returns only through a COLLECT order relayed by the keeper, whose hub-order relay was wrong when the sheet was written (gap G-25 of the API specification; POO-2149, still open, asks when the fix lands), so collecting on Robinhood Chain is not demo-safe (block sheet POO-2163) |
| Block to on-chain builder: Bridge · auto (derived, one per spoke) | `src/features/manager/fund/build/layout/layoutGraph.ts` (the Bridge node of each spoke group); `src/features/manager/fund/build/graph/BuildGraph.tsx` (draws it); `src/features/manager/fund/launch/driver.ts` (POO-2177) | The Bridge exists only for a spoke, and a spoke exists only when Robinhood Chain is in the mandate, which preselects Across and makes it mandatory; a hub-only Arbitrum fund has no Across, no spoke and no Bridge. The canvas draws the pill, its tooltip and the share label above it and reads no quote; the launch journey quotes the send through the API and builds it | `POST /funds/{core}/build` `{ action: "send-to-spoke", amount (raw USDC), spokeIndex: 0, bridgeRank: 0, bridgeData: "0x" }`, signed by the manager on Arbitrum, event `SentToSpoke`, after an API-key-only Across quote, with the `send-to-hub` and `return-to-core-vault` builders for the return the principal line draws (POO-2148, no code in this repository calls them yet) and `POST /funds/build-spoke` for the manager-signed `createSpoke` on Robinhood Chain (POO-2147, called by the launch journey; block sheet POO-2164) |
| Block to on-chain builder: Aave v3 Borrow (`aaveBorrow`; no contract support) | `src/features/manager/fund/build/plan/buildPlan.ts` (`BLOCK_KIND_STATUS`) | A Borrow can be drawn under a configured Supply and saved; the launch adapter refuses it (`UNSUPPORTED_POSITION`, fail closed). Murilo decided on 2026-10-04 that Borrow becomes coming soon, like Pendle and GMX, and that the insert port under a Supply goes away; the code still offers Borrow and the port, and a later slice (PA0) makes the change | none: the fund contracts are supply only (the Aave adapter never borrows, the API has no borrow action and no read for borrow APY, loan to value, health factor or liquidation price), so a plan with a Borrow can never become operations (block sheet POO-2165; compliance `CR-MGR-016`) |
| Mandate pool catalog, Uniswap v4 | `src/features/manager/fund/mandatePoolSource.ts`, `steps/PoolsStep.tsx` | Resolved in POO-2133; existing mock fixtures remain local. Uniswap v3 positions stay unavailable since rules v3 (POO-2167), so no reducer accepts a Uniswap v3 pool in either mode | Real v4 catalog list/pair filters and bytes32 PoolId lookup on chains 42161/4663. Full PoolKey retained; hooked/native/ineligible rows refused. Null TVL/APR/tier share are not invented. Legacy `/dex-pools` remains exclusively in V1. |
| Spoke cap unit (Limits step) | `src/features/manager/fund/steps/LimitsStep.tsx`, `v2Mandate.ts` | Frontend percentage intent resolved in POO-2133; on-chain percentage enforcement remains POO-2169 | Build-create selection stores `spokeCapPercent`, 0..100 in 5-point steps or null. Current API provisions maximum on-chain cap, not percentage enforcement. Protocol/token sliders remain optional client-only allocation aids. Fund limits read from detail Mandate/profile, not an invented limits route. |
| Contract-family marker (V1 / V2 preference) | `src/lib/hooks/useContractFamily.ts` (`PP-CORE-HOK-038`) | A client-only UI preference, `localStorage` key `pp.contractFamily`, default `"v1"`; decides which builder `/manager/new` renders and nothing about what the user may do | a per-strategy marker from the backend once funds exist (POO-2116 slice 5); today the family is read nowhere but this hook and the toggle/route switch that consume it. Wiring issue: POO-2134 |

## Universal Funding rail (Uniswap Trading API)

Epic POO-1022 (2026-07-24/25). **Pay for any Pool Party operation with any token you hold, on any supported chain.** The rail swaps and bridges a wallet's existing holdings into the USDC-plus-gas an operation needs, before the operation runs. Full narrative: `docs/_hackathon/`. Decisions: ADR [0002](adr/0002-uniswap-trading-api-as-the-provisioning-rail.md) and [0003](adr/0003-server-only-uniswap-key-boundary.md).

**Read the whole section through one fact:** the browser never talks to Uniswap. `UNISWAP_API_KEY` is a second server-only credential alongside `PP_API_KEY`, read only inside `src/lib/uniswap/client.ts` (which begins `import "server-only"`), and the only public surface is a `"use server"` action layer. So `connect-src` in `src/lib/security/csp.ts` carries **no** entry for `trade-api.gateway.uniswap.org`, and the absence is load-bearing: a PR that needs one has moved a call to the browser and broken ADR 0003. `pnpm secrets:check` (`scripts/bundle-secrets-check.ts`) greps the build output to prove it, because `typecheck` / `lint` / `test` / `i18n:check` all pass straight through that failure.

**Three orthogonal gates,** as everywhere else in this repo. `isMockMode` decides mock-vs-real *data*; the `provisioning` flag decides whether the gate is mounted inside the six operation modals; the `swapScreen` flag decides whether `/swap` exists as a route. Both flags ship **off** (`docs/FEATURE_FLAGS.md`). In mock mode the planner resolves to `fixtures/mockPlan.ts` and no Uniswap call is made at all, so the design harness stays offline, key-free and session-free.

| Marker | File | Status today | Expected real call / remaining gap |
|---|---|---|---|
| Uniswap transport | `src/lib/uniswap/client.ts` (PP-CORE-LIB-050) + `errors.ts` | **REAL when `UNISWAP_API_KEY` is set.** `server-only`, `x-api-key` injected per request, Zod-validated responses, bounded retry on the transient class only (429/502/503/504/408/network, never 4xx), per-attempt `AbortController` under a cumulative budget. Mirrors `src/lib/api/client.ts` exactly | `https://trade-api.gateway.uniswap.org/v1`. Unset key = the rail never plans and the gate never fires; it does not degrade to a fake plan |
| Uniswap server actions | `src/lib/uniswap/actions.ts` (PP-CORE-LIB-052) | **REAL.** The only public surface: `quoteSwap` · `checkApproval` · `buildSwapTx` · `listSwappableTokens`, each returning a typed `{ ok } \| { ok:false, code, message }` and never throwing across the RSC boundary. The wallet comes from the SIWE session, never from the action body | `POST /quote` · `POST /check_approval` · `POST /swap` · `GET /swappable_tokens`. `listSwappableTokens` is cache-tagged so the funding picker does not re-fetch per keystroke |
| Chained Actions (`/plan`) | `src/lib/uniswap/schemas.ts` (PP-CORE-LIB-051), under an `UNREACHABLE` block comment | **NOT REACHABLE.** A read-only probe (POO-1054, 2026-07-25) established that `routing: "CHAINED"` is never returned to our key, and `POST /plan` takes a chained quote as its body. The three actions that called `/plan` were deleted rather than left as dead code | If Chained Actions is ever enabled for the account, the schemas are already written. Until then the planner decomposes instead: `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §1 |
| Provisioning planner seam | `src/lib/provisioning/planner.ts` (PP-CORE-LIB-016) → `planActions.ts` → `buildPlan.ts` (PP-CORE-LIB-055) | **REAL in real mode.** `computePlan(isMockMode)` is the single seam; mock resolves to `fixtures/mockPlan.ts`, real crosses the server boundary into `buildPlan`, which prices every leg from live quotes. Same-chain different-token is one `CLASSIC` swap, cross-chain same-token one `BRIDGE` leg, cross-chain different-token two legs (swap to the source chain's USDC, then bridge) | Every leg is re-quoted **at execution time** from the balance the previous leg actually produced, never pre-committed from an estimate |
| Gate context (per-chain balances + gas price) | `src/lib/provisioning/gateContext.ts` (PP-CORE-LIB-057) via `getProvisioningContextAction`; consumed by `useProvisioningGate` (PP-CORE-HOK-017) and `buildProvisioningInput` (PP-STR-LIB-004) | **REAL.** Replaces the hard-disable stub that returned a wallet holding a million dollars, so the gate could never trip. Per-chain native and token USD from the shipped multi-chain holdings read, plus a live `POST /quote` gas figure, retiring the hardcoded `0.5` in `mapManagerStrategyDetail.ts:180` | **Fails safe:** a degraded read resolves to NO context, and no context means no gate, so the operation proceeds exactly as before. Deliberately does not fall back to the USDC-only on-chain read, which carries no native balances and would read every chain as out of gas precisely while the backend is unhealthy |
| Funding inventory | `src/lib/balances/fundingInventory.ts` (PP-CORE-LIB-053) + `fundingInventoryActions.ts` | **REAL.** The intersection of what the wallet holds (`fetchWalletHoldings`, no second balance reader) and what Uniswap can route (`GET /swappable_tokens` per held token), so a token we cannot move is never offered. Per-chain read failures are skipped, not fatal | Sub-$1 dust stays filtered: bridging dust costs more than it moves |
| Gas feasibility | `src/lib/provisioning/gasFeasibility.ts` (PP-CORE-LIB-054) | **REAL, pure.** OK / TOP-UP / BLOCKED per source chain from injected quotes and balances. A BLOCKED chain is shown greyed **with its reason** and two escapes, never hidden | A chain at exactly zero native can originate nothing at all. Sizing is against the **whole route's** gas, because a decomposed route pays twice on the source chain |
| Cost model | `src/lib/provisioning/costBreakdown.ts` (PP-CORE-LIB-056); rendered by `ProvisioningCostBreakdown` (PP-STR-CMP-024), threaded into `FeeBreakdown.tsx` | **REAL.** One pure function over the plan's own steps, run by BOTH the planner and the cost table, so the total a user approves and the breakdown they read cannot disagree. Retires the mock planner's hardcoded ~1% / $0.99-floor fee model | Also fills the canonical fee tooltip's Bridge line (`FeeBreakdown.tsx`, POO-799 decision #2), a "Coming soon" placeholder only because nothing in the product could price a bridge |
| Execution rail | `src/features/strategies/lib/buildPlanSteps.ts` (PP-STR-LIB-017) + `awaitBridgeSettlement.ts` (PP-STR-LIB-018); bound by `useProvisioningRail` (PP-STR-HOK-020) | **REAL.** Funding legs → `FlowStep[]` on the shipped `useWalletSignFlow`. Every `SEND_TX` goes through `executeBuiltTransaction`, so the chain assertion, the one corrective `wallet_switchEthereumChain` and the account assertion are inherited: **cross-chain switching cost no new switching logic.** `SIGN_MSG` typed data carries decimal-string uints, never native bigint, because Privy embedded wallets `JSON.stringify` it | A bridge settles on the **destination** chain: `balanceOf(wallet, tokenOut) − destBalanceBefore ≥ minAmountOut`, polled with backoff against a baseline recorded before the broadcast. A source receipt only proves the funds left |
| Universal Funding rail: recovery journal + per-leg nonce baseline (POO-1038 · POO-1043 rules v1) | `src/features/strategies/hooks/useProvisioningRail.ts` (PP-STR-HOK-020, the binding), `src/features/strategies/lib/fundingJournal.ts` (PP-STR-LIB-019) + `buildPlanSteps.ts` (PP-STR-LIB-017, `planJournalLegs`), `src/lib/tokens/readErc20.ts` (`readTransactionCount`); consumed by `ProvisioningPanel` (PP-CORE-CMP-046) | **NOT mocked, a real on-chain read.** POO-1043 [R7] binds the journal POO-1038 built: the panel mints it at the plan confirm (`openJournal(plan)` → `planJournalLegs`, route legs only, approvals excluded) and retires it when the route completes (`closeJournal()`), never on a failure and never at the bridge poll ceiling, which is exactly when the record is what recovery needs. `createDeferredJournalRecorder` resolves WHICH journal each call writes to at call time, because the rail is bound when the plan is quoted and the journal is minted a user decision later. Before every leg prompts the wallet the recorder reads `eth_getTransactionCount(owner, "latest")` on **that leg's** chain via `readTransactionCount`, deliberately through a per-chain public client and not the wallet provider (a route spans chains; the provider answers for whichever one it is currently on). In a later session that baseline is the only evidence separating "the wallet broadcast and we never learned the hash" from "nothing was ever sent", and the two resolve to opposite actions. Same shape and same reason as `readNativeBalance`. Unbound (mock mode, or no journal open) every recorder call is a silent no-op and the route runs identically | **PP-INTEGRATION-POINT (POO-1038):** the journal is client-persisted (`localStorage`), therefore per-browser and lost with the storage. A durable server-side record replaces it when the funding rail leaves hackathon scope |
| Universal Funding rail: reading the journal back (POO-1055 rules v1) | `src/features/strategies/hooks/useFundingRecovery.ts` (PP-STR-HOK-021) over `reconcileFundingJournal.ts` (PP-STR-LIB-020) + `fundingJournal.ts` (PP-STR-LIB-019, `findResumableJournal`); reads `src/lib/tokens/readErc20.ts` (`readTransactionReceiptStatus` / `readTransactionCount` / `readErc20Balance`); rendered by `FundingRecoveryBanner` (PP-STR-CMP-025), mounted on `AppShell` (PP-CORE-LAY-001) | **NOT mocked, three real on-chain reads.** The writing side shipped in POO-1038/POO-1043 with no reader in production, so an interrupted route left a correct record nobody ever looked at. On session entry this finds the in-flight route for the CONNECTED wallet, runs the §3.5 decision table against the chain and persists the corrections. Reads only: the `ChainReader` type has three read methods and no way to send, so "an ambiguous state is never resolved by broadcasting" is enforced by the type. `readTransactionReceiptStatus` uses the raw `eth_getTransactionReceipt` rather than viem's wrapper because "no receipt yet" and "the read failed" decide between waiting and treating the leg as ambiguous, and viem collapses them into one throw. Nothing auto-broadcasts on load; the only forward affordance is a link back to the operation, whose plan is then re-derived from current balances | **PP-INTEGRATION-POINT (POO-1055):** the same client-persistence caveat as the row above, and the reads run against the public per-chain RPCs in `chains/config.ts` rather than an indexer, so a degraded endpoint degrades to "still checking" rather than to a wrong verdict |
| Funding UI | `FundingSourceSelector` (PP-STR-CMP-023) · `ProvisioningCostBreakdown` (PP-STR-CMP-024) · `ProvisioningPlanCard` (PP-CORE-CMP-044) · `ProvisioningPanel` (PP-CORE-CMP-046) · `SwapScreen` (PP-CORE-SCR-010) | **REAL data behind a dark-launched flag.** The panel is the single mount point: all six operation modals and the `/swap` screen delegate to it, so there is no second planner and no second rail. It also mounts the shipped `PriceImpactGate` (PP-STR-CMP-022), so a poisoned thin-pool route cannot enter through the funding path | `/swap` needs a design pass before launch (no Figma exists for the screen), tracked on `docs/FEATURE_FLAGS.md` |
| Funding funnel analytics | `src/lib/analytics/provisioningFunnel.ts` (PP-CORE-LIB-058) + `src/lib/analytics/events.ts` | **REAL.** Nine typed events from gate-fired to one terminal outcome, carrying route shape / leg count / USD magnitude and never a raw address. Completion is emitted from the flow-status effect once every leg resolves, never from the confirm click | The events are declared in `docs/ANALYTICS_EVENTS.md`; GA4 funnel configuration is a console-side task, not code |
| Buy-crypto alternative | `src/features/strategies/components/provisioning/PoweredByPaybis.tsx`, `BuyGasModal.tsx` (PP-CORE-MOD-010) | **A handoff, not an integration.** This epic wrote no on-ramp code. The gas surface stopped naming a fiat provider, because the step it actually implements is an on-chain swap; the fiat option survives as a CTA to the existing `/deposit` surface | **PP-INTEGRATION-POINT (POO-87/POO-213):** the real Paybis ramp is still a CSP-ready stub. See the [Fiat on-ramp](#fiat-on-ramp-paybis) section |



## Cash+ dedicated investment page

Cash+ is independent of the service factory. `NEXT_PUBLIC_FEATURE_CASH_PLUS` gates the page and navigation. `NEXT_PUBLIC_CASH_PLUS_MODE` selects the current interactive mock preview or a separately configured fork/live manifest. `pnpm cash-plus:ui` explicitly selects preview and needs no RPC or wallet. No Cash+ HTTP endpoint, database, portfolio model or strategy-catalog entry is added.

| Boundary | Files | Behavior |
|---|---|---|
| Demo ledger | `src/mocks/services/cashPlusDemo.ts`, `hooks/useCashPlusDemo.ts` | Explicitly simulated integer accounting and session storage. User-triggered day advancement; no RPC client, wallet request, fake hash or explorer URL. |
| Deployment and RPC | `src/lib/cash-plus/config/`, `client.ts` | Chain ID, deployment block hash and code hashes bind reads to one deployment/run. Fork requires loopback RPC and chain31337; live requires42161 and HTTPS. |
| Investor state | `readSnapshot.ts`, `history.ts` | Pinned contract reads; bounded event history with stable anchor/recent-block rechecks. Missing data stays unknown. Lending attribution excludes detectable unsolicited aToken receipts. |
| Wallet | `CashPlusProvider.tsx`, `hooks/useCashPlus.ts` | Existing Privy wallet in live mode; injected EIP1193 wallet for local fork; no preview sends. Active account and chain are checked before every request. |
| Transactions | `buildTransaction.ts`, `operations.ts`, `journal.ts` | Exact approval, fresh simulation, locally encoded calldata, explicit minimum outputs, receipts and account/run-scoped pending recovery. |
| Automation | `scripts/cash-plus/` | Operator-only local fork CLI using unlocked test accounts. No signing material enters browser imports. Serial writes reconcile pending receipts before retry. |
| Presentation | `src/features/cash-plus/components/` | Read-only render of controller state; independent annual assumptions never change observed balances. |

See the [feature README](../src/features/cash-plus/README.md), [specifications](features/cash-plus/) and local rehearsal evidence for the exact addresses and source block used in a demonstration. Fork transactions have no public explorer URLs.
## Tools: Uniswap v4 hook risk scan (hookrisk)

Hackathon, 2026-09-13. The `/tools` page (PP-TOOLS-SCR-001) takes a chain and a deployed hook address and returns the hookrisk report for it. Behind the `hookTools` flag; full write-up in `docs/_hackathon_hookrisk/04_TOOLS_PAGE.md`.

**This surface has no mock branch, deliberately.** Everywhere else in this repo `isMockMode` decides whether data is real, and a mock is a legitimate placeholder. Here it would not be: the artifact is a *risk assessment of a contract someone may be about to trade against*, and a plausible-looking fabricated one is worse than an empty page. So when the toolchain or the key is missing, the job fails fast naming exactly what is absent and the screen prints that instead of a report. That is the same posture hookrisk itself takes (`hookrisk/CLAUDE.md`: a tool that reports nothing looks exactly like success).

| Marker | File | Status today | Expected real call / remaining gap |
|---|---|---|---|
| Block explorer (verified source) | `src/lib/tools/hookrisk/explorer.ts` (PP-TOOLS-LIB-002) | **REAL.** `GET https://api.etherscan.io/v2/api?chainid=…&module=contract&action=getsourcecode`, one V2 endpoint covering all five chains. Server-only; the key is read at call time in `jobs.ts` (PP-TOOLS-LIB-005) so an unset key fails one job rather than the module | `ETHERSCAN_API_KEY`, server-only, no `NEXT_PUBLIC_` prefix ever. An unverified contract returns `NOT_VERIFIED`, a named result, not an empty source set |
| hookrisk toolchain (`forge`, then the CLI) | `src/lib/tools/hookrisk/run.ts` (PP-TOOLS-LIB-004), driven by `jobs.ts` (PP-TOOLS-LIB-005) | **REAL.** A child process on the Node runtime: `forge build`, then `node $HOOKRISK_HOME/cli/dist/cli.js init` and `scan <File.sol>:<Contract> --out <job dir>`. `spawn` without a shell, so an explorer-supplied contract name can never become a shell metacharacter | Needs foundry, slither and a built `hookrisk/cli/dist/cli.js` on the host (`make setup` inside `hookrisk/`, or the `WITH_HOOKRISK=1` image). **Exit 2 is a RESULT** (gate failed, report written), 10+ means it could not run |
| Job registry | `src/lib/tools/hookrisk/jobs.ts` (PP-TOOLS-LIB-005) | **REAL, and in process memory.** One running job per `(chainId, address)`; a second start joins it. Reports are cached on disk for 24 h under `$HOOKRISK_WORK_DIR/hookrisk/<sha256>/`, swept by each request rather than by a cron | **PP-INTEGRATION-POINT:** the registry is per replica and per restart, so a second instance does not see the first's running job. The disk cache is what actually survives, so the worst case is a wasted rerun. A durable queue replaces it if this leaves hackathon scope |


### Review form cards (POO-2188, RB1)

The props-only PP-MGR-CMP-073..076 cards add no service or wallet calls. Their parent
supplies `useV2ReviewDraft` values, validated cropped-logo upload, hub USDC balance and
`feeConfiguration`. `reviewForm` reuses the existing `rawUsdc` contract, and the deposit
card displays the supplied `previewSeed` result. The protocol rate is explicitly estimated
when its source is fallback. RB2 owns the connected seam and launch-entry analytics.


### Review assembly (POO-2195, RB2)

PP-MGR-CMP-077 connects the existing `useV2ReviewDraft`, read-only `useV2LaunchStatus`,
and `startFundLaunch` seams. It never reconstructs launch transactions or writes a journal.
The mock branch does not mount Privy hooks or substitute fixtures into real Review.
`getLaunchSteps` remains the source of the grouped signature preview.
| Uniswap v4 pool panel defaults | `src/features/manager/fund/build/panel/PoolBlockPanel.tsx` | Mount read through `getCatalogPoolsAction`, MCK-005 in mock mode; missing, unread or ineligible rows disable Use. `usePanelPool` gates positive-allocation Apply on the latest live read. POO-2204 skips range reads and swap/open execution at zero allocation, preserving the mandate pool for later use. POO-2189 and POO-2204 @rules-v1. |
## Aave Supply configuration (POO-2194, rules v1)

`SupplyBlockPanel.tsx` reads `usePanelReserves` against the shell's catalog, sourced from
`GET /api/v2/catalog/aave-v3/reserves`. Network, mandate tokens and selected reserves intersect
before rendering. Only USDC on Arbitrum is executable in the alpha; other rows remain disabled.
`assetKey` is canonical and APY is the served snapshot. Catalog loading/error or an unusable
selection prevents Use/Apply. There is no second fetch, fixture fallback in real mode, automatic
reserve refresh or USDC-to-USDC swap. Token logos use the shared resolver; the shell draws network
and protocol logos. Shared shell analytics cover this body without duplicate emitters.

## Investor V2 presentation and transaction-host boundary (POO-2214/2217)

`InvestModal` PP-STR-MOD-001 accepts a separate V2 fund identity; it never passes that identity to the V1 Strategy schema, Permit2 steps or mock settlement. POO-2248 now connects shared amount/provisioning components to `useFundInvest` (PP-STR-HOK-023). After funding, the original raw6 budget is freshly prepared against the verified session/core on Arbitrum. Exact-budget approval is reviewed separately; deposit review requires all five preview fields and confirmation rebuilds with the reviewed raw18 shares as `minShares`. Pending/unknown transaction journals prevent resubmission on remount. A confirmed receipt is displayed without treating simulation amounts as executed amounts. Payout/income and unavailable metrics remain POO-2219. `investContext` PP-DEP-LIB-003 preserves V2 core/account/origin/from and validates return identity; the deposit route does not look up V2 core addresses in the V1 catalogue. See [delivery plan](investor/V2_DELIVERY_PLAN.md).

Investor list reads (POO-2215) use the existing discovered-funds/holder service with bounded detail enrichment. `nextBlock` remains output-only. Portfolio totals stay unavailable without discovery completeness. Investor Details (POO-2216) splits public fund and session-verified holder outcomes; the existing ERC20 reader obtains only hub USDC on chain 42161 for the verified account, with null on failure. Family/core/account guards suppress stale data. Available mandate tokens/protocols/chains are projected from typed fields, not guessed from position names.

## Investor composition and local Follow (POO-2223)

`FundComposition` (PP-STR-CMP-040) consumes the existing public `positionsSummary`, preserving supplied 0-100 NAV weights and unknown coverage. No new endpoint. Historical share-price samples remain absent (POO-2219), so the history slot uses the Figma no-history state. `LocalManagerFollow` now accepts controlled state for the two responsive Details mounts; it remains local and makes no API call or follower-count claim. A future persistent relationship service must replace this state explicitly.

## Manager Manage V2 (POO-2226/2227/2228)

`manageActions` (PP-MGR-LIB-056) verifies the server session against `users/me`, fund manager, core and exact chain/vault/position identity. Fund loading is independent of holder/transit reads; optional balance failures are isolated. `useManagePosition` keeps last good same-position metadata for display, disables actions during stale/error reads and ignores obsolete responses.

`ManageEntry` mounts PP-MGR-SCR-004 only for V2 and the connected verified owner. Identity changes discard old authorization/preview state. `ManageBlockPanel` uses served canonical Uniswap V4 ticks plus the existing live pool catalog. Review rereads metadata and invalidates mismatched baselines; it returns unavailable capability details only. No transaction builder or signature path is exported by this integration.

Missing Move budget/cost/impact and continuation: POO-2229. Missing chain cash split, withdrawal queue and actual hub USDC Income: POO-2230. Missing persisted future-deposit policy, allocation executor and position lineage: POO-2231. Current holdings are never substituted for post-close budgets; collection-round heldDollars is never substituted for total Income. See [implementation and acceptance plan](manager-manage-v2-implementation-2026-10-04.md).

POO-2232 reuses the authorized `positionsSummary.positions[].uniswap.inRange` read for a current open liquidity position, bound to core + chainId + positionKey. No new endpoint, RPC, mock seam or calculation was added. Missing metadata, closed and unsupported positions normalize to unavailable. Editing range presets or future policy never changes this status.

## Build auxiliary configuration, 2026-10-05

POO-2237 introduces no endpoint or wallet operation. Manual Swap tokens are canonical references from the explicit mandate list on the block network; configuration persists in the existing draft store. No unrestricted-token flag exists in the current draft shape. Spoke percentage reuses the plan reducer with root/network ceilings and the existing child floor. Manual Swap is explicitly unavailable in both Review and launch compilation, including inside pool chains; executable wiring is tracked by [POO-2238](https://linear.app/yeildbay/issue/POO-2238). Backend quote delivery POO-2148 is already Done and is not reopened here.

## Manager Manage refinements, 2026-10-06 (POO-2246 v2)

`manageModel.ts` accepts configured stable metadata only for the actual mandate address on that chain. Unknown metadata requires a served identity under POO-2230. Native Operating cash remains unavailable until an authoritative native balance is supplied; the scalar accounting bucket is not a token balance. `ManageBlockPanel.tsx` times out review preparation without manufacturing an execution result. POO-2229 and POO-2231 remain the write-enablement dependencies.

## Manager Overview V2, 2026-10-06

- PP-MGR-SCR-001: `ManagerOverviewV2.tsx` consumes existing `loadFundsAction("manager")`, checks the returned wallet and scopes late responses. This is discovery, not authoritative readiness/history/AUM. POO-2247 owns the missing aggregate and coverage contract.
- PP-MGR-HOK-023 / PP-MGR-STO-001 / PP-MGR-LIB-045: explicit local draft/journey read statuses preserve recoverable records. Drafts are device-local; no wallet ownership or backend persistence is asserted.
- `actions.ts:getManagerProfileAction` and `OverviewProfile.tsx`: read the existing public manager registry independently of V1 financials. Reuse ManagerProfileTabView and existing signed-save/upload flow.
- AUM values and 30-point series in `src/mocks/data/managerOverviewV2.ts` are explicitly mock/demo-only. Production has no fixture fallback.

## Manager canvas and inline panels plan, 2026-10-07

[Delivery plan](manager-canvas-panels-plan-2026-10-07.md), POO-2270..2279. No integration or runtime code is added by this planning entry.

- POO-2276 reuses `loadManagePositionAction` and ordered `uncollectedIncome.amount0/amount1` for real Collect details. Principal holdings and absent USD are not fee substitutes.
- API source main `06a03b046ecba22204e44b201adb9e06a36a21f6` already has `positions/build` action `collect-income`, a simulated origin `vault.collectIncome(adapter, positionKey)` transaction. POO-2277 extends its preview/capability/costs/freshness/expiry/operation/recovery contract; POO-2278 adds frontend integration only after the corresponding gate is complete.
- Collect does not atomically build Swap/Bridge or prove hub Income settlement. Existing swap, Income-return, history and transit reads are separate capabilities; generic `send-to-hub` is Principal. Typed correlation, token/chain/class/cohort compatibility and deployed evidence are required for continuation.
- POO-2230 remains the authoritative physical native cash, eligible queue/reservation deadlines/timezone/asOf and aggregate current hub Income dependency. POO-2275 may first deliver an inline presenter with real Not available, never guessed daily reserves or fixture values.
- POO-2279 owns Charts/Activity readiness. Activity can reuse `readFundHistory` with authorized Manage access and indexing/pagination; a current snapshot is not a chart history source. Functional tabs wait for content/sidebar/data definitions.
- Return Bridges are explanatory noninteractive graph nodes. They do not add a wallet operation, provider/ETA, token relabel, atomicity or settlement guarantee. Existing Move/future-policy gates remain POO-2229/2231.

## V2 Review transaction fees, 2026-10-07 (POO-2289 v1)

PP-MGR-CMP-090 `ReviewTransactionFeesCard.tsx` shows Entry fee and Exit fee as Not available. Their authoritative meaning, units, beneficiary, trigger, calculation base and fee provenance are not supplied to this card. The existing manager fees, instant withdrawal fee and protocol flow fee are separate; none is used as a fallback. The seam is informational and adds no API call, wallet operation, mock amount or launch gate. Real fee values and disclosures require a separately defined read contract and compliance answers before activation. PP-MGR-CMP-077 ReviewPhase mounts it after Your fees and before Investor terms; existing validation, Review events and provisioning remain unchanged.

## Manager per-area plan revision, 2026-10-07 (PP-MGR-DOC-001 v2)

The current [plan v2](manager-canvas-panels-plan-2026-10-07.md) preserves the preceding source evidence and separates ready visual work from real enablement. POO-2270/2271/2273 adopt stable graph ports and one shared outbound Bridge with distinct Principal/Income origins; local Arbitrum has no artificial Bridge. POO-2288 adds an optional semantic contract/validator and real graph consumer, without claiming old layout routing is corrected.

POO-2290 requires an authorized account/obligation risk source and separate After simulation: a Supply row cannot prove zero debt. POO-2289 shows unavailable Entry/Exit fees without substituting manager fees, flow charge or instant withdrawal fee. POO-2291 extends the existing local Solana editor; canceled POO-2282 grants do not block that scope. Solana mint/program identity, native SOL versus WSOL, real custody/market/discovery/execution remain explicit POO-2239/2240/2261/2262 boundaries.

Charts screenshots are Market reference, not AUM/pool execution or LP valuation. Exact feed/history/license/engine and protected annotations remain POO-2279 readiness. Jev Gateway is isolated optional development tooling; it adds no frontend/API/RPC integration, and measured pilot results do not justify global enablement.

## Manager semantic graph foundation, 2026-10-07 (POO-2288 v1)

`semanticGraph.ts` (PP-MGR-LIB-062) is a pure typed contract and deterministic validator.
`GraphLayout.semantic` lets the existing `graphModel` edge/hover consumers read explicitly
owned financial routes resolved against current outer rects. No endpoint, RPC, service,
wallet call or new mock seam is introduced. Current layout producers retain their existing
paths; adopting the contract and verifying the complete principal/income routes remains
POO-2270/2271/2273. The validator proves declared graph integrity only. It does not prove
execution capability, quote correctness, Bridge settlement or authoritative data coverage.

## Solana local catalog contracts, October 7, 2026 (POO-2291 S1)

PP-MGR-LIB-063/064 are pure local schemas/descriptors. The two marked seams in solanaCatalog bind discovery/read models (POO-2239/2240) and Jupiter quote/transaction validity/executor (POO-2261/2262). No network call, program deployment, wallet read or signer is added. Canonical USDC/WSOL mint metadata is cited from official Jupiter documentation in the schema header.

The local catalog rejects both fixture and observed values in financial/capability fields. Generic read models may represent declared provenance, but cannot attest external ownership or freshness. Confirmed zero is explicit; missing remains unavailable. Holding stays contract-only; all six POO-2291 slices are not complete.

## Manage inline identity header, October 7, 2026 (POO-2272 v2)

PP-MGR-CMP-091 consumes the canonical ManagePosition already selected by the host and optional display pair context. It performs no read, write, mock call or transaction. Current position/network provenance and the existing authorized Manage seams are unchanged. This header slice does not enable Move, Collect or future-policy persistence.

## Manage measured routing, POO-2270/2271 v2

PP-MGR-LIB-052 now resolves measured node rectangles and stable principal/Income ports through PP-MGR-LIB-062. Runtime Manage liquidity/supply/unsupported positions render compact native cash, gray position-origin returns, Collect -> Swap -> Income and one inbound/shared outbound Bridge per actual spoke. Complete-route hover uses visible legs; internal Bridge transition segments are semantic-only. No new API, wallet or mock seam is introduced. Authoritative native quantity/valuation, queue/reserves and hub Income remain POO-2230; `valueUsd` is an optional independent display read and normalization does not synthesize it. Known native amount and available valuation are required together. Build adoption, Holding/debt and all-node panel selection remain separate.

## Manage viewport chrome, POO-2272 v2

PP-MGR-CMP-046 accepts an optional decorative overlay outside the transformed graph. PP-MGR-CMP-085 supplies the existing authorized model's Hub identity. PP-MGR-CMP-053's Manage chip and PP-MGR-CMP-050's auto lock are opt-in presentation; default Build behavior and current data/operation seams stay unchanged. These pieces introduce no network, wallet, mock, custody or financial read. POO-2274 separately makes every actual node inspectable and preserves drafts; a structural lock does not prove execution or settlement.

### Manage review visibility, POO-2274 v2

Existing authorized position and pool reads stay active after first inspection of an origin. Visibility no longer restarts the read or invalidates its review. Same-origin retained display metadata is not fresh execution evidence; actual failures and material snapshots invalidate review. No new API, wallet or mock seam is introduced.

### Collect fees read presenter, POO-2276 v1

ManageCollectFeesPanel accepts an injected authorized position read with explicit freshness. It displays only ordered uncollectedIncome.amount0/amount1 after canonical origin, token address/decimals/currency order and exact raw-decimal consistency validation. Current position DTO lacks authoritative freshness evidence, so the eventual live host must pass unknown, not infer fresh from a completed request. Unknown freshness is generic unavailable; stale copy requires explicit stale evidence. The presenter is mounted through the POO-2274 authorized host, which reads the exact position with freshness unknown. The presenter itself never reads, signs or collects. POO-2277/2278 own preview, costs, signing and recovery; swap/transit/hub Income settlement remains separate.


### Idle output injected queue presenter, POO-2275 v1

PP-MGR-LIB-066 / PP-MGR-CMP-093 consume a presentation-only contract with canonical core/hub token, source timezone/asOf, freshness and independent cohort quantities. POO-2230 must confirm the real API shape before a host maps it. Missing/unknown/stale states never expose cached amounts; authoritative zero and complete empty confirmation stay distinct. The summary is supplied, never summed from buckets, and reserved/requested coverage requires the same cohort. No cutoff, allocation, reserve assignment or USD total is inferred. Duplicate bucket identity suppresses unreliable groups while preserving independent summary; fractional deadlines retain their supplied precision. The presenter is mounted through the POO-2274 authorized host with unavailable queue data. Retry/Back are host callbacks and cannot reserve or sign.

### Build return topology, POO-2273 v2

PP-MGR-LIB-023 uses PP-MGR-LIB-062 to declare stable typed financial endpoints after node placement. PP-MGR-CMP-059 renders visible route legs with complete-origin hover through PP-MGR-CMP-054; internal Bridge transitions are unpainted. This is pure layout/rendering with no new API, mock, wallet or settlement seam. Shared directed return Bridge ports preserve principal/Income classes and origin identity; graph convergence proves no token conversion, cohort compatibility or arrival. Existing gates remain unchanged. Build has no Operating cash state or explicit debt-step model; these are separate follow-up boundaries, not inferred from Figma.

## Manage all-node host, October 7, 2026 (POO-2274 v2)

`ManageEntry` mounts PP-MGR-CMP-092/093 via the existing authorized owner/core boundary. `ManageBlockPanel` uses useManagePosition for the exact LP Collect origin, keeping freshness unknown because the existing DTO supplies no authoritative freshness evidence. The manual Collect action stays disabled (POO-2277/2278). The global eligible queue, cohorts, reserves, deadlines/timezone and freshness remain POO-2230; its Retry callback reports unavailable intent rather than reloading the whole editor. Generic cash/Idle/Income inspectors reuse normalizeManageModel only and do not add a production source or infer zero. Selection IDs confer no execution authority.


## Account risk Current/After, POO-2290 v1

PP-MGR-LIB-068 / PP-MGR-CMP-094 accept presentation-only full-account identity and supplied risk/context/provenance. These are not an assumed Aave/Kamino RPC or API DTO. Aave requires effective collateral thresholds and supplied metrics without a Kamino borrow-factor requirement; Kamino debt factors remain required. A scenario may identify a collateral or debt asset. Current/After values and source precision are retained without frontend financial arithmetic.

PP-MGR-CMP-086 Aave and PP-MGR-CMP-089 Kamino pass null account identity and unavailable reads. POO-2290 must supply canonical authorized core/account/market or cluster/program/account/market/obligation, complete fresh debt/asset/oracle/parameter snapshot and a successful preview tied to the base. No position metadata, absent Borrow block or local fixture implies no debt. Known zero requires fresh complete evidence. No execution or borrowing adapter is introduced.
