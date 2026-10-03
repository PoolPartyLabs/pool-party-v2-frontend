# V2 fund pages

POO-2175, rules v2. The existing `fundContracts` flag and `useContractFamily` preference select fund discovery, holder portfolio and manager read views. V1 elements remain unchanged; Murilo's toggle and builder switch are not edited. Fund detail uses `/funds/:core`, never V1 strategy IDs.

- Fund reads use slice A's server-only `v2Fetch`. Separate schemas preserve profile, NAV, positions, holder exposure, history, limits, transits and internal spoke balances.
- Investor actions derive the wallet from SIWE. Builds return simulated transactions; explicit user confirmation calls the existing account/chain-checking wallet executor and waits for receipts.
- Approval is a separate confirmation. After its receipt, a rebuild replaces the labelled estimate with the authoritative `preview`. Exact integer estimates use chain-read `fees.flowFeeBps`, falling back to the fixed 25 bps protocol fee during rollout. Preview and fee fields are optional until deployed.
- Standard payout has a 72-hour term; authoritative holder `claimable` controls claiming. COLLECT's deferred 409 produces no transaction. Closed exits skip fresh-report checks.
- Accepted report age is checked against the Mandate. Stale valuation starts a verified-session report job, polls every 15 seconds, cancels on identity changes and times out after 30 minutes. Delivery always rereads freshness before rebuilding.

`PP_API_URL`, `PP_API_KEY` and `PP_API_ADMIN_KEY` are server-only. The report broker verifies the bearer with `users/me`. Per-fund starts coalesce for 60 seconds in a bounded in-process map; the upstream throttler remains authoritative across instances. Missing admin configuration renders unavailability, never browser key access.

Mock mode uses `src/mocks/data/v2Funds.ts`, never real wallet sends. All eleven configured locales include `strategies.funds`. Tests cover mapping, rollout shapes, protocol discrimination, safe builders, approval receipts/rebuilds, freshness/cancellation, route selection and translated states.

Transits/balances depend on API PR #180. Authoritative previews/fees follow API PR #181 (POO-2176): fee terms arrive as decimal strings and scalar income/exit previews contain only `usdcPaid`. Unavailable fields remain visibly unavailable or explicitly estimated, never presented as authoritative.
