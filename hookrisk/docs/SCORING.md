# Scoring

hookrisk implements the [Uniswap Hooks Security
Framework](https://github.com/uniswapfoundation/security-framework), pinned at
commit `e7e8da52`. The rubric lives as data in
[`schema/framework-rubric.json`](../schema/framework-rubric.json) so our reading
of the framework can be diffed against the framework without reading TypeScript.

> The Uniswap Foundation does not review, endorse or certify this port or any
> score derived from it.

## The shape

Nine dimensions, total 0–33, mapping to three tiers:

| Tier | Range |
|---|---|
| Low | 0–6 |
| Medium | 7–17 |
| High | 18–33 |

Plus seven feature triggers that apply **regardless of the total**. That second
layer is the framework's own defence against a team scoring itself low while
shipping a dangerous primitive, and it is the part of the design we did not have
to reinterpret.

## Three rules that shape everything

### 1. Unmeasured is not zero

If static analysis was skipped, or no detector exists for a property, that
dimension has no value. Scoring it 0 would lower the total, possibly the tier,
and thin out the resulting security plan — based on a number the tool invented,
in the direction that makes the hook look safer. Across nine dimensions those
biases all point the same way.

So unmeasured dimensions are **excluded from the total** and reported as a range:

```
MEDIUM risk  10/33  (undetermined: up to 22/33)
  ! 4 dimension(s) unmeasured: the tier is between Medium Risk and High Risk.
```

Whether an undetermined tier fails the gate is a policy choice
(`failOnInconclusive`, see [The gate](#the-gate)). By default the gate fails on
what was *measured* and records the range it could not rule out; the strict
posture fails on the range itself.

### 2. A dimension is scored 0 only if someone looked

The rule that makes rule 1 meaningful. Each dimension declares which rule classes
can raise it, and each class declares which engines can produce it. A dimension is
`measured: 0` only when every responsible engine actually ran.

This is why enabling BlockSec *widens what hookrisk can score* rather than merely
duplicating it — and why the tool tells you so:

```
upgradeability  —  unmeasured
   Not measured: no detector for upgradeable-hook (needs blocksec, which did not run)
```

[`derive.ts`](../cli/src/scoring/derive.ts)

#### "Ran" is not "looked"

An engine's `status: ok` says its process finished. It does not say the engine
recognised the target. Five hooks written against the 2023 `getHooksCalls()`
ABI were once scored `complexity: 0 — Pass-through only; no hook state` because
Slither ran cleanly over contracts the detectors never identified as hooks.

So an engine counts as having looked only when it ran **and** did not disclaim
the target. Two things disclaim it:

- an `unsupported-hook-abi` classification on the target file — the detectors
  saying "this is hook-shaped and I cannot read it";
- `targetCoverage.covered: false` on the engine result, which the Slither
  adapter sets from the same classification and which any future engine can
  set for its own reasons.

Either way, every dimension that engine would have measured comes back
unmeasured, with the reason in its evidence:

```
customMath  —  unmeasured
   Not measured: custom-accounting requires hookrisk; hookrisk ran but did not
   recognise the target's hook ABI (unsupported-hook-abi: ...)
```

#### Some dimensions cannot be measured by silence at all

Complexity is the case. HS-01 and HS-02 prove a hook has callbacks with
non-trivial structure, so when either fires the dimension gets a **floor of 1**.
When neither fires, nothing those detectors do can tell a genuinely pass-through
hook from a complex one whose callbacks happen to be guarded and correctly
declared — which is what every well-written hook looks like. Complexity is
therefore never `measured: 0` from silence. It is measured from evidence that
*counts* rather than accuses: the `hook-profile` classification.

#### Complexity from the hook profile

The static engine emits one INFO `hook-profile` classification per analysed
hook contract — its "I looked at this contract" signal — carrying structural
metrics: `callbacksImplemented`, `callbacksDeclared`, `stateWritesInCallbacks`,
`externalCallsInSwapPath`, `internalFunctionsReachableFromCallbacks`,
`usesReturnsDelta`, `hasOwnerOnlyFunctions`, plus the implemented callback
names and the resolved permission set. The profile never fails a gate and
never scores by itself.

The scoring layer derives Complexity (0–5) from those metrics with a rule table
that lives **in the rubric**, not in code
(`schema/framework-rubric.json`, dimension `complexity`, key `derivation`,
marked `interpretation: true` with a rationale per rule). Rules are tried
highest score first; the first whose condition holds wins:

| Score | When | Reading of the framework's prose |
|---|---|---|
| 5 | returns-delta **and** an external call in the swap path **and** an owner-only surface | every source of "multi-step flows" and "configuration patterns" at once |
| 4 | returns-delta **and** an external call in the swap path | two interacting flows, not one |
| 3 | returns-delta **or** an external call in the swap path | the callback's effect is not local to itself |
| 2 | state written in callbacks, **or** 3+ callbacks | "branching logic" and "number of callbacks" |
| 1 | 1–2 callbacks, no state written | observers and pass-through guards |
| 0 | no callback implemented | pass-through by construction |

The conditions use the same tiny grammar as requirement guards
(`name OP number`, bare boolean names, `&&`/`||`, left to right, no
parentheses), so the rubric has one condition language. The loader refuses a
rule that names a metric the profile does not carry or scores outside the
dimension's range.

Three properties worth stating:

- **A measured 0 exists, and only this way.** A profile with
  `callbacksImplemented = 0` is the engine saying it counted and found none.
  No profile → `unmeasured`, with the reason in the evidence.
- **The HS-01/HS-02 floor still applies**, and only raises. A profile that
  scores 3 is not pulled down to 1 by a divergence finding; a profile that
  scores 0 on a contract HS-02 fired on is lifted to 1.
- **A declaration still wins.** `complexity = 2` in `hookrisk.toml` over a
  measured 4 is recorded as declared, with
  `hookrisk measured 4; hookrisk.toml declares 2. The declaration is lower than
  the measurement.` in the evidence.

The manifest carries the metrics on the profile finding (`findings[].metrics`,
`callbacks`, `permissions`) and `HOOK_RISK.md` renders them as a "Hook profile"
table under *What was assessed*; the rule that fired is in the score table's
evidence.

#### Scores that depend on the shape of a finding

HS-03, HS-05 and HS-06 report one class each, but the class alone does not fix
the score: an unguarded mutator and an owner-only one are both `admin-surface`,
and a `staticcall` to an oracle and a state-changing call to a lending market
are both `external-call-in-swap-path`. The distinguishing evidence is on the
finding — its severity, or a metric such as `isStatic` — so the class-to-score
mapping lives in the rubric too, as a per-dimension `findingDerivation` block
marked `interpretation: true`, one rationale per rule. Rules are read in the
order written, first match wins, and a rule with no condition is that class's
fallback; the loader refuses a rule written after one (it could never fire) and
a rule naming an attribute the finding cannot carry.

| Dimension | Finding | Score | Why that bracket |
|---|---|---|---|
| Autonomous parameter updates | `admin-surface` **HIGH** (unguarded mutator) | 2 | Anyone can move the parameter, so no access control enforces bounds or a rate limit. Not 3: the 3 bracket is a hook that adjusts *itself*. Not 0: the 0 bracket is "an explicit **privileged** call" |
| Autonomous parameter updates | `admin-surface` **MEDIUM** (owner-only) | 1 | The framework's 0 bracket describes this shape exactly, but 0 would rank a hook whose owner can move the fee level with a hook that has no parameters at all, and source analysis cannot see the owner's timelock, ceiling or multisig. A floor, not a verdict — declare 0 if you have the guardrails |
| External dependencies | `external-call-in-swap-path`, `metrics.isStatic` true | 1 | A `staticcall` cannot write to the dependency or reenter the PoolManager. A floor: the framework's 2 bracket does not qualify the call kind |
| External dependencies | any other `external-call-in-swap-path` | 2 | The 2 bracket verbatim, "a dependency read inside the swap path". Also the fallback, so a finding whose kind the detector did not classify scores 2 rather than 1 |
| Price impacting behavior | `unbounded-dynamic-fee` | 2 | HS-06's evidence is *negative* — it did not find a bound. The 3 bracket ("adjusts fees without a ceiling") asserts no ceiling exists anywhere, which a source detector cannot establish; the missing ceiling is reported as the finding, and a reviewer who confirms it should declare 3 |

#### None of the three can measure a zero

Each of the three detectors has a blind spot that coincides with the bottom of
its own dimension, so silence leaves the dimension **unmeasured** and says why:

- **HS-03 measures the admin surface, not autonomy.** A hook that recomputes
  its fee from its own state inside `beforeSwap` — the 3 bracket, self-adjusting
  with neither bounds nor rate limiting — has no admin surface at all and fires
  nothing.
- **HS-05 only looks inside the swap path.** "One immutable, trusted dependency
  read *outside* the swap path" is the framework's own 1 bracket, and no
  detector reports it; closing this needs a profile metric counting external
  calls outside the swap path.
- **HS-06 only reports a fee it can show is unbounded.** A hook that adjusts
  its LP fee within a ceiling (bracket 2), or charges a fixed declared fee
  through an `lpFeeOverride` (bracket 1), fires nothing.

The three classes are nonetheless in `IMPLEMENTED_CLASSES`: hookrisk can now
*produce* them, so a dimension is no longer reported as "no detector for this
class yet". What changed is the positive direction — these dimensions can now
be measured from evidence — not the licence to read silence as zero.

#### The harness is a coverage source too

Two rule classes are produced by executing the hook rather than reading it:
`unvalidated-pool-key` (INFO classification) and `callback-selector-mismatch`
(HIGH defect), both from the probes the differential harness runs against the
deployed hook before the fuzz campaign. Neither informs a dimension — the
framework has no bracket for pool exclusivity, and a bricked callback is a
defect to fix, not a risk to price — but the harness is registered in
`CLASS_COVERAGE` as the engine responsible for them, and counts as having
*looked* when its status is `ok`. A harness that failed disclaims, with its
revert quoted, exactly like a static engine that could not compile the project.

### 3. Measured and declared are different claims

`teamMaturity` is a self-assessment by definition. `upgradeability` is observable
from bytecode. Both are inputs; only one can be checked, and the manifest keeps
them apart.

An explicit declaration overrides a measurement, and the manifest records both.
Overriding upward is unremarkable. Overriding *downward* is precisely the move
the framework warns about, and making it visible is the only defence a document
can offer.

hookrisk has **no defaults** for declared dimensions. It errors (`HR-E101`)
rather than guess.

## The nine dimensions

| Dimension | Range | How hookrisk gets it |
|---|---|---|
| Complexity | 0–5 | Derived from the `hook-profile` metrics by the rubric's rule table; HS-01/HS-02 add a floor of 1; no profile → **unmeasured**, silence is not 0 |
| Custom math | 0–5 | Measured — from custom-accounting and rounding findings |
| External dependencies | 0–3 | Measured from HS-05 (2, or 1 for a static read); **unmeasured** when HS-05 is silent — it only looks inside the swap path |
| External liquidity exposure | 0–3 | Never measured → declared or unmeasured |
| TVL potential | 0–5 | **Declared** — asks about potential, not current |
| Team maturity | 0–3 | **Declared** — self-assessed by definition |
| Upgradeability | 0–3 | Measured when BlockSec runs, else unmeasured |
| Autonomous parameter updates | 0–3 | Measured from HS-03 (2 unguarded, 1 owner-only); **unmeasured** when HS-03 is silent — it sees the admin surface, not autonomy |
| Price impacting behavior | 0–3 | Measured — returns-delta permissions (3), HS-06 unbounded dynamic fee (2); **unmeasured** on silence, which cannot separate "no fee logic" from a bounded one |

## Where we interpreted, and why you should check

**Seven of nine dimensions have no scoring brackets in the framework.** Only TVL
potential and team maturity define what each value means. The rest give a range
and a paragraph of prose.

That is the single biggest obstacle to implementing the framework, and to two
teams ever producing comparable scores. Nothing distinguishes Complexity 3 from
Complexity 4 — and the boundary at 7, or at 18, decides whether you owe one audit
or two plus a math specialist.

So hookrisk supplies brackets, derived from the prose, and **marks every one of
them**:

- in the rubric, as `bracketsAreInterpretation: true`
- in the manifest, per dimension
- in `HOOK_RISK.md`, with a footnote marker

They are our reading, not the Foundation's, and we would rather delete them and
adopt authoritative ones. Reported as [FEEDBACK.md #2](../FEEDBACK.md).

The same applies to the dimension-to-trigger mapping. The framework states it
only for TVL (`trigger fires when the dimension is 5`); for the other six we
chose thresholds and marked them `derivationIsInterpretation: true`. Reported as
[FEEDBACK.md #5](../FEEDBACK.md).

## Recommendation precedence

The framework uses five strengths — *optional*, *recommended*, *strongly
recommended*, *required*, *mandatory* — and never orders them. Multiple triggers
routinely fire at once and produce different strengths for the same action:

- §3 Low Risk: bug bounty **optional**
- §4.3 External dependencies: bug bounty **recommended**
- §4.5 Price impact: bug bounty **required**
- §4.7 TVL 5: bug bounty **mandatory**

hookrisk defines the ordinal and merges by maximum:

```
optional < recommended < strongly recommended < required (= mandatory)
```

Every request is kept as a source, so the report explains *why* an action is
required rather than only that it is:

| Action | Strength | Because |
|---|---|---|
| Bug bounty programme | **Required** | `tier:low`, `trigger:tvl-5` |

Reported as [FEEDBACK.md #3](../FEEDBACK.md).

## Conformance: the framework's own worked examples

Section 5 gives four worked examples. They are the only place the Foundation
states an end-to-end expected outcome, so they are the closest thing to a
conformance suite this port can be held to. All four are encoded as tests in
[`score.test.ts`](../cli/src/scoring/score.test.ts).

**Three pass.**

| Example | Expected | Result |
|---|---|---|
| Score 4 + custom math | math-specialist audit required | ✅ |
| Score 5 + TVL 5 | monitoring and bug bounty required | ✅ |
| Score 3 + autonomy | invariant testing required | ✅ |
| Score 7 + custom math + price impact | *"looks like a high-risk hook regardless"* | ❌ |

**The fourth does not hold under the framework's own rules.** Applying §3 and §4
mechanically, that hook picks up three of the four measures the High tier makes
mandatory and misses `monitoring`, because the only rules that could demand it
are §4.1 (which says *recommended*) and §4.5 (whose *required* is conditional on
TVL 5, and TVL is 0 in the example).

The test pins the shortfall rather than hiding it, so if the Foundation tightens
§4.1 our port fails and tells us to update. Reported as
[FEEDBACK.md #11](../FEEDBACK.md).

## The gate

Configured in `hookrisk.toml`. This is what `hookrisk init` writes:

```toml
[gate]
# maxTier = "medium"          # opt in once the tier is determined for your hook
maxSeverity = "high"
failOnPartialCoverage = false
failOnInconclusive = false    # true is the strict posture
```

Exit code `2` means the scan completed and the gate did not pass. That is
deliberately not an error code: conflating "hookrisk is broken" with "your hook
has a problem" would make a CI job unable to tell them apart, and only one of
those should page someone.

**A violated invariant fails the gate unconditionally**, whatever the tier and
whatever thresholds are set. It is the strongest evidence the tool produces — not
a pattern resembling a bug, but an executed sequence in which the hook
demonstrably misbehaved. A gate weighing a reproducible counterexample against a
numeric threshold could pass a hook that provably traps liquidity, and that is
not a trade-off worth offering.

**A classification never breaches `maxSeverity`.** `custom-accounting`,
`callback-intentionally-disabled`, `unsupported-hook-abi` and `hook-profile`
describe the hook; they are INFO and are not counted as findings by the gate.

### The tier gate is a deliberate choice

Six of the nine dimensions have no detector yet. On nearly every hook the tier
is therefore a range whose upper bound is High — including the official v4
template, which used to fail the default `maxTier = "medium"` on nothing but
hookrisk's own coverage. A gate that fails every scan gates nothing, so the
rule is now:

| Situation | `failOnInconclusive = false` (default) | `= true` |
|---|---|---|
| Measured lower bound above `maxTier` | **fails** | **fails** |
| Lower bound within, upper bound above `maxTier` | passes, with a `gate.notes` entry naming the unmeasured dimensions | **fails** |
| Upper bound within `maxTier` | passes | passes |
| `maxTier` unset | not gated | not gated |

The note is rendered next to the verdict in `HOOK_RISK.md` and carried in the
manifest (`gate.notes`, `gate.failOnInconclusive`), so a pass can always be read
together with what it could not rule out. `hookrisk init` leaves `maxTier`
commented out with this explanation; declare the unmeasured dimensions in
`[declared]` to close the range, or set `failOnInconclusive = true` for the
strict posture in which unknown is not a pass.

[`manifest.ts`](../cli/src/manifest.ts) · `evaluateGate`
