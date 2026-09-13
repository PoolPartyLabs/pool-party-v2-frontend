# Architecture

```
                    hookrisk.toml            declared inputs, gate policy
                          │
   ┌──────────────────────┼──────────────────────┐
   │                      │                      │
   ▼                      ▼                      ▼
 ENGINES               HARNESS                SCORING
 static analysis       differential           the framework, as code
   │                   invariants                 │
   │  hookrisk ──┐         │                      │
   │  blocksec ──┤         │                      │
   │             ▼         │                      │
   │        reconcile      │                      │
   └────────────►│◄────────┘                      │
                 │                                │
                 ├──── derive dimensions ─────────┤
                 │     (never 0 unless someone     │
                 │      capable actually looked)   │
                 ▼                                ▼
              ┌──────────────────────────────────────┐
              │            hook-risk.json            │
              │  bound to (chainId, address, codehash)│
              └──────────────────────────────────────┘
                 │              │              │
            HOOK_RISK.md   hookrisk.sarif    exit code
```

## Why three layers

Each sees something the others cannot.

**Static analysis** sees structure: a missing access check, a proxy, a
permission declared but never implemented. It is fast, needs no execution, and
points at an exact line — which is what makes a finding actionable in a pull
request.

**The harness** sees behaviour. A hook that documents 1% and charges 3.5% has
flawless structure; the defect is a constant. No static analyzer can express it.
Only running the same trade through two pools that differ in nothing but the hook
reveals it.

**Scoring** sees consequence. Findings are evidence, not a verdict. The framework
asks what security work a hook's *inherent risk profile* demands, and that is a
different question from "what bugs does it have today".

A tool with only the first layer is a linter. With only the second, a test suite.
The third is what makes it an assessment, and it is the layer nobody had built.

## The pieces

| Directory | What | Language |
|---|---|---|
| [`detectors/`](../detectors) | Slither plugin, HS-xx rules | Python · **AGPL-3.0** |
| [`harness/`](../harness) | Twin-pool differential invariants | Solidity · Foundry |
| [`cli/`](../cli) | Orchestration, reconciliation, scoring, manifest | TypeScript |
| [`schema/`](../schema) | Manifest schema, framework rubric as data | JSON |
| [`corpus/`](../corpus) | Fixtures that must fire and must not | Solidity |
| [`errors/`](../errors) | Error catalogue, shared by both runtimes | JSON |
| [`action/`](../action) | Composite GitHub Action | YAML |

## Single sources of truth

Four things are generated or shared rather than duplicated, each because
duplicating it had a specific failure mode.

### Hook constants

`scripts/gen_hooks_spec.py` derives the 14 permission flags and 10 callback
selectors from the pinned v4-core, computing selector digests with `cast sig`
rather than shipping our own keccak.

Then [`HooksSpec.t.sol`](../harness/test/HooksSpec.t.sol) asserts the same values
through **solc**, a completely different oracle. Regex-parsing a language is a
claim, not a proof.

The failure this prevents: a v4 upgrade moves a bit, the generated file goes
stale, detectors key off a selector that no longer matches, and every scan
reports clean. **A stale constant fails open**, and a security tool that fails
open looks exactly like one that works.

CI fails if the checked-in file differs from what the pinned source produces.

### Error catalogue

[`errors/catalog.json`](../errors/catalog.json) is loaded by the Python detectors
*and* the TypeScript CLI, and generates
[TROUBLESHOOTING.md](TROUBLESHOOTING.md). One failure reads identically whichever
surface produced it, and the fix printed in your terminal cannot be stale on the
website.

Each entry carries regexes matched against raw tool output, so cryptic upstream
failures are auto-classified. The motivating case: crytic-compile aborting with
`AssertionError: Contract IExttload not found` when the real problem was a `..`
in a Foundry `libs` entry. No amount of staring at that message would tell you.

### Framework rubric

[`schema/framework-rubric.json`](../schema/framework-rubric.json) holds
dimensions, tiers, triggers and recommendations as data, with every
interpretation marked. A reviewer can diff our reading of the framework against
the framework without reading code.

### Rule taxonomy

Engines use their own rule names. A canonical class — declared in
[`types.ts`](../cli/src/types.ts), mirrored in the detector metadata — lets the
same defect found by two tools become one finding rather than two.

## Reconciliation

Running several analyzers over one contract produces overlap. Findings are keyed
by *what they are about* (class, location, function), not by who reported them.

Cross-foundation agreement raises confidence to `high`. Our detectors work on
solc's AST; BlockSec's HookScan on the Yul CFG. Agreement between them is close
to independent confirmation — the best false-positive filter available without a
human reading the code.

Agreement between engines sharing a foundation is *not* treated as independent.
Every pairing today is cross-foundation, but the rule is written out so adding a
second AST-based engine later cannot quietly inflate confidence across the whole
report.

[`dedupe.ts`](../cli/src/engines/dedupe.ts)

## From findings to a score

The join, and the place where it would be easiest to be quietly dishonest.

Each dimension declares which rule classes can raise it; each class declares
which engines produce it. A dimension is `measured: 0` only when every
responsible engine ran. Otherwise it is `unmeasured` — excluded from the total,
never counted as zero.

The consequence is visible and correct: with only three detectors implemented,
most dimensions come back unmeasured and the tier is a **range**. That is the
right output for the current state of the tool, and better than a confident
number resting on detectors that do not exist.

See [SCORING.md](SCORING.md).

## Reaching an arbitrary hook

The harness lives here; a user's hook lives elsewhere. The bridge is the hook's
creation bytecode, read from its Foundry artifact and passed through
`HOOKRISK_CREATION_CODE`. `TwinPools` etches it at a flag-bearing address, runs
the constructor, and etches the runtime code — the same procedure forge-std's
`deployCodeTo` uses.

Passing bytes rather than a name is what makes cross-project scanning work at
all. `vm.getCode("File.sol:Contract")` resolves against the *harness's* own
compilation index, so an artifact merely copied into its `out/` directory is
invisible and fails with `no matching artifact found` — which reads like a
missing file when the file is sitting right there.

This is also more robust than generating Solidity and compiling it inside the
user's project: no remappings to reconcile, no solc version to agree on, and the
invariants under test are the same bytes CI runs against our own fixtures.

## The manifest is the product

Everything else exists to fill in
[`hook-risk.json`](../schema/hook-risk.schema.json). It is validated against its
schema before being written — consumers rely on the schema, and emitting
something that violates it would push the failure onto them.

It is bound to one `(chainId, address, codehash)`. A manifest whose codehash no
longer matches describes something that no longer exists, which is also why
upgradeability raises a hook's tier: an upgradeable hook cannot carry a durable
assessment.

Three things the manifest records that a report normally omits:

- **Engines that did not run**, and why. So a reader can tell "nothing was found"
  from "nothing looked".
- **Functions static analysis could not reach** (`HR-E205`).
- **Which brackets are the Foundation's and which are ours.**

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Scan completed, gate passed |
| `2` | Scan completed, **gate failed** — a result, not an error |
| `10`–`70` | hookrisk could not run; the code identifies why |
| `64` | Usage: unknown or missing command. Nothing was scanned |
| `1` | Never emitted deliberately — reserved for an uncaught crash |

Reserving `1` lets CI distinguish "hookrisk reported a problem" from "hookrisk
itself broke". Only one of those should page someone.

`64` is `sysexits.h`'s `EX_USAGE` and is the one code with no `HR-E` entry
behind it: the command line was wrong, so there is nothing to diagnose and the
usage text is the whole message. `hookrisk --help` exits `0` — asking for help
succeeds; being given nothing to do does not.

## Streams

| Stream | Carries |
|---|---|
| stdout | The result: the summary, or the manifest under `--json`. Never both |
| stderr | Progress (`--verbose`, or JSON lines under `--log-json`) and errors |

Engines and the harness run concurrently — they are independent subprocesses
over the same already-compiled sources, so a scan costs the longer of the two
rather than their sum, and `--timeout` is a per-engine budget that each gets in
full. Their progress therefore interleaves, which is why `--log-json` tags every
line with a `stage` (`project`, `engine:hookrisk`, `engine:blocksec`, `harness`,
`reconcile`, `scan`) and a `runId` shared by every line of one scan. The order
of the *results* is not left to the scheduler: engine rows keep their declared
order and the harness follows, so two runs over one target produce identical
artifacts.

## Installation layout

The CLI is not self-contained and is not published to npm. It shells out to the
Foundry project in `harness/` and reads `schema/hook-risk.schema.json` and
`schema/framework-rubric.json` at runtime, so it only works from a checkout that
`make setup` has prepared. It finds those two directories in this order:

1. `HOOKRISK_HOME`, when set — for a CLI deliberately installed away from the
   repository, such as inside a container image.
2. Two levels up from its own `dist/`, which is the monorepo layout.

A candidate counts only if it holds **both** `harness/foundry.toml` and
`schema/`; anything else fails immediately with `HR-E005` naming what was
missing. That check exists because the previous behaviour was worse than a
crash: a CLI with no harness reported the dynamic layer as `skipped` in an
engine row and produced a manifest anyway, so a broken install and a deliberate
`--skip-dynamic` looked identical.

Splitting the CLI into a publishable package means giving the harness and the
schemas a distribution of their own — vendoring `harness/` into the tarball
along with its pinned `lib/`, or shipping them as a second package the CLI
resolves. Neither is free and neither is needed while the supported entry point
is `make setup` in a checkout.
