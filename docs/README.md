# Pool Party Frontend, Documentation Folder

This folder contains all the canonical documentation for the Pool Party Frontend project, the Claude Code configuration (agents, skills, CLAUDE.md), and pre-formatted initial Linear issues.

## Structure

```
pool-party-frontend/docs/
├── README.md                          # this file
├── CHANGELOG.md                       # documentation version history
├── 00_OVERVIEW.md                     # scope, principles, decisions
├── 01_TECH_STACK.md                   # technical stack
├── 02_NAMING_CONVENTION.md            # IDs + naming (screens/vars/funcs/files) + analytics naming (Part H)
├── 03_PROJECT_STRUCTURE.md            # folder organization
├── 04_CODE_STANDARDS.md               # standards, TDD, i18n
├── 05_MOCK_STRATEGY.md                # mock strategy
├── 06_CLAUDE_CODE_AGENTS.md           # agent and skill contracts
├── 07_LINEAR_WORKFLOW.md              # Linear flow + rule versioning
├── 08_DOCUMENTATION_STYLE_GUIDE.md    # writing style for everything
├── 09_ANALYTICS.md                    # analytics taxonomy, privacy, dashboards
├── 10_SECURITY.md                     # security baseline (headers, CSP, sessions, DNS, CORS)
├── ANALYTICS_EVENTS.md                # living catalog of tracked events
├── DESIGN_INTAKE.md                   # design-change intake queue
├── IDS_REGISTRY.md                    # central artifact ID registry
├── FIGMA_INVENTORY.md                 # per-area inventory of designed artifacts
├── _claude-code-config/
│   ├── CLAUDE.md                      # goes to the repo root
│   ├── agents/                        # 11 agents (+1 optional)
│   └── skills/                        # 14 skills + INDEX.md
└── _linear-issues/
    ├── README.md
    ├── BOOTSTRAP.md
    ├── FOUNDATION.md
    ├── DESIGN_SYSTEM.md
    └── MOCKS_AND_I18N.md
```

## Language

All documentation and code are in **English** (international repo standard). Interactive communication with the team may be in Portuguese. No em-dashes anywhere; use commas, parentheses, periods.

## Core premises

1. **No real connections in this phase.** No APIs, RPC, real wallet, or database. Everything mocked.
2. **Integration points marked** with standardized tags (see `04_CODE_STANDARDS.md`).
3. **Mandatory documentation** with a defined style guide (see `08_DOCUMENTATION_STYLE_GUIDE.md`).
4. **TDD for business rules.** Clarification BEFORE implementation.
5. **i18n from day zero**, in 11 locales via next-intl (en source; see 01_TECH_STACK > Locale policy).
6. **Realistic mocks** to the maximum (scale, distribution, variable latency).
7. **Claude Code is the main executor.** All implementation via specialized agents.
8. **GitHub always up to date** at every step.
9. **Analytics on every meaningful action**, privacy-first (see `09_ANALYTICS.md`).
10. **Security baseline** on the frontend (headers, CSP, cookies); see `10_SECURITY.md`.
11. **Always LTS / mature-stable versions** (Node 22 LTS, Next 15), never bleeding edge.

## How to navigate

| To... | Go to... |
|-------|----------|
| Understand the project scope | `00_OVERVIEW.md` |
| Know which lib to use | `01_TECH_STACK.md` |
| Know how to name something | `02_NAMING_CONVENTION.md` |
| Know where to create a file | `03_PROJECT_STRUCTURE.md` |
| Know how to write code | `04_CODE_STANDARDS.md` |
| Know how to mock data | `05_MOCK_STRATEGY.md` or the `mock-service-blueprint` skill |
| Know which agent to use | `06_CLAUDE_CODE_AGENTS.md` |
| Know how to open an issue | `07_LINEAR_WORKFLOW.md` |
| Know how to document | `08_DOCUMENTATION_STYLE_GUIDE.md` |
| Know what/how to track | `09_ANALYTICS.md` + `ANALYTICS_EVENTS.md` |
| Know the security baseline | `10_SECURITY.md` |
| See what changed recently | `CHANGELOG.md` |

## AI architecture summary

- **11 active agents** (+1 optional): includes `analytics-instrumenter` and `security-reviewer`.
- **14 skills** (see `_claude-code-config/skills/INDEX.md`): includes `analytics-tracking` and `frontend-security`.
- **4 MCP servers**: Linear, Figma, GitHub, Google Analytics (read-only).

The `business-rules-clarification` skill is the gate before any implementation. The `consistency-checker` skill validates everything cross-referenced periodically.

## Current status

Version `v0.11`. See `CHANGELOG.md` for details.

This repository (`0xmvercosa/pool-party-v2-frontend`) **is** the real repo. These docs live in `docs/` and are canonical (the old `~/Downloads/pool-party-frontend-docs` copy is deprecated).

## Foundation status

- Linear: per-area projects + Manager Console; the original `POO-5..46` batch was archived. Foundation is live as **POO-47..59** (13 setup) + **POO-60..79** (tokens, mocks, i18n base, 12 primitives, AppShell) + **POO-81/82** (security headers/CSP and analytics runtime).
- Done so far (on `main`): SETUP-001..008 + SETUP-011 (scaffold, Biome, git hooks, Vitest, next-intl, `i18n:check`, Storybook, CI, integration-points) and design tokens STY-001/002 (Tailwind 4 `@theme`). In progress: SETUP-009 (root `CLAUDE.md` + curated `.claude/`) and SETUP-013 (PR template done; branch protection pending). Next: the 12 UI primitives (CMP-010..021), AppShell (LAY-001), mocks (MCK-001..004), i18n base (I18N-001), SETUP-010/012, and the analytics/security runtimes (POO-81/82).
- `_claude-code-config/` (CLAUDE.md + agents + skills) is copied into `.claude/` by SETUP-009 once the agent/skill model is confirmed.
- Feature issues are generated from `IDS_REGISTRY.md` in backlog order, with business rules filled before implementing.
