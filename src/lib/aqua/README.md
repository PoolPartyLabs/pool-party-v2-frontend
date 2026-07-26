# Aqua module (Active Reserve)

Server-only internal API module for the Aqua strategy class. Per SRV-R1 v3 it plays the role
pool-party-api plays for the rest of the app: it owns persistence, on-chain orchestration, and
the domain services. Server actions above it stay thin (validation and auth only), and nothing
outside this module touches viem for Aqua data.

**The contracts live in a separate public repository: [`0xmvercosa/pool-party-aqua`](https://github.com/0xmvercosa/pool-party-aqua).**
PartyVault, the Aave v3 carry adapter, the deploy and ops scripts, the taker, and the judge package
are all there. This module reads what those contracts wrote; it deploys nothing and owns no state.

Canonical rules: [`docs/01_BUSINESS_RULES.md`](https://github.com/0xmvercosa/pool-party-aqua/blob/main/docs/01_BUSINESS_RULES.md) there.
Canonical addresses and the measured on-chain facts:
[`docs/VERIFIED.md`](https://github.com/0xmvercosa/pool-party-aqua/blob/main/docs/VERIFIED.md). `config/addresses.ts` mirrors that file and
must be re-synced if it changes. The fills are cross-checked against
[`docs/FILLS.md`](https://github.com/0xmvercosa/pool-party-aqua/blob/main/docs/FILLS.md).

## Layout

| Path | What it holds |
|---|---|
| `config/addresses.ts` | Gen-2 Aqua pair, tokens, Chainlink, Aave, and the measured maker-hook signature |
| `config/env.ts` | The only place server env is read (SRV-R4) |
| `data/managerMetadata.ts` | The settled-purchase list, the only committed data left |
| `chain/clients.ts` | viem public client and the taker signer |
| `api/` | Domain services: vault state, the program compiler, vault discovery and the `Shipped` decode |

## The two things that will bite you

**`server-only` is load-bearing.** Every file except `config/public.ts` imports it, which makes an
accidental client import a build error rather than a leaked taker key. `config/public.ts` is
exempt because the browser genuinely needs deployed addresses and a chain id; it is asserted
inert (no env, no key) by `serverOnly.test.ts`, which enforces both the rule and the exemption.

Scripts run the same server modules, so they need `tsx --conditions=react-server`. Without it
the `server-only` marker resolves to the throwing build and the script dies on import.

**Money is a string, never a number.** Token amounts cross every boundary as raw integer units in
decimal strings. Parse to `bigint`, do the arithmetic there, and hand the string back. A JS
`number` anywhere in this path silently loses precision on any realistic WETH amount. The repo
targets ES2017, so bigints are built with `BigInt(...)` rather than `0n` literals.

## There is no database

An earlier revision kept `aqua_ships` and `aqua_fills` in Postgres. That is gone, and so is the
committed fixture that briefly replaced it. The reasoning is worth keeping, because it is the same
question a reviewer asks: *if the vault is on-chain, what was the database for?*

Nothing the page displays as a **value**. NAV, the Aave carry, the hot buffer, the deposit cap, which
strategies are active, how much USDC each band holds and the Chainlink price are read live from
Arbitrum on every request. The table held the band **geometry**: mandate name and price range.

That turned out to be recoverable too. `api/backfill.ts` decodes it from the Aqua registry's own
`Shipped` log, and when it first ran against the live vault it disagreed with the committed values by
about $25 on spot. The chain was right. Both the table and the fixture were solving a problem that a
decode solves better.

What is still committed is the settled-purchase list in `data/managerMetadata.ts`, and only because
the indexer that would read settlements off-chain is not built. Every row there is a real Arbitrum
transaction. That file's header says so at length, and so does the page.

`scripts/aqua/strategy.ts` prints what it compiled so an operator can eyeball a band before
broadcasting; `pnpm aqua:discover` reads back what the chain actually recorded.
