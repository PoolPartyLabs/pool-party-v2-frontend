# Documentation CHANGELOG

## v0.16, 2026-09-13

### Hackathon track 3: the Privy on-ramp ported to the public repository, plus hookrisk

- **Code port, not a tree swap.** The fiat on-ramp lineage (epic POO-1793 over POO-1129) is copied from the private repository onto the public July baseline as new commits: `src/lib/onramp/` (61 files), the `/deposit` surface, the provisioning `buy` leg and `PrivyBuyStep`, seven drifted shared modules and the tests that travel with them (~265 files). `ProvisioningWizardModal` is deleted as in the private main. Continuity record: `docs/_hackathon_privy/03_PRE_EXISTING_VS_NEW.md`.
- **Flags.** `fiatOnRamp` and `privyOnRamp` ship **on** in this repository (registry defaults, `FEATURE_FLAGS.md` rows, `.env.example`); `onRampCapture` and `robinhoodChain` registered off. The test environment pins the two rail flags off in `tests/setup.ts` so the ported suites run against the baseline they were written for; `registry.test.ts` asserts the shipped defaults.
- **Dependencies.** `@privy-io/react-auth` 3.42.0, `@privy-io/wagmi` 4.0.17, `@sentry/nextjs` 10.73.0 as a library (never initialised; aliased to a stub in vitest).
- **Docs synced.** 62 artifact rows in `IDS_REGISTRY.md` (Totals recomputed), 14 event rows in `ANALYTICS_EVENTS.md`, a Privy on-ramp section and a fresh marker census in `INTEGRATION_POINTS.md`, `ARCHITECTURE_STATE.md` rows, the `_hackathon/03_PRE_EXISTING_VS_NEW.md` continuity table (wizard modal moved to Deleted, two rows added, file count recomputed).
- **Copy.** Every key the ported code uses in all 11 locales; the `deposit` namespace and the `strategies.provisioning` subtree follow the private values. `pt-PT` is not configured here.
- **hookrisk.** The Uniswap v4 hook risk scanner developed during the hackathon lands at `hookrisk/` as a snapshot (`d256e91a`) with a provenance banner, excluded from biome, tsc and the Docker context. README gains the track 3 and hookrisk sections; `docs/_hackathon_privy/` holds the placeholder narrative, goal, flow, runbook and continuity record.

## v0.15, 2026-07-01

### No-em-dash standing copy rule + sweep (POO-357)

- Standing rule (murilo 2026-06-26): no em dash (—, U+2014) in user-facing copy. Restructure with a period, comma, colon or a spaced hyphen; en dashes (–, U+2013) for numeric ranges stay allowed.
- Enforced by extending `scripts/i18n-check.ts` with a 4th check (`findEmDash`): `pnpm i18n:check` now fails the build on any em dash in a locale value. Regression-locked in `tests/i18n-check.test.ts` (per-locale scan of the real message files).
- Swept every em dash out of `src/i18n/messages/<locale>/*.json` across all 11 locales (~328 occurrences): en/pt-BR/es curated, the 8 machine-translated locales got punctuation-only swaps (wording preserved; native review still pending per POO-231). CJK/Korean connective endings handled per-string (comma, not period) so meaning stays intact.
- Rule documented in `CLAUDE.md` (premise 5), `docs/01_TECH_STACK.md` (Locale policy) and the `i18n-translation-rules` skill (check list + anti-patterns).

## v0.14, 2026-06-11

### Manager area un-flagged — ships in v1 (murilo 2026-06-11)

- `ManagerEntry` (PP-LAY-CMP-006) is always pinned to the sidebar: "Become a manager" → `/manager/become`, flipping to "Manager" → `/manager` via the Dev-menu Manager-mode toggle (the `isManager` mock).
- `managerConsole` flag removed from the registry; `/manager`, `/manager/new`, `/manager/become` and `/manager/strategies/[id]` no longer `requireFeature` (preview banners dropped).
- Profile Manager row now needs only the `isManager` role.

## v0.13, 2026-06-11

### Staged agents/skills promoted + a11y and feature-flags skills (POO-248)

- Promoted to `.claude/`: agents `security-reviewer` (frontend security pass before qa-reviewer) + `tech-debt-tracker`; skills `frontend-security`, `tech-debt-scanner`, `number-formatting`, `docs-sync-workflow`, `consistency-checker` (unblocks the documentation-keeper weekly consistency run).
- New skills: `a11y-checklist` (focus, contrast, aria on money values, keyboard; wired into qa-reviewer + react-component-blueprint) and `feature-flags-workflow` (register, gate, test, launch; the premise 10 recipe).
- qa-reviewer template: "Issue moved to Done" replaced by "Ready to merge (human decision)"; merge stays a human call.
- documentation-keeper gains an explicit `tools:` list; mock-data-curator pinned to sonnet (was opus).
- Staged `CLAUDE.md` re-synced with premise 10; counts updated in CLAUDE.md, docs/06 and the skills INDEX.

## v0.12, 2026-06-11

### i18n locale sweep 3 -> 11 (POO-247)

- New canonical **Locale policy** section in `01_TECH_STACK.md`: `src/i18n/config.ts` is the runtime source of truth (11 locales); `en` source, `pt-BR`/`es` curated, 8 machine-translated pending native review (POO-231); parity enforced by `i18n:check`.
- Every normative "3 locales / en/pt-BR/es / all 3 languages" mention updated to reference the policy: `CLAUDE.md` (premise 5, agent table, conventions, checklist item 8), docs 00/03/04/06/07/08 + `docs/README.md`, `.env.example`, agents `i18n-translator`/`qa-reviewer`/`frontend-implementer`, skills `i18n-translation-rules`/`pr-review-checklist`.
- `i18n-translation-rules` gains the per-locale register for the 8 new languages (fr vous, de Sie, nl u/uw, ja です/ます, ko 해요체, zh-CN vs zh-TW as separate translations, vi bạn) and the brand-noun list that never translates.
- `qa-reviewer` + `pr-review-checklist` gain the **semantic i18n check** (real translation vs English placeholder; keys vs raw strings), the class `i18n:check` cannot catch (Cards-perks bug, PR #62).

## v0.11, 2026-05-30

### Analytics taxonomy adapted to OAMS (full catalog)

- Replaced the pre-OAMS Uniswap-era taxonomy (`pool_*`, `liquidity_*`, `swap_*`, `fee_tier`) with the full OAMS event catalog across all surfaces (auth, wallet, dashboard, portfolio, strategies, savings, buy-tokens, predictions, perps, cards, deposit, rewards, nav/app) in `09_ANALYTICS.md` and the `analytics-tracking` skill.
- New `docs/ANALYTICS_EVENTS.md`: living catalog (event, when it fires, params, emitting artifact ID), ~75 events.
- New params: `strategy_id`, `market_id`, `order_type`, `order_status`, `side`, `outcome`, `leverage`, `deposit_method`, `risk_level`, and `usd_value_at_time` (price-at-time rule). Dropped `pool_id`, `fee_tier`.
- `02_NAMING_CONVENTION.md`: added Part H (analytics event naming).
- READMEs updated: root doc table (+09/10/ANALYTICS_EVENTS) and `docs/README.md` (tree + counts: 11 agents, 14 skills, 4 MCPs).

## v0.10, 2026-05-30

### Security baseline + frontend security unit

- New canonical `docs/10_SECURITY.md`: defense-in-depth baseline (HTTP security headers, clickjacking, session hijacking, email auth, DNS/registrar, CORS) with an ownership map (Frontend / DevOps-Infra / Backend / Smart contracts) and a staged rollout order.
- New `frontend-security` skill: Next 15 implementation (security headers, wallet-aware CSP with the Pool Party connect-src/script-src/frame-src allowlist, COOP `same-origin-allow-popups` for wallet popups, cookies/SIWE, CORS, testing).
- New `security-reviewer` agent: audits the Frontend-owned controls and hard-fails secret leaks; runs after `frontend-implementer`, before `qa-reviewer`.
- Per-area expansion planned: `devops-infra-security` (email auth, DNSSEC, registrar lock, CAA, MTA-STS), `backend-security` (server session, SIWE nonce, CORS policy), `smartcontract-security`.
- Policy reaffirmed: always use LTS / mature-stable versions.

## v0.9, 2026-05-30

### Analytics layer docs imported (GTM + GA4)

- Imported the analytics artifacts: `docs/09_ANALYTICS.md` (canonical), the `analytics-tracking` skill (`_claude-code-config/skills/analytics-tracking/SKILL.md`), and the `analytics-instrumenter` agent. Privacy-first: GTM hub + GA4 destination, `useAnalytics()` abstraction, SHA-256-hashed wallet `user_id`, Consent Mode v2, secrets never tracked.
- **CAVEAT (taxonomy):** these docs carry the pre-OAMS Uniswap-era event taxonomy (`pool_*`, `liquidity_*`, `swap_*`, `fee_tier`). They must be adapted to the OAMS surfaces (strategies, savings, buy-tokens, predictions, perps, cards, deposit) before instrumentation. Tracked as a follow-up.
- **Pending integration (not yet applied to the OAMS repo):** `02_NAMING_CONVENTION.md` Part H (event naming), `04_CODE_STANDARDS.md` `PP-ANALYTICS` tag + `@analytics-events` header, `CLAUDE.md` premise, registry IDs (`PP-CORE-LIB-010` hashWalletAddress, `PP-CORE-HOK-010` useAnalytics), and a Foundation issue for the GTM/GA4/consent runtime.

## v0.8, 2026-05-30

### Foundation issues recreated in Linear (POO-60..79) + registry relink

- **Linear reorg follow-through:** the archived `POO-5..46` batch stays archived. The 13 setup issues had already been recreated as **POO-47..59**; today the 20 infra issues were recreated in the **Foundation** project — tokens `PP-CORE-STY-001/002` (POO-60, POO-65), mocks `PP-CORE-MCK-001..004` (POO-61/62/66/63), i18n `PP-CORE-I18N-001` (POO-64), the 12 primitives `PP-CORE-CMP-010..021` (POO-67..78), and `PP-CORE-LAY-001` AppShell (POO-79). All `Todo`, priority High, label-free, with the `blockedBy` graph wired (STY-001←SETUP-009; CMP←STY-002; AppShell←the 12 primitives; mocks/i18n←their SETUP deps).
- **`IDS_REGISTRY.md` relinked:** the CORE infra rows now point at the live issues (POO-19..38 → POO-60..79). Manager Console rows still link `POO-39..46`, which were archived and are pending recreation.

## v0.7, 2026-05-29

### Product reframe (OAMS), real taxonomy, repo + Linear bootstrap, consistency pass

- **Product definition corrected** from "Uniswap V3 LP optimization DApp" to **OAMS (On-Chain Asset Management System)** with three front-ends (investor app, Manager Console, white-label). Rewrote `CLAUDE.md`, `00_OVERVIEW`, and the framing across docs.
- **Domain model** rewritten: Pool/PoolPosition/tick/feeTier/PoolServiceContract → Strategy / Position / SavingsMarket / Token / Transaction (`04_CODE_STANDARDS`, `05_MOCK_STRATEGY`, `mock-service-blueprint`, `MOCKS_AND_I18N`).
- **AREA taxonomy** replaced (POOL/POS/LP/SWAP/WAL/SET → CORE/LAY/AUTH/DASH/PORT/STR/SAV/TOK/PRED/PERP/CARD/DEP/REW/MGR/PROF/NOTI/ACT). Store type code STR renamed to **STO** to avoid clashing with the STR area.
- **ID collision resolved:** shadcn primitives are `PP-CORE-CMP-010..021` (Figma components already hold 001..009); Button etc. updated everywhere.
- **`IDS_REGISTRY.md` regenerated**: 127 artifacts, separate Design vs Impl status columns, Linear links, no em-dashes. Added code artifacts (POO-19..38) + Manager Console backlog (POO-39..46).
- **Figma**: all 160 frames carry `PP-AREA-TYPE-NNN` IDs; `FIGMA_INVENTORY.md` (99 designed artifacts).
- **GitHub**: real repo `0xmvercosa/pool-party-v2-frontend` created; these docs are canonical in `docs/` (the `~/Downloads` copy is deprecated).
- **Linear**: full label taxonomy + 33 Foundation issues (POO-6..38) + Manager Console backlog. `linear-bootstrap` and `BOOTSTRAP-001` marked superseded; single project `Front End - Pool Party V2`; only Backlog/Todo/In Progress/Done statuses exist.
- **i18n term policy**: investor app abstracts crypto jargon; only the Manager Console keeps technical English terms.
- **Hygiene**: purged em-dashes (except rule-definition lines), removed stray `EOF` in `skills/INDEX.md`, aligned routes (`03`) and i18n namespaces (`01`) to the real product.

## v0.6, 2026-05-28

### Full translation to English + clearer file naming

Translated all 38 files from Portuguese to English (code and documentation are an international standard). Interactive communication with the team can stay in Portuguese, but everything versioned in the repo is now in English.

### Changes
- All 9 canonical docs (00-08) translated to English.
- `CLAUDE.md` translated. Communication rule changed: "English in all documentation and code; match the user's language in interactive replies".
- All 9 agents translated.
- All 12 skills translated.
- All 5 Linear issue files translated.
- README and CHANGELOG translated.

### File naming clarity
- Added `_claude-code-config/skills/INDEX.md` mapping each skill folder to its purpose.
- Documented that the `SKILL.md` filename is a Claude Code platform requirement: a skill is identified by its **folder name**, and the file inside must be named exactly `SKILL.md`. It cannot be renamed without breaking the platform. The folder names are descriptive, and INDEX.md provides the disambiguation.

### Consistency
- Em-dash rule preserved (no - anywhere except meta-references that prohibit its use).
- Updated SETUP-009 to reflect 9 agents + 12 skills (was 8 + 9).
- Skill reference `figma-to-tailwind` corrected to `figma-tokens-to-tailwind`.

## v0.5, 2026-05-27

### Requests addressed
1. Keep pt-BR, en, es (confirmed).
2. Linear MCP: new `linear-bootstrap` agent to populate the 34 issues.
3. Identified and created missing artifacts: 1 agent + 2 skills.
4. Screen naming guide: expanded `02_NAMING_CONVENTION.md`.
5. General reference document: created `08_DOCUMENTATION_STYLE_GUIDE.md`.
6. GitHub always current: `git-workflow` skill + `documentation-keeper` update.
7. Full consistency verification: passed.

### New agent
`linear-bootstrap`: runs once, reads the files in `_linear-issues/`, creates projects/labels/views/custom statuses in Linear via MCP, creates the 34 issues in topological order, generates a bootstrap report and a localId to Linear ID mapping. Idempotent.

### New skills (2)
`consistency-checker`: weekly cross audit (references between docs, IDs registry vs code, skill/agent names referenced, naming, rule drift, mirrored translations, integration points, headers). Generates `CONSISTENCY_REPORT.md`.
`git-workflow`: operational Git/GitHub conventions. Branches, Conventional commits, PRs, tags, releases. Linear sync. Keep GitHub current at every step.

### New canonical document
`08_DOCUMENTATION_STYLE_GUIDE.md`: meta-guide for all project documentation.

### Doc `02_NAMING_CONVENTION.md` expanded
From IDs only to 7 parts: IDs, code naming, files/folders, translations, branches/commits/PRs, negative naming, canonical screen list.

### Agent `documentation-keeper` rewritten
Now covers docs and GitHub (CHANGELOG, releases, tags, GitHub Releases).

## v0.4, 2026-05-27

Renamed skills + added business-rules-clarification + rule versioning + mock realism.

## v0.3, 2026-05-27

Delivered the complete agents, skills, and initial issues structure.

## v0.2, 2026-05-27

Closed the fundamental stack decisions.

## v0.1, 2026-05-27

Initial structure of the 8 canonical documents.
