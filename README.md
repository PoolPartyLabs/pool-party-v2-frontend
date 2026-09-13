# Pool Party

Front-end for **Pool Party v2**, an **On-Chain Asset Management System (OAMS)**: an open, multi-chain platform where asset managers, human or software, build and operate on-chain investment strategies, and where anyone can invest in them without giving up custody.

---

## Hackathon submission (ETHGlobal, September 2026)

> **Premise.** Pool Party is an on-chain asset management system: managers build strategies, investors allocate to them under mandates the chain enforces. Uniswap v4 puts arbitrary code, the **hook**, on the swap path of every pool a strategy might touch. A hook can skim more than its declared fee, trap liquidity, or expose a callback anyone can call, and the strategy manager cannot see any of that from a pool page. The Cork hook lost $11M in May 2025 to exactly such a callback. **This submission gives managers a way to measure a hook's risk before opening a position, without leaving the platform and without putting investor funds on the line.**

### What we built

1. **[`hookrisk/`](hookrisk/), the Uniswap Foundation's Hooks Security Framework made executable.** One command, `hookrisk scan src/MyHook.sol:MyHook`, and the output is a scored manifest, a full Markdown report, SARIF for CI and a meaningful exit code. It does three things a linter does not:
   - **Reads the hook** with Slither detectors ([`hookrisk/detectors/`](hookrisk/detectors/)): an `IHooks` callback anyone can call (HS-01), declared permissions that disagree with the implemented callbacks (HS-02), the admin surface (HS-03), third-party calls on the swap path (HS-05), unbounded dynamic fees (HS-06), custom accounting as a classification (HS-07).
   - **Executes the hook** in a twin-pool differential harness on real `v4-core` ([`hookrisk/harness/`](hookrisk/harness/)): two pools identical except for the hook, the same fuzzed sequence, three invariants (no token created or destroyed, no extraction beyond the declared fee, every position can be closed). A hook that documents a 1% fee and charges 3.5% is structurally flawless; only execution sees it.
   - **Refuses to flatter.** Nine framework dimensions and seven triggers are scored, and a dimension is never scored zero unless a detector capable of finding something actually ran; a missing engine yields an *unmeasured* dimension and a tier **range**. BlockSec's HookScan runs as a second, attributed engine and agreeing findings merge at raised confidence.
   - **Evidence:** before/after scans of 14 real hooks, including the archived Cork exploit hook, are under [`hookrisk/docs/hackathon/evidence/`](hookrisk/docs/hackathon/evidence/); the narrative is [`hookrisk/docs/hackathon/HACKATHON.md`](hookrisk/docs/hackathon/HACKATHON.md) and the demo is [`hookrisk/docs/hackathon/DEMO_RUNBOOK.md`](hookrisk/docs/hackathon/DEMO_RUNBOOK.md).
2. **The Tools page in the investor app (`/tools`).** A manager pastes a hook address, picks the chain, and the platform fetches the verified source, builds it, runs hookrisk server-side and renders the report in place. Reports are cached for 24 hours per hook so a second look is instant. This is the seam through which, once v4 strategies land in the platform, the strategy builder will check a hook before a position is opened. Gated by the `hookTools` flag (on in this repository); docs in [`docs/_hackathon_hookrisk/`](docs/_hackathon_hookrisk/).

### What is new and what is reused (Continuity track)

This repository is a pre-existing production codebase; the [commit history](https://github.com/PoolPartyLabs/pool-party-v2-frontend/commits/) on the hackathon branch is the record of what was built during the event, one theme per commit, never squashed.

| | Status | Where |
|---|---|---|
| hookrisk: detectors, harness, scoring, CLI, action, evidence | **New, built during the hackathon** | `hookrisk/` (copied from the team's development repository at `d256e91a`, provenance banner at the top of its README) |
| Tools page, scan job runner, report rendering, `hookTools` flag | **New, built during the hackathon** | `src/app/[locale]/(auth)/(app)/tools/`, `src/lib/tools/hookrisk/`, `src/app/api/tools/hookrisk/` |
| Fiat on-ramp on the Privy rail (Google sign-in, embedded wallet, card checkout, buy leg in provisioning) | **Supporting work.** Ported onto this public baseline during the event so the demo account can be funded without leaving the app; the modules themselves come from the team's private repository | `src/lib/onramp/`, `src/features/deposit/`, `PrivyBuyStep`; continuity record in [`docs/_hackathon_privy/03_PRE_EXISTING_VS_NEW.md`](docs/_hackathon_privy/03_PRE_EXISTING_VS_NEW.md) |
| The investor app itself (strategies, portfolio, provisioning rail, wallet, analytics, security) | **Pre-existing** | everything else under `src/` |
| Earlier hackathon tracks (Universal Funding, Active Reserve) | **Pre-existing** (July 2026), kept for history | [`docs/_hackathon/`](docs/_hackathon/), [`docs/_hackathon_aqua/`](docs/_hackathon_aqua/) |

Open-source components hookrisk stands on, credited rather than reframed: Slither, Foundry, Uniswap `v4-core` and `v4-periphery`, OpenZeppelin `uniswap-hooks`, BlockSec HookScan (run as a separate process, nothing redistributed). Full list and licences in [`hookrisk/docs/PRIOR_ART.md`](hookrisk/docs/PRIOR_ART.md) and [`hookrisk/NOTICE`](hookrisk/NOTICE) (MIT, except `hookrisk/detectors/` which is AGPL-3.0-only).

### Use of AI tools

Claude Code was used throughout as a pair programmer, directed by the team through written specs, rules and reviews rather than left to generate the project. Everything the judges need to see how the AI was directed is in the repository:

- **How the app work is directed:** [`CLAUDE.md`](CLAUDE.md) (the project's operating rules: business rules before code, TDD, i18n, artifact IDs, analytics as definition of done) and the agent and skill definitions under [`.claude/`](.claude/).
- **How hookrisk was directed:** [`hookrisk/CLAUDE.md`](hookrisk/CLAUDE.md), the per-workstream notes [`hookrisk/docs/hackathon/notes-A.md`](hookrisk/docs/hackathon/) through `notes-I.md`, and the resume file [`hookrisk/docs/hackathon/RESUME.md`](hookrisk/docs/hackathon/RESUME.md) with every decision and its reason.
- **Where the AI wrote code:** every commit co-authored by the assistant carries a `Co-Authored-By` trailer; file headers carry the issue and rule version the code implements. The framework port, the detector logic, the invariant harness and the scoring rules were specified, reviewed and tested by the team; the assistant drafted implementations and documentation against those specs.

### Earlier tracks in this repository (July 2026)

Kept for history, and pre-existing for this event: **Universal Funding** (Uniswap Trading API; docs in [`docs/_hackathon/`](docs/_hackathon/), code in `src/lib/uniswap/`, `src/lib/provisioning/`) and **Active Reserve** (1inch Aqua and SwapVM; docs in [`docs/_hackathon_aqua/`](docs/_hackathon_aqua/), code in `src/lib/aqua/`, `src/features/aqua/`; contracts at [github.com/0xmvercosa/pool-party-aqua](https://github.com/0xmvercosa/pool-party-aqua)).

---

## How it works

The platform splits responsibilities into two layers:

- **On-chain, the trust layer.** Custody, mandates, and settlement. Funds sit in non-custodial vaults, and every action a manager takes is a transaction anyone can verify.
- **Off-chain, the optimization layer.** Risk analysis, backtesting, algorithmic execution, reporting, and the product surfaces in this repository.

Strategies compose modular protocol adapters (lending, derivatives, spot) into products such as delta-neutral farming, basis trading, and LST loops. Returns come from real on-chain activity (trading fees, lending interest, market making), not token emissions. The protocol is multi-chain native, running on EVM networks and Solana, and the product covers the full loop: fiat in (cards, Apple Pay, local rails in 80+ countries), yield through managed strategies, fiat out or spending through partner cards.

### Mandates

A **mandate** is the contract between a manager and their investors, enforced by the chain instead of by promises. It defines what a strategy may touch (protocols, assets), the limits it must respect (allocation, exposure, risk parameters), and the fees it charges. Inside the mandate the manager operates freely. Outside it, nothing executes. Investors do not have to trust an operator's intentions: they read the mandate, watch the on-chain track record, and can exit at any time.

### Agents as managers

Mandates make a second thing possible, and it is central to where Pool Party is going: **software can manage money safely**. The platform treats automated managers, including AI agents, as first-class operators, under the same rules as humans.

- **Mandates are the guardrails.** An agent operating a pool holds permissions, not funds. It can rebalance, collect, and compound within its mandate; it cannot withdraw investor capital to itself, exceed its risk limits, or touch an asset outside its whitelist. The chain rejects anything else on every transaction, so a bug, a bad decision, or a compromised key cannot step outside the box.
- **One API for the whole job.** The platform API exposes the full management surface programmatically: read pool state and positions, create and configure pools, set mandate parameters, execute the permitted actions, and pull performance and fee data. An agent integrates once, instead of integrating every protocol on every chain.
- **Working for one person.** An agent can manage its controller's own capital: a strategy tuned to that person's risk tolerance, horizon, and preferences, running continuously. The mandate the controller signs is the leash, and it can be tightened or revoked at any time.
- **Working for the market.** An agent can also publish strategies publicly, like any other manager. Its track record accrues on-chain, where it is verifiable and cannot be embellished. Investors allocate to it exactly as they would to a human manager, and leave whenever they want.

## Product surfaces

This repository hosts the product's front-ends:

- **Investor app**, the current focus. Fiat on-ramp, managed strategies, savings, token exposure, predictions, perps, partner cards, rewards, and off-ramp. Fully designed; v1 in active build.
- **Manager Console** (B2B). Strategy builder, mandate configuration, backtesting, execution monitoring, and automated investor relations. Design in progress.
- **White-label** (B2B2C, future). Wallets, neobanks, and fintechs embed the same yield products through the API.

Agents do not get a separate surface: they operate through the API, under the same mandates.

## Status

V1 of the investor app is in active build, gated per area by a feature-flag registry (see [`docs/FEATURE_FLAGS.md`](docs/FEATURE_FLAGS.md)):

- **Built**: app shell, Home, Portfolio, Strategies, Deposit, Profile, Rewards.
- **In build**: Cards.
- **Registered, not built yet**: Savings, Buy tokens, Predictions, Perps, Manager Console.

The app is **mock-by-default with real seams already wired**. Wallet and auth (Privy + wagmi/viem, SIWE), analytics, and the web-security layer are real. The platform data layer runs on fixtures behind a single toggle and plugs into the backend at explicit, documented integration points (see [`docs/INTEGRATION_POINTS.md`](docs/INTEGRATION_POINTS.md)). The hackathon tracks call live third-party APIs (block explorers and hookrisk for the Tools page, Uniswap Trading API, 1inch Aqua, Privy). The fiat on-ramp (Privy rail) is real in real mode and **on by default** in this repository. UI copy ships in 11 languages.

> **All figures shown in the running app are synthetic mock data.** TVL, APY, balances, and portfolio values are generated fixtures, not real positions or real money.

## Quick start

Requires Node 22 (see [`.nvmrc`](.nvmrc)) and [pnpm](https://pnpm.io).

```bash
pnpm install                 # install dependencies
cp .env.example .env.local   # create local env (mock mode is on by default)
pnpm dev                     # run the app at http://localhost:3000
```

No backend, RPC, or wallet is required (see [`docs/05_MOCK_STRATEGY.md`](docs/05_MOCK_STRATEGY.md)).

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run the dev server at `http://localhost:3000`. |
| `pnpm build` / `pnpm start` | Build for production / serve the build. |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | Run the Vitest suite (once, in watch mode, with coverage). |
| `pnpm lint` / `pnpm format` | Check / format the codebase with Biome. |
| `pnpm typecheck` | Strict TypeScript check. |
| `pnpm i18n:check` | Verify locale parity, ICU syntax, and used keys across all 11 locales. |
| `pnpm config:check` | Verify the `.claude` agent and skill config (counts, pinned models). |
| `pnpm storybook` | Component workshop at `http://localhost:6006`. |

## Stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind 4 · shadcn/ui · Zustand · react-hook-form + Zod · next-intl (11 locales, `en` source) · TanStack Table & Query · Vitest + Testing Library · Storybook · Biome · pnpm · Node 22 (LTS). Details in [`docs/01_TECH_STACK.md`](docs/01_TECH_STACK.md).

## Documentation

All canonical documentation lives in [`docs/`](docs/).

| Doc | Purpose |
|-----|---------|
| [`00_OVERVIEW.md`](docs/00_OVERVIEW.md) | Goals, scope, decisions |
| [`01_TECH_STACK.md`](docs/01_TECH_STACK.md) | Stack and versions |
| [`02_NAMING_CONVENTION.md`](docs/02_NAMING_CONVENTION.md) | IDs, naming, area taxonomy, analytics naming |
| [`03_PROJECT_STRUCTURE.md`](docs/03_PROJECT_STRUCTURE.md) | Folder layout |
| [`04_CODE_STANDARDS.md`](docs/04_CODE_STANDARDS.md) | Code standards, headers, TDD |
| [`05_MOCK_STRATEGY.md`](docs/05_MOCK_STRATEGY.md) | Mock and data strategy |
| [`06_CLAUDE_CODE_AGENTS.md`](docs/06_CLAUDE_CODE_AGENTS.md) | Agents and skills |
| [`07_LINEAR_WORKFLOW.md`](docs/07_LINEAR_WORKFLOW.md) | Linear backlog and workflow |
| [`08_DOCUMENTATION_STYLE_GUIDE.md`](docs/08_DOCUMENTATION_STYLE_GUIDE.md) | Documentation style |
| [`09_ANALYTICS.md`](docs/09_ANALYTICS.md) | Analytics taxonomy, privacy, dashboards |
| [`10_SECURITY.md`](docs/10_SECURITY.md) | Security baseline (headers, CSP, sessions, DNS, CORS) |
| [`FEATURE_FLAGS.md`](docs/FEATURE_FLAGS.md) | Flag registry, resolution precedence, v1 launch matrix |
| [`INTEGRATION_POINTS.md`](docs/INTEGRATION_POINTS.md) | Where real backend, wallet, and contracts plug in |
| [`DESIGN_INTAKE.md`](docs/DESIGN_INTAKE.md) | Design-change intake queue (Figma to Linear) |
| [`IDS_REGISTRY.md`](docs/IDS_REGISTRY.md) | Central artifact ID registry |
| [`FIGMA_INVENTORY.md`](docs/FIGMA_INVENTORY.md) | Per-area inventory of designed artifacts |
| [`ANALYTICS_EVENTS.md`](docs/ANALYTICS_EVENTS.md) | Living catalog of tracked events |
| [`CHANGELOG.md`](docs/CHANGELOG.md) | Versioned history of the canonical docs |

## Development workflow

Design is the source of truth, and it flows into code through a single intake path:

1. **Design**: screens and components are produced in Figma. Every artifact carries a `PP-AREA-TYPE-NNN` ID (see [`docs/02_NAMING_CONVENTION.md`](docs/02_NAMING_CONVENTION.md)). Mobile and desktop of one screen share one ID (responsive).
2. **Intake**: each design change (new screen, edit, new state) is recorded in [`docs/DESIGN_INTAKE.md`](docs/DESIGN_INTAKE.md). **This file is reviewed at the start of every working session.**
3. **Triage to Linear**: each intake entry becomes a Linear issue (referencing the IDs and the change), then the entry is removed from `DESIGN_INTAKE.md`. Business rules are discussed and recorded on the issue before development.
4. **Build**: issues are implemented under TDD, per [`docs/04_CODE_STANDARDS.md`](docs/04_CODE_STANDARDS.md), and the registry is kept in sync.

Tracking lives in Linear (workspace `yeildbay`, team `Pool Party`), one project per product area. See [`docs/07_LINEAR_WORKFLOW.md`](docs/07_LINEAR_WORKFLOW.md).

## Conventions

- **Branches:** `<type>/<area>-poo-<num>-<slug>` (`<area>` = domain: `mgr`/`dep`/`int`/`api`/`db`/…, `poo-<num>` = Linear issue). Never commit to `main`; trunk-based behind feature flags, squash-merged and auto-deleted. See [`docs/02_NAMING_CONVENTION.md`](docs/02_NAMING_CONVENTION.md).
- **Commits:** Conventional Commits, `<type>(<id>): <description>` (lowercase subject, body lines under 100 chars).
- **Language:** English in all code and documentation. UI copy ships in 11 locales (`en` is the source; translations are reviewed in PR).
- **Versions:** always LTS / mature-stable (Node 22 LTS, Next 15), never bleeding edge.

## Design source

Designs are maintained in Figma (investor app fully designed; the file is private to the team). The mapping of every design artifact to its ID and frames is in [`docs/IDS_REGISTRY.md`](docs/IDS_REGISTRY.md).
