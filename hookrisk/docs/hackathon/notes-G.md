# Notes G — harness honesty: a pass over nothing is not a pass

Owner: agent G. Files: `harness/test/{TwinHandler,TwinPools,Generic.t,HarnessValidation.t}.sol`,
`cli/src/harness.ts`, `cli/src/harness.test.ts`, `cli/src/reconcile.ts` (new),
`cli/src/reconcile.test.ts` (new), `docs/INVARIANTS.md`.

## What was wrong

After the P0 fixes the Orbital clone (custom curve, refuses PoolManager
liquidity, keeps its reserves behind its own `addLiquidity`) scanned as:

```
✓ harness    ok   (seeded=hooked-failed)
invariants  I1 passed, I2 passed, I3 passed     runs 256, calls 8192
```

Every one of those 8192 calls was rolled back: the hooked pool had no
liquidity, the hook had no reserves, so every hooked swap reverted and every
liquidity add was undone to keep the twins aligned. The invariants held over
nothing, and the report was byte-for-byte what a genuinely exercised hook
produces. `evidence/scans/after/orbital-hook-ctor/hook-risk.json` is the
"before".

A second defect surfaced while proving the fix. `TwinHandler` wrote
`hookedSwapReverted` and the mid-sequence `exitReverted` *before*
`vm.revertToState(snap)`, which restores the handler's own storage along with
the pools'. Both writes were silently undone, so
`invariant_I2_hookDoesNotBlockSwaps` could never fire and a mid-sequence exit
failure was only ever seen by the end-of-sequence sweep.

## What changed

### 1. Observation log (contract D)

`TwinHandler.observationJson()` renders the sequence's counters as the
ten-field object; `TwinPools._writeObservationLine(runId, json)` appends it
to `harness/out/hookrisk-obs-<RUN_ID>.jsonl`; `GenericHookInvariants.afterInvariant`
calls it after the sweep and *before* the I3 assertions, so a trapped exit
still leaves its counters behind. Unset `HOOKRISK_RUN_ID` writes nothing.

New counters: `positionsClosed` (fuzz removals *and* sweep closes),
`exitFailures`; `positionsOpened` is `liquidityAdds` under the CLI's name.
`swapsExecuted` now counts swaps that landed on **both** pools; the old
attempt counter is `swapsAttempted`. That is what makes I1's rule honest — an
attempt that was rolled back exercised nothing.

Forge runs the five invariant functions in parallel, each writing from its
own thread. `vm.writeLine` issues the line and its newline as two writes, so
the payload carries its own newline (one object per write, cannot interleave)
and the reader skips the resulting blank lines. Two concurrent 256-run scans
produced 1285 intact lines each, zero malformed.

### 2. The CLI weighs the passes (`cli/src/harness.ts`)

`parseObservations()` sums the log (booleans → count of sequences), refuses
any line it cannot read with its line number. `runHarness` reads and deletes
the log next to the run record; a run record without a log is a **failure**
with a reason (setUp finished, rows were reported, nothing says what ran).

`translate()` takes `observations` and downgrades a `passed` row whose
relevant count is zero to `inconclusive`:

| Invariant | zero of |
|---|---|
| I1 | `swapsExecuted + positionsOpened` |
| I2 | `swapsCompared` |
| I2b (custom curve) | `priceChecks` |
| I3 | `positionsOpened` |

The detail is e.g.
`passed vacuously: 0 price checks across 1285 sequences; the hook rejected PoolManager liquidity (Error("Use custom addLiquidity")) so the pool never traded; a swap that worked without the hook reverted with it in 1285 sequence(s). Observed: …`.
A `failed` row is never touched. `HarnessOutcome.observations` (the ten
summed fields, exactly the shape for `coverage.observations`) and
`observedSequences` are exposed for the integrator.

### 3. Cross-layer reconciliation (`cli/src/reconcile.ts`, contract E)

`reconcileLayers({findings, invariants, runRecord, observations}) => {findings, invariants, notes}`,
pure, no I/O, inputs not mutated:

- static `callback-intentionally-disabled` on `beforeAddLiquidity` +
  `seeded: "hooked-failed"` → the finding gains
  `{engine: "harness", nativeRule: "seed-reverted"}`, confidence `high`, and
  an evidence line naming the callback, its selector and the unwrapped
  revert (`Error("…")`, `Panic(…)` or `custom error 0x…` with the selector);
- `hooked-failed` with no static classification on that callback → a
  harness-sourced `callback-intentionally-disabled`, confidence `medium`
  (execution proves the refusal, not the intent), id from `makeFindingId`;
- any static liquidity-callback classification + `hooked-failed` → I3
  `not-applicable`, detail naming the classifications and the revert; a
  `failed` I3 is never overwritten;
- otherwise everything passes through unchanged.

Callback identity is read from `discriminator`, `function.name`
(`_beforeAddLiquidity` resolves) or a bare selector, so BlockSec-shaped
findings match too. `notes` is one line per change for the verbose log.

### 4. `parseDeclaredPermissions` — left in place

`cli/src/cli.ts` still imports it (line 36, used at line 296); removing it
would break the integrator's file. Once cli.ts takes permissions from the
hook-profile finding, delete `parseDeclaredPermissions` from `harness.ts` —
nothing else references it (`permissionsFrom`/`flagsFrom` stay: cli.ts and
`runHarness` use them). `runHarness` is unchanged in accepting
`permissions: Record<string, boolean> | null` and deriving at runtime on null.

### 5. Concurrent scans — verified safe, no lock

Two `forge test --match-contract GenericHookInvariants` at once in one
harness checkout (corpus `CleanHook` vs `HonestFeeHook`, different run ids),
on a built project and again after `rm -rf out cache` so both compiled
simultaneously: both exit 0 with five rows, both run records correct, both
logs 1285 intact lines, `out/IHooks.sol/IHooks.json` intact afterwards.
Scripts: `scratchpad/concurrent.sh`, `scratchpad/concurrent-cold.sh`.
Written up in `docs/INVARIANTS.md` § Concurrent scans; the lock-file fallback
is described there should a forge release change artifact writing.

## Before / after: Orbital

```
before   ✓ harness ok    invariants  I1 passed, I2 passed, I3 passed
after    ✓ harness ok    invariants  I1 inconclusive, I2 inconclusive, I3 inconclusive
         harness: 3 invariant(s), 0 failed, 3 inconclusive (flags=0xa88, seeded=hooked-failed)
                  observed 1285 sequence(s), 0 swap(s) landed, 0 compared, 0 price check(s),
                  0 position(s) opened, 0 closed, 0 donation(s), 1285 hooked-only swap revert(s), 0 exit failure(s)
```

With `reconcileLayers` applied to the same scan's static findings
(`scratchpad/reconcile-orbital.mjs`):

```
callback-intentionally-disabled beforeAddLiquidity    high  hookrisk/hookrisk-disabled-callback + harness/seed-reverted
callback-intentionally-disabled beforeRemoveLiquidity high  hookrisk/hookrisk-disabled-callback
I3 not-applicable — PoolManager liquidity is disabled by design: hookrisk classifies beforeAddLiquidity,
   beforeRemoveLiquidity as intentionally disabled and the harness's seed position was rejected with
   Error("Use custom addLiquidity"). No position can exist on the hooked pool …
```

## How to demo

```bash
make test                                              # 45 harness, 194 CLI, corpus gates
cd harness && forge test --match-contract 'ObservationLog|IdlePool|TrappingHookIsCaught'
cd cli && node --test dist/harness.test.js dist/reconcile.test.js

# The Orbital clone (needs the scratchpad clone and its hookrisk.toml)
cd .../hooks/orbital-hook/repo && node <hookrisk>/cli/dist/cli.js scan src/OrbitalHook.sol:OrbitalHook \
  --skip-static --no-gate --verbose --out /tmp/orbital
#   invariants  I1 inconclusive, I2 inconclusive, I3 inconclusive
jq '.invariants[].detail' /tmp/orbital/hook-risk.json
```

## Tests added

- `HarnessValidation.t.sol`: `ObservationLogIsWritten` (exact line on a busy
  sequence; two appends → two intact objects; no file for an empty run id),
  `IdlePoolIsObservedAsIdle` (the Orbital shape: all zeros,
  `hookedSwapReverted` true); `TrappingHookIsCaught` now asserts the
  mid-sequence exit failure survives the rollback.
- `harness.test.ts`: `parseObservations` (sums, boolean counting, padding,
  refusal with line number), `translate with observations` (all-vacuous,
  per-invariant relevance, custom-curve price checks, the Orbital case,
  failures untouched, not-applicable untouched, no-log compatibility).
- `reconcile.test.ts`: merge, I3 not-applicable, failed I3 kept,
  harness-only finding, custom-error selector, remove-only agreement,
  selector-keyed match, no-op cases, non-mutation.

## Caveats

- `sequences` in the detail is runs × invariant functions (1285 for `scan`:
  forge's runner calls `afterInvariant` 257 times per function). It is the
  number of sequences executed, not the number a single invariant saw.
- `swapsExecuted` changed meaning (landed on both pools, was attempts). The
  only external reader was `LineCurveHookStandsUp`, which still holds.
- The observation log makes the deep profile write ~25k lines (~6 MB); fine.
- Item 6 (full-range seed fallback, `seeded: "full-range"`) was not done in
  the time box.

## Integrator

Exact changes in files I do not own:

1. `cli/src/cli.ts` — after `mergeEngineResults` and `runHarness`, before
   `buildManifest`. Add the import:
   ```ts
   import { reconcileLayers } from './reconcile.js';
   ```
   and, once `invariants`/`outcome` are known (replace the `let invariants`
   flow's end), the single call:
   ```ts
   const reconciled = reconcileLayers({
     findings,
     invariants,
     ...(outcome?.run ? { runRecord: outcome.run } : {}),
     ...(outcome?.observations ? { observations: outcome.observations } : {}),
   });
   for (const note of reconciled.notes) log(note);
   ```
   then pass `findings: reconciled.findings, invariants: reconciled.invariants`
   to `buildManifest` (and `reconciled.findings` to `toSarif`). `outcome`
   must be hoisted out of the `if (!args.skipDynamic)` block
   (`let outcome: HarnessOutcome | undefined`). Note the scorer ran on the
   pre-reconcile findings; reconciliation only changes INFO classifications
   and confidence, so the score is unaffected.
2. `cli/src/cli.ts` — pass the observations through for the manifest:
   `observations: outcome?.observations` into `buildManifest` (agent H
   renders `coverage.observations` from it); `HarnessOutcome.observations`
   has exactly the ten summed fields.
3. `cli/src/cli.ts` — when permissions come from the engine's hook-profile
   finding instead of `parseDeclaredPermissions`, delete
   `parseDeclaredPermissions` from `cli/src/harness.ts` (one function, no
   other callers).
4. `schema/hook-risk.schema.json` (agent H) — `engines[]` rows' `engine` for
   findings now include `"harness"` as an attribution engine
   (`findings[].engines[].engine`); if that field is an enum, add it.
5. `docs/hackathon/HACKATHON.md` "Honest limits": the sentence "A hook that
   refuses PoolManager liquidity is stood up but not traded through its own
   liquidity path, so its invariants pass on an idle pool" is no longer true —
   they are reported `inconclusive` with the counts, and I3 `not-applicable`
   once reconciled with the static classification.
