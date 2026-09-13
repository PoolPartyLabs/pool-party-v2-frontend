<!--
  GENERATED FILE — DO NOT EDIT.

  Source: errors/catalog.json
  Render: make docs   (scripts/gen_error_docs.py)

  Edit the catalogue, not this file. CI fails if they disagree.
-->

# Troubleshooting

Every error hookrisk emits carries a stable code. Look it up here for the cause
and the fix; the same text is printed in your terminal, so you should rarely need
to visit this page at all.

## Exit codes

hookrisk distinguishes *"I found a problem in your hook"* from *"I could not
run"*. A CI job can branch on this without parsing output.

| Exit | Meaning |
| ---- | ------- |
| `0` | scan completed, gate passed |
| `1` | uncaught internal crash (never emitted deliberately) |
| `2` | scan completed, risk gate failed — this is a result, not an error |
| `64` | usage: unknown command, or no command at all (sysexits.h EX_USAGE) |

Error exit codes are grouped: `1x` environment, `2x` configuration,
`3x` compilation and static analysis, `4x` harness execution, `5x` network and
explorers, `6x` manifest and scoring, `7x` internal.

> **Exit code 2 is not an error.** It means the scan succeeded and your hook did
> not clear the configured gate. That is the tool doing its job.

## Quick diagnosis

Run the preflight check before anything else — it catches most environment
problems in one shot and tells you which are fatal:

```bash
./scripts/doctor.sh
```

## Errors


| Code | Exit | Summary |
| ---- | ---- | ------- |
| [`HR-E001`](#hr-e001) | `10` | Foundry is not installed or not on PATH |
| [`HR-E002`](#hr-e002) | `10` | Slither is not installed or not importable |
| [`HR-E003`](#hr-e003) | `10` | Python version is unsupported |
| [`HR-E004`](#hr-e004) | `10` | The hookrisk Slither plugin is installed but not registered |
| [`HR-E005`](#hr-e005) | `10` | hookrisk cannot find its own installation |
| [`HR-E101`](#hr-e101) | `20` | hookrisk.toml is missing a required declared dimension |
| [`HR-E102`](#hr-e102) | `20` | Target hook could not be resolved |
| [`HR-E103`](#hr-e103) | `20` | Declared fee bound is missing while the hook can alter fees |
| [`HR-E201`](#hr-e201) | `30` | Foundry library path is parent-relative and Slither cannot resolve it |
| [`HR-E202`](#hr-e202) | `30` | Foundry test path shadows the source path, so nothing is analysed |
| [`HR-E203`](#hr-e203) | `30` | Target compiles under forge but not under Slither |
| [`HR-E205`](#hr-e205) | `31` | Static analysis could not lift every function to IR |
| [`HR-E204`](#hr-e204) | `30` | Hook source not found for a deployed address |
| [`HR-E301`](#hr-e301) | `40` | Differential harness could not deploy the hook at a flag-bearing address |
| [`HR-E302`](#hr-e302) | `41` | Invariant run found a counterexample |
| [`HR-E303`](#hr-e303) | `42` | Harness timed out before completing its sequences |
| [`HR-E304`](#hr-e304) | `2` | Differential harness could not set up the twin pools |
| [`HR-E305`](#hr-e305) | `2` | Hook constructor arguments could not be derived |
| [`HR-E401`](#hr-e401) | `50` | RPC endpoint is unset or unreachable |
| [`HR-E402`](#hr-e402) | `50` | Explorer API rejected the request |
| [`HR-E403`](#hr-e403) | `51` | Codehash changed between scan and report |
| [`HR-E501`](#hr-e501) | `60` | Generated manifest does not validate against the schema |
| [`HR-E502`](#hr-e502) | `2` | Risk gate threshold not met |
| [`HR-E901`](#hr-e901) | `70` | Unexpected internal error |

### HR-E001

**Foundry is not installed or not on PATH**

Exit code `10`.

**Why this happens.** hookrisk shells out to `forge` to compile the target and to run the differential harness. Neither the static nor the dynamic layer can start without it.

**How to fix it.**

1. Install Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. Reopen your shell, or `source ~/.bashrc` / `source ~/.zshenv`, so PATH picks it up.
3. Verify with `forge --version`. hookrisk requires 1.0.0 or newer.
4. In CI, use `foundry-rs/foundry-toolchain@v1` before calling hookrisk.

<details><summary>Raw output that maps to this code</summary>

```text
forge: command not found
No such file or directory: 'forge'
```

</details>

---

### HR-E002

**Slither is not installed or not importable**

Exit code `10`.

**Why this happens.** The static layer is a Slither detector plugin. Without Slither, hookrisk can still run the harness and score declared dimensions, but every measured static dimension would be unscored — so it stops rather than emit a manifest that silently understates risk.

**How to fix it.**

1. `pipx install slither-analyzer` (recommended — keeps it off your system Python).
2. Or, inside a virtualenv: `pip install slither-analyzer`.
3. Then install the plugin: `pip install ./detectors` from the repo root.
4. Verify with `slither --list-detectors | grep hookrisk`.
5. To deliberately score without static analysis, pass `--skip-static`. The manifest records `staticAnalysis.skipped: true` and the affected dimensions are reported as unmeasured, never as zero.

<details><summary>Raw output that maps to this code</summary>

```text
slither: command not found
No module named 'slither'
```

</details>

---

### HR-E003

**Python version is unsupported**

Exit code `10`.

**Why this happens.** The detector plugin uses `match` statements and PEP 604 unions, and Slither itself requires a modern runtime.

**How to fix it.**

1. Install Python 3.10 or newer.
2. Confirm the interpreter Slither actually uses: `slither --version` then `python3 -c 'import sys; print(sys.version)'`.
3. A pipx install pins its own interpreter, which is usually the cleanest fix on macOS where the system Python is old.

<details><summary>Raw output that maps to this code</summary>

```text
requires Python >=3\.
SyntaxError.*match
```

</details>

---

### HR-E004

**The hookrisk Slither plugin is installed but not registered**

Exit code `10`.

**Why this happens.** Slither discovers plugins through the `slither_analyzer.plugin` entry point. If the package was installed into a different environment than the one running Slither, the detectors are on disk but invisible.

**How to fix it.**

1. Check they are registered: `slither --list-detectors | grep HS-`.
2. If nothing prints, install into the same environment: `python -m pip install ./detectors` using the interpreter that owns Slither.
3. With pipx, inject rather than install: `pipx inject slither-analyzer ./detectors`.
4. Editable installs (`pip install -e ./detectors`) do register entry points, but only after the environment is restarted.

<details><summary>Raw output that maps to this code</summary>

```text
No detector found matching
Unknown detector: HS-
```

</details>

---

### HR-E005

**hookrisk cannot find its own installation**

Exit code `10`.

**Why this happens.** The CLI is one part of hookrisk. The differential harness is a Foundry project under `harness/` and the manifest schema and framework rubric are JSON under `schema/`, and the CLI reads all three at runtime. It finds them by walking up from its own `dist/` directory, which only works when it is run from a checkout that `make setup` has prepared. A copied `dist/`, a global `npm install` of the package alone, or a partial checkout leaves it with nothing to run.

**How to fix it.**

1. From a hookrisk checkout, run `make setup`. It creates the virtualenv, materialises the pinned Solidity dependencies into `harness/lib/`, registers the detectors and builds the CLI.
2. If the CLI lives somewhere else on purpose, point it at the checkout: `export HOOKRISK_HOME=/path/to/hookrisk`.
3. Confirm the directory really is one: it must contain both `harness/foundry.toml` and `schema/`.
4. hookrisk is not published to npm today; see docs/ARCHITECTURE.md for what a split into a standalone package would require.

<details><summary>Raw output that maps to this code</summary>

```text
cannot find its own installation
HOOKRISK_HOME
```

</details>

---

### HR-E101

**hookrisk.toml is missing a required declared dimension**

Exit code `20`.

**Why this happens.** The Uniswap Foundation framework scores nine dimensions. Some are measurable from code; the rest — team maturity above all — are self-declared by definition. hookrisk refuses to invent them, because a fabricated declaration produces a total score that looks authoritative and is not.

**How to fix it.**

1. Run `hookrisk init` to generate a commented hookrisk.toml with every declared field and the framework's own scoring brackets inline.
2. Fill in `[declared] teamMaturity` (0-3) and `[declared] tvlPotential` (0-5) at minimum.
3. See docs/SCORING.md for which dimensions hookrisk measures and which it cannot.
4. There is deliberately no default. See FEEDBACK.md #3 for why defaulting these would undermine the framework.

<details><summary>Raw output that maps to this code</summary>

```text
missing declared dimension
hookrisk\.toml.*required
```

</details>

---

### HR-E102

**Target hook could not be resolved**

Exit code `20`.

**Why this happens.** The scan target must be either `path/to/File.sol:ContractName` for source mode, or a `0x`-prefixed 20-byte address plus `--chain` for deployed mode. Anything else is ambiguous.

**How to fix it.**

1. Source mode: `hookrisk scan src/MyHook.sol:MyHook`.
2. Deployed mode: `hookrisk scan 0xabc...123 --chain base`.
3. If the contract name is omitted and the file declares exactly one contract, hookrisk uses it; if the file declares several, name the one you mean.
4. Run `hookrisk targets src/MyHook.sol` to list the contracts hookrisk can see in a file.

<details><summary>Raw output that maps to this code</summary>

```text
could not resolve target
ambiguous contract name
```

</details>

---

### HR-E103

**Declared fee bound is missing while the hook can alter fees**

Exit code `20`.

**Why this happens.** Invariant I2 asserts that a swap through the hooked pool returns at least what the vanilla pool returns, less the fee the hook declares it charges. Without a declared bound there is no threshold to test against, and any extraction at all would look legitimate.

**How to fix it.**

1. Set `[declared] maxFeeBps` in hookrisk.toml to the largest fee your hook can ever charge, in basis points.
2. If the hook charges no fee of its own, set it to 0 explicitly — that is a much stronger assertion and hookrisk will hold you to it.
3. If the hook implements a custom curve (a returns-delta permission), I2 does not apply; hookrisk substitutes price monotonicity plus I1 and I3. See docs/INVARIANTS.md.

<details><summary>Raw output that maps to this code</summary>

```text
maxFeeBps.*not declared
no declared fee bound
```

</details>

---

### HR-E201

**Foundry library path is parent-relative and Slither cannot resolve it**

Exit code `30`.

**Why this happens.** crytic-compile, which Slither uses to drive Foundry, does not normalise `..` segments in `libs`. Compilation succeeds, then name resolution fails on an inherited interface, and the abort message names an arbitrary contract rather than the real problem. Observed with `libs = ["../harness/lib"]` compiling v4-core, which aborts with `AssertionError: Contract IExttload not found`.

**How to fix it.**

1. Replace the parent-relative entry with a symlink inside the project: `ln -s ../shared/lib lib`, then `libs = ["lib"]`.
2. Or vendor the dependencies into the project directly.
3. This is an upstream limitation, not a problem with your contracts — the same tree compiles fine under `forge build`.
4. hookrisk's own corpus uses the symlink approach; see corpus/foundry.toml.

<details><summary>Raw output that maps to this code</summary>

```text
AssertionError: Contract \w+ not found
Failed to resolved name for reference id
```

</details>

**See also.**

- <https://github.com/crytic/crytic-compile>

---

### HR-E202

**Foundry test path shadows the source path, so nothing is analysed**

Exit code `30`.

**Why this happens.** crytic-compile builds with `forge build --build-info --skip ./<test>/** --skip ./<script>/** --force`. When `test` in foundry.toml points at the same directory as `src`, every contract is skipped and `--force` clears any earlier artifacts. Slither then finds no build-info and reports either a hard failure or, worse, a clean scan of nothing.

**How to fix it.**

1. Give `test` its own directory in foundry.toml, even if it is empty.
2. Confirm the build actually produced artifacts: `ls out/build-info` should contain a JSON file after `forge build --build-info`.
3. If your project genuinely keeps tests beside sources, pass `--foundry-compile-all` so crytic-compile omits the skip flags.

---

### HR-E203

**Target compiles under forge but not under Slither**

Exit code `30`.

**Why this happens.** Slither parses solc's AST, which is stricter about some constructs than code generation is, and it does not support every solc version the moment that version ships.

**How to fix it.**

1. Confirm the baseline: `forge build --build-info --force` on its own.
2. Pin a solc version Slither supports in foundry.toml, e.g. `solc = "0.8.26"`.
3. Try `--ignore-compile` after a manual `forge build --build-info` so Slither reuses your artifacts instead of rebuilding.
4. If it still fails, `--skip-static` produces a manifest from the harness alone, with every static dimension marked unmeasured.

<details><summary>Raw output that maps to this code</summary>

```text
InvalidCompilation
solc.*not supported
Compilation failed\. Can you run build command\?
```

</details>

---

### HR-E205

**Static analysis could not lift every function to IR**

Exit code `31`.

**Why this happens.** Slither failed to build SlithIR for one or more functions and continued anyway, logging `Impossible to generate IR for <function>`. Those functions were never analysed. Reporting the scan as clean would be a false negative dressed up as a pass — observed on OpenZeppelin's own AntiSandwichHook, where three functions including `_afterSwap` fail to lift.

**How to fix it.**

1. Read the affected function manually. hookrisk lists every skipped function in the manifest under `staticAnalysis.uncoveredFunctions` and in HOOK_RISK.md.
2. Try a different solc version in foundry.toml; IR lifting failures are often version specific.
3. The dynamic layer is unaffected — the differential harness executes the real bytecode, so invariants I1-I3 still cover these paths.
4. Pass `--fail-on-partial-coverage` to make this a hard failure instead of a warning. Appropriate for a release gate on your own hook; too strict for scanning third-party code.
5. Please report the function upstream at https://github.com/crytic/slither/issues — these are upstream bugs and they are fixable.

<details><summary>Raw output that maps to this code</summary>

```text
Impossible to generate IR for
ContractSolcParsing
```

</details>

**See also.**

- <https://github.com/crytic/slither/issues>

---

### HR-E204

**Hook source not found for a deployed address**

Exit code `30`.

**Why this happens.** Deployed-mode scanning fetches verified source from the block explorer. Unverified contracts have none, so hookrisk falls back to bytecode-only analysis with reduced confidence.

**How to fix it.**

1. This is a warning by default, not a failure — the manifest records `sourceAvailable: false` and lowers the confidence of every affected finding.
2. Set `ETHERSCAN_API_KEY` for the multichain V2 endpoint; without a key you are heavily rate limited.
3. hookrisk falls back to Sourcify automatically when the explorer has nothing.
4. Pass `--require-source` to make this a hard error instead, which is the right setting for a CI gate on your own contracts.

<details><summary>Raw output that maps to this code</summary>

```text
source not verified
Contract source code not verified
```

</details>

---

### HR-E301

**Differential harness could not deploy the hook at a flag-bearing address**

Exit code `40`.

**Why this happens.** v4 reads a hook's permissions from the low 14 bits of its address. The harness uses `deployCodeTo` to place the hook at an address carrying exactly the flags it declares, which requires the compiled artifact to be on disk under the name the harness expects.

**How to fix it.**

1. Build first: `forge build` in the project containing the hook.
2. Check that `getHookPermissions()` returns the permissions the hook actually implements — a mismatch here is HS-02, and it makes the address unconstructible.
3. If the hook's constructor calls `Hooks.validateHookPermissions`, it will revert at a mismatched address; that revert is the intended behaviour and the finding is real.
4. See docs/INVARIANTS.md for how the twin pools are constructed.

<details><summary>Raw output that maps to this code</summary>

```text
deployCodeTo.*failed
HookAddressNotValid
```

</details>

---

### HR-E302

**Invariant run found a counterexample**

Exit code `41`.

**Why this happens.** This is a result, not a malfunction. One of I1 (conservation), I2 (undeclared extraction) or I3 (exit liveness) failed, and the manifest carries the shrunk call sequence that reproduces it.

**How to fix it.**

1. Read the counterexample: `hook-risk.json` → `invariants[].counterexample` holds the calldata sequence.
2. Reproduce it in isolation: `forge test --match-test <name> -vvvv` inside harness/.
3. I3 failures mean a liquidity provider could not withdraw. Treat as critical until proven otherwise.
4. I2 failures may be a missing or understated `maxFeeBps` declaration rather than a bug — check the declaration first, and if the fee is real and intended, declare it.

<details><summary>Raw output that maps to this code</summary>

```text
Invariant .* FAILED
invariant_\w+.*failed
```

</details>

---

### HR-E303

**Harness timed out before completing its sequences**

Exit code `42`.

**Why this happens.** The `scan` profile is bounded for CI. A hook with expensive callbacks, or a very deep external-call graph, can exceed the budget.

**How to fix it.**

1. Raise the budget: `--timeout 900` (seconds).
2. Reduce sequence depth for a first pass: `FOUNDRY_PROFILE=scan forge test --invariant-depth 16`.
3. Partial results are still written; the manifest marks the affected invariants `inconclusive`, which is deliberately not the same as `passed`.
4. For a pre-deployment run use `FOUNDRY_PROFILE=deep` locally rather than widening the CI budget.

<details><summary>Raw output that maps to this code</summary>

```text
timed out
TIMEOUT
```

</details>

---

### HR-E304

**Differential harness could not set up the twin pools**

Exit code `2`.

**Why this happens.** The hook was deployed, but building the pools around it failed: pool initialisation or the initial PoolManager liquidity reverted inside a hook callback, or forge exited before running a single sequence. Nothing about the hook's behaviour was observed. hookrisk reports this as a harness failure with every invariant `inconclusive` — deliberately not `passed`, and deliberately not absent, because a dynamic layer that did not run must not look like one that ran and found nothing. This is an engine result recorded in the manifest (engines[].errorCode), not a CLI abort: the process exit code is decided by the gate, which fails on it by default (failOnNotAnalysed) and exits 2.

**How to fix it.**

1. Read the unwrapped revert in the reason: it names the callback (e.g. `beforeAddLiquidity (0x259982e5)`) and the hook's own error, decoded from v4's ERC-7751 `WrappedError` wrapper.
2. A hook that rejects PoolManager liquidity by design (a custom-curve hook holding its own reserves) is handled: the harness records `seeded = "hooked-failed"` and hookrisk marks I2/I3 not-applicable rather than failing. If you see this error instead, the harness in use predates that record — rebuild from the same checkout as the CLI.
3. A hook that reverts on a static LP fee is retried with `LPFeeLibrary.DYNAMIC_FEE_FLAG`; a revert on both means the hook's `beforeInitialize` needs state the harness does not provide.
4. Reproduce in isolation: `HOOKRISK_ARTIFACT=... forge test --match-contract GenericHookInvariants -vvvv` inside harness/, with the same environment the CLI logs under `--verbose`.

<details><summary>Raw output that maps to this code</summary>

```text
harness setUp failed
setUp\(\).*Failure
```

</details>

**See also.**

- <docs/INVARIANTS.md>

---

### HR-E305

**Hook constructor arguments could not be derived**

Exit code `2`.

**Why this happens.** The harness deploys the hook itself, so it has to supply whatever the constructor takes. It can derive two shapes on its own — no arguments, or a single `IPoolManager`/`address` — and needs to be told about anything else. This is reported as a skip with the ABI types in the message rather than guessed, because a constructor fed zero addresses produces a hook that reverts somewhere inside `setUp` for a reason nobody can read. This is an engine result recorded in the manifest (engines[].errorCode), not a CLI abort: the process exit code is decided by the gate, which fails on it by default (failOnNotAnalysed) and exits 2.

**How to fix it.**

1. Add `[harness] constructorArgs` to hookrisk.toml: an array of strings, one per constructor argument in ABI order.
2. Use the placeholders for anything the harness deploys itself: `$poolManager`, `$currency0`, `$currency1`, `$owner` (the test contract) and `$hook` (the hook's own flag-bearing address). Each is substituted word-for-word before deployment.
3. Write every other value the way `cast abi-encode` accepts it — decimal integers, 0x-prefixed addresses and bytes, `true`/`false`. The values are passed to cast verbatim; a cast parse error is repeated in the skip reason.
4. Struct (tuple) constructor arguments are not supported yet; the skip reason says so when that is the case.

<details><summary>Raw output that maps to this code</summary>

```text
constructorArgs
constructor takes .* argument
```

</details>

**See also.**

- <docs/INVARIANTS.md>

---

### HR-E401

**RPC endpoint is unset or unreachable**

Exit code `50`.

**Why this happens.** Deployed-mode and fork-mode scanning need an archive-capable RPC for the target chain.

**How to fix it.**

1. Set the endpoint: `export BASE_RPC_URL=https://...` (or `UNICHAIN_RPC_URL`, `MAINNET_RPC_URL`).
2. Public endpoints frequently refuse wide `eth_getLogs` ranges; the crawler chunks automatically, but a dedicated endpoint is far faster.
3. Verify independently: `cast block-number --rpc-url $BASE_RPC_URL`.
4. Source-mode scanning needs no RPC at all — omit `--chain` to stay offline.

<details><summary>Raw output that maps to this code</summary>

```text
missing RPC
could not connect
ECONNREFUSED
```

</details>

---

### HR-E402

**Explorer API rejected the request**

Exit code `50`.

**Why this happens.** Source fetching uses the Etherscan V2 multichain API, which takes one key across chains via the `chainid` parameter. A missing key still works but at a rate limit low enough to fail on any real crawl.

**How to fix it.**

1. Set `ETHERSCAN_API_KEY`. One key covers every supported chain on V2.
2. On HTTP 429, hookrisk retries with exponential backoff; a persistent 429 means the key is exhausted.
3. Sourcify is tried automatically when the explorer returns nothing, and needs no key.
4. Use `--cache-dir` to reuse fetched sources across runs instead of re-fetching.

<details><summary>Raw output that maps to this code</summary>

```text
Max rate limit reached
Invalid API Key
NOTOK
```

</details>

---

### HR-E403

**Codehash changed between scan and report**

Exit code `51`.

**Why this happens.** A manifest is bound to one `(chainId, address, codehash)` triple. If the code at the address changed mid-scan the manifest would describe contracts that no longer exist — which is precisely the upgrade scenario the binding exists to catch.

**How to fix it.**

1. Re-run the scan against the new code.
2. If the hook is upgradeable, this is expected on every upgrade and is exactly why HS-04 raises the tier: a manifest cannot outlive the code it describes.
3. Publish an upgrade policy and re-scan as part of it — the framework's Upgradeable trigger requires this anyway.
4. For reproducible reporting, pin a block: `--block <number>`.

<details><summary>Raw output that maps to this code</summary>

```text
codehash mismatch
code changed during scan
```

</details>

---

### HR-E501

**Generated manifest does not validate against the schema**

Exit code `60`.

**Why this happens.** An internal inconsistency: hookrisk produced a manifest its own schema rejects. Downstream consumers rely on the schema, so emitting it anyway would push the failure onto them.

**How to fix it.**

1. This is a bug in hookrisk. Please open an issue with the full output.
2. Attach the rejected manifest: it is written to `hook-risk.invalid.json` for exactly this purpose.
3. As a workaround, `--no-validate` emits it regardless. Do not feed the result to a gate.

<details><summary>Raw output that maps to this code</summary>

```text
schema validation failed
does not match schema
```

</details>

---

### HR-E502

**Risk gate threshold not met**

Exit code `2`.

**Why this happens.** Not an error. The scan completed and the resulting tier or findings exceeded the configured gate, so the CI step fails on purpose.

**How to fix it.**

1. Read HOOK_RISK.md for the tier and the findings that drove it.
2. Fix the findings, or raise the threshold deliberately in hookrisk.toml `[gate] maxTier`.
3. To report without gating, pass `--no-gate`; the manifest is still produced.
4. A rising tier after a code change is the tool working. Re-scoring downward without changing the code is the failure mode the framework warns about.

<details><summary>Raw output that maps to this code</summary>

```text
gate failed
tier exceeds
```

</details>

---

### HR-E901

**Unexpected internal error**

Exit code `70`.

**Why this happens.** hookrisk hit a state it does not have a specific diagnosis for.

**How to fix it.**

1. Re-run with `--verbose` to get the full stack trace and the exact tool invocations.
2. Please open an issue with that output; an unmapped failure is a gap in this catalogue and we treat it as a bug.
3. `--debug-dir <path>` dumps every intermediate artifact (build-info, Slither JSON, forge output) for attaching to the report.

---

## Nothing here matches

An unmapped failure is a bug in this catalogue, not just in your setup. Re-run with `--verbose --debug-dir ./hookrisk-debug` and open an issue with the contents — a new entry here is usually the fix.
