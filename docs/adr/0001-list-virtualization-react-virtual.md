# 0001. List virtualization with @tanstack/react-virtual

- Status: Accepted
- Date: 2026-07-06
- Linear: POO-624 (preflight) under the POO-623 epic
- PR: (this PR)

## Context

Several already-launched investor and manager surfaces render long lists with a plain `.map()` (the
strategies explore grid, portfolio positions, token/network pickers, manager pool tables). At real
scale these mount every row up front, so scroll jank and mount cost grow linearly with list length.
The POO-623 epic introduces **windowed virtualization** (render only the visible rows plus a small
overscan) on those surfaces without changing what a user sees.

This decision is hard to reverse cheaply: it picks a library, a DOM technique that other CSS/table
code must respect, a responsive strategy, and a rollout/fallback contract. Getting any of these
wrong silently (e.g. absolutely-positioned rows in a `<table>`, or a flag that doubles as a launch
gate) would corrupt layout or the feature-flag model across every consuming surface. Hence an ADR
rather than a PR note.

## Decision

**We virtualize long lists with `@tanstack/react-virtual`, pinned to exactly `3.14.2`**, promoted
from a transitive dep (it already ships under `@privy-io/react-auth` and `@headlessui/react` against
`react@19.1.0`) to a **direct** dependency. Headless, framework-agnostic, tiny, React 19 ready, no
new transitive weight since it is already in the tree.

The following rules bind every surface the epic touches:

1. **Technique A - in-flow spacer rows for tables.** In a `<table>`/`<tbody>`, the windowed rows stay
   in normal table flow and the off-screen space above and below is reserved by **two empty spacer
   `<tr>`s** whose single `<td>` carries the pixel height (top pad = `items[0].start`, bottom pad =
   `totalSize - items[last].end`). This keeps `colgroup` widths, sticky headers, and border-collapse
   correct.

2. **ABSOLUTE-ROW BAN in tables (hard rule).** Never position rows with
   `position: absolute; transform: translateY(...)` inside a table. Absolute rows leave the table
   layout algorithm, collapsing column widths and breaking sticky headers and zebra striping. The
   `transform`/absolute technique is permitted ONLY for non-table containers (a plain scrolling
   `<div>` list) where there is no table layout to preserve.

3. **Chunk, don't lane, responsive grids.** For a responsive multi-column grid we virtualize by
   **row chunks**: group the flat item array into rows of N (N = the current column count from the
   active breakpoint) and virtualize the chunks, each chunk rendering its own CSS grid row. We do
   **not** run one virtualizer per column ("lanes"): lanes desync scroll math across columns and
   fight the responsive breakpoint. Column count changes recompute the chunking.

4. **Gate + threshold + layout fallback.** Windowing is opt-in behind the **`virtualize`**
   feature flag (`NEXT_PUBLIC_FEATURE_VIRTUALIZE`, default **off** = plain `.map()` baseline). It is
   a **presentational rendering-strategy flag, NOT a route/launch gate**, and is orthogonal to
   `isManager` (role) and `isMockMode` (data). Even with the flag on, a surface only virtualizes when
   **both** hold: (a) item count `>= THRESHOLD` (**500**) - below that the plain map is cheaper than
   the virtualizer's overhead and avoids its measurement edge cases; and (b) `hasLayout` is true - a
   measurable scroll container. When there is no real layout (SSR, `hasLayout === false`, e.g. jsdom
   with no shim) the surface **falls back to the plain `.map()`** and renders the full list. The
   fallback is a correctness guarantee: virtualization must never be the reason content is missing.

5. **RESET vs DO-NOT-RESET asymmetry (state contract).** The virtualizer's measurement cache and
   scroll position are **reset only when list identity changes** - a new filter, sort, search, or
   route that yields a genuinely different list. They are **NOT reset on a background refetch of the
   same list** (post-write refresh, cache-tag revalidation, poll): re-measuring on same-identity data
   throws away scroll position and remounts rows, producing a visible jump under the throttle-driven
   refresh cadence. Concretely: key/reset the virtualizer on the query key / filter tuple, and do
   NOT reset it on a data-array reference change alone.

## Consequences

- **Easier:** long lists mount O(viewport) instead of O(n); the flag lets us dark-launch per surface
  and roll back instantly by flipping one env var; the plain-map baseline stays the source of truth
  for correctness (same rows, same order, same empty/error states).
- **Harder / committed to:** every consuming table must honor Technique A and the absolute-row ban;
  responsive grids must compute column count and chunk accordingly; each surface must wire the
  `>=500` threshold and the `hasLayout` fallback rather than virtualizing unconditionally; and the
  refetch reset asymmetry has to be respected everywhere the post-write refresh runs.
- **Testing (jsdom):** jsdom has no layout, so windowed-list tests use the **opt-in**
  `tests/virtualizationLayout.ts` shim (`setupVirtualizationLayout()`), which is imported per-test,
  never wired into `tests/setup.ts`, and never overrides `Element.prototype` globally (that would
  clobber per-instance `getBoundingClientRect` spies such as `PerformanceChart.test.tsx`).

### Mandatory regression tests (required deliverables of later PRs)

These three tests are **acceptance gates**, not optional:

- **PR4 - drain/clamp:** a windowed list of a full page of items renders **every** item across the
  scroll range (drain the window top-to-bottom and assert the union equals the plain-map set), and
  the top/bottom spacer padding **clamps** to non-negative pixel values at both ends (no negative pad
  at the first/last window). This locks in that virtualization never drops or duplicates rows.
- **PR5 - no-reset-on-refetch:** a background refetch of the **same-identity** list does **not** reset
  scroll position or re-measure (the DO-NOT-RESET half of rule 5).
- **PR5 - reset-on-identity-change:** a filter/sort/search change that yields a **different** list
  **does** reset the virtualizer (scroll to top, re-measure) (the RESET half of rule 5).

## Alternatives considered

- **`react-window` / `react-virtualized`.** Component-driven APIs that impose their own row/cell
  wrappers, which fight our table markup and responsive grid; `react-virtualized` is effectively
  unmaintained. `react-virtual` is headless, so our markup and Technique A stay ours. Rejected.
- **Hand-rolled `IntersectionObserver` windowing.** More code to own, and re-derives measurement,
  overscan, dynamic row heights, and scroll restoration that `react-virtual` already solves well.
  Fails the "code you never wrote" ladder. Rejected.
- **Adding a new copy of react-virtual / a caret range.** It is already in the tree at 3.14.2; a
  caret (`^3.14.2`) or a second install risks a silent minor bump and a duplicate. We pin the exact
  in-tree version to keep the lockfile resolution unchanged. Rejected in favor of the exact pin.
- **Always-on virtualization (no threshold, no flag).** Virtualizing a 20-row list costs more than a
  plain map and adds measurement edge cases; an always-on switch also removes our rollback lever.
  Rejected in favor of the flag + `>=500` threshold + `hasLayout` fallback.
- **Absolute-positioned rows everywhere (uniform technique).** Simpler to write once, but breaks
  table column widths and sticky headers. Rejected inside tables (allowed only for non-table lists).
