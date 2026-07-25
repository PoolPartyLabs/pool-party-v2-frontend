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
| `db/schema.ts` | `aqua_ships` and `aqua_fills` |
| `db/client.ts` | The only place a database connection is opened |
| `chain/clients.ts` | viem public client and the taker signer |
| `api/` | Domain services; the compiler lands here in POO-1061 |

## The two things that will bite you

**`server-only` is load-bearing.** Every file except `db/schema.ts` imports it, which makes an
accidental client import a build error rather than a leaked database URL. `db/schema.ts` is
exempt because drizzle-kit reads it from a plain Node process to generate migrations; it holds
no secret and opens no connection, and `serverOnly.test.ts` enforces both the rule and the
exemption.

Scripts run the same server modules, so they need `tsx --conditions=react-server`. Without it
the `server-only` marker resolves to the throwing build and the script dies on import.

**Money is a string, never a number.** Token amounts are raw integer units in `numeric(78,0)`
columns (78 digits covers uint256) and Drizzle returns them as strings. Parse to `bigint`, do
the arithmetic there, and store the string back. A JS `number` anywhere in this path silently
loses precision on any realistic WETH amount. The repo targets ES2017, so bigints are built
with `BigInt(...)` rather than `0n` literals.

## Database

The target is a Neon **mirror of production**, which is why `drizzle.config.ts` sets
`tablesFilter: ["aqua_*"]`. Without that filter drizzle-kit would treat the mirrored
pool-party-api tables as "not in my schema" and generate DROP statements for them. Scoped as
it is, a generated migration can only ever touch tables we created.

```bash
pnpm aqua:db:generate   # diff schema.ts -> a new migration in drizzle/aqua
pnpm aqua:db:migrate    # apply pending migrations
pnpm aqua:db:check      # tables exist, round-trip works, money decodes as string
```

Scope is deliberately two tables for the 20-hour window. `aqua_mandates`,
`aqua_nav_snapshots` and `aqua_keeper_log` are designed but deferred: the status script reads
live state from chain rather than a stored series, so nothing in the demo needs them.
