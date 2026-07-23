# 00, Overview

## Goal

Implement the Pool Party frontend based on designs already produced in Figma, in a clean repository, fully disconnected from any real backend, but structured so that future integration (smart contracts, indexers, wallet authentication) is inserted at explicit, well-documented points.

Pool Party v2 is an **OAMS (On-Chain Asset Management System)**: a multi-chain orchestration layer connecting professional managers (who build and operate on-chain strategies) with retail capital. This repo covers the **investor app** first (the current Figma); the **Manager Console** (B2B) and white-label surfaces come later. See `_claude-code-config/CLAUDE.md` for the full framing.

## Scope of this phase

**In scope**

- Faithful visual implementation of all screens, modals, and states from Figma.
- Reusable components and a local design system.
- Navigation between screens working with mocked data.
- Loading, error, empty, and success states simulated.
- Responsiveness per the Figma breakpoints.
- Complete code documentation.
- ID system for traceability.
- Internationalization in pt-BR, en, es.
- TDD for business rules.

**Out of scope**

- Contract integration (Pool Party OAMS contracts: vaults, mandates, strategy adapters, settlement).
- Real wallet integration (RainbowKit, wagmi, viem in real mode).
- Real authentication.
- Indexers, APIs, RPC providers.
- Real persistence (database, IndexedDB, etc).
- Analytics, observability, production error tracking.

## Implementation design principles

1. **Strict separation between presentation and data.** UI components never call fetchers directly. Always via a hook or prop.
2. **Centralized mocks.** All mocked data lives in `src/mocks/`, organized by domain.
3. **Visible integration points.** Every function that will become a real call is marked with `// PP-INTEGRATION-POINT` (see `04_CODE_STANDARDS.md`).
4. **Complete typing.** No `any`. Types derive from the schemas that reflect the contracts.
5. **Mandatory inline documentation.** Components, hooks, and public functions with JSDoc/TSDoc.
6. **ID convention.** Each visual artifact (screen, modal, component) has a unique ID, see `02_NAMING_CONVENTION.md`.
7. **TDD for business rules.** Tests written before implementation for hooks, mock services, calculation logic, validations, and forms. Purely visual components are outside strict TDD.
8. **i18n from day zero.** No hardcoded text in components. Everything goes through the translation system, with keys structured per feature.

## Closed decisions

| # | Topic | Decision | Notes |
|---|-------|----------|-------|
| D1 | Next.js router | App Router (Next 15) | RSC, nested layouts |
| D2 | Global state | Zustand | Light, no boilerplate |
| D3 | Forms | react-hook-form + Zod | Typed validation |
| D4 | i18n | next-intl; locales from `src/i18n/config.ts` (11 today, see 01_TECH_STACK > Locale policy). Source: `en` (from Figma); pt-BR/es curated; remaining 8 machine-translated pending native review (POO-231). Default: auto-detect via `Accept-Language` with fallback `en`. Translation by Claude Code, human review in PR. | Localized routes `/[locale]/...` |
| D5 | Theme | Dark-only | No toggle, `dark` class on html |
| D6 | Tests | Vitest + Testing Library, TDD approach | No E2E in this phase |
| D7 | Storybook | Yes, restricted scope | Only `src/components/` and complex modals. Not screens. |
| D8 | Animations | motion (framer-motion v11+) | Declarative syntax |
| D9 | Icons | Lucide React | Tree-shakeable |
| D10 | Base components | Customized shadcn/ui | Code lives in the repo |
| D11 | Lint/Format | Biome | Faster, single config |
| D12 | Package manager | pnpm | Performance |
| D13 | Node | 22 LTS | `.nvmrc` |
| D14 | Commits | Conventional Commits + husky + lint-staged | Automatable |
| D15 | CI | GitHub Actions: lint, typecheck, test, build | Minimum viable |
| D16 | Design tokens | Extract from Figma via MCP, generate versioned `design-tokens.ts` | Single source of truth |

## Additional closed decisions (round 2)

| # | Topic | Decision |
|---|-------|----------|
| D17 | Screen inventory | Done by Claude Code (`figma-inventory` agent) at project start. Reads Figma and creates all feature issues in Linear. |
| D18 | Figma tokens | Exist as Variables. `design-system-builder` agent extracts via Figma MCP. |
| D19 | Repository | From scratch. |
| D20 | Default locale | Auto-detect (Accept-Language) with fallback `en`. |
| D21 | Translation flow | Source content in `en` (from Figma). Claude Code translates to `pt-BR` and `es`. Human review of pt-BR and es in PR. |

## Target production stack (future reference)

So the current structure already considers the destination:

- Web3: wagmi + viem + RainbowKit (EVM); Solana wallet adapter (Solana). The OAMS is **multi-chain native** (EVM: Ethereum, Arbitrum, Base; plus Solana). The investor app starts EVM/Base-first; multi-chain surfacing in the UI comes later.
- Embedded wallets: Privy (Maria persona, Google/email to a passkey wallet); external wallets for crypto-native users (Carlos).
- Server state: TanStack Query
- Contracts: ABIs versioned in `src/contracts/` (empty in this phase, structure prepared)
- Indexer/Subgraph: TBD (placeholder in mocks)
