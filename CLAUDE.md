# Pool Party Frontend, CLAUDE.md

Read fully before acting. This is the lean source of truth; detail lives in the linked docs and skills (loaded on demand), not here.

## Design intake (first, every session)

Before any other work, read `docs/DESIGN_INTAKE.md`, the queue of Figma changes awaiting triage into Linear. For each pending row: open a Linear issue (matching project, reference artifact ID(s) + Figma frame), record business rules, then remove the row and note it in that file's changelog. Figma is the source of truth; it reaches development only through this intake path. Empty table = design and backlog are in sync.

## What this repo is

The **front-end** of Pool Party v2, an OAMS (On-Chain Asset Management System): managers build and run on-chain strategies, retail investors access them. Three surfaces: (1) **Investor app**, currently being implemented; (2) **Manager Console** (B2B, partially designed); (3) **white-label APIs** (future). Smart contracts, custody, and execution live in other repos and plug in at marked seams. Stack and structure: `docs/01_TECH_STACK.md`, `docs/03_PROJECT_STRUCTURE.md`.

## Current state: mock-first, real seams wired

Default `NEXT_PUBLIC_MOCK_MODE` serves fixtures from `src/mocks/` through 12 domain services (`src/lib/services/index.ts`). The integration layer is built; data flips to real per-toggle. Do not write code that assumes "no backend exists", assume **mock-by-default with a real seam already present**.

- **Already real** (not mocked): wallet/auth (Privy + wagmi/viem; Arbitrum, Base, Polygon; SIWE → JWT in httpOnly `pp_access_token`), analytics (GTM + Consent Mode v2, server-hashed IDs, ~60 typed events), web security (headers + per-request CSP nonce, Report-Only).
- **Built, mock-by-default**: main API (`apiFetch`, server-only, `x-api-key`, GET retries, Next cache tags, `src/lib/api/client.ts`) and analytics indexer (`analyticsFetch`).
- **Not yet integrated**: Paybis fiat ramp (stub, CSP-ready), CoinGecko prices (logo CDN only).
- Every real seam is marked `// PP-INTEGRATION-POINT` (151 today). Flip to real: `NEXT_PUBLIC_MOCK_MODE=false` + server env (`PP_API_URL`, `PP_API_KEY`, `ANALYTICS_API_URL`).
- Full integration map: `docs/ARCHITECTURE_STATE.md`.

**Two-phase delivery (Figma → visual → wiring).** (1) Design/component work runs in mock mode: build the component from Figma plus its mock (`mock-service-blueprint`); if the real API contract is unknown, define a plausible shape, mark the seam `// PP-INTEGRATION-POINT` with the assumed contract, and open a Linear **wiring issue**. (2) Real-data wiring lands separately against that issue. Never block visual work on a backend contract; never treat a mock as the finish line.

## Hard premises (non-negotiable)

1. **No implementation without crystal-clear business rules.** Run the `business-rules-clarification` skill first. Rules are numbered `[R1]…`, testable (each maps to ≥1 `it()`), edge-cased, with confirmed data source/error behavior, and versioned (`v1`, `v2`, …). Any gap → STOP, move the issue to `Needs Rules`, ask. See `docs/07_LINEAR_WORKFLOW.md`.
2. **Maximum-realism mocks.** All not-yet-real data comes from `src/mocks/` with correct scale (TVL thousands-millions, APY 2-40%, plausible USD), variable latency, rare errors, diverse states. See the `mock-service-blueprint` skill.
3. **Mark every seam.** Every mock service call and future wallet/contract reference carries `// PP-INTEGRATION-POINT: <description>`.
4. **TDD is mandatory** for hooks, services, lib/utils, stores, forms: tests before implementation. See the `tdd-workflow` skill.
5. **i18n from day zero.** 11 locales (source of truth: `src/i18n/config.ts`; `en` is the source). Every user-facing string goes through `useTranslations`; every new key lands in all locales in the same PR (`pnpm i18n:check` enforces parity). **No em dash (—, U+2014) in copy** (POO-357): restructure with a period, comma, colon or hyphen; `i18n:check` fails the build on any em dash in a locale value. Investor app abstracts crypto jargon; Manager Console keeps DeFi terms. See `i18n-translation-rules`.
6. **IDs + naming.** Every artifact has a unique ID and a name per `docs/02_NAMING_CONVENTION.md`.
7. **Standard file header**, including `@implements-rules-version: vN`. Style: `docs/08_DOCUMENTATION_STYLE_GUIDE.md`.
8. **Storybook** for `src/components/` and complex modals.
9. **Keep GitHub current** per PR (IDS_REGISTRY, INTEGRATION_POINTS, feature READMEs). See `git-workflow` + `docs-sync-workflow`.
10. **Gate not-yet-launched areas behind a feature flag** via `src/lib/features` (never read `process.env.NEXT_PUBLIC_FEATURE_*` directly). Feature flag (is it launched?) ≠ `isManager` role (does this user get it?) ≠ `isMockMode` (mock vs real data). See `feature-flags-workflow` + `docs/FEATURE_FLAGS.md`.

## Commands

```bash
pnpm dev          # dev server
pnpm test         # vitest once        (test:watch, test:coverage)
pnpm lint         # biome              (format)
pnpm typecheck    # tsc --noEmit
pnpm storybook    # workbench          (build-storybook)
pnpm build        # build
pnpm i18n:check   # locale key parity
```

Before any PR: `pnpm typecheck && pnpm lint && pnpm test`.

## Conventions

- **Branch**: `<type>/<area>-poo-<num>-<slug>` (e.g. `refactor/dep-poo-604-drop-standalone-confirm`). `<area>` is the lowercase domain token (`dep`, `mgr`, `str`, `core`, …) and is **required** — never drop it; `poo-<num>` is the **lowercase** Linear key (auto-links the branch). The artifact ID `PP-AREA-TYPE-NNN` lives in the commit scope + PR title, not the branch. Never work on `main` (use the `start-work` skill → sibling worktree). Canonical: `docs/02_NAMING_CONVENTION.md`.
- **Commit**: `<type>(<id>): <description> [rules-vN]`. ID goes in the SCOPE; subject starts lowercase (commitlint).
- **PR title**: `<type>(<id>): <description>` (Conventional Commits; append ` @rules-vN` when rules apply). **Squash-merge**, so the PR title becomes the commit subject on `main`.
- **Naming**: PascalCase components, camelCase hooks/vars/funcs, kebab-case folders.
- **`_tmp/` (ephemeral) vs `docs/` (persistent)**: these are different by intent, not by content. `_tmp/` holds **throwaway** `.md` (plans, working notes, intermediate scratch), gitignored, never committed, **deleted as soon as implemented/analyzed/used**. `docs/` is **persistent project reference** and is committed (e.g. `docs/_analysis/` holds durable analyses that are meant to stay). The test is persistence: a note you will discard goes to `_tmp/`; anything meant to live as reference goes to `docs/` (or Linear for tracked work). Never put throwaway scratch in `docs/`; never put durable reference in `_tmp/`.
- **Language**: English in all code and docs; translation JSONs in every configured locale.
- **Communication** (interactive only): Murilo is Brazilian, may write in Portuguese, match his language. Never use em-dashes. Direct, output-oriented. Ask before assuming.

## Rule versioning

Rules are versioned in four synced places: Linear issue body (append-only history), issue label `rules:vN`, PR title `@rules-vN`, file header `@implements-rules-version: vN`. Increment on every rule change after first definition. Drift caught by `consistency-checker` + `docs-sync-workflow`.

## Comment tags

| Tag | Use |
|---|---|
| `PP-INTEGRATION-POINT` | Becomes a real call later |
| `PP-MOCK` | Mocked logic/data |
| `PP-TODO` / `PP-FIXME` | Pending / known bug |
| `PP-DEBT(SEV:LOW\|MED\|HIGH)` | Technical debt |
| `PP-NOTE` / `PP-PERF` / `PP-A11Y` / `PP-SECURITY` / `PP-I18N` / `PP-ANALYTICS` | Note / perf / a11y / sensitive / suspect translation / analytics seam |

## Where things live

- **Agents** (frontend set): `.claude/agents/`. **Skills** (frontend set): `.claude/skills/` + `.claude/skills/INDEX.md`. Contracts: `docs/06_CLAUDE_CODE_AGENTS.md`.
- **Protocol/chain Claude config** (EVM/Solana) is quarantined under `.claude/_protocol/` and is **not** for frontend work.
- **Code seams**: mock toggle `src/lib/services/index.ts` · API `src/lib/api/client.ts` · analytics `src/lib/analytics/` · security `src/lib/security/` · flags `src/lib/features/registry.ts` · locales `src/i18n/config.ts` · formatting `src/lib/utils/format.ts`.
- **Canonical docs**: `docs/00_OVERVIEW` … `10_SECURITY`, plus `IDS_REGISTRY`, `FEATURE_FLAGS`, `INTEGRATION_POINTS`, `FIGMA_INVENTORY`, `ANALYTICS_EVENTS`.
