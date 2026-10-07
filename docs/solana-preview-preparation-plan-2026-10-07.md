<!--
@id PP-MGR-DOC-002
@name LocalSolanaPreviewDeliveryPlan
@implements-rules-version v2 (POO-2281)
@analytics-events none, durable delivery reference.
-->

# Local Solana strategy preview: delivery plan

Date: October 7, 2026. Owner: Murilo's Codex coordinator. Rules: POO-2281 v2.
Epic: [POO-2252](https://linear.app/yeildbay/issue/POO-2252), Manager [POO-2116](https://linear.app/yeildbay/issue/POO-2116).
Delivery: [frontend PR #120](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/120).

The owner explicitly replaced API-dependent restricted access with a frontend-only local editor.
This plan describes that final implementation. The earlier grant proposal is historical v1,
retired before release. [ADR 0009](adr/0009-local-solana-visual-preview.md) records the change;
[ADR 0008](adr/0008-server-authorized-experiment-access.md) remains immutable decision history.

## 1. Starting point and constraints

Public main at `627237c84f4fd2b2ce7d1e99ef1eb8fa899512cf` has the V1/V2 family selector, strict EVM
mandate types and reusable presentation-only canvas pieces. Separate Solana integration exists on
`feat/fe-poo-2252-solana-spoke`, including wallet/binding/launch scaffolding, under POO-2262. It is
not imported or activated by this visual editor. `solanaSpoke` stays default off for real integration.

The local editor requires only the existing `fundContracts` release gate and Manager builder route.
No new API endpoint, personal account allowlist or deployment configuration is required. A hidden
gesture can be discovered; it is a UI preference with no authentication or transaction authority.

## 2. Stage A: guarded entry and isolated state

| Files | Responsibility | Focused checks |
|---|---|---|
| `src/lib/experiments/solanaPreviewMode.ts`, PP-CORE-LIB-124 | Pure three-press gesture, 1,000 ms window | Boundary, slow/backwards/non-finite clock, immutable input |
| `src/lib/experiments/solanaPreviewStore.ts`, PP-CORE-LIB-125 | In-memory sibling store, route/account and intent generation, SSR standard snapshot | Multiple accounts, reactive readers, absent host, delayed confirmation, unmount/reset, no storage writes |
| `src/components/layout/ContractFamilyToggle.tsx`, PP-CORE-CMP-075 | Selected V2 reveal and accessible exit, existing navigation guard | Normal V1/V2 semantics, no extra family event/write, Stay/Leave |
| `src/features/manager/fund/BuilderRouteSwitch.tsx`, PP-MGR-SCR-002 | Register host only in the hydrated V2 route; mount isolated editor | Flag-off V1 markup, family hydration, account/route reset |

Usage: open `/manager/new`, select V2, then press the selected V2 button three times within one
second. The label becomes V2 Solana. Click it once, or Back to EVM builder, to leave. Dirty work uses
the existing confirmation. Selecting V1 also exits. No sequence exists on investor/list/detail pages.

`ContractFamily` remains `v1 | v2`, with the original `pp.contractFamily` key. EVM drafts remain in
their original storage. Preview configuration is in component memory and is discarded on leaving
or reload. The existing warning protects this discard. No preview schema is serialized as an EVM fund.

## 3. Stage B: local model, canvas and panels

| Files | Responsibility | Focused checks |
|---|---|---|
| `solana-preview/previewModel.ts`, PP-MGR-LIB-059 | Local blocks, applied edits, selection/removal, integer allocations | 0..100, total <=100, invalid input, preserve other drafts, no market identity |
| `solana-preview/SolanaStrategyPreviewScreen.tsx`, PP-MGR-SCR-009 | Protocol palette, configure/apply, removal/discard confirmation, local dirty guard | Select/edit/apply, blocked validation, preserve pending work, exit/abandonment |
| `solana-preview/SolanaPreviewCanvas.tsx`, PP-MGR-CMP-088 | Solana spoke with presentation pieces and fitted pan/zoom | Continuous principal/fee paths, neutral Income output, local card interactions |
| `solana-preview/SolanaPreviewBlockPanel.tsx`, PP-MGR-CMP-089 | Protocol-specific local choices and unavailable financial fields | Native/wrapped distinction, correct Supply-only and LP labels, focus and narrow layout |
| `solana-preview/SolanaPreviewErrorBoundary.tsx` | Actual render failure and explicit retry | No invented error event or transaction outcome |
| `public/protocols/solana-preview/` | Original protocol/network marks | Exact source attribution, no generated/imitation mark |

Raydium CLMM and Orca Whirlpools are local liquidity-block choices. Kamino Lend is Supply-only.
Jupiter Swap is a local conversion choice. Blocks start at 0% allocation. Applied allocations are
whole percentages, with a total of at most 100%. Add/select/remove actions protect unapplied edits.
Each removable user block has an X and a confirmation. A liquidity block derives Collect fees and
automatic conversion. Principal and Kamino principal/interest return to Idle; converted LP fees pass
through the return Bridge to Income on the hub. Fee paths are green until hub Income; its output and
principal stay neutral. Each complete node-to-node route highlights together when hovered. Operating
cash is 144 × 96, centered to the right of Idle; reused fixed spine cards are 236 × 62.

SOL/USDC is a drawing label; the pool asset is WSOL when a real market is later connected. Native
Operating cash is SOL, never WSOL/stables. No mint/pool ID, price, APY, account balance, fee, health
factor, quote or transaction is fabricated. Missing financial fields and execution show Not available.
The latest protocol research supersedes historical screenshot fixtures; none become production data.

The canvas fits on entry and resize. Configuration uses a 360 px desktop panel that stacks on narrow
screens. Pan/zoom controls reserve space and remain inside the visible container. Reuse CanvasViewport,
SpineCard, SpokeGroup, FlowPill, GraphEdges, Button, Input and ConfirmDialog rather than alternate primitives.
An optional ConfirmDialog close-focus callback restores the editable field on cancel and a replacement
panel heading after a confirmed block switch. Existing callers retain the primitive's default behavior.

## 4. Stage C: translations, analytics and documentation

All copy ships in the current 11 configured locales. Product/token identifiers remain literal brands.
The mode label and tooltip live in `shell.json`; local screen copy lives in `manager.solanaPreview`.
Instrument entered/exited, view, first local add, applied configuration, abandonment, blocked intent
and actual render errors. Payloads contain bounded protocol/reason names and a boolean dirty state;
no raw identity/mint/amount or transaction completion. See [analytics catalog](ANALYTICS_EVENTS.md).

Sync IDs, integration points, feature flags, Manager/package READMEs, Figma references, compliance
and third-party notices. POO-2281 rules v2 is the current delivery. POO-2282 is canceled for this scope.

## 5. Stage D: review and delivery

Two GPT-6.1-sol workers maximum: editor/model/assets and translations. The coordinator owns toggle,
route/store, rule versions, docs, review and GitHub/Linear/Slack. Review every worker change before
committing. Publish frequent coherent commits to PR #120 on the public PoolPartyLabs frontend.
Keep the PR draft while its scope changes, then mark ready after focused checks and review.

Run focused single-worker tests, changed-file Biome, scoped TypeScript over the real import graph,
locale parity, config/documentation checks. Do not run local full suite, coverage, build or browser
journey, per Murilo. Report scoped validation accurately. Historical full CI on the superseded v1
preparation had failures in existing Build/launch tests and dependency audit; final CI must be assessed
at the final head, not inherited from that result.

## 6. Real integration remains separate

[POO-2262](https://linear.app/yeildbay/issue/POO-2262) owns dual wallets, per-fund signer binding,
authoritative quotes/builders and launch recovery. [POO-2261](https://linear.app/yeildbay/issue/POO-2261)
owns relay/report integration. [POO-2239](https://linear.app/yeildbay/issue/POO-2239) and
[POO-2240](https://linear.app/yeildbay/issue/POO-2240) track live token/market discovery. This editor
does not claim these operations are executable or that any new Solana fund was created.

Future wiring must review market identity/decimals, native SOL costs, binding, receipt-driven steps,
partial execution and recovery against the real integration branch. A local pair/allocation cannot
be accepted as a quote, entitlement, immutable mandate or chain transaction input.

## 7. Design references

- [Build](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-2725)
- [Graph detail](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8370-2816)
- [Configure Raydium](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-3089)

Owner handoffs and October 7 protocol research define presentation references. The current local
scope intentionally keeps unsupported data unavailable. The live Configure frame was read through
Figma design context on October 7: surface tokens, 16 px padding, 20 px radius and right network chip.
