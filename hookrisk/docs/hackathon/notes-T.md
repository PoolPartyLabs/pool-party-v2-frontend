# T — scoring, types, schema, SARIF, docs

Fourth pass, research adoption. This workstream owns the seams the other two
build against: the rule taxonomy, the scoring layer, the manifest schema and
the two documents the research produced.

Files: `cli/src/types.ts`, `cli/src/scoring/{derive,rubric,score.test}.ts`,
`cli/src/sarif.ts`, `cli/src/{manifest,manifest.test}.ts`,
`schema/{hook-risk.schema.json,framework-rubric.json}`, `docs/SCORING.md`,
`docs/PRIOR_ART.md`, `docs/hackathon/RESUME.md`.

## What changed

### 1. Two new rule classes (`cli/src/types.ts`)

- `unvalidated-pool-key` — the hook accepted a PoolManager-routed callback for
  a pool it is not attached to. Added to `CLASSIFICATION_CLASSES`: it is INFO,
  exempt from the severity gate, and scores nothing. Multi-pool hooks are
  legitimate and the framework has no dimension for pool exclusivity; Hacken's
  own checker defaults its exclusivity check to non-strict.
- `callback-selector-mismatch` — a callback called exactly as the PoolManager
  would call it returned the wrong selector or reverted. A HIGH defect: the
  operation it guards cannot complete.

Both are produced by the harness's probes, not by a detector. Agents P and H
may add the same union members on their branches; the union and the
classification set are the only places they belong.

### 2. Scoring (`cli/src/scoring/derive.ts`, `schema/framework-rubric.json`)

**Three classes moved into `IMPLEMENTED_CLASSES`** — `admin-surface`,
`external-call-in-swap-path`, `unbounded-dynamic-fee` — because HS-03, HS-05
and HS-06 now exist. `coverageGaps` no longer reports "no detector for X yet"
for them.

**Three dimension rules**, with the brackets recorded in the rubric rather than
in code:

| Dimension | Raised by | Score |
|---|---|---|
| `autonomousParameterUpdates` | `admin-surface` HIGH (unguarded mutator) | 2 |
| | `admin-surface` MEDIUM (owner-only, from `hook-profile.hasOwnerOnlyFunctions`) | 1 |
| `externalDependencies` | `external-call-in-swap-path`, `metrics.isStatic` false or absent | 2 |
| | `external-call-in-swap-path`, `metrics.isStatic` true | 1 |
| `priceImpactingBehavior` | `unbounded-dynamic-fee` | 2 (already the rule; the rationale is now recorded) |

`autonomousParameterUpdates` also left `NEVER_MEASURED`.

Because the score now depends on the *shape* of a finding and not only on its
class, the mapping is data: a new per-dimension `findingDerivation` block in
`schema/framework-rubric.json`, `interpretation: true`, one rationale per rule.
Rules are read in the order written, first match wins, and a rule with no
`when` is that class's fallback. The rubric loader refuses a rule that scores
outside the dimension's range, names an attribute the finding cannot carry, or
is written after an unconditional rule for the same class (it could never
fire). Conditions use the existing tiny grammar over `severityRank` plus the
finding's `metrics`; booleans are readable as `isStatic` and as
`isStatic == 0`, so the negative is expressible without adding a `!` operator
to a language that decides scores.

**None of the three detectors licenses a measured 0.** Each has a blind spot
that coincides with the bottom of its own dimension, so all three dimensions
carry an `unmeasuredWhenSilent` reason:

- HS-03 measures the admin surface, not autonomy — a hook that recomputes a fee
  from its own state inside `beforeSwap` is the 3 bracket and fires nothing.
- HS-05 only looks inside the swap path — "one immutable, trusted dependency
  read *outside* the swap path" is the framework's 1 bracket.
- HS-06 only reports a fee it can show is unbounded — a fee within a ceiling
  (bracket 2) or a fixed declared fee (bracket 1) fires nothing.

This is the deliberate part of the design and the place to disagree with me:
the alternative is to let a clean scan produce three measured zeros and a lower
tier, which is exactly the fabricated-in-the-safe-direction 0 this module
exists to prevent. What the pass buys is the *positive* direction — three
dimensions that could never be measured now can be.

**The harness is a coverage source.** `CLASS_COVERAGE` gains
`unvalidated-pool-key: ['harness']` and `callback-selector-mismatch:
['harness']`, and `enginesThatLooked` takes an optional harness summary:
`status: 'ok'` adds `harness` to `looked`, `failed` records a declination with
the revert quoted, `skipped` does neither. `DeriveOptions.harness` is
structural (`{ status, reason? }`), not an import of `HarnessSummary`, so
`derive.ts` does not depend on `manifest.ts`. **The CLI must pass it** — see
Integrator.

### 3. Schema (`schema/hook-risk.schema.json`)

- `findings[].ruleClass` gains the two classes; the description says which are
  classifications and that the two new ones come from the harness probes.
- `findings[].engines[].engine` is deliberately unconstrained (it always was);
  the description and examples now name `harness` and the three probe rule
  names, so nobody adds an enum by accident later.
- `permissions.harnessRun.probes` — `eoaGuard` (per callback:
  `guarded` / `unguarded` / `reverted-other`), `exclusivity`
  (`rejected` / `accepted` / `not-applicable`), optional `exclusivityReason`,
  `selectors` (per callback: `ok` / `wrong-selector` / `reverted`). Strict
  throughout: unknown keys and unknown verdicts both fail validation.
- `findings[].metrics` is no longer described as hook-profile-only: a defect
  carries the metrics its `findingDerivation` rules read (HS-05's `isStatic`).

### 4. Report and SARIF

`RULE_ID` gains `P-01 unvalidated-pool-key` and `P-02
callback-selector-mismatch` — a separate series because they come from the
probe layer, so a reader can see at a glance which layer saw the thing.
`shortTitle` gains headings for all five classes. `RULE_HELP` in
`cli/src/sarif.ts` gains the two new entries and sharper text for HS-03, HS-05
and HS-06.

Harness-sourced findings read as observations rather than opinions:
`Observed by the differential harness running the hook (`harness/selector-probe`).`
and, for a finding both layers carry,
`Observed by the differential harness running the hook (`harness/eoa-guard-probe`), and reported from source by `hookrisk/hookrisk-unprotected-callback`.`

### 5. Docs

- `docs/SCORING.md` — two new subsections under rule 2: scores that depend on
  the shape of a finding (the table above, with the bracket reasoning), why
  none of the three can measure a zero, and the harness as a coverage source.
  The nine-dimension table is updated for all three dimensions.
- `docs/PRIOR_ART.md` — the Hacken section is rewritten to cover the article as
  well as the checker, naming the three checks hookrisk adopted (EOA guard,
  pool exclusivity, selector return) and how hookrisk's version differs; a new
  chaosxcode/hookguard section states what it does, what was taken (HS-06's
  class, HS-05's framing, the bytecode layer as a deployed-mode design, the
  reversed permission bits), what was not (regex upgradeability, a
  `BaseHook`-substring-disabled guard rule, an additive score that prices
  absence), and their ecosystem numbers — **only ~17% of the busiest
  off-registry hooks publish source at all**, which is the ceiling on
  hookrisk's whole source-level method.
- `docs/hackathon/RESUME.md` — the permission-bit-layout landmine as a design
  constraint, a *Deployed mode design* subsection (hooklist as seed, Sourcify,
  address-bits-vs-`getHookPermissions()` first, codehash binding, the
  Docker-free bytecode upgradeability route), a fourth-pass section, and a
  rewritten open-items list.

## Tests

`cli/src/scoring/score.test.ts` (+21) and `cli/src/manifest.test.ts` (+2);
298 CLI tests pass, up from 275.

- Each of the three dimensions: the raising shape scores what the rubric says,
  the worst finding wins when several fire, the declaration still wins, and
  silence leaves the dimension unmeasured with its specific reason.
- `externalDependencies` covers all three `isStatic` states (true, false,
  absent) — the absent case is the fallback rule, which must score 2.
- The rubric loader refuses a `findingDerivation` rule naming an unknown
  attribute, and one that can never be reached.
- `enginesThatLooked` with an ok / failed / skipped / absent harness.
- The two harness-sourced classes score no dimension: the derived input with
  both findings present is deep-equal to the input without them.
- A manifest carrying `probes`, two harness-sourced findings and one
  two-attribution finding validates against the strict schema and renders; an
  unknown probe verdict is rejected.

## How to demo

```bash
cd cli && npm test          # 298 pass
```

```bash
# The interpretation is auditable without reading TypeScript:
python3 -c "import json;d=json.load(open('schema/framework-rubric.json'));\
print(json.dumps([x['findingDerivation'] for x in d['dimensions'] if 'findingDerivation' in x], indent=2))"
```

Once P and H have landed, the visible result is a hook with an owner-only fee
setter scoring `autonomousParameterUpdates 1/3` with the rubric's rationale in
the report's per-dimension evidence, and a probe-only finding rendering as
`P-02 callback-selector-mismatch … Observed by the differential harness`.

## Caveats

- **The owner-only → 1 mapping contradicts the framework's own 0 bracket**
  ("all parameters set by an explicit privileged call"). It is deliberate, and
  argued in the rubric's rationale: 0 would rank a hook whose owner can move the
  fee level with a hook that has no parameters, and source analysis cannot see
  the owner's timelock or ceiling. A team with guardrails should declare 0. If
  a reviewer disagrees, the change is one number in
  `schema/framework-rubric.json` and one assertion in `score.test.ts` — which is
  the point of keeping it as data.
- **HS-06 scores 2, one bracket below its own title.** The 3 bracket asserts no
  ceiling exists anywhere; a source detector can only say it did not find one.
- `externalDependencies` staying unmeasured on silence is the weakest of the
  three calls: if P's `hook-profile` grows a metric counting external calls
  *outside* the swap path, the honest 0 becomes derivable and the
  `unmeasuredWhenSilent` should go.
- `metrics.isStatic` on an HS-05 finding is a contract between P's detector and
  this rubric. If P names it differently, the rubric's `attributes` list and the
  two rules change; nothing in TypeScript does.
- Nothing here emits probes. Until H's harness writes them and the CLI passes
  the harness summary to the scorer, `permissions.harnessRun.probes` and the
  harness's coverage entry are dormant but validated.

## Integrator

**1. `cli/src/cli.ts` — move the score block after the layer reconciliation and
pass the harness summary.** Today `deriveScoringInput` runs at line ~389, before
the harness result exists and before `reconcileLayers` adds the harness-sourced
findings, so probe findings would never reach the scorer or the score's
evidence. `scored` is not used before `buildManifest` (line ~496) and one log
event (line ~541), so the block moves down unchanged apart from its inputs.

Delete this, where it currently sits after `mergeEngineResults`:

```ts
  // --- score ---
  const rubric = loadRubric(home.rubric);
  const scoringInput = deriveScoringInput({
    findings,
    engineResults,
    declared: config.declared,
    dimensionIds: rubric.dimensions.map((d) => d.id),
    contractName,
  });
  const scored = score(scoringInput, rubric);
```

and put this immediately after `for (const note of reconciled.notes) log.event('info', 'reconcile', note);`:

```ts
  // --- score ---
  // After the layers are reconciled, so a finding the harness's probes produced
  // is scored like any other and a probe that corroborated a static finding is
  // one finding by the time the scorer sees it. The harness is not in
  // `engineResults`, so its status is passed separately: it is the engine
  // responsible for `unvalidated-pool-key` and `callback-selector-mismatch`.
  const rubric = loadRubric(home.rubric);
  const scoringInput = deriveScoringInput({
    findings: reconciled.findings,
    engineResults,
    declared: config.declared,
    dimensionIds: rubric.dimensions.map((d) => d.id),
    contractName,
    harness: { status: harness.status, ...(harness.reason ? { reason: harness.reason } : {}) },
  });
  const scored = score(scoringInput, rubric);
```

**2. Rule-class union collisions.** P and H add the same two members to
`RuleClass` on their branches. Keep one copy of each doc comment (mine carries
the "produced by the harness's probes" rationale) and one
`CLASSIFICATION_CLASSES` entry for `unvalidated-pool-key` only —
`callback-selector-mismatch` is a defect and must **not** be in that set, or it
stops failing the severity gate.

**3. `schema/engine-metadata.schema.json`** is P's file: its `ruleClass` enum
needs the same two names if any Python detector may ever emit them (today none
does — both come from the harness, which does not go through that contract).

**4. Run one real scan after merging.** `make test` does not. From `corpus/`:
`node ../cli/dist/cli.js scan src/good/CleanHook.sol:CleanHook --verbose` — a
manifest field with no schema entry fails with HR-E501.

**5. Pre-existing red test, not mine to fix.** At `751b874`,
`detectors/tests/test_corpus.py:322` asserts a phrase commit `81de757` removed
from `disabled_callback.py`. `make test` fails there on a clean checkout. The
one-line fix belongs to whoever owns `detectors/`:

```python
        self.assertIn("harness records such reverts", finding["description"])
```
