---
name: consistency-checker
description: Verifies documentation and code consistency for Pool Party. Validates cross references between docs, IDs in the registry, referenced skill/agent names, naming conventions, rule versions (@implements-rules-version vs Linear), translations mirrored across all configured locales. Reports drift as Linear issues.
---

# Consistency Checker

A skill that runs a periodic cross-consistency audit of all Pool Party Frontend documentation and code. Runs weekly in CI or on demand.

## Principle

Documentation is only useful if trusted. Drift between docs and code is silent and poisonous. This skill hunts drift systematically.

## What it verifies

### 1. Cross references between docs
For each markdown file in `docs/`, scan relative links: does the target file exist? Does the anchor (`#section`) exist in the target?

### 2. IDs in registry vs code
- Each `@id PP-XXX-XXX-XXX` in code exists in `docs/IDS_REGISTRY.md`?
- Each registry entry has a corresponding code file (or is marked `Removed`)?
- Duplicate IDs across files?

### 3. Referenced skill/agent names
Canonical lists: agents in `06_CLAUDE_CODE_AGENTS.md`, live skills in `.claude/skills/INDEX.md` (do **not** hardcode counts here, they drift). For each file, verify every backticked mention of a skill or agent resolves to a live `.claude/skills/<name>/` or `.claude/agents/<name>.md` (or, intentionally, the `.claude/_protocol/` quarantine). Detect obsolete names, typos, nonexistent references.

### 4. Naming convention in code
Apply `02_NAMING_CONVENTION.md`: PascalCase components, camelCase hooks with `use`, kebab-case folders, no `data`/`info`/`manager`/`wrapper`/`container`/`helper` as primary names, boolean prefixes, no Portuguese words in code. Warning, not blocking.

### 5. Rule versioning (rules drift)
For each file with `@implements-rules-version: vN`, compare with the linked Linear issue's `rules:vM`. If `M > N`, drift. Create/update a `rules-drift` issue.

### 6. Mirrored translations
Parity across **all 11 locales** (`src/i18n/config.ts`), not just pt-BR/es: every key in `en/<namespace>.json` exists in every locale, and keys present in a non-en locale but not in en are orphans (en is the source). This overlaps `pnpm i18n:check`, prefer running that as the source of truth and only re-check here if it is not wired into the audit.

### 7. Integration points inventoried
For each `// PP-INTEGRATION-POINT`, verify it is listed in `docs/INTEGRATION_POINTS.md` and the description matches. Vice versa too.

### 8. Mandatory headers
For each component, hook, page, and service: has the standard header with required fields filled.

### 9. Markdown doc conventions
Headers start with a capital only on the first word, no em-dashes (—) in text, lists with `-`, code blocks with a language.

## Workflow

### Command
```bash
pnpm consistency:check
```

### Output
1. **Terminal summary** with pass/warn/fail per category.
2. **Detailed report** in `docs/CONSISTENCY_REPORT.md`: table with each finding (file, line, type, description) and a suggested fix.
3. **Linear issues** for critical drifts: each rules drift becomes a `rules-drift` issue; each broken reference in a canonical doc becomes a `docs-drift` issue. Warnings stay only in the report.

### CI mode
Fail the build if: a broken reference in a canonical doc, rule drift in a code file on main, a translation key missing in any language. Warnings do not fail CI.

## Anti-patterns

- Running the skill but not acting on findings.
- Marking a finding as "false positive" without analysis.
- Suppressing a warning to make CI pass without fixing the cause.
- Ignoring rule drift because "it's just one file".
