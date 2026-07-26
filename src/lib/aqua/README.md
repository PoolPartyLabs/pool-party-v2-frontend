# Aqua module (Active Reserve)

Server-only internal API module for the Aqua strategy class. Per SRV-R1 v3 it plays the role
pool-party-api plays for the rest of the app: it owns persistence, on-chain orchestration, and
the domain services. Server actions above it stay thin (validation and auth only), and nothing
outside this module touches Drizzle or viem for Aqua data.

Canonical rules: `docs/01_BUSINESS_RULES.md` in the pool-party-aqua repo. Canonical addresses
and the measured on-chain facts: `docs/VERIFIED.md` there. `config/addresses.ts` mirrors that
file and must be re-synced if it changes.

## Layout

| Path | What it holds |
|---|---|
| `config/addresses.ts` | Gen-2 Aqua pair, tokens, Chainlink, Aave, and the measured maker-hook signature |
| `config/env.ts` | The only place server env is read (SRV-R4) |
| `data/managerMetadata.ts` | The manager-written labels for the live reserve, hardcoded |
| `chain/clients.ts` | viem public client and the taker signer |
| `api/` | Domain services; the compiler lands here in POO-1061 |

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

An earlier revision of this feature kept `aqua_ships` and `aqua_fills` in Postgres. That is gone,
deliberately, and the reasoning is worth keeping because it is the same question a reviewer asks:

*if the vault is on-chain, what was the database for?*

Nothing that the page displays as a **value**. NAV, the Aave carry, the hot buffer, the deposit cap,
which strategies are active, how much USDC each band holds and the Chainlink price are all read live
from Arbitrum on every request. The table only ever held the **descriptive** layer a manager writes
when they launch: which mandate they chose, and therefore what the band means in words.

For one live strategy in a hackathon window, a table is a worse fixture than a file: it needs a
connection string, a migration tool, a running Postgres to develop against, and it puts the labels
somewhere no reviewer can read in the diff. They now live in `data/managerMetadata.ts`, committed,
with their provenance in the header.

In the shipping product that layer arrives from the pool-party-api, the same way `name`, `logo_url`
and `riskProfile` reach a normal strategy card. This entry is built exclusively in the open-source
repo and has no write path to that private API, so the manager-console round trip was out of scope.
See `data/managerMetadata.ts` for the full justification and for what replaces it later.

`scripts/aqua/strategy.ts` prints the metadata block to paste into that file after a ship, so the
record is made by a commit rather than by an `INSERT`.
