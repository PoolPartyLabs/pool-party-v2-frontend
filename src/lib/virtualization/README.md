# List virtualization (windowed lists)

`PP-CORE-HOK-019` `useVirtualizeGate` · `PP-CORE-HOK-020` `useVirtualizedRows` ·
`PP-CORE-LIB-028` row helpers · `PP-CORE-CMP-053` `VirtualTableBody` ·
`PP-CORE-CMP-054` `VirtualCardList` · Linear **POO-625** (PR1 of the **POO-623** epic).

Shared primitives that window long, already-launched investor/manager lists (explore grid, portfolio
positions, pickers, manager pool tables) so they mount O(viewport) rows instead of O(n) — without
changing what a user sees. Built on headless `@tanstack/react-virtual` v3 (`useVirtualizer` /
`useWindowVirtualizer`); we own the DOM.

Design contract: **`docs/adr/0001-list-virtualization-react-virtual.md`** — read it before touching
these. PR1 (POO-625) ships the primitives; wiring each surface lands in PR2–PR5.

## Consumers

- **Strategies · Explore** (`PP-STR-SCR-001`, POO-626, PR2) — the desktop sortable `<table>` and the
  mobile card `<ul>` window via `useVirtualizedRows({ mode: "window" })` on the **document scroll**
  (preserves Next 15 back/forward scroll restoration under the AppShell sticky sidebar). Both use the
  gate for the plain-map fallback; the table uses Technique A spacer `<tr>`s, the mobile list uses
  absolute `<li>` + `translateY` (allowed outside tables). The virtualizer's `scrollToIndex(0)` is
  driven from a list-identity `resetKey` (the filter/sort/search tuple) so a genuinely different list
  resets to row 0 while a same-identity background refetch does not.

## Pieces

- **`useVirtualizeGate(rowCount)`** — the SINGLE source of truth for "should this list window?" so no
  surface forgets a guard. `enabled` is true only when **all** hold: the `virtualize` flag is on,
  `rowCount > THRESHOLD` (**500**, exported), and `hasLayout` (a measurable scroll container,
  `clientHeight > 0` via a callback ref + effect). Any leg false → the caller renders the plain
  `.map()` baseline. Returns `{ enabled, containerRef }`.
- **`useVirtualizedRows(options)`** — wraps the virtualizer and layers the rules on: a `rangeExtractor`
  that force-pins the focused index ([R2]), a matchMedia-driven `laneCount` that chunks the flat array
  into grid rows ([R3]), `getTotalSize()` for the reserved scroll height ([R4]), and a clamped
  `scrollToIndex`. Returns the raw virtualizer plus `setScrollElement`, `getVirtualItems`,
  `getTotalSize`, `scrollToIndex`, `laneCount`, `rows`.
- **`rows.ts`** (`chunk`, `pinFocusedIndex`, `clampScrollIndex`) — the DOM-free, unit-tested core.
- **`VirtualTableBody`** (`@/components/virtualized`) — a drop-in windowing `<tbody>` using **Technique
  A**: two in-flow spacer `<tr aria-hidden>`s reserve the off-screen pixels while the windowed real
  `<tr data-index>`s stay in table flow. **Absolute rows are banned in tables** (ADR rule 2). Fixed
  height (`estimateSize` ~57, overscan 8).
- **`VirtualCardList`** (`@/components/virtualized`) — a windowing card list / responsive grid for
  non-table surfaces. Absolute `<li>` + `translateY` (allowed outside tables), `measureElement`
  (~132, overscan 6), `aria-setsize`/`aria-posinset` per card. Grids chunk-then-virtualize rows.

## Business rules (v1)

- **[R1]** Virtualization engages only when the gate is true; otherwise render every item via `.map()`
  (identical DOM to today). The plain-map branch is the correctness baseline.
- **[R2]** The focused element's `data-index` is force-included in every window (never unmounted under
  a keyboard user); the pin drops when focus moves. No restore-after-unmount.
- **[R3]** Responsive grids chunk-then-virtualize rows (v3 has no lanes); re-chunk on matchMedia change.
- **[R4]** Total scroll height is reserved synchronously on first paint (bottom spacer / sized inner
  container) so back-nav scroll restoration has a tall document; spacer/scroll math clamps ≥ 0.

## Testing

jsdom has no layout engine. Windowed-list tests import the **opt-in** shim
`tests/virtualizationLayout.ts` (`setupVirtualizationLayout()`) per-test — never global (it would
clobber per-instance `getBoundingClientRect` spies). Without the shim, `hasLayout` is false and the
gate falls back, which is exactly the baseline every hard-count test in PR2–PR5 relies on.
