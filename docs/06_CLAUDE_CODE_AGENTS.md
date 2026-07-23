# 06, Claude Code, Agents and Skills

This document defines which agents we run with Claude Code, which skills each one needs, and how they coordinate to implement the Pool Party frontend by consuming Linear tasks, using a TDD approach with trilingual i18n.

## Overview

We use Claude Code with:
1. A `CLAUDE.md` at the repo root (base context, immutable rules, links to docs).
2. Specialized subagents (configured in `.claude/agents/`).
3. Versioned skills in the repo (in `.claude/skills/`).
4. MCP servers for Linear, Figma, GitHub.

## Proposed subagents

### 1. `frontend-implementer` (main)

**Responsibility**: implements code from a Linear task, using a TDD approach.

**Inputs**: task or issue ID.

**Workflow**:
1. Run `business-rules-clarification` (mandatory phase 0). If there is any gap, move the issue to `Needs Rules` and ask structured questions. Stop.
2. Read the task in Linear via MCP.
3. Read the corresponding Figma frame via MCP.
4. Confirm/generate the ID per `02_NAMING_CONVENTION.md`.
5. **Write tests first**, translating each business rule into test cases. File `Xxx.test.ts` next to the target.
6. Run the tests. Confirm ALL fail with the expected message (not an import crash).
7. Implement the minimum to pass.
8. Re-run, green. Refactor keeping green.
9. Implement the component/screen per `04_CODE_STANDARDS.md`.
10. Create corresponding mocks if missing.
11. Mark integration points with `PP-INTEGRATION-POINT`.
12. **Create/update translation files in every configured locale** (en source; pt-BR/es curated; the rest machine-translated pending native review, see 01_TECH_STACK > Locale policy). Mark sensitive terms with `PP-I18N`.
13. Create Storybook stories if eligible.
14. Run lint, typecheck, coverage. Ensure above threshold.
15. Update the feature README and IDS_REGISTRY.
16. Open PR (title `<type>(<ID>): <description> @rules-vN`).
17. Update the task in Linear (status, PR link).

**Tools**: Read, Write, Edit, Bash, MCP Linear, MCP Figma, MCP GitHub.

**Skills**: `business-rules-clarification`, `tdd-workflow`, `react-component-blueprint`, `nextjs-page-blueprint`, `mock-service-blueprint`, `figma-tokens-to-tailwind`, `i18n-translation-rules`.

---

### 2. `design-system-builder`

**Responsibility**: owns the local design system (tokens, primitives, variants).

**When**: first foundation tasks, and whenever a new primitive is added.

**Workflow**:
1. Read Figma tokens via MCP.
2. Generate `src/design-system/tokens/` with colors, spacing, typography, radii, shadows.
3. Update `tailwind.config.ts` referencing the tokens.
4. Implement primitives (Button, Input, Card, etc) using shadcn as base and customizing.
5. **For each primitive, write tests first (TDD).** Smoke + behavior.
6. Create Storybook stories (D7 = yes).

**Tools**: Read, Write, Edit, Bash, MCP Figma.

**Skills**: `figma-tokens-to-tailwind`, `react-component-blueprint`, `tdd-workflow`.

---

### 3. `mock-data-curator`

**Responsibility**: creates and maintains realistic mock data.

**When**: a feature needs data that does not yet exist in the mocks.

**Workflow**:
1. Read the types defined in `src/lib/types/`.
2. Generate plausible and diverse data (all visual states covered).
3. **Write the service tests that validate the contract** (signature, return shape, error behavior).
4. Implement the mock service.
5. Create fixtures for Storybook/tests.

**Tools**: Read, Write, Edit.

**Skills**: `mock-service-blueprint`, `tdd-workflow`.

---

### 4. `i18n-translator`

**Responsibility**: manages the translation files in every locale from `src/i18n/config.ts`.

**When**: when `frontend-implementer` adds new keys, or in a dedicated review pass.

**Workflow**:
1. Detect new keys in the source language (`en`).
2. Propose translations for pt-BR and es, respecting DeFi sector conventions (TVL, slippage, APR stay in English).
3. Identify orphan keys (in one language but not others).
4. Identify keys used in code but absent from files.
5. Mark ambiguous terms with `PP-I18N` in the PR for review.

**Tools**: Read, Write, Edit, Bash.

**Skills**: `i18n-translation-rules`.

---

### 5. `documentation-keeper`

**Responsibility**: keeps docs AND GitHub in sync with the code.

**When**: after each merged PR, periodically, or on demand. Before releases.

**Workflow (docs)**:
1. Scan for new artifacts without the standard header.
2. Update IDS_REGISTRY.
3. Update feature READMEs with IDs, status, coverage.
4. Update INTEGRATION_POINTS.md with new marked points.
5. Detect drift between docs and code.

**Workflow (GitHub)**:
1. On release: update CHANGELOG, bump package.json version, generate release notes.
2. Create tags and GitHub Releases.
3. Comment on closed Linear issues with the release version.

**Tools**: Read, Write, Edit, Bash, MCP GitHub.

**Skills**: `docs-sync-workflow`, `consistency-checker`, `git-workflow`.

---

### 6. `tech-debt-tracker`

**Responsibility**: scans `PP-DEBT`, `PP-FIXME`, `PP-TODO`, `PP-I18N` tags and generates Linear issues.

**When**: scheduled (e.g. daily in CI) or on demand.

**Workflow**:
1. Grep the repo for tags.
2. For each tag, check whether an associated Linear issue already exists.
3. If not, create an issue with context and the appropriate label (severity, type).
4. Update the code comment with the created issue ID.

**Tools**: Read, Edit, Bash, MCP Linear.

**Skills**: `tech-debt-scanner`.

---

### 7. `qa-reviewer`

**Responsibility**: reviews PRs before merge.

**When**: when a PR is opened.

**Workflow**:
1. Read the diff.
2. Check conformance with `04_CODE_STANDARDS.md`.
3. **Verify tests were written for every business rule listed in the issue.**
4. **Verify there is a test for every public function** in hooks, services, lib/utils.
5. Verify every locale has the expected keys.
6. Verify no text is hardcoded.
7. Run lint, typecheck, tests, coverage.
8. Verify IDs are registered.
9. Approve or request changes.

**Tools**: Read, Bash, MCP GitHub.

**Skills**: `pr-review-checklist`, `a11y-checklist`.

---

### 8. `analytics-instrumenter`

**Responsibility**: instruments the frontend with analytics tracking, privacy-first, without leaking secrets.

**When**: as part of a feature cycle, after `frontend-implementer` and before `qa-reviewer`; in a dedicated instrumentation pass; or on demand.

**Workflow**:
1. Grep for interactive elements (onClick, onSubmit, navigation, error boundaries) and cross-reference existing `track()` calls to list untracked actions.
2. Map each action to a canonical event from `docs/ANALYTICS_EVENTS.md` or propose a new one following `<area>_<object>_<action>`.
3. Instrument via `useAnalytics().track(event, params)`, hashing any wallet address with `hashWalletAddress()` before sending as `user_id`.
4. Enforce privacy: never push a seed phrase, private key, or raw wallet address; identified events fire only after consent.
5. Add/update tests asserting the dataLayer push and the negative test (no raw address leaked).
6. Update `docs/ANALYTICS_EVENTS.md` and the `@analytics-events` header of each instrumented file. Keep the `AnalyticsEvent` union in sync.
7. Open or extend the feature PR with label `analytics`.

**Tools**: Read, Write, Edit, Bash, Glob, Grep.

**Skills**: `analytics-tracking`, `tdd-workflow`.

---

### 9. `security-reviewer`

**Responsibility**: reviews and hardens the frontend for web security against `docs/10_SECURITY.md`, and hard-fails leaks of secrets. Frontend scope today; devops-infra, backend, and smart-contract reviewers are added per area later.

**When**: as part of a feature cycle, around `analytics-instrumenter` and before `qa-reviewer`; in a dedicated hardening pass before a release; or whenever a new external dependency (RPC, script, iframe, onramp) is added.

**Workflow**:
1. Verify HTTP security headers in `next.config.ts` / `src/middleware.ts` (nosniff, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP `same-origin-allow-popups`, CORP, HSTS without `preload`).
2. Check the CSP (Report-Only acceptable pre-enforcement) is an explicit allowlist; hard-flag `connect-src *`, `'unsafe-eval'`, or `'unsafe-inline'` in `script-src`.
3. Confirm clickjacking defenses (`frame-ancestors 'none'` plus `X-Frame-Options: DENY`).
4. Verify cookie flags (`HttpOnly` except `pp_consent`, `Secure`, `SameSite`), `Cache-Control: no-store` on authenticated responses, and single-use SIWE nonces on the real domain.
5. Verify client CORS: no wildcard origin with credentials, no unvalidated origin reflection.
6. Grep the diff for secrets reaching logs, analytics, the dataLayer, or error reports. Any hit fails the review.
7. Report findings by severity (block / warn / note); apply safe header fixes directly, leave CSP allowlist judgment calls for review. Label the PR `security`.

**Tools**: Read, Write, Edit, Bash, Glob, Grep.

**Skills**: `frontend-security`, `tdd-workflow`.

---

### 10. `figma-inventory` (runs once at start)

> **Status (2026-05-29): already done manually, not via this agent.** The investor-app Figma was swept and `IDS_REGISTRY.md` / `FIGMA_INVENTORY.md` produced (99 artifacts). Keep this agent definition for future large Figma additions (e.g. when the Manager Console is designed).

**Responsibility**: full sweep of the Figma file and generates all feature issues in Linear, with assigned IDs.

**When**: once, in issue `BOOTSTRAP-001`. May run again for large Figma additions.

**Workflow**:
1. Read the Figma file via MCP.
2. Iterate over all Pages.
3. For each screen or modal frame, extract name, inferred functional area, type (Screen/Modal), direct node link, apparent visual states.
4. Assign an ID per `02_NAMING_CONVENTION.md`.
5. For each item, create a Linear issue with the standard template (fill what can be inferred from Figma; leave "Business rules" empty with label `tdd:business-rules-needed` and status `Needs Rules`).
6. Update `docs/IDS_REGISTRY.md` with the complete table.
7. Produce a markdown report (`docs/FIGMA_INVENTORY.md`) organized by area.
8. Return a summary to the operator (how many screens, how many modals).

**Tools**: Read, Write, Edit, Bash, MCP Linear, MCP Figma.

**Skills**: `figma-tokens-to-tailwind` (partial, for variable parsing), `docs-sync-workflow`.

**Important**: this agent does NOT implement code. It only inventories and opens tickets. Implementation is for `frontend-implementer`.

---

### 11. `linear-bootstrap` (runs once at start)

> **Status (2026-05-29): superseded.** Labels and the 33 Foundation issues (POO-6..38) + Manager Console backlog (POO-39..46) were created directly via the Linear MCP, into the single `Front End - Pool Party V2` project. No separate per-epic projects or custom statuses were created (workspace only has Backlog/Todo/In Progress/Done).

**Responsibility**: populates Linear with the 34 initial issues from the files in `docs/_linear-issues/` via MCP. Creates projects, labels, custom statuses.

**When**: once, before BOOTSTRAP-001. Idempotent.

**Workflow summary**:
1. Create projects, labels, and the custom status (`Needs Rules`) in Linear via MCP.
2. Create recommended views.
3. Parse the 4 `.md` files in `docs/_linear-issues/`.
4. Create issues in topological order (dependencies resolved).
5. Keep a `localId -> Linear ID` mapping in `docs/LINEAR_ID_MAPPING.json`.
6. Generate a report `docs/LINEAR_BOOTSTRAP_REPORT.md`.

**Tools**: Read, Write, Edit, Bash, MCP Linear.

**Skills**: `docs-sync-workflow` (partial).

**Idempotency**: if run again, skips already-created issues (detected by title prefix).

---

### 12. `linear-orchestrator` (optional, continuous cycle)

**Responsibility**: manages the Linear backlog, prioritizes, assigns to `frontend-implementer`.

**When**: continuous cycle.

**Workflow**:
1. Read the backlog filtering by status "Ready" + label `claude-code:ready`.
2. Sort by priority.
3. For the next task, invoke `frontend-implementer`.
4. Track progress, update status.

> This agent is the "engine" of "Claude Code keeps pulling tasks and assembling the whole frontend". Start without it and add it once the base is stable.

### 13. `figma-spec`

**Responsibility**: turns a Figma screen/area into a Linear spec to the project standard. Reads Figma + reads/writes Linear via MCP; read-only on the code repo (never writes code). Drives the Design Intake path.

**When**: a Figma change needs triage into the backlog, an epic needs backfilling, or a Figma/Linear/code reconciliation pass.

**Workflow**:
1. Start from the Design Intake queue (`docs/DESIGN_INTAKE.md`) - a Figma change reaches dev only through it.
2. Pull each frame's element tree (`get_metadata`) + screenshots; list deltas vs shipped code/i18n/mocks.
3. Draft numbered business rules `[R1]...`; surface decisions only the user can make and ask first (never invent rules).
4. Write/reconcile the Linear issue(s) to the standard; drain the intake row + log it in the changelog.

**Tools**: Read, Bash, Grep, Glob, MCP Figma, MCP Linear.

**Skills**: `business-rules-clarification`, `figma-use` (when explicitly editing Figma).

---

## Proposed skills

Skills are folders with `SKILL.md`. They live in `.claude/skills/` in the repo. See `.claude/skills/INDEX.md` for a one-line map. Total: **14 skills**.

### `business-rules-clarification` (the most important)
Clarification and versioning of business rules. Runs **before** any implementation, always. Applies 8 "rules ready" criteria. If there is a gap, stops work and asks structured questions. Versions every change.

### `tdd-workflow`
How to write tests before implementation. Rule `[Rn]` to test case mapping, `describe`/`it` structure with `// @rule Rn`, dependency mocking, `renderHook`/`renderWithProviders`, coverage thresholds.

### `react-component-blueprint`
How to create a React component following the Pool Party pattern. Header template with `@implements-rules-version`, file structure, props typing, CVA variants, mock integration via hook, `useTranslations`.

### `nextjs-page-blueprint`
How to create a screen (route) in App Router with i18n. `[locale]/path/page.tsx` structure, Server vs Client, `loading.tsx`, `error.tsx`, `not-found.tsx`.

### `mock-service-blueprint` (strong emphasis on realism)
How to create/update **realistic** mocks. Indistinguishable-from-reality principle, correct scale (with table), plausible distribution, realistic addresses, variable latency with jitter, rare but present errors, data in motion, session consistency, diversity of states.

### `i18n-translation-rules`
Translation conventions for all configured locales (en source). File structure per namespace, DeFi terms in English, ICU MessageFormat, orphan/missing key detection.

### `figma-tokens-to-tailwind`
How to extract Figma tokens (Variables) and generate config. MCP listing, mapping to versioned files, tailwind.config.ts update, test validation.

### `docs-sync-workflow`
How to keep docs current. IDS_REGISTRY update, feature READMEs, INTEGRATION_POINTS.md, drift audit between `@implements-rules-version` and Linear.

### `consistency-checker`
Cross-consistency audit of docs and code. Runs weekly. Cross references between docs, IDs registry vs code, skill/agent names, naming convention, rule versioning drift, mirrored translations, integration points, mandatory headers.

### `git-workflow`
Git and GitHub conventions: branches, commits, PRs, tags, releases. Keeps GitHub current at every step. Branch naming, Conventional Commits + `[rules-vN]`, PR workflow, Linear sync, tags/releases, hooks.

### `tech-debt-scanner`
How to scan tags and generate issues. Scan regex, tag to label/priority mapping, issue template, code update with `Tracked in PP-XXX`.

### `pr-review-checklist`
How to review a PR. Complete checklist (header, tests vs rules, marked mocks, translations in all locales), automated checks, structured feedback format.

### `a11y-checklist`
Accessibility for a dark-theme money app: focus management in sheets/transactional modals, contrast on dark surfaces, aria-live for dynamic monetary values, full keyboard support (deposit keypad, switches, sliders). Used by `qa-reviewer` on every PR and by `react-component-blueprint` for new components.

### `feature-flags-workflow`
How to gate a feature behind a flag (premise 10): register in `src/lib/features/registry.ts`, gate route (`requireFeature`) + nav (`NavItem.flag`) + entry links (`useFeatureFlags`), test both states via the dev-override store, and run the launch/retire checklist. Companion to `docs/FEATURE_FLAGS.md`.

### `analytics-tracking`
How to instrument event tracking with GTM + GA4. dataLayer schema, the OAMS event taxonomy (`<area>_<object>_<action>`), the `useAnalytics()` hook, Consent Mode v2, privacy rules (hash wallet addresses, never track secrets), Web Vitals, and how to test tracking.

### `frontend-security`
Frontend security hardening for the Next 15 app. HTTP security headers, a wallet-aware CSP, clickjacking defenses, cookie and SIWE hardening, CORS/fetch scoping, and how to test it. Implements the Frontend rows of `docs/10_SECURITY.md`.

## Root CLAUDE.md, expected content

The repo-root `CLAUDE.md` is the canonical context file, read automatically by Claude Code in every session. The copy in `_claude-code-config/CLAUDE.md` is the staged source that `SETUP-009` copies to root, not a second source of truth. It contains: what the repo is, hard premises, canonical docs to consult, active agents, available skills, rule versioning, comment tags, common commands, conventions, and communication rules.

## Required MCP servers

Configure in Claude Code:
1. **Linear MCP**: read/create/update issues.
2. **Figma MCP**: read frames and tokens.
3. **GitHub MCP**: open PRs, read diffs.

## How many agents at once

- **Initial phase (you + Claude Code)**: 1 main agent (`frontend-implementer`) active at a time, the others invoked on demand as tools.
- **Orchestrated mode (future)**: `linear-orchestrator` running in a loop, dispatching tasks. The others become tools triggered by it.

Start with "1 active + invoked". Migrate to orchestrated once the design system is ready and the implementation cycle is flowing.

## Summary: count

- **9 active agents** in `.claude/agents/` (`frontend-implementer`, `design-system-builder`, `mock-data-curator`, `i18n-translator`, `documentation-keeper`, `qa-reviewer`, `security-reviewer`, `tech-debt-tracker`, `figma-spec`).
- **3 staged agents** in `docs/_claude-code-config/agents/`, promoted per area as needed (`analytics-instrumenter`, `figma-inventory`, `linear-bootstrap`).
- **1 planned agent** (`linear-orchestrator`), not yet created.
- **21 active skills** in `.claude/skills/`, see `.claude/skills/INDEX.md` for the list (counts are maintained there, not duplicated here).
- **Staged skills:** none. The `docs/_claude-code-config/skills/` duplicate-staging folder was removed in POO-375; `analytics-tracking` is live.
- **Models:** code/spec-involved agents (`frontend-implementer`, `design-system-builder`, `mock-data-curator`, `analytics-instrumenter`, `qa-reviewer`, `security-reviewer`, `figma-spec`) run on `claude-opus-4-8[1m]` (Opus 4.8, 1M-token context); the rest on `claude-sonnet-4-6`. Reported and enforced by `pnpm config:check`.
- **3 MCP servers** (Linear, Figma, GitHub).
