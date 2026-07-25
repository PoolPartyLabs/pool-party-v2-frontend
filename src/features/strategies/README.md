# Strategies (explore, detail, invest/manage flows, share)

`PP-STR-SCR-001` (Explore) · `PP-STR-SCR-002/003` (Detail: Discovery + Owned) · transactional
modals `PP-STR-MOD-001..008` · share `PP-STR-CMP-006` + `PP-STR-MOD-009` · Linear epic POO-86,
share POO-275.

The investor's managed-strategy surface: browse and filter strategies, read the prospectus-style
detail, and run the invest / collect / compound / withdraw flows against the mock service layer.
An owned, non-closed position also exposes Share, which opens the share-yield modal.

## Pieces

- **`StrategiesExploreScreen`** (`PP-STR-SCR-001`) and **`StrategyDetailScreen`**
  (`PP-STR-SCR-002/003`, one responsive screen for Discovery + Owned, including the paused and
  closed treatments from POO-185). The Explore risk + type filters are collapsed into two floating
  **`FilterDropdown`** menus (`PP-CORE-CMP-059`, POO-658; promoted to `components/ui` in POO-756): a trigger shows the current selection and
  opens a listbox on click, closing on Escape / focus-out / select. This supersedes the always-visible
  `BrowseByRisk` + type-chip rows (`PP-STR-CMP-002`, removed). In **real (server-paged) mode** the
  **type** dropdown is hidden (no backend `type` param) and the **risk** dropdown maps to the API
  `riskProfile` (POO-667, see "Explore server-paged Load more" below); mock mode keeps both.
- **Transactional modals** (`components/`): `InvestModal` (PP-STR-MOD-001/002),
  `CollectModal` (003), `WithdrawModal` (004/005), `CompoundModal` (006), shared
  `TransactionSettingsDialog` (007), `TransactionStatus` (PP-CORE-MOD-002) and
  `TransactionErrorActions` (008). Settlement is the mock seam `components/settle.ts`
  (`PP-STR-LIB-001`). `CollectModal` offers a USDC ↔ **token-pair** receive-as choice on
  both the investor and manager paths (POO-417): the pair flips the build's `shouldSwapFees`
  and renders per-token amount rows via `TokenAmountRow` (`PP-CORE-CMP-042`); no swap → no DEX fee.
  **Truthful receipts (POO-810, rules v1):** in REAL mode the success receipts show the ACTUAL
  on-chain executed amounts, decoded on the FE from the mined receipt — the send keeps the receipt
  `logs` (`executeBuiltTransactionWithLogs`) and the executors decode the standard ERC-20
  `Transfer(_, to=user, value)` events (a `Transfer` log's emitter IS the token address, so no address
  list is needed): `src/lib/tx/{decodeExecutedAmounts,resolveTokenMeta,receivedAmounts,resolveReceivedAmounts}.ts`
  (`PP-CORE-LIB-041/042/043/044`) + `src/contracts/erc20.ts` (`PP-CORE-LIB-040`), composed by the
  hook glue `hooks/receiptDecode.ts` (`PP-STR-LIB-011`). The USDC leg (`getUsdcAddress`, 6 decimals)
  renders as USD 1:1; the non-USDC leg's `{decimals,symbol}` resolves from the position's `currency0/1`
  or an on-chain `decimals()`/`symbol()` read, then renders via `TokenAmountRows`. Invest "Amount
  Invested" = requested − USDC refund (wires the existing partial-fill banner to the real deployed);
  Collect/Withdraw "Amount received" → the real per-token amounts. Decoded values thread through the
  FlowStep `context`; undecodable/absent logs fall back to the pre-broadcast figure (R9, never blank).
  Mock mode keeps `settle` unchanged. **Live-chain (dev/e2e) verification of the decode path is
  pending.** No backend change — the backend only builds calldata + pre-execution estimates.
  Every transactional modal (investor **and** manager) exposes **Max slippage + Transaction
  deadline** in its settings gear (POO-478 R1): the manager Collect gear is ungated (its slippage
  threads into `buildCollectFeesTxAction`), and the manager Create-Pool Review step (`ReviewStep`,
  `PP-MGR-SCR-002`) carries the same gear (slippage flows into `buildCreatePoolTxAction`; deadline
  display-only). `transactionSettingsCoverage.test.tsx` is the guard that keeps this invariant.
  **Uniform custom slippage (POO-547):** every consumer's custom input accepts the same **0.1-100%**
  range with decimals (`slippage.ts` `SLIPPAGE_MAX=100` + `SLIPPAGE_MIN=0.1`/`floorSlippage`, floored on
  the dialog's `onBlur`); the old per-flow 5% caps (Move Range/Close/managed Collect/Create Pool) are
  gone, and `MANAGER_DEFAULT_SLIPPAGE_PCT=5` / `CREATE_POOL_DEFAULT_SLIPPAGE_PCT=2` are DEFAULT SEEDS,
  not caps. Above 5% the shared High-slippage warning shows in every gear; it is warn-only, never blocks
  Confirm. `createPoolAction` clamps server-side to 100 now (PP-INTEGRATION-POINT POO-551: BE to verify).
  **Slippage auto-retry (POO-499, POO-467 rules v2):** all six modals consume `useSlippageAutoRetry`
  (`PP-STR-HOK-001`) over their `useWalletSignFlow`. On the FIRST slippage-classified failure
  (`flow.error.kind === "slippage"`, POO-473) the flow auto-retries ONCE from the build step
  (`flow.retryFrom("build")`; Collect/Compound fold build+send into their single confirm step, so it
  re-runs that) while the pending view shows a notice; on the SECOND it shows a slippage-specific error
  view (`flow.slippage.*` copy) and auto-opens the settings gear once. One `tx_slippage_retry` analytics
  event fires per automatic retry. Non-slippage failures are unchanged (generic view, manual retry). In
  mock mode a gear slippage `<= 0.1%` forces the canned settle slippage error deterministically
  (`settleOutcomeForSlippage`, PP-MOCK). `CompoundModal` migrated from its setTimeout timer mock to a
  single-step mock `useWalletSignFlow` (behavior-preserving) so the orchestration is uniform. Real-mode
  retry-from-build wiring is POO-503.
  `WithdrawModal` mirrors that receive-as choice (POO-481 binary options): with the pair selected,
  "You receive at least" breaks into two per-token rows (amount + **estimated** USD + logo) from the
  pure client-side reserve split `positionTokenSplit` / `splitUsdAmount` (`PP-CORE-LIB-022`, POO-498 /
  POO-483 rules v2) over the position's raw reserves, anchored on `strategy.tvl` with `f` clamped at 1
  — the SAME path in mock and real mode; a missing raw block degrades to the honest single USD total.
  The USD figures are pre-execution estimates; backend-verified figures replace them via POO-325.
  **POO-548 (rules v2)** extends the Withdraw Review: a **"Fees available to collect"** row sits
  directly below "Amount requested" (shown even at $0.00, sourced from `position.totalYield` = the
  Home Yield source, R5); on the pair path BOTH "Amount requested" and the Fees-available row split
  per token via the same split lib, while "You receive at least" stays a single total (its per-token
  receive rows are the POO-498 behavior, unchanged). The amount step stays gearless; the
  closed-position step keeps its gear (its only settings entry). USDC mode keeps single-value rows.
  **POO-847 (owned mobile close, rules v1):** an OWNED (`isPoolManager`) non-closed position reached
  through this investor surface (the managed view is desktop-only, so mobile managers land here) is
  payout-locked to the token pair, and an ACTIVE removal that is a full exit OR promotes to a close
  (`> 50%` or a dust remainder) CLOSES the pool — mirroring the desktop `RemoveLiquidityModal`
  (POO-312) threshold via the SHARED `ownedRemovalClosesPool` predicate in
  `src/features/manager/lib/removalPlan.ts`, so `WithdrawModal`'s `closingPool` gate and
  `useWithdraw`'s `close-pool-tx` routing read the SAME decision off the same effective amount (no
  divergent 50%). The close raises the destructive close alert + investors note, the "Close strategy"
  CTA, a Continue / Keep-the-strategy confirm before building, and a "Strategy closed" success. A
  removal at/under 50% (non-dust) keeps the investor partial route; a CLOSED owned position is a
  post-close claim and keeps the investor copy.
- **Share yield (POO-275, POO-906)**: `YieldReceiptCard` (`PP-STR-CMP-006`) renders the square
  "Yield Receipt" social card; `ShareYieldModal` (`PP-STR-MOD-009`) wraps it with the
  24h / 7d / 30d period selector (default 30d), share targets and the gold "Copy referral link"
  CTA; `lib/yieldReceiptPng.ts` exports the 1080x1080 PNG. Privacy rule: the card shows only the
  earned dollar amount for the period, never a percent and never principal figures. POO-906: the
  card renders the SHORTENED display link (`truncateDisplayLink`: host + middle-truncated path +
  full `?ref=`) while copy and every share target carry the full url; figures come from the
  position's `feesEarned` clamped at >= $0 (collectedFees fallback); on a file-capable Web Share
  platform the social buttons attach the PNG to the native sheet (desktop keeps text intent urls,
  which accept no file); export failures surface inline + `strategy_share_export_failed`.

## Data

Everything reads from the service factory (`src/lib/services`): `strategyService`,
`positionService` (incl. `getEarnings` for the share periods), `accountService`, plus
`rewardsService.getReferral()` for the share card's referral link. All mock seams carry
`PP-INTEGRATION-POINT` markers and rows in `docs/INTEGRATION_POINTS.md`.

## Strategy asset tags (POO-830, PR1 foundation)

Two-dimensional discovery tagging derived from a strategy's token pair. PR1 ships the pure libs +
the ASSET-tag wiring only; the filter UI, feature flag and objective wiring are later PRs.

- **`src/lib/strategies/tags/tokenClassRegistry.ts`** (`PP-STR-LIB-012`, R1): a curated
  `(chainId, lowercased address)` → `TokenClass` (`stablecoin | bitcoin | ethereum | altcoin | meme |
  unverified`) allowlist across Base / Arbitrum / Polygon — the **production** contract (symbols are
  spoofable, so an unknown address stays `unverified`). `tokenClassBySymbol` is a **MOCK-ONLY /
  legacy** symbol fallback (the mock pools reference tokens by symbol with non-real addresses; the v1
  `/pools` payload carries symbols, no address). `resolveTokenClass` is address-first, symbol-fallback
  only when no usable `(chainId, address)` is present.
- **`deriveAssetTags.ts`** (`PP-STR-LIB-013`, R2): `deriveAssetTags(c0, c1)` →
  `{ assetTags, unverified }` for a two-sided pair; `deriveAssetTagsForPair` is the wiring convenience.
- **`deriveStrategyTags.ts`** (`PP-STR-LIB-014`, R3/R4): the orchestrator over `{ pair, mint }` that
  routes two-sided → `income` + R2 assets and single-sided → the R4 direction (`gradualBuy` /
  `gradualSell`). **Unit-tested only in PR1** — objective tags are not yet on the investor `Strategy`
  (needs persistence, later PR).
- **Wiring (R7):** `Strategy.assetTags` (+ `unverifiedTokens`) is populated by BOTH real mappers
  (`mapStrategy` v1 symbol path, `mapStrategyV2` address path) and the mock `strategyService`, so mock
  and real strategies both carry asset tags. The mock derives from a per-strategy tag-pair map so the
  fixtures' `poolPair` (which drives Invest zap / Receive-as / detail) stays untouched.

Additive and separate from `riskProfile.ts` (STEADY/DYNAMIC risk lists) and `StrategyType` —
`docs/INTEGRATION_POINTS.md` carries the backend per-token-category seam.

### Investor asset-category filter (POO-830 PR2, R6/R8, rules v1)

The Explore screen (`StrategiesExploreScreen`, `PP-STR-SCR-001`) gains a **multi-select asset-category
filter** (Bitcoin / Ethereum / Stablecoins / Altcoins / Meme coins), gated behind the dark-launch
`strategyCategoryFilter` flag (R8). When the flag is off the control is **invisible and inert** — the
screen behaves byte-for-byte as today.

- **`CategoryFilter`** (`PP-STR-CMP-021`, `components/CategoryFilter.tsx`): the multi-select control — a
  trigger with an active-count badge that opens a floating `aria-multiselectable` listbox; each option
  TOGGLES (the menu stays open for multi-pick), a top "All" row clears the selection. Sibling to the
  single-select `FilterDropdown` (`PP-CORE-CMP-059`) used by the risk/type filters. Storybook:
  `Strategies/CategoryFilter`.
- **`filterStrategiesByAssetTags`** (`PP-STR-LIB-015`, `lib/strategies/tags/filterByAssetTags.ts`): the
  pure OR-semantics predicate + list filter (R6). A strategy matches when its `assetTags` includes ANY
  selected category; **no selection = no filter**; a tagless strategy never matches while a selection is
  active. Order-preserving, non-mutating.
- **Mock mode (POO-894 [R7]):** the category filter narrows `categoryVisible` client-side on top of
  the search/risk/type/sort result (the full catalog is client-held, so the narrowing covers 100%). It
  participates in the virtualization `resetKey`, the Clear-filters affordance, and the recoverable
  no-results state (never the terminal empty state).
- **Paged (real) mode (POO-894 rules v1):** the filter is **server-side** - the selection forwards
  `paged.onCategoriesChange` → the loader tuple (page-0 reset, like search/risk) →
  `fetchStrategiesPage` → the v2 `category=<tag>[,<tag>...]` param ([R1]). The backend OR-filters the
  pair-derived tags across the whole catalog and counts honestly, so the count line always reads
  `paged.total` ([R4]) and "Load more" never dead-ends on unloaded matches ([R5]). Degraded paths: an
  older v2 deploy strips the unknown param (unfiltered rows, trusted as-is); the v1 `/pools/all`
  fallback keeps the client-side narrowing per fetched page ([R8], seam-marked in
  `fetchStrategiesPage`). **PR3** adds the *objective* filter dimension once objective tags are
  persisted onto the investor `Strategy`.

## Strategy detail resolution — one request (POO-778, `PP-STR-LIB-009`)

The detail route (`/strategies/[id]`, the app's top deep link) resolves in a single request.
`loadStrategyDetail` (`src/lib/strategies/loadStrategyDetail.ts`) fires two reads CONCURRENTLY
keyed on the route id — `resolveDetailStrategy(id)` and `fetchPoolTimeseries(id)` — off the old
serial waterfall where the analytics series waited for the whole resolution chain (R2). Resolution
is single-request: `getStrategyById` resolves BOTH id shapes through ONE v2 read, shape-routed by
`fetchStrategyV2ById` (POO-776) — an owned UUID hits the UUID-only `GET /api/v2/strategies/:id`
(`ParseUUIDPipe`), a chain-bound positionId hits the case-insensitive
`GET /api/v2/strategies/by-position/:positionId`. Both return the same `{data: StrategyV2}` envelope,
retiring the POO-741 full-catalog drain-and-find from the detail path (R1). A clean v2 404 returns
null with NO v1 3-network `/pools` drain — a bot / stale link 404s after ≤1 upstream request (R3);
only a genuine v2 error degrades to the v1 by-id read. The signed-in closed/held positions fallback
(POO-455/POO-536) is preserved, ordered strictly after the single read (R4); the list-surface catalog
drains (`listStrategies` / `listStrategiesForHoldings`) are untouched (R5).

**Manager identity (POO-771, rules v1, consumes POO-758).** The strategy mappers (`mapStrategyV2`,
v1 `mapStrategy`, and `synthesizeStrategyFromPosition`) read the backend-embedded manager identity
(`{ handle, displayName, avatarUrl, managerVerification, verified }`,
`src/lib/manager/managerIdentitySchema.ts`) into `manager` (`@handle` else truncated wallet),
`managerHandle`, `managerAvatarUrl` and top-level `managerVerified`. So every attribution renders
`@handle` + avatar + the verified badge with **zero extra requests**. The verified badge is gated on
`strategy.managerVerified` — as of **POO-798** the mappers derive it from the embedded
`managerVerification` enum (`=== 'valid'`), the single badge source that supersedes both the legacy
`verified` boolean and the old `detail.managerVerified` — at StrategyCard, PositionCard, the detail hero
+ `ManagerCard`, and inline in the text-only attribution cells; the ManagerCard avatar renders via
`ManagerAvatar` (monogram fallback, never "@"). Fields are optional/`.nullish()`, so an older backend
degrades to wallet-only, never blanking a screen. `managerIdentityFanout.test.ts` guards against any
reintroduced per-manager `/api/v1/managers` fan-out (the superseded PR #512).

**Real lock-up (POO-819, rules v1, consumes POO-812).** The backend v2 strategies DTO already exposes
`lockupDays` top-level, so `mapStrategyV2` carries it onto a top-level-optional `Strategy.lockupDays`
(mirroring `poolPair`/`poolFeeBps` — NOT a fabricated `detail` prospectus, which would violate
no-mock-in-real). The lock-up-aware consumers — the Invest Review row, the Strategy Detail metric tile,
and the Withdraw arrival footer — read `strategy.lockupDays ?? strategy.detail?.lockupDays` (top-level
first, the mock `detail` copy as the parity fallback). Real (v2) mode now renders the real lock-up (or
"None" when `0`) instead of always "None"; mock fixtures mirror the value top-level so mock mode is
unchanged. The v1 `/pools` mapper has no lock-up source and leaves it undefined (honest).

**Detail-hero manager avatar removed (POO-794, rules v2).** The strategy-detail hero keeps its inline
one-line credit under the name — `by @handle` (else the masked wallet) + the verified badge — but the
DUPLICATE manager avatar was removed from that subline. The photo now renders ONLY in the right-rail /
mobile `ManagerCard`, so the manager's picture appears once, not twice. The `card.by` /
`detail.managerVerified` keys are untouched (still used by the hero + StrategyCard / HomeView /
PortfolioView / Explore). Independent of the backend `/by-position` identity fix (POO-793), which only
affects what the hero credit + ManagerCard resolve (wallet vs `@handle`).

## Explore server-paged "Load more" (POO-666 / POO-667)

Real mode (`isMockMode === false`) renders Explore as a **server-paged "Load more" list** (page size
5, v1-interface parity), NOT the drain-everything + client-filter of POO-646. The pieces:

- **Shared paging seam (POO-666):** `src/lib/api/pagedFetch.ts` (`PP-CORE-LIB-031`) reads ONE page of
  a `{ totalItems, <itemsKey>[] }` list endpoint over `apiFetch` → `{ items, total }` (the on-demand
  counterpart to `drainPages`), and `computeHasMore` is the one `hasMore` math. `useServerPage`
  (`src/lib/api/useServerPage.ts`, `PP-CORE-HOK-021`) is the client accumulate-and-`loadMore` state
  machine over an injected `loadPage`; a `loadPage` identity change (a new filter/sort/search tuple)
  or `reset()` re-reads page 0.
- **Explore wiring (POO-667):** `fetchStrategiesPage.ts` (`PP-STR-LIB-007`) reads `GET /pools/all`
  page-by-page; `exploreActions.ts` (`loadExplorePageAction`, drops closed) is the server action;
  `ExplorePagedLoader.tsx` owns the filter/sort/search state + drives `useServerPage` + resolves the
  Owned/Invested badges. `StrategiesExploreScreen` gains an optional `paged` contract (Load-more
  button, count from `totalItems`, type filter hidden, server-driven controls). `page.tsx` routes real
  mode to `ExplorePagedLoader` (the old `ExploreDataLoader` is removed).
- **Server sort** (verified vs pp_api `SORT_FIELD_MAP`, POO-726): `tvl`->`tvlInUSD`, `return`->`feesApr`,
  `risk`->`riskLevel` (band steady<dynamic<wild, asc=lowest risk first), `investors`->`totalInvestors`
  (POO-726); only `min` has no server field (platform floor identical for every v1 strategy) -> no sorting
  (default order, POO-726 R3 / POO-754 revisit). **Risk** maps 1/3/5 → steady/dynamic/wild (bands 2 & 4 →
  empty; the API 400s on anything else). **Search** is server-side. The **type filter is hidden in real
  mode** (no backend `type` param) and stays mock-only.
- **Mock mode is unchanged:** the full mock catalog is SSR'd and filtered/sorted client-side with the
  type filter shown. Every mock-mode test omits the `paged` prop, so mock behavior is untouched.

## Post-write freshness (`usePostWriteRefresh`, POO-364 + POO-638)

Every operation modal (`Invest` / `Withdraw` / `Collect` / `Compound`) calls the shared
`usePostWriteRefresh` (PP-CORE-HOK-016) on success so holdings + the catalog reflect the write
without a manual reload. POO-638 makes the follow-up poll **deterministic**: when a caller hands it
the mined receipt block + the touched strategy id(s), it observes the v2 read's `onchain.blockNumber`
per strategy (`src/lib/strategies/v2`, PP-STR-LIB-005) with bounded backoff until
`onchain.blockNumber >= receipt.blockNumber` (`src/lib/tx/blockConvergence.ts`, PP-CORE-LIB-030) or a
hard cap, instead of the blind 13s poll (POO-492). A caller that passes no convergence info keeps the
blind bounded fallback. Threading the receipt block from `useWalletSignFlow` into each op modal's
success handler is the follow-up that lights the deterministic path up end to end.

## List virtualization (POO-626, PR2 of the POO-623 epic)

`StrategiesExploreScreen` windows its two long lists with the shared primitive
(`src/lib/virtualization`, POO-625) so they mount O(viewport) rows instead of O(n):

- **Desktop `<table>`** and **mobile card `<ul>`** both consume `useVirtualizedRows({ mode: "window" })`
  — **document scroll**, not an inner scroll container, so Next 15 back/forward scroll restoration and
  the AppShell sticky sidebar keep working. The table uses **Technique A** in-flow spacer `<tr>`s
  (absolute rows are banned in tables, ADR-0001 rule 2); the mobile list uses absolute `<li>` +
  `translateY` (allowed outside tables).
- **Gate + fallback:** windowing engages only when the `virtualize` flag is on, the filtered set is
  `> 500`, and there is real layout; otherwise (and always in SSR/jsdom) both lists render the plain
  `.map()` baseline, byte-for-byte identical to today. `explore.count` is always over the full filtered
  set (`visible.length`), never the windowed slice.
- **RESET (rule 5):** a `resetKey` derived from the filter/sort/search/clear tuple drives
  `scrollToIndex(0)` in a layout effect, so a genuinely different list resets to row 0 in the same
  commit; a same-identity background refetch (array reference change alone) does **not** reset.
- **Focus pin:** a focused per-row Invest link is force-kept mounted when the window scrolls past it.
- Contract: `docs/adr/0001-list-virtualization-react-virtual.md`. Tests:
  `StrategiesExploreScreenVirtualize.test.tsx` (both flag states; the base
  `StrategiesExploreScreen.test.tsx` stays green by construction — its 3-strategy fixtures never window).

## Strategy description (POO-235)

The manager's free-text strategy description (`Strategy.description`, optional, ≤280 chars, plain
text, trimmed on save) is authored in the builder identity section and surfaces here read-only:

- **`StrategyCard`** (`PP-STR-CMP-001`): rendered as a card subtitle under the name + manager,
  clamped to two lines; absent when the strategy has no description.
- **`StrategyDetailScreen`** "About": `strategy.description ?? detail.about` — the manager's
  description takes precedence over the mock prospectus text and renders even in real mode, where the
  full `detail` prospectus has no backend source yet.

The builder side (textarea + read-only Review echo) shipped under POO-278. The create seam carries
`description` into the new strategy row (`managerService.createStrategy`, trimmed; optional). The
real cutover (`PP-INTEGRATION-POINT`) persists it on the OAMS strategy metadata; the indexer then
serves it on the investor `Strategy` entity.

## Composition per-token proportion (POO-897, rules v1)

The Composition card on all three Strategy Details variants (managed, invested, non-invested) shows
the pool position's per-token VALUE split: two token rows (logo + symbol + integer percent) over a
proportional two-tone bar, rendered by `SinglePoolProspectus`'s optional `split` prop
(`PP-STR-CMP-017`).

- **Math** (`lib/compositionSplit.ts`, `PP-STR-LIB-016`): `strategyCompositionSplit(strategy,
  position)` resolves through the honest degrade chain: the invested `Position`'s reserve block ->
  the strategy's optional `onchain` block (both via `positionTokenSplit`, `PP-CORE-LIB-022`) ->
  `tokenSplitFromTicks` range math from the tick bounds (covers the zero-liquidity pool: the split a
  NEW deposit resolves into; also the v1 `/pools` ticks-only path) -> `null`, which keeps today's
  single "Liquidity pool 100%" row. Out-of-range renders 0/100 truthfully; percentages are
  display-only estimates (never signing amounts).
- **Data:** `Strategy.onchain` (optional) models the v2 `StrategyOnchainDto` reserves
  (`totalSupply0/1`) + `tickLower/tickUpper/tickCurrent` + currency decimals (`mapStrategyV2`);
  the v1 mapper carries ticks only. Never fabricated, absent on mock/lean/pending rows.
- **Managed variant:** `StrategyManageView` passes the ALREADY-computed allocation split
  (label-matched from `buildManagerAllocation`'s tokens); `AllocationCard` stays too (consistent
  card everywhere, mild duplication accepted).
- **Mock mode:** the narrative multi-slice `detail.composition` branch is untouched; split rendering
  is covered by unit tests + the `WithSplit`/`OutOfRangeSplit` Storybook stories.

## Prospectus cards collapsed by default (POO-903, rules v1)

The Composition and Investment mandate cards on Strategy Details start COLLAPSED on every visit.
Real mode: both `SinglePoolProspectus` `CollapsibleCard`s carry `defaultOpen={false}` ([R1]; this
also reaches the shared manager `StrategyManageView`). Mock/multi-pool mode: the two plain
`Section`s on `StrategyDetailScreen` became `CollapsibleCard`s with unchanged bodies, including the
proportions bar ([R2]). State is per-visit component state, never persisted ([R3]); the primitive's
`aria-expanded` header button carries the a11y semantics ([R4]). The other prospectus sections
(About, Risk limits & terms, Fees) stay plain, always-open cards.

## Funding recovery surface (POO-1055, rules v1, hackathon POO-1022)

A cross-chain funding route takes minutes and users close tabs. The rail already wrote a durable
record of what it put on a chain (`lib/fundingJournal.ts`, `PP-STR-LIB-019`) and already knew how to
reconcile that record against the chain (`lib/reconcileFundingJournal.ts`, `PP-STR-LIB-020`); neither
reader had a production caller, so an interrupted route left a correct journal nobody ever looked at.

- **`hooks/useFundingRecovery.ts`** (`PP-STR-HOK-021`) finds the in-flight route for the connected
  wallet on session entry, runs the §3.5 decision table against three per-chain RPC reads, and
  persists the corrections. It is a read from end to end: the `ChainReader` type has no way to send
  anything, so nothing can auto-broadcast on load.
- **`components/provisioning/FundingRecoveryBanner.tsx`** (`PP-STR-CMP-025`) renders it, mounted on
  the `AppShell` so it is reached wherever the user comes back. Resume is a **link back to the
  operation**, never a re-send: the plan is a pure function of current holdings, so re-deriving it
  cannot repeat a leg that already settled.

Two behaviours are deliberate and easy to "fix" wrongly. While money is in flight there is no
dismiss, because deleting the record of a broadcast transaction is how the next session fails to
recognise it and sends a second one. An ambiguous leg is shown the account on the explorer rather
than a retry, because with no hash there is nothing safe to re-send. Design:
`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.

## Analytics

`strategy_*` events per `docs/ANALYTICS_EVENTS.md`, including the share funnel:
`strategy_share_opened`, `strategy_share_period_changed`, `strategy_share_target_clicked`,
`strategy_share_link_copied`, `strategy_share_card_saved`.

## Wallet signing (multistep), PP-CORE-MOD-006 / 009 (POO-295)

The pending phase of every on-chain flow is a **variable-length** list of wallet interactions: one
ERC-20 `approve` per token → an optional Permit2/message signature → the terminal confirm. Three
pieces, smallest to largest, so a flow declares *what it needs* instead of hand-rolling the array:

- **`walletSignSteps.ts`**: `buildWalletSignSteps(spec)`, a pure, i18n-free sequencer.
  `spec: { approvals?: string[]; permit2?: boolean; confirm: WalletConfirmKind }` →
  `approve TOKEN` (×N) → `permit` → `confirm <op>`. Always ends with the confirm, so the minimum is
  a 1-step transaction. No React, trivially testable.
- **`WalletSteps.tsx`** (`PP-CORE-MOD-006`): the presentational vertical stepper (done ✓ / active ⟳
  / pending ·, the "Continue in your wallet" cue, "Step X of Y", the "What am I signing?"
  disclosure). The active step carries `aria-current="step"`; the `<ol>` is named via
  `aria-labelledby`. **No in-modal CTA while signing** (POO-295 R3). The "Why?" disclosure is
  **per-signature**: when a step carries a `why` ({ name, body }), the expanded panel names *that*
  signature (Token approval · Permit2 signature · Final confirmation) and explains it; otherwise it
  falls back to the generic copy.
- **`WalletSignModal.tsx`** (`PP-CORE-MOD-009`): the generic modal: title + optional `summary` + the
  steps resolved from a `spec`. The host owns the success/error outcome (it swaps this for its own
  view when the flow settles).

### Use it

```tsx
<WalletSignModal
  open={phase === "signing"}
  onOpenChange={setOpen}
  title={t("invest.signing.title")}
  summary={<p>{formatUsd(amount)}</p>}
  spec={{ approvals: ["USDC"], confirm: "invest" }}  // → 2 steps
  activeStep={step}                                   // controlled, see below
/>
```

Spec → step count (no hand-built arrays):

| Flow             | spec                                                                       | steps |
| ---------------- | -------------------------------------------------------------------------- | ----- |
| Collect/Compound | `{ confirm: "collect" }`                                                    | 1     |
| Deposit/Invest   | `{ approvals: ["USDC"], confirm: "invest" }`                               | 2     |
| Withdraw         | `{ permit2: true, confirm: "withdraw" }`                                    | 2     |
| Add liquidity    | `{ approvals: ["USDC","WETH"], permit2: true, confirm: "addLiquidity" }`    | 4     |

### Controlled vs uncontrolled (the integration seam)

`WalletSteps` / `WalletSignModal` take an optional `activeStep` (0-based):

- **Omit it** → the stepper **self-advances** on a mock timer (`stepMs`, default 650ms) and rests on
  the last step. This is the preview/Storybook/test behaviour, and what the live modals do today while
  there is no backend.
- **Provide it** → the **host owns progress**: bump `activeStep` on each real wallet
  signature/confirmation; the internal timer is off and out-of-range values are clamped. This is the
  `PP-INTEGRATION-POINT` the FE↔BE track wires (row in `docs/INTEGRATION_POINTS.md`). A rejected step
  routes to the standard error modal (`PP-CORE-MOD-002`), whose "Try again" returns to the failed step.

### Extend it

- **New confirm action** → add the kind to `WalletConfirmKind` (`walletSignSteps.ts`), map it in
  `CONFIRM_LABEL_KEY` (`WalletSignModal.tsx`), and add the `strategies.sign.steps.confirm*` key across
  all 11 locales (`pnpm i18n:check`).
- **New step kind** (beyond approve/permit/confirm) → extend `WalletStepDescriptor.kind` + the
  `buildWalletSignSteps` body + the label/`why` switch in `WalletSignModal`.
- **Per-signature "Why?" copy** lives under `strategies.sign.explain.{approve,permit,confirm}.{name,body}`
  (approve's `body` interpolates `{token}`). `WalletSignModal` attaches it as each step's `why`; new
  kinds need a matching `explain.*` entry in all 11 locales.

### See it / test it by hand

Dev-only sandbox (404 in production): **`/[locale]/dev/wallet-steps`** (e.g. `/en/dev/wallet-steps`).
Switch specs, drive the steps manually (controlled) or watch the mock timer (uncontrolled), and read
the live `buildWalletSignSteps` output. Source: `src/app/[locale]/dev/wallet-steps/`. Storybook story:
`UI/WalletSignModal`.
