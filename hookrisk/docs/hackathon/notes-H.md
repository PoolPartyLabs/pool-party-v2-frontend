# Notes H — scoring and the gate

Owner: agent H. Files: `cli/src/scoring/{derive,rubric,score.test}.ts`,
`cli/src/config.ts`, `cli/src/config.test.ts`, `cli/src/manifest.ts`,
`cli/src/manifest.test.ts` (new), `schema/framework-rubric.json`,
`schema/hook-risk.schema.json`, `docs/SCORING.md`, `corpus/hookrisk.toml`.
Plus the contract-mandated additions to `cli/src/types.ts` (agent F adds the
same; see Integrator).

The brief: make the score less of a Low-to-High range and the gate a
deliberate choice.

## What changed

### 1. Complexity is measured from evidence, not floored from accusations

Before: HS-01/HS-02 set a floor of 1 when they fired; otherwise complexity was
unmeasured. Every well-written hook — guarded, correctly declared — was
unmeasured, and the tier was a range on all 14 real hooks.

Now `derive.ts` reads the `hook-profile` classification (contract B) for the
target and derives 0–5 from its metrics with a **rule table that lives in the
rubric**, `schema/framework-rubric.json` → `complexity.derivation`
(`interpretation: true`, a rationale per rule pointing at the sentence of the
framework's prose it reads). Highest score first, first match wins:

| Score | `when` |
|---|---|
| 5 | `usesReturnsDelta && externalCallsInSwapPath >= 1 && hasOwnerOnlyFunctions` |
| 4 | `usesReturnsDelta && externalCallsInSwapPath >= 1` |
| 3 | `usesReturnsDelta \|\| externalCallsInSwapPath >= 1` |
| 2 | `stateWritesInCallbacks >= 1 \|\| callbacksImplemented >= 3` |
| 1 | `callbacksImplemented >= 1` |
| 0 | `callbacksImplemented == 0` |

The conditions reuse `evaluateCondition` from `score.ts` (numeric metrics are
its values, boolean metrics its flags), so the rubric has one condition
language rather than two. `loadRubric()` now validates a `derivation`: every
rule inside the dimension's range, every identifier a metric the source
classification carries (`derivation.metrics`), or the rubric refuses to load.

Rules kept:

- **HS-01/HS-02 only raise.** The floor of 1 is applied after the profile
  value, by `max`. A profile at 3 with a divergence finding stays 3; a profile
  at 0 on a contract HS-02 fired on becomes 1.
- **No profile → unmeasured**, with the reason in the evidence. A profile that
  carries no metrics, or whose metrics match no rule (a missing
  `callbacksImplemented`, say), is also unmeasured and says which of the two it
  was — never a default.
- **Declared still wins**, with `hookrisk measured 4; hookrisk.toml declares 2.
  The declaration is lower than the measurement.`
- A measured **0** now exists, and only through a profile with
  `callbacksImplemented = 0`: the engine counted and found none.

`hook-profile` is in `CLASS_COVERAGE` (hookrisk-only), `IMPLEMENTED_CLASSES`
(the comment says why: it feeds a score but is in no `raisedBy`, so its
presence never justifies a 0 by silence) and `RuleClass` /
`CLASSIFICATION_CLASSES` in `types.ts` so the gate can never count it.
`hookProfileOf()` picks the target's profile by `discriminator === contractName`
when a file holds several hook contracts (`DeriveOptions.contractName`,
optional); without a name the first wins and the evidence admits it.
`profileMetrics()` reads `finding.metrics` and falls back to
`engines[].detail.metrics`, because the contract fixes the metric names but
not where agent F's adapter hangs them on `Finding`.

The bracket labels for complexity were rewritten to match what is now
measured ("Callbacks write hook state, or 3+ callbacks", …).

### 2. The gate is a deliberate choice

`config.ts`: `[gate] failOnInconclusive` (boolean, strictly — `"false"` is
rejected rather than read as true; default absent, echoed into the manifest
only when set). `hookrisk init` now writes:

```toml
[gate]
# maxTier = "medium"     # commented out, with the reason
maxSeverity = "high"
failOnPartialCoverage = false
failOnInconclusive = false   # six dimensions have no detector; true is the strict posture
```

`manifest.ts` `evaluateGate` (now exported, tested directly):

| | `failOnInconclusive = false` (default) | `= true` |
|---|---|---|
| measured lower bound above `maxTier` | fails (one failure; the range, if any, is folded into the message) | fails |
| lower within, upper above `maxTier` | passes, `gate.notes[]` names the unmeasured dimensions | fails |
| upper within `maxTier` | passes | passes |

The invariant-failure rule and the severity rule are unchanged and
unconditional. The note is rendered next to the verdict in `HOOK_RISK.md`
(`> ℹ️ tier is undetermined between …`).

`corpus/hookrisk.toml` goes back to `maxTier = "medium"` with
`failOnInconclusive = false`: the corpus now demonstrates the gate gating what
it measured rather than being set to `"high"` to avoid its own coverage.

### 3. Manifest

- `engines[].errorCode` (`^HR-E[0-9]{3}$`) when `status` is `failed`, parsed
  from the reason wherever the engine put it (`errorCodeOf`: Slither leads with
  it, the harness bridge closes with it); `HarnessSummary.errorCode` takes
  precedence when the integrator passes a structured code.
- `ManifestInputs.observations?: HarnessObservations` → `coverage.observations`
  (contract D's ten counters plus optional `sequences`), rendered as one
  sentence under *Analysis coverage* ending "An invariant with no relevant
  observations is reported inconclusive, not passed."
- `findings[].metrics / callbacks / permissions` serialised from the profile
  finding; a **Hook profile** table under *What was assessed* (callbacks,
  each metric with a readable label, declared permissions); the profile is
  *not* listed under *Findings*, since a description with nothing to fix would
  read as a defect there.
- `finding.discriminator` rendered after the rule class:
  `` `unprotected-hook-callback` (`beforeSwap`) · **high** ``.
- Schema: `hook-profile` in the rule-class enum; `metrics`, `callbacks`,
  `permissions` on the finding; `engines[].errorCode`; `coverage.observations`
  (`additionalProperties: false`, all keys listed); `permissions.fromEngine`;
  `gate.failOnInconclusive` and `gate.notes`. `validateManifest` stays strict
  and the tests build a manifest with every new field and validate it, plus one
  that proves an unknown observation key is rejected.

## How to demo

```bash
make setup && make test          # 215 CLI, 41 harness, corpus gates, 17 detector tests

# The rule table, as data
jq '.dimensions[] | select(.id=="complexity") | .derivation' schema/framework-rubric.json

# Every bracket from a synthetic profile, floor and declaration precedence,
# rubric validation of a bad rule, and the gate table:
cd cli && node --test dist/scoring/score.test.js dist/manifest.test.js dist/config.test.js

# The gate on the official template, fresh default config (used to fail on maxTier):
node cli/dist/cli.js init --config /tmp/h/hookrisk.toml
HOOKRISK_SLITHER_BIN=$PWD/.venv/bin/slither node cli/dist/cli.js scan src/Counter.sol:Counter \
  --root <v4-template-counter> --config /tmp/h/hookrisk.toml --skip-dynamic
#   LOW risk 3/33 (undetermined: up to 28/33) … gate passed        exit 0

# Same hook, its own config (maxTier = "medium"): passes, and the manifest says why
#   gate.notes[0] = "tier is undetermined between Low Risk and High Risk; the measured
#   lower bound is within the configured maximum of medium and failOnInconclusive is off …
#   (7 dimension(s) unmeasured: complexity, customMath, …)"
# Add failOnInconclusive = true: exit 2, "… and failOnInconclusive is set".

# Cork with the fresh default: exit 2 on 4 HIGH findings, never on the range.
```

## Verified against evidence (static only, `--skip-dynamic`)

| Hook | Config | Result |
|---|---|---|
| v4-template-counter `Counter` | fresh `init` template | LOW 3/33, up to 28/33, `gate passed`, exit 0, manifest valid |
| v4-template-counter `Counter` | clone's own (`maxTier = "medium"`) | passes with `gate.notes` naming the 7 unmeasured dimensions |
| v4-template-counter `Counter` | same + `failOnInconclusive = true` | exit 2, the failure names the setting |
| cork-hook `CorkHook` | fresh `init` template | MEDIUM 10/33, up to 22/33; exit 2 on `4 finding(s) at or above high` (beforeAddLiquidity:88, beforeInitialize:97, beforeSwap:365, …); discriminators rendered |

Agent F's profile detector is not on this branch, so the profile-driven
complexity is verified through the unit tests (each bracket, floor, declared,
no-profile, no-metrics, no-rule-match, multi-contract file, detail fallback,
bad-rule rejection); on the clones above complexity is still `unmeasured`,
with the evidence now reading "the engine emitted no hook-profile for the
target".

## Caveats

- **Where the profile payload sits on `Finding` is a guess with a fallback.**
  This branch adds `metrics?`, `callbacks?`, `permissions?` to `Finding` and
  reads `metrics` from there or from `engines[].detail.metrics`. If agent F's
  `normalise()` puts it anywhere else, complexity stays unmeasured until the
  integrator adds one line (see below); nothing breaks.
- **`hookProfileOf` disambiguates by `discriminator`.** If agent F sends no
  discriminator on the profile (or something other than the contract name), a
  file with several hook contracts uses the first profile and says so in the
  evidence.
- `coverage.observations` is `additionalProperties: false`. If agent G's
  summed record carries a key outside the ten in contract D plus `sequences`,
  `validateManifest` fails HR-E501 — add the key to the schema rather than
  loosening it.
- `errorCode` is parsed from `reason` for the static engines. A structured
  `EngineResult.errorCode` would be better; `EngineResult` is agent F's type.
- The `5` rule is conjunctive on an owner-only surface. A hook with an admin
  surface but no returns-delta/external call scores by the lower rules; the
  admin surface itself is HS-03's dimension (`admin-surface`), not complexity.

## Integrator

Exact changes in files I do not own.

1. `cli/src/types.ts` — agent F adds `'hook-profile'` too; resolve to one
   entry in `RuleClass` and one in `CLASSIFICATION_CLASSES`. Keep the three
   optional `Finding` fields from this branch (`metrics`, `callbacks`,
   `permissions`) unless F's adapter uses another slot.
2. `cli/src/engines/slither.ts` `normalise()` — where the profile lands. If F
   did not already: after `...(discriminator ? { discriminator } : {}),` add
   ```ts
   ...(meta.metrics ? { metrics: meta.metrics } : {}),
   ...(meta.callbacks ? { callbacks: meta.callbacks } : {}),
   ...(meta.permissions ? { permissions: meta.permissions } : {}),
   ```
   and set `discriminator` to the contract name on `hook-profile` results so
   `hookProfileOf` can pick the target's profile.
3. `cli/src/cli.ts` — `deriveScoringInput({ …, contractName })` (one added
   property; optional, but it is what disambiguates a multi-contract file).
4. `cli/src/cli.ts` — pass `observations` (agent G's summed counts) through
   `buildManifest({ …, observations })`, and if `permissionsSection` should
   carry the engine's set: `permissionsSection.fromEngine = profile.permissions`
   where `profile = findings.find(f => f.ruleClass === 'hook-profile')`.
5. `cli/src/cli.ts` — when agent I's harness bridge exposes a structured code,
   `harness = { …, errorCode }`; until then the code is parsed from the reason.
6. `Makefile` `DETECTOR_ARGS` — append `,hookrisk-hook-profile` once F's
   detector lands (F's/integrator's line; without it the profile is never
   emitted and complexity stays unmeasured).
7. `docs/hackathon/HACKATHON.md` "Honest limits" — the sentence "the default
   `maxTier = "medium"` gate fails the official template" is no longer true;
   and "a real complexity metric" is done on the scoring side, pending F's
   detector.


---

# Notes H, pass 4 — execution probes in the twin-pool harness

Agent H, 2026-09-12. Owned: `harness/`, `cli/src/harness.ts` (+ test),
`cli/src/reconcile.ts` (+ test), `docs/INVARIANTS.md`, this file.

## What changed

Three probes run once per scan, in `GenericHookInvariants.setUp` after the
seed and before the handler exists, against every callback the deployed
hook implements (permission bit set in the word the harness deployed under):

| Probe | Question | Verdicts |
|---|---|---|
| `eoaGuard` | called from `0xBEEF`, does the callback reject a non-PoolManager caller? | `guarded` · `unguarded` · `reverted-other` |
| `selectors` | called as the PoolManager, is the first return word its own selector? | `ok` · `wrong-selector` · `reverted` |
| `exclusivity` | a second pool on the same hook (doubled tick spacing, dynamic-fee retry), first working swap-or-liquidity callback called with *that* key | `rejected` · `accepted` · `not-applicable` + `exclusivityReason` |

Design points, each with a rationale comment in the code:

- **Every probe runs inside `manager.unlock`, and the unlock always reverts**
  (`harness/test/HookProbes.sol`). Callbacks call `take`/`settle`/
  `updateDynamicLPFee`, which need the lock; called cold, a correct fee hook
  reverts `ManagerLocked` and the probe would learn nothing. Inside the
  unlock the call is realistic (it is exactly how Cork's attacker drove
  `beforeSwap`), and ending `unlockCallback` with `revert ProbeOutcome(...)`
  rolls back everything the hook did and carries the result out as the
  revert reason. One unlock per hook call; no snapshot ids. Tests pin that
  the stranger's state write and the second pool are both gone afterwards.
- **`guarded` over-approximates on purpose.** Any revert whose selector is not
  in an explicit v4-core error allowlist (plus `Panic`) counts as the hook's
  own refusal. A false `guarded` loses a finding HS-01 still makes; a false
  `unguarded` would accuse.
- **Exclusivity only drives a callback whose selector verdict is `ok`.** First
  real-world run said `rejected` for v4-constant-sum — because its
  `beforeSwap` reverts on *every* key (no reserves). A revert on the wrong
  key proves nothing when the same call reverts on the right one; now
  `not-applicable` with that reason.
- **The run record gains `probes`** (`TwinPools._probesJson`): only implemented
  callbacks appear; `exclusivityReason` and `selectorReverts` (unwrapped
  revert hex per `reverted` callback) only when present. Existing exact-JSON
  tests are untouched because the object is written only after `_probeHook`.
- **CLI parser is strict** (`parseProbes` in `harness.ts`): unknown verdict,
  unknown callback name, wrong shape → the run record is malformed → harness
  failure, never a clean read. `summariseProbes` adds one clause to the
  verbose harness line.
- **`reconcileLayers` maps the record** exactly per the shared contract, and
  takes a new `sourceFile` input to anchor harness-sourced findings
  (`{file, line: hook-profile line ?? 1}`); the existing seed-revert finding
  now gets the same anchor when `sourceFile` is given. Two cross-layer rules
  beyond the contract: a `reverted` selector verdict on a callback a
  `callback-intentionally-disabled` finding names is suppressed with a note
  (constant-sum's `beforeAddLiquidity` would otherwise be a HIGH for the
  revert the classification just excused); `wrong-selector` is never
  suppressed. Confidence: merge with HS-01 `high`; harness-only unguarded
  `medium`; `wrong-selector` `high`; `reverted` `medium` with the revert in
  the evidence.

Fixtures (`harness/src/hooks/ProbeHooks.sol`): `UnguardedCallbackHook`
(hand-rolled `IHooks`, guarded `beforeSwap`, unguarded state-writing
`afterSwap`), `WrongSelectorHook` (`beforeSwap` returns `afterSwap`'s
selector), `PoolBoundHook` (compares `key.toId()` to the first pool's).
Controls: `HonestFeeHook` (all guarded, `take` inside the unlock is `ok`),
`TrappingHook` (multi-pool → `accepted`), `LineCurveHook` (`reverted` without
reserves, `ok` with them; exclusivity `not-applicable` then `accepted`),
`DynamicFeeHook` (no drivable callback → `not-applicable`). Ten new harness
test contracts / 15 tests in `HarnessValidation.t.sol`; 21 new CLI tests.

Counts: harness 45 → 60 (1 skipped, unchanged); CLI 275 → 296; corpus gates
3/3; detector tests 28/29 — see caveats.

## How to demo

```bash
cd harness && FOUNDRY_PROFILE=scan forge test --match-contract 'Probe|EoaGuard|Selector|Exclusivity' -vv
```

Against a clone (worktree CLI, before the integrator wires the schema, read
the invalid manifest):

```bash
cd <clones>/v4-template-counter/repo
HOOKRISK_SLITHER_BIN=$HR/.venv/bin/slither node $HR/cli/dist/cli.js scan src/Counter.sol:Counter --verbose --out out
#  harness: … probes: eoa guard held on 4 callback(s); selectors ok; exclusivity accepted
#  reconcile: the hook accepted a callback for a second pool; added an unvalidated-pool-key classification
jq '.findings[] | select(.ruleClass=="unvalidated-pool-key")' out/hook-risk.invalid.json
```

## Real-world results (built CLI, this branch)

| Clone | probes line | reconcile |
|---|---|---|
| v4-template-counter (`Counter`) | eoa guard held on 4 callbacks; selectors ok; exclusivity **accepted** | `unvalidated-pool-key` INFO added (Counter validates nothing, as predicted) |
| oz-limitorder-mock | eoa guard held on 2; selectors ok; exclusivity **accepted** | `unvalidated-pool-key` INFO |
| v4-constant-sum (`Counter`) | eoa guard held on 2; selectors: `beforeAddLiquidity=reverted`, `beforeSwap=reverted`; exclusivity **not-applicable** | seed merge as before; `beforeAddLiquidity` revert suppressed (intentionally disabled); `beforeSwap` → `callback-selector-mismatch` HIGH/medium with `Panic(0x11)` in the evidence (no reserves: the hook underflows) |

All three then fail HR-E501: `/findings/N/ruleClass must be equal to one of
the allowed values` — the manifest schema's `ruleClass` enum does not carry
the two new classes yet (integrator). The `probes` object is parsed but not
copied into `permissions.harnessRun` (cli.ts picks fields; integrator).
Harness-sourced findings have `location: null` until cli.ts passes
`sourceFile` (integrator).

## Caveats

- `reverted` under the selector probe is HIGH per the contract but only
  `medium` confidence, and on a reserve-less custom curve it is a
  near-certain false positive (constant-sum above). The revert reason is in
  the evidence. A better rule would downgrade to a classification when
  `seeded: hooked-failed` **and** `customCurve` — I left it as the contract
  says; agent T / the integrator may want to treat `confidence: medium`
  selector findings as non-gating.
- `guarded` cannot distinguish "rejected the caller" from "rejected the
  arguments with the hook's own error before checking the caller".
- Probe arguments are generic (no `hookData`, probe contract as `sender`,
  small exact-input swap, ±6000 ticks). Hooks that need any of those show as
  `reverted`/`reverted-other`.
- `make test` on `feat/hackathon-p0` was already red before my changes:
  `detectors/tests/test_corpus.py:322` expects "harness will observe reverts",
  `disabled_callback.py:130` says "harness records such reverts when it
  runs". Not my files; everything else (harness, CLI, three corpus gates,
  28/29 detector tests) is green.
- Runtime: probes add ~20 calls to `setUp`; the counter scan's harness phase
  was unchanged to the second.

## Integrator

1. `cli/src/types.ts` (agent T): add `'unvalidated-pool-key'` and
   `'callback-selector-mismatch'` to `RuleClass`; add `'unvalidated-pool-key'`
   to `CLASSIFICATION_CLASSES`. Then drop the two `as RuleClass` casts at the
   top of `cli/src/reconcile.ts` (`UNVALIDATED_POOL_KEY`, `SELECTOR_MISMATCH`).
2. `schema/hook-risk.schema.json`: add both names to `findings[].ruleClass`
   enum (and to any `nativeRule`/engine tables if present); otherwise every
   scan with an accepted exclusivity fails HR-E501.
3. `cli/src/cli.ts`, the `reconcileLayers` call: pass `sourceFile`:
   ```ts
   const reconciled = reconcileLayers({
     findings,
     invariants,
     sourceFile,
     ...(outcome?.run ? { runRecord: outcome.run } : {}),
     ...(outcome?.observations ? { observations: outcome.observations } : {}),
   });
   ```
4. `cli/src/cli.ts`, `permissionsSection.harnessRun`: carry the probes, and
   add them to `schema/hook-risk.schema.json` `harnessRun.properties`:
   ```ts
   ...(outcome.run.probes ? { probes: outcome.run.probes } : {}),
   ```
   ```json
   "probes": {
     "type": "object", "additionalProperties": false,
     "required": ["eoaGuard", "exclusivity", "selectors"],
     "properties": {
       "eoaGuard": {"type": "object", "additionalProperties": {"enum": ["guarded", "unguarded", "reverted-other"]}},
       "exclusivity": {"enum": ["rejected", "accepted", "not-applicable"]},
       "exclusivityReason": {"type": "string"},
       "selectors": {"type": "object", "additionalProperties": {"enum": ["ok", "wrong-selector", "reverted"]}},
       "selectorReverts": {"type": "object", "additionalProperties": {"type": "string", "pattern": "^0x[0-9a-fA-F]*$"}}
     }
   }
   ```
5. `cli/src/manifest.ts` (report): optionally a "Probes" row under the
   Dynamic analysis run table from `run.probes` — `summariseProbes` in
   `harness.ts` gives the one-liner.
6. `docs/DETECTORS.md` / `docs/SCORING.md`: mention that
   `unvalidated-pool-key` is a classification (never scores) and that
   `callback-selector-mismatch` is harness-sourced (engine `harness`, native
   rule `selector-probe`), so `CLASS_COVERAGE` should not list a static engine
   as responsible for it.
