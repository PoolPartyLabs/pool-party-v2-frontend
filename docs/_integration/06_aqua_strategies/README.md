# Aqua Strategies (1inch Hackathon): moved

The canonical documentation for the Aqua strategy class (architecture, business rules, workplan) lives in the **dedicated hackathon repo**: [github.com/0xmvercosa/pool-party-aqua](https://github.com/0xmvercosa/pool-party-aqua) (local at `~/Documents/pool-party-aqua`), folder `docs/`. Start with `docs/VERIFIED.md`: it carries the canonical Arbitrum addresses and the on-chain facts measured in POO-1058, and it is the file `src/lib/aqua/config/addresses.ts` mirrors.

What lives on THIS branch: the Aqua server module (`src/lib/aqua/`, server-only), its Drizzle schema and migrations (`drizzle/aqua/`), the CLI entrypoints (`scripts/aqua/`), and the Active Reserve surfaces. See `src/lib/aqua/README.md`.

Decision trail: Linear epic [POO-1057](https://linear.app/yeildbay/issue/POO-1057) (project "Aqua Strategies (1inch Hackathon)"). Per Murilo (2026-07-25): development happens in the new repo, orchestration is a Next server-actions module with a Postgres database, no separate backend service, and the main-app integration into pool-party-frontend (protocol discriminator + `aquaStrategies` flag) is post-hackathon.

Research working files from the discovery session: `_tmp/aqua-hackathon/` (ephemeral, this worktree only).
