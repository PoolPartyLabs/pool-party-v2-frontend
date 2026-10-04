# V2 fund pages

## Explorer records (POO-2179, rules v1)

`src/lib/chain/explorer.ts` builds validated full `/tx/` and `/address/` URLs for Arbitrum (42161) and Robinhood (4663), returning null for unknown chains or invalid identifiers. The launch module still exports `explorerTxUrl` and `explorerAddressUrl` unchanged.

`fundTransactions.ts` observes the hash immediately after the existing wallet broadcast seam, before receipt polling. `FundTransactionRecord` renders the full link in both a toast and an inline live region. Approval records survive the receipt/rebuild/final deposit cycle; final refresh and input edits do not remove them. Pending receipt uncertainty retains the link, clears stale confirmation, and never auto-rebroadcasts. Fund/wallet change clears records and ignores late receipt callbacks. Mock actions never manufacture hashes.

Confirmed receipts show the mined block. Failed receipts immediately show reverted, then optionally enrich with a safely decoded ABI error name and translated reason. Read-only replay uses the mined block and bounded RPC waits; absent revert data is labelled unavailable, never guessed. The error-only ABI list mirrors the API's CoreVault, SpokeVault and ShareToken artifacts (168 unique signatures).

`ExplorerFields` links lifecycle events on the selected position chain; deployment, token and adapter addresses on their explicit chains; transit send/deposit on source and fill/credit on destination. Protocol acknowledgement events use the fund hub. Explicit leg chain IDs override defaults; missing/unknown chain context is unlinked text. Position keys, fund IDs, bridge references and job IDs are never treated as transaction hashes. Report jobs display only safe status and actual publication/delivery hashes. Report publication uses the sole configured spoke, delivery uses the hub; multi-spoke ambiguity fails closed. Expired report jobs stop polling with existing retry behavior.

New artifacts: PP-STR-LIB-031/032 and PP-STR-CMP-033/034. All new `strategies.funds` strings exist in eleven locales. Non-English translations follow the existing pending-native-review policy. No Murilo builder/canvas/Review page is changed.

The panel mounts an isolated named themed toaster because the current app shell does not mount one. Its `toasterId` prevents duplicate notifications when the independent global toaster work lands; identity cleanup dismisses the panel's notifications only.

POO-2175, rules v2. The existing `fundContracts` flag and `useContractFamily` preference select fund discovery, holder portfolio and manager read views. V1 elements remain unchanged; Murilo's toggle and builder switch are not edited. Fund detail uses `/funds/:core`, never V1 strategy IDs.

- Fund reads use slice A's server-only `v2Fetch`. Separate schemas preserve profile, NAV, positions, holder exposure, history, limits, transits and internal spoke balances.
- Investor actions derive the wallet from SIWE. Builds return simulated transactions; explicit user confirmation calls the existing account/chain-checking wallet executor and waits for receipts.
- Approval is a separate confirmation. After its receipt, a rebuild replaces the labelled estimate with the authoritative `preview`. Exact integer estimates use chain-read `fees.flowFeeBps`, falling back to the fixed 25 bps protocol fee during rollout. Preview and fee fields are optional until deployed.
- Standard payout has a 72-hour term; authoritative holder `claimable` controls claiming. COLLECT's deferred 409 produces no transaction. Closed exits skip fresh-report checks.
- Accepted report age is checked against the Mandate. Stale valuation starts a verified-session report job, polls every 15 seconds, cancels on identity changes and times out after 30 minutes. Delivery always rereads freshness before rebuilding.

`PP_API_URL`, `PP_API_KEY` and `PP_API_ADMIN_KEY` are server-only. The report broker verifies the bearer with `users/me`. Per-fund starts coalesce for 60 seconds in a bounded in-process map; the upstream throttler remains authoritative across instances. Missing admin configuration renders unavailability, never browser key access.

Mock mode uses `src/mocks/data/v2Funds.ts`, never real wallet sends. All eleven configured locales include `strategies.funds`. Tests cover mapping, rollout shapes, protocol discrimination, safe builders, approval receipts/rebuilds, freshness/cancellation, route selection and translated states.

Transits/balances depend on API PR #180. Authoritative previews/fees follow API PR #181 (POO-2176): fee terms arrive as decimal strings and scalar income/exit previews contain only `usdcPaid`. Unavailable fields remain visibly unavailable or explicitly estimated, never presented as authoritative.
