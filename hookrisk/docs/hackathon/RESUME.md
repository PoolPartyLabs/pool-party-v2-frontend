# Resuming the hackathon work

Read this first in a new session. It says where the work is, what was
decided and why, how to regenerate anything that is not in the repo, and what
is still open. Everything below is checkable against the branch.

## Where the work is

| | |
|---|---|
| Branch | `feat/hackathon-p0`, pushed to `origin` = `0xmvercosa/hookrisk` (write access granted 2026-09-12; the local branch tracks it) and mirrored to the private backup remote `mine` = `github.com/rafaelzochling/hookrisk`. `main` is the untouched upstream state. |
| Environment | `make setup` then `make test`. Expected green after the fourth pass: 298+ CLI tests, 45+ harness tests (1 skipped), 29+ detector tests, 3 corpus gates. `./scripts/doctor.sh` must show the detectors registered. |
| Narrative | `HACKATHON.md` (what was found, what changed in two passes, limits) |
| Per-change notes | `notes-A.md` … `notes-I.md` (A–E pass 1, F–I pass 2). Each has a "How to demo", "Caveats" and "Integrator" section. |
| Demo | `DEMO_RUNBOOK.md` (nine verified steps) and `demo.sh <hookrisk-root> <clones-root>` (about 90 s) |
| Evidence | `evidence/scans/{before,after}/<hook>/` manifests and logs, `evidence/scans/README.md` comparison table, `evidence/cork-hook.md`, `evidence/blocksec-corroboration.md`, `evidence/agent-scan-results-before.json` (the first agent run's structured findings) |
| Pre-fix assessment | https://claude.ai/code/artifact/73f045de-67ff-49ca-bd7f-56ea478c552a (private artifact; the same content is summarised in HACKATHON.md) |

## The 14 hook clones are not in the repo

They lived in a session scratchpad. To regenerate evidence or run the demo,
re-clone them. `DEMO_RUNBOOK.md` records the repo URL, the exact commit, the
build command and the `hookrisk.toml` for every hook it uses; the full list
with commits is in `evidence/agent-scan-results-before.json` (`repo`, `notes`)
and `evidence/scans/after/<hook>/HOOK_RISK.md`. Two things bite on a fresh
clone:

- Several 2023 repos pin nested submodules with `git@github.com:` URLs, so
  `git clone --recurse-submodules` fails without an SSH key. Fix:
  `git config --global url."https://github.com/".insteadOf "git@github.com:"`
  before cloning, or `git submodule set-url` inside `lib/v4-periphery`.
- `ref-fee-hook` never compiled upstream; it is kept only because it exercises
  the "static engine failed with an error code" path.

Then: `evidence/rescan.sh <hookrisk-root> <clones-root> <out-dir>` reads the
target for each slug from `evidence/agent-scan-results-before.json` and expects
`<clones-root>/<slug>/repo` for each. Orbital needs
`[harness] constructorArgs = ["$poolManager", "$currency0", "$currency1", "$currency1"]`
and `maxFeeBips = 10` in its `hookrisk.toml` (copy is in
`evidence/scans/after/orbital-hook-ctor/hookrisk.toml`).

## Decisions made, and why

- **The harness derives permissions from runtime code, always.** The static
  engine also resolves `getHookPermissions()`, but engines and the harness run
  concurrently, and the runtime derivation is the set the PoolManager would
  obey. Both are recorded (`permissions.fromEngine`, `permissions.fromRuntime`)
  and a disagreement is reported. The regex source parser was deleted.
- **Classifications never fail the gate.** `custom-accounting`,
  `callback-intentionally-disabled`, `unsupported-hook-abi` and `hook-profile`
  are INFO and exempt from `maxSeverity` (`isClassification` in
  `cli/src/types.ts`).
- **An undetermined tier fails the gate only with `failOnInconclusive = true`.**
  Six of nine dimensions had no detector, so the old default failed every
  hook including the official template. `hookrisk init` no longer writes
  `maxTier`. Our own fixtures (`harness/hookrisk.toml`) keep the strict
  setting because the dogfood workflow asserts an unrunnable hook exits 2.
- **Complexity is measured from the hook profile**, never from the absence of
  findings. Brackets are in `schema/framework-rubric.json` marked
  `interpretation: true`.
- **A zero-observation invariant pass is inconclusive.** The harness appends
  per-sequence counts (`harness/out/hookrisk-obs-<run>.jsonl`); the CLI sums
  them into `coverage.observations` and downgrades vacuous passes.
- **Static and dynamic layers reconcile** (`cli/src/reconcile.ts`): a
  deliberate revert-guard seen by HS-02 and a seed revert seen by the harness
  become one finding attributed to both, and I3 becomes not-applicable.
- **BlockSec runs with three workarounds** (platform, entrypoint bypass,
  mounted solc from binaries.soliditylang.org cached under
  `~/.cache/hookrisk/solc`). A symlinked `lib/` (as in `corpus/`) cannot be
  mounted; test BlockSec on `harness/` or a real project.
- **Monorepo install only.** `cli/package.json` is `private`; the CLI locates
  `harness/` and `schema/` relative to `dist/` or via `HOOKRISK_HOME`.
- **Deployed mode may not decode an address's permission bits until it knows
  which PoolManager it is talking to.** `hooks_spec.FLAG_BITS` is the final v4
  layout. Unichain's preview PoolManager (`0x1F98400…0004`) is a different
  deployment whose ten callback flags decode in the **reverse** order, and whose
  four returns-delta positions match neither layout; hookguard measured 17 of 18
  hooks agreeing with the reversed reading there against 1 of 18 with ours. So
  deployed mode needs a per-chain `PoolManager address -> bit layout` table and
  a `permissionBitLayout` field recorded on the target *before* any address is
  decoded, plus a refusal to decode when the PoolManager is unknown. Publishing
  a confidently wrong permission set is worse than publishing none: HS-02's
  whole value is that the three permission sources are compared, and a
  mis-decoded fourth source would manufacture divergences that do not exist.
  (`docs/hackathon/research/hookguard.md` §4.)

## Gotchas that cost time

- `.gitignore` ignores `hook-risk.json` and `HOOK_RISK.md` everywhere; the
  evidence directory is negated, but check `git status` after regenerating.
- The manifest schema is strict (`additionalProperties: false`). A new field
  emitted by the CLI without a schema entry fails every scan with HR-E501 and
  writes `hook-risk.invalid.json`. `make test` does not run a full scan, so
  run one (`corpus/`: `node ../cli/dist/cli.js scan src/good/CleanHook.sol:CleanHook`)
  after touching the manifest.
- Slither refuses to overwrite an existing `--json <file>`; the CLI uses a
  fresh temp path, ad-hoc runs must too.
- Concurrent scans in one checkout are safe (verified with forge 1.7.1); run
  records and observation logs are keyed by run id.

## Third pass: what the re-scan found and what was fixed

After the design pass, 14 agents re-scanned the hooks against the new build
(`evidence/agent-scan-results-after.json`). Fixed from that list: HS-01 no
longer reports a HIGH on a callback whose body is an unconditional revert
(Cork's `beforeAddLiquidity` was double-classified); `callback-intentionally-disabled`
is anchored on the analysed hook when the revert lives in an inherited base
(WETHHook, StablePairHook lost the classification to the file filter);
HS-07 and the scorer distinguish a swap-side returns-delta from a
liquidity-only one (LiquidityPenaltyHook was scored as a custom curve);
engine failures and an unrecognised target now fail the gate by default
(`failOnNotAnalysed`; three unanalysed hooks had passed with exit 0);
inconclusive invariants no longer say "passed vacuously"; the report's
findings count and the engine table agree about the hook profile; titles
are cut at word boundaries; the FEEDBACK link is absolute; the harness carries
an error code when skipped; `permissions.disagreement` is always present when
both sets exist; HR-E304/305 are documented as engine results, not exit codes;
the harness skip says "does not compile" when the static engine already knows.

Still open from that run, in addition to the list below: the `hook-profile`
metric `externalCallsInSwapPath` counts PoolManager settlement calls together
with third-party calls, so it cannot feed externalDependencies until the
destinations are classified; `hasOwnerOnlyFunctions` misses AccessControl
(`hasRole`/`onlyRole`) and reports StablePairHook as having no admin surface;
HR-E205 uncovered functions are compilation-unit wide, not scoped to the
target's inheritance chain; the security plan is derived from the lower-bound
tier while the tier is undetermined (should merge the upper bound's baseline);
raw revert data in harness failures is not decoded against the target's ABI;
the fuzz seed is not recorded, so observation counts differ run to run;
`coverage.uncoveredFunctions = []` reads as full coverage when the target was
never analysed (a `coverage.targetAnalysed` field would settle it); wrapper
hooks that require `fee == 0` (WETHHook) cannot be stood up and the message
implies constructor arguments would fix it.

## Deployed mode design

Deployed mode is still schema-only (`target.address`, `chainId`, `codehash` and
address-bit decoding are specified and unimplemented). The research pass fixed
its shape; this is the design to build against.

1. **Seed from the registry, not from a crawl.** Uniswap's `hooklist` is 116
   deployed hooks with declared flags and metadata — an authoritative, small,
   attributable starting set. hookguard's census puts registry coverage at
   1.24% of the hooks that have ever emitted `Initialize` on Unichain, so the
   registry is a seed, never a denominator.
2. **Source via Sourcify**, falling back to the block explorer, then to
   nothing. Only about **17% of the busiest off-registry hooks publish source
   at all**, which is the hard ceiling on everything the detectors can do; the
   honest output for the other 83% is a bytecode-only assessment that says so,
   not a clean report.
3. **First check: address bits versus `getHookPermissions()`.** This is the one
   check that only deployed mode can make — the address is what the PoolManager
   obeys, and the declaration is what the author intended. It is also the
   check the bit-layout landmine above breaks, so it ships with the layout
   table or not at all. It slots into the existing `permissions` section as
   `fromAddress`, next to `fromSource`, `fromEngine` and `fromRuntime`, and
   into HS-02's divergence kinds, which already reserve
   `address-disagrees-with-source`.
4. **Bind the manifest to the codehash.** `target.codehash` already exists and
   the report already prints "this report describes something that no longer
   exists" when the code changes. Deployed mode makes that binding real:
   `eth_getCode` at a pinned block, hashed, recorded with the chain id and the
   block number.
5. **Measure upgradeability from bytecode, without Docker.** hookguard's
   bytecode layer is the model: read the EIP-1967 implementation slot with
   `eth_getStorageAt`, match the EIP-1167 minimal-proxy pattern, and classify
   each `DELEGATECALL` target as constant (immutable library) or storage-derived
   (upgradeable) by walking a short instruction window back from the call. That
   yields `upgradeable-hook` and `selfdestruct` — the two classes hookrisk
   currently gets only from BlockSec's 1.2 GB amd64 image — from an RPC call and
   a disassembler, which is what makes them affordable in CI. The same pass
   gives codehash clone families, so one assessment can cover every byte-identical
   deployment.
6. **Deployed mode does not retire the harness.** It forks at the pinned block
   and runs the same twin-pool comparison against the real hook, which is the
   only way the probes (EOA guard, exclusivity, selectors) mean anything about
   the contract users are actually trading against.

## Fourth pass: what the research notes turned into

`research/hacken.md` and `research/hookguard.md` were written read-only against
two other tools; this pass implemented the items they ranked highest, all
re-implemented from described behaviour, nothing copied.

- **HS-03 admin surface**, **HS-05 external call in the swap path** and
  **HS-06 unbounded dynamic fee** now exist as detectors, with corpus fixtures
  on both sides. They move `autonomousParameterUpdates`, `externalDependencies`
  and `priceImpactingBehavior` from "no detector" to measurable, and each one's
  score bracket is recorded in `schema/framework-rubric.json` as a
  `findingDerivation` marked `interpretation: true` with a rationale per rule.
  None of the three licenses a measured **0**: each detector's blind spot is
  its dimension's own lowest bracket (see `docs/SCORING.md`).
- **Three harness probes** run against the deployed hook at the end of `setUp`,
  before the fuzz campaign: an EOA-guard call per implemented callback, a
  foreign-`PoolKey` exclusivity call as the PoolManager, and a selector check
  per callback. They are recorded in the run record as
  `permissions.harnessRun.probes` and mapped in `cli/src/reconcile.ts`: an
  unguarded callback HS-01 already found becomes one finding with two engine
  attributions at high confidence, an unguarded callback HS-01 missed becomes a
  harness-sourced `unprotected-hook-callback`, an accepted foreign key becomes
  the INFO classification `unvalidated-pool-key`, and a wrong or reverting
  selector becomes a HIGH `callback-selector-mismatch`.
- **The harness is now a coverage source**, not only an invariant runner: it is
  the engine responsible for the two probe-only classes and counts as having
  looked when its status is `ok` (`enginesThatLooked` in
  `cli/src/scoring/derive.ts`).

## Fourth pass: research adoption

From `research/hacken.md` and `research/hookguard.md`, four detectors and three
execution probes landed (notes-P/H/T): HS-03 admin surface (unguarded HIGH,
owner-only MEDIUM, caller-funded liquidity paths LOW), HS-05 third-party calls
in the swap path (one per destination, static/unhandled flagged), HS-06
unbounded dynamic fee, HS-02's "delta flag declared, never returned" case; and
the harness now probes every implemented callback from an EOA (corroborates
HS-01 by execution), checks the selector each callback returns as the
PoolManager, and tries a foreign pool key (`unvalidated-pool-key`
classification). Complexity, autonomous-parameter-updates, external
dependencies and price-impact are measured where the evidence exists.

Known limit: v2-style `mint`/`burn`/`sync`, where the caller pays by
transferring tokens beforehand, still read as unguarded HIGH admin surface
(v2-on-v4); the caller-stake heuristic sees a `transferFrom(msg.sender, …)`,
a msg.sender-indexed mapping, or a token-base call carrying msg.sender, and v2
has none of those in the call.

## Open items, in priority order

1. Detectors for the dimensions still unmeasured: HS-04 upgradeability
   (StablePairHook is UUPS; the profile does not see proxies yet, and the
   bytecode route in *Deployed mode design* is cheaper than BlockSec),
   `externalLiquidityExposure` (no rule class at all), and the two blind spots
   the new detectors left — a self-adjusting parameter with no admin surface
   (autonomy, not admin surface) and an external dependency read outside the
   swap path (a `hook-profile` metric counting them would close it).
2. Harness reach: full-range seed fallback (`minUsableTick..maxUsableTick`)
   for full-range-only hooks; factory-parameter constructors (v2-on-v4);
   constructors needing a deployed dependency (Cork's `LiquidityToken`,
   WETHHook's WETH) via a per-hook deploy script hook.
3. Deployed mode, per *Deployed mode design* above. Blocked on the per-chain
   permission-bit-layout table; start there.
4. BlockSec in CI (1.2 GB amd64 image; decide on caching), and `--log-json`
   exposed as an action input.
5. `dedupe` merges cross-engine by selector; a hook that overloads a callback
   name would key ambiguously (not observed in 15 hooks).

## Conventions the code follows

Comments explain why, not what. No new CLI runtime dependencies (only `ajv`).
Error paths fail loudly with a catalogue code (`errors/catalog.json`, then
`make docs`). Every behaviour change has a test, and the harness has a
"proves it detects" test for every planted defect. Generated files are
checked in CI (`make check-generated`). Parallel work was done in worktrees
with disjoint file ownership and merged by an integrator; the per-agent notes
are the record of each seam.
