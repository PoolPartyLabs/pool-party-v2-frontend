---
name: git-workflow
description: Branch, commit, pull request, tag, and release conventions for Pool Party. Keeps GitHub up to date at every step. Includes sync between PR, Linear issue, and rule versioning.
---

# Git Workflow

Operational reference for everything Git and GitHub. Every code change follows this standard.

## Principle

GitHub is the permanent record. Linear is the backlog/process. The two must stay in sync, but the source of truth for code is GitHub. Keeping GitHub current is a continuous responsibility, not an end-of-line event.

## Branch naming

Canonical form (single source of truth: `docs/02_NAMING_CONVENTION.md`, Part E — that file wins if this ever drifts):

```
<type>/<area>-poo-<num>-<slug>
```

- **type** (kebab-case): `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`
- **area** (**required** — never drop it): the lowercase domain token that separates the surfaces — `core`, `lay`, `auth`, `dash`, `port`, `str`, `sav`, `tok`, `pred`, `perp`, `card`, `dep`, `rew`, `mgr`, `prof`, `noti`, `act`, plus non-UI `int`, `wallet`, `chain`, `api`, `bff`, `db`, `adm`, `i18n`, `a11y`, `analytics`, `security`
- **poo-<num>**: the **lowercase Linear issue key** — this is what auto-links the branch in Linear; one issue per branch
- **slug**: kebab-case description, 2-4 words

Examples:
```
feat/mgr-poo-242-move-range
fix/port-poo-003-risk-bands
refactor/dep-poo-604-drop-standalone-confirm
docs/core-poo-607-branch-naming-reconcile
```

**Branch vs commit/PR — do not confuse the two IDs.** The **branch** carries the **lowercase Linear key** `poo-<num>` (for work-item auto-linking). The **commit scope** and **PR title** carry the **artifact ID** `PP-AREA-TYPE-NNN` (or `POO-NNN` for backend / no-artifact work). Example: branch `refactor/dep-poo-604-drop-standalone-confirm` → commit `refactor(POO-604): ...` and PR title `refactor(POO-604): ...`. Do **not** put the artifact ID in the branch, and do **not** drop `<area>` (most existing repo branches drop it — that is drift, not the rule).

Special branches:
- `main`: protected, always green, always deployable.
- `chore/figma-inventory-YYYY-MM-DD`: from the `figma-inventory` agent.
- `docs/sync-YYYY-MM-DD`: from `documentation-keeper`.
- `chore/release-vX.Y.Z`: release branches.

## Commit messages

```
<type>(<id>): <description> [rules-vN]

[optional body]

[optional footer, e.g. Closes POO-NNN]
```

| Type | When |
|------|------|
| `feat` | New functionality |
| `fix` | Bug fix |
| `chore` | Maintenance (deps, configs) |
| `docs` | Documentation only |
| `refactor` | Refactor without behavior change |
| `test` | Tests only |
| `perf` | Performance |
| `style` | Formatting only (rare, Biome handles) |
| `i18n` | Translations only |

Rules: imperative lowercase description, max 72 chars on the first line, `[rules-vN]` at the end (mandatory in `feat`), no period.

### Frequent commits

Small, frequent commits over one big commit at the end. During TDD the agent may commit: `test(...)` (red), `feat(...)` (minimal pass), `refactor(...)`. These collapse into a single commit at squash-merge, so intra-PR WIP is fine; no manual pre-merge squash needed.

## Pull Requests

### When to open
Branch ready for review; **validated locally** (CI is billing-broken): `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test`, then `rm -rf .next && pnpm build`; coverage above threshold; Linear issue in `In Progress`.

### Title
```
<type>(<id>): <description>
```
Conventional Commits (the squash commit on `main` inherits this title). `<id>` is the artifact ID or `POO-NNN`. Append ` @rules-vN` only when the PR implements versioned business rules. Examples: `feat(POO-341): add manager move-range @rules-v2`, `docs(POO-375): align skills to real patterns`.

### Cycle
1. Open as **Draft** if still iterating.
2. Move to **Ready for review** when complete.
3. `qa-reviewer` runs.
4. Human approves (always the final merge decision).
5. **Squash & merge** to `main` (one commit per PR, linear history). The squash commit subject defaults to the PR title, so keep PR titles convention-compliant.
6. Branch deleted after merge; tear down the worktree (`git worktree remove`, then `git branch -D`, a squashed branch reads as "not merged" to `-d`).

### Linear sync
- Opening a PR: issue moves to `In Review`.
- Merging: issue moves to `Done`.
- PR closed without merge: issue returns to `Ready`.

## Tags and releases

### Versioning
Semantic Versioning. `v0.x.y` during foundation; `v1.0.0` when stabilized.

### When to release
Sprint complete, milestone reached, or foundation complete (`v0.1.0`).

### Process
1. Branch `chore/release-vX.Y.Z` from main.
2. `documentation-keeper`: update CHANGELOG, bump package.json, generate `docs/releases/vX.Y.Z.md`.
3. Release PR through `qa-reviewer`.
4. After merge: create tag `vX.Y.Z`, create GitHub Release with notes, notify.

## Keep GitHub current at every step

| Artifact | When |
|----------|------|
| `main` | Each merged PR |
| `docs/IDS_REGISTRY.md` | Each PR (via `documentation-keeper`) |
| `docs/INTEGRATION_POINTS.md` | Each PR |
| `docs/CONSISTENCY_REPORT.md` | Weekly (via `consistency-checker`) |
| `CHANGELOG.md` | Each release |
| Tags | Each release |
| GitHub Releases | Each release |
| `src/features/*/README.md` | Each feature PR |

### Before each PR, `qa-reviewer` validates
Branch name, commit conventions, PR title/body, linked Linear issue, no conflicts with main, and **local** validation green (CI is billing-broken; do not gate on it).

### Never committed
`.env`/`.env.local` (only `.env.example` versioned), `node_modules`, `.next`, `coverage`, `storybook-static`, private keys/tokens/secrets, local IDE files.

## Hooks (husky + lint-staged)

- **pre-commit**: `lint-staged` (biome format + lint on staged files). Blocks on error.
- **commit-msg**: `commitlint` validates Conventional Commits. Blocks on bad format.
- **pre-push** (optional): `pnpm typecheck`.

## Recovery

### Revert a wrongly merged PR
```bash
git revert -m 1 <commit-hash>
```
Open a revert PR following convention; reopen the Linear issue.

### Recover a deleted branch
```bash
git reflog
git checkout -b <branch> <hash>
```

## Anti-patterns

- Giant "everything at once" commit.
- Commit message "wip", "fix", "update".
- PR without convention-compliant title.
- Forcing merge without local validation (CI is billing-broken; validate locally, then merge against an up-to-date main).
- Force push to `main`.
- Versioning `.env`, secrets, or generated files.
- Linear issue diverging from PR state.
