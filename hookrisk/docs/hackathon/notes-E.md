# Agent E — BlockSec HookScan adapter

Scope: make the BlockSec engine actually run. It shipped unusable and the README
said so.

Files: `cli/src/engines/blocksec.ts`, `cli/src/engines/blocksec.test.ts` (new),
`docs/PRIOR_ART.md`, `docs/hackathon/evidence/blocksec-corroboration.md`.

## What changed

**`--platform linux/amd64` on every invocation.** The image publishes an amd64
manifest and nothing else, so a bare `docker pull` on arm64 fails outright.
`HOOKRISK_BLOCKSEC_PLATFORM` overrides it; an explicitly empty value omits the
flag (`?? DEFAULT`, not `|| DEFAULT`, so "" is honoured as a choice). `probe()`
now suggests `docker pull --platform linux/amd64 <image>` — the bare command it
used to print does not work on the machines most people develop on.

**Entrypoint bypassed.** `/entrypoint.sh` does `groupadd`/`useradd` from the
uid/gid of the mounted `/project`, which is 0 under Docker Desktop, so it dies
before the analyser starts and the container's only output is its `arg list: …`
banner. That banner *was* the "could not parse HookScan output" error. The
adapter now runs `--entrypoint python … -m hookscan` and builds the argument
vector the entrypoint would have built.

**solc provisioning.** The image ships 0.8.14–0.8.24; v4-core pins 0.8.26, so
nothing current compiles inside it. The adapter probes `/solc` with
`--entrypoint ls`, and on a miss downloads the exact linux-amd64 static build
(filename resolved from the official `list.json` — the `+commit.…` suffix is not
derivable), caches it at `~/.cache/hookrisk/solc/<ver>/solc`
(`HOOKRISK_CACHE_DIR` moves the root) and mounts it read-only. Write-then-rename,
so a concurrent scan never mounts a half-written file. `fetch` with
`AbortSignal.timeout`, no shell, no new dependency. **The download is host-side;
the analysis container is still `--network none`.**

Cache entries are validated on ELF magic as well as size and mode. The realistic
corruption is not truncation — it is a proxy error page written to the cache and
then mounted as `solc`, which would surface as "exec format error" forever after.

**Symlinked `lib/` is detected and refused.** Only the project root is mounted,
so `corpus/lib -> ../harness/lib` lands at `/harness/lib` inside the container.
I tried the obvious fix (bind the realpath over `/project/lib`) and verified it
does not work: the runtime resolves a bind-mount destination *through* the
symlink, and solc then rejects every import with `File outside of allowed
directories`. HookScan builds its own solc command line, so we cannot widen
`--allow-paths`. The check is therefore pure host-side arithmetic on the symlink
target — no probe container — and the engine fails with a reason naming the
link, where it lands, and what to do.

An earlier draft ran an `ls -Ld` probe inside the container to decide this. It
was wrong: `ls -Ld /project/lib` *succeeds*, because Docker creates the escaped
path and the link resolves — the failure is solc's allowed-path check, one layer
further in. Worth knowing if anyone reconsiders this.

Parser and `normalise()` are untouched, as briefed.

## Tests

`cli/src/engines/blocksec.test.ts`, 33 tests, no Docker. Argument builder
(platform, entrypoint bypass, flag/image ordering, `--network none`, the
positional target), mount rendering, solc cache paths and version validation,
`list.json` resolution, cache-file validation including the HTML-error-page case,
remapping/`libs` parsing, and the symlink-escape detector plus its failure text.

`make test` passes. Run: `cd cli && node --test dist/engines/blocksec.test.js`.

## Demo

`docs/hackathon/evidence/blocksec-corroboration.md` has the commands and output.
Short version: on `harness/src/hooks/FeeHooks.sol:SkimmingFeeHook` both engines
run and BlockSec correctly finds nothing (`✓ blocksec ok`, not `skipped`); on
`UnvalidatedCallback.sol` in a copy of the harness project, BlockSec's
`UniswapPublicHook` and our `hookrisk-unprotected-callback` land on the same two
functions at lines 57 and 71.

## For the integrator

**1. The README "Known limits" bullet is now wrong.** Replace:

> - **The BlockSec container path is unit-tested but has not been exercised
>   end to end.**

with:

> - **BlockSec HookScan needs three things the published image does not give
>   you.** It is `linux/amd64` only (hookrisk always passes `--platform`), its
>   entrypoint cannot start under Docker Desktop (hookrisk bypasses it), and it
>   ships solc 0.8.14–0.8.24 while v4-core pins 0.8.26 (hookrisk downloads and
>   mounts the right compiler, caching it under `~/.cache/hookrisk/solc/`; the
>   container itself stays `--network none`). One shape still does not work: a
>   `lib/` symlinked outside the project root, as `corpus/lib` is — the engine
>   detects it and fails loudly rather than reporting an empty scan. See
>   [docs/hackathon/evidence/blocksec-corroboration.md](docs/hackathon/evidence/blocksec-corroboration.md).

The README's sample output at line ~22 (`✓ blocksec ok`) is now truthful and
needs no change.

**2. One line in `cli/src/engines/dedupe.ts` blocks corroboration.** Not my
file, so not touched. `groupKey()` prefers a function selector over a function
name:

```ts
if (f.function?.selector) return `${f.ruleClass}|${file}|${f.function.selector}`;
if (f.function?.name)     return `${f.ruleClass}|${file}|fn:${f.function.name}`;
```

HookScan reports name **and** selector; the Slither engine reports name only. So
the two engines key differently on the same defect and it never merges — the
demo above produces 5 findings and `corroboratedFindings: 0` instead of 3 and 2.

Fix: swap the two clauses (name first, selector as fallback). It cannot regress
anything — a name-only finding and a selector-only finding already fail to group
today, and every current engine emits a name. I applied exactly that swap
locally, re-ran demo 2, got `2 corroborated across engines` and
`confidence: high` on both merged findings, then reverted it. The before/after
JSON is in the evidence doc.

Alternatively `slither.ts` could populate `function.selector` — it already has
the selector, it prints it in the finding description. Either fix works; the
`dedupe.ts` one is more robust because it does not depend on every future engine
computing selectors.

**3. `hookrisk.toml` still ships `blocksec = false`** in `harness/`, `corpus/`
and the `hookrisk init` template. That is the right default — pulling a 1.2GB
third-party image should stay an explicit choice — but it means the demo needs a
config with the flag flipped. The evidence doc shows the one-line `sed`.
