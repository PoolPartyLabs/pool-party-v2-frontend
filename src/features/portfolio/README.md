# Feature: Portfolio

Holdings & performance for the connected investor: a value hero + chart, allocation-by-risk, the
summary KPIs, the active "Your positions" list (sortable, POO-829), and an on-demand "Show closed
strategies" history.

## i18n namespace

`portfolio.*` (files in `src/i18n/messages/[locale]/portfolio.json`). The mobile sort control reuses
the shared `strategies.explore.sortLabel` / `sortDir.*` copy (same strings as Explore's control).

## Data path (mock vs real)

- **Mock mode**: the route (`src/app/[locale]/(auth)/(app)/portfolio/page.tsx`) SSRs the mock positions
  through `buildPortfolioViewModel` (which sums KPIs over the full mock set and pins closed-first) and
  renders `PortfolioView` with the POO-629 document-scroll windowing. `PortfolioView` sorts every
  column **client-side** (POO-829 R6), default Yield descending, with the closed-pinned floor as the
  PRIMARY sort key (POO-457) and the selected column as the secondary key.
- **Real mode (POO-829, v3 — both lists server-paged)**: the route renders `PortfolioPagedLoader`:
  - the **active "Your positions"** list is **SERVER-paged** (`?closed=none&page&limit=5`,
    `useServerPage` over `loadPortfolioPageAction`, SHORT-PAGE termination, its own "Load more") and
    **SERVER-sorted** (`&sorting=<field>:<dir>`, POO-828 sorts the FULL holdings before slicing;
    default `totalYield:desc`). A header/mobile-control sort change **resets the pager to page 0**.
    This retired the POO-668 v2 active drain (`fetchActivePortfolio` / `getActivePortfolioAction` /
    `useActivePortfolio`), unblocked by POO-696;
  - **ALL KPIs** come from the backend **GRAND aggregates** (`mapAggregatesToKpis`): balance / fees /
    claimable (POO-668 R3) and, since **POO-696**, `avgApr` + per-risk `allocation` too — with a
    client-compute fallback (`computeApyAndAllocation`) over the LOADED active rows while absent;
  - sortable columns (POO-829 R3): **Invested / Current Value / Yield / Rate** (backend fields
    `invested` / `currentValue` / `totalYield` / `feesApr`). **Risk is a dead header in paged mode**:
    POO-828 defers `riskLevel` (not carried on the portfolio payload; silently ignored), so its header
    renders as plain text (POO-734's rule) and the mobile dropdown omits it. Mock mode sorts all five;
  - the **"Show closed strategies"** history stays **backend-paged** (`?closed=exited&page&limit=5`),
    **lazy** (loaded on first reveal), its **own "Load more"**, backend **closed-with-balance-first**
    order **verbatim** (POO-457 R6 — never sorted, no client re-sort);
  - a 45s interval + focus/visibility refresh re-reads the loaded pages of BOTH lists IN PLACE via
    `useServerPage.refresh()` — a same-ids refetch is a refresh, not a reset, so scroll survives;
  - both lists render **plainly** (`PortfolioView`'s `paged` prop disables the windowing);
  - a sort change emits the typed `portfolio_sort_changed` event (POO-829 R7).

## IDs

| ID | Type | Name | Status | Test coverage |
|----|------|------|--------|---------------|
| PP-PORT-SCR-001 | Screen | Portfolio (`PortfolioView`, sortable columns POO-829) | Done | via tests |
| PP-PORT-SCR-001 (loader) | Loader | PortfolioPagedLoader (real: active + closed server-paged, active sorted) | In Review | `PortfolioPagedLoader.test.tsx` |
| PP-PORT-CMP-001 | Component | Portfolio summary | Done | — |
| PP-PORT-CMP-002 | Component | PositionCard | Done | `PositionCard.test.tsx` |
| PP-PORT-CMP-003 | Component | AllocationByRisk | Done | `AllocationByRisk.test.tsx` |
| PP-PORT-CMP-004 | Component | Windowed lists (`WindowedTableBody`/`WindowedCardList`, `disabled` opt) | In Review | `WindowedList.test.tsx`, `PortfolioView.virtualize.test.tsx` |
| PP-PORT-LIB-001 | Lib | fetchPortfolioPage (server-only single page + aggregates + `sorting`) | In Review | `fetchPortfolioPage.test.ts` |
| PP-PORT-LIB-002 | Lib | joinPositionsToStrategies (shared position→strategy join) | In Review | `joinPositionsToStrategies.test.ts` |
| PP-PORT-LIB-003 | Lib | mapAggregatesToKpis (grand aggregates + computed APY/allocation → KPI props) | In Review | `mapAggregatesToKpis.test.ts` |
| PP-PORT-LIB-004 | Lib | computeApyAndAllocation (shared value-weighted APY + allocation helper) | In Review | `computeApyAndAllocation.test.ts` |
| PP-PORT-LIB-005 | Lib | fetchActivePortfolio — **Removed** (POO-829: the active list left the drain for server paging) | Removed | — |
| PP-PORT-HOK-001 | Hook | useActivePortfolio — **Removed** (POO-829: superseded by `useServerPage` in the loader) | Removed | — |

Shared paging seam (`src/lib/api/`): `pagination` (PP-CORE-LIB-032), `useServerPage` (PP-CORE-HOK-021).

## Integration points

- `loadPortfolioPageAction` → `fetchPortfolioPage` (ONE page, either feed) ←
  `GET /portfolio/:wallet/all?closed=none|exited&page&limit[&sorting=<field>:<dir>]`
  (positions + grand aggregates). Wallet is server-trusted from the SIWE session (POO-270).
- **Sorting (POO-828, verified):** backend sort fields are exactly `totalYield` / `currentValue` /
  `invested` / `feesApr` (`portfolio-sort.ts` in pool-party-api); `riskLevel` is deferred (silently
  ignored), so the FE emits no `sorting` for the Risk column and its paged header is dead (POO-734).
- **KPIs:** `invested` reads the grand `totalInvestedUsd` cost-basis aggregate (POO-832, balance
  fallback). `avgApr` (fee APR) + per-risk `allocation` are served as backend grand aggregates
  (**POO-696**) and read straight from `/portfolio/:wallet/all`; the client-side
  `computeApyAndAllocation` over the LOADED active rows is **kept as the fallback**
  (deploy-order-independent, and resilient when the aggregate is absent or its shape drifts, since the
  tolerant `allocation` schema degrades to the fallback instead of failing the whole parse).
- Hero value series ← analytics `investor_portfolio.series` (POO-368), `<2 points` → honest-empty.
- **Embedded manager identity (POO-771, consumes POO-758):** each position row now carries a root-level
  `manager: { handle, displayName, avatarUrl, verified } | null` (`apiPositionSchema`, declared HERE so it
  is not stripped by the plain `z.object`). `synthesizeStrategyFromPosition` passes it through so a CLOSED
  holding absent from the catalog still renders `@handle`/avatar/verified; `PositionCard` gates its verified
  badge on `strategy.managerVerified`. All optional/`.nullish()` → wallet-only fallback on an older backend.

## Notes

- Home's "Your positions" preview is OUT OF SCOPE for POO-668/POO-829 (stays a fixed first-3 with
  "See all" → Portfolio); this only paginates/sorts the Portfolio-page lists.
- The mock-mode windowing (POO-629) and its tests are unchanged; the paged path (real mode) supersedes
  windowing by passing `disabled` to the Windowed components (POO-668 R5).
- The "N active" chip counts the LOADED rows in paged mode (the backend `totalPositions` over-counts a
  filtered read, so there is no honest active grand total to show yet).
