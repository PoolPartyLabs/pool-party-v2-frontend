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
| `blocks/` | `PP-MGR-LIB-024`, `PP-MGR-CMP-056` to `058`, `PP-MGR-HOK-009`, `PP-MGR-HOK-010` | The block registry and its copy, the menu models, the palette, the menu, the panel stub, the selection guard, the controller |
| `graph/` | `PP-MGR-CMP-059` | The renderer, its reading-order model, `useGraphLayout`, `useTextWidth` |

The reference canvases used as test oracles and story data are in `src/mocks/data/buildCanvasFixtures.ts`.

## Rules of the folder

- Legality (which block may go where) is decided in `plan/` only: `kindAvailability`, `portSlotsOf`,
  `insertOptions` and the reducers. The layout, the registry and the menus read it and keep no copy.
- The layout is derived from the plan and never stored.
- `pieces/` import nothing from `plan/`, `layout/`, `blocks/` or `graph/`; `BuildGraph` imports nothing from
  `plan/` or `blocks/`.
- The canvas calls no API and requests no transaction: it writes the mandate draft and nothing else.

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
