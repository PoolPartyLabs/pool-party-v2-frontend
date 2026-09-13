# Pool Party

Front-end for **Pool Party v2**, an **On-Chain Asset Management System (OAMS)**: an open, multi-chain platform where asset managers, human or software, build and operate on-chain investment strategies, and where anyone can invest in them without giving up custody.

## Cash+ continuity demo

**Cash+** is a dedicated investment page for business dollar reserves. Its strategy combines Aave lending interest with stablecoin conversion spreads through **1inch Aqua and SwapVM**. The UI shows the balance, position composition, return sources, investment review and withdrawals within Pool Party's existing design.

The current delivery is an **interactive mock**: invest simulated USDC, advance one explicitly modeled day, inspect the result and withdraw. The demo wallet, balances and returns are illustrative. Preview mode sends no wallet transactions or RPC requests, and Cash+ stays separate from Portfolio and the strategy catalog.

```bash
pnpm install --frozen-lockfile
pnpm cash-plus:ui
```

Open `http://localhost:3049/en/cash-plus` (English) or `http://localhost:3049/pt-BR/cash-plus` (Portuguese). The command enables the required flags; no API key, connected wallet or deployed Cash+ contract is needed.

- [Demo guide, assumptions and verification](docs/features/cash-plus/cash-plus-ui-demo.md)
- [Frontend implementation](src/features/cash-plus/README.md)
- [Technical specification](docs/features/cash-plus/cash-plus-technical-spec.md)
- [Companion contracts](https://github.com/0xmvercosa/pool-party-aqua/tree/feat/cash-plus-demo/contracts/src/cashplus) and [optional local-fork tooling](scripts/cash-plus/README.md). Fork receipts are separate evidence, not transactions from the mock UI.

---

## Earlier hackathon submission

This repository is the **front-end and server half** of two hackathon tracks built on top of the Pool Party v2 investor app. The submission form accepts a single repository, so the companion smart-contract repository is linked below.

### Companion repository (smart contracts)

> **[github.com/0xmvercosa/pool-party-aqua](https://github.com/0xmvercosa/pool-party-aqua)** — the on-chain half of the Active Reserve track: contracts, deploy and ops scripts, the taker, and the judge package.

### Track 1 — Universal Funding (Uniswap Trading API)

Every money-moving operation in Pool Party has one precondition the app could not previously solve for the user: **you must already hold USDC on the exact chain the strategy lives on, plus native gas on that chain.** This track removes that precondition by swapping and bridging whatever the user already holds, across chains, through the Uniswap Trading API.

- Epic POO-1022, 33 issues, started 2026-07-24.
- **Docs: [`docs/_hackathon/`](docs/_hackathon/)** — [plan of record](docs/_hackathon/00_IMPLEMENTATION_PLAN.md) (mirrors every issue, its business rules, and its acceptance criteria), [Uniswap integration](docs/_hackathon/01_UNISWAP_INTEGRATION.md), [bridge architecture](docs/_hackathon/02_BRIDGE_ARCHITECTURE.md).
- Code: `src/lib/uniswap/`, `src/lib/provisioning/`, `src/features/strategies/lib/buildPlanSteps.ts`.

### Track 2 — Active Reserve (1inch Aqua and SwapVM)

A managed USDC reserve on Arbitrum that never sits idle and buys ETH only when the market comes down to it: roughly 95% of the vault's USDC is lent on Aave v3 behind a 5% hot buffer, while a sleeve worth about 10% of TVL is registered with 1inch Aqua as virtual balance, priced by a program whose buy band sits entirely below spot.

- Epic POO-1057.
- **Docs: [`docs/_hackathon_aqua/`](docs/_hackathon_aqua/)** — start at the [package index](docs/_hackathon_aqua/README.md).
- Code: `src/lib/aqua/` (server-only module), `src/features/aqua/` (Active Reserve investor page).
- Contracts: **[github.com/0xmvercosa/pool-party-aqua](https://github.com/0xmvercosa/pool-party-aqua)**.

### What was built during the event

Both tracks build on a pre-existing production codebase. Each package states precisely which code pre-dates the event and which was written during it: [`_hackathon/03_PRE_EXISTING_VS_NEW.md`](docs/_hackathon/03_PRE_EXISTING_VS_NEW.md) and [`_hackathon_aqua/03_PRE_EXISTING_VS_NEW.md`](docs/_hackathon_aqua/03_PRE_EXISTING_VS_NEW.md). The commit history in this repository starts at the pre-hackathon baseline, so every commit after the root commit is hackathon work.

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

The app is **mock-by-default with real seams already wired**. Wallet and auth (Privy + wagmi/viem, SIWE), analytics, and the web-security layer are real. The platform data layer runs on fixtures behind a single toggle and plugs into the backend at explicit, documented integration points (see [`docs/INTEGRATION_POINTS.md`](docs/INTEGRATION_POINTS.md)). Both hackathon tracks call live third-party APIs. UI copy ships in 11 languages.

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
| `pnpm cash-plus:ui` | Run the interactive Cash+ mock at `http://localhost:3049/en/cash-plus`. |
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
