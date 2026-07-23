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
