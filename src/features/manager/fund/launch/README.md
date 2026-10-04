# Fund Review data and launch journey

## Slice E contracts (POO-2181, rules v2)

- Public index additionally exports `validateLogo`, `rawUsdc` and `previewSeed` unchanged from `review.ts`.
- `useV2LaunchStatus(draftId)` reads the connected wallet's persisted journey without signing, RPC/balance reads or new storage. It returns `{ journeyId, status, current, outcome } | null`. Status is `paused`, `failed` or `complete`; outcome is `in-progress`, `failed` or `completed`. `current` is the first unconfirmed launch step, or null. Draft/wallet switches hide stale status immediately.
- Pure browser read `getLaunchStatusForDraft(draftId, manager)` requires an explicit wallet to avoid exposing another wallet's stored journey. Missing wallet returns null. Same-tab journal, cross-tab storage and focus events update Review and the Manager Console.
- Launch owns `builder_launch_signature` (`chain_id`, `step_kind`), `builder_launch_completed` and `builder_launch_failed` (`step_kind`, sanitized `error_code`, `error_origin`). Review alone owns its launch-click event. No raw addresses, hashes, draft IDs or amounts are tracked; completion is persisted once, including resume.
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

`useV2ReviewDraft(draftId)` returns `{ review, setField, errors, launchBlockers, isReady }`, plus setFeePercent, setMax, preview, terms, feeConfiguration, uploadLogo/upload state, draft, manager, balanceDecimal, refreshBalance and preparation. Every setter persists `MandateDraft.review` beside the Build plan, rereading the latest draft so canvas updates are preserved. Errors identify fields; launchBlockers provides code, optional field and relative `fundLaunch.*` message key. POO-2172 keeps Launch enabled to scroll to these reasons, not an unexplained disabled state. Uploading blocks readiness. Flow fee comes from an existing fund's `fees.flowFeeBps` when available; otherwise feeConfiguration labels its 25 bps fallback. Default payout is 200 bps until explicitly configured. The page must label fallbacks and seed previews as estimates. Operating Cash is fixed zero; access public and payout term 72h are fixed.

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

Per-draft/per-manager journal stores frozen Review/request, step IDs, chains, hashes, receipt states, discovered data, net principal and actual arrival. Successful or uncertain creation is never rebuilt. Reconcile the same hash first; unknown receipts wait. No-hash wallet submission requires operator reconciliation, not a second send. Checkpoints persist before signing. Profile is reconciled before signing a canonical EIP-191 nonce.

Creation includes seed atomically. Actual FundSeeded shares define deployable principal. At the labelled 25 bps fallback, gross 100 USDC estimates 99 whole shares, 99 USDC principal, 0.25 USDC fee and 0.75 USDC wallet remainder. Actual receipt is authoritative.

Builders execute just in time. Swap/open reread unallocated balances; Decimal range composition honors token decimals and loss bound. Hub allocation is aggregate. Bridge quote refreshes before send; transits prove credited arrival before spoke work. Reports expose real pending/failed/expired waits, not invented countdowns. TVL/APR null stays unavailable.

Journey displays every broadcast hash immediately and receipt status afterward. Arbitrum uses arbiscan.io; Robinhood uses robinhoodchain.blockscout.com. Created/discovered contracts use same-chain address links. Off-chain profile/discover results never masquerade as transactions.

## Server boundary and lower-level bindings

New `src/lib/api/v2/launch.ts`, `launchSchemas.ts`, `launchActions.ts` leave shared client/actions/schemas untouched. Actions cover build-create/build-spoke, discover, canonical profile GET/PUT, generic capital and positions/build, unsigned swap/bridge quotes, privileged signed swaps, balances/transits, reports/job reads. Return `{ ok: true, data }` or `{ ok: false, error: { status, code } }`; raw upstream messages never reach clients.

Actions verify bearer session via authenticated users/me with no caching/public-profile fallback, then compare verified wallet to on-chain manager. API guards require PP_API_KEY as x-api-key AND PP_API_ADMIN_KEY as x-admin-key on privileged routes. Neither key is public-prefixed. Report triggers have bounded process-local per-wallet/core throttling; multi-replica upstream throttling remains necessary. Signed swap maxLossBps is always 1..500.

`useV2ReviewBinding({draft,catalog,balance,initial?,upload?,flowFeeBps?})` and `useV2LaunchBinding({draftId,manager,wallet,plan,execution,spoke,prepare?,frozen?,storage?,pollInterval?})` are injectable lower-level implementation/test bindings, not the agreed page seam. `useV2LaunchWallet()` binds Privy/wagmi, chain proof, receipts and hub balance. No signatures on mount. Logo upload reuses useUploadMedia("logo"), wallet-scoped presigned S3 POST without a v1 strategy UUID; deployment needs media/session/CORS configuration.

## Known gaps and validation

- POO-2172 connects its Launch button; POO-2144/2171 supply typed panel configuration. Only our separate Journey route is installed.
- Non-base two-conversion pairs, non-base Aave assets and standalone manual swaps fail closed. No speculative routes.
- Journal is browser-local, not cross-device durable launch-plan. Web Locks guard duplicate tabs; unsupported browsers fail closed. Alpha reorg handling and cross-device coordination need the later API.
- Ambiguous no-hash submission has no transaction-history API for automatic resolution.
- Keeper funding is an environment gate; observed report/bridge timings are not SLAs. Fee decreases have no builder yet; show contract copy, no post-launch editor.
- Requested external SC spec directory was unavailable locally; API source/README and handoff analyses were read instead.
- Tests mock dev-host-only API, signatures and receipts. Review persistence, validation/math, graph shapes, partial failure/resume, strict payloads, canonical profile, admin redaction/rate limit and explorer wiring are covered. All 11 configured locales translate error/status/Journey keys. This development session never signs, broadcasts or deploys.
