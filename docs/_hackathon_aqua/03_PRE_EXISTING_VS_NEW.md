<!--
@id PP-AQUA-DOC-005
@name Active Reserve continuity delimitation, pre-existing versus new
@implements-rules-version v3
@hackathon POO-1057 (Active Reserve on 1inch Aqua)
-->

# Continuity delimitation: what pre-dates the hackathon, what was built during it

**This is a continuity submission.** Pool Party v2 is an existing product with roughly a year of
history: an on-chain asset management system where managers run strategies and retail investors buy
in. The hackathon entry is a specific, self-contained new capability built on top of it: **Active
Reserve**, a vault that keeps its USDC earning on Aave and buys ETH below market through a 1inch Aqua
strategy, withdrawing from Aave inside the settlement transaction.

This document draws the line at file level, so an evaluator can verify the claim instead of taking it
on trust. Part 1 is the platform. Part 2 is the entry, and every row there carries a `Status`:
`landed` means the path is in this tree right now, `planned` means the capability is named and the
path does not exist. Rows are written so a test can check both directions.

- **Repository:** `pool-party-v2-frontend` (private), branch `feat/aqua-poo-1067-investor-page`
- **Companion repository:** [`0xmvercosa/pool-party-aqua`](https://github.com/0xmvercosa/pool-party-aqua) (public), which holds the whole on-chain side
- **Tracker:** Linear epic POO-1057, project "Aqua Strategies (1inch Hackathon)". The issues visible in this branch's commit history are POO-1058 (measured on-chain facts), POO-1061 (program compiler), POO-1067 (investor page), POO-1068 (manager console UI, cut; the CLI shipped instead) and POO-1071 (server module)
- **Chain:** Arbitrum One

---

## Two hackathon entries in one repository, and they are not the same entry

This repository carries documentation for **two separate hackathon submissions**. They share a tree
and almost nothing else. Conflating them would misattribute work in both directions, so:

| Package | Entry | Tracker | What it integrates | Code |
|---|---|---|---|---|
| `docs/_hackathon/` | **Universal Funding**: pay for any Pool Party operation with any token on any supported chain | epic POO-1022 | Uniswap Trading API | `src/lib/uniswap/`, `src/lib/provisioning/`, `src/features/swap/`, provisioning surfaces under `src/features/strategies/` |
| `docs/_hackathon_aqua/` | **Active Reserve**: an always-earning reserve that buys the dip (this package) | epic POO-1057 | 1inch Aqua and SwapVM, Aave v3, Chainlink | `src/lib/aqua/`, `src/features/aqua/`, `scripts/aqua/`, `drizzle/aqua/`, two routes |

They touch each other in exactly two places, both trivial and both listed in Part 2: `package.json`
(each adds its own scripts and dependencies) and `scripts/bundle-secrets-check.ts` (each registers its
own server-only secrets with the shared build-output grep). No module of one imports a module of the
other.

One consequence for verification: the Universal Funding entry tags each of its files with a
`@hackathon` header field and verifies itself with `git grep -l "@hackathon"`. **The Aqua files do not
carry that tag**, so that recipe returns the other entry's files and not these. The boundary here is
drawn by path and by commit instead, as below.

---

## How to verify the boundary yourself

```bash
# The four commits that carry this entry on the frontend side
git log --oneline 1d0311aa~1..HEAD -- src/lib/aqua src/features/aqua scripts/aqua drizzle/aqua

#   1d0311aa  server module scaffold + program compiler [POO-1071, POO-1061] (#664)
#   fdf29729  Active Reserve read-only investor page [POO-1067]
#   6be96fec  PP-INTEGRATION-POINT census for the investor page
#   3c5d630a  compiler was omitting the preTransferOut hook, killing the JIT path [POO-1061]

# Everything this entry added to the frontend tree, by path
find src/lib/aqua src/features/aqua scripts/aqua drizzle/aqua -type f | sort
#   22 + 10 + 2 + 3 = 37 files (measured 2026-07-26), plus the two route files below
ls "src/app/[locale]/active-reserve/page.tsx" "src/app/[locale]/dev/active-reserve/page.tsx"

# The tag recipe belongs to the OTHER entry, not this one
git grep -l "@hackathon" -- src/lib/aqua src/features/aqua scripts/aqua   # no matches
```

Every path in Part 2 is repo-relative and resolvable, because a citation nobody can resolve is not a
citation.

---

## Part 1: pre-existing, before this event

These are **not** part of the submission. They are the platform it runs on, and they are listed
because the integration is only sane-sized *because* they already existed.

### The application

| Path | What it gives this entry |
|---|---|
| `src/app/[locale]/layout.tsx` | Next 15 App Router with a locale segment, self-hosted fonts, analytics and consent already mounted. The Active Reserve route is a page in an app, not a standalone demo |
| `src/i18n/routing.ts`, `src/i18n/config.ts` | 11 configured locales and the `next-intl` routing the new route plugs into with one `setRequestLocale` call |
| `src/design-system/`, `src/components/` | The dark theme, the token layer and the component conventions the five new cards follow |
| `src/components/layout/AppShell.tsx` | The shell and content-width conventions |
| `src/lib/utils/format.ts` | The repository's number-formatting rules, which `src/features/aqua/format.ts` follows for raw-integer token math |

### Wallet, auth and chain access

| Path | What it gives this entry |
|---|---|
| `src/app/providers.tsx` | Privy plus wagmi and viem, already wired for Arbitrum, Base and Polygon, with SIWE to a JWT in an httpOnly cookie |
| `src/lib/chains/config.ts` | The single source of truth for supported chains, Arbitrum included |
| `src/lib/tx/sendTransaction.ts` | The broadcast choke point a future Active Reserve deposit flow would use rather than reinvent |

### Data, security and quality

| Path | What it gives this entry |
|---|---|
| `src/lib/services/index.ts`, `src/mocks/` | The mock-by-default seam and its 12 domain services. Active Reserve deliberately sits outside it: this surface reads real chain state or renders nothing |
| `src/lib/api/client.ts` | The `server-only` plus `x-api-key` plus Zod pattern that `src/lib/aqua/` mirrors for its own boundary |
| `src/lib/security/csp.ts` | Security headers and the per-request CSP nonce. No CSP change was needed: every Aqua read happens server-side |
| `scripts/bundle-secrets-check.ts` | The committed build-output grep for server-only secrets. This entry registers two more secrets with it rather than inventing a second check |
| `src/lib/features/registry.ts` | The feature-flag system (used by the other entry; see Part 4 for why this one does not use it yet) |
| `vitest.config.ts`, `tests/setup.ts` | Vitest and Testing Library, already configured, which is why the new suites are pure and offline |

### The strategy class that already existed

Pool Party v2 already runs one strategy class: **Uniswap v3 concentrated liquidity**, under
`src/features/strategies/` and `src/features/manager/`, with its own pool math in `src/lib/uniswap/`
and its own manager flows. Active Reserve is a **second, unrelated strategy class**: a vault, a carry
adapter and an Aqua program. It shares the app, the wallet stack and the design system with the
Uniswap class, and shares no domain code with it.

---

## Part 2: built during the hackathon

Everything below is new work for this event. `landed` is in the tree today; `planned` is named and not
written. A row naming a directory covers the files under it.

**The on-chain side is a separate public repository** and is deliberately absent from these tables,
because every path here is meant to resolve inside this tree. `PartyVault`, `AaveV3Adapter`, the
deploy and ops scripts, the taker, the status report and the judge package all live in
[`0xmvercosa/pool-party-aqua`](https://github.com/0xmvercosa/pool-party-aqua), and all of it is new
work for this event. The deployed addresses it produced, and which this frontend reads, are
`PartyVault` `0xec870a6A9E8EE41B349FD0766b8f295D6EDC6610` and `AaveV3Adapter`
`0x6d409fF8578D017AddDB2e9Ad0848D8F0A65aBAe`, both source-verified on Arbiscan.

### New modules: the Aqua server module

Server-only throughout. An accidental client import is a build error, not a leaked database URL.

| Path | What it does | Issue | Status |
|---|---|---|---|
| `src/lib/aqua/index.ts` | The module barrel and its contract: this layer plays the role `pool-party-api` plays for the rest of the app, and nothing outside it touches Drizzle or viem for Aqua data | POO-1071 | landed |
| `src/lib/aqua/config/addresses.ts` | The single place the app learns an address. Mirrors `docs/VERIFIED.md` in the on-chain repo: the gen-2 Aqua pair, native USDC and WETH, Chainlink, Aave, the measured maker-hook signature and selector, and a guard that refuses the dead gen-1 deployment | POO-1058, POO-1071 | landed |
| `src/lib/aqua/config/env.ts` | The only place server env is read. No `NEXT_PUBLIC_` twin exists for any of it | POO-1071 | landed |
| `src/lib/aqua/chain/clients.ts` | viem public client and the taker signer, kept separate so a read path cannot require a key | POO-1071 | landed |
| `src/lib/aqua/db/schema.ts` | `aqua_ships` and `aqua_fills`, money as `numeric(78,0)` read back as strings | POO-1071 | landed |
| `src/lib/aqua/db/client.ts` | The only place a database connection is opened | POO-1071 | landed |
| `src/lib/aqua/api/compiler/compile.ts` | **The only producer of Aqua programs and ship calldata.** Enforces every platform guardrail, so an out-of-policy program cannot be built at all, and emits the program order measured against the deployed router | POO-1061 | landed |
| `src/lib/aqua/api/compiler/band.ts` | Band math for `concentrateGrowLiquidity2D`: Chainlink 8-decimal spot to the sqrt-price fixed point the instruction wants, with the token ordering that trips everyone up | POO-1061 | landed |
| `src/lib/aqua/api/compiler/mandates.ts` | The two mandates that shipped: production (15% to 5% below spot) and the approved demo band (0.3% to 0.1% below spot) | POO-1061 | landed |
| `src/lib/aqua/api/compiler/roll.ts` | Dock and roll, refusing any roll that would reuse a salt, because a docked strategy hash is dead forever | POO-1061 | landed |
| `src/lib/aqua/api/compiler/context.ts` | The live inputs a compile needs (spot, vault assets, what is already committed), kept out of the compiler so the compiler stays a pure function | POO-1061 | landed |
| `src/lib/aqua/api/compiler/types.ts` | The frozen mandate and compile-result shapes | POO-1061 | landed |
| `src/lib/aqua/api/compiler/index.ts` | The compiler's public surface | POO-1061 | landed |
| `src/lib/aqua/api/vaultState.ts` | Everything the investor page shows, assembled server-side: chain reads for all money, the ships and fills tables only for what chain cannot cheaply tell us | POO-1067 | landed |
| `src/lib/aqua/abis/partyVault.ts` | The typed slice of the vault, adapter, Aqua registry and Chainlink feed that the page actually calls | POO-1067 | landed |
| `src/lib/aqua/abis/PartyVault.json`, `src/lib/aqua/abis/AaveV3Adapter.json`, `src/lib/aqua/abis/ICarryAdapter.json` | The committed contract artifacts exported from the on-chain repo, which the typed slice is checked against | POO-1067 | landed |
| `src/lib/aqua/README.md` | The module's own guide: the `server-only` rule and its one exemption, the money-as-string rule, and the database commands | POO-1071 | landed |

### New modules: the investor surface

| Path | What it does | Issue | Status |
|---|---|---|---|
| `src/features/aqua/ActiveReserveScreen.tsx` | The read-only Active Reserve page: header, honest states, and the five blocks below | POO-1067 | landed |
| `src/features/aqua/components/NavCard.tsx` | Total value and the three things it is made of | POO-1067 | landed |
| `src/features/aqua/components/SleevesCard.tsx` | The measured split between capital lent on Aave and cash on hand, never a claimed ratio | POO-1067 | landed |
| `src/features/aqua/components/BandCard.tsx` | One buy band drawn against live spot, with its countdown and its opening transaction | POO-1067 | landed |
| `src/features/aqua/components/FillsFeed.tsx` | Every purchase, its Arbiscan link, the price actually paid, the just-in-time badge, and the self-directed disclosure above the list | POO-1067 | landed |
| `src/features/aqua/components/VerifyBlock.tsx` | Our contracts next to the official 1inch registry and router, all linked | POO-1067 | landed |
| `src/features/aqua/copy.ts` | All product copy in one file, including the description used verbatim in the submission | POO-1067 | landed |
| `src/features/aqua/format.ts` | Raw integer units in, human strings out, with no JS `number` in the path and truncation rather than rounding | POO-1067 | landed |
| `src/app/[locale]/active-reserve/page.tsx` | The route: server-rendered, `force-dynamic`, so no NAV is ever served from a cache | POO-1067 | landed |
| `src/app/[locale]/dev/active-reserve/page.tsx` | A fixture-fed preview of the live layout that 404s in production, so the demo layout was reviewable before the vault existed | POO-1067 | landed |

### New: CLI, database and build configuration

| Path | What it does | Issue | Status |
|---|---|---|---|
| `scripts/aqua/strategy.ts` | The manager CLI (ship, roll, dock, launch payloads). It signs nothing: it compiles, checks policy, records the intent and prints calldata for a human wallet | POO-1068 | landed |
| `scripts/aqua/db-check.ts` | Verifies the extension tables exist and round-trip, without printing anything that could leak the mirror or its connection string | POO-1071 | landed |
| `drizzle/aqua/0000_eminent_speed.sql` | The generated migration for the two tables | POO-1071 | landed |
| `drizzle/aqua/meta/_journal.json` | Drizzle's migration journal | POO-1071 | landed |
| `./drizzle.config.ts` | Drizzle scoped to `aqua_*` tables only. The target is a mirror of production, and without that filter drizzle-kit would generate DROP statements for the real schema | POO-1071 | landed |

### Tests written for this entry

| Path | What it locks | Issue | Status |
|---|---|---|---|
| `src/features/aqua/ActiveReserveScreen.test.tsx` | The copy rules, the honest empty and stale states, the numbers, the fill links and the verification block | POO-1067 | landed |
| `src/features/aqua/format.test.ts` | Exact money formatting, including the precision a float would lose and truncation never rounding up | POO-1067 | landed |
| `src/lib/aqua/api/compiler/compile.test.ts` | The compiler's program order, its policy refusals and the maker hook | POO-1061 | landed |
| `src/lib/aqua/abis/abis.test.ts` | The committed artifact against the committed artifacts, in both directions | POO-1067 | landed |
| `src/lib/aqua/serverOnly.test.ts` | The `server-only` boundary, its single documented exemption, and that the database URL is read in exactly one file | POO-1071 | landed |

### Modified pre-existing files

| Path | Change | Issue | Status |
|---|---|---|---|
| `./package.json` | Seven `aqua:*` scripts, and the exact-pinned `@1inch/swap-vm-sdk` 0.3.0, `@1inch/aqua-sdk` 0.2.0 and `@1inch/sdk-core` 0.1.2, plus drizzle and tsx | POO-1071 | landed |
| `./.env.example` | Documents `AQUA_DATABASE_URL`, `TAKER_BOT_PRIVATE_KEY` and the Arbitrum RPC as commented, valueless entries. No secret is committed anywhere | POO-1071 | landed |
| `scripts/bundle-secrets-check.ts` | Registers the two Aqua secrets with the shared build-output grep, so a leak into client bundles fails a committed check | POO-1071 | landed |

### Documentation

| Path | What | Issue | Status |
|---|---|---|---|
| `docs/_integration/06_aqua_strategies/README.md` | The pointer from the frontend docs tree to the on-chain repository, plus the decision trail | POO-1057 | landed |
| `docs/_hackathon_aqua/README.md` | The package index and overview | POO-1057 | landed |
| `docs/_hackathon_aqua/00_IMPLEMENTATION_PLAN.md` | What was built here, issue by issue | POO-1057 | landed |
| `docs/_hackathon_aqua/01_AQUA_INTEGRATION.md` | The server module: SDK calls, compiler, chain reads, database | POO-1057 | landed |
| `docs/_hackathon_aqua/02_INVESTOR_SURFACE.md` | The Active Reserve page: blocks, data sources, copy rules, tests | POO-1057 | landed |
| `docs/_hackathon_aqua/03_PRE_EXISTING_VS_NEW.md` | This file | POO-1057 | landed |
| `docs/_hackathon_aqua/04_REFERENCES.md` | Every reference, dependency and attribution | POO-1057 | landed |

### Deleted

Nothing. This entry is purely additive to the frontend tree: no pre-existing module was removed,
renamed or downgraded to make room for it.

### Named and not built in this window

Filed as capability, not written. The paths below are where each would land, and they do not exist.

| Path | What it would be | Issue | Status |
|---|---|---|---|
| `src/lib/aqua/api/indexer.ts` | The in-repo fill indexer. `aqua_fills` is read by the page and written by nothing in this tree; rows come from the taker side in the on-chain repo | POO-1057 | planned |
| `src/lib/aqua/api/deposit.ts` | Deposit and redeem calldata built server-side. Both run from the CLI in the on-chain repo today | POO-1057 | planned |
| `src/features/aqua/components/DepositCard.tsx` | The investor write surface that would consume it | POO-1057 | planned |
| `src/features/aqua/ActiveReserveScreen.stories.tsx` | Storybook coverage for the five new components, which the repository's own standard asks for | POO-1057 | planned |
| `src/i18n/messages/en/activeReserve.json` | The locale namespace. Page copy is English-only constants in `copy.ts` for the event, so no key parity was broken and none was added | POO-1057 | planned |
| `docs/adr/0004-aqua-server-module-as-the-internal-api.md` | The architecture decision behind putting orchestration in a Next server module rather than a separate backend service | POO-1057 | planned |

---

## Part 3: what this entry actually contributes

Stated plainly, so each claim can be checked against a file, an address or a transaction.

1. **A maker that never sits idle.** About 95% of the vault's USDC earns on Aave behind a hot buffer,
   while a sleeve worth about 10% of TVL is registered with Aqua as virtual balance. The same capital
   is earning and quoting at once, and the reconciliation happens inside settlement.
2. **A just-in-time unwind inside the settlement transaction.** The maker hook `preTransferOut`
   (9 arguments, selector `0x5a394f80`) withdraws from Aave mid-fill. The flagship mainnet
   transaction `0xbc64ec2db39c6a8f718487268e4195c63e472f0ad0ae1f46e09919a1a9c5bb83` contains the aUSDC
   burn, the Aqua pull and the WETH push in one transaction: 0.0003 WETH bought for 0.556382 USDC.
   Three of the five mainnet fills took that path.
3. **The official 1inch gen-2 contracts, unmodified.** Registry
   `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` and `AquaSwapVMRouter`
   `0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE`, both linked from the page's own verification block.
   A dead gen-1 deployment exists and is what the upstream READMEs document; `addresses.ts` carries it
   only so a guard can refuse it.
4. **A program order measured against the deployed router, not copied from a doc.**
   `[deadline][concentrateGrowLiquidity2D][flatFeeAmountInXD 80bps][xycSwapXD][salt]`: concentrate
   shapes reserves, `xycSwapXD` executes, and a fee placed after the executing curve reverts at quote
   time. Commit `3c5d630a` on this branch is the same discipline applied to the hook: the compiler was
   omitting `preTransferOut`, which would have silently killed the just-in-time path.
5. **A compiler that is the only way to produce a program**, with every guardrail expressed as a
   refusal that names the rule it comes from, so an out-of-policy strategy cannot be built at all.
6. **An investor surface that is a verification surface.** Every number on the page is a live chain
   read, the page refuses to render a section it has no true data for, and it links the contracts so a
   reader can check the numbers rather than believe them.

## Part 4: not attempted, and why

Listed so the delimitation cuts both ways.

| Out of scope | Why |
|---|---|
| Deposit and redeem in the app | Read-only was the honest shape for the window. Both run from the CLI in the on-chain repo; §1 of [`02_INVESTOR_SURFACE.md`](02_INVESTOR_SURFACE.md) states what a write path would need |
| Per-investor accounting | The page reads `totalShares()` and shows no per-user position, because a share count with no share price invites a wrong reading |
| A feature flag for the route | The repository's own rule 10 wants unlaunched areas dark-launched through `src/lib/features/registry.ts`, and no `aqua` flag was registered. The honest not-deployed state stands in for it, which is not the same thing |
| The 11-locale port | Page copy is English-only constants for the event. No translation keys were added, so locale parity was never broken, but the rule is deferred rather than met |
| Storybook stories | The five components ship without stories |
| Integration into the main app | The protocol discriminator and an `aquaStrategies` flag that would let Active Reserve appear alongside the Uniswap v3 strategies are explicitly post-hackathon |
| The deferred tables | `aqua_mandates`, `aqua_nav_snapshots` and `aqua_keeper_log` are designed and not created. Live state is read from chain, so no stored series is needed to run the demo |
| A contract audit | The disclosure says so on the page: unaudited contracts, run under hard caps with the team's own capital |
