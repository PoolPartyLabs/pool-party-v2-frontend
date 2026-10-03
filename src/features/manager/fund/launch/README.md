# Fund Review and launch

POO-2177, rules v1. Integration only: Murilo owns the full Review page (POO-2172), Build canvas and visual layout. This slice supplies API access, execution and headless React contracts. No page or shell is changed. The existing `fundContracts` gate applies. Mock mode never signs.

## Integration

- `useV2Launch` reads the canvas owner's `draft.plan` (`BuildPlan` v1 from frontend PR #31, `feat/mgr-poo-2151-build-plan-model`, `src/features/manager/fund/build/plan/buildPlan.ts`). `CanvasPlan` is a structural read adapter, not a competing store or reducer. Until that model lands, launch reports an execution gap without guessing trades.
- `draft.launchExecution[blockId]` is an owned extension adapter: v4 requires `priceLower`, `priceUpper` (human token1/token0) and `maxLossBps` (1..500). Serial drawings with multiple positions require `leafSharePct` for each independent leaf. Configuration panels currently persist only `poolId`/`assetKey`; their owner must supply these missing fields. They are not added to canvas files here.
- Canvas spoke child percentages are percentages of root principal. The adapter divides each child by the group's root share, then applies that fraction to actual net destination credit. Aave is always an independent leaf, never the funding source of a later pool.
- API PR #180 (`uBits-Capital/pool-party-api`, `feat/be-poo-2174-v2-launch-support`) supplies configurable `payoutFeeBps`, transits and spoke balances. If unavailable, launch fails visibly, never falls back to mock calldata.

## Safety and recovery

The per-draft, per-manager journal stores the frozen Review/request, derived steps, transaction hashes, receipt statuses and discovered core. Successful or uncertain creation is never rebuilt. Reconcile the same hash first; unknown receipts wait. A wallet submission with no known hash requires reconciliation, not an automatic second send. Checkpoints are written before each signing operation. Profile is reconciled before signing a fresh canonical nonce.

Creation is atomic with seed. Actual `FundSeeded.shares` defines the deployable net principal. Gross 100 USDC at 25 bps previews 99 whole shares, 99 USDC deployable principal, 0.25 USDC fee and 0.75 USDC remaining in the wallet. No fractional-share promise is made.

Builds happen just in time. Swap/open reread actual unallocated balances; range-derived composition uses Decimal and token decimals. V4 minimum amounts reflect the chosen loss bound. Allocation is aggregate on the hub. Bridge quotes are refreshed before send; transit reads prove credit before spoke execution. Reports expose pending/failed/expired jobs, not invented countdowns. No TVL/APR values are fabricated.

API writes run in new server-only files, separate from the shared v2 read client. Server actions verify the bearer session against authenticated `users/me` without caching or public-profile fallback, then compare that verified wallet with the on-chain manager before privileged work. `PP_API_KEY` is sent as `x-api-key`; `PP_API_ADMIN_KEY` is sent as `x-admin-key`, as required by the actual API guards. Report triggers have bounded process-local per-wallet/core throttling; upstream throttling remains necessary across replicas. Keys and upstream messages never return to clients.

Logo upload reuses `useUploadMedia("logo")`, wallet-scoped presigned S3 POST, without a v1 strategy UUID. Deployment must provide media configuration, session authentication and CORS.

## Known limitations

- Page navigation and execution fields must be connected by POO-2172/POO-2144/POO-2171 owners. No new Review page or builder routing is installed here. Existing saved drafts have no invented ranges.
- Only base-token pairs from the supported catalog are executed. Two-conversion non-base pairs and standalone manual swaps fail closed.
- An ambiguous no-hash submission requires operator/wallet reconciliation; no transaction-history API exists to resolve it automatically.
- Journal storage is browser-local, not a cross-device durable API launch plan. Web Locks prevent two tabs from launching the same draft; unsupported browsers fail closed. Alpha reorg handling and cross-device coordination need the later durable API.
- Report wait observations (14..19 minutes) are not SLAs. Keeper/operator funding remains an environment gate.
- Fee decreases have no API builder; Review shows the contract fact, not an edit control.
- No deploy, signature or broadcast is performed by tests, build, or this development session.

## Validation

Focused tests cover Review bounds and deposit arithmetic, supported Build fixtures, partial failure and uncertain receipts, canonical profile serialization, real receipt decoding, strict transaction validation, headless bindings and admin-key redaction/rate limiting. All 11 configured locales carry only `manager.fundLaunch.*` error/status messages needed by these contracts. Visual components and stories are intentionally absent.

## Headless page contracts

`useV2ReviewDraft({ draft, catalog, balance, initial?, upload? })` returns `review`, typed `setField`, `setFeePercent`, `setMax`, `valid`, field `errors` (translation keys), `preview` (raw fee/principal/shares/remainder), fixed `terms`, `prepare(manager)`, and `uploadLogo`/upload state. Monetary fields remain human USDC strings until `prepare` creates raw API units; fees are integer bps. `setFeePercent` accepts at most two decimal places. `initial` seeds the local form on mount: the page should key its form by draft/wallet or remount with the saved journal's frozen Review. `prepare` must run at explicit launch, never on render. Logo staging uses the existing signature-free wallet-scoped media path.

`useV2LaunchWallet()` returns `{ manager, wallet, balance, balanceError, refreshBalance }`. It binds Privy, chain switching, real USDC reads and receipt lookup. Mount **only under real-mode Privy/wagmi providers** (the existing mock gate is the parent's responsibility). No wallet signature is requested on mount. The page may provide its own `LaunchWallet` instead.

`useV2Launch({ draftId, manager, wallet, plan: draft.plan, execution: draft.launchExecution, spoke, prepare, storage?, pollInterval? })` returns `{ steps, signatures, currentStep, checkpoints, journal, addresses, hydrated, busy, gap, status, error, launch, next, sign, retry, resume, pause }`. Use `prepare: () => review.prepare(manager)` to freeze validated data only when the user explicitly starts. `frozen` is an alternative for an already validated snapshot. Default storage is browser-local; default polling is 10 seconds. Neither hydration nor reload signs automatically.

- `launch`: acquire the draft lock, reread persisted state and run ready dependencies, including real waits.
- `next` / `sign`: advance at most one ready step (a discovery/wait may require no wallet signature). Every transaction still requires the wallet's own confirmation. These methods never accept arbitrary calldata.
- `resume` / `retry`: require an existing journal, reconcile known receipts/profile first, skip every confirmed step, then continue until waiting/completed/failed.
- `pause`: abort future work/polling; an already submitted transaction is not cancelled and its hash remains journaled.
- `signatures`: ordered per-chain transaction/message descriptors with checkpoint status and conditional flags; approval/swap/profile can be skipped on reconciliation. No Base descriptor exists.
- `error`: safe uppercase code plus a `manager.fundLaunch.*` translation key (keys are relative to `useTranslations("manager")`). Raw upstream messages and credentials never reach it.

The page owns labels, layout, immutable-field controls after a journal exists, confirmation UX, navigation and final success linking. `status` is idle/paused/running/failed/complete; checkpoint statuses additionally expose building/signing/submitted/waiting/confirmed. `currentStep` is the first unfinished step, not a promise that a parallel leaf must await it. TVL/APR are not produced by the launch layer: the page must preserve null as unavailable.

## API access contract

New `launchActions.ts` exports create/spoke/discover/profile, capital/position builders, unsigned `quoteLaunchSwapAction`, bridge quote, actual balances/transits and report trigger/job reads. Every action returns `{ ok: true, data }` or `{ ok: false, error: { status, code } }`. Normal swap quotes use the existing GET `/funds/:core/swap/quote`; signed execution uses privileged POST `/funds/:core/build-swap`, generated just in time rather than storing a 120-second signed route. Query values are validated and encoded, never caller-provided paths. The durable launch-plan can later replace storage without changing step identities.
