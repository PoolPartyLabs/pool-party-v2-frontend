# Build canvas

The Build phase of the fund-contracts strategy builder (epic POO-2144, shared artifact `PP-MGR-SCR-002`): the
manager assembles the strategy as a top-down graph of blocks, using only what the mandate holds. The rules are the
handoff in the description of Linear issue POO-2144. Everything here is behind the `fundContracts` flag (default
off) and the V2 toggle. The plan model in five lines, the coordinator defaults, what is not done and the parity
record against Figma are in `src/features/manager/README.md`, section "Build canvas".

## What each folder owns

| Folder | Ids | Owns |
|---|---|---|
| `build/` (root) | `PP-MGR-SCR-002` | `BuildScreen.tsx` (the screen the Build phase renders), `buildScreenModel.ts` (the ordered Next: Review checks, pure), `buildAnalytics.ts` (the mapping to the analytics events); they take no id of their own |
| `plan/` | `PP-MGR-LIB-021`, `PP-MGR-HOK-007` | The plan model, the rules, the pure reducers, `validatePlan`, storage inside the mandate draft, `useBuildPlan` |
| `canvas/` | `PP-MGR-CMP-045` to `047`, `PP-MGR-LIB-022`, `PP-MGR-HOK-008` | The step frame, the clipped canvas with zoom, pan and fit, the panel slot |
| `layout/` | `PP-MGR-LIB-023` | The pure layout function, its types, its constants, `toLayoutInput` |
| `pieces/` | `PP-MGR-CMP-048` to `055` | The presentational pieces; strings arrive as props |
| `blocks/` | `PP-MGR-LIB-024`, `PP-MGR-CMP-056`, `057`, `PP-MGR-HOK-009`, `PP-MGR-HOK-010` | The block registry and its copy, the menu models, the palette, the menu, the selection guard (with its resume), the controller (with the remove confirm). The panel stub `PP-MGR-CMP-058` is removed |
| `graph/` | `PP-MGR-CMP-059`, `PP-MGR-LIB-062` | The renderer, its reading-order model, `useGraphLayout`, `useTextWidth`, explicit financial graph contract |
| `panel/` | `PP-MGR-CMP-061` to `068`, `PP-MGR-HOK-014`, `PP-MGR-LIB-029`, `PP-MGR-LIB-030` | The configuration panel (POO-2171): the shell `BlockPanel` and its kind to body registry `panelBodies.ts`, the shared controls, the draft `usePanelDraft`, the range and slippage maths; fixture bodies and a harness for stories and tests |

The reference canvases used as test oracles and story data are in `src/mocks/data/buildCanvasFixtures.ts`.

## Rules of the folder

- Legality (which block may go where) is decided in `plan/` only: `kindAvailability`, `portSlotsOf`,
  `insertOptions` and the reducers. The layout, the registry and the menus read it and keep no copy.
- The layout is derived from the plan and never stored.
- `pieces/` import nothing from `plan/`, `layout/`, `blocks/` or `graph/`; `BuildGraph` imports nothing from
  `plan/` or `blocks/`.
- The canvas calls no API and requests no transaction: it writes the mandate draft and nothing else.
- The configuration panel edits a DRAFT of the selected block; only Apply changes writes the plan
  (`useBuildPlan().applyBlockConfig`). Every remove goes through `removeBlockReleasingShare`, after the
  panel's confirm.

## Adding a panel body

The shell (`panel/BlockPanel.tsx`) owns the head, the modes, Use (the kind's defaults at 0%), the Allocation
field, the status row, Apply changes, Remove block and the leave guard. A kind's body owns the rest: add one line
to `PANEL_BODIES` (`panel/panelBodies.ts`) with a `PanelBodyDefinition` of the kind's config, that is `usePick`
(Modes 2 and 3: the rows with the config Use writes, a row's `disabledReason` when it cannot be used, and their
copy), `Fields` (Mode 4: the fields between the head and the status row, which place the `allocation` node they
are given) and, optionally, `useApplyGate` (P13: holds Apply changes, with the reason the status row shows, while
a value it needs is loading or failed). Ids are the mandate rows' canonical keys (`panelPoolId`, `panelAssetKey`);
the shell passes every config through `canonicalPanelConfig` anyway. A kind with no body shows the head and Remove
block.

## Adding a block kind

Availability is data: moving a kind between enabled and coming soon is one line of `BLOCK_KIND_STATUS`
(`plan/buildPlan.ts`). A new position kind needs, in order:

1. its entry in `BlockKind`, `BLOCK_KIND_STATUS`, `BLOCK_KIND_PROTOCOL` and `BlockConfigByKind`
   (`plan/buildPlan.ts`);
2. the stored-plan check in `plan/planStorage.ts` (`POSITION_KINDS`, `isConfigFor`): a kind missing there makes
   every stored plan that holds it unreadable, and the draft loses its plan;
3. the sequence rules it follows, in `plan/planRules.ts` and `plan/planInvariants.ts`;
4. its definition in `BLOCK_REGISTRY` and its title and caption in `blocks/blockRegistry.ts`;
5. for a pool-like kind, `isPoolKind` (`plan/planRules.ts`), `portTooltipKey` (`graph/graphModel.ts`) and
   `cardContent` (`graph/BuildGraph.tsx`), which TypeScript does not flag when they are missed;
6. the keys `fundBuilder.canvas.blocks.<kind>.protocol` and `.type`, read in `blocks/blockCopy.ts`, in all 11
   locales (`pnpm i18n:check`);
7. a block sheet in Linear, and a row in `docs/IDS_REGISTRY.md` if the kind adds a file with an id.

Making a coming-soon kind placeable takes more than step 1: Uniswap v3 positions also need the mandate catalog to
offer `uniswap-v3` again (`UNAVAILABLE_PROTOCOLS` in `mandateDraft.ts`, read by `mandateCatalog.ts`), and Pendle and GMX
have no `ProtocolId`.

The Uniswap v4 configuration body (`PoolBlockPanel`, POO-2189, rules v1) is registered for `uniswapV4Pool`. Use seeds an aligned ±10% range, slippage 2% and share 0 from a mount catalog read. Apply requires the current pool read to be applicable, complete and aligned. The price controls keep canonical ticks while displaying either quote orientation, and pool changes reset only the range. Pool rows expose no TVL or APR.

The pool body uses `PanelBodyDefinition.Provider` to share one `usePanelPool` snapshot between
its fields and its Apply gate. A Retry updates both; each configured pool has one polling
lifecycle. This prevents the visible price and Apply permission from diverging after a failed
read. A component regression reproduces the old failure before the provider fix. Other bodies
may omit the provider when their hooks are pure catalog selectors.
## Aave Supply panel (POO-2194, rules v1)

`panel/SupplyBlockPanel.tsx` (`PP-MGR-CMP-072`) registers `aaveSupply` in `PANEL_BODIES`.
It reads `usePanelReserves` over the shell catalog, intersects the current network and mandate,
and offers executable USDC on Arbitrum. Other or unavailable reserves are disabled with a reason.
The Asset select, Supply APY and Allocation follow Figma `8188:2392`. APY is the catalog snapshot,
not a promise or a continuously refreshed rate. No new polling or external logo source is added.

Use writes the canonical `network:lowercase-address` at share zero. Allocation remains local until
Apply; Discard and guarded exits use the existing shell. Loading, read failure and a missing or
unusable selected reserve block Apply. Retry belongs to the same catalog. The current USDC input
needs no swap, so this panel has no slippage, Borrow or range control. Existing plan and launch
validators still reject unsupported continuations and duplicate reserve opens.

The shell owns all configuration/Apply/Discard/blocked-intent analytics. Seven stories and the
component regression suite cover picking, configured and pending allocation, loading, failure,
empty mandate and unavailable reserve. `CR-MGR-024` tracks the displayed APY snapshot claim.

## Panel actions and navigation (POO-2202, rules v1)

The canvas viewport has a 640px minimum height (extended to available viewport height by POO-2210). The three-column grid has a minimum height of 640px,
so a configuration panel with long fields, apply errors or the blocked-leave warning increases
its row's height. Apply, Discard and Remove remain in normal reading and tab order before the
sticky Back / Next bar. No panel-specific scroll region or state changes are introduced.

The CSS sizing regression and existing BlockPanel interaction tests cover the layout contract,
apply gates, blocked leave, discard and removal. Storybook's `LongPanelWithLeaveNotice` is a
visual inspection fixture. See `docs/BUILD_PANEL_ACTIONS_2026-10-04.md` for validation limits.


## Canvas actions and space (POO-2210, rules v1)

Applying a different Uniswap pool selection atomically adds its Collect fees step if absent,
including at 0% allocation. Reapplying the same pool or adjusting its range does not duplicate
fees or restore a deliberately removed fees step. Discard and refused Apply leave the graph intact.
The existing fee, range and launch rules remain; a deferred pool still executes nothing at launch.

User position blocks and non-automatic flow steps expose a top-right X. Every removal request,
including Delete, panel removal and an empty spoke's X, opens the shared confirmation modal.
Cancel is focused first. The modal explains the actual released share and dependent steps from
`describeRemoval`; confirm uses the existing cascade reducer and analytics. Removing an unselected
block preserves another block's pending panel changes. Mandatory automatic Swap/Bridge and spine
nodes remain fixed because they are derived from the plan.

The canvas uses `max(640px, calc(100dvh - 280px))`; its palette narrows below xl while the panel
stays in normal document flow above Back/Next. POO-2209 owns the collapsed sidebar and uncapped
shell width. The existing ReferenceCanvasC story demonstrates X controls and the modal; component
and controller tests cover cancellation, confirmation, cascade and draft preservation. Browser
acceptance is performed by Murilo.

POO-2213 rules v1, 2026-10-04: each Collect fees derives an automatic income conversion pill immediately below it. Income flows through that pill into the network stable-token return, while principal bypasses it on the left. These nodes are layout-only, have no insertion/removal controls, and never become plan steps or launch transactions. Original Figma coordinate oracles retain their source measurements plus explicit dated overrides for the added 50px row; where the bypass prevents the former shared bus level, income uses the next 24px level.

## Canvas corrections (POO-2235/2236/2237, rules v1)

Build entry and canvas resize fit the full graph above the zoom controls. The sidebar begins collapsed for each visit and can expand without changing the saved app preference. Exceptionally short screens retain 240px of canvas with outer-page scrolling; side columns scroll independently. Manage keeps its prior viewport behavior.

Layout exposes complete block-to-block connection paths with clipped shared buses. Hover/focus of a percentage highlights its entire incoming path; only relevant branch spans light up. All five fixed spine cards carry locks. Income output is neutral; Collect fees → Swap · auto → Income stays green until Income.

Manual Swap and spoke percentage select AuxiliaryBlockPanel and reuse the existing Apply/Discard/leave guard. Token keys are canonical network/address references from the mandate; pairs must differ. Spoke allocations cannot exceed root/network room or fall below allocated children. No child is silently rescaled. Manual Swap execution is unavailable, including inside a pool chain, until POO-2238. See [delivery record](../../../../../docs/build-canvas-polish-2026-10-05.md).

## Native dark scrollbars (POO-2287, rules v1)

The document declares its dark native color scheme in CSS and Next viewport metadata.
Both Build side columns and the palette's internal scroll area opt into the existing
`scrollbar-dark` utility. Tracks, buttons and the two-axis corner stay transparent;
thumbs use the design tokens. Forced-colors mode restores system rendering and sizing.
Side columns and the panel frame retain zero minimum width so classic scrollbar gutters
can reduce the available content width. Scrollbars remain native, with no overflow clipping
or new scroll handlers; drag, canvas sizing, drafts and navigation retain their behavior.

Focused component tests cover the styling/width contracts and existing interactions.
Native painting in Chrome/Edge, Firefox and Safari with always-visible scrollbars remains
the owner's browser acceptance check. The separate POO-2284 range fix (PR #122) handles
the range controls' width. No API, transaction, new copy or analytics emitter is introduced.

## Semantic graph foundation (POO-2288, rules v1, first slice)

`graph/semanticGraph.ts` (`PP-MGR-LIB-062`) defines stable node, financial-port,
connection, segment and junction identities. Financial ports name their owner, direction,
flow class, network and origin; their anchor is resolved on the current outer rect. The
existing insertion controls and `targetKey` contract remain separate. Node keys used by
`graphModel` preserve the existing block, Add and drop identities; an outbound Bridge can
receive a distinct role key without occurrence-based renaming.

`GraphLayout.semantic` is an optional explicit contract. When supplied, `pieceEdges` reads
owned segments and `pieceConnections` reads complete routes, so a financial connection's
hover identity does not depend on coincident geometry or array order. The deterministic
validator rejects duplicate IDs, missing endpoints/segments, invalid anchors, mixed
classes/origins, undeclared network transitions, same-chain Bridges, broken ordered routes
and conversions without compatible input/output legs. Principal and income can share a
visual Bridge using separate ports; a crossing or equal color does not create a junction.

This first slice adds the contract and renderer-consumer boundary. Current layout producers
still use their existing edges and connection paths. It does not certify current Build,
Manage or Solana financial reachability, recalculate content bounds, change canvas routing
or resize nodes. POO-2270/2271/2273 own the producer/layout adoption and acceptance steps.
The 48-frame handoff is a geometric reference, separate from semantic validation; its five
hidden legacy graphs are not final topology oracles. Focused tests cover local Arbitrum,
cross-chain and shared-Bridge flows, multiple positions, debt, Holding and Solana plus
explicit junctions, independent crossings and conversion continuity. These are contract
fixtures, with no transaction simulation or financial-settlement claim.

No API, RPC, mock-service call, copy or analytics emitter is introduced. Build and Manage
hosts retain event ownership. The compliance register records the remaining financial
meaning and launch conditions before this contract is adopted on real product routes.


## React Flow infrastructure (POO-2302 v1, October 9, 2026)

`reactFlowProjection` (PP-MGR-LIB-074) projects only declared financial nodes, handles and routes. Invalid references and nonfinite coordinates fail closed. `ReactFlowGraph` (PP-MGR-CMP-100) wraps existing Pool Party surfaces in custom nodes and measured handles, renders custom orthogonal edges and owns one pan/zoom transform. Native drag, connect, reconnect, selection and Delete mutation are disabled. Handles remain nonzero inside painted borders; moved endpoints preserve safe interior bends and simplify a single elbow without backtracking.

CanvasViewport exposes `engine="react-flow"`; the default remains native in this infrastructure slice. Build and Manage renderer adoption is delivered separately. Existing controls, fit, reveal, overlays and event ownership are retained. Only upstream base CSS is loaded; no React Flow UI cards are copied. The pinned MIT dependency and its notices are recorded in THIRD_PARTY_NOTICES and ADR 0010.

Focused regressions cover projection integrity, measured endpoints, single-transform pan/zoom, invalid dimensions, fitting, measurement-cache retention and disabled native mutations. Real browser geometry acceptance remains with Murilo.


## Build React Flow adoption (POO-2302 v1, October 9, 2026)

BuildScreen now selects the measured engine delivered in PR #146. BuildGraph registers the same Pool Party pieces as custom financial nodes, preserving stable drop/menu/block IDs, removal confirmation, full-route hover, gray principal/green fees/gray Income output and the existing reducer-owned layout. Ports remain anchored inside painted borders. Spoke bodies stay below lines/cards and their existing chips stay above them.

React Flow owns the sole pan/zoom transform. The same Fit, reveal, background selection, keyboard controls, draft guards and palette/configuration interactions remain. Native dragging, connecting, reconnecting or Delete cannot bypass the app reducer. Default CanvasViewport callers remain native unless they opt in. Protocol marks and network presentation are optional presentation seams; this slice does not enable any Solana catalog, runtime, account or transaction.

Focused renderer and real-engine BuildScreen tests preserve gesture, fit, selection, configuration/Apply, navigation, removals and storage behavior. No mock of the React Flow engine is used. Native browser pixel/scroll/zoom acceptance remains with Murilo. No full local suite, coverage or build is required by the current owner constraints.
