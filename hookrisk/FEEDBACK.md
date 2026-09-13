# Developer Feedback — Uniswap v4, the Hooks Security Framework, and uniswap-ai

Submitted as part of the hookrisk hackathon project.
Feedback form: <https://developers.uniswap.org/hackathon-feedback>

---

## How this feedback was produced

hookrisk is a tool that turns the [Uniswap Hooks Security
Framework](https://github.com/uniswapfoundation/security-framework) into
something executable: it scores a hook across the framework's nine dimensions,
evaluates its seven feature triggers, and emits a machine-readable manifest.

Porting a rubric into code is an unusually good way to find holes in it. Prose
tolerates ambiguity; a scoring function does not. Every item below is something
we hit while implementing, not something we went looking for. Each one names the
file and line so you can check it, and proposes a specific fix rather than only
reporting a problem.

Findings are ordered by how much they would cost a hook developer who trusted the
documentation.

| # | Where | Severity | Summary |
|---|-------|----------|---------|
| [1](#1) | `uniswap-ai` | **High** | Security skill states the wrong address bit for the most dangerous permission |
| [2](#2) | Framework §2 | **High** | 7 of 9 scoring dimensions have no brackets, so scores are not comparable |
| [3](#3) | Framework §3–5 | Medium | No precedence rule when triggers produce conflicting recommendations |
| [4](#4) | Framework §3 | Medium | Tier text contradicts trigger requirements it does not cross-reference |
| [5](#5) | Framework §2/§4 | Medium | Dimensions and triggers overlap with no stated relationship |
| [6](#6) | Framework §1 | Low | Broken internal cross-reference |
| [7](#7) | Framework §8 | Medium | Rubric has no machine-readable form |
| [8](#8) | v4 docs / ecosystem | Medium | `BaseHook` moved repositories; guidance still points at v4-periphery |
| [9](#9) | Tooling | Medium | Slither cannot analyse a v4 project in two common configurations |
| [10](#10) | Framework §4 | Low | "Hook holds its own liquidity" has no checkable definition |
| [11](#11) | Framework §5 | Medium | A worked example does not hold under the framework's own rules |

---

<a id="1"></a>
## 1. `uniswap-ai` security skill states the wrong bit for `BEFORE_SWAP_RETURNS_DELTA`

**Severity: High.** This is in Uniswap's own AI tooling, in the paragraph that
calls the permission "the most dangerous hook permission."

**Where.**
`packages/plugins/uniswap-hooks/skills/v4-security-foundations/SKILL.md`, line 58:

> The `BEFORE_SWAP_RETURNS_DELTA` permission (bit 10) is the most dangerous hook permission.

**Ground truth.** `v4-core/src/libraries/Hooks.sol`, line 44:

```solidity
uint160 internal constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3;
```

The flag is **bit 3**. Bit 10 is `AFTER_ADD_LIQUIDITY_FLAG` (`Hooks.sol:33`).

**Why it matters.** v4 derives a hook's permissions from the low 14 bits of its
deployed address, so developers mine a CREATE2 salt to hit a specific bit
pattern. The framework itself flags this as a hazard class — §1.11, *Permission
Encoding & Salt Grinding Pitfalls*: "required callbacks may be disabled,
undesired permissions may be unintentionally enabled." A developer following
this sentence while grinding a salt sets `AFTER_ADD_LIQUIDITY` and does not set
the permission they were reading about. The failure is silent at deploy time.

The number is probably a 0-indexed position in the skill's own permission table
(`beforeSwapReturnDelta` is its 11th row), which is exactly how this kind of
error survives review: it is internally consistent and externally wrong.

**Suggested fix.** Replace with "bit 3 (`1 << 3`)". We are opening a PR against
`Uniswap/uniswap-ai` with the one-line correction.

**Root cause worth addressing.** The bit positions are transcribed prose. They
will drift again. hookrisk generates them from `Hooks.sol` and cross-checks the
generated values against `solc` in a Foundry test
([`harness/test/HooksSpec.t.sol`](harness/test/HooksSpec.t.sol)), so a v4-core
change that moves a bit breaks CI instead of quietly invalidating a document. We
would be glad to contribute the same generator to `uniswap-ai` if useful.

---

<a id="2"></a>
## 2. Seven of nine scoring dimensions have no scoring brackets

**Severity: High.** This is the single biggest obstacle to implementing the
framework, and to two teams ever producing comparable scores.

**Where.** Framework §2, *Hook Risk Self-Scoring Dimensions*.

Only two dimensions define what each value means:

- **TVL potential (0–5)** — five explicit dollar brackets.
- **Team maturity (0–3)** — four described maturity levels.

The other seven give a range and a paragraph of prose:

| Dimension | Range | Guidance provided |
|---|---|---|
| Complexity | 0–5 | "Measures total code complexity including branching logic, number of callbacks…" |
| Custom math | 0–5 | A list of what counts as custom math |
| External dependencies | 0–3 | A list of what counts as a dependency |
| External liquidity exposure | 0–3 | "The more externalized the liquidity, the higher the risk" |
| Upgradeability | 0–3 | Prose about why upgradeability is dangerous |
| Autonomous parameter updates | 0–3 | Prose about guardrails |
| Price impacting behavior | 0–3 | Prose about caution |

**Why it matters.** Nothing distinguishes Complexity 3 from Complexity 4. Two
honest teams scoring the same hook can land in different tiers, and the tier
boundary at 7 and at 18 is what selects "one audit" versus "two audits including
a math specialist" — a decision with a five-figure cost difference.

This also undercuts the framework's own stated design goal. §5 says the two-layer
model "ensures teams cannot 'score themselves low'." Layer 2 does resist that.
But an unbracketed Layer 1 makes under-scoring effortless *and* deniable, because
no score can be shown to be wrong.

**Suggested fix.** Give every dimension brackets in the style already used for
TVL. Anchors do not have to be perfect to be a large improvement over none.
Concretely, for Complexity:

| Score | Bracket |
|---|---|
| 0 | No callbacks beyond a pass-through; no storage |
| 1 | 1–2 callbacks, no branching on hook state |
| 2 | 3–4 callbacks, or one operational mode with configuration |
| 3 | 5+ callbacks, or multiple operational modes |
| 4 | Multi-step flows spanning callbacks, or per-pool configuration |
| 5 | All of the above plus reentrant or recursive interaction with itself |

hookrisk implements proposed brackets for all seven, derived from the prose and
documented in [`docs/SCORING.md`](docs/SCORING.md) with the interpretation made
explicit at each step. We publish them as *our reading*, not as the framework's
position, precisely because the framework does not take one. We would rather
delete ours and adopt yours.

---

<a id="3"></a>
## 3. No precedence rule when recommendations conflict

**Severity: Medium.**

**Where.** Framework §3 and §4.

The framework uses at least five distinct strengths for its recommendations:
*optional*, *recommended*, *strongly recommended*, *required*, and *mandatory*.
Multiple triggers routinely fire at once and produce different strengths for the
same action:

- §3 Low Risk: "Bug bounty optional"
- §4.3 External dependencies: "Bug bounty recommended"
- §4.5 Price impacting behavior: "Bug bounty **required**"
- §4.7 TVL 5: "Bug bounty **mandatory**"

A hook with external dependencies and price impact and a Low tier receives
"optional", "recommended" and "required" for bug bounty. The framework does not
say which wins.

Monitoring is worse — it appears with four different strengths across §3 and §4,
including the conditional "Monitoring required if TVL score is 5", which is a
different *kind* of statement again.

**Why it matters.** This is the first thing an implementer must decide and the
framework provides no basis for deciding it. Every implementation will guess, and
they will not all guess the same way.

**Suggested fix.** State an ordinal and a merge rule:

```
optional < recommended < strongly recommended < required = mandatory
```

Merge by taking the maximum across all fired triggers, and render the result
with the list of triggers that produced it, so a team can see *why* they owe a
bug bounty rather than just being told they do. Also consider collapsing
*required* and *mandatory*: they appear to be synonyms, and two words for one
concept invites the reading that they differ.

hookrisk implements exactly this. See
[`docs/SCORING.md#recommendation-precedence`](docs/SCORING.md).

---

<a id="4"></a>
## 4. Tier text contradicts trigger requirements without cross-referencing them

**Severity: Medium.**

**Where.** Framework §3.

The Low Risk tier says "Bug bounty optional" and "Monitoring optional unless TVL
grows significantly." §4 then makes bug bounty *required* under three separate
triggers that a Low-tier hook can absolutely fire.

§5 resolves this correctly and gives good examples ("A hook with a score of 5 but
with TVL 5, must implement monitoring and bug bounty"). But §3 is where a reader
lands first, and it reads as authoritative and self-contained. A team that reads
§3, sees "optional", and stops has been misled by a document that is right two
sections later.

**Suggested fix.** Add one line to each tier block: *"These are baselines.
Feature triggers in §4 may raise any of them and cannot lower them."* Cheap, and
it removes the trap.

---

<a id="5"></a>
## 5. The relationship between dimensions and triggers is unstated

**Severity: Medium.**

**Where.** Framework §2 versus §4.

Several dimensions and triggers describe the same property:

| Dimension (§2) | Trigger (§4) |
|---|---|
| 2. Custom math (0–5) | 1. Custom Curve or Non Standard Math |
| 3. External dependencies (0–3) | 3. External Protocol or Oracle Dependencies |
| 4. External liquidity exposure (0–3) | 2. Hook Holds Its Own Liquidity |
| 7. Upgradeability (0–3) | 6. Upgradeable |
| 8. Autonomous parameter updates (0–3) | 4. Autonomous Parameter Updates |
| 9. Price impacting behavior (0–3) | 5. Price Impacting Behavior |
| 5. TVL potential (0–5) | 7. TVL 5 Rating |

For TVL the relationship is explicit: the trigger fires when the dimension is 5.
For the other six, it is not stated. Is the Upgradeable trigger set when
dimension 7 > 0? Is it independent? §4.1 says "a specialized math review is
recommended whenever custom math is present" without defining *present* in terms
of the 0–5 score.

**Why it matters.** An implementer must either derive triggers from dimensions
(and risk diverging from your intent) or ask for them separately (and risk a
self-assessment that says "custom math: 4" alongside "custom curve trigger: no").
The spreadsheet presumably picks one; the written framework should say which.

**Suggested fix.** For each trigger, state its relationship to its dimension
explicitly. The TVL formulation is a good template: *"Triggers when dimension N
≥ k."* Where a trigger is genuinely independent, say so — that is equally useful
to know.

hookrisk currently derives triggers from measured evidence and lets a declared
value override, recording both in the manifest so the disagreement is visible
rather than silently resolved.

---

<a id="6"></a>
## 6. Broken internal cross-reference

**Severity: Low.** Trivial, included for completeness.

**Where.** Framework §1.8, *TVL Growth Over Time*:

> More info on these topics to evaluate can be found in section 4: "Generic Hook Risk Tiers & Recommendations."

"Generic Hook Risk Tiers and Recommendations" is **section 3**. Section 4 is
"Feature-Specific Security Recommendations". The Guide Overview at the top of the
document numbers both correctly, so the body text is the error.

---

<a id="7"></a>
## 7. The rubric has no machine-readable form

**Severity: Medium.** This is a suggestion rather than a defect.

**Where.** Framework §8 — the calculator is a Google Sheet, and the repository
contains only `README.md` and two images.

**Why it matters.** The framework is well suited to automation: nine bounded
integers, a three-way tier mapping, seven booleans, and a set of recommendation
rules. As a spreadsheet it cannot be diffed, versioned alongside a hook's source,
required in CI, or attached to a release. Teams re-score by hand after every
change, which — given §9's instruction to "reassess risk periodically as TVL
grows or new features are added" — is exactly the sort of recurring manual task
that quietly stops happening.

A spreadsheet also cannot express *provenance*. "Upgradeability: 2" means
something quite different when a tool observed a `DELEGATECALL` than when a team
typed a number, and the framework's own concern about self-scoring makes that
distinction worth preserving.

**Suggested fix.** Publish the rubric as data in the repository — a small JSON or
YAML file with dimensions, ranges, brackets, tier boundaries, triggers and
recommendation rules. The sheet can be generated from it, and tooling can consume
it directly. We are happy to open that PR: hookrisk already contains such a file,
derived from the current text, at
[`schema/framework-rubric.json`](schema/framework-rubric.json).

Two further suggestions in the same direction:

- **Version the framework.** A score is only meaningful against a stated revision.
- **Distinguish measured from declared inputs.** Team maturity is inherently
  self-declared; upgradeability is observable from bytecode. Marking which is
  which would let a reader weight a self-assessment appropriately.

---

<a id="8"></a>
## 8. `BaseHook` moved repositories and the ecosystem has not caught up

**Severity: Medium.**

**What we found.** `@uniswap/v4-periphery@1.0.4` no longer exports `BaseHook`.
We verified this against the pinned checkout at commit `3245c3cb`: `src/` contains
`PositionManager`, `V4Router`, `base/`, `hooks/permissionedPools/`, `lens/` and
`libraries/`, with no `BaseHook.sol` anywhere. The only `onlyPoolManager` in
v4-periphery is on `ImmutableState`, used by `SafeCallback` for `unlockCallback`
on routers — not a hook base class.

The canonical hook base is now `@openzeppelin/uniswap-hooks@1.2.2`
(`src/base/BaseHook.sol`), which the framework does list under §11 Hook
Libraries.

**Why it matters.** A large amount of tutorial material, and a lot of developer
memory, says "inherit `BaseHook` from v4-periphery". That import now fails, and
the natural recovery — writing the access check by hand — is precisely where
HS-01 findings come from. The framework's §11 lists OpenZeppelin as a library
option; it could state more directly that it is *the* base class.

**Suggested fix.** A short note in the framework's Hook Libraries section, and in
the v4 documentation, that `BaseHook` lives in `@openzeppelin/uniswap-hooks` and
is no longer part of v4-periphery.

**Practical note for tool authors.** Detecting the PoolManager guard by looking
for a modifier named `onlyPoolManager` breaks across this move, and is defeated
by a hook that declares an empty modifier of that name. hookrisk matches on the
dataflow instead — a real comparison between `msg.sender` and the variable that
received the pool manager, wherever it occurs.

---

<a id="9"></a>
## 9. Slither cannot analyse a v4 project in two common configurations

**Severity: Medium.** Developer-experience feedback affecting anyone following
the framework's §7 advice to run static analysis, or §11's tooling list.

We lost meaningful time to two failures whose error messages point nowhere near
their cause. Both are in `crytic-compile`, which Slither uses to drive Foundry.

**9a. Parent-relative library paths.** With `libs = ["../shared/lib"]` in
`foundry.toml`, `forge build` succeeds and Slither aborts with:

```
AssertionError: Contract IExttload not found
```

`IExttload` is fine. The `..` is not normalised, so name resolution fails on an
arbitrary inherited interface. Workaround: use a symlink and a plain `libs = ["lib"]`.

**9b. Test path shadowing source path.** `crytic-compile` builds with:

```
forge build --build-info --skip ./<test>/** --skip ./<script>/** --force
```

If `test` in `foundry.toml` points at the same directory as `src`, every contract
is skipped and `--force` clears prior artifacts. Slither then either fails with
`build-info is not a directory` or, in some layouts, **reports a clean scan of
nothing at all**. Silent false-negatives are the worst outcome a security tool
can produce, and nothing in the output suggests anything was skipped.

**9c. Silent IR-lifting failures on production hook code.** Running Slither over
OpenZeppelin's `uniswap-hooks` library, three functions fail to lift to SlithIR:

```
ERROR:ContractSolcParsing:Impossible to generate IR for BaseDynamicAfterFee._afterSwap
ERROR:ContractSolcParsing:Impossible to generate IR for AntiSandwichHook._afterSwap
ERROR:ContractSolcParsing:Impossible to generate IR for AntiSandwichHook._getTargetUnspecified
```

Slither logs these to stderr and **continues**, then reports a normal result
count. Any detector that relies on IR — which is most of them — simply never sees
those functions. `_afterSwap` in an anti-sandwich hook is not a peripheral
function; it is where the interesting logic lives.

We hit this in our own false-positive gate. Our detectors returned zero findings
against these contracts, and it took reading stderr to establish that part of
that silence was "nothing wrong" and part was "nothing looked." hookrisk now
counts unlifted functions and reports them as reduced coverage (`HR-E205`) rather
than letting them pass as a clean scan.

**Why this matters to Uniswap.** The framework recommends static analysis at every
tier ("One full audit, plus AI static analysis tools" appears in all three). A v4
project whose dependencies are shared across sub-projects — a normal monorepo
shape — hits 9a immediately. And 9c means a team can run Slither over an
OpenZeppelin-based hook, see a clean report, and have no indication that its most
security-relevant function was skipped.

**Suggested fix.** Worth raising with `crytic-compile` upstream; we are happy to
file it. In the meantime, a paragraph in the v4 docs on running Slither against a
v4 project would save others the same afternoon. hookrisk detects both conditions
and reports them as `HR-E201` and `HR-E202` with the fix inline
([`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)).

---

<a id="10"></a>
## 10. "Hook holds its own liquidity" has no checkable definition

**Severity: Low.**

**Where.** Framework §4.2. The trigger fires when "the hook temporarily or
permanently holds tokens."

Taken literally, *temporarily* covers almost every non-trivial hook: any hook
that calls `take()` and `settle()` within one callback holds tokens for part of a
transaction. That reading makes the trigger fire nearly always, which makes it
useless. A narrower reading — tokens held across transaction boundaries — is
almost certainly what is meant, and is also what is actually checkable.

**Suggested fix.** Rephrase to "holds a non-zero token or ERC-6909 balance
between transactions, or transfers tokens to an external protocol." That version
is unambiguous and can be checked on-chain.

---

<a id="11"></a>
## 11. A worked example in §5 does not hold under the framework's own rules

**Severity: Medium.** Found by executing the rubric rather than reading it.

**Where.** Framework §5, fourth bullet:

> A medium-risk hook with a score of 7 but has custom math and price impact,
> looks like a high-risk hook regardless

**What actually happens.** We encoded this example as a test
([`cli/src/scoring/score.test.ts`](cli/src/scoring/score.test.ts)) and applied §3
and §4 mechanically. Scoring `customMath: 3`, `priceImpactingBehavior: 3`,
`teamMaturity: 1` gives a total of 7 — Medium — and fires the custom-math and
price-impact triggers. The merged plan is:

| High-tier mandatory action | Result for this hook | Source |
|---|---|---|
| Audit | **required** | Medium tier baseline |
| Math-specialist audit | **required** | §4.1 and §4.5 |
| Bug bounty | **required** | §4.5 |
| Monitoring | *recommended* | §4.1 only |

Monitoring falls short, and it is not close. The two rules that could raise it are:

- **§4.1 (custom math):** "Continuous or periodic monitoring is **recommended**
  when combined with autonomy or price-modifying behavior." Recommended, not
  required.
- **§4.5 (price impact):** "Monitoring **required** if TVL score is 5." TVL is 0
  in this example, so the condition is false.

`second-audit` also stays *optional* while the High tier calls for two audits.

So this hook receives three of the four measures the High tier makes mandatory.
"Looks like a high-risk hook regardless" overstates what the triggers deliver.

**Why it matters.** §5 is where the framework explains its own combined-trigger
logic, and this is the example that carries the argument. A team that reads it
and concludes "triggers will pull me up to High-tier practice automatically" will
skip monitoring, which is the one High-tier measure designed to catch the *silent*
failure modes §3 lists — accounting drift, delta divergence, curve deviation.
That is a bad thing to miss on a hook with custom math and price impact.

**Suggested fix.** Either soften the example to match the rules, or tighten §4.1
so that custom math combined with price-impacting behavior requires monitoring
rather than recommending it. We think the second is what was intended: a hook
that computes its own prices and modifies swap economics is precisely the profile
§3's monitoring targets were written for.

Concretely, in §4.1:

> Continuous or periodic monitoring is ~~recommended~~ **required** when combined
> with autonomy or price-modifying behavior.

---

## What we would find most valuable next

1. **Brackets for the remaining seven dimensions** (#2). Everything else is
   cosmetic next to this.
2. **The rubric as data in the repository** (#7), versioned, so tooling and the
   sheet share one source.
3. **An explicit dimension-to-trigger mapping** (#5).

We would be glad to contribute all three as PRs to
`uniswapfoundation/security-framework`; hookrisk already contains a working
implementation of each, and we would rather converge on your definitions than
maintain a competing interpretation.

---

## Positive notes

Not everything is a complaint, and a couple of things are worth saying plainly.

- **The two-layer design is genuinely good.** Making feature triggers independent
  of the total score is the right answer to self-assessment gaming, and §5 states
  the rationale clearly. It is the part of the framework we did not have to
  reinterpret.
- **§1 is unusually honest for a security document.** Naming Bunni and Balancer,
  and explicitly saying they were not v4 incidents while still drawing the lesson,
  is a level of precision that made it directly usable as a detector specification.
- **Listing competitors' tools in §11** — including Hacken's hook testing
  framework — sets a good norm, and is why hookrisk credits and integrates
  BlockSec's HookScan rather than quietly reimplementing it.
- **v4-core's test utilities are excellent.** `Deployers`, `PoolSwapTest` and
  `PoolModifyLiquidityTest` meant our differential harness could build twin pools
  against real v4 code with no mocks. That is a deliberate design choice by
  whoever wrote them and it saved us a day.

---

*Prepared by the hookrisk team. Repository: <https://github.com/0xmvercosa/hookrisk>*
*Every claim above is checkable against the pinned commits recorded in
[`harness/deps.lock`](harness/deps.lock).*
