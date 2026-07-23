# Skills Index

The live frontend skill set for this repo. Claude Code discovers a skill by its folder path `.claude/skills/<name>/SKILL.md`; the folder name is the identifier, and **every folder here is loaded every session**. EVM/Solana/protocol skills are quarantined under `.claude/_protocol/skills/` and are intentionally not loaded (see that folder's README).

| Skill | Purpose | Used mainly by |
|---|---|---|
| `business-rules-clarification/` | Gate before any implementation: clarify and version business rules | `frontend-implementer` |
| `tdd-workflow/` | Tests before implementation, map rules to test cases | `frontend-implementer`, `design-system-builder`, `mock-data-curator` |
| `regression-from-bug/` | Turn a confirmed bug/PP-FIXME into a red-then-green regression test | `frontend-implementer`, `qa-reviewer` |
| `react-component-blueprint/` | Standard pattern for a React component | `frontend-implementer`, `design-system-builder` |
| `nextjs-page-blueprint/` | Standard pattern for an App Router page with i18n | `frontend-implementer` |
| `mock-service-blueprint/` | Mock service with contract + realistic data, wired to the real `isMockMode` seam | `frontend-implementer`, `mock-data-curator` |
| `server-data-access/` | Real-data twin of mocks: server actions calling api/analytics directly (apiFetch), caching, invalidation | `frontend-implementer` |
| `wallet-operation-flow/` | Build-tx → sign → send on-chain operations over useWalletSignFlow | `frontend-implementer` |
| `i18n-translation-rules/` | Translation conventions across all 11 configured locales | `i18n-translator`, `frontend-implementer` |
| `figma-tokens-to-tailwind/` | Extract Figma Variables → tokens (CSS-first `@theme`) | `design-system-builder` |
| `number-formatting/` | Money/number formatting + numeric-input safety (`format.ts`, PP-CORE-LIB-013) | `frontend-implementer`, `design-system-builder` |
| `a11y-checklist/` | Focus, contrast, aria on dynamic money values, keyboard | `qa-reviewer`, `frontend-implementer` |
| `analytics-tracking/` | Track events via GTM/dataLayer: consent, typed events, server-HMAC user_id, privacy | `frontend-implementer` |
| `feature-flags-workflow/` | Register, gate, test and launch a feature flag | `frontend-implementer`, `qa-reviewer` |
| `frontend-security/` | Headers, wallet-aware CSP, cookies/SIWE, signing/approval safety, server-only secret boundary (Next 15) | `security-reviewer`, `frontend-implementer` |
| `git-workflow/` | Branch, commit, PR, tag, release conventions | all agents that touch git |
| `pr-review-checklist/` | Complete PR conformance checklist | `qa-reviewer` |
| `tech-debt-scanner/` | Scan PP-DEBT/FIXME/TODO/I18N tags and open issues | `tech-debt-tracker` |
| `docs-sync-workflow/` | Keep IDS_REGISTRY, READMEs and INTEGRATION_POINTS in sync | `documentation-keeper` |
| `consistency-checker/` | Cross-consistency audit, docs vs code | `documentation-keeper` |
| `adr/` | Record an immutable architecture decision (frontend) | all contributors |

## Not loaded

- **Protocol/chain skills** (EVM/Solana, oracle/MEV, governance, release, audit, risk, cross-chain, etc.): quarantined in `.claude/_protocol/skills/`. Re-promote into `.claude/skills/<name>/` only if frontend work genuinely needs one.
- **Staged frontend skills**: none. The `docs/_claude-code-config/skills/` duplicate-staging folder was removed in POO-375 (`analytics-tracking` is live). The `analytics-instrumenter` *agent* still lands with POO-156.
