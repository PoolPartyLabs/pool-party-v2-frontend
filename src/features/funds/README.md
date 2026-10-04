# V2 fund pages

## Fund-wide history (POO-2182 / POO-2186)

`FundHistory` reads `GET /api/v2/funds/:core/history?limit=20&cursor=...` through the server-only v2 client and `fundHistorySchema`. It keeps the API's newest-first ordering, uses opaque keyset cursors, deduplicates by chain/transaction/log index, and preserves investor events, raw amounts and details. Each row uses its actual chain for transaction and vault explorer links. Refresh and pagination are explicit to avoid continuous indexer reads. Indexed history is not claimed to be complete. Fund changes invalidate in-flight reads. Position history remains a separate surface.

Wire contract checked against API commit `c8e8ce6`: `V2FundHistoryService.list`, `V2FundPositionStore.historyPage/historyProgress` and recursive `tagV2Response`. The local API checkout predates that commit and is deliberately untouched. Eleven locales include the new labels; non-English copy needs native review. Unit tests cover schema rejection, routing, pagination, links, retry, stale identity and same-fund validation. Deployment validation is still pending; no deployment performed.

## Created fund lists (POO-2181, rules v2)

The existing `FundFamilySwitch` selects the v2-only explorer and Manager Console; no V1 page, Strategy model, toggle, canvas or Review page is changed. List identities are enriched by `readFund` in batches of six. A failed individual detail keeps its identity and unavailable metrics. Manager filtering uses authoritative detail/identity manager and a verified session; the client hides results whose verified wallet differs from the connected wallet.

`FundListCard` reuses `StrategyLogo` and the existing card styling, displaying profile, v2 badge, manager, chains/protocols, Share Price (24 decimals), Share Assets (6 decimals), positions and limits usage. Missing values remain unavailable and numeric zero remains zero. All eleven configured locales translate the added list/journey states.

Manager view preserves `FundDraftsSlot` and lists wallet-local incomplete/completed launch journeys independently of fund API availability. Completion reloads mounted fund lists once; mount, focus and cross-tab journal changes revalidate as well. No discovery write, signing, broadcast or deployment is added.

## Explorer records (POO-2179, rules v1)

`src/lib/chain/explorer.ts` builds validated full `/tx/` and `/address/` URLs for Arbitrum (42161) and Robinhood (4663), returning null for unknown chains or invalid identifiers. The launch module still exports `explorerTxUrl` and `explorerAddressUrl` unchanged.

`fundTransactions.ts` observes the hash immediately after the existing wallet broadcast seam, before receipt polling. `FundTransactionRecord` renders the full link in both a toast and an inline live region. Approval records survive the receipt/rebuild/final deposit cycle; final refresh and input edits do not remove them. Pending receipt uncertainty retains the link, clears stale confirmation, and never auto-rebroadcasts. Fund/wallet change clears records and ignores late receipt callbacks. Mock actions never manufacture hashes.

Confirmed receipts show the mined block. Failed receipts immediately show reverted, then optionally enrich with a safely decoded ABI error name and translated reason. Read-only replay uses the mined block and bounded RPC waits; absent revert data is labelled unavailable, never guessed. The error-only ABI list mirrors the API's CoreVault, SpokeVault and ShareToken artifacts (168 unique signatures).

`ExplorerFields` links lifecycle events on the selected position chain; deployment, token and adapter addresses on their explicit chains; transit send/deposit on source and fill/credit on destination. Protocol acknowledgement events use the fund hub. Explicit leg chain IDs override defaults; missing/unknown chain context is unlinked text. Position keys, fund IDs, bridge references and job IDs are never treated as transaction hashes. Report jobs display only safe status and actual publication/delivery hashes. Report publication uses the sole configured spoke, delivery uses the hub; multi-spoke ambiguity fails closed. Expired report jobs stop polling with existing retry behavior.

New artifacts: PP-STR-LIB-031/032 and PP-STR-CMP-033/034. All new `strategies.funds` strings exist in eleven locales. Non-English translations follow the existing pending-native-review policy. No Murilo builder/canvas/Review page is changed.

The panel mounts an isolated named themed toaster alongside the global toaster added by the canvas integration. Its `toasterId` prevents duplicate notifications; identity cleanup dismisses the panel's notifications only.

POO-2175, rules v2. The existing `fundContracts` flag and `useContractFamily` preference select fund discovery, holder portfolio and manager read views. V1 elements remain unchanged; Murilo's toggle and builder switch are not edited. Fund detail uses `/funds/:core`, never V1 strategy IDs.

- Fund reads use slice A's server-only `v2Fetch`. Separate schemas preserve profile, NAV, positions, holder exposure, history, limits, transits and internal spoke balances.
- Investor actions derive the wallet from SIWE. Builds return simulated transactions; explicit user confirmation calls the existing account/chain-checking wallet executor and waits for receipts.
- Approval is a separate confirmation. After its receipt, a rebuild replaces the labelled estimate with the authoritative `preview`. Exact integer estimates use chain-read `fees.flowFeeBps`, falling back to the fixed 25 bps protocol fee during rollout. Preview and fee fields are optional until deployed.
- Standard payout has a 72-hour term; authoritative holder `claimable` controls claiming. COLLECT's deferred 409 produces no transaction. Closed exits skip fresh-report checks.
- Accepted report age is checked against the Mandate. Stale valuation starts a verified-session report job, polls every 15 seconds, cancels on identity changes and times out after 30 minutes. Delivery always rereads freshness before rebuilding.

`PP_API_URL`, `PP_API_KEY` and `PP_API_ADMIN_KEY` are server-only. The report broker verifies the bearer with `users/me`. Per-fund starts coalesce for 60 seconds in a bounded in-process map; the upstream throttler remains authoritative across instances. Missing admin configuration renders unavailability, never browser key access.

Mock mode uses `src/mocks/data/v2Funds.ts`, never real wallet sends. All eleven configured locales include `strategies.funds`. Tests cover mapping, rollout shapes, protocol discrimination, safe builders, approval receipts/rebuilds, freshness/cancellation, route selection and translated states.

Transits/balances depend on API PR #180. Authoritative previews/fees follow API PR #181 (POO-2176): fee terms arrive as decimal strings and scalar income/exit previews contain only `usdcPaid`. Unavailable fields remain visibly unavailable or explicitly estimated, never presented as authoritative.

## Investor handoff, 2026-10-04

POO-2214 supersedes the separate technical investor presentation with the existing Strategies/Portfolio and Details hosts. See [the phased delivery plan](../../../docs/investor/V2_DELIVERY_PLAN.md). Missing data/actions use Not available per Murilo. POO-2217 prepares the existing Invest amount host and account-bound funding return without enabling unverified V2 execution. Manager technical fund operations remain separate. POO-2219 tracks API enablement for Rafael.

POO-2220, rules v1: the existing family selector has a separate mobile row on Strategies, Portfolio and fund-detail routes. Details wraps the price below the identity on narrow screens and contains long names, addresses and metrics. A Portfolio with only exited positions keeps its history reveal; a known-empty history still shows the existing empty state. These are presentation/access fixes and do not enable V2 transactions.

POO-2223, rules v1: `FundComposition` renders supplied NAV weights as a donut with a neutral undetailed remainder and a matching position/logo legend. Missing or invalid coverage keeps the rows without inventing a chart. The history slot uses Figma no-history copy. `LocalManagerFollow` is controlled by Details so desktop/mobile copies stay synchronized; it is a reversible local interaction, without API persistence or an on-screen mock label.
