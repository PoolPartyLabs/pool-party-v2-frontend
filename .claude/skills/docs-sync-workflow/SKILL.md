---
name: docs-sync-workflow
description: Keep Pool Party Frontend documentation in sync with code. IDS_REGISTRY, feature READMEs, INTEGRATION_POINTS, FIGMA_INVENTORY, RULES_DRIFT, drift audit.
---

# Docs Sync Workflow

## Canonical files

**Immutable** (change only via explicit PR):
- `docs/00_OVERVIEW.md` through `docs/08_DOCUMENTATION_STYLE_GUIDE.md`

**Living** (auto-updated):
- `docs/IDS_REGISTRY.md`, `docs/INTEGRATION_POINTS.md`, `docs/FIGMA_INVENTORY.md`, `docs/RULES_DRIFT.md`, `docs/CONSISTENCY_REPORT.md`
- `src/features/<area>/README.md`, `src/components/<group>/README.md`

## IDS_REGISTRY

```markdown
# IDs Registry
Last update: <date>

## By area

### CORE (Design System)
| ID | Type | Name | Status | Coverage | Figma | Linear |
|----|------|------|--------|----------|-------|--------|
| PP-CORE-CMP-010 | Component | Button | Done | 95% | [link] | [link] |
```

Status: Backlog, In Progress, In Review, Done, Removed.

## INTEGRATION_POINTS

Generated via grep for `// PP-INTEGRATION-POINT`. Table with ID, file, line, function, expected replacement.

## RULES_DRIFT

For each file with `@implements-rules-version: vN`, compare with the `rules:vM` label of the linked Linear issue. If `M > N`, drift. Report and create a `rules-drift` issue.

## Feature README template

```markdown
# Feature: <Name>
## i18n namespace
`<feature>.*`
## Global status
- Screens: X/Y implemented
- Average coverage: Z%
## IDs
| ID | Type | Name | Status | Coverage |
## Integration points
## Notes
```

## Workflow

1. Grep code for `@id` headers.
2. Cross-reference with Linear (status).
3. Read coverage from Vitest output.
4. Update living files.
5. Open a small PR `docs(sync): ...` with label `docs`.

## Anti-patterns

- Changing canonical docs without an explicit rule-change PR.
- Deleting historical IDS_REGISTRY entries (always mark Removed).
- Letting feature READMEs go stale.
