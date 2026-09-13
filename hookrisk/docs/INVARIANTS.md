# The differential harness

## The idea

Build two Uniswap v4 pools that are identical in every field except `hooks`.
Drive both with the same sequence of actions. Anything they end up disagreeing
about is attributable to the hook and to nothing else.

That is the whole method. Its value is that it can see a class of defect static
analysis cannot express: not a missing check or a dangerous pattern, but a
number being quietly wrong.

### The motivating case

A hook that documents a 1% fee and charges 3.5%.

There is no missing access control. No proxy. No external call. No reentrancy.
Read the source and there is nothing to report — the defect is a constant.
Every swap through that pool loses 2.5% more than the documentation says, and
the only way to see it is to run the trade both ways.

That hook is [`SkimmingFeeHook`](../harness/src/hooks/FeeHooks.sol). Its honest
twin, [`HonestFeeHook`](../harness/src/hooks/FeeHooks.sol), differs by exactly
one constant.

## The three invariants

### I1 — Conservation and solvency

No token is created or destroyed by any sequence of operations.

Implemented by enumerating every holder — the test contract, the handler, the
PoolManager, the hook, every router — and comparing the sum against
`totalSupply`. That is stronger than checking the PoolManager alone: it catches
value leaking to an address nobody thought to watch, which is what a subtly
mismatched `take`/`settle` pair produces.

[`Invariants.t.sol`](../harness/test/Invariants.t.sol) · `invariant_I1_tokensAreConserved`

### I2 — No undeclared extraction

Output from the hooked pool never falls short of the vanilla pool by more than
the fee the hook declares in `hookrisk.toml`.

Note what it is asserted against: the **declared** bound, not the hook's own
constant. The point is to catch code that disagrees with its documentation, so
reading the bound out of the code would defeat the exercise.

[`Invariants.t.sol`](../harness/test/Invariants.t.sol) · `invariant_I2_noUndeclaredExtraction`

#### I2b — Price monotonicity, for custom curves

I2 presumes the hook *modifies* v4's pricing: it takes a fee, it nudges a delta,
so a shortfall beyond the declared fee is extraction.

A hook holding `beforeSwapReturnDelta` breaks that presumption. It can consume
the swap entirely, the PoolManager skips the concentrated-liquidity math, and
the hook prices the trade itself — the framework's **NoOp swap**. Its output
*should* differ from a constant-product pool, arbitrarily and by design.

Asserting I2 there would report every custom-curve hook as an extractor. That is
not a finding, it is a category error, and the kind that teaches people to ignore
the tool. So for those hooks I2 is reported `not-applicable` and this takes its
place:

> A swap selling token0 must not raise the price of token0.

Weaker, deliberately. It is the strongest statement that survives when the hook,
rather than v4, decides the price — and it holds for any curve worth trading
against. I1 and I3 are unaffected.

[`Generic.t.sol`](../harness/test/Generic.t.sol) · `invariant_I2b_priceIsMonotonic`

### I3 — Exit liveness

Every position that was opened can be closed.

Checked twice: after every withdrawal attempt during the sequence, and again in
`afterInvariant`, which runs once after the last call. That second timing is the
point. A hook that traps funds only after some number of swaps looks perfectly
healthy right up until someone tries to leave.

**This is the invariant we care most about**, and
[`test_I3_trapIsInvisibleToConservation`](../harness/test/HarnessValidation.t.sol)
says why. It drives a hook that traps liquidity and asserts that conservation
holds perfectly throughout. Nothing is stolen. The pool is solvent to the wei.
The provider simply cannot withdraw.

Solvency and liveness are different properties, and only one of them is usually
tested.

## Proving the harness detects

A harness that reports "no problems" means nothing until you have watched it
report a problem it was supposed to find. Two hooks in this repository carry
deliberate defects, and CI asserts the invariants are **violated** on them:

| Hook | Defect | Caught by |
|---|---|---|
| `SkimmingFeeHook` | Charges 350 bips, documents 100 | I2, including the magnitude to ±50 bips |
| `TrappingHook` | Blocks withdrawal after 8 swaps | I3, with the hook's own revert selector, mid-sequence and in the sweep |
| `LineCurveHook` without reserves | Every hooked swap reverts, no position can open | the observation log: every counter zero, `hookedSwapReverted` true |

These run as deterministic tests, not fuzzed ones, in
[`HarnessValidation.t.sol`](../harness/test/HarnessValidation.t.sol). An
invariant test expected to fail cannot be expressed in a build that must pass, so
the same conditions are driven by a fixed sequence and asserted directly. They
finish in milliseconds and run on every commit.

If one of them starts passing in the wrong direction — no shortfall detected, no
exit failure — the harness has gone blind. That is a far more dangerous
regression than a false positive, and it is what that file exists to catch.

## No mocks of Uniswap components

The harness builds on v4-core's own test utilities: `Deployers`, `PoolSwapTest`,
`PoolModifyLiquidityTest`, `PoolDonateTest`. There is no mock PoolManager.

A mocked PoolManager would let the harness agree with our *understanding* of v4
rather than with v4. Every invariant here is asserted against the real
implementation at a pinned commit ([`harness/deps.lock`](../harness/deps.lock)).

The one piece of test plumbing is placing the hook at a flag-bearing address.
v4 reads permissions from the low 14 bits of the address, which in production
means grinding a CREATE2 salt — slow, and irrelevant to what is under test. The
harness etches the creation code at a chosen address, runs the constructor, and
etches the resulting runtime code. That is exactly what forge-std's
`deployCodeTo` does, and it is standard practice in v4's own suite.

## Honest limits

### Price drift between the twins

The pools receive identical actions, but once the hook has taken its first fee
their reserves differ, so their prices diverge and later swaps are no longer
priced identically.

I2 therefore allows **200 basis points** of drift. Below that threshold,
extraction is indistinguishable from tick rounding and accumulated divergence.

That bound is loose enough to avoid flaky failures and tight enough to catch the
250 bips of undeclared skim in the fixture. A tighter bound without eliminating
the drift itself would produce failures against correct hooks — which, as we
found out the hard way, is worse than a slightly loose bound. An earlier version
of the handler let liquidity land on one pool and not the other; the invariant
fired at **9735 basis points against a hook behaving perfectly.**

Every mirrored operation is now wrapped in a state snapshot and rolled back
unless both sides succeed.

### Sequence budget

The `scan` profile runs 256 sequences of depth 32 — a few minutes, sized for CI.
`FOUNDRY_PROFILE=deep` runs 5000 sequences of depth 128 and is the right setting
before a deployment you intend to keep.

Absence of a counterexample within a budget is not proof. The manifest records
runs and calls so a reader can judge how hard the harness actually looked.

### Constructor shape

The harness deploys the hook itself, so it has to supply whatever the
constructor takes. Two shapes need no configuration: no arguments at all (a
factory-style hook such as `V2PairHook`), and a single `IPoolManager` or
`address` (the `BaseHook` convention). Anything else is declared in
`hookrisk.toml`, one string per constructor argument in ABI order:

```toml
[harness]
constructorArgs = ["$poolManager", "3000", "$owner"]
```

Five placeholders stand for things the harness deploys and therefore knows the
address of only at run time. Each is substituted word-for-word in the encoded
arguments before the constructor runs:

| Placeholder | Becomes |
|---|---|
| `$poolManager` | the `PoolManager` |
| `$currency0`, `$currency1` | the two pool currencies |
| `$owner` | the test contract, which is also `msg.sender` for every action |
| `$hook` | the hook's own flag-bearing address |

Everything else is passed verbatim to `cast abi-encode "constructor(<types>)"`,
with the types read from the artifact ABI, so values are written the way cast
accepts them. A count mismatch, a value cast cannot parse, or a struct argument
(not supported yet) is reported as a skip that names the ABI types and the
config key — `HR-E305` — rather than as a deployment that reverts for a reason
nobody can read.

A dynamic layer that quietly declines to run is worse than one that says it did
not. Every reason the harness declines is in the manifest, under
`engines[engine = "harness"].reason` and repeated on each skipped invariant.

### Permissions the harness cannot see in the source

The CLI reads `getHookPermissions()` out of the target file to place the hook
at a flag-bearing address. Most hooks in the wild inherit that function from a
base contract (every OpenZeppelin-based hook does), and the file being scanned
does not contain it.

Those hooks are not skipped. The CLI passes `HOOKRISK_FLAGS=0` together with
the compiled runtime code, and the harness derives the flags itself: it etches
the runtime code at a scratch address, calls `getHookPermissions()` on it, and
deploys at the address those bits describe. The manifest records what was
found under `permissions.fromRuntime`, with `permissions.harnessRun.permissionsDerived`
set, so a reader can tell "read from the source" apart from "read from the
bytecode" — and `customCurve` from that record, not the source, decides
whether I2 or I2b applies.

### Hooks that refuse PoolManager liquidity

A custom-curve hook that keeps its own reserves commonly reverts
`beforeAddLiquidity` outright: no v4 liquidity is allowed in its pool. The
harness's initial seeding of the hooked pool then fails inside a callback.

Before the run record existed this surfaced as a `setUp()` failure the CLI did
not read, and the scan reported zero invariants with status `ok` — a dynamic
layer that had not run, reporting exactly what a clean hook reports. Now:

- the harness records `seeded = "hooked-failed"` and the wrapped revert;
- a custom-curve hook is assessed normally, since it prices trades without
  v4 liquidity — *if it has reserves*. The harness cannot drive a hook's own
  liquidity path, so a custom curve that keeps its reserves behind its own
  `addLiquidity` (Orbital, constant-sum) has none, and every hooked swap
  reverts. Its invariants then hold over nothing, and the observation log
  below is what stops that from being reported as three passes;
- a hook **without** a custom curve cannot trade in that state, so I2 and I3
  are `not-applicable` with the reason, and I1 is still reported;
- any other `setUp` failure is a harness **failure** (`HR-E304`): the engine
  row says `failed`, every invariant is `inconclusive`, and the reason names
  the callback and the hook's own error, unwrapped from v4's ERC-7751
  `WrappedError` down to `Error(string)`, `Panic(uint256)` or the four-byte
  selector.

`coverage.dynamicAnalysisSkipped` is true in every one of these cases where no
invariant was measured, not only under `--skip-dynamic`; `coverage.harnessStatus`
says which.

#### The static layer sees the same fact

`hookrisk-disabled-callback` classifies a liquidity callback that is overridden
with a deliberate revert (`callback-intentionally-disabled`, INFO). The
harness's `seeded: "hooked-failed"` is that revert, observed. The CLI's
`reconcileLayers()` (`cli/src/reconcile.ts`) joins them:

- classification on `beforeAddLiquidity` **and** `hooked-failed`: one finding,
  two engine attributions (`hookrisk` / `hookrisk-disabled-callback` and
  `harness` / `seed-reverted`), confidence `high`, evidence naming the revert;
- `hooked-failed` with no classification: a harness-sourced
  `callback-intentionally-disabled` at `medium` confidence — execution proves
  the refusal, not the intent;
- when both agree, **I3 is `not-applicable`** with a detail naming the revert:
  no position can exist on the hooked pool, so exit liveness has nothing to
  assert. A *failed* I3 is never overwritten.

### A pass over nothing is not a pass

Every invariant is a statement about the state after a sequence. If the
sequence landed no swap and opened no position, the statement held over
nothing. Before the observation log existed, a custom-curve hook that rejects
PoolManager liquidity and has no reserves reported `I1 passed, I2 passed, I3
passed` after 256 sequences in which every hooked swap reverted and every
liquidity add was rolled back — byte for byte the report of a hook the harness
had actually exercised.

`afterInvariant` now appends the handler's counters for the sequence to
`harness/out/hookrisk-obs-<RUN_ID>.jsonl`, and the CLI sums them. A `passed`
row whose relevant count is zero becomes `inconclusive`, with the counts in
its detail:

| Invariant | Relevant count | Detail starts with |
|---|---|---|
| I1 | `swapsExecuted + positionsOpened` | `passed vacuously: 0 swaps landed and 0 positions opened across N sequences` |
| I2 (output comparison) | `swapsCompared` | `passed vacuously: 0 swaps compared …` |
| I2b (custom curve) | `priceChecks` | `passed vacuously: 0 price checks …` |
| I3 | `positionsOpened` | `passed vacuously: 0 positions opened …` |

`swapsExecuted` counts swaps that landed on **both** pools; an attempt the
vanilla pool refused or the hook reverted is rolled back and does not count
(`swapsAttempted` does, and is not in the log). When the seed was rejected or
hooked-only swap reverts were seen, the detail says so, because that is
usually why the pool was idle. A `failed` row is never touched: a failure is
evidence whatever the counters say.

The summed counters are exposed for the manifest (`coverage.observations`)
so a reader can see how hard the harness actually looked, alongside `runs`
and `calls`.

The handler's own recording had a defect the log's first test exposed:
`hookedSwapReverted` and the mid-sequence `exitReverted` were written *before*
`vm.revertToState`, which restores the handler's storage along with the
pools', so both were silently undone and `invariant_I2_hookDoesNotBlockSwaps`
could never fire. They are now recorded after the rollback;
`TrappingHookIsCaught` and `IdlePoolIsObservedAsIdle` pin it.

## Execution probes: three questions the campaign cannot always ask

The fuzz campaign reaches a callback only when a swap or a position lands on
the hooked pool. Six of the fifteen real hooks the harness was pointed at let
neither land — the hook refuses PoolManager liquidity and has no reserves of
its own, so every hooked swap reverts — and their callbacks were never
executed at all. Before the campaign, `setUp` therefore calls every
implemented callback directly, three times, and records the answers in the
run record under `probes`. Implemented means the corresponding bit is set in
the permission word the harness deployed under: those are the callbacks the
PoolManager would call.

[`HookProbes.sol`](../harness/test/HookProbes.sol) · `TwinPools._probeHook`

| Probe | The call | Verdicts |
|---|---|---|
| `eoaGuard` | each callback, from `0xBEEF` (not the PoolManager, no code), with well-formed arguments for the hooked pool | `guarded` it reverted with the hook's own error · `unguarded` it returned · `reverted-other` it reverted with a v4-core error or a `Panic` |
| `selectors` | each callback, as the PoolManager, same arguments | `ok` the first return word is the callback's selector · `wrong-selector` it returned something else (or nothing) · `reverted` |
| `exclusivity` | a second pool initialised with the same currencies and hook but doubled tick spacing (retrying with the dynamic-fee flag as `_initHookedPool` does), then the first implemented swap-or-liquidity callback as the PoolManager with *that* pool's key | `rejected` it reverted · `accepted` it returned · `not-applicable`, with `exclusivityReason` |

The first two are the executed form of HS-01 and of the "wrong return type"
class; the third has no static counterpart in hookrisk.

### Every probe runs inside `unlock`, and the unlock always reverts

A callback commonly calls back into the PoolManager — `take`, `settle`,
`updateDynamicLPFee` — and each of those needs the manager unlocked. Called
cold, a perfectly good fee-taking `afterSwap` reverts `ManagerLocked`, which
says nothing about the hook. So the probe takes the lock itself: it calls
`manager.unlock`, and the hook call is made from inside `unlockCallback`.
That is also how an attacker drives an unguarded callback (Cork's `beforeSwap`
was called from the attacker's own unlock callback), so the `eoaGuard` probe
models the real threat rather than a cold call.

Whatever the hook did in there — fees taken, counters bumped, a second pool
initialised — must not leak into the campaign, and the probe must not have to
settle what the hook took. The callback therefore ends by *reverting* with the
outcome ABI-encoded as the reason (`ProbeOutcome(stage, ok, data)`); the
PoolManager undoes everything and hands the reason back. One unlock per hook
call, so every probe sees the same starting state, and the revert is the
rollback. `EoaGuardProbeIsRight.test_probesLeaveNoState` and
`ExclusivityProbeIsRight.test_theSecondPoolIsRolledBack` pin that.

### What the verdicts do and do not mean

- **`guarded` over-approximates.** Any revert that is not a v4-core error or a
  `Panic` counts, so a hook that rejects the *arguments* with its own error
  before checking the caller is also `guarded`. The probe cannot tell those
  apart; a false `guarded` only loses a finding HS-01 still makes statically,
  whereas a false `unguarded` would accuse, so the ambiguity is resolved in
  the hook's favour. The v4-core allowlist is a list in `HookProbes.isV4Error`,
  kept explicit so a v4-core bump that adds an error is a one-line diff.
- **`reverted` under the selector probe is not proof of a defect.** The
  arguments are well-formed but generic: no `hookData`, the probe contract as
  `sender`, a small exact-input swap, a ±6000-tick position. A hook that
  needs reserves of its own, a whitelisted router or encoded `hookData`
  reverts for its own reasons. The unwrapped revert is recorded
  (`selectorReverts`) so the report can say which; the CLI reports it at
  `medium` confidence, and not at all for a callback a
  `callback-intentionally-disabled` finding already names.
- **`accepted` is a classification.** Multi-pool hooks are the norm
  (`Counter`, every OpenZeppelin mock, `TrappingHook`). The point is to tell
  the reader that anyone can attach a second pool with a different fee or
  spacing to this hook, and the hook will serve it — a hook whose logic
  assumes one pool must compare the key itself.
- **Exclusivity needs a callback that works on the right pool.** Only a
  callback whose selector verdict is `ok` is driven with the foreign key: a
  revert on the wrong key proves nothing when the same call reverts on the
  right one (a custom curve with no reserves reverts everywhere). With no
  such callback the verdict is `not-applicable` and the reason says why;
  likewise when no second pool can be initialised (a one-shot
  `beforeInitialize`), with the hook's own revert as the reason.

### Proving the probes detect

| Hook | Planted answer | Test |
|---|---|---|
| `UnguardedCallbackHook` | `afterSwap` has no caller check and writes state; `beforeSwap` is guarded inline | `EoaGuardProbeIsRight` — `unguarded` / `guarded`, and the write rolled back |
| `HonestFeeHook` (control) | BaseHook's `onlyPoolManager` on every wrapper; `afterSwap` calls `take` | `EoaGuardProbeIsSilentOnBaseHook` — `guarded`, selector `ok` from inside the unlock |
| `WrongSelectorHook` | `beforeSwap` returns `afterSwap`'s selector | `SelectorProbeIsRight` — `wrong-selector`, and the PoolManager's `InvalidHookResponse` on a real swap |
| `LineCurveHook` | `beforeSwap` reverts without reserves, works with them | `SelectorProbeRecordsTheRevert` — `reverted` with the reason, then `ok`; exclusivity `not-applicable` then `accepted` |
| `PoolBoundHook` | compares `key.toId()` to the first pool's | `ExclusivityProbeIsRight` — `rejected`; `TrappingHook` — `accepted`; `DynamicFeeHook` — `not-applicable` |

The classification rules themselves — the allowlist, the `Panic` rule, the
short-return rule — are pinned in `ProbeClassificationRules`.

### How the CLI reads them

`reconcileLayers` (`cli/src/reconcile.ts`) maps the record to findings, with
HS-01 as the static half, the same way the seed revert is joined with
`callback-intentionally-disabled`:

| Probe verdict | Finding |
|---|---|
| `eoaGuard: unguarded` on a callback HS-01 reports | that finding gains `harness` / `eoa-guard-probe`, confidence `high` |
| `eoaGuard: unguarded`, no HS-01 | harness-sourced `unprotected-hook-callback`, HIGH, confidence `medium` |
| `exclusivity: accepted` | INFO classification `unvalidated-pool-key` on the contract; informs no dimension |
| `selectors: wrong-selector` | HIGH `callback-selector-mismatch` per callback, confidence `high` |
| `selectors: reverted` | HIGH `callback-selector-mismatch` per callback, confidence `medium`, revert in the evidence; suppressed on a callback classified intentionally disabled |

Harness-sourced findings are anchored on the target file, at the line of the
static engine's `hook-profile` for it when there is one and line 1 otherwise:
the harness executes bytecode and has no line of its own.

## The contract between the CLI and the harness

Everything crosses the process boundary as environment variables in and one
JSON file out. The variables the CLI sets on `forge test --match-contract
GenericHookInvariants`:

| Variable | Meaning |
|---|---|
| `HOOKRISK_ARTIFACT` | `File.sol:Contract`, for logging and for `vm.getCode` on the repository's own fixtures |
| `HOOKRISK_CREATION_CODE` | hex creation bytecode from the artifact |
| `HOOKRISK_RUNTIME_CODE` | hex `deployedBytecode` from the artifact; used to derive permissions when `HOOKRISK_FLAGS` is 0 |
| `HOOKRISK_FLAGS` | decimal flag word from the source declaration; `0` means "derive from the runtime code" |
| `HOOKRISK_CONSTRUCTOR_ARGS` | hex ABI-encoded constructor arguments with the placeholders above; empty means the legacy behaviour (`abi.encode(manager)` for a one-argument constructor, nothing for zero) |
| `HOOKRISK_MAX_FEE_BIPS` | the declared fee bound from `hookrisk.toml` |
| `HOOKRISK_CUSTOM_CURVE` | `1` when the source declares `beforeSwapReturnDelta`; overridden by the harness when it derived the flags itself |
| `HOOKRISK_RUN_ID` | opaque token naming the run record and the observation log |

At the **end** of a successful `setUp` the harness writes
`harness/out/hookrisk-run-<RUN_ID>.json`:

```json
{"flags": 2184, "customCurve": true, "dynamicFee": false,
 "permissionsDerived": true, "seeded": "hooked-failed", "hookedSeedRevert": "0x…",
 "probes": {"eoaGuard": {"beforeAddLiquidity": "guarded", "beforeSwap": "guarded"},
            "exclusivity": "not-applicable",
            "exclusivityReason": "every swap or liquidity callback reverts on the hook's own pool, …",
            "selectors": {"beforeAddLiquidity": "reverted", "beforeSwap": "reverted"},
            "selectorReverts": {"beforeAddLiquidity": "0x08c379a0…", "beforeSwap": "0x4e487b71…"}}}
```

`dynamicFee` means the hooked pool had to be initialised with
`LPFeeLibrary.DYNAMIC_FEE_FLAG` because a static fee reverted. `probes` holds
the execution probes' verdicts (see above), one entry per implemented
callback; `exclusivityReason` and `selectorReverts` appear only when they have
something to say. The CLI's `parseRunRecord` refuses a verdict, callback name
or shape it does not know, so a harness that starts writing a new word fails
the run rather than reading as clean. The CLI reads the record, deletes it,
and copies it into the manifest under `permissions.harnessRun`. Its absence
after a run whose permissions were to be derived is itself a failure: the
invariants would otherwise be vouching for a configuration nobody can see.

After **every completed sequence**, `afterInvariant` appends one line to
`harness/out/hookrisk-obs-<RUN_ID>.jsonl`:

```json
{"swapsExecuted":3,"swapsCompared":3,"swapsSkipped":0,"hookedSwapReverted":false,
 "positionsOpened":1,"positionsClosed":1,"donations":1,"priceChecks":3,
 "monotonicityViolations":0,"exitFailures":0}
```

Forge runs each `invariant_*` function's sequences separately and in
parallel, so the log holds roughly `runs × invariant functions` lines (1285
for the `scan` profile's five functions) and is appended to from several
threads at once. Each object is written with its own trailing newline in a
single write, so objects cannot interleave; forge's `writeLine` adds a second
newline, and the blank lines are padding the reader skips. The CLI reads and
deletes the log, sums it, and refuses a line it cannot parse. A run record
without a log is a **failure**: `setUp` finished and forge reported rows, yet
nothing says what the sequences exercised.

### Concurrent scans

Two scans at once share `harness/out` and `harness/cache`. This was tested
rather than assumed: two `forge test --match-contract GenericHookInvariants`
processes were started simultaneously in one harness checkout with different
run ids and different hooks (the corpus `CleanHook` and the harness
`HonestFeeHook`), once on a built project and once after `rm -rf out cache`
so both compiled at the same time. Both runs exited 0 with all five invariant
rows, both run records were correct, both observation logs held 1285 intact
lines and no malformed one, and the artifacts (`out/IHooks.sol/IHooks.json`,
which the CLI's dedupe layer reads) were intact afterwards. The per-run files
are keyed by a random id, so nothing is shared by name. No lock is taken;
if a future forge release changes how artifacts are written, a lock file in
`harness/out` with a bounded wait in `runHarness` is the place to add one.

The artifact directory and the compiler version come from `forge config --json`
in the target project (`out` and `solc`; when `solc` is unset, from the
artifact's `metadata.compiler.version`), so a project with `out = 'foundry-out'`
— Uniswap's own hooks repository — is found rather than told to build. Only when
forge itself cannot be run are `out/` and 0.8.26 assumed, and the manifest says
so under `target.projectConfigSource`.

### What it does not model

Fee-on-transfer, rebasing and ERC-777 tokens; multi-hop routing through several
hooked pools in one transaction; and cross-chain state. The framework names all
of these as risk surfaces, and none of them is exercised here yet.

## Reading a failure

When an invariant fails, the manifest carries the counterexample and — where
available — the hook's own revert.

v4 does not propagate a hook's revert verbatim. `CustomRevert.bubbleUpAndRevertWith`
wraps it as ERC-7751 `WrappedError(address,bytes4,bytes,bytes)`, so the raw bytes
a caller sees identify v4's wrapper, not your error. Reporting
`WrappedError(0x…, 0x21d0ee70, 0x…)` tells nobody anything.

The handler unwraps the chain to the root cause, so an I3 failure names the
branch in *your* hook that rejected the withdrawal, and keeps the raw bytes
alongside it.

[`TwinHandler.sol`](../harness/test/TwinHandler.sol) · `_rootCause`

## Running it

```bash
# Against the fixtures in this repository
make test-harness

# Against your own hook, via the CLI
forge build                                  # in your project
npx hookrisk scan src/MyHook.sol:MyHook

# Overnight, before you ship
make deep
```
