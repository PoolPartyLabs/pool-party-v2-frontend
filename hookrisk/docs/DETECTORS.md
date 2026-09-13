# Detectors

hookrisk's static layer is a Slither plugin. Each detector declares which
framework dimensions and triggers its findings inform, so a new detector
participates in scoring without being wired in twice.

Detectors only run against contracts that actually implement `IHooks` callbacks.
Without that scoping, a scan reports missing PoolManager checks on every ERC20 in
`lib/`, and a tool that cries wolf on dependencies is one nobody runs twice. The
one exception is the [unsupported-ABI](#unsupported-abi) classification, which
exists precisely for the contracts that scoping excludes.

| Rule | Finds | Impact | Status |
|---|---|---|---|
| [HS-01](#hs-01) | Callback anyone can call | High | ✅ |
| [HS-02](#hs-02) | Permissions vs implementation; a returns-delta flag whose callback only returns zero | High / Medium | ✅ |
| [HS-03](#hs-03) | Admin surface: unguarded mutator of callback-read state (High), owner-only one (Medium) | High / Medium | ✅ |
| [HS-05](#hs-05) | External call in the swap path to a third party | Medium | ✅ |
| [HS-06](#hs-06) | Dynamic fee or lpFeeOverride with no ceiling | Medium | ✅ |
| [HS-07](#hs-07) | Custom accounting in use | Info | ✅ |
| [disabled-callback](#disabled-callback) | Callback refused by design | Info | ✅ |
| [unsupported-abi](#unsupported-abi) | Hook on an interface hookrisk cannot read | Info | ✅ |
| [hook-profile](#hook-profile) | Per-contract profile: permissions, callbacks, complexity metrics | Info | ✅ |
| [HS-04](#not-yet-implemented) | Upgradeability | — | ✖ (covered by BlockSec) |
| [HS-08](#not-yet-implemented) | Rounding direction | — | ✖ |

---

<a id="hs-01"></a>
## HS-01 — Unprotected hook callback

`hookrisk-unprotected-callback` · rule class `unprotected-hook-callback`

### The defect

v4 invokes hook callbacks from the PoolManager and only from the PoolManager.
`IHooks` says so: *"Should only be callable by the v4 PoolManager."*

A callback that does not enforce this is directly reachable by anyone, with a
caller-supplied `PoolKey` and caller-supplied `hookData`. The hook then updates
state, or moves value, for a pool it was never installed on, with parameters the
PoolManager would never have produced. No tokens need to move for the damage to
be done: a corrupted volume counter poisons every TWAP, dynamic fee and reward
accrual that trusts it.

### How it detects

**Structurally, never by name.** The check traces an actual comparison between
`msg.sender` and the state variable holding the pool manager — through the
function body, every modifier attached to it, and every internal call it makes.

Name matching would be wrong twice over. `BaseHook` has already moved once, from
v4-periphery to OpenZeppelin's `uniswap-hooks`, so a detector keyed on a modifier
name breaks on library churn. Worse, it is defeated by

```solidity
modifier onlyPoolManager { _; }   // enforces nothing
```

which is exactly the shape a deliberately malicious hook would take.

[`hook_analysis.py`](../detectors/slither_hookrisk/utils/hook_analysis.py) ·
`guards_pool_manager`

### Known trade-off

We do not additionally verify that the false branch reverts. Doing so needs
whole-path reasoning that Slither's IR makes awkward, and the residual false
negative — a comparison whose result is computed and discarded — essentially
never occurs by accident. The false *positive* direction, which decides whether
people leave a detector enabled, is unaffected.

### Prior art

BlockSec's HookScan detects this class from bytecode as `UniswapPublicHook`.
hookrisk implements it at source level anyway: the two engines disagree often
enough to be worth reconciling, source level gives a precise line for the SARIF
annotation on a pull request, and putting the most important access-control check
behind a Docker dependency would be a poor default. When both run and agree, the
findings merge into one at high confidence.

---

<a id="hs-02"></a>
## HS-02 — Permission and implementation divergence

`hookrisk-flag-divergence` · rule class `flag-implementation-divergence`

**As far as we can tell, no other v4 tool checks this.**

### The defect

A hook's permissions are not stored anywhere. They are the low 14 bits of its
deployed address, chosen by grinding a CREATE2 salt. Three things must agree and
nothing enforces that they do:

1. the bits in the deployed address — what the PoolManager obeys;
2. `getHookPermissions()` — what the constructor validates the address against;
3. the callbacks the contract actually implements.

`Hooks.validateHookPermissions` checks (1) against (2). **Nothing checks either
against (3).**

### Two failure modes

**Permission declared, callback not implemented.** The PoolManager will invoke
it. With OpenZeppelin's `BaseHook` the delegate reverts with
`HookNotImplemented()`, so *every swap through the pool reverts*. The pool is
bricked for that operation and cannot be fixed without redeploying to a new
address. Invisible until someone touches the pool.

**Callback implemented, permission not declared.** The PoolManager never calls
it. Fee logic that never runs, an access check that never fires, a TWAP that
never updates. The framework names this in §1.11, *Permission Encoding & Salt
Grinding Pitfalls*. It is the more dangerous direction, because everything
appears to work while the mechanism you built is simply absent.

A third case is also reported: a returns-delta permission declared without its
parent action flag. `Hooks.isValidHookAddress` rejects that outright, so no
address satisfying those permissions can initialize a pool — worth catching
before a salt grind rather than after.

### One subtlety worth knowing

"The contract has a `beforeSwap`" is true of every `BaseHook` descendant and
tells you nothing: the base implements all ten callbacks, each delegating to an
internal `_beforeSwap` whose default body reverts. What matters is whether the
delegate does work.

Getting that wrong breaks the detector in both directions — treat stubs as
implementations and every BaseHook hook appears to implement all fourteen
permissions; treat delegating callbacks as stubs and no hook implements anything.
Resolving it also requires re-resolving virtual dispatch, because Slither's
`internal_calls` point at the *base's* delegate even when the contract overrides
it.

### A revert is not always a stub

Four of fourteen real hooks we scanned declare a liquidity permission and
override the delegate with a revert of their own — `LiquidityNotAllowed()`,
`AddLiquidityDirectToHook()`, `"No v4 Liquidity allowed"`,
`"Use custom removeLiquidity"`. Same IR shape as the `HookNotImplemented()`
stub, opposite meaning: the permission is declared *so that* the PoolManager
routes there and is refused. Reporting that as "the pool is unusable" at High
was wrong on four of fourteen hooks, in the direction that gets a tool switched
off.

So every callback is classified rather than tested with a boolean:

| Verdict | Meaning | HS-02 |
|---|---|---|
| `IMPLEMENTED` | the delegate can return | reports if the permission is **not** declared |
| `STUB` | not overridden, or the override reverts `HookNotImplemented()`, or it lives under a dependency path | reports at High if the permission **is** declared |
| `INTENTIONALLY_DISABLED` | project-owned delegate, any other unconditional revert | silent — [disabled-callback](#disabled-callback) reports it |

Both halves of the `INTENTIONALLY_DISABLED` rule matter. Hooks routinely vendor
`BaseHook` into `src/base/` (WETHHook does), which makes the stub project-owned
without making it intentional; the error's name is what separates the two.

HS-02 also stays silent on a callback that exists only under a pre-current
signature (see [unsupported-abi](#unsupported-abi)): an old signature is not a
missing body, and the classification names it instead.

### Discriminators

Two HS-02 findings can anchor on the same contract — Orbital declares both
`beforeAddLiquidity` and `beforeRemoveLiquidity` as refusals — and the CLI's
de-duplication, which exists so two *engines* reporting one defect are counted
once, collapsed them into one. Every finding now carries
`hookrisk.discriminator`: the permission field for HS-02, the callback name for
HS-01 and disabled-callback. Same class, same element, different discriminator
means different finding.

### A third case: the flag declared, the delta never returned

`afterSwapReturnDelta: true` while `_afterSwap` returns `int128(0)` (or
`ZERO_DELTA`) on every path. Not a liveness bug — the pool works — but the
address carries a custom-accounting bit for nothing: HS-07 classifies the
hook as a custom curve, the harness swaps its invariants, and a reviewer
budgets a math audit, all on a declaration the code contradicts. Reported at
**Medium**, discriminator the field name, anchored on the developer's
delegate.

Silent when the delta is computed or comes from a call
(`toBeforeSwapDelta(...)`): the claim is "can never be non-zero", not "is
zero on some path". Silent too when the delegate is not fully lifted to IR
(HR-E205): OpenZeppelin's `BaseDynamicAfterFee._afterSwap` at some pins keeps
its early `return (selector, 0)` and loses the computed one, and "every
path" would then mean "every path the tool read". HookGuard has the same idea
as `DELTA_FLAG_UNUSED` (a regex for a zero second element); this one follows
the delegate and its return statements.

[`hook_analysis.py`](../detectors/slither_hookrisk/utils/hook_analysis.py) ·
`classify_callback`, `unconditional_revert`, `is_project_source`, `resolve_override`,
`returned_values`, `fully_lifted`

---

<a id="hs-03"></a>
## HS-03 — Admin surface

`hookrisk-admin-surface` · rule class `admin-surface` · **High** (unguarded) / **Medium** (owner-only)

### The defect

A hook's callbacks read parameters — a fee, a pause flag, a whitelist, an
oracle address — that some external function writes. Who may call that
function decides how much of the swap's economics is in a third party's hands.

- **Unguarded, High.** A public or external function writes a scalar the
  callbacks read, or calls `updateDynamicLPFee`, and compares `msg.sender`
  to nothing at all. Hacken's audit guide lists exactly this
  (`updatePool(address)` callable by anyone) next to the missing PoolManager
  check; their checker brute-forces eight setter selectors to find it.
- **Owner-only, Medium.** The same function restricted to an owner or a role:
  the framework's "autonomous parameter updates / admin key" concern. The
  finding lists the callback-read variables the function writes, so the
  reader can judge what the key controls; the scorer raises
  `autonomousParameterUpdates` from it.

### How it detects

Structural, like HS-01, generalised. `access_guard` walks the body, every
modifier and every internal callee (override-resolved), binding parameters to
sender-derived arguments, and recognises two shapes:

- a **comparison** (`==`/`!=`) between a sender-derived value and an
  *authority* — a state variable, `address(this)`, a non-zero constant, or a
  callee result read from storage (`owner()`). `from == address(0)` inside
  ERC20's `_update`, reached from `_burn(msg.sender, ...)`, is a null check
  and does not count;
- a **role lookup**: a mapping read keyed by a sender-derived value whose
  result decides a branch or a `require` without passing through arithmetic.
  That is OpenZeppelin's `AccessControl` (`onlyRole` → `_checkRole` →
  `hasRole` → `_roles[role].hasRole[account]`), which has no `==` anywhere.
  The "no arithmetic" rule is what keeps `orderInfo.liquidity[msg.sender] == 0`
  — a balance check in a limit-order hook's `cancelOrder` — from counting.

A comparison against the PoolManager is HS-01's guard (the function is the
PoolManager's, not an administrator's) and such functions are skipped, as is
`unlockCallback`.

### The mapping rule, and what it misses

For the **unguarded** shape only *non-mapping* state counts. A limit-order
hook's `placeOrder` writes `_orderInfos[id]` — state its `afterSwap` reads —
and is rightly callable by anyone: per-user records live in mappings,
parameters live in scalars. An unguarded write to a mapping the callbacks
read (an open whitelist, a per-pool config keyed by `PoolId`) is therefore
**missed** by this shape. The owner-only shape keeps the broad rule because
the guard already says the writer is privileged; it also counts
`take`/`settle`/`transfer` (a privileged sweep). An unguarded value move is
not reported: telling a user's `withdraw` from an open sweep needs the
accounting, not the call.

The guard's own bookkeeping — Ownable's `_owner`, AccessControl's `_roles`,
which a callback running `onlyOwner` reads — is excluded from "state the
callbacks read", so `transferOwnership` is not an economic lever. Per-user
authorisation (`msg.sender == orders[id].owner`) compares against a mapping
read and is not recognised as a guard; a function relying on it that writes a
callback-read scalar would be reported as unguarded.

### On real hooks

CorkHook: `updateBaseFeePercentage` and `updateTreasurySplitPercentage` at
Medium (owner-only, writing the pool config `beforeSwap` reads).
StablePairHook: `initializePool` at Medium through `onlyRole` — the
AccessControl surface the profile used to report as absent. OpenZeppelin's
`BaseDynamicFeeMock.setFee` and `BaseOverrideFeeMock.setFee` at High: the
mocks ship an unguarded fee setter. Nothing on `Counter` or `AntiSandwichMock`.

[`hs03_admin_surface.py`](../detectors/slither_hookrisk/detectors/hs03_admin_surface.py) ·
[`hook_analysis.py`](../detectors/slither_hookrisk/utils/hook_analysis.py) ·
`access_guard`, `guard_kind`, `entry_point_mutators`, `callback_read_state`

---

<a id="hs-05"></a>
## HS-05 — External call in the swap path

`hookrisk-external-call-in-swap-path` · rule class `external-call-in-swap-path` · **Medium**

### The defect

`beforeSwap` and `afterSwap` run inside every swap on every pool the hook is
attached to. A call from there to a third party — a price oracle, another
protocol, an address read from storage, the swapper's own contract — makes
each of those swaps depend on that address being live and returning. An
oracle that pauses pauses the pool. That is a liveness consequence before it
is a correctness one, which is why the finding distinguishes an *unhandled*
call (not inside `try`) from a handled one, and a static read from a
state-changing call. HookGuard's `REVERT_DOS_RISK` is the same framing with
a regex; the framework scores the class as `externalDependencies`.

### How it detects

`external_calls_in(swap_path_functions(...))` was already computed for the
profile's raw count. `classify_destination` now sorts each call: library
calls Slither surfaces as high-level calls on a library contract
(`StateLibrary`, `CurrencyLibrary`) are not external; the PoolManager, by
variable or by type, is the pool itself; a `Currency`-typed destination, or
an ERC-20 interface whose address came from `key.currency0`/`key.currency1`
(through `Currency.unwrap` or a plain conversion) is the pool's own token.
Everything else is a third party, reported once per destination — named by
the variable it was read from, or by the call that produced it
(`getCurrencyYieldSource()`), never as `TMP_17`.

The finding carries `metrics: {destination, isStatic, unhandled}` so the
scorer can weigh a static read below a state-changing dependency, and the
profile carries `externalCallsInSwapPathThirdParty` next to the raw count.

### What it misses

Whether the call is *safe*: an oracle can be correct and still be a
dependency. A call on an ERC-20 whose address is not derived from the key in
the same function is a third party even when it is, in fact, one of the
pool's tokens (a token address cached in storage). Low-level calls are
reported as unhandled unless inside `try`; whether the hook checks the
success flag is not analysed.

### On real hooks

CorkHook: three destinations — `forwarder` (state-changing, unhandled),
`sender` (the swapper's flash-swap callback) and a static read on the
config contract; the profile's raw count of 5 becomes a third-party count of
5. OpenZeppelin's re-hypothecation mocks: the ERC-4626 yield source, named by
`getCurrencyYieldSource()`. `AntiSandwichMock` (2 raw calls, both on the
PoolManager) and `Counter`: none.

[`hs05_external_call.py`](../detectors/slither_hookrisk/detectors/hs05_external_call.py) ·
[`hook_analysis.py`](../detectors/slither_hookrisk/utils/hook_analysis.py) ·
`classify_destination`, `third_party_calls`

---

<a id="hs-06"></a>
## HS-06 — Unbounded dynamic fee

`hookrisk-unbounded-dynamic-fee` · rule class `unbounded-dynamic-fee` · **Medium**

### The defect

A hook sets the pool's LP fee two ways: `poolManager.updateDynamicLPFee(key,
fee)`, or an `lpFeeOverride` returned from `beforeSwap` with
`OVERRIDE_FEE_FLAG` set. The PoolManager rejects only fees above 100 %.
Everything below is the hook's word, and if the value comes from a storage
slot an owner can set, from an oracle, or from the `hookData` the swapper
supplies, nothing in the contract says what the next swap will pay. Hacken's
guide calls this "excessive or invalid `lpFeeOverride`"; HookGuard fires the
same idea on 11 % of real hooks with two regexes.

### How it detects

Provenance, not names. From each fee site the value is traced back through
SlithIR — assignments, conversions, arithmetic, internal calls
(override-resolved, so `_getFee` lands on the hook's override), struct
fields, mapping reads, `abi.decode` — to its sources. For a state variable
the functions that write it are traced too, because
`setFee(uint24 f) { require(f <= MAX_FEE); fee = f; }` is where a ceiling
normally lives.

The fee is **bounded** when, anywhere along that chain, a variable of the
chain is compared (`<`, `<=`, `>`, `>=`) against a `constant` or
`immutable` (a ternary clamp is an `if` on that comparison), masked with a
constant, passed to `LPFeeLibrary.validate`/`isValid`, clamped with `min`,
or is itself a constant. Otherwise the finding names the sources
(`state variable \`fee\`, parameter \`newFee\` of setFee`;
`caller-supplied data (abi.decode)`; `external call \`oracle.currentFee\``)
and says what a ceiling would look like. A `beforeSwap` return without the
override flag on its chain is the pool's own fee and is ignored.

### What it misses

A ceiling enforced somewhere the chain does not reach — a governance
contract that only proposes valid fees, an off-chain keeper — is invisible,
and reported: the contract cannot prove it. A comparison against a *mutable*
state variable (`fee <= maxFee` where `maxFee` is itself settable) is not a
ceiling and does not count. Arithmetic is bounded only when every operand
is, so `baseFee + volatility` with a bounded `baseFee` and an unbounded
`volatility` is reported, correctly.

### On real hooks

OpenZeppelin's `BaseDynamicFee` and `BaseOverrideFee` mocks: reported, at the
base's `_afterInitialize`/`_beforeSwap` — the mocks' `setFee` has no ceiling,
so the fee really is unbounded. CorkHook does not set an LP fee (its fee is
taken through a returns-delta) and is silent. Nothing on `Counter` or
`AntiSandwichMock`.

[`hs06_dynamic_fee.py`](../detectors/slither_hookrisk/detectors/hs06_dynamic_fee.py)

---

<a id="hs-07"></a>
## HS-07 — Custom accounting in use

`hookrisk-custom-accounting` · rule class `custom-accounting` · **classification, not a defect**

A returns-delta permission lets the hook alter settled amounts, and in the limit
consume the entire swap so the PoolManager skips the concentrated-liquidity math
— the framework's §1.10 NoOp swap, which is another way of saying the hook is now
the market maker.

Reported at INFO because there is nothing to fix. It exists so two mechanical
consequences are traceable:

- **Scoring.** Fires the custom-math and price-impact triggers, which mandate a
  math-specialist audit regardless of the total score.
- **Invariants.** Changes what the harness may assert. I2 becomes inapplicable
  and price monotonicity takes its place. See [INVARIANTS.md](INVARIANTS.md).

The manifest marks these `isClassification: true`, and the gate ignores them —
failing a build for a legitimate design choice would be indefensible.

---

<a id="disabled-callback"></a>
## Callback intentionally disabled

`hookrisk-disabled-callback` · rule class `callback-intentionally-disabled` · **classification, not a defect**

The hook declares a permission and overrides the callback, in its own sources,
with a revert of its own choosing. The PoolManager-routed operation is refused by
design: the hook is the market maker and liquidity goes through its own deposit
path. The finding names the callback, the error, and the operation
("PoolManager-routed liquidity addition is disabled by design").

Reported at INFO because there is nothing to fix. Two consumers act on it:

- **The reader**, who sees *why* direct liquidity reverts instead of an
  accusation or silence.
- **The harness**, whose twin-pool setUp seeds both pools through the
  PoolManager. A hook classified here rejects that seeding; the harness records
  `seeded: "hooked-failed"` rather than treating the revert as a finding.

Anchored on the developer's delegate, so it survives `--exclude-dependencies`
and points at the line that refuses. Reported only when the permission is
declared (or none are declared and the address bits decide): a refusal the
PoolManager never routes to is unreachable code, which is HS-02's business.

---

<a id="unsupported-abi"></a>
## Unsupported hook ABI

`hookrisk-unsupported-abi` · rule class `unsupported-hook-abi` · **classification, not a defect**

Five of fourteen real hooks we scanned are on the 2023 interface:
`getHooksCalls()` returning `Hooks.Calls`, `beforeSwap` without `hookData`,
`BaseHook` from v4-periphery. None of their callbacks match the shipped
signatures, every other detector skips them, and the scan used to report zero
findings — indistinguishable from a clean bill of health.

This detector overrides the base class's scoping (which is what excludes those
contracts) and fires on any deployable, non-dependency contract that:

- defines `getHooksCalls()` — conclusive. `is_hook_contract` refuses such a
  contract even when one callback still matches (`afterInitialize` has never
  changed), because otherwise HS-02 reads its permissions wrong and accuses it
  of "not declaring `getHookPermissions()`" at High. That is what happened on
  v4-stoploss;
- exposes external functions *named* like IHooks callbacks whose normalised
  signatures are not the shipped ones;
- inherits something called `BaseHook` without any recognised callback.

The message says the detectors did not analyse the contract, lists the
mismatched callbacks, and states that every code-derived dimension is
unmeasured. A contract merely named `SomethingHook` that does none of the above
is left alone — the name is not evidence.

A recognised hook with *some* mismatched callbacks (v2-on-v4: current
`beforeSwap`, `ModifyLiquidityParams` without `salt`) is analysed for what
matches and gets a shorter finding, discriminator `partial`, naming the
callbacks nothing could judge.

[`hook_analysis.py`](../detectors/slither_hookrisk/utils/hook_analysis.py) ·
`legacy_abi_evidence`, `is_hook_contract`

---

<a id="hook-profile"></a>
## Hook profile

`hookrisk-hook-profile` · rule class `hook-profile` · **classification, not a defect**

One informational finding per contract the detectors recognised as a hook,
anchored on the contract. It exists because Slither's JSON carries findings and
nothing else: a clean scan and a scan that never recognised the target produce
the same empty list. Until this detector the CLI inferred coverage from the
*absence* of an [unsupported-ABI](#unsupported-abi) disclaimer — inference from
silence, the failure the scoring layer refuses everywhere else. Now the plugin
says what it looked at, and the CLI marks the target analysed only when a
profile exists for that file and contract name.

The block it carries (see [the engine contract](#the-engine-contract)):

| Field | Meaning |
|---|---|
| `permissions` | The resolved `getHookPermissions()` set, inheritance followed, all fourteen fields. Absent when the hook declares none. This is where the CLI takes permissions from; the harness's runtime derivation is the fallback for when static analysis did not run. |
| `callbacks` | Callbacks whose most-derived delegate does work. A `BaseHook` stub is nobody's code and a deliberate revert-guard ([disabled-callback](#disabled-callback)) is not a path the PoolManager can complete, so neither is listed. |
| `metrics.callbacksImplemented` | `len(callbacks)`. |
| `metrics.callbacksDeclared` | Callback permissions set to true. Returns-delta flags are not callbacks and are not counted. |
| `metrics.stateWritesInCallbacks` | State-variable writes reachable from the implemented callbacks through internal calls and modifiers, after override resolution, one per (node, variable). Inherited library logic counts: a limit-order book that keeps its state in `lib/` still mutates it on every swap. |
| `metrics.externalCallsInSwapPath` | High- and low-level calls from `beforeSwap`/`afterSwap` and everything they reach. Library calls excluded. Raw: includes the PoolManager's own settlement calls. |
| `metrics.externalCallsInSwapPathThirdParty` | Of those, the calls that leave the pool's trust boundary — not the PoolManager, not a library, not the pool's own currencies ([HS-05](#hs-05)'s classification). The `externalDependencies` input; the raw count is kept for complexity. |
| `metrics.internalFunctionsReachableFromCallbacks` | Distinct implemented functions (modifiers excluded) reachable from the implemented callbacks. |
| `metrics.usesReturnsDelta` | Any returns-delta permission declared. |
| `metrics.hasOwnerOnlyFunctions` | Some external/public, non-view, non-callback function is gated on an owner-like state variable — `require(msg.sender == admin)` inline, or OpenZeppelin's `onlyOwner` → `_checkOwner()` → `owner() != _msgSender()`, whose operands are resolved through the callees — or on a role lookup keyed by the sender (OpenZeppelin's `AccessControl`, see [HS-03](#hs-03)). The scorer's "owner-only mutators exist" input. |

The complexity dimension is *derived* from these metrics by the scoring layer,
with brackets recorded in `schema/framework-rubric.json` as an interpretation.
The profile never sets a value itself; a target without one leaves complexity
unmeasured.

### What it measured on real hooks

| Hook | callbacks | declared | state writes | ext. calls in swap | reachable | returns-delta | owner-only |
|---|---|---|---|---|---|---|---|
| v4-template `Counter` | 4 | 4 | 4 | 0 | 4 | no | no |
| `CorkHook` (the exploit) | 2 | 4 | 4 | 5 | 19 | yes | yes |
| OZ `LimitOrderHookMock` | 2 | 2 | 6 | 3 | 9 | no | no |
| OZ `AntiSandwichMock` | 2 | 2 | 6 | 2 | 9 | yes | no |

### Known trade-offs

- `hasOwnerOnlyFunctions` recognises two shapes: a comparison against an
  owner-like variable, found by name (`owner`, `admin`, `governance`,
  `guardian`, …) — the weak direction on purpose, since a hit scores nothing
  by itself — and a role lookup keyed by the sender that decides a branch
  (`AccessControl`, recognised by what it does, not by name; StablePairHook
  used to be reported as having no admin surface). A comparison against a
  state variable with an unfamiliar name (`require(msg.sender == treasury)`)
  is still not counted here, though HS-03 does treat it as a guard.
- Writes through a storage pointer (`Checkpoint storage c = _checkpoints[id];
  c.blockNumber = …`) are recorded by Slither against the local reference,
  not the state variable, and are under-counted.
- A same-named contract in another file is not the target. The profile's
  anchor carries `filename_relative`, and the CLI matches both.

[`hook_profile.py`](../detectors/slither_hookrisk/detectors/hook_profile.py) ·
[`hook_analysis.py`](../detectors/slither_hookrisk/utils/hook_analysis.py) ·
`state_writes_in`, `owner_only_functions`, `reachable_functions`

---

<a id="the-engine-contract"></a>
## The engine contract

Every result a hookrisk detector emits carries a `hookrisk` block, written by
`HookriskDetector._report` and shaped by
[`schema/engine-metadata.schema.json`](../schema/engine-metadata.schema.json):

```json
{ "version": "1", "ruleClass": "…", "informsDimensions": [], "informsTriggers": [],
  "isClassification": false, "discriminator": "…",
  "metrics": {}, "permissions": {}, "callbacks": [] }
```

It is enforced from both sides. `detectors/tests` validates every block the
corpus produces with a stdlib checker for the subset of JSON Schema the file
uses (and fails if the schema grows a keyword the checker does not know). The
CLI validates with Ajv before admitting a result, and a block that does not
conform is **dropped with a log line naming the detector and the violated
path**, the count recorded as `engines[].invalidMetadata`. A drifted detector
therefore cannot put an unattributable row in the report, nor disappear from it
in silence. `version` is bumped only when a consumer would have to change to
keep reading the block correctly.

---

<a id="not-yet-implemented"></a>
## Not yet implemented

Listed with what their absence costs, because a missing detector silently makes a
dimension unmeasurable and that consequence should be legible.

| Rule | Would find | Dimension left unmeasured |
|---|---|---|
| **HS-04** | DELEGATECALL to mutable code, EIP-1967 slots, `upgradeTo` | `upgradeability` — **unless BlockSec runs** |
| **HS-08** | Rounding that resolves in the caller's favour on an exit path | refines `customMath` |

[HS-03](#hs-03) still does not say whether an EOA or a contract holds the
key (that is deployed mode's `owner()` codesize read), and
[HS-06](#hs-06) does not look for a rate limit, only a ceiling.

HS-04 is the clearest illustration of why the multi-engine design is not
decoration: enabling BlockSec turns `upgradeability` from unmeasurable into
measurable, and the tool says so in the output rather than leaving a reader to
infer it.

---

## Coverage is reported, not assumed

Slither logs `Impossible to generate IR for <function>` and **continues**, then
reports a normal result count. Any detector relying on SlithIR never sees those
functions.

This is not hypothetical. An earlier pin of OpenZeppelin's `uniswap-hooks` had
three functions fail to lift — including `AntiSandwichHook._afterSwap`, which is
where the interesting logic lives. We hit it in our own false-positive gate: the
detectors returned zero findings, and it took reading stderr to establish that
part of that silence was "nothing wrong" and part was "nothing looked." (The
currently pinned commit lifts cleanly; the corpus gate would surface a
regression as `HR-E205`.)

hookrisk collects them and reports reduced coverage (`HR-E205`) in the manifest
and in `HOOK_RISK.md`:

> ⚠️ **3 function(s) were not analysed.** Slither could not lift them to IR and
> continued silently. Findings below do not cover them — this is not the same as
> those functions being clean.

`--fail-on-partial-coverage` makes it a hard failure. Right for a release gate on
your own hook; too strict for scanning third-party code.

---

## The corpus is the contract

Every detector has fixtures on both sides, and CI enforces both.

**[`corpus/src/bad/`](../corpus/src/bad)** — must fire. Each fixture documents
the vulnerability *class* it reproduces and links the public write-up. They are
minimal reproductions of a class, not faithful reimplementations of any
particular incident, and say so.

**[`corpus/src/good/`](../corpus/src/good)** — nothing at High or Medium.
Subclasses OpenZeppelin's concrete `AntiSandwichMock`, `LimitOrderHookMock` and
`LiquidityPenaltyHookMock` in project source, so every detector is run against
externally reviewed code on every build *and the gate can see the result* —
the abstract hooks it used to import were skipped as undeployable, and a
finding anchored under `lib/` is dropped by `--exclude-dependencies` before it
reaches the gate. Informational classifications are allowed here:
`IntentionalRevertHook` is meant to trip disabled-callback, and AntiSandwich
legitimately uses custom accounting.

**[`corpus/src/legacy/`](../corpus/src/legacy)** — unsupported-ABI
classifications and nothing else. A 2023-style hook, the v4-stoploss shape
(`getHooksCalls()` plus the one callback whose signature never changed), the
v2-on-v4 shape (current hook, one pre-`salt` callback), and a control named
`HookRegistry` that must stay silent.

The gates run on Slither's JSON (`--json -` and `jq`), never on the human log,
and [`detectors/tests/test_corpus.py`](../detectors/tests/test_corpus.py) asserts
the finding-level expectations each fixture's header promises: anchor element,
discriminator, in-file controls.

The negative gate matters more. Missing a real bug is bad; flagging correct code
is what gets a security tool switched off, and after that it finds nothing at all.

`UnvalidatedCallback` also carries an in-file control: a correctly guarded
`beforeAddLiquidity` alongside two unguarded callbacks. A detector that flagged
the whole contract instead of the specific functions would pass a naive test and
be useless in practice.
