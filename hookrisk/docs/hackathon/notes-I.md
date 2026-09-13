# I — orchestration, observability, repo hygiene

Everything here is about the seams: how the layers are driven, what a scan says
about itself while it runs, and what a fresh clone of the hackathon repository
does when someone who is not us types `make setup`.

## What changed

### 1. The engines and the harness run concurrently (`cli/src/cli.ts`)

They are independent subprocesses over the same already-compiled sources —
Slither parses the AST, the harness drives `forge`. Running them in sequence
cost the sum; running them together costs the longer of the two. Measured on
`harness/src/hooks/FeeHooks.sol:HonestFeeHook`, from the `--log-json` trace:

```
+0.03s  harness          harness: FeeHooks.sol:HonestFeeHook flags=0x44 …
+0.54s  engine:hookrisk  hookrisk: slither src/hooks/FeeHooks.sol:HonestFeeHook
+7.04s  engine:hookrisk  hookrisk: ok       {"durationMs": 2384}
+7.04s  harness          harness: ok        {"durationMs": 7019}
+7.08s  scan             scan: finished in 7080ms, exit 0
```

7.1 s wall clock against 9.4 s of work. On a real hook the harness dominates by
an order of magnitude, so this is close to free time.

Three things it deliberately does not change:

- **`--timeout` stays a per-engine budget.** Each gets the full value. A shared
  budget would make one engine's slowness read as another's timeout.
- **Output order is not the scheduler's.** Results are unpacked back into the
  declared engine order, then the harness, so two runs over one target still
  produce byte-identical artifacts. Only the *progress* interleaves.
- **`uncoveredFunctions` still reaches the manifest.** It is read off the
  `SlitherEngine` instance after its promise settles; the HR-E205 list is what
  stops a partial scan reading as a complete one.

`Promise.allSettled` rather than `Promise.all`, with the first rejection
rethrown after everything settles. `all` hands back control on the first
rejection, and returning from the scan while `forge` is still fuzzing leaves an
orphaned subprocess writing run records into `harness/out/` that a later scan
could read. A broken engine still fails the whole scan — just not early.

### 2. A logger with a run id (`cli/src/log.ts`, `log.test.ts`)

Once the layers overlap, a flat stream of progress lines stops being readable
*and* stops being parseable. Every line is now an event with a `runId` and a
`stage` (`scan`, `project`, `engine:hookrisk`, `engine:blocksec`, `harness`,
`reconcile`), rendered one of two ways:

- default: the existing verbose lines on stderr, byte for byte, gated on
  `--verbose` exactly as before. The stage is *not* printed — the messages
  already name themselves (`harness: …`) and prefixing would double up.
- `--log-json`: one JSON object per line on stderr,
  `{ts, runId, level, stage, msg, ...fields}`, emitted whatever `--verbose`
  says. A machine consumer that asked for the log wants all of it.

Engines and `runHarness` still take a plain `(message: string) => void`; they
get a pre-tagged sink from `logger.stage(name)` rather than a widened interface.
Envelope keys are not displaceable by a caller's fields (tested) — a stage that
logs `{msg: …}` must not silently rewrite the one field a reader greps.

Structured events carry what a machine branches on: per-engine
`{status, durationMs, findings, errorCode}`, per-harness
`{status, durationMs, invariants: {I1: …, I2: …, I3: …}, errorCode}`, and a
closing `{durationMs, exitCode, tier, total, inconclusive, findings, gatePassed}`.

### 3. The summary goes to stdout

`hookrisk scan … > report.txt` used to produce an empty file: everything went to
stderr and stdout was empty on success. Now the split is the conventional one —
**stdout is the result, stderr is the commentary**. Under `--json` the manifest
takes stdout and the summary is not printed at all, so stdout is never two
things at once.

`supportsColour()` gained a stream parameter as a consequence: the summary must
not pick up escape codes from `process.stderr.isTTY` when it is being redirected
to a file.

### 4. Exit code 64 is documented, not just emitted

`hookrisk` with no command already exited 64 and said so nowhere. It is now in
the usage text (a full `EXIT CODES` block), in `docs/ARCHITECTURE.md`'s table,
and in `errors/catalog.json`'s `reserved` map, which is what generates
`docs/TROUBLESHOOTING.md`. 64 is `sysexits.h` `EX_USAGE`; it is the one code
with no `HR-E` entry, because there is nothing to diagnose — the usage text is
the whole message. `--help` still exits 0: asking for help succeeds, being given
nothing to do does not.

### 5. The packaging decision, made explicit (`cli/src/home.ts`, `home.test.ts`)

The CLI is **not self-contained**. It shells out to `harness/` and reads
`schema/hook-risk.schema.json` and `schema/framework-rubric.json` at runtime.
Until now three modules each found those on their own by walking up from their
compiled location, which works from a checkout and fails *silently* everywhere
else: the harness reported `skipped — harness project not found`, buried in an
engine row, and the scan carried on and produced a manifest. A broken install
and a deliberate `--skip-dynamic` looked identical.

`resolveHome()` now runs once, first thing in `commandScan`:

1. `HOOKRISK_HOME`, when set.
2. Two levels up from `dist/` — the monorepo layout.

A candidate counts only if it holds **both** `harness/foundry.toml` and
`schema/`. Neither: `HR-E005`, naming each candidate and what it lacked, telling
the reader to run `make setup` or set `HOOKRISK_HOME`. The resolved paths are
threaded through explicitly — `runHarness({harnessRoot})`,
`validateManifest(manifest, schemaFile)`, `loadRubric(path)` — so there is one
answer per scan rather than three independent guesses.

Proven by relocating `cli/dist` outside the repository:

```
HR-E005  hookrisk cannot find its own installation
  Context:
    relative-to-dist  /…/scratchpad/fakeinstall (missing harness/foundry.toml, schema)
EXIT=10
```

and by rescuing the same binary with `HOOKRISK_HOME` pointed at the checkout
(`"homeSource":"HOOKRISK_HOME"` in the JSON log).

**`cli/package.json` is now `"private": true`.** npm cannot express what
hookrisk is. Publishing the CLI alone ships something that fails HR-E005 on
first use for everyone who installs it; the `npx hookrisk` line in the README is
aspirational, not a thing that works. A real split needs the harness and the
schemas to get a distribution of their own — either vendored into the tarball
along with `harness/lib/` (62 MB of pinned Solidity, materialised by
`make deps`, which is why it is not committed), or shipped as a second package
the CLI resolves. That also means deciding what a published `hookrisk` does when
`forge` is absent, and versioning the harness against the CLI so a mismatched
pair cannot silently produce a run record the CLI cannot read. None of it is
needed while the supported entry point is `make setup` in a checkout — so the
manifest says so, out loud, instead of leaving a publishable-looking package
that would break on contact.

### 6. `errorCodeFor()` (`cli/src/errors.ts`, `errors.test.ts`)

`describeFailure()` produces prose for a human; `errorCodeFor()` produces the
identifier a machine branches on. It reads a code already embedded in a rendered
reason (engine reasons open with one) before falling back to the catalogue
regexes — re-deriving a code from a paraphrase can land somewhere else, which is
how one failure ends up with two names. Returns `undefined` for
`--skip-static`-style reasons, so a switched-off engine does not acquire an
error code.

Used today in the `--log-json` fields. `EngineResult.errorCode` and
`engines[].errorCode` in the manifest are other people's files; see *Integrator*.

### 7. A fixture for the third outcome (`harness/src/hooks/RefusingHook.sol`)

New file, nothing existing touched. It declares `beforeInitialize` and reverts
in it unconditionally, so the twin-pool fixture cannot create the hooked pool
with a static fee, cannot create it with a dynamic fee either, and `setUp()`
reverts before a single sequence runs.

That is the fixture for the outcome that has no other fixture: not "the
invariants held", not "the invariants found a counterexample", but *the dynamic
layer never measured anything*. It is the exact failure hookrisk shipped with —
a reverting `setUp` reported `ok` with three passed invariants, because "no
counterexample was found" and "nothing was tried" are indistinguishable from
outside.

### 8. CI and dogfood

- **`dogfood.yml` has a third job**, `unrunnable-hook`: the action on
  `RefusingHook` with `skip-dynamic: false`, asserting
  `.coverage.harnessStatus == "failed"`, every invariant `inconclusive` (not
  merely "none failed" — `skipped` and `passed` are both wrong answers here),
  `HR-E304` in the harness reason, and a process exit of 2. All four verified
  locally against the built CLI (below).
- **`ci.yml` now runs the Makefile targets** it was paraphrasing. The
  `detectors` job's two hand-rolled greps had drifted badly: they named three of
  the five detectors, never ran the legacy gate, never ran `detectors/tests`,
  and decided the outcome by grepping Slither's human summary for
  `0 result(s) found` — which a *compile failure* also prints. CI was green on a
  scan that analysed nothing. It is now `make test-corpus`, which gates on
  `.success` in the JSON first. Likewise `make check-generated`, `make deps`,
  `make test-cli` (globs `dist/**/*.test.js`, so new test files are picked up in
  CI the moment they are picked up locally).
  - The `detectors` job now builds the venv (`make venv install-detectors deps`)
    because `make test-corpus` calls Slither through `$(abspath $(SLITHER))`,
    and `abspath` on a bare `slither` from PATH yields `$CURDIR/slither`, which
    does not exist. Same code path as a laptop.
- **`make test` does run `detectors/tests`** — via `test-corpus`, last, 17 tests.
  Confirmed, unchanged.

### 9. `.gitignore`

- `!docs/hackathon/evidence/**`. The `hook-risk.json` / `HOOK_RISK.md` /
  `hookrisk.sarif` patterns are filename-shaped, so every committed piece of
  evidence matched one and had to be `git add -f`ed — which is exactly how a
  piece of evidence goes missing. The negation works only because no *directory*
  on that path is excluded; there is a comment saying so, because the day
  someone ignores `docs/` this silently stops working.
- The `make build-detectors` comment is gone. There is no such target; the
  catalogue copy is a setuptools packaging artefact.

## How to demo

```bash
make setup && make test

# 1. Concurrency and the structured log, on a hook that stands up.
cd harness
node ../cli/dist/cli.js scan src/hooks/FeeHooks.sol:HonestFeeHook --log-json --no-gate
#   stderr: one JSON object per line, every line carrying the same runId;
#           `harness` and `engine:hookrisk` stages overlap in the timestamps
#   stdout: the summary

# 2. The third outcome: a hook nobody can execute is inconclusive, not clean.
node ../cli/dist/cli.js scan src/hooks/RefusingHook.sol:RefusingHook
echo "exit: $?"                     # 2
jq -r '.coverage.harnessStatus, ([.invariants[] | .id + "=" + .status] | join(" "))' hook-risk.json
#   failed
#   I1=inconclusive I2=inconclusive I3=inconclusive

# 3. stdout is the result, stderr is the commentary.
node ../cli/dist/cli.js scan src/hooks/FeeHooks.sol:HonestFeeHook --skip-dynamic --no-gate 2>/dev/null
#   the summary, alone
node ../cli/dist/cli.js scan src/hooks/FeeHooks.sol:HonestFeeHook --skip-dynamic --no-gate --json | jq .score.tier
#   the manifest, alone

# 4. A misinstalled CLI fails loudly instead of scanning half the hook.
cp -R cli/dist /tmp/loose && cd corpus
HOOKRISK_ERROR_CATALOG=$PWD/../errors/catalog.json node /tmp/loose/cli.js scan src/good/CleanHook.sol:CleanHook
#   HR-E005, exit 10, naming the missing directories and `make setup`
HOOKRISK_HOME=$PWD/.. HOOKRISK_ERROR_CATALOG=$PWD/../errors/catalog.json \
  node /tmp/loose/cli.js scan src/good/CleanHook.sol:CleanHook --skip-dynamic --no-gate
#   works

# 5. Usage is a distinct outcome from a failed scan.
node cli/dist/cli.js ; echo $?          # 64
node cli/dist/cli.js --help ; echo $?   # 0
```

## Caveats

- **Interleaved human output.** With `--verbose` and no `--log-json`, the
  harness's and the engines' lines now interleave. Every line still self-
  identifies with a prefix, so it is readable, but it is no longer a
  chronological narrative of one thing at a time. `--log-json` is the answer
  when that matters; the stage tag is only in the JSON.
- **Two run ids.** The logger's `runId` correlates the log; `runHarness`
  generates its own UUID for the run-record filename. They are different values
  for different jobs and the log prints both (`run=<harness id>` inside the
  harness's own line). Unifying them means changing `harness.ts`, which is not
  mine — see *Integrator*.
- **`--log-json` is not plumbed into `action/action.yml`.** The action still
  passes `--verbose`. Adding a `log-json` input is one block; it was not needed
  to make the dogfood assertions work, so it is not there.
- **`errorCode` is in the log, not yet in the manifest.** `EngineResult` has no
  such field to set. See *Integrator*.
- **The `unrunnable-hook` dogfood job runs the scan twice** — once through the
  action (which owns the outputs) and once directly (which owns the exit code).
  RefusingHook fails `setUp` in seconds, so the duplication costs almost
  nothing, and asserting the published exit code directly rather than inferring
  it from `gate-passed` is worth more than the seconds.
- **`HR-E005`'s two `match` patterns are loose** (`cannot find its own
  installation`, `HOOKRISK_HOME`). They exist so a pasted error is classifiable;
  nothing in the CLI reaches HR-E005 through `classify()`, only through an
  explicit throw.

## Integrator

Exact one-line changes in files I do not own.

1. **`README.md`, the "In your own hook repository" block.** `npx hookrisk` does
   not work and cannot work while `cli/package.json` is private. Replace:

   ```bash
   npx hookrisk init                              # writes hookrisk.toml
   forge build                                    # hookrisk reads your artifacts
   npx hookrisk scan src/MyHook.sol:MyHook
   ```

   with:

   ```bash
   # hookrisk runs from a checkout; `make setup` is the install step.
   # Point HOOKRISK_HOME at it if you want the CLI on your PATH from elsewhere.
   alias hookrisk="node /path/to/hookrisk/cli/dist/cli.js"

   hookrisk init                                  # writes hookrisk.toml
   forge build                                    # hookrisk reads your artifacts
   hookrisk scan src/MyHook.sol:MyHook
   ```

2. **`README.md`, the CI exit-code sentence** (`0` passed, `2` gate failed,
   `10+` …): add `` `64` bad command line`` to the list.

3. **`README.md`, the dogfood paragraph**: it says the workflow asserts "a clean
   hook passes **and** a planted-bug hook fails". There is now a third case —
   append "and a hook the harness cannot stand up comes back inconclusive rather
   than clean".

4. **`cli/src/types.ts`** (agent F) — add to `EngineResult`:

   ```ts
   /** Catalogue code for the failure, when status is `failed`. See errorCodeFor(). */
   errorCode?: string;
   ```

5. **`cli/src/engines/slither.ts` and `blocksec.ts`** (agents F, E) — on every
   `status: 'failed'` return, alongside `reason`:

   ```ts
   ...(errorCodeFor(reason) ? { errorCode: errorCodeFor(reason) } : {}),
   ```

   `errorCodeFor` is exported from `./errors.js` (and re-exported from
   `index.ts`). It reads the `HR-Exxx` prefix `describeFailure` already put in
   `reason`, so it will not disagree with the text.

6. **`cli/src/manifest.ts`** (agent H) — in the `engines[]` serialiser, after
   `...(result.reason ? { reason: result.reason } : {})`:

   ```ts
   ...(result.errorCode ? { errorCode: result.errorCode } : {}),
   ```

   and the same for the harness row, from `errorCodeFor(input.harness.reason)`.

7. **`cli/src/harness.ts`** (agent A) — optional, closes the two-run-ids caveat.
   Add `runId?: string` to `HarnessOptions` and use it in place of the internal
   `randomUUID()` when given; `cli.ts` then passes `runId: log.runId` and one id
   covers the log, the run record and the manifest.

8. **`schema/hook-risk.schema.json`** (agent F) — `engines[].errorCode`,
   `{"type": "string", "pattern": "^HR-E[0-9]{3}$"}`, per contract F.

9. Nothing to do for `docs/TROUBLESHOOTING.md`; it is generated. If anyone edits
   `errors/catalog.json`, run `make docs` — `make check-generated` fails
   otherwise, and it runs in CI.
