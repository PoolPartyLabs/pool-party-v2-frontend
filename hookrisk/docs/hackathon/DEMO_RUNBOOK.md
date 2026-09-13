# hookrisk — demo runbook

Nine steps, ~4 minutes of commands warm. Every excerpt was produced by running
the command on the demo machine (macOS 25.6 / arm64, forge 1.7.1, node 24.14.0,
slither 0.11.6, Python 3.13.12). Where the tool does something other than what
the notes claim, the runbook says so — steps 4 and 9.

`docs/hackathon/demo.sh <hookrisk-root> <clones-root>` runs all nine
non-interactively (85–90 s here) and skips step 8 when Docker has no
`futuretech6/hookscan`. Run it once before the talk; drive the steps by hand on
stage.

**Conventions.** `$HR` = hookrisk checkout, `$CL` = clones directory. Every scan
runs from the hook's project root as
`HOOKRISK_SLITHER_BIN=$HR/.venv/bin/slither node $HR/cli/dist/cli.js scan <File.sol:Contract> --verbose --out out`.
stdout is the summary, stderr the progress log; `--json` puts the manifest on
stdout, `--log-json` makes the log JSON lines. **Exit 2 = gate failed, a result
rather than an error** — never wrap a scan in `set -e`. Invariant runs are fuzzed
and unseeded, so observation counts move a percent or two between runs; the shape
(zero vs. tens of thousands) is the point.

## Clones (one-time)

| slug | repo | commit |
|---|---|---|
| `cork-hook` | `https://github.com/Cork-Technology/Cork-Hook` | `50e78ace2cce30dc8434aa858d6601fe5c337489` |
| `v4-constant-sum` | `https://github.com/saucepoint/v4-constant-sum` | `cce8f6cfb614e19144b1858348b23f56c241f50d` |
| `orbital-hook` | `https://github.com/Dhruv-2003/ethglobal-buenos-aires-25` | `0a3c042639c29358e5c7505f5b3692f4485580aa` |
| `v4-stoploss` | `https://github.com/saucepoint/v4-stoploss` | `881a13ac3451b0cdab0e19e122e889f1607520b7` |
| `v4-template-counter` | `https://github.com/uniswapfoundation/v4-template` | `1fbf95547791f0821a170b88c750cb2e04e6818b` |

```bash
cd $CL && git clone <repo> <slug>/repo && cd <slug>/repo && git checkout <commit>
# v4-stoploss ONLY, before the next line:
#   git config url."https://github.com/".insteadOf git@github.com:
git submodule update --init --recursive
forge build                                     # 1–4 min cold, ~1 s warm
node $HR/cli/dist/cli.js init --config hookrisk.toml
```

**SSH-submodule workaround.** `v4-stoploss`'s `lib/v4-periphery/.gitmodules`
line 12 pins `url = git@github.com:Uniswap/v4-core.git`, so a recursive checkout
without an SSH agent dies there; the `insteadOf` line rewrites it for that clone
only. Same line is what `trading-days`, `nft-owners-only` and `ref-fee-hook`
needed; the other four clone recursively unaided.

**hookrisk.toml.** `hookrisk init` writes the whole file; only these lines differ
per hook. `maxTier` is commented out in today's template — uncomment it in all
five so the gate is doing something.

| slug | edits to the generated hookrisk.toml |
|---|---|
| all five | uncomment `maxTier = "medium"` |
| `cork-hook` | `maxFeeBips = 10000` (`State.sol:139` `MAX_FEE = 100e18`, owner-settable) |
| `orbital-hook` | `maxFeeBips = 10` (`LP_FEE = 1000/1e6`), plus the block below |
| others | none — `maxFeeBips = 0`, these hooks charge no swap fee |

```toml
# orbital-hook/repo/hookrisk.toml — OrbitalHook(IPoolManager, Currency, Currency, Currency)
[harness]
constructorArgs = ["$poolManager", "$currency0", "$currency1", "$currency1"]
```

## Step 1 — Everything is green · 5 s + 13 s warm (~3 min cold)

**Claim.** The whole tool builds and its own tests pass from a clean checkout.

```bash
cd $HR && make setup && make test
```
```
Ran 12 test suites in 4.82s: 45 tests passed, 0 failed, 1 skipped (46 total tests)
ℹ tests 274
ℹ pass 274
ℹ fail 0
Ran 29 tests in 3.521s
OK
corpus gates passed
```

**Say.** 45 Foundry tests against real v4-core, 274 CLI tests, 29 detector tests,
three corpus gates — one asserting the detectors fire, one that they stay silent
on OpenZeppelin's production hooks, one that a 2023-era hook produces *only* an
"I could not read this" classification. (Notes quote 174/184/215 CLI tests at
points during the day; 274 is where it landed.)

## Step 2 — The planted bugs · <1 s

**Claim.** The harness catches two defects no static rule can see: a hook that
documents 1% and charges 3.5%, and one that traps liquidity while conservation
holds perfectly.

```bash
cd $HR/harness && forge test --match-path test/HarnessValidation.t.sol
```
```
[PASS] test_I2_detectsUndeclaredSkim() (gas: 2099354)
[PASS] test_I3_detectsTrappedLiquidity() (gas: 2985220)
[PASS] test_I3_trapIsInvisibleToConservation() (gas: 2442234)
Ran 9 test suites in 7.66ms: 27 tests passed, 0 failed, 0 skipped (27 total tests)
```

**Say.** `test_I3_trapIsInvisibleToConservation` is the one to read: it drives a
hook that traps liquidity and asserts conservation holds to the wei the whole
time. Solvency and liveness are different properties and only one is usually
tested.

## Step 3 — The Cork exploit hook ($11M, May 2025) · 4 s, exit 2

**Claim.** On the archived `CorkHook`, HS-01 reports the unguarded `beforeSwap`
at line 365 that the attacker called directly.

```bash
cd $CL/cork-hook/repo
HOOKRISK_SLITHER_BIN=$HR/.venv/bin/slither node $HR/cli/dist/cli.js \
  scan src/CorkHook.sol:CorkHook --verbose --out out
jq -r '.findings[]|"\(.severity)\t\(.ruleClass)\t\(.discriminator // "-")\tline \(.location.line)"' out/hook-risk.json
```
```
MEDIUM risk  14/33  (undetermined: up to 26/33)
  findings    3 high, 5 medium, 2 info (+ hook profile)
  ✓ hookrisk   ok
  - harness    skipped  CorkHook's constructor takes 3 argument(s) (address
               _poolManager, address _lpBase, address owner) and the harness can
               only derive the IPoolManager on its own. … See HR-E305.
  invariants  I1 skipped, I2 skipped, I3 skipped
  gate failed
    - 3 finding(s) at or above high: … CorkHook.beforeSwap(address,PoolKey,
      IPoolManager.SwapParams,bytes) (src/CorkHook.sol#365-378) is an IHooks
      callback (0x575e24b4) that never compares msg.send...

high	unprotected-hook-callback	beforeAddLiquidity	line 88
high	unprotected-hook-callback	beforeInitialize	line 97
high	unprotected-hook-callback	beforeSwap	line 365
high	flag-implementation-divergence	beforeRemoveLiquidity	line 31
info	custom-accounting	-	line 31
info	hook-profile	-	line 31
info	callback-intentionally-disabled	beforeAddLiquidity	line 88
```

**Say.** `beforeSwap:365` is literally the function the attacker invoked; PR #19's
fix never merged, so `onlyPoolManager` appears nowhere in `src/` at any commit.
The HS-02 divergence on `beforeRemoveLiquidity` is a *genuine* stub — declared in
`getHookPermissions()`, never overridden, so `BaseHook` reverts
`HookNotImplemented()`. The same pass classifies `beforeAddLiquidity` as
`callback-intentionally-disabled`, INFO: it reverts
`DisableNativeLiquidityModification()` by design, and used to be a false HIGH.
And the harness skip names the exact constructor it cannot satisfy.

**Also on Cork since the research pass.** Two `admin-surface` MEDIUMs (HS-03: the
owner can rewrite the base fee and the treasury split that every swap pays) and
three `external-call-in-swap-path` MEDIUMs (HS-05: the forwarder, the swapper's
flash-swap callback and a config read, each a dependency every swap must survive).
Complexity 5/5, autonomous-parameter-updates and external-dependencies are now
*measured*, so the tier band narrowed from 14–26 to 17–23.

## Step 4 — A custom curve the old harness silently passed · 5 s, exit 0

**Claim.** `v4-constant-sum` refuses PoolManager liquidity. The harness stands it
up, records that the seed was rejected, and refuses to call a run over an idle
pool a pass.

```bash
cd $CL/v4-constant-sum/repo
HOOKRISK_SLITHER_BIN=$HR/.venv/bin/slither node $HR/cli/dist/cli.js \
  scan src/Counter.sol:Counter --verbose --out out
jq -r '.invariants[]|"\(.id) \(.name) \(.status)"' out/hook-risk.json
```
```
  harness: 3 invariant(s), 0 failed, 3 inconclusive (flags=0x888 derived,
           seeded=hooked-failed) observed 1285 sequence(s), 0 swap(s) landed,
           0 compared, 0 price check(s), 0 position(s) opened, 0 closed,
           0 donation(s), 1285 hooked-only swap revert(s), 0 exit failure(s)
  reconcile: beforeAddLiquidity classified intentionally disabled by hookrisk and
             observed rejecting the harness's seed (Error("No v4 Liquidity
             allowed")); merged into finding a43cc8e88654b94b at confidence high
  reconcile: I3 not-applicable — both layers agree PoolManager liquidity is
             disabled by design

MEDIUM risk  13/33  (undetermined: up to 25/33)
  findings    3 info
  ✓ hookrisk   ok
  ✓ harness    ok
  invariants  I1 inconclusive, I2 inconclusive, I3 not-applicable
  gate passed

I1 Conservation and solvency inconclusive
I2 Price monotonicity (custom curve) inconclusive
I3 Exit liveness not-applicable
```

> **Correction to the notes.** `HACKATHON.md`'s demo script still shows
> `I1 passed, I2b passed, I3 passed` here — the old behaviour agent G fixed. What
> happens now: **I1 and I2 inconclusive** (`.detail` reads *"passed vacuously:
> 0 swaps landed and 0 positions opened across 1285 sequences; the hook rejected
> PoolManager liquidity (Error("No v4 Liquidity allowed")) so the pool never
> traded …"*), and **I3 not-applicable**. The custom-curve invariant is reported
> under the id `I2` named *Price monotonicity (custom curve)* — no separate `I2b`.

**Say.** The old tool printed three green invariants here. Every one of those
1285 sequences rolled back — the hooked pool had no liquidity, so every swap
reverted, and passing over nothing was byte-identical to passing over a real
workload. Now the counters decide: 0 swaps compared ⇒ inconclusive. And the layers
reconcile — the static classification says *disabled by design*, the harness
observed the exact revert, so the finding is promoted to high confidence and I3
becomes not-applicable rather than a failure.

## Step 5 — Orbital: constructor args, complexity measured · 4 s, exit 0

**Claim.** A four-argument constructor is supplied from config, and the hook
profile turns complexity from "unmeasured" into a number with a rule behind it.

```bash
cd $CL/orbital-hook/repo && sed -n '/^\[harness\]/,$p' hookrisk.toml
HOOKRISK_SLITHER_BIN=$HR/.venv/bin/slither node $HR/cli/dist/cli.js \
  scan src/OrbitalHook.sol:OrbitalHook --verbose --out out
sed -n '/### Hook profile/,/^## /p' out/HOOK_RISK.md
```
```
  harness: OrbitalHook.sol:OrbitalHook flags=derived-from-runtime maxFee=10bips
           ctorArgs=4 word(s) run=1c07a6c3-…
  harness: 3 invariant(s), 0 failed, 3 inconclusive (flags=0xa88 derived,
           seeded=hooked-failed) observed 1285 sequence(s), 0 swap(s) landed …
MEDIUM risk  13/33  (undetermined: up to 25/33)
  invariants  I1 inconclusive, I2 inconclusive, I3 not-applicable
  gate passed

### Hook profile
| Callbacks implemented (count) | 1 |
| Callbacks declared | 3 |
| State writes in callbacks | 3 |
| External calls in the swap path | 3 |
| Internal functions reachable from callbacks | 8 |
| Returns a delta | true |
| Owner-only surface | false |
| Permissions declared | `beforeAddLiquidity`, `beforeRemoveLiquidity`, `beforeSwap`, `beforeSwapReturnDelta` |
```
…and in the score table: `| Complexity | 4/5 | measured | Returns a delta and
makes an external call in the swap path ᵃ |`

**Say.** Four constructor arguments, three of them currencies the harness deploys
itself: `$currency0`/`$currency1` are substituted word-for-word before deployment,
so no ABI knowledge is needed. And complexity — the framework publishes nine
dimensions and brackets for two; we derive it from a profile the detector emits,
and the rule that fired is *data* in `schema/framework-rubric.json`, not code.
Cork scores 5/5 on the same table.

## Step 6 — A 2023-era hook: unreadable, and says so · 7–17 s, exit 2

**Claim.** A hook on the pre-release ABI gets a classification and seven
unmeasured dimensions, not a clean report.

```bash
cd $CL/v4-stoploss/repo
HOOKRISK_SLITHER_BIN=$HR/.venv/bin/slither node $HR/cli/dist/cli.js \
  scan src/StopLoss.sol:StopLoss --verbose --out out
jq -r '[.score.dimensions[]|select(.source=="unmeasured")|.id]|join(", ")' out/hook-risk.json
```
```
  hookrisk: did not analyse the target — StopLoss uses a hook ABI hookrisk cannot
            analyse: StopLoss (src/StopLoss.sol#17-205) looks like a Uniswap v4
            hook but its hook ABI predates the shipped v4 interface (declares the
            2023 getHooksCalls(); callba...
  hookrisk: 1 finding(s); analysed 0 hook contract(s)
  harness: failed — harness setUp failed: TwinPools: getHookPermissions() reverted
           on the supplied runtime code (not a BaseHook-shaped hook, or the wrong
           bytecode): 0x. … (HR-E304).

LOW risk  3/33  (undetermined: up to 28/33)
  findings    1 info                         ← the unsupported-hook-abi classification
  ✓ hookrisk   ok
  ✗ harness    failed  …
  invariants  I1 inconclusive, I2 inconclusive, I3 inconclusive
  ! 7 dimension(s) unmeasured: the tier is between Low Risk and High Risk.
  gate failed
    - engine hookrisk did not analyse the target: it was not recognised as a v4 hook (unsupported ABI) …
    - the differential harness failed: harness setUp failed: … (HR-E304)

complexity, customMath, externalDependencies, externalLiquidityExposure,
upgradeability, autonomousParameterUpdates, priceImpactingBehavior
```

**Say.** Before today this scanned as LOW 3/33, zero findings, `✓ hookrisk ok`,
complexity *measured 0* — a clean bill of health on a contract nothing had read.
Now both layers refuse: the detector emits `unsupported-hook-abi` and revokes its
own coverage, the harness fails loudly because `getHookPermissions()` does not
exist on a 2023 hook, seven of nine dimensions come back unmeasured, and
complexity can no longer be zero-by-silence. It still exits 0 — an honest report
is not the same as a gate failure; see step 9.

## Step 7 — The official template passes the gate · 5 s, exit 0

**Claim.** With the config `hookrisk init` writes today, the Uniswap Foundation
template passes and its three invariants are exercised for real.

```bash
node $HR/cli/dist/cli.js init --config /tmp/demo/hookrisk.toml
cd $CL/v4-template-counter/repo
HOOKRISK_SLITHER_BIN=$HR/.venv/bin/slither node $HR/cli/dist/cli.js \
  scan src/Counter.sol:Counter --config /tmp/demo/hookrisk.toml --verbose --out out
```
```
  harness: 3 invariant(s), 0 failed (flags=0xac0 derived, seeded=both) observed
           1285 sequence(s), 13410 swap(s) landed, 13410 compared, 13410 price
           check(s), 6945 position(s) opened, 6945 closed, 6800 donation(s),
           0 hooked-only swap revert(s), 0 exit failure(s)

LOW risk  5/33  (undetermined: up to 25/33)
  ✓ hookrisk   ok
  ✓ harness    ok
  invariants  I1 passed, I2 passed, I3 passed
  gate passed
```
Complexity: `2/5 measured — "Callbacks write hook state, or 3+ callbacks"`.

**Say.** Contrast with step 4: same shape of run, but 13410 swaps actually landed
and were compared against the twin, 6945 positions opened *and* closed. That is
what a passed invariant looks like, the counters are in `.coverage.observations`
so you can tell the two apart, and the default gate — which used to fail this
hook on tier uncertainty — now passes it while still naming the six unmeasured
dimensions.

## Step 8 — Two engines, one finding · 2–3 s warm (needs Docker)

**Claim.** BlockSec's HookScan (Yul CFG) and hookrisk's detectors (solc AST) land
on the same two callbacks and merge into one finding at raised confidence.

Gate: `docker image inspect futuretech6/hookscan`. **If it fails, skip the step
and put `docs/hackathon/evidence/blocksec-corroboration.md` on screen** — same
commands, same output, recorded. To enable:
`docker pull --platform linux/amd64 futuretech6/hookscan` (~1.2 GB, once).
`corpus/`'s `lib/` is a symlink out of the project root, which the engine detects
and refuses, so the fixture goes into a throwaway copy of the harness project:

```bash
cp -R $HR/harness /tmp/demo/proj
cp $HR/corpus/src/bad/UnvalidatedCallback.sol /tmp/demo/proj/src/
sed 's/^blocksec = false/blocksec = true/' $HR/harness/hookrisk.toml > /tmp/demo/proj/hookrisk.toml
cd /tmp/demo/proj && forge build
HOOKRISK_SLITHER_BIN=$HR/.venv/bin/slither node $HR/cli/dist/cli.js \
  scan src/UnvalidatedCallback.sol:UnvalidatedCallback --skip-dynamic --no-gate --verbose --out out
```
```
  blocksec: mounting cached solc 0.8.26 at /solc/v0.8.26/solc
  blocksec: docker run futuretech6/hookscan (src/UnvalidatedCallback.sol:UnvalidatedCallback)
  blocksec: 2 finding(s)
  reconcile: merged 2 unprotected-hook-callback finding(s) keyed
             unprotected-hook-callback|src/UnvalidatedCallback.sol|sel:0x575e24b4
             into one — corroborated across hookrisk and blocksec
  reconcile: 6 finding(s) in, 4 out, 2 bucket(s) merged

  findings    3 high, 1 info
            2 corroborated across engines
  ✓ hookrisk   ok
  ✓ blocksec   ok

line 57  high  hookrisk/hookrisk-unprotected-callback + blocksec/UniswapPublicHook
line 71  high  hookrisk/hookrisk-unprotected-callback + blocksec/UniswapPublicHook
```
On a **cold** cache the first run adds ~10 s and prints `blocksec: image has no
solc 0.8.26 (image ships 0.8.14 … 0.8.24); downloading the linux-amd64 build from
https://binaries.soliditylang.org/linux-amd64 to ~/.cache/hookrisk/solc/0.8.26/solc`.
That download is host-side; the analysis container stays `--network none`.

**Say.** The published image is amd64-only, its entrypoint cannot start under
Docker Desktop, and it ships solc up to 0.8.24 while v4-core pins 0.8.26 — the
adapter handles all three. What matters on screen: two analysers on completely
different foundations agree on the same two functions, so those merge into one
finding at `confidence: high`. And `✓ blocksec ok` on a hook it finds nothing in —
"looked and found nothing" is a different claim from "nobody looked".

## Step 9 — What a CI job branches on · 3 s

**Claim.** The scan is machine-readable end to end: a structured log, an exit
code, and four manifest fields.

```bash
cd $HR/harness
node $HR/cli/dist/cli.js scan src/hooks/RefusingHook.sol:RefusingHook --log-json --out out
jq -r '.gate.passed, .coverage.harnessStatus, (.engines[]|select(.status=="failed")|.errorCode)' out/hook-risk.json
```
```json
{"ts":"…","runId":"af6c2296-…","level":"error","stage":"harness","msg":"harness: failed — harness setUp failed: TwinPools: hooked pool would not initialise. With fee 3000: 0x778164c7; with a dynamic fee: 0x778164c7. … (HR-E304).","status":"failed","durationMs":307,"invariants":{"I1":"inconclusive","I2":"inconclusive","I3":"inconclusive"},"errorCode":"HR-E304"}
{"ts":"…","runId":"af6c2296-…","level":"info","stage":"scan","msg":"scan: finished in 2728ms, exit 0","durationMs":2728,"exitCode":2,"tier":"low","total":3,"inconclusive":true,"findings":2,"gatePassed":false}
```
```
.gate.passed            = false      .coverage.harnessStatus = failed
engines[].errorCode     = HR-E304    invariants = I1/I2/I3 = inconclusive
```

> **Gate rule, say this out loud.** A failed engine is not a pass. Since the
> third pass the gate has `failOnNotAnalysed = true` by default: a harness that
> could not stand the hook up, a static engine that could not compile the
> project, or a target the detectors never recognised as a v4 hook all fail the
> gate with a reason naming the engine, and the scan exits **2**. The manifest
> stays honest either way (`harnessStatus: failed`, `HR-E304`, invariants
> inconclusive); the exit code now agrees with it. `failOnInconclusive` remains
> the separate, off-by-default switch for an undetermined tier.

**Say.** Every log line carries the same run id and a stage, so the engine and
harness stages overlap without the output becoming unreadable — they run
concurrently. A pipeline reads the exit code for the verdict and
`coverage.harnessStatus` + `engines[].errorCode` for *why*, and
`failOnInconclusive` is the knob that decides posture: off, an unmeasured tier is
reported; on, unknown is not a pass.

## Reset between runs

```bash
for d in cork-hook v4-constant-sum orbital-hook v4-stoploss v4-template-counter; do
  rm -f $CL/$d/repo/out/{hook-risk.json,hook-risk.invalid.json,HOOK_RISK.md,hookrisk.sarif}
done
rm -f $HR/harness/out/{hook-risk.json,HOOK_RISK.md,hookrisk.sarif}
rm -f $HR/harness/out/hookrisk-run-*.json $HR/harness/out/hookrisk-obs-*.jsonl
rm -rf /tmp/demo            # step 7's config, step 8's project copy
```

Do **not** `rm -rf out/` inside a clone: that deletes the forge artifacts and the
next scan needs a full rebuild. `make clean` in `$HR` does exactly that for the
checkout (`cli/dist`, `harness/out`, `corpus/out`), so re-run `make setup` after
it. Harness runs write `$HR/harness/out/hookrisk-run-<uuid>.json` and
`hookrisk-obs-<uuid>.jsonl` and delete them on the way out; the ids are random, so
**two scans at once are safe** (`docs/INVARIANTS.md` § Concurrent scans). Only a
killed scan leaves one behind — hence the two `rm -f` lines.

## If something breaks

Full catalogue: `docs/TROUBLESHOOTING.md`. On stage you will only see these.

| Code | Meaning | Fix |
|---|---|---|
| `HR-E001` / `HR-E002` | forge / Slither not on PATH | `make setup`; check `$HR/.venv/bin/slither` exists and `HOOKRISK_SLITHER_BIN` points at it |
| `HR-E004` | plugin installed, not registered | `make install-detectors`; `slither --list-detectors \| grep hookrisk-` |
| `HR-E005` | CLI cannot find its own checkout | it needs `harness/foundry.toml` + `schema/` two levels above `dist/`; set `HOOKRISK_HOME=$HR` for a relocated `cli.js` |
| `HR-E102` | target not resolved | wrong `File.sol:Contract`, or `forge build` never ran in that clone |
| `HR-E202` | "test path shadows source path" | usually mislabelled — read the solc line in the reason, that is the real error |
| `HR-E205` | Slither could not lift every function to IR | not fatal; uncovered functions are listed in the manifest. `failOnPartialCoverage = true` makes it a gate failure |
| `HR-E304` | harness `setUp()` reverted | the reason names the callback and the hook's own revert, unwrapped from v4's ERC-7751. **Expected on step 6** |
| `HR-E305` | constructor arguments needed | add `[harness] constructorArgs` — see step 5. **Expected on step 3** |
| `HR-E501` | manifest failed schema validation | CLI and `schema/hook-risk.schema.json` out of sync; `make install-cli` from the same checkout |
| exit `64` | bad command line | the usage text is the whole message; `--help` exits 0 |

Two non-`HR-E` failures worth knowing: **`blocksec: failed — the lib symlink
cannot be followed inside the container`** means you pointed the engine at
`corpus/`; use a project with a real `lib/`, as step 8 does. **`no matching
manifest for linux/arm64/v8`** means the *pull* is missing
`--platform linux/amd64`; hookrisk always passes it on `run`, the pull is yours.
