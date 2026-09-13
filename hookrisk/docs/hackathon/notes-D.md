# Agent D — TypeScript static engine: reconciliation, coverage, failure reasons

Scope: `cli/src/types.ts`, `cli/src/engines/{slither,dedupe}.ts`,
`cli/src/scoring/{derive,score}.ts`, `cli/src/sarif.ts`, `cli/src/errors.ts`,
`docs/SCORING.md`, plus tests. Nothing outside that list was touched; the
cross-file changes this work needs are listed at the end.

The theme of every change below is the repo's own principle: a tool that
reports nothing looks exactly like success, so every silent path had to be
made to speak.

## What changed

### 1. `--json -` was eating Slither's diagnostics (root cause of two bugs)

`SlitherEngine` asked Slither for JSON on stdout. Slither implements that with
`StandardOutputCapture.enable(True)`, which replaces *both* `sys.stdout` and
`sys.stderr` with a buffer that is only flushed after a clean run.

- On a compile failure crytic-compile raises `InvalidCompilation`, which is not
  a `SlitherException`, so it escapes Slither's `try`, the buffer is never
  flushed, and the process exits 1 with **zero bytes on both streams**. That is
  the `could not parse Slither output: ` with nothing after the colon seen on
  ref-fee-hook. There was nothing to parse — the adapter could not have done
  better without changing the invocation.
- On a *successful* run the same capture swallowed every
  `Impossible to generate IR for …` line. `collectUncovered` was correct and
  tested, and had never once seen a line from the real CLI. The pre-fix
  AntiSandwich manifest says `uncoveredFunctions: []` while Slither logged
  three; every HR-E205 warning the docs describe was unreachable.

The engine now writes the report to a temp file (`--json <path>`), reads both
streams, and cleans up. Verified on the pre-fix clones:

| repo | before | after |
|---|---|---|
| ref-fee-hook | `failed  could not parse Slither output: ` | `failed  HR-E202 …: Error (7920): Identifier not found or not unique. --> src/RefHook.sol:144:59:` |
| oz-antisandwich-mock | `uncoveredFunctions: []` | 3 entries (`ReHypothecationHook._resolveHookDelta` and two mocks), HR-E205 banner in the summary |

`errors.ts` gained `describeFailure(output, fallback)`: catalogue classification
(existing `classify`) plus the most informative line — a numbered solc
diagnostic with its `-->` pointer when there is one, otherwise the last line
that is not traceback scaffolding — falling back to the last three non-empty
lines, and to a caller-supplied sentence when there is no output at all. The
contract is *never empty*, and `slither.test.ts` pins the empty-streams case
with the exit code in the message.

### 2. Reconciliation: keys were both too loose and too tight

`groupKey()` and `makeFindingId()` keyed on class + file + line (or function).

- **Too loose.** HS-02 anchors every divergent permission on the contract
  declaration, so Orbital's two divergences became one finding (the verbose
  log said "3 finding(s)", the manifest had 2, nothing explained the gap).
  On OpenZeppelin's `BaseHookMockReverts` it is nine into one. `Finding` now
  carries an optional `discriminator` (contract: HS-02 sends the permission
  field, HS-01 the callback name); `normalise()` reads it from
  `result.hookrisk.discriminator`; it is part of the group key and, when
  present, of the id. Ids of findings without one are unchanged, so existing
  SARIF fingerprints do not all re-raise.
- **Too tight.** hookrisk knows a callback by *name* (SlithIR), BlockSec by
  *selector* (Yul CFG). Keyed on the raw value they could never agree on an
  HS-01 — the one class both engines cover, and the whole point of running two
  engines. `dedupe.ts` now holds the ten IHooks selectors (read from the pinned
  `harness/out/IHooks.sol/IHooks.json`, not typed from memory) and resolves
  `beforeSwap`, `_beforeSwap` and `beforeSwap(address,…)` to `0x575e24b4`
  before keying. `normalise()` also attaches the selector to HS-01 findings so
  ids line up across engines when the lines do.
- **Visibility.** `mergeEngineResults(results, log?)` logs one line per
  collapsed bucket — corroborated across foundations, reported twice by one
  engine, or two engines sharing a foundation — and a totals line, and returns
  `stats.merges` for the manifest. `cli.ts` does not pass `log` yet (not my
  file); see open items.

Tests: hookrisk HS-01 (name) + BlockSec UniswapPublicHook (selector) must
corroborate; two HS-02s on one contract with different discriminators must stay
separate; the discriminator-less shape still collapses but is now logged.

### 3. "Engine ran" is not "engine looked"

Five legacy hooks (2023 `getHooksCalls()` ABI) were scored
`complexity: measured 0 / Pass-through only; no hook state` because Slither
ran cleanly over contracts the detectors never recognised as hooks.

`derive.ts`:

- `enginesThatLooked()` replaces the `status === 'ok'` test. An engine counts
  only if it ran **and** did not disclaim the target — via the new
  `EngineResult.targetCoverage` (which `slither.ts` sets from an
  `unsupported-hook-abi` finding on the target) or the classification itself.
  The reason travels into the dimension's evidence string.
- Complexity can no longer be `measured: 0`. `DimensionRule.unmeasuredWhenSilent`
  says why: HS-01/HS-02 only ever set a floor of 1, and nothing hookrisk runs
  can tell a pass-through hook from a well-written complex one. Declared
  values still win. trading-days before/after: 6 → 7 unmeasured dimensions,
  upper bound 23 → 28; the total (3/33) is unchanged because that 0 never
  counted for anything except the false bracket label.

Note the "analysed zero hook contracts" half of the brief is only covered
through `unsupported-hook-abi` — Slither's JSON carries no per-contract
"I looked at this" signal. See open items.

### 4. Two new rule classes

`callback-intentionally-disabled` and `unsupported-hook-abi` in `RuleClass`,
`CLASS_COVERAGE` (hookrisk-only), `IMPLEMENTED_CLASSES` (they are emitted, and
appear in no `raisedBy`, so listing them can never justify a measured 0 —
reasoning is in the comment), and SARIF `RULE_HELP`. `types.ts` also exports
`CLASSIFICATION_CLASSES` / `isClassification()` so the gate, scorer and
renderers share one list instead of each hardcoding `custom-accounting`.

### 5. Attribution transparency

`partitionByTarget()` counts dropped findings per file; the verbose log names
them (`19 finding(s) in other files … BaseHookMock.sol (10), …`) and
`EngineResult.unattributed` carries the list for the manifest.

## How to demo

```sh
make setup && make test                      # 72 CLI tests, 16 suites

# The failure reason (needs a hook that does not compile; ref-fee-hook clone):
HOOKRISK_SLITHER_BIN=$PWD/.venv/bin/slither node cli/dist/cli.js scan \
  src/RefHook.sol:Counter --root <ref-fee-hook> --skip-dynamic --no-gate --verbose
#   ✗ hookrisk   failed  HR-E202 …: Error (7920): Identifier not found or not unique. --> src/RefHook.sol:144:59:

# Coverage that used to be invisible (OpenZeppelin uniswap-hooks clone):
HOOKRISK_SLITHER_BIN=$PWD/.venv/bin/slither node cli/dist/cli.js scan \
  src/mocks/general/AntiSandwichMock.sol:AntiSandwichMock --root <uniswap-hooks> --skip-dynamic --no-gate --verbose
#   hookrisk: 3 function(s) could not be lifted to IR and were not analysed (HR-E205)
#   hookrisk: 19 finding(s) in other files, not attributed to this target: src/mocks/base/BaseHookMock.sol (10), …

# Silence is not zero (any hook with no HS-01/HS-02 finding, e.g. trading-days):
#   Complexity | — | unmeasured | "Not measured: hookrisk has no complexity metric yet…"

# Unit-level, no Slither needed:
cd cli && node --test dist/engines/slither.test.js dist/engines/dedupe.test.js
```

## Caveats

- `errors/catalog.json` orders HR-E202 before HR-E203 and E202's second
  pattern (`Compilation failed. Can you run build command?`) is crytic-compile's
  generic wrapper for *any* forge failure, so a plain solc error is labelled
  "test path shadows the source path". The solc line in the reason is right;
  the title is not. Not my file; flagged below.
- The Orbital merge log line will not appear until `cli.ts` passes `log`.
- Hookrisk HS-01 ids changed (they now include the callback selector). HS-02
  ids change only when agent C's detector sends a discriminator.

## Cross-file changes needed (not my files)

1. `schema/hook-risk.schema.json` — `findings[].ruleClass` is a closed enum
   with `additionalProperties: false`; add `callback-intentionally-disabled`
   and `unsupported-hook-abi` or the manifest fails HR-E501 the moment agent C's
   detectors fire. Optionally add `discriminator` (string) to the finding
   object and `unattributed` / `targetCoverage` to `engines[]` if agent A
   serialises them.
2. `cli/src/manifest.ts` `evaluateGate`: replace
   `f.ruleClass !== 'custom-accounting'` with `!isClassification(f.ruleClass)`
   (exported from `types.ts`). Also render `stats.merges`,
   `result.unattributed` and `result.targetCoverage` if wanted.
3. `cli/src/cli.ts`: `mergeEngineResults(engineResults, log)` — one argument.
4. `errors/catalog.json`: narrow HR-E202's second pattern or move it to
   HR-E203.
