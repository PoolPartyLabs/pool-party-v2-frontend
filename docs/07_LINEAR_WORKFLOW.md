# 07, Linear Workflow

How to organize the backlog, labels, cycles, and business rule versioning so Claude Code consumes tasks efficiently, using a TDD approach.

## Design intake flow (Figma to Linear)

Design is the source of truth. Changes reach the backlog through one path, tracked in `docs/DESIGN_INTAKE.md`:

1. A design change in Figma (new screen, edit, new state, removal) is logged as a row in `docs/DESIGN_INTAKE.md`, referencing the `PP-AREA-TYPE-NNN` artifact ID(s).
2. **`docs/DESIGN_INTAKE.md` is reviewed at the start of every working session.**
3. Each pending row becomes a Linear issue in the matching project, referencing the ID(s), the change, and the Figma frame. Business rules are discussed and recorded on the issue before development.
4. The row is then removed from `DESIGN_INTAKE.md` (logged in its changelog). The Linear issue is the single source for that work from then on.

New artifacts reserve the next ID in their AREA+TYPE; edits/states reuse the existing ID. Removed artifacts are marked `Removed` in `IDS_REGISTRY.md` and never recycled.

## Structure

### Team
`Pool Party` (key `POO`), workspace `yeildbay`.

### Project
A single project, **`Front End - Pool Party V2`**, holds all front-end work. Functional epics (Foundation, Dashboard, Strategies, Savings, Cards, Manager Console, Polish, etc.) are expressed via the `area:*` labels and (optionally) Linear milestones, not separate projects. (The earlier per-epic-projects plan was dropped in favor of one project + labels.)

### Labels
| Label | Color | Use |
|-------|-------|-----|
| `area:CORE`, `area:LAY` | gray | Design system, app chrome |
| `area:AUTH`, `area:DASH`, `area:PORT`, `area:STR`, `area:SAV`, `area:TOK`, `area:PRED`, `area:PERP`, `area:CARD`, `area:DEP`, `area:REW`, `area:MGR`, `area:PROF`, `area:NOTI`, `area:ACT` | varied | Per feature (real taxonomy, see `02_NAMING_CONVENTION.md`) |
| `type:screen`, `type:modal`, `type:component`, `type:hook`, `type:setup` | black | Artifact type |
| `priority:p0` | red | Blocking |
| `tech-debt` | brown | Originated from PP-DEBT |
| `mock-data` | pink | Mock task |
| `docs` | light gray | Documentation |
| `a11y` | pink | Accessibility |
| `i18n` | violet | Translation |
| `tdd:business-rules-needed` | light red | No clear rules |
| `claude-code:ready` | green | Ready for Claude to pick |
| `claude-code:in-progress` | yellow | In execution |
| `claude-code:blocked` | red | Needs input |
| `rules:v1`, `rules:v2`, ... | blue | Current rule version |
| `rules-drift` | orange | Rules changed after implementation |
| `docs-drift` | orange | Documentation out of sync |

## Status workflow

```
Backlog → Triage → Needs Rules → Ready → In Progress → In Review → Done
                                            ↓
                                        Blocked
```

### Rules
- **Backlog**: loose ideas.
- **Triage**: reviewed by a human.
- **Needs Rules**: has scope but lacks testable business rules. Stays here until `business-rules-clarification` approves.
- **Ready**: rules `v1+` registered, `rules:vN` label applied, `claude-code:ready` label.
- **In Progress**: Claude Code (frontend-implementer) picked it up.
- **In Review**: PR open.
- **Blocked**: needs a human decision.
- **Done**: PR merged.

> **Critical rule**: the `Needs Rules -> Ready` transition only happens when all 8 criteria of the `business-rules-clarification` skill are satisfied. It is not a manual transition; it is gated by the skill.

> **Current workspace reality (2026-05-29):** the team only has the default statuses **Backlog, Todo, In Progress, Done** (plus Duplicate/Canceled). The custom statuses `Triage`, `Needs Rules`, `Ready`, `In Review` above are the target workflow and require a Linear workspace-admin to create them. Until then: use `Todo` for "ready to build", `Backlog` for "not yet specced", and the `claude-code:*` / `tdd:business-rules-needed` labels to express readiness. The Foundation issues (POO-6..38) and Manager Console backlog (POO-39..46) follow this adapted scheme.

## Issue template (canonical)

Every implementation issue follows this format. Issues created by `figma-inventory` come with the structure but with "Business rules" empty (a field to be filled by a human before advancing).

```markdown
## ID
PP-XXX-XXX-XXX

## Type
[Screen | Modal | Component | Hook | Setup | Doc | Mock | Other]

## Area
[CORE | LAY | AUTH | DASH | PORT | STR | SAV | TOK | PRED | PERP | CARD | DEP | REW | MGR | PROF | NOTI | ACT | ERR]

## i18n namespace
`<feature>.<sub>` (e.g. `dashboard.summaryCard`)

## Description
What it is, what the user goal is.

## Figma
[link to the specific frame]

## Business rules (mandatory for TDD)
List each rule as a short, testable item. Format `[Rn]`.
- [R1] ...
- [R2] ...
- [R3] ...

## Business rules revision history
Append-only. Every change increments the version.
- **v1** (YYYY-MM-DD, author): initial rules. <summary>.
<!-- When changed: -->
<!-- - **v2** (YYYY-MM-DD, author): <change summary>. -->

## Visual states
- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] Success (default)
- [ ] Other: ___

## Data source
Which mock service(s) and method(s). E.g. `mockStrategyService.list()`, `mockStrategyService.getById()`.

## Mocks needed
What must exist in `src/mocks/data/` or `src/mocks/fixtures/`. Indicate whether they already exist or will be created.

## Integration points expected
List of what will be marked with `PP-INTEGRATION-POINT`.

## Error behavior
How to handle service errors? E.g. toast + retry, redirect, silent fallback.

## Translations needed
New keys (in every configured locale; en is the source). Claude Code proposes, human reviews in the PR.

## Acceptance criteria
- [ ] Skill `business-rules-clarification` approved (rules v_n_ clean)
- [ ] Tests written before implementation (TDD)
- [ ] All `[Rn]` rules covered by tests (with `// @rule Rn`)
- [ ] Coverage above the layer threshold
- [ ] Implementation faithful to Figma on desktop and mobile
- [ ] Header with `@id`, `@implements-rules-version: vN`, links, i18n namespace
- [ ] No `any` types
- [ ] loading/error/empty/success states covered
- [ ] `PP-INTEGRATION-POINT` marked at the right places
- [ ] Realistic mocks (scale, distribution, latency)
- [ ] Translations present in all configured locales
- [ ] Storybook stories (if applicable)
- [ ] Feature README updated
- [ ] IDS_REGISTRY updated
- [ ] PR open with title ending in `@rules-vN`

## Dependencies
`Blocked by`: list of issues that must be Done before this one.

## Notes
```

## Business rule versioning

### Principles
- Rules change. Every change is recorded.
- History is append-only in the issue body.
- The `rules:vN` label reflects the **current** version.
- PR and code point to the version actually implemented (`@rules-vN`).

### Change flow
1. The user or team decides to change a rule.
2. Update the issue body: edit the rule AND add a line to "Business rules revision history" (`vN+1`).
3. Update the issue label (`rules:vN+1`).
4. **If the issue was already `Done`**:
   - Bot/agent comments on the issue: "Current implementation in `v(N)` may be outdated".
   - Create a follow-up issue with label `rules-drift`, linked as `Related to`.
5. **If the issue is `In Progress`**:
   - The agent stops work, aligns with the user on whether to reuse or restart.
6. **If the issue is `Ready`**:
   - Re-run `business-rules-clarification` on the new version.

### Periodic audit
`docs-sync-workflow` runs:
- Compares `@implements-rules-version: vN` in each code file with the `rules:vN` label of the corresponding issue.
- Drift detected then create/update a `rules-drift` issue.
- Report in `docs/RULES_DRIFT.md` (generated once the `docs-sync-workflow` / `consistency-checker` skills are promoted from staging).

## Proposed initial backlog

Listed in `_linear-issues/` (specs):
- `FOUNDATION.md`: 13 setup issues.
- `DESIGN_SYSTEM.md`: tokens + 12 primitives (`PP-CORE-CMP-010..021`) + AppShell.
- `MOCKS_AND_I18N.md`: 5 foundation issues.
- `BOOTSTRAP.md`: historical (the Figma inventory trigger). **Superseded:** the inventory was produced directly (see `FIGMA_INVENTORY.md` / `IDS_REGISTRY.md`, 99 designed artifacts), so no `figma-inventory` run is needed.

**Status (2026-05-30):** the original `POO-5..46` batch was archived. Foundation is live as **POO-47..POO-59** (13 setup) + **POO-60..POO-79** (2 tokens · 4 mocks · 1 i18n · 12 primitives · AppShell), wired with a `blockedBy` dependency graph; see `IDS_REGISTRY.md` for live links. The Manager Console backlog (**POO-39..POO-46**) was archived in the same purge and is pending recreation. Feature issues for the 99 designed artifacts are generated from `IDS_REGISTRY.md` on demand (not via a bootstrap agent).

## Recommended Linear views

- "Ready for Claude Code": `label = claude-code:ready AND status = Ready`.
- "Claude Code Active": `label = claude-code:in-progress`.
- "Needs Rules": `status = Needs Rules`.
- "Rules Drift": `label = rules-drift`.
- "Tech Debt": `label = tech-debt`.
- "Blocked": `label = claude-code:blocked`.
- "i18n review": `label = i18n`.

## PR integration

- PR title is Conventional Commits `<type>(<ID>): <description>`, appending ` @rules-vN` when rules apply.
- Body references `Closes POO-XXX` (the Linear issue key — the artifact ID `PP-XXX` does not auto-close the issue).
- Branch naming: `<type>/<area>-poo-<num>-<slug>` (`<area>` required; `poo-<num>` = lowercase Linear key, not the artifact ID). Canonical: `docs/02_NAMING_CONVENTION.md`.

## Estimates

`Points` (Fibonacci): 1, 2, 3, 5, 8.
- 1: trivial.
- 2: small (simple component).
- 3: medium (screen with mocks and tests).
- 5: large (multi-screen flow).
- 8: very large, split before.

Calibrate in the first cycles.
