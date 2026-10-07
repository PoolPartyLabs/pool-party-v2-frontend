# Arbitrum Open House Singapore

<p align="center">
  <img src="public/brand/duck-head.png" alt="Pool Party logo" width="96">
</p>

**Pool Party: On-Chain Asset Management System (OAMS).** Build a fund, define its mandate, compose DeFi positions and launch through a wallet-signed journey. The Arbitrum Open House Singapore submission introduces **Fund Contracts V2**, with Arbitrum One as the hub and Robinhood Chain as an optional spoke.

![Arbitrum Open House Singapore: Pool Party Fund Contracts V2](docs/assets/arbitrum-open-house-singapore.jpeg)

[Open the demo](https://v2.dev.pool-party.xyz/en/manager/new) · [Smart contracts](https://github.com/PoolPartyLabs/smartcontract-v2) · [API specification](https://github.com/0xmvercosa/PoolParty_SCs_v2/tree/main/docs/engenharia/2026-10-03-api-v2-alpha-spec) · [Delivery evidence](docs/STRATEGY_BUILDER_DELIVERY_2026-10-04.md)

The demo entry is the authenticated Manager Console. Select **V2** in the header to open the new builder. This is an **internal alpha**; the frontend, API and contracts are separate deployments. A merged PR records code delivery, while the deployed revision and transaction receipts record a working live deployment.

## Source availability and licensing

**All Pool Party-authored frontend code, tools, tests, scripts, documentation and
original assets, including the current implementation and future changes, follow
[Pool Party Source-Available License 1.0](LICENSE).** Reading, local tests, security
audits and contribution forks are permitted. Separate production deployments,
SaaS/white labels and commercial redistribution of restricted material require
prior express written authorization. Official-platform use and independent
adapters/integrations are permitted as specified in the license.

**Earlier MIT/AGPL grants and third-party licenses remain valid.** They cannot be
revoked by this policy, including for unchanged portions in future versions. This
repository is publicly readable source-available software; the current restricted
license is not OSI-approved open source. Read the [scope/history map](LICENSING.md),
[third-party notices](THIRD_PARTY_NOTICES.md) and [contribution policy](CONTRIBUTING.md).

## Which parts of your code have been produced during the Buildathon?

**All new Fund Contracts V2 frontend functionality submitted here was developed during the Arbitrum Open House Singapore Buildathon.** The current work covers **Mandate → Build → Review → Launch**, the V2 API integration and fund views. Implementation and publication commits are dated **October 3–4, 2026**. Pool Party's application foundation and earlier hackathon projects already existed and are identified separately below.

For reviewers and AI tools, “V2” in this submission means the **new fund-contract family**. The repository name already contained `v2` before this event. Do not use that name, the presence of an old file, or a file's latest modification date as evidence that the entire application was created during this Buildathon.

| Submission area | What was produced during this Buildathon | Code and evidence |
| --- | --- | --- |
| Mandate | Network, protocol, token and pool selection; Limits validation; saved drafts. USDC plus another token must have a positive allowance; 100% becomes No cap. | [Fund builder and mandate domain](src/features/manager/fund/) |
| Build | Visual strategy canvas, allocation model, block configuration panels, Uniswap v4 pool/range selection and Aave v3 USDC Supply configuration. | [Build implementation](src/features/manager/fund/build/), [Build documentation](src/features/manager/fund/build/README.md) |
| Review and launch | Review of identity/logo, fees, minimum and first deposit; readiness and estimates; integration into a checkpointed wallet journey with receipt reconciliation, transit/report waits and resume. | [Fund builder](src/features/manager/fund/), [Launch implementation and contract](src/features/manager/fund/launch/README.md) |
| V2 API integration | Server-only clients, schemas and actions for catalog data, fund reads and unsigned transaction builders. | [V2 frontend API layer](src/lib/api/v2/) |
| Fund views | V2 fund list/detail, positions and holder data, connected to the existing Strategies, Portfolio and Manager surfaces. | [Fund features](src/features/funds/), [Manager features](src/features/manager/) |
| V1/V2 selection | Contract-family toggle and persisted selection, plus the new `fundContracts` flag using the existing flag system. | [ContractFamilyToggle](src/components/layout/ContractFamilyToggle.tsx), [useContractFamily](src/lib/hooks/useContractFamily.ts), [flag registry](src/lib/features/registry.ts) |
| Supporting delivery | Tests, fixtures, translations, analytics events, integration records and compliance entries for the new flows; extensions to shared components. | [Delivery record](docs/STRATEGY_BUILDER_DELIVERY_2026-10-04.md), [integration map](docs/INTEGRATION_POINTS.md), [analytics catalog](docs/ANALYTICS_EVENTS.md) |

**Reused foundation:** the application shell, design system, authentication/wallet integration, V1 builder, provisioning infrastructure, feature-flag framework, localization, analytics and security. Supporting utilities ported from earlier private work, including the Robinhood token list and pool-by-address reader, are dependencies of the submission rather than wholly new inventions. The [October 3 continuity record](docs/CHANGELOG.md#v017-2026-10-03) documents that port.

This repository contains the **frontend**. Solidity implementations live in [PoolPartyLabs/smartcontract-v2](https://github.com/PoolPartyLabs/smartcontract-v2); backend endpoint contracts are documented in the [V2 alpha API specification](https://github.com/0xmvercosa/PoolParty_SCs_v2/tree/main/docs/engenharia/2026-10-03-api-v2-alpha-spec). Their history and deployment evidence must be assessed in those repositories, separately from this frontend's commits.

### First commit and verifiable history

All timestamps below are **UTC**. Development began in the team's private repository and was then ported to this public repository.

| Milestone | Timestamp | Evidence |
| --- | --- | --- |
| First original implementation commit for the current frontend work | **2026-10-03 02:45:17** | `685457d3bfa94227e0f972e5ee2e63ee62887bfd`, Mandate domain/catalog and tests. Recorded in the local private-repository history; this commit is not publicly accessible. |
| First publicly accessible commit of this frontend submission | **2026-10-03 15:14:06** | [`ab884b4b6c93542ab46054a5f19a352fbee5dad6`](https://github.com/PoolPartyLabs/pool-party-v2-frontend/commit/ab884b4b6c93542ab46054a5f19a352fbee5dad6). Its message explicitly records the port from the private repository. |
| First public PR merged | **2026-10-03 16:16:02** | [PR #20](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/20), merge [`0ba23ce2`](https://github.com/PoolPartyLabs/pool-party-v2-frontend/commit/0ba23ce29edacf21f9d77045962dfc7170c2373a). |
| Public baseline before this submission | **2026-09-13 19:39:11** | [`81c590e3`](https://github.com/PoolPartyLabs/pool-party-v2-frontend/commit/81c590e3111d00efd713519f7d6bb2eac5c06156), containing the earlier Cash+ work. |

Inspect the [complete frontend comparison from the previous baseline to the October 4 delivery](https://github.com/PoolPartyLabs/pool-party-v2-frontend/compare/81c590e3111d00efd713519f7d6bb2eac5c06156...4838147a60fefff40b6a0360f410cdb3aac2f96c). The public repository's root commit is [`b329ac5b`](https://github.com/PoolPartyLabs/pool-party-v2-frontend/commit/b329ac5bcb7d98d07c2959f1c5d476fc56cf8ab2), dated **2026-07-23 13:58:07 UTC**; it is a snapshot of an already existing application, not the beginning of the current submission. PRs are normally squash-merged, so PR diffs and merge commits are the durable review trail.

## What the alpha does

1. **Mandate:** choose Arbitrum One, optionally Robinhood Chain, then permitted protocols, tokens, pools and frontend allocation limits.
2. **Build:** compose positions on the canvas, configure their pools/assets and ranges, assign positive allocations and apply the panel changes.
3. **Review:** confirm fund identity and logo, fees, minimum deposit, first deposit, estimates and the expected signature steps.
4. **Launch:** enter the existing launch driver. It creates the fund, reconciles confirmed receipts, configures any spoke, funds and opens positions, and waits for transit/report settlement. Retry and resume use persisted checkpoints.
5. **Inspect:** read fund details, positions and holder exposure through the V2 fund views.

| Capability | Arbitrum One, hub | Robinhood Chain, optional spoke |
| --- | --- | --- |
| Chain ID | `42161` | `4663` |
| Base asset | USDC | USDG |
| Uniswap v4 positions | Supported | Supported |
| Aave v3 Supply | Canonical USDC only | Unavailable |
| Execution swaps | Uniswap v3 swap adapter | Uniswap v3 swap adapter |
| Cross-chain transport | Across capital transport; Wormhole reporting/order messaging | Across capital transport; Wormhole reporting/order messaging |

Uniswap v3 **positions**, Aave Borrow, leverage, perpetuals and additional chains are outside the supported alpha launch path. Across is required for a spoke allocation; a hub-only fund does not need a bridge. Token/protocol cap controls and intended network allocations are frontend planning aids in this alpha; they are not a claim that every displayed limit is enforced on-chain. Borrow may still appear in the canvas palette, but readiness and launch reject it.

Drafts and launch journals are browser-local. Estimates are labelled, unavailable metrics remain unavailable, and completion depends on settlement rather than transaction broadcast. Feature flags, manager access and mock/real mode are separate controls. See the [delivery boundaries](docs/STRATEGY_BUILDER_DELIVERY_2026-10-04.md#delivery-boundaries-and-ownership) and [compliance register](docs/COMPLIANCE_REGISTER.md) for the alpha's remaining constraints.

### Data, endpoints and assets

| Data | Source used by the frontend |
| --- | --- |
| Tokens, decimals, prices and token logos | `GET /api/v2/catalog/tokens?chainId=42161` or `4663`; catalog `logoUrl` with a shared renderer fallback. |
| Uniswap v4 pool selection and state | `GET /api/v2/catalog/uniswap-v4/pools` and `/{poolId}?chainId=...`; PoolId, PoolKey, spacing, tick and `sqrtPriceX96`. |
| Pool filters | `tokenAddress` and `secondTokenAddress` pair matching, intersected with the selected mandate and network. |
| Aave reserves and availability | `GET /api/v2/catalog/aave-v3/reserves?chainId=42161`; APY, supply/cap and active/frozen/paused gates. |
| Fund and position reads | V2 `/api/v2/funds` endpoints through [typed server actions](src/lib/api/v2/). |
| Network/protocol artwork | [Network assets](public/networks/), [protocol assets](public/protocols/) and the existing token assets. |
| Fund logo upload | Existing authenticated media-upload integration, reused by Review. |

The API prepares transaction data; the connected wallet signs and broadcasts through the launch driver. API credentials stay server-side. Pool liquidity is not presented as TVL, and missing APR/TVL is not replaced with invented figures. The [detailed source map](docs/STRATEGY_BUILDER_DELIVERY_2026-10-04.md#data-and-assets) connects each panel to its data and launch contract.

## Alpha infrastructure addresses

The contracts team's [mainnet alpha deployment record](https://github.com/PoolPartyLabs/smartcontract-v2/blob/main/docs/reports/2026-10-03-MVP-REPORT.md#mainnet-alpha-deployment) records deployment on **October 3, 2026**, from frozen contracts release **`797d592`**. The inventory below reproduces the alpha infrastructure addresses supplied for this submission.

These are **factory, implementation and linked-library addresses**, not token addresses or individual fund deposit destinations. Each created fund has its own core, spoke and share-token addresses. The contracts deployment record contains the complete fund-specific inventory and evidence.

### Same address on Arbitrum One and Robinhood Chain

| Contract | Address | Explorers |
| --- | --- | --- |
| FundFactory | `0x2CDB1f3fa95F8A65495D01D20AD53cF980728534` | [Arbitrum](https://arbiscan.io/address/0x2CDB1f3fa95F8A65495D01D20AD53cF980728534) · [Robinhood](https://robinhoodchain.blockscout.com/address/0x2CDB1f3fa95F8A65495D01D20AD53cF980728534) |
| Create3Deployer | `0x1Da47CED247a6776329281836600283b033f8e41` | [Arbitrum](https://arbiscan.io/address/0x1Da47CED247a6776329281836600283b033f8e41) · [Robinhood](https://robinhoodchain.blockscout.com/address/0x1Da47CED247a6776329281836600283b033f8e41) |
| TransitEscrow implementation | `0xfFDc3EdE1D43678dDe55E98fb924a81dCA26383F` | [Arbitrum](https://arbiscan.io/address/0xfFDc3EdE1D43678dDe55E98fb924a81dCA26383F) · [Robinhood](https://robinhoodchain.blockscout.com/address/0xfFDc3EdE1D43678dDe55E98fb924a81dCA26383F) |
| SpokeCrossChainLib | `0x3341467fd9F8Ce784D77348bEa276cE80EB57693` | [Arbitrum](https://arbiscan.io/address/0x3341467fd9F8Ce784D77348bEa276cE80EB57693) · [Robinhood](https://robinhoodchain.blockscout.com/address/0x3341467fd9F8Ce784D77348bEa276cE80EB57693) |
| SpokeUnwindLib | `0xfea626E44de1d2d7A01935A485399e992725351D` | [Arbitrum](https://arbiscan.io/address/0xfea626E44de1d2d7A01935A485399e992725351D) · [Robinhood](https://robinhoodchain.blockscout.com/address/0xfea626E44de1d2d7A01935A485399e992725351D) |
| SpokeCloseLib | `0xFCADfa1b5bCD4eDCa95220E07661795Efa883035` | [Arbitrum](https://arbiscan.io/address/0xFCADfa1b5bCD4eDCa95220E07661795Efa883035) · [Robinhood](https://robinhoodchain.blockscout.com/address/0xFCADfa1b5bCD4eDCa95220E07661795Efa883035) |
| SpokeIncomeLib | `0xCB8Ece6A3A1FCB80083eD1c8B7c7b6e85B14Dc5B` | [Arbitrum](https://arbiscan.io/address/0xCB8Ece6A3A1FCB80083eD1c8B7c7b6e85B14Dc5B) · [Robinhood](https://robinhoodchain.blockscout.com/address/0xCB8Ece6A3A1FCB80083eD1c8B7c7b6e85B14Dc5B) |

### Arbitrum One only

| Contract | Address / Arbiscan |
| --- | --- |
| ManagerRegistry | [`0xd6671dc995e6d5F2F7f65ea05a513738907737cE`](https://arbiscan.io/address/0xd6671dc995e6d5F2F7f65ea05a513738907737cE) |
| ChainlinkPriceSource | [`0xd1E43765FCb66515cd8Cf0Ede73dFF2E4bF249bF`](https://arbiscan.io/address/0xd1E43765FCb66515cd8Cf0Ede73dFF2E4bF249bF) |
| CoreVaultLogic | [`0x43Ddb24ac75Cffa09f0849DDD71a78F7e9C3068d`](https://arbiscan.io/address/0x43Ddb24ac75Cffa09f0849DDD71a78F7e9C3068d) |
| CoreVaultTransitLogic | [`0x6E6b2461628008C5E496c480860C675c33fe957D`](https://arbiscan.io/address/0x6E6b2461628008C5E496c480860C675c33fe957D) |
| CoreVaultIncomeLogic | [`0x593BF11bf8e3b2F795bbC538AEe1d59f8D4D55B8`](https://arbiscan.io/address/0x593BF11bf8e3b2F795bbC538AEe1d59f8D4D55B8) |
| CoreVaultIncomeCollectionLogic | [`0x4a0ae1f3017F6869Bc3B24CD69d0b501BA93FACa`](https://arbiscan.io/address/0x4a0ae1f3017F6869Bc3B24CD69d0b501BA93FACa) |
| CoreVaultPayoutLogic | [`0xFaa7d44e670570CaB3346522f55D1b25408D05e8`](https://arbiscan.io/address/0xFaa7d44e670570CaB3346522f55D1b25408D05e8) |
| CoreVaultClosureLogic | [`0x75997F8b180e20695c58fF519D672CFA9274E028`](https://arbiscan.io/address/0x75997F8b180e20695c58fF519D672CFA9274E028) |

## Run locally

Requires Node 22 ([`.nvmrc`](.nvmrc)) and the pnpm version pinned in [`package.json`](package.json).

```bash
pnpm install
cp .env.example .env.local
```

Set `NEXT_PUBLIC_FEATURE_FUND_CONTRACTS=on` in `.env.local` before starting the app, then run:

```bash
pnpm dev
```

Open `http://localhost:3000/en/manager/new` through the manager flow and select **V2**. The feature flag is baked into production builds, so it must also be set before `pnpm build`.

- **Mock mode**, the local default: fixtures support interface development; mock mode cannot launch a real fund. Wallet/auth configuration is separate from the data toggle.
- **Real mode:** set `NEXT_PUBLIC_MOCK_MODE=false` and configure the existing Privy/wallet, RPC, API/session and media integration. The V2 client reads `PP_API_URL` and `PP_API_KEY`; privileged launch routes also need server-only `PP_API_ADMIN_KEY`. Robinhood wallet/network paths use `NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN=on`. See [`.env.example`](.env.example), [the launch integration](src/features/manager/fund/launch/README.md) and [feature flags](docs/FEATURE_FLAGS.md).

Real-mode balances and catalog/fund reads come from live integrations. The local fixture mode does not describe every figure on a configured live deployment.

| Command | Purpose |
| --- | --- |
| `pnpm test` / `pnpm test:coverage` | Vitest suite and coverage. |
| `pnpm typecheck` / `pnpm lint` | TypeScript and Biome checks. |
| `pnpm i18n:check` / `pnpm config:check` | Locale parity and repository configuration checks. |
| `pnpm build` / `pnpm start` | Production build and server. |
| `pnpm storybook` | Component workbench. |

Stack: Next.js 15, React 19, strict TypeScript, Tailwind 4, Zustand, Zod, next-intl, Privy, wagmi/viem, Vitest and Storybook. The public app has 11 configured locales; [`src/i18n/config.ts`](src/i18n/config.ts) is authoritative.

## Documentation and AI-assisted development

Claude Code and Codex were used to draft and review code, tests and documentation under the team's direction. Specs, numbered business rules, issue references, file headers and PR diffs record the work; AI assistance does not change which parts predate this submission. The event banner is a supplied AI-generated illustration; the Pool Party logo is the existing brand asset.

For readers and AI tools, start with these sources:

| Source | What it establishes |
| --- | --- |
| [October 4 delivery](docs/STRATEGY_BUILDER_DELIVERY_2026-10-04.md) | Merged slices, validation evidence, supported journey and remaining boundaries. |
| [Manager README](src/features/manager/README.md), [Build README](src/features/manager/fund/build/README.md), [Launch README](src/features/manager/fund/launch/README.md) | Module ownership, state, configuration and execution interfaces. |
| [Project structure](docs/03_PROJECT_STRUCTURE.md), [stack](docs/01_TECH_STACK.md) | Where code lives and the technology baseline. |
| [Integration points](docs/INTEGRATION_POINTS.md), [feature flags](docs/FEATURE_FLAGS.md) | Mock/real boundaries and feature availability. |
| [Artifact IDs](docs/IDS_REGISTRY.md), [analytics](docs/ANALYTICS_EVENTS.md), [compliance](docs/COMPLIANCE_REGISTER.md) | Traceability and product constraints. |
| [Repository operating rules](CLAUDE.md), [agent/skill definitions](.claude/), [design intake](docs/DESIGN_INTAKE.md) | How specifications and reviews reach development. |

Historical documents are dated snapshots. For implementation details, use the current code and its linked tests together with the latest delivery record. For on-chain behavior, use the contracts repository and its deployment report. For API payloads, use the linked V2 API specification and frontend schemas.

## What existed before: earlier hackathons

Before this Buildathon, Pool Party already had an investor application, a V1 strategy builder, wallet/auth, a design system, internationalization, analytics, security and provisioning. The repository also retains these earlier submissions:

| Earlier work | Brief summary | Historical documentation |
| --- | --- | --- |
| July 2026: Universal Funding | Uniswap Trading API swaps and bridges to fund operations. | [Universal Funding](docs/_hackathon/) |
| July 2026: Active Reserve | An Aave-yielding USDC reserve with 1inch Aqua/SwapVM orders to buy ETH below market. | [Active Reserve](docs/_hackathon_aqua/) |
| September 2026: hookrisk and Tools | Static and dynamic Uniswap hook analysis, plus in-app scan/report rendering. | [hookrisk](hookrisk/), [Tools track](docs/_hackathon_hookrisk/) |
| September 2026: Cash+ | A business-reserve interface with an explicitly simulated ledger and share accounting. | [Cash+ demo](docs/features/cash-plus/cash-plus-ui-demo.md) |
| Supporting Privy on-ramp port | Funding integration brought into the public app from earlier private modules. | [Pre-existing vs. new](docs/_hackathon_privy/03_PRE_EXISTING_VS_NEW.md) |

These earlier projects are retained for continuity and are not claimed as new work for Arbitrum Open House Singapore. Historical third-party attribution remains in [hookrisk's prior art](hookrisk/docs/PRIOR_ART.md) and [NOTICE](hookrisk/NOTICE).
