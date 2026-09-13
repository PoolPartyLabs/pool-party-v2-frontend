# Notes P — four static checks from the Hacken / HookGuard research

Agent P owned `detectors/`, `corpus/src/**`, the `test-corpus` target,
`schema/engine-metadata.schema.json`, `docs/DETECTORS.md` and this file.
Nothing under `cli/`, `harness/`, `README.md` or `HACKATHON.md` was touched.

## What changed

Four detectors, re-implemented from the *ideas* in
`research/hacken.md` and `research/hookguard.md` at hookrisk's fidelity
(SlithIR, override resolution, project-source anchoring); no code was taken
from either source.

| Rule | Argument | Class | Severity | Fires when |
|---|---|---|---|---|
| HS-03 | `hookrisk-admin-surface` | `admin-surface` | High / Medium | an external mutator writes a scalar the callbacks read (or calls `updateDynamicLPFee`) with no caller check at all (High); the same, owner- or role-gated (Medium) |
| HS-05 | `hookrisk-external-call-in-swap-path` | `external-call-in-swap-path` | Medium | before/afterSwap reach a call to something that is not the PoolManager, a library, or the pool's own currencies; one finding per destination with `metrics: {destination, isStatic, unhandled}` |
| HS-06 | `hookrisk-unbounded-dynamic-fee` | `unbounded-dynamic-fee` | Medium | `updateDynamicLPFee(...)` or a `beforeSwap` `lpFeeOverride` (flag on the chain) whose value's provenance — through calls, setters, struct fields, `abi.decode` — is never compared to a constant/immutable, masked, validated or clamped |
| HS-02 (3rd case) | in `hookrisk-flag-divergence` | `flag-implementation-divergence` | Medium | a returns-delta flag is declared and the callback returns `0`/`ZERO_DELTA` on every (fully lifted) path |

Shared primitives added to `utils/hook_analysis.py`: `access_guard` /
`guard_kind` (structural access control: sender-vs-authority comparison, or
a role lookup keyed by the sender that decides a branch — this is what
recognises `AccessControl` without naming it), `entry_point_mutators`,
`callback_read_state`, `state_variables_written_by`, `calls_named_in`,
`classify_destination` / `third_party_calls`, `returned_values`
(follows `return _beforeSwap(...)` into the overridden delegate),
`definition_of`, `fully_lifted` (refuses to reason over "every path" of a
function Slither did not fully lift — HR-E205 made the zero-delta check
accuse OpenZeppelin's AntiSandwich).

Profile: `hasOwnerOnlyFunctions` now also recognises `AccessControl`
(StablePairHook reports `true`); new metric
`externalCallsInSwapPathThirdParty` next to the raw count.
`HookriskDetector._report` gained `impact=` so HS-03 can emit both
severities under one rule class; the CLI reads the per-result field.

Schema: `metrics` now has two shapes keyed by `dependentRequired`
(`callbacksImplemented` → the profile metrics; `destination` →
`isStatic` + `unhandled`); `externalCallsInSwapPathThirdParty` is a
property but deliberately **not** yet dependent-required (see Integrator).
Enum gains `unvalidated-pool-key` and `callback-selector-mismatch` for
agent H's harness probes. The Python schema checker learned
`dependentRequired`.

Corpus: `good/AdminHook.sol` moved to `bad/AdminSurface.sol` (an owner-only
fee setter is Medium under the contract, so it cannot live in `good/`); new
`bad/DynamicFee.sol`, `bad/ExternalCall.sol`, two contracts appended to
`bad/FlagDivergence.sol`; new `good/BoundedFeeHook.sol` with the four
negative controls (clamped fee, validated fee, cosmetic owner, pool-only
calls). `bad/` now imports OpenZeppelin's `BaseOverrideFeeMock` as shipped:
HS-03 High and HS-06 fire on it, anchored on the project contract.

Makefile: the bad gate requires a High **and** a Medium (three of the new
checks report at Medium; a High-only gate would not notice them going
silent). Also fixed a pre-existing failure in `detectors/tests` (the
disabled-callback wording changed in 81de757; the assertion had not).

## How to demo

```bash
make test-corpus                      # 3 gates, 35 detector tests
cd corpus && ../.venv/bin/slither src/bad/DynamicFee.sol \
  --detect hookrisk-unbounded-dynamic-fee,hookrisk-admin-surface --exclude-dependencies
#  4 HS-06 (owner-set, hookData, oracle, OZ mock); silent on BoundedOwnerFeeHook
#  HS-03 High on the OZ mock's setFee, Medium on the owner-only setters
```

Gotcha that cost 20 minutes: Slither refuses to overwrite an existing
`--json <file>` and says so only on stderr. Use a fresh path per run.

## Real-world check (full plugin, `--exclude-dependencies`, target file only)

| Hook | Before | After |
|---|---|---|
| `cork-hook` (`CorkHook`) | HS-01 ×2, HS-02 ×1, profile `hasOwnerOnlyFunctions: true`, `externalCallsInSwapPath: 5` | + HS-03 Medium ×2 (`updateBaseFeePercentage`, `updateTreasurySplitPercentage`, both writing the pool config `beforeSwap` reads); + HS-05 ×3 (`forwarder` state-changing unhandled, `sender` flash-swap callback, a static read on the config contract); third-party count 5; HS-06 silent (Cork takes its fee through a returns-delta, never sets an LP fee). `transferOwnership`/`renounceOwnership` were reported in a first pass and are now excluded as the guard's own bookkeeping |
| `v4-hooks-public-stablepair` (`StablePairHook`) | `hasOwnerOnlyFunctions: false` (the AccessControl miss the research note called out) | `hasOwnerOnlyFunctions: true`; HS-03 Medium on `initializePool` (`onlyRole`, writes the fee configuration the callbacks read); nothing else new |
| `oz-antisandwich-mock` (`AntiSandwichMock`) | INFO only | INFO only on the target. Elsewhere in the repo: HS-03 High on the fee mocks' unguarded `setFee`, HS-06 on `BaseDynamicFee`/`BaseOverrideFee` (the mocks really are unbounded), HS-05 on the re-hypothecation mocks' ERC-4626 yield source — all correct; a first pass also flagged user-facing `addLiquidity`/`removeReHypothecatedLiquidity` through ERC20's `from == address(0)` check, fixed by requiring an authority on the other side of the comparison |
| `v4-template-counter` (`Counter`) | INFO only | INFO only |

## Caveats

- HS-03's unguarded shape only counts non-mapping state (a limit-order book's
  `placeOrder` writes callback-read mappings and is legitimately open). An
  open whitelist or a per-PoolId config mapping written by anyone is missed.
  Unguarded value moves are not reported (a user `withdraw` looks the same).
- HS-05 treats an ERC-20 call whose address is not derived from `key` in the
  same function as third-party even if it is a pool token cached in storage.
  Low-level calls: `unhandled` means "not inside try"; the success flag is
  not analysed.
- HS-06 does not accept a comparison against a mutable state variable as a
  ceiling, and does not look for rate limits. `Math.min(fee, MAX)` counts
  only when an argument is fixed.
- The zero-delta case is silent on partially lifted delegates by design;
  AntiSandwich at the pinned OZ commit is one (`HR-E205` in the CLI).
- Ownership/role bookkeeping is excluded by name hints (`owner`-like address
  variables, names containing `role`) — the weak direction: a miss adds a
  spurious Medium, never hides a fee setter.

## Integrator

- `cli/src/types.ts` `RuleClass`: no new names are needed for P (the three
  classes already exist). Agent T adds them to `IMPLEMENTED_CLASSES` and the
  `DIMENSION_RULES` per the shared contract; HS-05's `metrics.isStatic` is
  the "1 for a static read / 2 otherwise" input, and HS-03's per-result
  `impact` (High = unguarded, Medium = owner-only) is the
  `autonomousParameterUpdates` 2/1 input. `hook-profile.hasOwnerOnlyFunctions`
  now covers AccessControl.
- `schema/engine-metadata.schema.json`: `externalCallsInSwapPathThirdParty`
  is always emitted but not in `dependentRequired`, because
  `cli/src/engines/slither.test.ts` builds profile fixtures with the original
  seven metrics and Ajv would drop them (9 CLI tests went red when it was
  required). Once those fixtures carry the metric, add it to the
  `callbacksImplemented` list in `dependentRequired` — one line — and the
  contract is strict again. Snippet:
  ```json
  "callbacksImplemented": ["callbacksDeclared", "stateWritesInCallbacks", "externalCallsInSwapPath", "externalCallsInSwapPathThirdParty", "internalFunctionsReachableFromCallbacks", "usesReturnsDelta", "hasOwnerOnlyFunctions"]
  ```
- `cli/src/engines/slither.ts` reads `hookrisk.metrics` for the profile only;
  HS-05's `metrics` block (`destination`, `isStatic`, `unhandled`) is new on
  a non-classification finding. If the manifest schema's `findings[].metrics`
  mirrors the profile shape with `additionalProperties: false`, agent T must
  extend it or a real scan fails HR-E501 — `make test` does not run one.
- `docs/SCORING.md` "External dependencies: needs HS-05 (not implemented)"
  and the dimension table are stale once T lands the rules; not edited here
  (not owned).
