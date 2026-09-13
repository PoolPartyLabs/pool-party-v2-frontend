# hookrisk at the hackathon

**What it is.** The Uniswap Foundation's Hooks Security Framework, made
executable: static detectors (Slither), a differential twin-pool harness
(Foundry, against real v4-core), and a scoring layer that refuses to score a
dimension zero unless a detector capable of finding something actually ran.
Output is a manifest, a report, SARIF, and a meaningful exit code.

**What this document is.** The record of one day's work on top of the
original repository: what we found by running it against 14 real hooks, what
we fixed in two passes, the evidence to show, and what is still open. The
per-change notes from each workstream are in `notes-A.md` to `notes-I.md`; the
raw before/after scan artifacts are under `evidence/`; the demo itself is
`DEMO_RUNBOOK.md` and `demo.sh`.

## The pitch in three findings

1. **It finds the Cork exploit.** On the archived `CorkHook` (the $11M
   May 2025 incident, fix never merged) HS-01 reports the unguarded
   `beforeSwap` at line 365 that the attacker called directly, plus the
   unguarded `beforeInitialize`, a genuinely stubbed `beforeRemoveLiquidity`,
   an owner-only fee surface and complexity 5/5.
   `evidence/cork-hook.md`.
2. **It executes hooks, not only reads them.** The harness stands up two
   pools identical except for the hook, drives them with the same fuzzed
   sequence, and asserts conservation, no undeclared extraction (or price
   monotonicity for custom curves) and exit liveness. A hook that documents a
   1% fee and charges 3.5% is structurally flawless and only execution sees
   it. `harness/test/HarnessValidation.t.sol` proves the harness catches the
   planted skim and the planted liquidity trap.
3. **Two independent engines agree.** BlockSec's HookScan (Yul CFG) and our
   detectors (solc AST) now both run and merge the same missing guard into one
   corroborated finding at raised confidence.
   `evidence/blocksec-corroboration.md`.

## What we found by scanning 14 real hooks

We took hooks from `fewwwww/awesome-uniswap-hooks` and the wider ecosystem,
from the official template to Uniswap's own production hooks, OpenZeppelin's
library, an ETHGlobal Buenos Aires 2025 entry, the Cork exploit hook, and five
2023-era hooks on the pre-release ABI. One agent per hook cloned, built and
scanned. Results and the tool defects they exposed are in
`evidence/agent-scan-results-before.json` and the assessment report; the
short version:

| Before the fixes | |
|---|---|
| Harness actually ran | 1 of 14 |
| Harness reported "ok" after its own setUp reverted | 1 (constant-sum) |
| False HIGH from HS-02 on a deliberate revert-guard | 4 (WETHHook, v2-on-v4, constant-sum, Orbital) |
| Legacy-ABI hooks reported clean with complexity "measured 0" | 5 |
| Distinct findings collapsed into one by reconciliation | Orbital (2 → 1) |
| BlockSec engine able to run | no (amd64-only image, broken entrypoint, no solc 0.8.26) |

| After both passes | |
|---|---|
| Harness ran and all three invariants passed | 3 (template, two OpenZeppelin hooks) |
| Harness ran, hook refused PoolManager liquidity, reported honestly | 2 (constant-sum, Orbital via `constructorArgs`): I1/I2 inconclusive with zero swaps compared, I3 not-applicable by cross-layer reconciliation |
| Harness failed loudly with the hook's own revert | 3 (StablePairHook `InvalidInitializer`, stop-loss legacy ABI, v2-on-v4 factory constructor) |
| Harness skipped with an accurate, actionable reason | 6 (constructor arguments needed, or the project does not compile) |
| False HIGHs | 0; each is now an INFO classification `callback-intentionally-disabled` |
| Legacy-ABI hooks | INFO `unsupported-hook-abi`; every code-derived dimension unmeasured |
| Complexity measured (from the hook profile) | 10 of 15; Cork scores 5/5 (returns-delta, swap-path external calls, owner-only surface) |
| Gate | passes on 7 measured hooks; fails on 3 with HIGH findings and on 5 that could not be analysed (`failOnNotAnalysed`); before, all 14 failed for an undetermined tier |
| BlockSec | runs, corroborates HS-01 |

Full table with per-hook links: `evidence/scans/README.md`.

## What changed today

Four passes of parallel workstreams with disjoint file ownership. Final state:
320 CLI tests, 60 harness tests, three corpus gates and 36 detector tests
green.

### Pass 1: make it honest, widen reach

**A. The CLI–harness bridge** (`cli/src/harness.ts`, `manifest.ts`, `config.ts`).
A reverting `setUp()` is a harness *failure* (HR-E304) with the hook's own
revert unwrapped from v4's ERC-7751 wrapper and the callback named; the
harness is an engine row in the manifest; `coverage.dynamicAnalysisSkipped`
tells the truth; project `out` and `solc` come from `forge config`; hooks with
extra constructor arguments get `[harness] constructorArgs` with
`$poolManager`/`$currency0`/`$currency1`/`$owner`/`$hook` placeholders;
hooks whose `getHookPermissions()` is inherited are no longer skipped as
"declares no permissions".

**B. The Solidity harness** (`harness/test/*`, `harness/src/hooks/ShapeHooks.sol`).
Derives permissions by etching the runtime code and calling
`getHookPermissions()`; substitutes constructor sentinels; retries pool
initialisation with a dynamic fee when a static fee is rejected; survives a
hook that refuses PoolManager liquidity and records it; writes a run record
the CLI reads. Four new fixtures, each with a deterministic test of the happy
path and the loud failure.

**C. The detectors** (`detectors/`, `corpus/`).
HS-02 distinguishes a `HookNotImplemented()` stub (still HIGH) from a
deliberate custom revert (INFO classification). A new `hookrisk-unsupported-abi`
detector reports 2023-era hooks instead of staying silent. Findings carry a
discriminator. The negative corpus now really contains OpenZeppelin's
production hooks (concrete mocks, subclassed in project source), plus an
intentional-revert fixture and a legacy-ABI fixture, gated by JSON rather than
grep.

**D. The static engine and scoring** (`cli/src/engines/*`, `cli/src/scoring/*`).
Slither's `--json -` was swallowing its own stderr, which is why compile
failures produced an empty reason and every IR-lifting gap (HR-E205) was
invisible; the report now goes to a file and both streams are read. Distinct
findings no longer collapse; hookrisk's callback names and BlockSec's
selectors key to the same bucket so they corroborate. Complexity can no
longer be "measured 0" from silence, and an engine that disclaimed the target
does not count as having looked.

**E. BlockSec HookScan** (`cli/src/engines/blocksec.ts`).
Always `--platform linux/amd64`, entrypoint bypassed, the exact static solc
downloaded from binaries.soliditylang.org into `~/.cache/hookrisk/solc` and
mounted read-only; the analysis container stays `--network none`. Symlinked
`lib/` is detected and refused with a reason.

Plus: a fresh `make setup` works on the first run (Makefile evaluated the venv
paths before creating the venv), `doctor` recognises the detectors, an INFO
classification can never fail the severity gate, and the error catalogue no
longer labels a plain solc error as a test-path problem.

### Pass 2: design for the next repo

**F. A versioned engine contract** (`schema/engine-metadata.schema.json`).
Every detector result's metadata block is validated by both sides; a drifted
detector is dropped and counted, never silently admitted. A new
`hook-profile` classification per analysed contract carries the resolved
permissions (inheritance followed), the implemented callbacks and structural
metrics; it is the engine's "I looked at this contract" signal. The regex
permission parser is gone; the dead `diagnostics.py` is gone.

**G. Vacuous passes and cross-layer reconciliation** (`harness/`, `cli/src/reconcile.ts`).
The harness appends per-sequence observation counts; an invariant that passed
with zero relevant observations is reported inconclusive with the counts. A
static "disabled by design" classification and a harness seed that reverted
are merged into one finding attributed to both layers, and I3 becomes
not-applicable when both agree PoolManager liquidity is off by design.
Concurrent scans in one harness directory verified safe.

**H. Complexity from evidence, a deliberate gate** (`cli/src/scoring/`, `config.ts`).
Complexity is derived from the hook profile with brackets recorded in the
rubric as interpretation. `hookrisk init` no longer sets `maxTier`; an
undetermined tier fails the gate only with `failOnInconclusive = true`. The
manifest carries `engines[].errorCode`, `coverage.observations` and a hook
profile table in the report.

**I. Orchestration and packaging** (`cli/src/cli.ts`, `log.ts`, `home.ts`).
Engines and the harness run concurrently with per-engine budgets; `--log-json`
emits one JSON line per event with a run id; the summary prints to stdout;
`HOOKRISK_HOME` locates the harness and schema with a clear error when
missing; the dogfood workflow gained a third case asserting an unrunnable
hook comes back inconclusive rather than clean.

### Pass 3: what the re-scan found

Fourteen agents re-scanned the hooks against the new build and filed 36
wrong-claim reports and 42 gaps (`evidence/agent-scan-results-after.json`).
The ones fixed the same day: HS-01 no longer double-counts an always-reverting
callback as HIGH (Cork went from 4 to 3 HIGHs, all real); a disabled-callback
classification inherited from a base contract is attributed to the hook that
inherits it; a liquidity-only returns-delta is no longer scored as a custom
curve; an engine failure or an unrecognised target fails the gate by default;
the report's counts, wording, links and titles were corrected. What remains is
listed in `RESUME.md`.

### Pass 4: what the research produced

Two read-only research notes (`research/hacken.md`, `research/hookguard.md`)
mapped Hacken's "Auditing Uniswap V4 Hooks" guide and checker and
chaosxcode/hookguard against hookrisk. Nothing was worth porting as code;
three classes hookrisk was blind to were worth re-implementing at its fidelity,
plus the detectors already on the roadmap:

- **HS-03 admin surface**: an external function that writes state the
  callbacks read. Unguarded is HIGH, owner- or role-gated is MEDIUM (the
  framework's autonomous-parameter-updates concern), and a caller-funded or
  own-position liquidity path is LOW because it is permissionless by design.
  Access control is recognised structurally, including OpenZeppelin
  AccessControl.
- **HS-05 third-party calls in the swap path**: one finding per destination
  that is neither the PoolManager nor a pool currency, flagged static or
  unhandled; the profile counts them separately from settlement calls.
- **HS-06 unbounded dynamic fee**: the fee passed to `updateDynamicLPFee` or
  returned as an override, traced to its sources, with no ceiling anywhere.
- **HS-02's third case**: a returns-delta flag declared while the callback
  returns a zero delta on every path.
- **Three execution probes in the harness**, run before the fuzz campaign:
  every implemented callback called from a non-PoolManager address (an
  `unguarded` verdict corroborates HS-01 by execution), called as the
  PoolManager to check the selector it returns, and called with a foreign
  pool key (`unvalidated-pool-key` classification when accepted).
- **Silence corroborated by measurement scores zero.** Price impact,
  autonomous parameter updates and external dependencies are measured 0 when
  their detector was silent and the hook profile confirms the absence.

On the 15 hooks: the official template's tier band narrowed from 5–25 to
5–16 and Cork's to 17–23 with five of nine dimensions measured; on every
analysed hook only external liquidity exposure and upgradeability remain
unmeasured. Cork gained two owner-only fee mutators and three swap-path
dependencies; all probes on the template and OpenZeppelin hooks read guarded
with correct selectors.

## Demo script

```bash
make setup && make test                        # everything green

# 1. The exploit hook (clone of Cork-Technology/Cork-Hook, forge build first)
node cli/dist/cli.js scan src/CorkHook.sol:CorkHook --verbose
#   2× unprotected-hook-callback HIGH incl. beforeSwap:365, 1× HS-02 HIGH; gate failed

# 2. A custom-curve hook the old harness silently "passed" with zero invariants
#    (clone of saucepoint/v4-constant-sum)
node cli/dist/cli.js scan src/Counter.sol:Counter --verbose
#   ✓ harness ok  (seeded=hooked-failed: the hook refuses PoolManager liquidity)
#   invariants I1 inconclusive, I2 inconclusive (0 swaps compared), I3 not-applicable
#   callback-intentionally-disabled INFO instead of a false HIGH

# 3. The planted bugs the harness must catch
cd harness && forge test --match-path test/HarnessValidation.t.sol

# 4. Two engines agreeing (needs Docker; first run downloads solc once)
#    see evidence/blocksec-corroboration.md
```

## Honest limits, still open

- **Two rubric dimensions still have no detector**: external liquidity
  exposure (does the hook custody funds across transactions) and
  upgradeability (proxies, DELEGATECALL to mutable code; BlockSec covers it
  when enabled, and hookguard's bytecode-layer idea in `RESUME.md` is the
  Docker-free route). Custom math stays unmeasured when no returns-delta is
  declared, because a fee formula over pool state is invisible to a source
  detector. The default gate no longer fails on an undetermined tier unless
  `failOnInconclusive = true`, but it does fail when an engine failed or the
  target was never recognised.
- **Harness reach.** Hooks whose constructor needs a deployed dependency
  (Cork clones a `LiquidityToken`; WETHHook needs WETH) or a factory's
  `parameters()` (v2-on-v4) still cannot be stood up. A hook that refuses
  PoolManager liquidity is stood up but not traded through its own liquidity
  path; its invariants are reported inconclusive with the observed counts, and
  I3 not-applicable once reconciled with the static "disabled by design"
  classification (`seeded: "hooked-failed"`).
- **I2 tolerates 200 bips of drift**, and treats any hooked-only swap revert as
  a failure, so access-controlled hooks will fail I2 by design once reached.
- **Deployed mode** (scan an address, bind the manifest to a codehash) exists
  in the schema only. Uniswap's `hooklist` registry (116 deployed hooks with
  declared flags) is the natural seed for it.
- **BlockSec in CI** needs a decision about a 1.2 GB amd64 image on the runner.

## Where things are

| | |
|---|---|
| Assessment report (pre-fix) | https://claude.ai/code/artifact/73f045de-67ff-49ca-bd7f-56ea478c552a |
| Per-workstream notes | `notes-A.md` … `notes-I.md` |
| Demo | `DEMO_RUNBOOK.md`, `demo.sh` |
| 14-hook before/after | `evidence/scans/README.md`, `evidence/scans/{before,after}/<hook>/` |
| Cork showcase | `evidence/cork-hook.md` |
| BlockSec corroboration | `evidence/blocksec-corroboration.md` |
| Rescan script | `evidence/rescan.sh <hookrisk-root> <out-dir>` (needs the hook clones) |
