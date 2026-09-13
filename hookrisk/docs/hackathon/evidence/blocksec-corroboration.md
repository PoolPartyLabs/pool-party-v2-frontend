# BlockSec HookScan, exercised end to end

The README used to carry this under Known limits:

> **The BlockSec container path is unit-tested but has not been exercised
> end to end.**

It has now. This page is the record: the exact commands, the exact output, and
the three things that had to be fixed before the published image would produce a
single finding.

Machine: Apple Silicon (arm64), macOS 25.6, Docker Desktop 29.7.2,
image `futuretech6/hookscan@sha256:af7fc9c3528d`.

---

## What was wrong

The adapter's invocation could not have worked on any machine, and on this one
it failed three times over.

**1. The image is `linux/amd64` only.**

```
$ docker pull futuretech6/hookscan
no matching manifest for linux/arm64/v8 in the manifest list entries
```

Every invocation now carries `--platform linux/amd64`
(`HOOKRISK_BLOCKSEC_PLATFORM` overrides it; empty omits the flag). `probe()`
puts the same flag in the pull command it suggests, so the remediation it prints
is one a user can actually paste.

**2. The image's entrypoint dies before the analyser starts.**

`/entrypoint.sh` reads the uid/gid of the mounted `/project` and creates a user
from them:

```bash
HOST_UID=$(stat -c "%u" $PROJECT_PATH)
HOST_GID=$(stat -c "%g" $PROJECT_PATH)
groupadd -g $HOST_GID $SCANNER && useradd -u $HOST_UID -g $HOST_GID $SCANNER
```

Under Docker Desktop the mount is owned by uid 0, so `groupadd -g 0` fails with
`GID '0' already exists`, `chown` fails, and the trailing `su scanner` never
runs. The container exits having printed only its `arg list: ...` banner — which
is exactly the message the old adapter reported:

```
✗ blocksec   failed  could not parse HookScan output: arg list: --base-path /project ...
```

The adapter now bypasses it with `--entrypoint python` and builds the argument
vector the entrypoint would have built. Nothing is lost: the user-creation dance
existed to keep output files owned by the host user, and HookScan writes none.

**3. The image ships solc 0.8.14 – 0.8.24. v4-core pins 0.8.26.**

```
$ docker run --rm --platform linux/amd64 --entrypoint ls futuretech6/hookscan /solc
v0.8.14  v0.8.15  v0.8.16  v0.8.17  v0.8.18  v0.8.19
v0.8.20  v0.8.21  v0.8.22  v0.8.23  v0.8.24
```

So *every* current hook fails to compile inside the image as published. The
adapter now fetches the exact linux-amd64 static build from
`binaries.soliditylang.org` — the filename comes from the official `list.json`,
because the `+commit.8a97fa7a` suffix is not derivable — caches it under
`~/.cache/hookrisk/solc/<version>/solc` (`HOOKRISK_CACHE_DIR` overrides the
root), and mounts it read-only at `/solc/v<version>/solc`.

The download happens **on the host**. The analysis container still runs
`--network none`.

---

## Demo 1 — a guarded hook: both engines run, both stay silent

```bash
cd harness && forge build
# harness/hookrisk.toml ships blocksec = false; this config is the same file
# with the flag flipped, so the repo is not modified to run the demo.
HOOKRISK_SLITHER_BIN=../.venv/bin/slither \
  node ../cli/dist/cli.js scan src/hooks/FeeHooks.sol:SkimmingFeeHook \
    --config /tmp/blocksec-on.toml --skip-dynamic --no-gate --verbose
```

Cold cache, so the compiler download is visible:

```
  hookrisk: slither src/hooks/FeeHooks.sol:SkimmingFeeHook
  hookrisk: 2 finding(s)
  blocksec: image has no solc 0.8.26 (image ships 0.8.14, 0.8.15, 0.8.16, 0.8.17,
            0.8.18, 0.8.19, 0.8.20, 0.8.21, 0.8.22, 0.8.23, 0.8.24);
            downloading the linux-amd64 build from
            https://binaries.soliditylang.org/linux-amd64 to
            ~/.cache/hookrisk/solc/0.8.26/solc
  blocksec: solc 0.8.26 cached (15434456 bytes)
  blocksec: docker run futuretech6/hookscan (src/hooks/FeeHooks.sol:SkimmingFeeHook)
  blocksec: 0 finding(s)

MEDIUM risk  9/33  (undetermined: up to 18/33)

  findings    2 info
  ✓ hookrisk   ok
  ✓ blocksec   ok
```

Zero BlockSec findings is the **correct** answer: `SkimmingFeeHook` guards its
callbacks. What matters is `✓ blocksec ok` rather than `skipped` or `failed` —
the engine looked and found nothing, which is a different claim from nobody
having looked. On a warm cache the line becomes
`blocksec: mounting cached solc 0.8.26 at /solc/v0.8.26/solc` and the whole
engine takes ~1.5s under emulation.

Manifest excerpt:

```json
{
  "engine": "blocksec",
  "displayName": "BlockSec HookScan",
  "version": "futuretech6/hookscan@sha256:af7fc9c3528d",
  "status": "ok",
  "findingCount": 0,
  "durationMs": 2985,
  "upstream": {
    "url": "https://github.com/blocksecteam/hookscan",
    "license": "AGPL-3.0"
  }
}
```

## Demo 2 — an unguarded hook: two engines, same two callbacks

The corpus project cannot be used directly — its `lib/` is a symlink (see
[the symlink section](#the-symlinked-lib-failure-path)) — so the fixture is
copied into a throwaway copy of the harness project, which has a real `lib/`.

```bash
cp -R harness /tmp/e-blocksec/proj
cp corpus/src/bad/UnvalidatedCallback.sol /tmp/e-blocksec/proj/src/
sed 's/^blocksec = false/blocksec = true/' harness/hookrisk.toml \
  > /tmp/e-blocksec/proj/hookrisk.toml

cd /tmp/e-blocksec/proj && forge build
HOOKRISK_SLITHER_BIN=<repo>/.venv/bin/slither \
  node <repo>/cli/dist/cli.js scan src/UnvalidatedCallback.sol:UnvalidatedCallback \
    --skip-dynamic --no-gate --verbose
```

```
  hookrisk: slither src/UnvalidatedCallback.sol:UnvalidatedCallback
  hookrisk: 3 finding(s)
  blocksec: mounting cached solc 0.8.26 at /solc/v0.8.26/solc
  blocksec: docker run futuretech6/hookscan (src/UnvalidatedCallback.sol:UnvalidatedCallback)
  blocksec: 2 finding(s)

  ✓ hookrisk   ok
  ✓ blocksec   ok
```

Two independently-built analysers, one working on solc's AST and SlithIR and the
other on the Yul CFG, land on **the same two functions at the same two lines**:

| line | function | hookrisk | BlockSec |
|---|---|---|---|
| 57 | `beforeSwap` | `hookrisk-unprotected-callback` | `UniswapPublicHook` |
| 71 | `afterSwap`  | `hookrisk-unprotected-callback` | `UniswapPublicHook` |
| 36 | (contract)   | `hookrisk-flag-divergence` | — |

That is the multi-engine design doing the thing it exists for. It also matches
the fixture's stated expectation exactly: HS-01 fires on `beforeSwap` and
`afterSwap` and stays silent on the correctly-guarded `beforeAddLiquidity`.

### The reconciliation bug this demo found

With the tree as committed on this branch, those four findings do **not** merge:

```
  findings    5 high
  coverage.corroboratedFindings: 0
```

The cause is one line in `cli/src/engines/dedupe.ts`, which this branch does not
own. `groupKey()` prefers a function *selector* over a function *name*:

```ts
if (f.function?.selector) return `${f.ruleClass}|${file}|${f.function.selector}`;
if (f.function?.name)     return `${f.ruleClass}|${file}|fn:${f.function.name}`;
```

HookScan reports both a name and a selector; the Slither engine reports only a
name. So blocksec keys on `…|0x575e24b4` and hookrisk on `…|fn:beforeSwap`, and
one defect becomes two uncorroborated findings. Swapping those two clauses —
name first, selector as the fallback — is the whole fix, and it cannot regress
anything, because a name-only finding and a selector-only finding already fail
to group today.

Verified by applying exactly that swap locally and re-running demo 2:

```
  findings    3 high
            2 corroborated across engines
```

```json
{
  "coverage": { "corroboratedFindings": 2 },
  "findings": [
    {
      "ruleClass": "unprotected-hook-callback",
      "severity": "high",
      "confidence": "high",
      "location": { "file": "src/UnvalidatedCallback.sol", "line": 57, "endLine": 66 },
      "function": { "name": "beforeSwap" },
      "evidence": [
        "UnvalidatedCallback.beforeSwap(...) is an IHooks callback (0x575e24b4) that never compares msg.sender against poolManager. Anyone can call it with an arbitrary PoolKey and arbitrary hookData.",
        "BlockSec HookScan: no constraints on callers of hook functions (pool manager only)"
      ],
      "engines": [
        { "engine": "hookrisk", "nativeRule": "hookrisk-unprotected-callback", "severity": "high", "confidence": "high" },
        { "engine": "blocksec", "nativeRule": "UniswapPublicHook",             "severity": "high", "confidence": "high" }
      ]
    }
  ]
}
```

`confidence: high` on a merged finding is not a copy of either engine's rating —
it is `dedupe.ts` promoting on cross-foundation agreement.

The patch was reverted before committing: `dedupe.ts` belongs to another branch.
The integrator applies it there.

---

## The symlinked `lib/` failure path

`corpus/lib` is a symlink to `../harness/lib`, kept deliberately (the reason is
in `corpus/foundry.toml`). Only the project root is bind-mounted, so that target
lands at `/harness/lib` inside the container — outside the mount.

Binding the realpath over `/project/lib` does not fix it. The runtime resolves a
bind-mount destination *through* the symlink, so the files appear at the escaped
path rather than replacing the link, and solc then rejects every import:

```
Error: Source "lib/v4-core/src/interfaces/IHooks.sol" not found:
File outside of allowed directories.
The following are allowed: "/project", "/project/src/bad", "lib/v4-core", ...
```

HookScan builds its own solc command line, so hookrisk cannot widen
`--allow-paths` to compensate. The engine therefore detects the escape on the
host — no probe container, purely from the symlink target — and **fails**:

```bash
cd corpus && node ../cli/dist/cli.js scan src/bad/UnvalidatedCallback.sol:UnvalidatedCallback \
  --config /tmp/blocksec-on.toml --skip-dynamic --no-gate
```

```
  ✓ hookrisk   ok
  ✗ blocksec   failed  the lib symlink cannot be followed inside the container:
                       lib -> ../harness/lib (lands at /harness/lib). Only
                       <repo>/corpus is mounted at /project, so solc resolves those
                       imports to a path outside its allowed directories and compiles
                       nothing. Point the engine at a project whose library directory
                       is real — copy the project, or replace the symlink with the
                       directory it points at.
```

This is the point of the whole exercise. A container that compiles nothing
returns `{"detection_results": []}`, and an adapter that took that at face value
would print `✓ blocksec ok — 0 findings` on a hook with two unguarded callbacks.
A tool that reports nothing looks exactly like success.

---

## Reproducing from scratch

```bash
make setup
docker pull --platform linux/amd64 futuretech6/hookscan   # ~1.2GB, once

# unit tests (no Docker)
cd cli && node --test dist/engines/blocksec.test.js

# demo 1
cd harness && forge build
sed 's/^blocksec = false/blocksec = true/' hookrisk.toml > /tmp/blocksec-on.toml
HOOKRISK_SLITHER_BIN=../.venv/bin/slither \
  node ../cli/dist/cli.js scan src/hooks/FeeHooks.sol:SkimmingFeeHook \
    --config /tmp/blocksec-on.toml --skip-dynamic --no-gate --verbose
```

Knobs: `HOOKRISK_BLOCKSEC_IMAGE`, `HOOKRISK_BLOCKSEC_PLATFORM`,
`HOOKRISK_CONTAINER_RUNTIME` (podman works unchanged), `HOOKRISK_CACHE_DIR`.
