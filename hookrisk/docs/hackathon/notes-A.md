# Notes A — the CLI/harness bridge

Owner: agent A. Files: `cli/src/harness.ts`, `cli/src/cli.ts`, `cli/src/manifest.ts`,
`cli/src/config.ts`, `cli/src/harness.test.ts`, `cli/src/config.test.ts`,
`schema/hook-risk.schema.json`, `errors/catalog.json`, `docs/INVARIANTS.md`.

## What was wrong

Scanning 14 real hooks with the pre-fix CLI, the dynamic layer ran on exactly
one of them (`v4-template-counter`). The other 13 either skipped for a reason
that was wrong, or — worst — reported success without running:

| Hook | Pre-fix | Cause |
|---|---|---|
| v4-constant-sum | `harness: 0 invariant(s), 0 failed`, status **ok**, no `invariants` key | `setUp()` reverted (hook rejects v4 liquidity); `translate()` ignored the setUp row |
| v4-hooks-public (Uniswap's own repo) | "run `forge build` first" after a successful build | the repo uses `out = 'foundry-out'`; the CLI hard-coded `out/` |
| v2-on-v4 | "constructor takes 0 argument(s) … additional constructor arguments are not supported" | any argc ≠ 1 was refused, with a message written for argc > 1 |
| oz-antisandwich-mock, oz-limitorder-mock, v4-stoploss | "declares no permissions, nothing to compare" | `getHookPermissions()` is inherited, so the source parser found nothing and the CLI equated that with "all false" |
| cork-hook, nft-owners-only, orbital-hook, take-profits-hook, trading-days | skipped, argc 2–4 | no way to supply constructor arguments |

## What changed

**Never `ok` without a run.** `translate()` now reads forge's `setUp()` row. A
failing setUp is a harness *failure*: engine row `failed`, I1/I2/I3
`inconclusive`, and the reason unwraps v4's ERC-7751 `WrappedError` down to the
hook's own revert — `beforeAddLiquidity (0x259982e5) reverted with Error("No v4
Liquidity allowed")` — decoding `Error(string)`, `Panic(uint256)`, otherwise
the selector, and naming the IHooks callback. A report with no invariant rows
at all is also `failed`. Both are `HR-E304`.

**The harness is an engine row.** `engines[]` now carries
`{engine: "harness", displayName: "Differential harness (Foundry)", version: <forge>, status, reason, findingCount: <failed invariants>, durationMs}`.
`coverage.dynamicAnalysisSkipped` is derived from that status (true unless
invariants were actually measured) and `coverage.harnessStatus` is new. The
CLI summary prints the harness row like the other engines plus one
`invariants  I1 passed, I2 passed, I3 passed` line.

**Project config from forge.** `resolveProject()` runs `forge config --json` in
the target root for `out` and `solc`; when `solc` is null (Uniswap's repo), the
version comes from the artifact's `metadata.compiler.version`. It also handles
forge's per-version artifact names (`WETHHook.0.8.26.json`) when a file is
compiled under several compilers. Only if forge itself fails does it fall back
to `out/` + 0.8.26, recorded as `target.projectConfigSource = "fallback"` and
logged. The Slither engine gets its solc version from the same place (the old
regex also missed `solc_version = …`, which v4-constant-sum uses).

**Constructor arguments.** 0 args → empty; 1 `address`/`IPoolManager` → the
`$poolManager` placeholder word (no cast needed); anything else needs
`[harness] constructorArgs` in hookrisk.toml, one string per ABI input.
`$poolManager $currency0 $currency1 $owner $hook` map to the sentinel addresses
of the shared contract; everything else goes verbatim to
`cast abi-encode "constructor(<types from the ABI>)" …`, spawned without a
shell. Count mismatches, cast parse errors and struct arguments each produce a
skip reason naming the ABI types and the config key (`HR-E305`). `[declared]`,
`[gate]`, `[engines]` are untouched; `[harness]` rejects unknown keys.

**Inherited permissions.** `parseDeclaredPermissions()` returning null no
longer skips. The CLI sends `HOOKRISK_FLAGS=0` + `HOOKRISK_RUNTIME_CODE` and a
random `HOOKRISK_RUN_ID`, then reads and deletes
`harness/out/hookrisk-run-<id>.json`. `customCurve` from that record picks I2
vs I2b; `seeded = "hooked-failed"` without a custom curve marks I2/I3
`not-applicable` (I1 still reported); the record lands in the manifest as
`permissions.fromRuntime` + `permissions.harnessRun`. A run that *needed* the
record and got none is a failure. A run that supplied its own flags does not
require the record, so the CLI works against the pre-B harness too.

## How to demo

```bash
make setup && (cd corpus && forge build)

# 1. Ordinary hook, current harness: engine row + invariants line
cd corpus && HOOKRISK_SLITHER_BIN=$PWD/../.venv/bin/slither \
  node ../cli/dist/cli.js scan src/good/CleanHook.sol:CleanHook --skip-static --no-gate --verbose
#   ✓ harness    ok
#   invariants  I1 passed, I2 passed, I3 passed

# 2. The real setUp failure (v4-constant-sum clone from the pre-fix scans):
#    was "0 invariant(s), 0 failed" + status ok; now
#   ✗ harness    failed  harness setUp failed: beforeAddLiquidity (0x259982e5)
#                        reverted with Error("No v4 Liquidity allowed") … (HR-E304)
#   invariants  I1 inconclusive, I2 inconclusive, I3 inconclusive
#   coverage.dynamicAnalysisSkipped = true, coverage.harnessStatus = "failed"

# 3. The unit tests, with real forge --json fixtures
cd cli && node --test dist/harness.test.js dist/config.test.js
```

## Verified against the pre-fix clones (current harness, before agent B)

| Hook | Now |
|---|---|
| corpus `CleanHook` | `✓ harness ok`, I1/I2/I3 passed, `harness` engine row with forge 1.7.1, schema-valid |
| v4-constant-sum | `✗ harness failed — harness setUp failed: beforeAddLiquidity (0x259982e5) reverted with Error("No v4 Liquidity allowed") … (HR-E304)`; I1–I3 `inconclusive`; `dynamicAnalysisSkipped: true` |
| v4-hooks-public `WETHHook` | `foundry-out` found, solc 0.8.26 from artifact metadata; skipped with `constructor takes 2 argument(s) (address _manager, address _weth) … Add [harness] constructorArgs …` |
| v2-on-v4 `V2PairHook` (0 args) | reaches the harness (was refused by the CLI); current harness's constructor call reverts → `failed`, honest |
| oz `AntiSandwichMock` (inherited permissions) | `flags=derived-from-runtime`, runtime code sent (was "declares no permissions" skip); current harness cannot derive → `failed`, honest; becomes a real run once B's harness lands |

## Caveats

- `npm test` runs `node --test dist/**/*.test.js` **unquoted**: `sh` has no
  globstar, so `**` matches one directory level and `dist/config.test.js` /
  `dist/harness.test.js` are never executed by `make test-cli`. Quoting the
  pattern (`node --test "dist/**/*.test.js"`, Node ≥ 21 expands it) fixes it.
  `cli/package.json` is not in my file set; run the two files directly meanwhile.
- The end-to-end path for derived permissions, `hooked-failed`, placeholder
  substitution and the run record needs agent B's harness. Against the current
  harness an inherited-permissions hook now reports `failed` with
  `revert: TwinPools: flags do not form a valid hook address` — honest, and
  strictly better than the old "declares no permissions" skip, but not yet the
  result. `harness/foundry.toml` will need `fs_permissions` write access to
  `./out` for the run record (B's file).
- `cast abi-encode` validates syntax, not semantics: `"3000"` for a `uint24`
  is fine, an address for a `uint24` is rejected, but a wrong-but-well-typed
  value produces a hook that may revert in `setUp` — which now at least says
  which callback and why.
