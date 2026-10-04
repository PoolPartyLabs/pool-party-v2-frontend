# Manager (B2B Manager Console)

The manager-facing surface: the console dashboard, the strategy list, the strategy builder, the
public manager profile, and the strategy **manage detail** (`PP-MGR-SCR-004`) with its operations
(pause / collect / close / move range). Everything reads through the service factory
(`src/lib/services` → `managerService`, `positionService`); mock-by-default with real seams marked
`PP-INTEGRATION-POINT`.

## i18n namespace

`manager.*` (`src/i18n/messages/{locale}/manager.json`). Manager Console keeps DeFi terms in English
by industry convention; product nouns (USDC, APY, Uniswap v3) stay verbatim across all 11 locales.

## Manager role (POO-779, rules v2)

The sidebar Manager Console entry's role is the **session profile store**, not a positions drain.
`useIsManager` (`src/lib/account/useIsManager.ts`, `PP-MGR`) reads `profile.isManager` from the owner
profile session store (`PP-PROF-CTX-001`, `src/lib/profile/useOwnerProfileSession.tsx`), which fetches
the owner profile once per signed-in session via `getOwnerProfileAction` (`PP-PROF-ACT-003` →
`loadInvestorProfile` → `GET /users/me`) and shares it. This **replaced** the old
`getManagerRoleAction` `closed=all` drain (`GET /portfolio/:wallet/all?closed=all`) that ran on every
hard load for every user and triggered pp_api's heaviest 3-network RPC + CoinGecko + Revert composition
just to answer a boolean; the hook now issues **zero role-dedicated requests**.

- **[R1]** role = `profile.isManager` from the session profile read; no positions/strategies drain.
- **[R2]** the store fetches once per session, refetches on wallet change + SIWE re-sign, and flips to
  manager locally after a create-pool success (`markManager`, wired from `ManagerConsoleDataLoader`'s
  `?created=1` landing) — no refetch, since the backend already flipped the flag at confirm.
- **[R3]** POO-456 holds by construction: the flag is sticky-true, so a fully-exited manager still
  resolves as manager; the store holds `loading` through the SIWE signing window so the sidebar keeps
  its skeleton instead of flashing "Become a manager".
- Degrade-tolerant: an absent `isManager` or a read failure resolves to investor, never a false manager.
- Mock mode is unchanged: the Dev-menu toggle drives the entry (`useIsManager` returns false there).

**Blocked-by POO-788** (`is_manager` reconcile — FALSE today for pre-POO-307 / v1-created managers).
R4 (console list from the managerWallet-scoped read, POO-777) is a separate follow-up; this change is
R1–R3 only.

## Manage-detail data mapping

`mapManagerStrategyDetail(pool, position?, analytics?)` (`PP-MGR-SCR-004`) turns one managed pool
(`GET /pools/:poolAddress`) plus the manager's position and the analytics AUM series into the
manage-detail payload. It NEVER fabricates data in real mode: fields with no source are left
empty/undefined so their cards hide or show an empty state.

### Allocation card (POO-563, rules v1)

The manage-detail **Allocation** card is REAL in V1 — no backend or indexer needed. In the current
product a strategy IS one Uniswap v3 position, so the allocation is derived CLIENT-SIDE:

- **`buildManagerAllocation`** (`PP-MGR-LIB-007`, `lib/buildManagerAllocation.ts`) reuses
  `positionTokenSplit` (`PP-CORE-LIB-022`) over the position's raw reserves (`totalSupply0/1` at
  `tickCurrent`, decimals from the pool currencies) to produce the per-token **value** split, plus a
  single **100% Uniswap v3** protocol row.
- **[R1]** `tokens` = percent-of-value split; `protocols` = one 100% Uniswap v3 row.
- **[R2]** single-sided / out-of-range positions render 100/0 (or 0/100) truthfully — the split's
  value share is 0 or 1.
- **[R5]** any missing/degenerate reserve field (or a missing token symbol) → `undefined`, so the
  card hides. The honest behavior is preserved; never a placeholder percentage.

`AllocationCard` (`PP-MGR-CMP-029`) renders only when `detail.allocation` exists.

**PP-INTEGRATION-POINT (POO-380):** the FUTURE multi-protocol / real-indexer-balance version
replaces this single-position estimate with multiple protocol rows from the indexer joined with the
mandate. POO-563 is the single-Uniswap-position V1; POO-380 is re-scoped to that future version.

## List paging: client-side "Load more" reveal (POO-669, rules v1)

The two Manager Console strategy lists page via a CLIENT-SIDE "Load more" reveal (`useRevealCount`,
`PP-CORE-HOK-022` at `src/hooks/useRevealCount.ts` — a **shared** hook since POO-670 promoted it out
of `manager/hooks` for its second consumer, the Admin queues): each renders the first 5 rows and
reveals +5 per click over the already-loaded, already-filtered set. This **replaces** the POO-627
windowing on these two lists (**[R3]**); the shared windowing primitive (`@/components/virtualized`,
POO-625) and its own tests stay intact and are simply no longer wired into the console lists.

- **`ManagerDashboardView` Overview "Your strategies"** (`PP-MGR-SCR-001`) — one shared reveal count
  feeds BOTH layouts (the mobile card `<ul>` and the desktop `<table>` `<tbody>`), so a single "Load
  more" grows them together; the button sits after both layouts and works at any breakpoint. The
  Overview has NO status filter, so the reveal has no `resetKey`: it only grows, and a same-set
  45s/focus/`router.refresh` refetch keeps the revealed count (**[R2] DO-NOT-RESET**, POO-628). The
  KPI aggregates read `dashboard.*` independent of the row list, so the reveal changes only which rows
  render, never the tiles (**[R1]**); the manage detail is parent-owned and renders OUTSIDE this list
  (**[R3]**).
- **`ManageStrategiesView` Manage grid** (`PP-MGR-SCR-003`) — the reveal runs over the client-filtered
  `visible` subset. The status filter is the reveal's `resetKey`: switching pills is a genuinely
  different subset, so the reveal RESETS to the first 5 (**[R2]**, mirroring POO-626); a same-set
  refetch under the same filter keeps the count (DO-NOT-RESET, POO-628).

### List source: managerWallet-scoped read (POO-779 R4), client-side reveal for paging ([R2])

The console strategy list is the **managerWallet-scoped v2 read** (POO-779 R4 @rules-v3), replacing the
former position-derived second full-catalog drain (the POO-669 gap). `getManagerConsoleAction` reads it
via `listManagedStrategies(wallet)` → `GET /api/v2/strategies?managerWallet=<wallet>` (server-paged,
drained; POO-777), mapped by `mapStrategyV2`. `ManageStrategiesView` still filters client-side by status
and paging is still a client-side reveal (not a backend `limit`/`offset` cursor).

Two subtleties preserve the old behavior exactly (`resolveManagedStrategies`, PP-MGR-LIB-014):

- **Vanished-but-held recovery (Q2).** A wound-down managed pool can drop out of the indexer (POO-373
  `missing`) and be absent from the scoped read, yet the manager's own console must still show it
  (POO-455/537). It is recovered from the wallet's held position (`fallbackStrategy`, POO-526) and
  **unioned** into the list, deduped by id (scoped-read row wins). So parity holds whether or not the
  backend returns `missing` rows. This reuses the positions the tiles already fetch — no extra drain.
- **Error degrade (Q4).** On any scoped-read error in real mode, the list falls back to the legacy
  position-derived compose (`composeManagedFromPositions` over `listStrategiesForHoldings()`), so the
  console never blanks while POO-777 is being wired. Mock mode keeps that same position-gated compose
  (R5), preserving the current mock behavior.

The KPIs/dashboard aggregates (AUM, inflows, performance, investor counts) come from the C1
`/manager/:addr/financials` payload (POO-991: the legacy `/analytics/wallets/:addr` manager-summary read
`fetchManagerSummary` was removed — the last FE v2 legacy analytics read). `yieldGenerated` is left-joined
from the held positions by strategy id (Q3), so a listed strategy the manager no longer holds contributes
0 yield rather than dropping. Money tiles degrade per PP-CORE-LIB-049 [R3]: net-inflows + earnings (all-time
perf fees, `performanceFees`, matching the card's "All-time" label) have no on-chain Σ, so a null
`/financials` payload / served-null field renders `common.unavailable`, never a fabricated $0;
AUM / active investors / yield / total-investors keep an on-chain Σ fallback. Marked in-code with a `PP-NOTE` in `buildManagerConsole`. If a paginated
manager-list cursor lands later, the reveal can become a true server-page loader against it (a separate
wiring issue).

## Public-profile website external-link warning (POO-850, rules v1)

The public manager profile (`ManagerProfileScreen`, a Server Component) renders the social logo chips
through the client `SocialChips` (`PP-MGR-CMP-034`). Four of the five networks (X / Telegram / Discord /
YouTube) are domain-pinned by the `SOCIAL_NETWORKS` allow-list, so they open DIRECTLY as plain
`target="_blank"` anchors ([R2]). The WEBSITE chip is the only unpinned destination (`domains: null`, so
a manager can point it at any host and Pool Party has not verified it); clicking it opens an external-link
`ConfirmDialog` (`tone="info"`) that names the destination domain and warns it is unverified, and only
`window.open(href, "_blank", "noopener,noreferrer")` on Continue ([R1], identified by `key === "website"`).
Because a Server Component cannot pass function/`Icon` refs across the RSC boundary, `SocialChips` derives
its chips itself and receives ONLY the serializable `profile.socials` record ([R3]); the POO-552
`safeHttpUrl` render-side guard moved into it unchanged.

## Public-profile owner "Edit profile" action (POO-895, rules v1)

When the viewer of `/m/<handle-or-address>` IS the manager being viewed, the profile header shows an
"Edit profile" pill beside the Share action ([R1]), linking to the console's URL-driven profile tab
`/manager?tab=profile` via the i18n `Link` ([R2]). The ownership check is SERVER-SIDE in the route
(`page.tsx`): real mode compares the profile's wallet to the SIWE session wallet (`getSessionWallet`),
case-insensitively; mock mode (no SIWE cookie) uses `managerService.getDashboard().address` as the
viewer identity ([R6]). A signed-out viewer, a different wallet, or an address-less profile simply
resolves as not-owner, never an error ([R3][R4]), and the flag rides BOTH resolution branches, so the
owner's own synthesized (no-registry-row) profile invites them to create/fill the profile ([R5]).
Label: `manager.profile.edit`, present in all 11 locales ([R7]).

## Referral-aware share surfaces (POO-901, rules v1)

The three manager share surfaces append the SHARER's referral code (`useReferral().program.code`,
shared module-cached state) as `?ref=<code>` when one exists, and fall back to the plain URL until
it resolves (no code / loading / logged out) — the owned `StrategyDetailScreen` share precedent:

- **Console "Share your strategies"** (`ManagerDashboardView`): `managerProfileReferralUrl(slug,
  code)` ([R1]); the link box is a `ReferralField` copy field ([R4], displays + copies the FULL
  absolute URL, emits `reward_referral_shared`), alongside the untouched `ShareInviteButton`.
- **Managed strategy "Share link"** (`StrategyManageView`): `strategyReferralUrl(publicStrategyId,
  code)` ([R2]).
- **Public profile Share** (`ShareProfileButton`): the SERVER screen passes only the slug; the
  client button resolves the code (whoever is signed in — owner or visitor) and builds the URL
  ([R3]).

URL builders live in `src/lib/urls.ts` (`PP-CORE-LIB-029`); no new i18n keys (reuses
`rewards.referral.*` + `manager.manage.shareCopied`) ([R6]).

## Profile-tab save + upload failure observability (POO-702 Secondary #1, rules v1)

The observability half of POO-702 for the console Profile tab (`ManagerProfileTabView`,
`PP-MGR-SCR-006`); the primary avatar/banner persist bug is tracked separately in the same issue. A
failing save or upload used to be swallowed (`handleSave` / `handleRequestVerification` were
`try/finally` with no `catch`; the crop-apply `catch` set `mediaUploadFailed` but discarded the error).
Now, sharing the same helpers as the investor surface (`describeError` `PP-CORE-LIB-036`, `mediaSaveLog`
`PP-CORE-LIB-037`):

- **Save + verification-request** — a rejected `updateProfile` surfaces an explicit inline error
  (`manager.profileTab.saveFailed`, 11 locales) and structured-logs the caught error under
  `PP-PROFILE-SAVE` (`{ surface: "manager", action: "save" | "verification-request", ... }`).
- **Upload** — the deferred avatar/banner upload now runs on **Save** / verification-request (POO-707):
  its `catch` keeps the staged preview + `mediaUploadFailed` flag, skips the signed PATCH, AND logs the
  caught error under `PP-MEDIA-UPLOAD`, including the asset kind (`{ surface: "manager", asset:
  "avatar" | "banner", ... }`).
- **Server action** — real-mode `updateManagerProfileAction` logs the PATCH body SHAPE (keys +
  `avatarUrl`/`bannerUrl` classified absent/non-https/https, PII-free) and the API outcome under
  `PP-MEDIA-SAVE`, then rethrows, revealing on the next real save whether the uploaded https URLs reach
  the persisting PATCH.

## Range-input behavior: tick-source-of-truth steppers + input-level bounds (POO-877 / POO-881 / POO-883, rules v1)

Shared by the create-strategy Build step (`BuildStep`, `PP-MGR-CMP-019`) and the Move Range modal
(`MoveRangeModal`, `PP-MGR-MOD-001`) through the pure `poolTickSnap` grid helpers (`PP-MGR` / POO-408)
over `PP-CORE-LIB-020` (`src/lib/uniswap/tick.ts`):

- **POO-877 (R1-R4) — the ± steppers move the underlying TICK, never the display string.** A nudge
  resolves the bound's NEAREST usable tick (`priceToNearestUsableTick`, round-half), steps it by one
  spacing, then re-derives the price (`stepPriceForPool` → `stepPriceByTick`). Typed prices keep the
  POO-319 FLOOR snap on blur (`priceToClosestUsableTick`, R2). Before this, the editor rendered a
  usable-tick price rounded DOWN for display and the stepper floored it back, so on tickSpacing-1 pools
  (USDC/USDT 0.01%) `+` regenerated the same tick (a permanent fixed point → the stepper "locked") and
  `-` skipped a tick. The mock relative grid (`stepOnTickGrid`) already rounded, so this only fixed the
  real (decimals-known) path, bringing it to parity.
- **POO-881 (R5/R6/R8) — input-level `max > min` enforcement.** On blur (`snapBound`) and on every ±
  step (`nudge`), the edited canonical bound is clamped (`clampRangeBound`) so it can never invert or
  over-narrow the range: it pins the bound `CLAMP_PIN_SPACINGS` off the opposite one, anchored on the
  opposite bound's tick as the width check resolves it (floor real / round mock) plus a one-spacing
  margin (on spacing-1 pools display precision equals one tick, so display rounding + the price↔tick
  float round-trip can each shift a bound one integer tick). The POO-860 CTA gate + inline error stay
  as the backstop for the transient typed-but-un-blurred state (R7).
- **POO-883 (R9/R10/R11) — 2-tick-spacing minimum width.** Already enforced by POO-860 (#565):
  `isRangeWideEnough` (`MIN_RANGE_SPACINGS = 2`) measures the SNAPPED on-grid ticks (`rangeSpacingsForPool`
  via the floor snap), so a typed off-grid band that snaps to 2 spacings is accepted (floor-widening
  acceptance from POO-319). This lane adds regression/verification coverage; the width clamp above also
  keeps blur/step results at or above the minimum.

## Fund contracts builder (V2 toggle, POO-2119)

### Real catalog wiring (POO-2133, rules v1)

With `NEXT_PUBLIC_MOCK_MODE=false`, the existing V2 toggle and `fundContracts` flag use the real v2 catalog.
`PP_API_URL` and `PP_API_KEY` stay server-only. No admin endpoint, deployment or transaction broadcast is added.
`src/lib/api/v2/` validates the `{ data }` envelope, v2 protocol header and recursively tagged response records.
Typed server actions return sanitized errors and catalog data; no upstream secret enters the browser.

- Networks: Arbitrum required, Robinhood optional. Uniswap v3 swaps are locked; Across appears only with Robinhood.
- Positions: optional Uniswap v4 per selected chain and optional Arbitrum Aave v3 supply. V3 positions show Coming soon.
- Tokens: per-chain catalog metadata, logos and `hubPriced`; USDC/USDG bases locked; at most 16 unique chain-address entries.
- Pools: real v4 token/pair filters and bytes32 PoolId lookup; full PoolKey retained. Adding a pool adds both currencies atomically.
- Aave: catalog supply APY and live availability. No Robinhood reserve, borrowing or invented yield.
- Limits: `spokeCapPercent` is a 5-point percentage or null. It is fund intent, **not enforced on chain until POO-2169**.
  Protocol/token sliders are optional local Build allocation aids and never enter the provisioning selection.

Completed real drafts persist `v2Selection`: `{ chains: [{ chainId, tokens, uniswapV4PoolIds }], aaveV3Reserves, spokeCapPercent }`.
`toV2MandateSelection` revalidates provenance, bases, currencies, position selection and caps before completion.
Old/mock drafts are flagged, never silently upgraded. Catalog failures show retry, never fixtures as a real fallback.
Pool TVL/APR/tier share are omitted when unavailable, with an explicit indexing notice.
Fund list/detail reads are typed; limits derive from detail's Mandate/profile because no standalone limits route exists.

Review supplies manager, fee basis points and raw hub USDC seed/minimum amounts to `POST /api/v2/funds/build-create`.
That slice must fetch the current catalog again and rebuild from the draft, not trust stored `v2Selection` or old PoolKeys.
Build canvas files are unchanged. Mock v3/v4 fixtures and V1 builder behavior remain unchanged.
All added copy is translated in the 11 configured locales; machine-tier translations still require native review.

Artifacts: `PP-CORE-LIB-112` to `PP-CORE-LIB-115`, `PP-MGR-LIB-025`, `PP-MGR-HOK-011`, `PP-MGR-CMP-060`.
Resolved integration points: catalog tokens/pricing/Aave, v4 pool catalog, percentage intent serialization.
Open integrations: backend draft persistence (POO-2132), on-chain percentage cap (POO-2169), TVL/APR indexing. Review now connects to the existing launch journey (POO-2195).

The Mandate step of a second, parallel strategy builder for the fund contracts (hub Arbitrum, spoke
Robinhood Chain, PoolPartyLabs/smartcontract-v2), speced from
`manager-fund-contracts-2026-10-02/handoff-strategy-builder-mandate-2026-10-03.md`. It signs nothing
on chain: everything persists as a local draft, and the V1 builder above is untouched by any of it.

**The toggle and the flag.** `ContractFamilyToggle` (`PP-CORE-CMP-075`, header, "V1 | V2") decides
which family of contracts a manager surface addresses; `useContractFamily` (`PP-CORE-HOK-038`)
persists the choice as a UI preference (`localStorage` key `pp.contractFamily`, default `"v1"`).
Both sit behind the `fundContracts` registry entry (`PP-CORE-LIB-011`, env
`NEXT_PUBLIC_FEATURE_FUND_CONTRACTS`, default off). **Not a route gate:** `BuilderRouteSwitch` sends
`/manager/new` to this V1 screen (`PP-MGR-SCR-002`, unchanged) or to the fund-contracts preview
`FundStrategyBuilderScreen` per the toggle; flag off renders V1 byte-identically, no skeleton.

**Folder layout.** `src/features/manager/fund/`: `mandateCatalog.ts` (`PP-MGR-LIB-018`),
`mandateDraft.ts` (`PP-MGR-LIB-019`), `mandateDraftStore.ts` (`PP-MGR-STO-001`),
`useMandateDraft.ts` (`PP-MGR-HOK-006`), `mandatePoolSource.ts`, `FundStrategyBuilderScreen.tsx` /
`BuilderRouteSwitch.tsx` (both `PP-MGR-SCR-002`), `steps/{Networks,
Protocols, Tokens, Pools, Limits}Step.tsx` (`PP-MGR-CMP-035` to `039`), `build/` (the Build canvas, own
section below, which replaced the Build landing `FundBuildLanding.tsx`), and
`components/{MandateRow, NetworkDots, BuilderActionBar, MandateSubStepHeader, CopyAddressChip,
MandateSummaryCard, MandateDraftsList, FundDraftsSlot, NameDraftDialog}.tsx`. The V1 builder stays
in `src/features/manager/components/`, imported for its helpers but never modified by this phase.

**Draft store key.** `pp.manager.mandateDrafts.v1`, versioned JSON (`{ version: 1, drafts:
Record<id, MandateDraft> }`) in `localStorage`, one entry per drafted mandate. This is the ONLY
persistence the Mandate phase has, since it writes nothing on chain; `PP-MGR-STO-001` carries the
`PP-INTEGRATION-POINT` for the backend draft API this becomes.

**Step rules, one paragraph each, rule numbers from the handoff.**

- **Shell (R1 to R14).** Page header "Create new strategy" with a "Save & exit" text button and no
  "Back to console" (R1); the three-phase stepper Mandate/Build/Review, a reached phase clickable
  (R2); the sub-step header collapsed by default, one line "MANDATE · STEP n OF 5" plus the title
  plus "Next: `<step>`", hover peeks it open, a click pins it (R3); step titles of reached steps are
  links, the current one is not, unreached ones are disabled (R4); a sticky Back/Next action bar,
  Next on step 5 reads "Next: Build strategy" (R5), and Next is NEVER disabled, a block shows an
  inline reason and scrolls to the row instead (R6); Save & exit opens the naming dialog only on the
  first save, after that it saves silently with a toast (R7); the draft name is 10 to 50 characters,
  the same rule the create-pool API applies to the strategy name (R8); every selection survives Back,
  Next and Save & exit (R9); every network logo carries a tooltip and a `title` with its name (R10);
  every pool address on the Pools step copies the real address on click (R11); a selected row uses
  the raised-surface treatment with the primary colour on the checkbox, never a row fill (R12); the
  Broad mandate flag raises only when every token AND every pool are selected, never from networks or
  protocols alone (R13); every string is a translation key, 11 locales, no em dash (R14).
- **Networks (R15 to R18).** The hub, Arbitrum, is locked and shown first (R15); the one spoke,
  Robinhood Chain, renders in the two-column grid under "Other networks" with "Select all" (R16 v2,
  POO-2142, buildathon scope: Base, Polygon and Unichain are commented out of the catalog, not
  deleted); Robinhood Chain is always available, the fund builder no longer reads the
  `robinhoodChain` flag (which keeps gating the V1 surfaces), and no network row renders "Coming
  soon"; availability stays catalog data (`PP-MGR-LIB-018`), so a spoke marked unavailable would be
  disabled and still report a blocked click (R17 v2); the Robinhood Chain deposit token is USDG, not USDC, which the step shows as
  USDG / Global Dollar, amending the handoff's literal default (R18, see "Coordinator defaults" and
  `docs/COMPLIANCE_REGISTER.md` `CR-MGR-013`).
- **Protocols (R19 to R22).** The swap adapter and Across are locked above a divider, "Required"
  (R19); in real mode Across is shown and held only while Robinhood Chain is selected (POO-2133);
  "Protocols to operate" lists Aave v3 (Arbitrum only) and Uniswap v4 (Arbitrum, Robinhood
  Chain) with "Select all" and an "On" column of per-network dots, while Uniswap v3 positions stay
  listed but disabled, "Coming soon", because the fund contracts have no Uniswap v3 position adapter
  (R20 v3, POO-2167; the required Uniswap v3 swap is a different row and stays); no reducer accepts
  Uniswap v3 positions, and a stored draft that still names them loses the protocol, its pools and
  its cap row when it is loaded (`withoutUnavailableProtocols`, applied by `mandateDraftStore.ts`); GMX
  is no longer offered and is commented out of the catalog, not deleted; availability stays data,
  per protocol and per network, so a disabled combination still reports its click (R21 v2); "Across"
  is named only on its own row, never in the bridge caption (R22).
- **Tokens (R23 to R28).** Two columns, the catalog (minus what the draft already holds) on the
  left, "Your tokens" on the right (R23); the deposit token is a locked, one-row-per-network entry
  that cannot be removed (R24); the catalog lists only tokens available on the chosen networks and
  protocols (R25); a search field, a network filter and "Add all N" narrow or bulk-add the catalog
  (R26); the mandate holds at most 16 token slots, one per network a token runs on, exceeding it
  disables Add with "No slots left" (R27); only priced tokens (`PRICED_SYMBOLS`) are offered by
  default, an unpriced one is reachable by search, disabled, "No price feed yet" (R28).
- **Pools (R29 to R38).** The step is skipped entirely with no DEX protocol chosen, and the header
  then reads "OF 4" (R29); search matches V1's own pattern, including pasting a pool address (R30);
  protocol tabs carry result counts (R31); a result card shows the tier share, both token addresses
  as copy chips, TVL and APR (R32); an added pool moves to "Your pools" (R33); pools are a CLOSED
  list fixed at creation, both tokens must already be mandate tokens (R34); the per-protocol scope
  for caps and for Build is "every pool with at least one mandate token" (R35); "Show more" paginates
  the results (R36); an all-selected state raises the Broad mandate notice (R37, see `CR-MGR-010`);
  a pool carrying a Uniswap v4 hook is listed and disabled, "has a hook" (R38).
- **Limits (R39 to R43).** Three groups, per network / per protocol / per token, each row a "No cap"
  checkbox or a 5%-step slider (R39); the hub row is locked, "No cap, the hub holds what is not sent
  elsewhere" (R40); only the per-spoke-network cap exists on chain today, in USDC, checked on send,
  per-protocol and per-token caps have no contract basis yet and must not be presented as on-chain
  guarantees (R41, see `CR-MGR-011`); the shared footnote states caps are checked when money moves
  and growth from price changes is not forced back (R42, see `CR-MGR-012`); rows come from the
  earlier steps minus their locked rows (R43).
- **Name draft dialog.** Title "Name your draft", a body explaining why, a 10-to-50-character name
  field with a live counter and a progress line naming the draft's own counts ("Saved so far: 3
  networks, 4 protocols, 3 tokens, Mandate step 3 of 5"), "Keep editing" and "Save and exit".

**Coordinator defaults (handoff open points).** The handoff names its own open points as decisions
for Murilo; absent an answer, the coordinator applied a default so the slices could proceed. **1.**
Where the draft lives: `localStorage` today (`mandateDraftStore.ts`), not a backend; reload and the
Console drafts list depend on the answer, the five Mandate screens do not. **2.** Which networks,
protocols and tokens ship enabled on day one: the catalog's `available` flags (Arbitrum and
Robinhood Chain only) and `PRICED_SYMBOLS` (USDC, ETH/WETH, USDG, WBTC, cbBTC, USDT, DAI, ARB, LINK,
wstETH) are the coordinator's conservative reading of the contracts, not a confirmed release list.
**3.** The Robinhood deposit token: the coordinator OVERTURNED the handoff's literal instruction
("the frontend shows USDC everywhere until this is settled with Rafael") and the Tokens/Networks
steps print the chain's real stable, USDG / Global Dollar, instead; `CR-MGR-013` records that this
override is pending Rafael's and Murilo's confirmation, not a settled answer. **4.** Slot semantics:
a token added enters every selected network where the catalog has it, one slot per entry; a manager
cannot keep a token off one network to free a slot. **5.** Cap units: per-protocol and per-token caps
are a frontend-only percentage with no contract basis (`CR-MGR-011`); whether they should exist at
all before the contracts support them is unanswered. **6.** The flag's name, "Broad mandate", and
its investor-facing placement: the name is a proposal and the placement is not built at all
(`CR-MGR-010`). **7.** "Strategy" vs "fund" wording in the console for this contract family: carried
as "strategy" throughout, matching the V1 builder's vocabulary, unresolved. **8.** The Uniswap v4
pool catalog has a real source since POO-2133: server actions read the backend's v4 catalog on Arbitrum and
Robinhood Chain (see "Real catalog wiring" above and `docs/INTEGRATION_POINTS.md`, "Fund contracts builder");
mock mode keeps its fixtures. **9.** "N% selected" on a pool card mirrors V1 exactly: the pool's share of the pair's TVL across the fetched fee tiers, computed client-side (`tierShare` in `mandatePoolSource.ts`); no API field carries a manager share today, so the handoff's "share of V1 managers who chose that tier" has no source and the V1 computation wins. **10.** "Next: Build strategy" on step 5 marks the mandate complete, persists the draft, and lands on the Build canvas (`BuildScreen`, POO-2157, which replaced the Build landing that printed the mandate back); Back: Mandate returns to Limits. **11.** The feature flag is `fundContracts` (`NEXT_PUBLIC_FEATURE_FUND_CONTRACTS`), off by default, `next` stage; the header toggle renders only while it is on and the V2 builder only while the toggle says V2; `v2.dev.pool-party.xyz` needs the variable baked before the image build. **12.** Deep links are query params on the existing route, `/manager/new?draft=<id>&step=<key>` (plus `&phase=build` once the mandate completed), no new route folder. Decisions 1 to 12 are recorded in the "Plan" section of the POO-2119 Linear issue; Murilo can overturn any of them.

**What is NOT done.** The Build canvas is mounted (POO-2157) and has its own section below, with what it does
and does not do. Review: the Review page is POO-2172, and the launch journey behind it (POO-2177) is described in
`src/features/manager/fund/launch/README.md`. Investor-facing flag placement (the strategy card and detail show no Broad-mandate
flag anywhere today, `CR-MGR-010`). Backend persistence (drafts are `localStorage` only,
`PP-MGR-STO-001`'s own `PP-INTEGRATION-POINT`; wiring issue POO-2132). Mobile layouts (desktop only,
per the handoff). Uniswap v4 pool metrics (TVL, APR, tier share) stay null until the API provides them (see "Real
catalog wiring" above). On-chain enforcement of the spoke cap percentage (POO-2169). Known consequence of rules v3 (POO-2167):
Uniswap v4 is the only selectable position protocol, so a mandate that names it cannot pass the Pools
step without a Uniswap v4 pool, in either mode; an Aave-only mandate skips the Pools step and
completes. The seams that wait on the contract interface
(registries, price source, spoke cap unit, contract-family marker) are tracked together by wiring
issue POO-2134, against POO-2116 slices 5, 7 and 12.

**Analytics, as shipped** (not the epic's first proposal; see `docs/ANALYTICS_EVENTS.md`, "Manager,
fund builder"). The funnel is `builder_mandate_started` / `_step_viewed` / `_step_submitted` /
`_blocked` / `_completed` / `_abandoned`, plus `builder_draft_saved` and `builder_mandate_error`, and
the drafts pair `builder_draft_opened` and `builder_draft_deleted`, and the Build canvas events of POO-2157
(`builder_build_viewed`, `builder_build_started`, `builder_block_added`, `builder_network_added`,
`builder_network_removed`, `builder_flow_block_inserted`, `builder_block_removed` (with `cascade_count` since
POO-2187), `builder_build_blocked`, `builder_build_abandoned` and `builder_build_error`, declared in
`docs/ANALYTICS_EVENTS.md`), and the configuration panel's of POO-2187 (`builder_block_configured`,
`builder_block_applied`, `builder_block_discarded`, `builder_block_leave_blocked`, `builder_block_limit_hit`);
`builder_build_landing_viewed` and `builder_block_restored` are retired. `builder_mandate_blocked`'s five NEW reasons are `nothing_selected`,
`cap_missing`, `no_slots`, `has_hook` and `coming_soon`; `price_unknown` (an unpriced token) and
`name_invalid` (the draft name) REUSE the existing POO-1172 reason series rather than mint
per-builder duplicates. A draft-save failure reports `builder_mandate_error { error_code:
"DRAFT_SAVE_FAILED", error_origin: "app" }`; the same event also carries the Pools step's catalog
read failing, `POOLS_FETCH_FAILED` / `upstream` when the list on screen is the one that failed and
`POOLS_UNIVERSE_FETCH_FAILED` / `upstream` when it was the universe measured beside a search (nothing
is drawn for that one; the Broad mandate count just stays unknown). `contract_family_toggled`
(`PP-CORE-CMP-075`) is a
sibling event outside this funnel: it fires on the V1/V2 choice itself, not on anything inside
either builder.

**Follow-up, not acted on: coverage thresholds.** `vitest.config.ts`'s per-glob thresholds have no
glob matching `src/features/manager/fund/**`; its existing `src/features/**/hooks/**` entry does not
reach `useMandateDraft.ts`, which sits directly in `fund/`, not in a nested `hooks/` folder. Every
file here still counts toward the GLOBAL floor (statements 75 / branches 70 / functions 82 / lines
78), just not a stricter dedicated one the way `src/lib/utils/**` gets. Noted here rather than
changed, per this slice's instruction not to touch the thresholds.

## Build canvas (fund contracts builder, epic POO-2144)

The Build phase of the fund-contracts builder: the manager assembles the strategy as a top-down graph of
blocks, using only what the mandate holds, and always sees where the capital goes and how it comes back.
The rules (C1 to C22, I1 to I10, the layout constants) are the handoff in the description of Linear issue
POO-2144, v1.2 with C22 (later revisions reconciled it with the deployed alpha and changed no rule). It was built
as dormant slices (POO-2151 to POO-2156, on `main` through roll-up #44) and mounted by the activation slice
(POO-2157, #41): `FundStrategyBuilderScreen` renders `BuildScreen` in the Build phase, behind the `fundContracts`
flag (default off) and the V2 toggle. The canvas signs and sends nothing and calls no API: a plan is a local
draft. What turns a stored plan into API builder calls is the launch journey of POO-2177
(`src/features/manager/fund/launch/README.md`), which the Review page (POO-2172) starts after readiness and persistence checks. A short folder guide
sits beside the code, in `src/features/manager/fund/build/README.md`.

**Folder map** (`src/features/manager/fund/build/`; every file carries its id in its header):

| Folder | Ids | What it owns |
|---|---|---|
| `build/` (root) | `PP-MGR-SCR-002` | `BuildScreen.tsx` joins the plan, the viewport, the layout, the renderer and the controller, answers Next: Review, and every way out of the step passes the selection guard; `buildScreenModel.ts` is its pure part (the ordered Next: Review checks, what to reveal after a change); `buildAnalytics.ts` maps the canvas outcomes to the analytics events. They ride on the id of the screen and take none of their own |
| `plan/` | `PP-MGR-LIB-021`, `PP-MGR-HOK-007` | The plan model, the rules (`planRules`), the pure reducers, `validatePlan` (INV1 to INV6), the derived facts, storage inside the draft, the `useBuildPlan` hook, and test support `planTestKit` |
| `canvas/` | `PP-MGR-CMP-045` to `047`, `PP-MGR-LIB-022`, `PP-MGR-HOK-008` | The Build step frame (`BuildStepLayout`), the clipped canvas with zoom, pan and fit (`CanvasViewport`, `useCanvasViewport`, `viewportMath`) and the panel slot (`BuildPanelSlot`) |
| `layout/` | `PP-MGR-LIB-023` | The pure layout function, its types and `GRAPH_TARGET_ATTR`, its constants (`LAYOUT`), `toLayoutInput` and test support `layoutTestKit` |
| `pieces/` | `PP-MGR-CMP-048` to `055` | The presentational pieces: spine card, position card, flow pill, share label, insert port, spoke group, edges, the two templates. Strings arrive as props; they import nothing from `plan/`, `layout/`, `blocks/` or `graph/` |
| `blocks/` | `PP-MGR-LIB-024`, `PP-MGR-CMP-056`, `057`, `PP-MGR-HOK-009`, `PP-MGR-HOK-010` | The block registry and its copy, the menu models, the palette, the menu and its popover, the selection guard and the controller (`useBuildCanvas`); the panel stub `PP-MGR-CMP-058` is removed |
| `panel/` | `PP-MGR-CMP-061` to `068`, `PP-MGR-HOK-014`, `PP-MGR-LIB-029`, `PP-MGR-LIB-030` | The configuration panel shell (POO-2187), its kind to body registry, its shared controls and its draft, and the range and slippage maths |
| `graph/` | `PP-MGR-CMP-059` | The renderer `BuildGraph` (layout, pieces, selection and active targets in, presses out), its reading-order model, `useGraphLayout` and `useTextWidth` |

The reference canvases live in `src/mocks/data/buildCanvasFixtures.ts` (`PP-MGR-MCK-004`). The components have
stories in their folders (the helpers `AnchoredPopover` and `BlockMark` are shown through the menu and palette
stories). Legality is decided in one place, `plan/` (`kindAvailability`, `portSlotsOf`, `insertOptions`, the
reducers); the layout, the registry and the menus read it, and the registry's own `placement` field is held
equal to the reducers by a test.

**The plan model in five lines.**

1. `BuildPlan` is `{ version: 1, hub: { chains }, spokes: [{ network, sharePct, chains }] }`, hub chains and
   spokes left to right; a `Chain` is `{ id, sharePct, steps }`, its steps top to bottom.
2. A step is a position block (a card: `uniswapV4Pool`, `aaveSupply` and `aaveBorrow` are enabled;
   `uniswapV3Pool`, `pendle` and `gmxPerp` are coming soon and are never created) or a flow block (a pill:
   `swap` or `collectFees`, with `auto: true` for the ones the app owns and the manager cannot add or remove).
3. A position block's `config` is `null` while the block is empty (every block a manager adds in this batch),
   else `{ poolId }` or `{ assetKey }`; "configured", a card's title and caption and the Swap · auto above a
   block all derive from it (HU2).
4. `sharePct` is a percentage of the strategy's capital: hub chains plus spokes at most 100, a spoke's chains
   at most the spoke's share (INV3). A block that is not the first of its chain has no share.
5. The reducers (`addChain`, `addSpoke`, `removeSpoke`, `insertAt`, `removeBlock`, `setBlockConfig`,
   `setChainShare`, `setSpokeShare`, `reconcileAutoBlocks`) are pure and immutable and return the new plan or
   `{ blocked: { reason } }`; the plan is an optional field of the mandate draft (`MandateDraft.plan?`, with
   `lastPhase?`), saved in the same `localStorage` payload.

**The layout is derived and never stored.** Positions and sizes, the Bridge of a spoke, the Income (fees)
block, the return lines, the insert ports, the template positions, a block's network (the group it sits in,
C5) and a card's title and caption are computed from the plan and from nothing else. `toLayoutInput(plan)`
maps the stored plan onto a structural `LayoutInput`, `layoutGraph(input, { startHereWidth })` returns the
`GraphLayout` (the box of every node, the centre line of every 1.5 px stroke, labels, ports, groups,
templates, the graph size), and `BuildGraph` draws it. Every distance is in `LAYOUT` (C21). Pan and zoom live
in the viewport and never lay the graph out again; any change to the plan recomputes it (C1, C18). The Bridge
exists only for a spoke, and a spoke exists only when Robinhood Chain is in the mandate, which preselects Across
and makes it mandatory; a hub-only Arbitrum fund has no Across, no spoke and no Bridge.

**Adding a block kind: the registry is the place.** Availability is data: moving a kind between enabled and
coming soon is one line of `BLOCK_KIND_STATUS` (`plan/buildPlan.ts`), which is how Borrow moves in the slice
that follows from D29. Making a coming-soon kind placeable takes more: Uniswap v3 positions also need the mandate
catalog to offer `uniswap-v3` again (`UNAVAILABLE_PROTOCOLS` in `mandateDraft.ts`, read by `mandateCatalog.ts`, POO-2167), and Pendle and GMX
have no `ProtocolId` (`BLOCK_KIND_PROTOCOL` is null and their config is `never`), so they follow the full list
below. A new position kind needs, in order: its entry in `BlockKind`, `BLOCK_KIND_STATUS`, `BLOCK_KIND_PROTOCOL`
and `BlockConfigByKind` (`plan/buildPlan.ts`); the stored-plan check in `plan/planStorage.ts` (`POSITION_KINDS`
and `isConfigFor`: a kind missing there makes every stored plan that holds it unreadable, and the draft loses
its plan, D18); the sequence rules it follows in `plan/planRules.ts` and `plan/planInvariants.ts`; its definition
in `BLOCK_REGISTRY` and its title and caption in `blocks/blockRegistry.ts` (`titleAndCaption`, `describeBlock`);
for a pool-like kind, `isPoolKind` (`plan/planRules.ts`), `portTooltipKey` (`graph/graphModel.ts`) and
`cardContent` (`graph/BuildGraph.tsx`), which TypeScript does not flag when they are missed; the keys
`fundBuilder.canvas.blocks.<kind>.protocol` and `.type` read in `blocks/blockCopy.ts`, in all 11 locales
(`pnpm i18n:check`); and a block sheet in Linear (POO-2160 to POO-2166 are the sheets of today's kinds).

**Coordinator defaults a product owner may overturn.** The handoff names its own open points; the coordinator
applied a default so the slices could proceed (the plan comment on POO-2144 is the record). Each one is
overturnable. The handoff (v1.3, open point 12) asked Murilo to decide Borrow, and he did on 2026-10-04 (D29).

| Id | Point | Default |
|---|---|---|
| D1 | Sequences with more than one position | The renderer and `validatePlan` accept any plan that satisfies INV5 (canvas A is valid); port menus offer only the I4 list, plus Swap after a Borrow |
| D2 | Collect fees with a pool | Not added with the pool; the manager places it (the recommendation to add it waits for the panel batch) |
| D3 | Spoke share | `Spoke.sharePct` is stored and shown above the Bridge; new spokes and chains start at 0%; the unallocated share is not printed |
| D4 | No network left to add | The Add network box stays; its menu shows the footer and the link; the press reports `no_network_left` |
| D5 | Remove a network, remove a block | A close control on the chip of a spoke with no chain; Remove block acts at once with an undo toast; the `confirmRemove` seam waits for the panel |
| D6 | Mandate edited after the plan exists | Never delete silently: blocks that no longer fit show "No longer in your mandate" and Next: Review refuses |
| D7 | USDG on Robinhood Chain | Swap · auto and Bridge tooltips take `{token}` from `networkStableSymbol(network)`, never a literal USDC. The registry deviates once, approved in the review of PR #36: Swap · auto names the token that actually arrives (a Borrow's asset after a Borrow) |
| D8 | Zoom, motion, hover | 10% steps from 25% to 150%, fit may go lower; re-flow 150 ms ease-out, none under reduced motion; card hover border `muted-foreground`; no animation in the viewport itself |
| D9 | Where the plan lives | Only in the draft (the browser store). Product owner rulings of 2026-10-03: no backend strategy drafts, no fund creation through the API, the Uniswap v4 pool and Aave reserve catalogs come from the backend API (POO-2146, delivered and read by the Mandate since POO-2133), no sample data in real mode. The second ruling was superseded for the demo by Rafael's decision of the same day (POO-2147): fund creation through the API exists and the launch journey (POO-2177) calls it; the canvas itself still writes only the draft |
| D10 | Hub with no chain beside a spoke | The hub's Add protocol circle sits at the left end of the row (x 24) |
| D11 | Long captions | One line with an ellipsis, the full text in a tooltip; the card stays 62 high |
| D12 | Coming-soon rows against rule A4 | A fixed product list, disabled, shown in every Add protocol menu and in the palette whatever the mandate; A4 is read as "every enabled option" |
| D13 | Port tooltip | One tooltip per slot naming what its menu offers, instead of the single handoff string |
| D14 | Shape of `config` | `{ poolId }` and `{ assetKey }`, extended by the panel batch; a manager Swap has no config |
| D15 | Fixtures that name Base | Fixtures are `LayoutInput` (networks are strings); `BuildPlan` stays strict on `NetworkId` |
| D16 | Resume on Build | Optional `lastPhase` on the draft, written on every save as the phase the manager is in; the Console Open adds `&phase=build` for a completed draft whose last phase is Build |
| D17 | Unsaved check | `planFingerprint` joins the unsaved fingerprint; plan edits never un-complete the mandate |
| D18 | Unreadable stored plan | The draft is kept and only the plan is dropped (every block is empty in this batch); the Build screen says so with the empty canvas under the message and reports `builder_build_error` (`PLAN_UNREADABLE`) |
| D19 | Next: Review | Never disabled; ordered checks (empty plan, a block or network no longer in the mandate, a coming-soon block, an empty block, shares over the capital above them), then "Review is not available yet"; each refusal shows an inline notice (`fundBuilder.canvas.review.*`) and reports `builder_build_blocked` (shipped by POO-2157) |
| D20 | Analytics names | `builder_build_viewed`, `builder_build_started`, `builder_block_added`, `builder_network_added`, `builder_network_removed`, `builder_flow_block_inserted`, `builder_block_removed`, `builder_block_restored`, `builder_build_blocked`, `builder_build_abandoned` and `builder_build_error`; `builder_build_landing_viewed` is retired (shipped by POO-2157, `docs/ANALYTICS_EVENTS.md`). POO-2187 later retired `builder_block_restored` with the Undo toast and added the configuration panel's five events |
| D21 | Menu popover | The new dependency was NOT approved: the menus use the in-house `AnchoredPopover` behind a narrow interface, so swapping it later touches one file |
| D22 | Drag | Native pointer events, no library; the menus are the keyboard path |
| D23 | Grid width | The Build phase uses the full content width (canvas column about 604 against 656 in Figma) |
| D24 | The Build placeholder | `FundBuildLanding` is deleted (POO-2157); `MandateSummaryCard` is kept for Review and no screen renders it until Review exists |
| D25 | Palette | Enabled kinds of the mandate's protocols; Collect fees only with an enabled pool protocol; the column scrolls inside itself past 640 |
| D26 | Share label of a spoke | Selects nothing (it feeds the Bridge, which is not selectable) |
| D27 | Invalid and coming-soon cards | Invalid: `destructive` border and caption; coming soon: the "Soon" tag. Both block Next: Review |
| D28 | Locales | 11, the repository's config, not the 12 the handoff names |
| D29 | Aave v3 Borrow | Stayed enabled as handoff C22 says, although the fund contracts are supply only. **Decided 2026-10-04 (Murilo): Borrow becomes coming soon, like Pendle and GMX, and the insert port under a Supply goes away.** The code does not do this yet: a later slice (PA0) moves it, by one line of `BLOCK_KIND_STATUS` plus the port and two strings (the `portAfterSupply` tooltip and the Borrow menu row), so today Borrow is still offered. `docs/COMPLIANCE_REGISTER.md` `CR-MGR-016` |

Two readings in code are the coordinator's, not the handoff's: INV5 reads "nothing follows a pool except its
Collect fees" as "a pool, or its Collect fees, ends the chain" (`plan/planInvariants.ts`), and normalisation
(L4) only ever shifts the graph to the right (`layout/layoutGraph.ts`).

**Delivered configuration and Review.** The registered Uniswap v4 and Aave USDC Supply bodies use
live catalog data, shared Apply/Discard guards and atomic allocation/configuration writes. Review
binds the saved fields, balance, upload and launch/resume journey. See the panel and Review sections
below and the [delivery source map](../../../docs/STRATEGY_BUILDER_DELIVERY_2026-10-04.md).

**Remaining scope.** Borrow's coming-soon palette cleanup (PA0) is deferred by the accepted demo
plan; Borrow cannot pass launch readiness. Swap/Bridge quote previews on the canvas (POO-2148),
backend drafts (POO-2132), mobile and the existing compliance disclosures remain separate work.
The canvas itself sends no transaction; the existing launch journey compiles the applied plan.

**Browser verification.** Murilo owns the full journey test for this delivery. Codex has not run it. The automated component tests run in jsdom, which has no layout engine, no canvas
text measure and no Safari gesture events. The stories exist for every component and for the graph on every
reference canvas, but no one has opened them next to the Figma frames. The check that the page never scrolls
sideways because of the graph (A7) is the play function of the `WideGraphNoPageScroll` story; no CI job runs
play functions (CI only builds Storybook) and it has never been run, so A7 is unverified. The Safari pinch path
of the viewport is untested (a note in `useCanvasViewport.ts`). The first browser check is Murilo's own browser
test, which includes the rendered parity of A2.

### Parity record (A2, POO-2158)

What was compared: the layout function against the Figma reference canvases, node by node, as measured by the
layout slice (POO-2153) in Figma file `jjOf5DL9uVEB7WBR9nGb4A`, Drafts page, section "Strategy Builder · fund
contracts", read on 2026-10-03 after the Swap · auto redraw. The measurements and the assertions are
`src/features/manager/fund/build/layout/layoutGraph.oracles.test.ts` over the fixtures of
`src/mocks/data/buildCanvasFixtures.ts`; nothing was re-measured for this record. The handoff's tolerance is 1
px; the oracles are tighter.

| Reference | Frame | Graph node measured | Fixture | Graph size asserted | Layout oracle |
|---|---|---|---|---|---|
| Canvas A, complex | [8099-2757](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/Pool-Party-V2?node-id=8099-2757) | 8219:2481 (the frame is 2356 wide because the open menu is drawn inside it) | `canvasA` | 2080 x 772 | Matches |
| Canvas B, intermediate | [8119-2723](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/Pool-Party-V2?node-id=8119-2723) | 8207:2481 | `canvasB` | 1248 x 624 | Matches |
| Canvas C, simple (worked example 1) | [8119-2921](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/Pool-Party-V2?node-id=8119-2921) | 8220:2481 | `canvasC` | 608 x 674 | Matches, and every row of the handoff table |
| Canvas D, empty (Build state 1) | [8119-3062](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/Pool-Party-V2?node-id=8119-3062) | 8172:2110 | `canvasD` | 468 x 572 (English sentence 420 wide) | Matches |
| Build state 3, block added, empty, selected | [8130-4133](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/Pool-Party-V2?node-id=8130-4133) | 8130:4749 (drawn at 100%) | `buildState3` | 400 x 576 | Matches |
| Build state 5, one configured chain with Collect fees | [8145-2061](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/Pool-Party-V2?node-id=8145-2061) | 8145:2689 (drawn at 0.8981, divided back) | `buildState5` | 552 x 650 | Matches, and the handoff's normalisation numbers (shift 76) |

How a layout is "matching": every box of a node is equal to the frame's (exact, 0 px); the full list of line
rectangles is equal as a multiset (Figma draws each segment as a 1.5 px rectangle); ports are exact; share
labels and network chips are within 0.5 px (Figma centres a 45 px label at x + 22.5, and a 21 px chip on the 228
border sits at 227.5); for Build state 5 each Figma number divided by the scale is within 0.01 of the oracle.
Beside the frames the handoff's own numbers are asserted: worked example 1 (canvas C, 608 x 674), worked example 2
(928 x 772, computed in the handoff, not drawn: fixture `workedExample2`, no frame), the state 5 normalisation and
canvas D's shift of 32. Two fixtures have no frame and no oracle against Figma: a new spoke with no chain
(`newSpokeNoChain`, ST9) and a hub with no chain beside a spoke (`hubEmptyWithSpoke`, open point 10, default
D10); `layoutGraph.test.ts` exercises them. The 48 tests of the oracle file pass on the merged tree (run on
2026-10-04).

What the record does NOT cover, so nobody reads more into it: it compares geometry, not pixels. The rendered
graph at 100% next to the frames (the second half of A2) has not been done and is now Murilo's own browser test:
the `BuildGraph` stories pin only the graph's outer box against the layout's size. Pieces were checked against
Figma where a review measured them (the pill stroke, nodes 8220:2482 and 8220:2501; the share label, node
8220:2556), not as a set. The canvas column is about 604 wide at the app's content width against 656 in Figma
(D23). Build state 2 (the Add protocol menu, 8130-3408) has no geometry oracle: its rows are asserted by the menu
model tests and drawn by the `CanvasMenu` and `BlockPanel` stories (the panel stub `PanelStub` that first drew it
was removed by POO-2187). The right-hand panel of states 3 and 5 is the configuration panel's and is not compared
here. The oracle file records no delta between a handoff number and a frame.

## IDs

| ID | Type | Name | Status | Test coverage |
|----|------|------|--------|---------------|
| `PP-MGR-SCR-004` | Screen | Strategy manage detail | Done | via `mapManagerStrategyDetail` + `StrategyManageView` tests |
| `PP-MGR-CMP-029` | Component | AllocationCard | Done | via `StrategyManageView` |
| `PP-MGR-LIB-006` | Lib | buildSpark | Done | 100% |
| `PP-MGR-LIB-007` | Lib | buildManagerAllocation | Done | 100% |
| `PP-MGR-LIB-008` | Lib | buildStrategyMetadata (+ POO-830 `objectiveTags`) | In Review | 100% |
| `PP-MGR-LIB-016` | Lib | deriveBuilderStrategyTags (POO-830 PR3; builder asset+objective adapter) | In Review | `deriveBuilderStrategyTags.test.ts` (determinism table) |
| `PP-MGR-LIB-015` | Lib | embeddedManagerIdentitySchema (POO-771; shared with strategies/portfolio) | In Review | via mapper/schema tests |
| `PP-MGR-CMP-033` | Component | ManagerAvatar (POO-771; img + monogram fallback + onError) | In Review | `ManagerAvatar.test.tsx` |
| `PP-MGR-CMP-034` | Component | SocialChips (POO-850; public-profile chips + website external-link warning) | In Review | `SocialChips.test.tsx` |
| `PP-MGR-HOK-001` | Hook | useCreateStrategyMetadata | In Review | via hook + ReviewStep tests |

## Integration points

- `mapManagerStrategyDetail`: real-sourced core fields (pair, fee tier, TVL, fees, in/out-of-range,
  range prices, reserves); `activity` / `comments` served by the backend later (POO-380).
- `buildManagerAllocation`: client-side value split today; the indexer's per-position balances
  joined with the mandate replace it in the future multi-protocol version (POO-380).
- **Embedded public manager identity (POO-771, rules v1, consumes POO-758):** `embeddedManagerIdentitySchema`
  (`src/lib/manager/managerIdentitySchema.ts`, PP-MGR-LIB-015) is the shared Zod for the `{ handle,
  displayName, avatarUrl, verified }` object the backend now embeds ON the strategy catalog / detail /
  portfolio payloads, so the investor surfaces render `@handle`/avatar/verified with zero extra requests
  (retires the PR #512 registry fan-out). `ManagerAvatar` (PP-MGR-CMP-033) renders the manager avatar with
  a monogram fallback (first alphanumeric char, never "@") + `onError` recovery, used by ManagerCard + the
  detail hero. `fetchManagerProfile` stays the sole full-profile source (`/m/<handle>` + console). All
  embedded fields are `.nullish()`, so an older backend degrades to wallet-only, never blanking a screen.
- `useCreateStrategyMetadata` (POO-308, rules v1): real-mode Launch persists the strategy metadata the
  on-chain build drops. It signs (`signWrite`, POO-637) + POSTs the metadata to `POST /api/v2/strategies`
  BEFORE the tx (→ pending `strategyId`), then signs + POSTs `{txHash}` to
  `POST /api/v2/strategies/:id/confirm` after the send mines; the strategy renders with a pending badge
  that POO-638 convergence clears → live. The v2 write field names + `@SignedWrite` action tags
  (`strategy.create` / `strategy.confirm`) are the ASSUMED contract (`PP-INTEGRATION-POINT`), gated behind
  `!isMockMode`. **Partially delivered (POO-721):** the holdings/console catalog now reads the v2
  `/strategies` list directly (`listStrategiesForHoldings`), so persisted v2 metadata — incl. `logoUrl`
  — flows through `mapStrategyV2`. Still deferred: hydrating the richer prospectus (category / detail)
  from v2; the derived pair-based value stays the fallback for those.
- **Strategy category tags at creation (POO-830 PR3, rules v1):** `deriveBuilderStrategyTags`
  (PP-MGR-LIB-016) maps the Build-step pool pair + current price + range into the shared
  `deriveStrategyTags` input (mint composition from `tokenSplit`), giving the read-only ASSET +
  OBJECTIVE preview shown live in `DerivedMandateCard` (gated behind the `strategyCategoryFilter`
  dark-launch flag) and the OBJECTIVE persisted through `buildStrategyMetadata.objectiveTags` on the
  signed metadata POST. Asset tags are pair-derivable (no persistence); the objective is NOT, so the
  backend must persist + serve it (PP-INTEGRATION-POINT in `mapStrategyV2`; see INTEGRATION_POINTS).
  Mock fixtures with a real pool pair carry a plausible `objectiveTags` (delta-neutral ETH/USDC →
  `['income']`); pool-less mandate strategies leave it undefined.
- **Wrapped-native seed funding selector (POO-878 / POO-882, rules v1):** the create-pool seed leg
  for the chain's wrapped-native token (WETH on Base/Arbitrum, WPOL on Polygon) can be funded from the
  manager's native coin (`msg.value`) OR the wrapped ERC-20 via Permit2. `SeedLiquidityCard` reads
  BOTH balances, shows an explicit native/wrapped selector, defaults to native (auto-switching to the
  wrapped ERC-20 only when native alone can't cover the amount but the wrapped balance can), and
  validates against the SELECTED source; the zero-balance prompt fires only when NEITHER source can
  cover the leg. The choice rides up as `SeedState.wrappedNativeFunding` → `createPoolInput` →
  `CreatePoolRunInput` → the `buildCreatePoolTxAction` body so the API sets `tx.value` to match what
  the FE showed, per chain (fixes the Polygon WPOL/native inversion, POO-882). **PP-INTEGRATION-POINT
  (BE half, still pending):** the pool-party-api create-pool build must honor `wrappedNativeFunding`
  (`portfolio.service.ts:561-571`, and Polygon's `getWETHContract` sentinel); until it does, the field
  is a no-op on the server. **Live-verify TODO (POO-882):** confirm the Polygon path end-to-end
  (POL-only + WPOL-only wallets) once the BE half lands.


### Review form cards (POO-2188, RB1, rules v1)

`fund/review/` supplies props-only identity, fee, investor-term and first-deposit cards
(PP-MGR-CMP-073..076). `reviewForm` (PP-MGR-LIB-033) sanitizes fee and USDC input, clamps
fees before calling the parent, formats raw integer amounts, and returns field reasons in
screen order. Minimum precedes instant withdrawal fee. Stories use `reviewStoryKit`, with
no wallet provider and no new mock artifact. New copy exists in all 11 configured locales;
the eight machine-translated locales retain the POO-231 native-review policy.

The cards accept the existing Review hook's balance, fee provenance and `previewSeed`
estimate. These are estimates before signing; the creation receipt confirms charged
amounts. Identity remains editable after launch, fees may only decrease, and minimum and
instant withdrawal fee are fixed. Access is Public. Operating cash, risk, return and gas
figures are absent. The RB2 assembly owns persistence, launch gating and analytics.


### Review assembly (POO-2195, RB2, rules v1)

A guarded, ready Build saves the applied plan and `lastPhase: review`, then opens Review.
`ReviewPhase` (PP-MGR-CMP-077) binds the RB1 cards to `useV2ReviewDraft`; Back, mandate edits,
Save & exit and reload preserve its stored fields. Mock mode renders a reason without
mounting real wallet hooks. Investor, mandate/Build and launch previews (CMP-078..080)
derive from current valid fields, saved selections, applied positions and `getLaunchSteps`.
Signature counts say up to and distinguish transactions from profile messages.

Launch stays enabled to reveal the first field or Build reason in screen order. A ready
click calls `startFundLaunch` once; an existing checkpoint offers Resume without changing
the journal. Fallback Review remains available. Borrow, unsupported catalog data and
nonexecutable continuations fail closed. All new copy is present in 11 locales.
