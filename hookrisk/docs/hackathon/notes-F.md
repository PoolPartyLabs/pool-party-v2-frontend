# Agent F — the engine contract: versioned metadata and the hook profile

Scope: `detectors/` (plugin + tests), `schema/engine-metadata.schema.json` (new),
`cli/src/engines/slither.ts` + test, `cli/src/types.ts`, `docs/DETECTORS.md`,
the `test-corpus` Makefile target. Two files outside that list were touched and
are called out under *Integrator*: one line in `cli/src/scoring/derive.ts` (the
build does not compile without it) and a new corpus fixture.

## What was wrong

The `hookrisk` block the Python detectors attach to every Slither result was
an unversioned dict the TypeScript adapter trusted by shape. A detector that
renamed a key, or a new rule class the CLI had not learned, was dropped in
`normalise()` — silently, with no count and no log line — so a drifted plugin
produced a shorter report that looked clean.

Coverage was inferred from silence. Slither's JSON carries findings and
nothing else, so `slither.ts` decided "the detectors looked at the target"
from the *absence* of an `unsupported-hook-abi` disclaimer. A plugin that
never recognised the contract at all (or one whose detectors were not
registered for that contract) counted as having looked.

Permissions came from a regex over the source file (`parseDeclaredPermissions`
in `harness.ts`), which finds nothing on any hook that inherits
`getHookPermissions()` — three of the fourteen scanned hooks — and the CLI
then had to fall back to the harness's runtime derivation even when the
static engine had the answer.

## What changed

### 1. `schema/engine-metadata.schema.json` — the contract, enforced from both sides

Draft 2020-12, like the manifest schema. `version` is `const "1"`; `ruleClass`
is the closed enum shared with `RuleClass`; `metrics`, `permissions` and
`callbacks` are optional and fully specified (`additionalProperties: false`,
`propertyNames` on permissions, `enum` on callbacks, `minimum: 0` on counts).

- **Python side.** `HookriskDetector._report` writes `version: "1"` and takes
  `metrics=`, `permissions=`, `callbacks=` keyword arguments.
  `detectors/tests/test_corpus.py` validates every block the three corpus
  directories produce with a ~60-line stdlib checker covering exactly the
  keywords the schema uses (`type`, `required`, `properties`,
  `additionalProperties`, `propertyNames`, `items`, `enum`, `const`,
  `minimum`, `minLength`, `uniqueItems`) and **fails on any keyword it does
  not know**, so the schema cannot grow a constraint the Python gate quietly
  stops enforcing. A second test feeds it thirteen malformed blocks (version
  drift, unknown class, bool-as-int, negative metric, unknown permission
  name, duplicate callback, empty discriminator …) and requires each to be
  rejected.
- **TypeScript side.** `slither.ts` compiles the schema once with Ajv 2020
  (already a dependency) and runs every `hookrisk-*` result through
  `metadataErrors()` before `normalise()`. A failing result is dropped with a
  verbose line naming the detector, the anchor and the violated path
  (`hookrisk: dropped a result from hookrisk-flag-divergence on MyHook — …
  /version must be equal to constant …`), and the count is recorded as
  `EngineResult.invalidMetadata`. `normalise()` itself returns `null` on an
  invalid block, so callers that bypass `run` get the same guarantee. An
  unversioned block — what the pre-F plugin emits — is invalid; the CLI and
  plugin must be upgraded together, and the log line says
  `make install-detectors`.

### 2. `hookrisk-hook-profile` — the "I looked at this contract" signal

`detectors/slither_hookrisk/detectors/hook_profile.py`. Rule class
`hook-profile`, INFO, `IS_CLASSIFICATION = True`, one per contract that passes
`is_hook_contract`, anchored on the contract. It carries:

| | |
|---|---|
| `permissions` | `declared_permissions()` — which already followed inheritance via `contract.functions` — normalised to all fourteen `Hooks.Permissions` fields. Absent when the hook declares none. |
| `callbacks` | callbacks whose `classify_callback` verdict is `IMPLEMENTED`. A BaseHook stub and a deliberate revert-guard are both excluded: neither is a path the PoolManager completes. |
| `metrics.callbacksImplemented` / `callbacksDeclared` | as above / callback permissions set to true (returns-delta flags not counted) |
| `metrics.stateWritesInCallbacks` | new helper `state_writes_in()`: one per (node, state variable) across the implemented callbacks and everything they reach, **after override resolution** |
| `metrics.externalCallsInSwapPath` | existing `external_calls_in(swap_path_functions())` |
| `metrics.internalFunctionsReachableFromCallbacks` | reachable implemented functions, modifiers excluded |
| `metrics.usesReturnsDelta` | any returns-delta permission |
| `metrics.hasOwnerOnlyFunctions` | new `owner_only_functions()` |

Two helper changes worth knowing about:

- `reachable_functions(function, contract=None)` now resolves virtual
  dispatch when given the contract. Without that, `BaseHook.beforeSwap`'s
  call to `_beforeSwap` landed on the base's `revert HookNotImplemented()`
  stub, and every metric over the result described the library rather than
  the hook. `swap_path_functions` passes the contract; HS-05, when it lands,
  gets the fix for free.
- `owner_only_functions()` reuses the `guards_pool_manager` walk (body +
  modifiers + internal callees) with an extension for OpenZeppelin's
  `Ownable`, whose check is `owner() != _msgSender()`: both operands are
  results of internal calls, so the comparing node reads neither `msg.sender`
  nor `_owner`. `_compares_via_calls` resolves each operand to what its
  callee reads. Owner-like variables are found by name on `address`-typed
  state, **walking the inheritance chain** because `contract.state_variables`
  omits private inherited variables and `Ownable._owner` is exactly that.
  `manager` is deliberately not an owner hint.

### 3. `slither.ts` — coverage from a positive signal

`scopeOf()` collects every profile's `file:Contract`;
`EngineResult.scope = { analysedContracts, targetAnalysed }` where
`targetAnalysed` requires a profile for exactly `ctx.sourceFile` +
`ctx.contractName` (a same-named contract elsewhere is somebody else's hook).
`coverageOf(findings, name, scope)` keeps `unsupported-hook-abi` as the
overriding negative — the `partial` shape has a profile *and* a disclaimer,
and the disclaimer wins — and otherwise answers from `scope.targetAnalysed`.
`EngineResult.permissions` is the target profile's set. The profile stays in
`findings` as an INFO classification with `permissions` and `metrics` attached
(`Finding` gained both optional fields; `serialiseFinding` in `manifest.ts`
is explicit, so nothing leaks into the manifest until the integrator chooses
to render them).

`types.ts`: `'hook-profile'` in `RuleClass` and `CLASSIFICATION_CLASSES`;
`EngineResult.scope`, `.permissions`, `.invalidMetadata`; `Finding.permissions`,
`.metrics`.

### 4. Deleted

`detectors/slither_hookrisk/utils/diagnostics.py` (imported by nothing) and
the `[tool.setuptools.package-data]` entry for a `data/` directory that never
existed, with its comment about a `make build-detectors` target that does not
exist either. `errors/catalog.json` stays the CLI's catalogue.

### 5. Corpus and gates

`corpus/src/good/AdminHook.sol` (new): `OwnableAdminHook` (OZ `onlyOwner`)
and `HandRolledAdminHook` (`require(msg.sender == admin)`), both clean for
HS-01/HS-02, both must profile `hasOwnerOnlyFunctions: true`.

`detectors/tests`: 29 tests (was 17). Every hook in `good` and `bad` gets
exactly one profile; CleanHook is 2/2 callbacks, ≥1 state write, 0 external
calls, no returns-delta; the OZ subclasses resolve their inherited
permissions; `IntentionalRevertHook` has 0 implemented / 1 declared;
`UnvalidatedCallback` has no `permissions` key; the legacy corpus produces no
profile except for `MixedAbiHook`.

**One deliberate deviation from the brief.** "The legacy corpus gets none"
holds for `LegacyHook` and `LegacyAfterInitializeHook`, which were never
analysed. `MixedAbiHook` (the v2-on-v4 shape) *is* analysed for its
current-ABI callbacks — HS-01 fires on v2-on-v4's `afterSwap` — so it gets a
profile; its `partial` unsupported-ABI finding is what revokes coverage in
the CLI, and `slither.test.ts` pins that precedence. The Makefile legacy gate
now reads "≥1 unsupported-ABI, and nothing but unsupported-ABI or
hook-profile". `DETECTOR_ARGS` includes the new detector; the good gate is
unchanged ("nothing at High or Medium").

## Real-world check

Full plugin, `--exclude-dependencies`, over three scratchpad clones. Cork is
the one that matters: the owner-settable fee HACKATHON.md names is now visible
as `hasOwnerOnlyFunctions: true`, and `callbacksDeclared 4 / implemented 2`
is the HS-02 stub plus the disabled-callback in one line.

| Hook | impl | declared | state writes | ext. calls in swap | reachable | returns-delta | owner-only | callbacks |
|---|---|---|---|---|---|---|---|---|
| v4-template-counter `Counter` | 4 | 4 | 4 | 0 | 4 | false | false | beforeSwap, afterSwap, beforeAddLiquidity, beforeRemoveLiquidity |
| cork-hook `CorkHook` | 2 | 4 | 4 | 5 | 19 | true | true | beforeInitialize, beforeSwap |
| oz-limitorder-mock `LimitOrderHookMock` | 2 | 2 | 6 | 3 | 9 | false | false | afterInitialize, afterSwap |
| oz-limitorder-mock `AntiSandwichMock` | 2 | 2 | 6 | 2 | 9 | true | false | beforeSwap, afterSwap |
| oz-limitorder-mock `BaseHookMockReverts` | 0 | 10 | 0 | 0 | 0 | false | false | — |

The OZ repo yields 16 profiles (one per concrete mock), so the `scope` line
in a verbose scan of `LimitOrderHookMock` reads `analysed 16 hook contract(s)`
and the profile for the *target* is the one that sets `permissions`.

## How to demo

```sh
make test                                   # 41 harness, 184 CLI, 3 gates, 29 detector tests

# The profile, raw:
cd corpus && ../.venv/bin/slither src/good --detect hookrisk-hook-profile --exclude-dependencies --fail-none --json - \
  | jq -c '.results.detectors[] | {c: .elements[0].name, m: .hookrisk.metrics, p: .hookrisk.permissions}'

# The contract, enforced (needs the integrator's schema enum change first — see below):
cd corpus && HOOKRISK_SLITHER_BIN=$PWD/../.venv/bin/slither node ../cli/dist/cli.js scan \
  src/good/CleanHook.sol:CleanHook --skip-dynamic --no-gate --verbose
#   hookrisk: 6 finding(s); analysed 11 hook contract(s); permissions resolved from the profile

# Drift, caught: run an old plugin against the new CLI and every result is
# dropped with `does not satisfy the engine contract (/version …)` and
# `engines[].invalidMetadata` counts them.

cd cli && node --test dist/engines/slither.test.js      # 33 adapter tests
```

## Caveats

- `stateWritesInCallbacks` under-counts writes made through a storage pointer
  (`Checkpoint storage c = _checkpoints[id]; c.x = …`): Slither records those
  against the local reference, not the state variable.
- `hasOwnerOnlyFunctions` recognises comparisons, not role lookups:
  `AccessControl`'s `hasRole(role, msg.sender)` is a mapping read and a
  boolean branch with no `==`. Name-based variable discovery is the weak
  direction on purpose (a miss costs one false "no admin surface", a hit
  scores nothing by itself).
- The end-to-end `hookrisk scan` currently exits with **HR-E501** on every
  hook because `schema/hook-risk.schema.json`'s `findings[].ruleClass` enum
  does not contain `hook-profile`. One-line fix, not my file, first item
  below. `make test` does not run an end-to-end scan, which is why it is green.
- A verbose CLI scan of the corpus reports `7 function(s) could not be
  lifted to IR (HR-E205)`: `AntiSandwichHook._afterSwap` and
  `_getTargetUnspecified` (and the same two on `AntiSandwichMock` and
  `ProductionAntiSandwichHook`) plus `BaseDynamicAfterFee._afterSwap`.
  Pre-existing at this pin and invisible before agent D fixed the stream
  capture; notes-C's "no HR-E205 at this pin" was written against the
  swallowed stderr. It is also the real reason `ProductionAntiSandwichHook`
  profiles `stateWritesInCallbacks: 0` — the function that writes was never
  lifted — which is exactly the case the manifest's uncovered-functions
  banner exists for. Unrelated to this change; noted so nobody chases it as
  a regression.

## Integrator

Exact edits in files I do not own, in order of urgency:

1. **`schema/hook-risk.schema.json`** (agent H) — `findings[].ruleClass.enum`:
   add `"hook-profile"` after `"unsupported-hook-abi"`. Without it every scan
   fails HR-E501. Optionally add to the finding object:
   `"permissions": { "type": "object", "additionalProperties": { "type": "boolean" } }`
   and `"metrics": { "type": "object" }`, and to `engines[]`:
   `"invalidMetadata": { "type": "integer", "minimum": 0 }` and
   `"scope": { "type": "object", "properties": { "analysedContracts": { "type": "array", "items": { "type": "string" } }, "targetAnalysed": { "type": "boolean" } } }`.
2. **`cli/src/scoring/derive.ts`** (agent H) — `CLASS_COVERAGE` needs
   `'hook-profile': ['hookrisk'],`. **Already applied on this branch as a
   single inserted line** because `Record<RuleClass, string[]>` does not
   compile without it; if H's branch adds the same line, take either. Do
   *not* add it to `IMPLEMENTED_CLASSES` unless complexity derivation reads
   it — a profile is a measurement, not a class that clears a dimension.
   Complexity derivation should read `finding.metrics` from the
   `hook-profile` finding whose `location.file`/contract match the target
   (or `EngineResult.scope.targetAnalysed` + the finding), and leave
   complexity unmeasured when there is none.
3. **`cli/src/cli.ts`** (agent I) — take permissions from the static engine
   first:
   ```ts
   const staticResult = engineResults.find((r) => r.engine === 'hookrisk' && r.status === 'ok');
   const permissions = staticResult?.permissions ?? null;   // null → harness derives from runtime code
   if (permissions) permissionsSection.fromStatic = permissions;
   ```
   replacing `parseDeclaredPermissions(readFileSync(...))`. Only when
   `--skip-static` or the engine did not run should the harness's runtime
   derivation be the source. `cli/src/harness.ts` (agent G) can then delete
   `parseDeclaredPermissions` and its `FLAG_BITS`-keyed regex (keep
   `flagsFrom`/`permissionsFrom`).
4. **`cli/src/manifest.ts`** (agent H) — render `result.invalidMetadata`
   (engine row) and `result.scope`; show the profile finding's `permissions`
   as `permissions.fromStatic`.
5. **`cli/src/errors.ts` line 8** (owner: whoever holds errors.ts) and
   **`errors/catalog.json` line 5** — both still name
   `detectors/slither_hookrisk/utils/diagnostics.py`, which no longer exists;
   reword to "the Python detectors report findings only; classification is
   the CLI's". **`.gitignore` line 29** (agent I) — the comment about
   `make build-detectors` copying the catalogue into the package is stale;
   delete the comment and the `detectors/slither_hookrisk/data/` ignore
   under it.
6. **`corpus/src/good/AdminHook.sol`** — new fixture, no owner listed in the
   brief; it is the only test surface for `hasOwnerOnlyFunctions`. Keep it.
7. **`cli/src/sarif.ts`** — `RULE_HELP` is `Record<string, …>` so it compiles,
   but a `hook-profile` finding will render with no help text; add an entry.
