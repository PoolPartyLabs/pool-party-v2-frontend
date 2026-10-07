<!--
@id PP-MGR-DOC-001
@name ManagerCanvasPanelsDeliveryPlan
@description Staged delivery and verification plan for the October 7 Manager canvas and inline panels.
@linear https://linear.app/yeildbay/issue/POO-2270
@owner manager-team
@since 2026-10-07
@implements-rules-version v1
@analytics-events none: documentation-only planning artifact; runtime emitters are specified per delivery slice.
-->

# Manager canvas and inline panels: delivery plan, October 7, 2026

Status: **planning complete; implementation has not started in this package**. Parent [POO-2116](https://linear.app/yeildbay/issue/POO-2116), project Manager Console. Source baseline: public frontend main `410188eaf749dec8dcb1fcf3f5fb7e541aaccb51`. A coordinator and two GPT-6.1-sol read-only audits reviewed code, current Figma and current API source. No application tests, build, wallet operation or browser investment journey was run for this plan.

This document supersedes the October 6 plan only for the October 7 canvas/panel changes. The existing Overview delivery and investor boundary remain applicable.

## 1. Sources, precedence and delivery boundaries

Read together, in this order:

1. Owner handoff `handoff-manager-ajustes-canvas-paineis-2026-10-07.md`, all 16 sections and D01-D24.
2. Later `handoff-manager-bridge-retornos-spoke-2026-10-07.md`: **supersedes direct returns between networks**, including graph bounds and return-Bridge coordinates in the earlier document.
3. Consolidated `handoff-manager-overview-manage-v2-2026-10-06.md` and Manager flow contract: preserve origin, drafts, abandonment, failure and recovery.
4. Live [Figma Choice](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8335-2708) and [Collect](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8609-3517). Exported PNGs are comparison evidence, not proof of runtime behavior.

Preserve V1, Overview, Investor InvestModal/provisioning, Strategies and Portfolio with their existing V2 tags. Preserve current owner/core authorization, native-only cash, exact quantities, current-position range status, canonical ticks/inversion/slippage and per-position drafts. Existing unavailable Move confirmation and future-policy save do not become executable through this visual package.

The unrelated onramp work and licensing branches are outside this package. Implementation starts in isolated worktrees from the explicit public frontend destination. Each PR revalidates target main, configured locales, scripts and active ownership before editing.

## 2. What exists and what changes

| Area | Existing public main behavior | Required change |
|---|---|---|
| Native cash | One native token of the matching chain; unknown physical balance unavailable | Preserve behavior; compact the card, then wire authoritative balance separately |
| Cash / Idle dimensions | Cash and input Idle height136 | Reference height104; preserve output168 and Income102; grow natural bounds for content |
| Fee conversion | Derived Swap after Collect already exists | Center Swap under Collect, gap24 and one green exit |
| Principal return | Currently derives from Collect | Lateral gray position bypass, with no gray Collect exit |
| Income exit | Manage outgoing path is green | Gray from Income to withdrawal; Build already uses gray |
| Cross-network returns | Entry Bridge exists; return Bridge nodes absent | Distinct principal/fees Bridge before each spoke boundary |
| Hover | Shared GraphEdges supports complete connections; Manage does not supply them | Add origin/class connection paths and full-path highlighting |
| Selection | Position identity only; panels remain mounted | Add Idle/Collect flow selection with origin and Back/focus context |
| Visibility | `active` also invalidates review and emits position_changed abandonment | Separate visibility from identity and operation ownership |
| Hub / spoke / locks | Badge inside transformed content, shared small spoke default, missing fixed locks | Outside-layer overlay, opt-in Manage spoke, three fixed locks |
| Panel identity | Network appears on a separate row | Common inline protocol/pair/network header with responsive reflow |
| Idle deadline panel | No production global queue contract | Read-only presenter with truthful unavailable state; API wiring later |
| Collect details | Authorized position read already exposes uncollected token amounts | Reuse real fees; add dedicated inline panel and separate execution gate |
| Collect execution | API origin builder exists; frontend has no dedicated complete flow | Extend preview/recovery contract and wire in small operation PRs |
| Tabs | Manage has no tab bar | Compare approved strip in harness; functional destinations wait for definition |

The old `principal:collect:` test expectation encodes the wrong origin and must be corrected semantically, not merely renamed. `ManageBlockPanel.tsx` includes visibility in its invalidation fingerprint and abandonment logic at baseline lines296-333; adding panels without separating these concerns would lose review state and misreport navigation.

## 3. Figma states and geometry

All seven frames are states of **PP-MGR-SCR-004**, not new routes or exploratory modals.

| State | Frame | Graph | Reference panel height |
|---|---|---|---|
| Choice | [8335:2708](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8335-2708) | 8335:2762 | 786 |
| Move | [8291:2563](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8291-2563) | 8292:2632 | 822 |
| Review | [8334:2692](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8334-2692) | 8334:2746 | 836 |
| Aave | [8296:2579](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8296-2579) | 8296:2633 | 671 |
| Create / future deposits | [8300:25774](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8300-25774) | 8300:25828 | 822 |
| Idle output | [8591:30377](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8591-30377) | 8591:30431 | 798 |
| Collect fees | [8609:3517](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8609-3517) | 8609:3579 | 383 |

Latest reference: graph **752x1320**, host **736x1358**, artboard **1520x1873**. Spoke `(320,270,408,692)`; principal Bridge `(336,920,176,26)`; fees Bridge `(536,920,176,26)`; separate return buses y970; output cards y1018; Withdraw y1234.

Cash160x104, hub Idle input236x104, spoke Idle176x104, Idle output236x168 and Income236x102. Keep hub x312, branch axes x200/424, output axes x178/446 and side gap24 in the comparison fixture. Cash does not recenter the strategy. Align actual Idle/cash centers as contents reflow.

Hub overlay reference223x33, top/right inset24; common panel header318x41 with gap12; panel width360. Manage spoke pill130x32, logo20, padding12/gap8, label14 semibold. The shared Build pill retains its21px default. Fixed locks are14px on Idle input/output/Income only.

These are graph/comparison dimensions, not mandatory CSS host or panel heights. Use existing tokens and UI rem sizing separately from numeric graph coordinates. Text and amounts remain complete at larger fonts. Do not adopt the unapproved general16px-clearance/24px-track layout-engine proposal.

## 4. Ordered PRs, files, dependencies and verification

Paths below are repository-relative. New component/model/hook IDs are reserved in IDS_REGISTRY before implementation; existing screen, canvas, panel and API IDs are reused.

| Stage / issue | Scope and files | Dependencies | Focused completion evidence |
|---|---|---|---|
| 1. [POO-2270](https://linear.app/yeildbay/issue/POO-2270), compact Manage and semantic paths | `manage/manageLayout.ts`, `ManageCanvas.tsx`, matching tests | Approved current geometry and preserved native-only model | Position-origin gray principal; no gray Collect exit; centered Swap/gap24; one green fee exit; gray Income exit; heights/bounds and multiple positions |
| 2. [POO-2271](https://linear.app/yeildbay/issue/POO-2271), return Bridges and hover | `manageLayout.ts` result/connection types, `ManageCanvas.tsx`; reuse `build/pieces/GraphEdges.tsx` and `FlowPill.tsx` | Stage1; correct local/class/network origin | Bridge before every cross-network boundary, none on local edges, distinct classes/buses, spoke Supply, complete paths and no sibling highlighting |
| 3. [POO-2272](https://linear.app/yeildbay/issue/POO-2272), overlay/spoke/locks/headers | `build/canvas/CanvasViewport.tsx`, `build/pieces/SpokeGroup.tsx`, `ManageCanvas.tsx`, `ManageBlockPanel.tsx`; common header if justified | Existing pieces; coordinate overlap with stages1/2; [POO-2250](https://linear.app/yeildbay/issue/POO-2250) owns USDG art/provenance | Overlay outside CANVAS_LAYER_ATTR and drag surface; opt-in Manage default preservation; selectable fixed blocks; six complete headers, natural height/reflow |
| 4. [POO-2273](https://linear.app/yeildbay/issue/POO-2273), separate Build semantic parity | `build/layout/layoutGraph.ts`, `graphTypes.ts`, connection builder and focused geometry/oracle tests | Approved Bridge semantics; shared-pieces coordination | Build dimensions/controls/hub-only graphs preserved; local compatible merges precede Bridges; complete hover; Canvas E debt/conversion order |
| 5. [POO-2274](https://linear.app/yeildbay/issue/POO-2274), selection and operation ownership | `ManageScreen.tsx`, `ManageCanvas.tsx`, `ManageBlockPanel.tsx` and tests | Existing identity boundary and per-position mounting; stable canvas changes | LP -> Idle/Collect -> Back preserves draft/review ownership/viewport; no false position_changed; owner/core/origin changes and real preview expiry remain guarded |
| 6a. [POO-2275](https://linear.app/yeildbay/issue/POO-2275), Idle presenter | New `ManageIdleOutputPanel.tsx`, explicit story fixtures and narrow queue projection | Stage5; approved read-only layout | Inline selection, Back/Retry, unavailable/zero/error/partial; no Reserve action or fabricated daily values |
| 6b. POO-2275 financial wiring | `src/lib/api/v2/manageSchemas.ts`, `manageActions.ts`, queue model/hook as confirmed | **[POO-2230](https://linear.app/yeildbay/issue/POO-2230)** deployed authoritative queue and balances | Dates/cohorts/reserve meaning/asOf/timezone supplied; expired/>3-day/multiple-deadline/rollover/partial states; raw precision, no guessed earliest-first |
| 7. [POO-2276](https://linear.app/yeildbay/issue/POO-2276), real Collect details | New `ManageCollectFeesPanel.tsx`, narrow fees projection; reuse `useManagePosition`, `loadManagePositionAction` and existing schemas | Stage5/common header; current authorized position read; POO-2250 logo | Ordered token0/1 fees raw6/18, metadata identity, missing vs zero, stale/late origins, Back preservation; action remains unavailable |
| 8. [POO-2277](https://linear.app/yeildbay/issue/POO-2277), API contract extension, Rafael | Existing positions/build Collect service/DTO; companion preview/recovery/continuation contract | Existing builder; explicit operation and settlement scopes | Fixed-commit DTO/simulation/receipt examples, capability/freshness/costs/expiry, correlation/idempotency and pending/unknown/reload behavior |
| 9a. [POO-2278](https://linear.app/yeildbay/issue/POO-2278), Collect prepare/review | Dedicated server action/schema and small inline Collect controller | Stage7 and confirmed origin capability from stage8 | Owner/core/vault/chain/adapter/key and decoded call/value; fresh snapshot/preview expiry/costs; explicit user intent |
| 9b. POO-2278 origin signing/recovery | Small Collect hook/journal binding to existing wallet-operation patterns |9a and authoritative reconciliation | Persist evidence before advancing, duplicate submission protection, cancel vs pending/unknown, reload/revert/recovery; exact origin receipt |
| 9c. POO-2278 supported continuation to hub | Separate typed swap/Income return controller and transit correlation | Explicit compatible route, costs/minima, deploy/keeper/provider and token mapping evidence | Stage-level recovery without replay; Principal/Income not mixed; hub settlement proved independently of origin Collect |
| 10. [POO-2279](https://linear.app/yeildbay/issue/POO-2279), functional Charts/Activity | Controlled shared Tabs, `ManageScreen.tsx`, authorized history/schema and confirmed series service | **Needs Rules**: content/data/sidebar/navigation; stage5 state ownership | Strategy flow stays mounted; history indexing/partial vs empty; real series/gaps, cursor, event identity and keyboard/focus |

Stages6a and7 can land before the missing financial execution contracts. Production keeps **Not available** wherever the source/capability is absent. Stage8 can advance on Rafael's side while defined frontend slices are delivered. Do not batch the three Collect operation PRs into a large combined canvas/transaction change.

## 5. Topology and operation boundaries

Required descriptive flow:

- Local principal: position -> gray bypass -> hub Idle output.
- Spoke principal: position -> principal Bridge -> hub Idle output.
- Local fees: Collect -> existing Swap auto -> hub Income.
- Spoke fees: Collect -> existing Swap auto -> fees Bridge -> hub Income.
- Income -> gray withdrawal merge.
- Local native cash stays on its own chain. Supply/Borrow gets a return Bridge only for an actual spoke crossing.

Principal/fees have separate identities and buses. Build preserves explicitly compatible local merges by network/class before the relevant Bridge. No implicit token/cohort compatibility is inferred. USDG holdings are not relabelled USDC when a line crosses chains.

Build's Canvas E remains: **Pendle -> principal Swap -> Repay USDC -> Withdraw WETH -> collateral Swap -> Idle output**, locally on the hub. Existing local fee paths remain local. Reference Base/Solana/Pendle compositions do not enable unsupported adapters or networks.

The label auto is a diagram description. It creates no new clickable Bridge, signature, provider, ETA, conversion, atomicity or settlement promise.

## 6. API reuse and missing contracts

Current API source was examined read-only at `06a03b046ecba22204e44b201adb9e06a36a21f6`. The older local pre-V2 checkout was not used as capability evidence. This is source verification, not proof of a deployed endpoint or keeper.

| Capability | Available evidence | Reuse / remaining gate |
|---|---|---|
| Position fees | GET `/api/v2/funds/{core}/positions/{chainId}/{positionKey}`: ordered tokens, raw uncollectedIncome.amount0/amount1 and independent USD | Reuse existing authorized Manage position action; never substitute holdings |
| Origin Collect | POST `/api/v2/funds/{core}/positions/build`, action collect-income, from/side/adapter/positionKey | **Already exists**; one simulated vault.collectIncome call. Add dedicated frontend flow after POO-2277 preview/recovery |
| Collect response | protocolVersion and transactions only | Does not prove costs, capability, quote freshness/expiry, operation identity or reconciliation. Validated request deadline is not a Collect calldata expiry |
| Swap / return | build-swap and request-income-withdrawal builders exist separately | Require supported token/chain route and correlation. request-income-withdrawal is aggregated collected base-token income; generic send-to-hub is Principal |
| Transit / history | Existing transit class/token/legs/credited evidence and cursor/indexing history | Reuse for typed recovery once correlated. readyForNextStep for outward Principal is not Income completion |
| Deadline queue | Scalar payoutReserve and holder payouts do not supply a global eligible queue | POO-2230 supplies cohorts/deadlines/timezone/reserve assignment/asOf and coverage |
| Native cash / hub Income | Scalar operatingCash and collection-round tuple are not authoritative token buckets | POO-2230 supplies physical native quantity and actual aggregate current hub Income independently |
| Move / future policy | Move builder exists; complete preview/recovery and persisted future policy still absent | Preserve [POO-2229](https://linear.app/yeildbay/issue/POO-2229)/[POO-2231](https://linear.app/yeildbay/issue/POO-2231) gates |
| Activity / Charts | readFundHistory exists; inspected controller has no V2 historical-series endpoint | Activity needs UX definition; Charts needs metric/coverage/source contract. POO-2247 remains Overview's separate scope |

The API extension confirms schema and execution details with examples/tests before frontend enablement. Raw amounts, token identity/decimals, ledger class, source block/asOf, partial/freshness and explicit missing/error states are required. Proposed schema fields are requirements to agree, not a claim of an already delivered DTO.

Financial source verification uses these API modules at the fixed SHA: `v2-alpha.controller.ts`, `v2-fund-position-builders.service.ts`, `dto/fund-position-build.dto.ts`, `v2-fund-spoke-balances.service.ts`, `v2-alpha.funds.ts`, `v2-fund-transits.service.ts` and `v2-fund-history.service.ts`. Internal issue evidence holds precise lines; this document contains no credentials or private repository links.

## 7. State, focus and recovery contract

Selection carries flow-node kind, node identity and optional canonical position origin `core:chainId:positionKey`. Keep origin context distinct from the currently visible panel. A Collect for another instance of the same pool must never inherit its sibling's draft or fees.

LP -> Idle/Collect -> Back preserves the mounted editor, range, slippage, allocation/action, operation journal and viewport. Do not include mere visibility in financial-operation invalidation. A hidden editor cannot emit false position_changed abandonment or discard pending evidence. Real identity, snapshot and expiry changes still invalidate the applicable preview.

Back/Escape restores previous selection and the live anchor. Opening without a prior editor, disappearing origin or detached anchor returns to blocks safely. Enter/Space activates selectable nodes. Hidden panels stay outside focus/accessibility traversal. A fixed lock does not disable Idle selection.

Owner/core authorization boundaries reset screen state. Operation evidence is scoped separately to its immutable origin for safe reconciliation. An account change never permits a new account to sign the old operation.

Origin Collect completes only with the matching confirmed IncomeCollected evidence. A return-to-hub funnel completes only with authoritative credited Income at the hub. Wallet callback, broadcast, origin receipt and partial conversion cannot complete the latter. Pending/unknown submission cannot trigger automatic retransmission.

## 8. Readiness decisions and truthfulness

Ready visual/topology work is recorded as numbered issue-scoped rules v1 in POO-2270..2278. This does not assign a blanket new version to every existing Manager artifact. Implementation synchronizes each applicable issue history/label, PR title and file header; prior rule histories remain intact.

POO-2279 remains **Needs Rules** for Charts metrics/denominators/source/coverage, Activity event/filter/pagination semantics, sidebar/mount/focus and narrow-screen destinations. The visual strip order is Strategy flow / Charts / Activity, height42/gap16. It may be compared in an explicit harness now; do not publish undefined blank, disabled or Coming soon destinations.

API operational copy and mobile details not settled by the handoff are recorded in the relevant slice before it is enabled. Independent approved visual work continues. Examples650 USDG/0.2 WETH and illustrated deadline amounts never enter production as defaults.

Reuse POO-2250 for trusted USDG logo and missing Build-lineage disclosure. Do not infer original Build block mapping from a live pool or protocol.

## 9. Acceptance traceability

| Handoff criterion | Delivery slice / required evidence |
|---|---|
| D01 existing base |1/5 and every integration: owner/core/flags, old reads, unavailable review and drafts preserved |
| D02 native-only |1; POO-2230 wiring: one native of own chain, missing not stable/zero |
| D03 compact dimensions |1:104px references with intact content; output168/Income102 |
| D04 axes |1:axis independent of cash, centers and gap24; updated Bridge envelope geometry |
| D05 fee order |1/2:one existing Swap centered24px below Collect; no Collect on Supply/Borrow |
| D06 principal origin |1/4:gray lateral position bypass, zero gray exit from Collect |
| D07 green fee path |1/2/4:single green exit, continuous through Swap and spoke fees Bridge when crossing |
| D08 outgoing Income |1/4:gray to withdrawal, aligned output tops |
| D09 stable graph |1/2/5:pure deterministic layout; selection/polling do not reorder or reset Fit |
| D10 tabs |10:approved strip, defined destinations before functional navigation |
| D11 Hub overlay |3:outside transformed layer, core identity, fixed viewport inset |
| D12 spoke pill |3:Manage32/logo20; Build21/default removal unchanged |
| D13 locks |3:Idle input/output/Income14px; selection remains available |
| D14 inline headers |3/7:six centered protocol/subtitle/network headers, gap12, complete text |
| D15 natural panels |3/6/7:reference heights compared; no fixed/min-height constraint |
| D16 inline selection |5/6/7:kind/node/origin, canvas/list synchronization, no Dialog/route |
| D17 draft retention |5/6/7/9:LP -> Idle/Collect -> Back, review freshness, journal and viewport |
| D18 authoritative queue |POO-2230/6b:cohort/deadline/timezone/reserves/asOf; no guessed cutoff/order |
| D19 Idle edge states |6:zero/missing/error/partial/expired/>3days/multiple-deadlines/rollover, Retry/Back |
| D20 real fees |7:ordered raw amount0/1 and verified decimals/logos; fixture only in harness |
| D21 manual Collect |7/8/9:all fees, explicit intent, no schedule/picker; capability/preview gate |
| D22 recovery |5/8/9:operation identity and pending/unknown/reload/partial reconciliation without replay |
| D23 i18n/a11y |Every runtime slice:all destination locales, exact values, full text, keyboard/focus |
| D24 evidence |Every PR:meaningful tests plus honest screenshot/manual evidence, docs/IDs/issues in sync |

Supplemental Bridge criteria: every crossing traverses its matching Bridge before the envelope; no local Bridge; no class/network/token/cohort implicit merge; spoke Supply covered; Build debt/conversions retained; noninteractive auto nodes; same selection/viewport; origin receipt distinct from hub settlement. Geometry tests cover the diagram; operation tests cover typed compatibility/receipt semantics after the capability exists.

## 10. Validation and small-PR delivery policy

Use focused TDD for changed layout/state/models/hooks/actions and financial flow rules. Do not add tests that merely mirror decorative classes. Useful targets:

- `manageLayout.test.ts`: true ports/origin, single green, dimensions/axes, Bridge-before-boundary, local/cross-network classification, class separation, bounds and deterministic multiple spokes/positions.
- `ManageCanvas.test.tsx`: native-only, selectable Idle/Collect, fixed locks, noninteractive Bridges, complete hover, current range independent of drafts and Hub outside transform.
- `ManageScreen.test.tsx` / `ManageBlockPanel.test.tsx`: LP -> Idle/Collect -> Back, duplicate-pool identity, absent/disappeared origin, owner/core changes, focus/hidden panels, visibility vs operation ownership and real preview invalidation.
- Shared `CanvasViewport`, `SpokeGroup`, `FlowPill`, `GraphEdges`: existing Build defaults and controls preserved.
- `build/layout/layoutGraph.test.ts` and relevant oracles: principal origin, connection parity, local merges, spoke Supply, hub-only stability and Canvas E debt order.
- Queue/Collect models and actions:exact raw6/18, ordered metadata, zero vs absent, authoritative dates/cohorts/reserves, stale/late responses, capability/expiry and receipt/recovery boundaries.

During implementation, comparison harness/story evidence covers seven panels and loading/unavailable/zero/error states; widths320/375/736/1520 and a wider desktop, root font16/20/24, pt-BR/es and a long-text locale. Include pt-PT with its own translations when configured in the revalidated destination. Do not mix the unrelated locale migration into this package. Figma exports and jsdom are not runtime screenshots.

Per user instruction, **do not run the full local suite, coverage, production build or browser investment journey**. Run changed-file lint, affected unit/component tests and applicable locale/analytics/token checks present in the destination. Run TypeScript at the appropriate scope/resource budget; document skipped checks and use existing CI for wider validation. Repeating broad checks without a new failure or concern is unnecessary.

Each runtime PR includes configured-locale parity, relevant view/funnel/abandonment/blocked-intent/error emitters, ANALYTICS_EVENTS and exact emitting IDs, feature README/INTEGRATION_POINTS/IDS_REGISTRY and relevant COMPLIANCE_REGISTER entries. Financial completed fires on the authoritative scope's settlement.

Coordinator plus at most two GPT-6.1-sol workers, with explicit non-overlapping ownership. Suggested implementation division: workerA owns Manage layout/Bridges (1/2); workerB owns optional shared chrome/header work (3); coordinator reviews dependencies and integrates shared ManageCanvas edits sequentially. Build (4) follows as a separate task/PR. Selection and Collect panel/operation work are sequenced after the state boundary is verified. All workers preserve others' changes and only the coordinator posts to Slack.

Claim files/issue/branch before coding, review each worker diff and focused evidence, commit frequently, use small squash PRs, and delete a merged branch when it is no longer needed. Slack coordination uses the existing epic thread and one PR thread per review request. No unrelated license/other project merge is authorized by this planning task.

## 11. Completion record

Completed for this planning package:

- Read the primary handoff and later Bridge supplement completely; compared live Figma metadata and latest exported Choice/Collect images.
- Reviewed current public main and API source with two GPT-6.1-sol audits; reconciled API Collect reuse and state-ownership findings.
- Created POO-2270..2279 under POO-2116/Manager Console, with files, numbered scoped rules, tests and dependencies. POO-2279 remains Needs Rules.
- Appended October7 requirements to POO-2230 without overwriting prior history; POO-2277 belongs to Rafael.
- Registered intake, document ID, integration context and compliance verification for the planned work.

This is a reviewed plan, not an implementation-complete claim. Runtime PRs, focused test results, screenshots, live endpoint examples, signing and deployment remain future delivery evidence.
