# Fund Review data and launch journey

## Slice E contracts (POO-2181, rules v2)

- Public index additionally exports `validateLogo`, `rawUsdc` and `previewSeed` unchanged from `review.ts`.
- `useV2LaunchStatus(draftId)` reads the connected wallet's persisted journey without signing, RPC/balance reads or new storage. It returns `{ journeyId, status, current, outcome } | null`. Status is `paused`, `failed` or `complete`; outcome is `in-progress`, `failed` or `completed`. `current` is the first unconfirmed launch step, or null. Draft/wallet switches hide stale status immediately.
- Pure browser read `getLaunchStatusForDraft(draftId, manager)` requires an explicit wallet to avoid exposing another wallet's stored journey. Missing wallet returns null. Same-tab journal, cross-tab storage and focus events update Review and the Manager Console.
- Status also discovers valid standalone wallet-scoped frozen journals without creating journey metadata or reading catalog/balance data. Explicit Resume navigation reconstructs missing metadata only after the connected wallet matches the encoded journey manager, using the existing mandate draft with frozen plan/Review restored. Journal bytes, checkpoints and hashes remain untouched; malformed journals or frozen data fail closed.
- Launch owns `builder_launch_signature` (`chain_id`, `step_kind`), `builder_launch_completed` and `builder_launch_failed` (`step_kind`, sanitized `error_code`, `error_origin`). Review alone owns its launch-click event. No raw addresses, hashes, draft IDs or amounts are tracked; completion is persisted once, including resume.
- POO-2201 integration audit: applied panel config wins over stale execution overrides; canonical ticks discard legacy price bounds and panel slippage 0.1..5% maps to 10..500 bps. Public preview checks saved pool spacing; fresh catalog checks still run before create and open, including exact finite Full extremes. Zero leaf shares fail before any transaction build.
- Fresh launch and unfrozen legacy recovery require the Limits amendment's additional positively permitted token, and validate the existing provisioning request shape before freezing. Frozen journals bypass edited-draft validation, recover missing journey metadata from frozen plan/Review, and both Review entry points link to existing wallet-scoped journeys. Fallback preserves applied shares and idle hub capital; a selected empty 0% spoke does not bridge its mandate cap.
- Catalog tick spacing is verified before launch entry, before create and before v4 swap/open. Unaligned or invalid finite endpoints fail closed with `BUILD_TICK_ALIGNMENT`; full range uses aligned finite extremes. Legacy price-only ranges remain accepted.
- Manager Console journeys reuse `pp:v2:journey:1:*` and existing checkpoint journals; no cross-device storage is claimed. Incomplete launches resume the existing journey screen. Discovery still comes only from slice B's existing discover step.

## Public seam (agreed October 4, 2026)

Import from `src/features/manager/fund/launch/index.ts`:

```ts
startFundLaunch(draft: FundLaunchDraft): Promise<{ journeyId: string }>;
getLaunchSteps(draft: FundLaunchDraft): LaunchStepPreview[];
useV2ReviewDraft(draftId: string);
useV2Launch(journeyId: string);
FundLaunchJourney({ journeyId: string });
explorerTxUrl(chainId: number, hash: string): string | null;
explorerAddressUrl(chainId: number, address: string): string | null;
```

Types exported there:
- `FundLaunchDraft`: Mandate draft plus required `plan: CanvasPlan`, `review: ReviewDraft` and optional `launchExecution` adapter configuration.
- `ReviewDraft`: name, description, imageUrl, performanceFeeBps, managementFeeBps, payoutFeeBps, minimum, seed. Amounts are human USDC strings; fees are integer basis points.
- `LaunchStepPreview`: id, chainId, kind, label (full i18n key), signer (`manager-wallet` / `manager-message` / `server`), countsAsSignature.
- `LaunchJourney`: version, journeyId, draftId, manager, createdAt, frozen draft and latest checkpoint journal.

`useV2ReviewDraft(draftId)` returns `{ review, setField, errors, launchBlockers, isReady }`, plus setFeePercent, setMax, preview, terms, feeConfiguration, uploadLogo/upload state, draft, manager, balanceDecimal, refreshBalance and preparation. Every setter persists `MandateDraft.review` beside the Build plan, rereading the latest draft so canvas updates are preserved. Errors identify fields; launchBlockers provides code, optional field and relative manager message key (`fundLaunch.*` or the existing Limits guidance). POO-2172 keeps Launch enabled to scroll to these reasons, not an unexplained disabled state. Uploading blocks readiness. Flow fee comes from an existing fund's `fees.flowFeeBps` when available; otherwise feeConfiguration labels its 25 bps fallback. Default payout is 200 bps until explicitly configured. The page must label fallbacks and seed previews as estimates. Operating Cash is fixed zero; access public and payout term 72h are fixed.

`getLaunchSteps` is pure and may throw a Build readiness error. Approval/swap descriptors are conditional maxima, not a promise every listed signature is needed. Server reads/waits never count as signatures. No Base step exists.

`startFundLaunch` is the only Review Launch entry point. It validates a fresh draft against real balance/catalog, freezes it under the cross-tab lock, reuses an existing journal/journey and navigates to `/<locale>/manager/fund-launch/<journeyId>`. It never signs on entry. Resume uses the frozen request, never edits a known creation into another fund.

Journey persistence keeps the raw `<lowercase-manager>:<draft-id>` identity. `readJourney` accepts that identity or the once-percent-encoded route parameter emitted by Next, resolving both to the same stored journey and wallet-scoped checkpoint. Exact stored identities take precedence; malformed encoding fails closed and reads never create or replace a journal. POO-2191 fixes the encoded colon missing storage immediately after Launch for real Privy/injected wallets as well as the rehearsal wallet. Wallet matching remains case-insensitive and reconnect rehydrates the same checkpoint.

`useV2Launch(journeyId)` returns `{ steps, current, sign, retry, resume, cancel, outcome }`, plus journal, addresses, readiness, busy and safe errors. Steps expose status, txHash, explorerUrl, receiptStatus, error and off-chain result. Sign advances at most one ready step; retry/resume reconcile and continue until waiting/failure/completion. Cancel pauses future work, not already broadcast transactions. Hydration never signs. Outcome is in-progress / failed / completed. The original wallet must connect. Mount wallet hooks only inside real Privy/wagmi providers; the Journey component guards mock mode.

POO-2177, rules v1: Murilo owns Review PAGE (POO-2172), Mandate/Build pages and visual polish. This slice owns Review DATA, API access, launch execution and the Journey screen/outcomes. No builder page or shell is changed. Existing fundContracts feature flag applies. Mock mode never signs.

## Build adapter and dependencies

- Read-only structural adapter for `src/features/manager/fund/build/plan/buildPlan.ts` on `origin/feat/mgr-poo-2144-canvas-integration` (roll-up of PR #31 / POO-2151). No competing reducer/store and no canvas edits.
- V4 needs canonical tickLower/tickUpper or human token1/token0 priceLower/priceUpper, and maxLossBps 1..500. Flat panel slippagePct maps to bps. Display inversion does not invert canonical execution values. Optional `draft.launchExecution[blockId]` supplies these fields until POO-2171 panels do. Full-range flags without canonical ticks, empty/untyped config and Aave Borrow fail closed.
- Multiple positions drawn serially require explicit leafSharePct for independent leaves; Aave is always a parallel leaf, never the funding source for a later pool. Spoke child root percentages normalize to group percentages of actual destination credit.
- API #180 is merged (October 3 UTC / October 4 Lisbon): build-create payoutFeeBps, transits and spoke balances. Deployment must include it. API #181 adds fund detail fees; absence remains visibly labelled fallback. Existing saved drafts have no invented ranges.

## Safety and recovery

POO-2200 rules v1 (R6-R8): `V2_DISCOVERY_PENDING` is a normal indexing wait. Launch/catalog
transports retain safe `retryAfterSeconds` and `progress.cursor/target` metadata through server
actions, including the nested API `response` envelope and numeric `Retry-After` header.
Retry checkpoints persist a not-before timestamp and use bounded exponential backoff without
server timing. Real errors remain failures. Background reconciliation never signs or broadcasts,
honors Pause, and continues submitted/unknown receipt polling despite failed independent siblings.

A mined open is confirmed only once the manager-authorized positions read contains its receipt's
`positionKey` on the same chain. Positions are read directly, without requiring pool registration,
positive USD value, or complete optional portfolio fields. Missing positions wait and retry the
same transaction; they never rebuild or rebroadcast. Bridges also guard old persisted journals
against proceeding while any hub swap/open leaf is unconfirmed.

Per-draft/per-manager journal stores frozen Review/request, step IDs, chains, hashes, receipt states, discovered data, net principal and actual arrival. Successful or uncertain creation is never rebuilt. Reconcile the same hash first; unknown receipts wait. No-hash wallet submission requires operator reconciliation, not a second send. Checkpoints persist before signing. Profile is reconciled before signing a canonical EIP-191 nonce.

Creation includes seed atomically. Actual FundSeeded shares define deployable principal. At the labelled 25 bps fallback, gross 100 USDC estimates 99 whole shares, 99 USDC principal, 0.25 USDC fee and 0.75 USDC wallet remainder. Actual receipt is authoritative.

Builders execute just in time. Swap/open reread unallocated balances; Decimal range composition honors token decimals and loss bound. Hub allocation is aggregate. Bridge quote refreshes before send; transits prove credited arrival before spoke work. Reports observe explicit null or validated accepted report data, not admin job states or invented countdowns. TVL/APR null stays unavailable.

POO-2208 (rules v1): Aave supply and nonzero v4 swap inputs clamp to the live base-token remainder only when its shortfall is within `max(maxLossBps ?? 100, 100)`, capped at 500 bps. Exact integer comparisons preserve the boundary; zero balances and larger shortfalls still fail with `BALANCE_CHANGED`. V4 open composition already scales both legs to actual balances, and its zero-leg guard remains fail-closed. Failed builds store no amount or transaction in the journal: Retry rebuilds against fresh balances while confirmed siblings remain skipped. No journal/checkpoint migration is needed.

POO-2211 (rules v1): hub leaf budgets derive from mined `AllocatedToHubSpokeVault.amount` multiplied by the leaf's relative hub share. An allocation inconsistent with the frozen plan fails closed, rather than silently resizing the plan. Seed principal uses `FundSeeded.usdcAmount`, the capital actually credited, not an inferred dollar value of shares. Required legacy confirmed allocations and swaps with transaction hashes rehydrate missing receipt fields through read-only wallet receipt lookup, including emitter provenance. Receipt hashes must match the requested hash; allocation emitters must be the journal core and conversion emitters the selected spoke vault. Unconfirmed siblings retain their base-token budget less their own mined conversion spend; their known conversion output is also reserved. Each v4 open caps its base input by its budget minus its mined swap input, so a changed range split cannot borrow sibling cash. Confirmed conversions do not repeat on retry. A confirmed swap with missing evidence fails closed; zero-swap completion explicitly records `swapSkipped`. No recovery tolerance widening, auto-skip, signing, broadcasting or deployment is introduced. Pre-existing non-base inventory lacks durable leaf attribution, and restored browser graph integrity is not fully checked against the original frozen plan; this patch does not claim complete inventory or journal-integrity isolation.

### October 4 live incident: evidence contradicts over-consumption

At 13:03:45 UTC, block 511620095, core `0x84acFC311385466CCC2eA0A5A72F25ECC5270207` had 1.500000 idle USDC. Hub `0x8c0858fa93545A5E14BDee74b0c9aAb033f88756` had 0.399931 unallocated USDC and 0.000000026268435201 WETH. The create transaction requested **3.000000** USDC, charged 2.007500, paid a 0.007500 flow fee and credited 2.000000 principal; whole-share rounding left 0.992500 in the payer wallet. This was not a 2-USDC requested seed.

| Step (UTC) | Transaction | USDC before / after (hub) | WETH before / after (raw) | Authoritative amounts |
| --- | --- | --- | --- | --- |
| Seed 11:59:52 | `0x92c7c035bcd78cfdf66989e5aa3c6033404830081fc9bc88de632a5aa0b101f6` | 0 / 0 | 0 / 0 | Core net principal 2000000; fee 7500 |
| Allocate 12:01:18 | `0x2738f9356caf5d6765b757cd4c372ee9edab2d4b49dea2573dc3a73508438aef` | 0 / 0.500000 | 0 / 0 | Only allocation: 500000 |
| Swap 12:01:33 | `0x0b96330c5f49f2abc050208208b9b8ea7f6d334c1b76104adfdbf20c832b1527` | 0.500000 / 0.452362 | 0 / 17635116476090 | Input 47638 USDC raw; output 17635116476090 WETH raw |
| Open 12:40:01 | `0xf05b03b6edf0109b9ee50abb2e24b617c8cea5dc1d892cae874f7d868552f93c` | 0.452362 / 0.399931 | 17635116476090 / 26268435201 | Used WETH 17608848040889; USDC 52431; liquidity 19631394724; NFT 213278 |

Pool `0xfc7b3ad139daaf1e9c3637ed921c154d1b04286f8a82b805a6c352da57028653` is WETH token0 (18 decimals), USDC token1 (6), fee 500, spacing 10, hookless. Ticks -198360 / -196350 imply 2430.8903048091282472 / 2972.0368371156287845 USDC per WETH. Exact pool prices were 2700.9942459222732204 at swap and 2701.3832415934247232 at open. Current local `positionAmounts` with budget **100000** reproduces swapRaw **47638** and open caps **17608980636445 WETH / 52431 USDC** exactly. A 600000 budget instead predicts swapRaw 285830 and open caps 17635116476090 / 52509, not the observed calls. The open refunds 132595556 WETH raw; its total USDC outflow with the swap is **100069**, not 800069. The 69-unit overrun of a nominal 100000 reservation is a real, small price-split change that the new base-spend cap prevents; it does not explain a 200069 shortfall against a later 600000 Aave target.

The original browser frozen journal and the executed frontend build are unavailable to this reconstruction. Therefore the exact origin of the allocation/leaf-budget mismatch cannot be proved. The driver previously trusted `journal.principal * step.sharePct / 100` without comparing the actual allocated amount; neither whole-hub swap sizing nor a full-balance deposit explains these receipts. Do not rewrite the live plan or claim that 0.1 Uniswap / 0.4 Aave was the original intent. Archive balances, receipt events and complete indexed hub token transfers cross-check the amounts; the provider does not support full transaction traces. The current factory ABI differs from the deployed create ABI; requested seed was decoded from its HubParams slice, without claiming bytecode equivalence.

Recovery is decision-only, not implemented:

1. Supply 0.399931 USDC to Aave explicitly: 200069 raw (33.3448%) below the stated 600000 budget, so POO-2208 correctly rejects it. A one-leaf opt-in cap with explicit underfunded-plan acknowledgement and tests would need approximately 30-60 lines plus locale/UI work; a global tolerance increase is unsafe. The chain fund can remain internally consistent if the API simulates the explicit amount, but actual allocation must be disclosed rather than represented as the frozen plan. No automatic plan normalization.
2. Skip Aave explicitly: requires a durable skipped status plus dependency/bridge-gate handling, acknowledgement and tests (roughly 100-200 lines plus translations), not a trivial checkpoint edit. Report observation can continue read-only already, but bridge execution intentionally waits for every hub swap/open. The omitted exposure and unallocated cash must remain visible. Do not mark an unexecuted leaf confirmed.
3. Abandon this journey and launch a new correctly funded plan after Deploy 3: no recovery code diff. Existing fund and NFT remain live; abandonment is not an unwind or refund. Any close/unwind is a separate manager-approved action and costs gas. If the desired live plan remains 0.6 Uniswap / 0.6 Aave, funding/rebalancing from the 1.5 core idle is another explicit manager decision, not part of this patch.

Journey displays every broadcast hash immediately and receipt status afterward. Arbitrum uses arbiscan.io; Robinhood uses robinhoodchain.blockscout.com. Created/discovered contracts use same-chain address links. Off-chain profile/discover results never masquerade as transactions.

## Server boundary and lower-level bindings

New `src/lib/api/v2/launch.ts`, `launchSchemas.ts`, `launchActions.ts` leave shared client/actions/schemas untouched. Actions cover build-create/build-spoke, discover, canonical profile GET/PUT, generic capital and positions/build, unsigned swap/bridge quotes, privileged signed swaps, balances/transits, reports/job reads. Return `{ ok: true, data }` or `{ ok: false, error: { status, code } }`; raw upstream messages never reach clients.

Actions verify bearer session via authenticated users/me with no caching/public-profile fallback, then compare verified wallet to on-chain manager. API guards require PP_API_KEY as x-api-key AND PP_API_ADMIN_KEY as x-admin-key on privileged routes. Neither key is public-prefixed. Report triggers have bounded process-local per-wallet/core throttling; multi-replica upstream throttling remains necessary. Signed swap maxLossBps is always 1..500.

`useV2ReviewBinding({draft,catalog,balance,initial?,upload?,flowFeeBps?})` and `useV2LaunchBinding({draftId,manager,wallet,plan,execution,spoke,prepare?,frozen?,storage?,pollInterval?})` are injectable lower-level implementation/test bindings, not the agreed page seam. `useV2LaunchWallet()` binds Privy/wagmi, chain proof, receipts and hub balance. No signatures on mount. Logo upload reuses useUploadMedia("logo"), wallet-scoped presigned S3 POST without a v1 strategy UUID; deployment needs media/session/CORS configuration.

## Known gaps and validation

- Accepted reports are observed through the manager-authenticated fund detail read, not an admin report trigger. A null report stays waiting, with a 14-19 minute typical finalized-report estimate and no journey deadline. Single-step actions poll the selected waiting step and stop before the next signature. Explicitly deferred reads and throttling wait; real API errors still fail and preserve Retry checkpoints. The enabled API keeper owns report publication and delivery.

- POO-2172 connects its Launch button; POO-2144/2171 supply typed panel configuration. Only our separate Journey route is installed.
- Non-base two-conversion pairs, non-base Aave assets and standalone manual swaps fail closed. No speculative routes.
- Journal is browser-local, not cross-device durable launch-plan. Web Locks guard duplicate tabs; unsupported browsers fail closed. Alpha reorg handling and cross-device coordination need the later API.
- Ambiguous no-hash submission has no transaction-history API for automatic resolution.
- Keeper funding is an environment gate; observed report/bridge timings are not SLAs. Fee decreases have no builder yet; show contract copy, no post-launch editor.
- Requested external SC spec directory was unavailable locally; API source/README and handoff analyses were read instead.
- Tests mock dev-host-only API, signatures and receipts. Review persistence, validation/math, graph shapes, partial failure/resume, strict payloads, canonical profile, admin redaction/rate limit and explorer wiring are covered. All 11 configured locales translate error/status/Journey keys. This development session never signs, broadcasts or deploys.

## Continuous prompts and visible controls (POO-2203, rules v1)

An explicit Sign next step starts the existing serial runner. It requests the next ready wallet signature after its prerequisites settle, including receipt/discovery/report waits. `next()` remains a one-step headless action. Pause, rejection, failures, unmount and manager changes stop continuation; reload reconciliation remains read-only and a confirmed or unresolved broadcast is never repeated.

Journey controls precede the step list in DOM/mobile order and sit in a sticky adjacent column on desktop. Signing controls disable while running and Pause stays reachable. Existing receipt, explorer, discovered-address and settlement analytics behavior is preserved. No new locale keys or API payloads are introduced. Focused regression coverage exercises serial prompts, receipts, double click, rejection/retry, pause/resume, wallet change/unmount and control accessibility. Murilo performs browser acceptance.
