# BOOTSTRAP

> **SUPERSEDED (2026-05-29).** This issue is historical. The Figma inventory was produced directly (see `../IDS_REGISTRY.md` and `../FIGMA_INVENTORY.md`, 99 artifacts), so the `figma-inventory` sweep below was not run. Kept for reference / future large Figma additions (e.g. Manager Console).

Single issue that triggers the Figma inventory and generates all feature issues.

---

## BOOTSTRAP-001: Inventory Figma and generate feature issues

**Project**: Foundation
**Labels**: `type:setup`, `priority:p0`
**Status**: `Ready`
**Agent**: `figma-inventory`

### Body

```markdown
## Goal

Run the `figma-inventory` agent to sweep the Pool Party Figma file, identify all screens and modals, assign IDs, and create Linear issues (one per artifact).

## Prerequisites

- [ ] Figma MCP connected and authenticated.
- [ ] Linear MCP connected.
- [ ] `docs/IDS_REGISTRY.md` exists (created empty in SETUP-011).
- [ ] Linear labels created (via linear-bootstrap, see FOUNDATION.md).

## Deliverables

- [ ] `docs/FIGMA_INVENTORY.md` generated.
- [ ] `docs/IDS_REGISTRY.md` populated with all IDs.
- [ ] N issues created in Linear, status `Needs Rules` (require business rules before advancing).
- [ ] Issues with `area: UNKNOWN` listed in the report for the user to categorize.
- [ ] PR opened with both doc files.

## Next steps (after this issue)

1. The user categorizes `UNKNOWN` areas.
2. The user (or team) fills "Business rules" in each issue, moving it to `Ready`.
3. `frontend-implementer` starts consuming `Ready` issues in priority order.
```
