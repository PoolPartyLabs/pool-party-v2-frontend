# Design Intake

Single queue for design changes flowing from Figma into development. **Read this file at the start of every working session.** It is the bridge between the design source (Figma) and the backlog (Linear).

## How it works

1. **A design change happens in Figma** (a new screen, an edit to an existing one, a new state, or a removal). The designer adds a row to the table below, referencing the artifact ID(s) from `IDS_REGISTRY.md` (or "NEW" if the ID is not assigned yet).
2. **At the start of each session**, this file is reviewed before any other work.
3. **Each pending row is triaged into Linear:** a Linear issue is created in the matching project, referencing the artifact ID(s), the change, and a link to the Figma frame. Business rules are discussed and recorded on the issue before development starts.
4. **Once an issue exists, the row is removed from this file** and its outcome noted in the changelog at the bottom. The Linear issue becomes the single source for that work from then on.

A row only lives here while it is *pending triage*. An empty table means design and backlog are in sync.

## Conventions

- **Change type:** `New` (new artifact) · `Edit` (visual/behavior change) · `State` (new state of an existing artifact) · `Remove` (artifact removed; mark the ID `Removed` in the registry, never recycle it).
- **Artifact ID:** the `PP-AREA-TYPE-NNN` from `IDS_REGISTRY.md`. Use `NEW` if not yet reserved; reserve the next ID in that AREA+TYPE when triaging.
- Reserve a new ID for genuinely new artifacts; reuse the existing ID for edits/states (mobile and desktop of one screen share one ID).

## Pending intake

_Empty. No design changes awaiting triage._

| Date | Artifact ID(s) | Change | Description | Figma | Area / Project |
|------|----------------|--------|-------------|-------|----------------|
| | | | | | |

## Triaged (changelog)

Append-only record of intake rows that became Linear issues. Keep brief.

| Date triaged | Artifact ID(s) | Change | Linear issue |
|--------------|----------------|--------|--------------|
| 2026-05-30 | PP-AUTH-SCR-001 (+ SCR-002 reserved) | Triaged. Design change: email login removed from desktop (`4769:131`) so both layouts = Google + Connect a wallet; `PP-AUTH-SCR-002` (OTP) reserved (no entry, kept for future 2FA); mobile wallet copy unified to "Connect a wallet". | [POO-80](https://linear.app/yeildbay/issue/POO-80) |
| 2026-06-11 | PP-STR-CMP-006 · PP-STR-MOD-009 | Yield Receipt share card (variant set Result=Gain/Loss, Components `5888:522`) + share modal promoted to the real pages (sheet `5835:131`, dialog `5837:183`). Ids renumbered from the draft CMP-005/MOD-006: the code already claims those (StrategyMiniHeader / Compound). | [POO-275](https://linear.app/yeildbay/issue/POO-275) |
| 2026-10-04 | PP-STR-SCR-001, PP-STR-SCR-002, PP-STR-SCR-004, PP-PRT-SCR-001, PP-STR-MOD-001 | Investor V2 owner handoff triaged; preserve lists, reuse Details/transaction hosts, exclude exploratory modals; missing capabilities explicitly unavailable. | [POO-2214](https://linear.app/yeildbay/issue/POO-2214), POO-2215/2216/2217; API follow-up POO-2219 |
| 2026-10-04 | PP-STR-SCR-006, PP-STR-CMP-040 | Missing composition donut and no-history state from Details frames 8275:2576 / 8252:2502; owner explicitly enables local Follow/Following without a mock label. | [POO-2223](https://linear.app/yeildbay/issue/POO-2223) |
| 2026-10-04 | PP-MGR-SCR-004, PP-MGR-CMP-001/002, PP-MGR-CMP-085/086 | Owner Manager Manage V2 handoff triaged: inline Move/Create, real holdings/cash canvas, typed V2 boundary; missing integrations explicitly unavailable. | POO-2226, POO-2227, POO-2228 |
| 2026-10-04 | PP-MGR-LIB-051/052, PP-MGR-CMP-085 | Incremental Manage visual handoff: straight spokes, symmetric anchors, aligned return bends, current-position range status; retain fee conversion. | [POO-2232](https://linear.app/yeildbay/issue/POO-2232) |
| 2026-10-04 | PP-MGR-CMP-081, PP-MGR-HOK-019/022 | Owner screenshot and provisioning reference PP-CORE-CMP-071 (Figma 6550:615): one launch step visible, persistent 19-minute report estimate and unchanged report-driven progression. | [POO-2233](https://linear.app/yeildbay/issue/POO-2233) |
| 2026-10-05 | PP-MGR-SCR-002, PP-MGR-LIB-023, PP-MGR-CMP-046/049..059/061 | Owner Build screenshots and current Figma DEV NOTES: continuous full-path hover, neutral Income output, fixed locks, fitted viewport, expandable sidebar, manual Swap and spoke allocation panels. | [POO-2235](https://linear.app/yeildbay/issue/POO-2235), [POO-2236](https://linear.app/yeildbay/issue/POO-2236), [POO-2237](https://linear.app/yeildbay/issue/POO-2237) |

| 2026-10-06 | PP-MGR-SCR-001/004, PP-MGR-CMP-085/086, PP-MGR-LIB-051 | Consolidated Overview/Manage handoff: unified setup, explicit financial states, native-only cash and inline timeout recovery. | POO-2245, POO-2246; API POO-2247 and existing POO-2229/2230/2231 |
| 2026-10-07 | PP-MGR-SCR-002/004, PP-MGR-CMP-085/086, PP-MGR-LIB-023/052, PP-MGR-DOC-001 | Latest canvas/panels and overriding spoke-return Bridge handoffs triaged: compact cash/Idle, principal/fee paths, overlays/headers/locks, inline selection/Idle/Collect. Charts/Activity lacks destination/content readiness and remains Needs Rules. | [POO-2270](https://linear.app/yeildbay/issue/POO-2270)..[POO-2279](https://linear.app/yeildbay/issue/POO-2279); existing API POO-2230 clarified, Collect extension POO-2277; [delivery plan](manager-canvas-panels-plan-2026-10-07.md) |
| 2026-10-07 | PP-CORE-CMP-075, PP-MGR-SCR-002/009, PP-MGR-LIB-059, PP-MGR-CMP-088/089 | Owner-approved local Solana editor: guarded selected-V2 gesture, four protocol logos/configuration, fit/continuous gray principal and green LP-fee paths; current 144 × 96 native cash. Historical market fixtures excluded; unsupported data/execution unavailable. References [Build 8359:2725](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-2725), [Graph 8370:2816](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8370-2816), [Configure 8359:3089](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-3089). | [POO-2281](https://linear.app/yeildbay/issue/POO-2281), rules v2; POO-2282 canceled; real integration POO-2239/2240/2261/2262 |
