# Pool Party

Front-end for **Pool Party v2**, an **On-Chain Asset Management System (OAMS)**: an open, multi-chain platform where asset managers, human or software, build and operate on-chain investment strategies, and where anyone can invest in them without giving up custody.

---

## Hackathon submission

This repository is the **front-end and server half** of three hackathon tracks built on top of the Pool Party v2 investor app. The submission form accepts a single repository, so the companion smart-contract repository is linked below.

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

### Track 3 — Institutional onboarding with Privy (2026-09, event name TBD)

> **Narrative placeholder.** The thought process is recorded in [`docs/_hackathon_privy/`](docs/_hackathon_privy/) and is refined before submission; every claim about the code below is checkable today.

An institution's treasury team should be able to put company funds into an on-chain strategy the way they open any SaaS account: **sign in with Google, pay with the company card, done.** This track removes wallet setup, seed phrases, buying crypto on an exchange, bridging and gas from that path with Privy: a Google sign-in mints an embedded wallet, a fiat checkout funds it on Base, the provisioning gate turns that balance into exactly what the strategy needs, and the investment settles. Every receipt and every `completed` event fires on an **observed on-chain balance**, never on a provider callback or a click.

- **Docs: [`docs/_hackathon_privy/`](docs/_hackathon_privy/)** — [goal and decisions](docs/_hackathon_privy/00_GOAL.md), [the flow module by module](docs/_hackathon_privy/01_PRIVY_ONRAMP_FLOW.md), [demo runbook](docs/_hackathon_privy/02_DEMO_RUNBOOK.md), [pre-existing vs new](docs/_hackathon_privy/03_PRE_EXISTING_VS_NEW.md).
- Code: `src/lib/onramp/` (Privy adapter, outcome classifier, intent journal, settlement watcher, coverage probe), `src/features/deposit/` (the `/deposit` surface with `DepositPrivyCheckout`), `src/features/strategies/components/provisioning/PrivyBuyStep.tsx` (the buy leg inside the provisioning gate), `src/lib/features/registry.ts` (`fiatOnRamp` + `privyOnRamp`, **on by default in this repository**).
- The rail runs in real mode against a Privy app and the Pool Party API; mock mode keeps its fixture path on purpose. Setup is in the runbook.

### Companion tool — hookrisk: risk analysis and a full report for a Uniswap v4 hook

[`hookrisk/`](hookrisk/) is the [Uniswap Foundation's Hooks Security Framework](https://github.com/uniswapfoundation/security-framework) made executable. It was developed during the hackathon in a private repository and is copied here, unchanged apart from a provenance banner, so it can be presented from the same public repository. It has **no link to the app**: nothing under `src/` imports it, and the app's lint, typecheck, tests and Docker build exclude the folder.

What it does, from `hookrisk scan src/MyHook.sol:MyHook`:

- **Reads the hook** with Slither detectors (`hookrisk/detectors/`): an `IHooks` callback anyone can call (HS-01), declared permissions that disagree with the implemented callbacks (HS-02), the admin surface, third-party calls on the swap path, unbounded dynamic fees, custom accounting as a classification.
- **Executes the hook** in a twin-pool differential harness on real `v4-core` (`hookrisk/harness/`): two pools identical except for the hook, the same fuzzed sequence, and three invariants (no token created or destroyed, no undeclared extraction beyond the declared fee, every position can be closed). A hook that documents a 1% fee and charges 3.5% is structurally flawless; only execution sees it.
- **Runs BlockSec's HookScan** as an isolated, attributed second engine and merges agreeing findings into one at raised confidence.
- **Scores** the nine framework dimensions and seven triggers, and refuses to score a dimension zero unless a detector capable of finding something actually ran; a missing engine yields an *unmeasured* dimension and a tier **range**, never a flattering number.
- **Emits the full report**: `HOOK_RISK.md` (the human report), `hook-risk.json` (a manifest bound to one exact `chainId`, `address` and `codehash`, validated against `hookrisk/schema/hook-risk.schema.json`), `hookrisk.sarif` (findings on the diff in CI), and a meaningful exit code (`0` passed, `2` gate failed, `10+` could not run).

Start at [`hookrisk/README.md`](hookrisk/README.md); the hackathon record, the before/after scans of 14 real hooks (including the archived Cork exploit hook) and the demo runbook are under [`hookrisk/docs/hackathon/`](hookrisk/docs/hackathon/). Licensing is per directory: MIT, except `hookrisk/detectors/`, which is AGPL-3.0-only (see [`hookrisk/NOTICE`](hookrisk/NOTICE)).

### What was built during the event

All three tracks build on a pre-existing production codebase. Each package states precisely which code pre-dates the event and which was written during it: [`_hackathon/03_PRE_EXISTING_VS_NEW.md`](docs/_hackathon/03_PRE_EXISTING_VS_NEW.md), [`_hackathon_aqua/03_PRE_EXISTING_VS_NEW.md`](docs/_hackathon_aqua/03_PRE_EXISTING_VS_NEW.md) and [`_hackathon_privy/03_PRE_EXISTING_VS_NEW.md`](docs/_hackathon_privy/03_PRE_EXISTING_VS_NEW.md). The third package also states which of its code was ported from the team's private repository rather than written during the event. The commit history in this repository starts at the pre-hackathon baseline, so every commit after the root commit is hackathon work.

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

The app is **mock-by-default with real seams already wired**. Wallet and auth (Privy + wagmi/viem, SIWE), analytics, and the web-security layer are real. The platform data layer runs on fixtures behind a single toggle and plugs into the backend at explicit, documented integration points (see [`docs/INTEGRATION_POINTS.md`](docs/INTEGRATION_POINTS.md)). All three hackathon tracks call live third-party APIs (Uniswap Trading API, 1inch Aqua, Privy). The fiat on-ramp (Privy rail) is real in real mode and **on by default** in this repository. UI copy ships in 11 languages.

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
