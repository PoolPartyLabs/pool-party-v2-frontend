# Fund Review and launch

POO-2172, rules v1. Review and execution for fund contracts only. The existing `fundContracts` gate applies. Mock mode never signs.

## Integration

- `FundStrategyBuilderScreen` accepts `?draft=<id>&phase=review` after a completed mandate. The Build canvas owner connects its Next action to that phase; this slice does not edit the canvas.
- `FundReviewSlot` reads the canvas owner's `draft.plan` (`BuildPlan` v1 from frontend PR #31). Until that model lands, Review reports an execution gap, without guessing trades.
- `draft.launchExecution[blockId]` is an owned extension adapter: v4 requires `priceLower`, `priceUpper` (human token1/token0) and `maxLossBps` (1..500). Serial drawings with multiple positions require `leafSharePct` for each independent leaf. Configuration panels currently persist only `poolId`/`assetKey`; their owner must supply these missing fields. They are not added to canvas files here.
- Canvas spoke child percentages are percentages of root principal. The adapter divides each child by the group's root share, then applies that fraction to actual net destination credit. Aave is always an independent leaf, never the funding source of a later pool.
- API PR #180 (`uBits-Capital/pool-party-api`, `feat/be-poo-2174-v2-launch-support`) supplies configurable `payoutFeeBps`, transits and spoke balances. If unavailable, launch fails visibly, never falls back to mock calldata.

## Safety and recovery

The per-draft, per-manager journal stores the frozen Review/request, derived steps, transaction hashes, receipt statuses and discovered core. Successful or uncertain creation is never rebuilt. Reconcile the same hash first; unknown receipts wait. A wallet submission with no known hash requires reconciliation, not an automatic second send. Checkpoints are written before each signing operation. Profile is reconciled before signing a fresh canonical nonce.

Creation is atomic with seed. Actual `FundSeeded.shares` defines the deployable net principal. Gross 100 USDC at 25 bps previews 99 whole shares, 99 USDC deployable principal, 0.25 USDC fee and 0.75 USDC remaining in the wallet. No fractional-share promise is made.

Builds happen just in time. Swap/open reread actual unallocated balances; range-derived composition uses Decimal and token decimals. V4 minimum amounts reflect the chosen loss bound. Allocation is aggregate on the hub. Bridge quotes are refreshed before send; transit reads prove credit before spoke execution. Reports expose pending/failed/expired jobs, not invented countdowns. No TVL/APR values are fabricated.

API writes run in new server-only files, separate from the shared v2 read client. Server actions require a session and compare its wallet with the on-chain manager before privileged work. `PP_API_KEY` is sent as `x-api-key`; `PP_API_ADMIN_KEY` is sent as `x-admin-key`, as required by the actual API guards. Report triggers have bounded process-local per-wallet/core throttling; upstream throttling remains necessary across replicas. Keys and upstream messages never return to clients.

Logo upload reuses `useUploadMedia("logo")`, wallet-scoped presigned S3 POST, without a v1 strategy UUID. Deployment must provide media configuration, session authentication and CORS.

## Known limitations

- The canvas Next link and execution fields must be connected by POO-2144/POO-2171 owners. Existing saved drafts have no invented ranges.
- Only base-token pairs from the supported catalog are executed. Two-conversion non-base pairs and standalone manual swaps fail closed.
- An ambiguous no-hash submission requires operator/wallet reconciliation; no transaction-history API exists to resolve it automatically.
- Journal storage is browser-local, not a cross-device durable API launch plan. Web Locks prevent two tabs from launching the same draft; unsupported browsers fail closed. Alpha reorg handling and cross-device coordination need the later durable API.
- Report wait observations (14..19 minutes) are not SLAs. Keeper/operator funding remains an environment gate.
- Fee decreases have no API builder; Review shows the contract fact, not an edit control.
- No deploy, signature or broadcast is performed by tests, build, or this development session.

## Validation

Focused tests cover Review bounds and deposit arithmetic, supported Build fixtures, partial failure and uncertain receipts, canonical profile serialization, real receipt decoding, strict transaction validation and admin-key redaction/rate limiting. All 11 configured locales carry `manager.fundLaunch.*`; Storybook covers ready, missing execution and report wait.
