# hookrisk

> **Provenance.** hookrisk was developed during the hackathon in a private repository
> (`0xmvercosa/hookrisk`, branch `feat/hackathon-p0`) and was copied into this public
> repository at commit `d256e91ae3574f7ea5c90c26389b3f8a531252b4` (2026-09-13) so the work can
> be presented alongside the Pool Party front-end. It is a standalone toolchain (Python + Foundry +
> its own Node CLI) with **no link to the Next.js app**: nothing under `src/` imports it, and the
> app's lint, typecheck, test and Docker build all exclude this folder. Licensing is unchanged and
> per directory: MIT, except `detectors/` which is AGPL-3.0-only (see `NOTICE`). The hackathon
> narrative for the whole submission is in the repository root `README.md` and `docs/_hackathon_hookrisk/`.

**The Uniswap Hooks Security Framework, made executable.**

The [Uniswap Foundation's Hooks Security Framework](https://github.com/uniswapfoundation/security-framework)
asks hook developers to score themselves across nine dimensions, check seven
feature triggers, and derive a security plan. It is a good framework. It is also
a document and a spreadsheet, so the score cannot be diffed, cannot be required
in CI, and gets recomputed by hand — or not at all — after every change.

hookrisk turns it into a command:

```bash
npx hookrisk scan src/MyHook.sol:MyHook
```

```
MEDIUM risk  12/33

  findings    1 high, 2 medium
  ✓ hookrisk   ok
  ✓ blocksec   ok
              1 corroborated across engines

  HOOK_RISK.md
  hook-risk.json
  hookrisk.sarif

  gate failed
    - invariant I2 (No undeclared extraction) failed
```

It measures what can be measured from code and execution, requires you to declare
what cannot, and emits a manifest bound to one exact `(chainId, address, codehash)`.

---

## What makes this different from a linter

Three things, in order of how much they matter.

### 1. It executes your hook, it does not only read it

Consider a hook that documents a 1% fee and charges 3.5%.

There is no missing access check. No proxy. No external call. No reentrancy.
Every static analyzer ever written reads that contract and has nothing to say,
because the defect is *a constant*. The only way to see it is to run the same
trade through two pools that differ in nothing but the hook, and compare.

That hook is in this repository as
[`SkimmingFeeHook`](harness/src/hooks/FeeHooks.sol), and
[`test_I2_detectsUndeclaredSkim`](harness/test/HarnessValidation.t.sol#L73)
asserts the harness catches it — not just the direction, but the magnitude,
within 50 basis points of the fee actually charged.

### 2. It never scores a dimension zero because nobody looked

If no engine capable of detecting a proxy ran, `upgradeability` is **unmeasured**,
not 0. Scoring it 0 would take three points off the total, possibly a whole tier,
based on a number the tool made up — and made up in the direction that makes the
hook look safer. Across nine dimensions those biases compound one way.

So the tier comes back as a range when data is missing, and the gate treats an
undetermined tier as a failure:

```
MEDIUM risk  10/33  (undetermined: up to 22/33)
  ! 4 dimension(s) unmeasured: the tier is between Medium Risk and High Risk.
```

The rule is in [`derive.ts`](cli/src/scoring/derive.ts#L137): *a dimension can be
scored 0 only if a detector capable of finding a non-zero value actually ran.*

### 3. It runs other people's tools rather than re-implementing them

[BlockSec's HookScan](https://github.com/blocksecteam/hookscan) is a Yul/CFG-level
analyzer for v4 hooks, and it is good. Two of its four detectors overlap ours;
two cover classes we have nothing for. Rewriting that would mean more code, less
accuracy, and misrepresenting whose work it is.

So hookrisk runs it as an isolated container and attributes it. Findings both
engines agree on merge into **one** finding at raised confidence — because our
detectors work on solc's AST and theirs on the Yul CFG, and agreement across
different foundations is close to independent confirmation. See
[`dedupe.ts`](cli/src/engines/dedupe.ts#L118).

The integration shows up in the output. When BlockSec is off, hookrisk says so
and says what it costs you:

```
upgradeability  —  unmeasured
   Not measured: no detector for upgradeable-hook (needs blocksec, which did not run)
```

---

## Where to look — verification map

Everything below is checkable in a fresh clone with `make setup && make test`.

### The Uniswap v4 integration

| What | Where |
|---|---|
| Permission flags and callback selectors, **generated** from `v4-core`, never transcribed | [`scripts/gen_hooks_spec.py`](scripts/gen_hooks_spec.py) → [`hooks_spec.py`](detectors/slither_hookrisk/utils/hooks_spec.py) |
| The generated values cross-checked by **solc itself**, a completely different oracle | [`harness/test/HooksSpec.t.sol`](harness/test/HooksSpec.t.sol) — 13 tests |
| Twin pools built from v4-core's own `Deployers`, `PoolSwapTest`, `PoolModifyLiquidityTest`. **No mocks of Uniswap components** | [`TwinPools.sol#L79`](harness/test/TwinPools.sol#L79) |
| Hook deployed at a flag-bearing address without salt grinding | [`TwinPools.sol#L53`](harness/test/TwinPools.sol#L53) |
| v4's ERC-7751 `WrappedError` unwrapped so a failure names *your* revert, not v4's wrapper | [`TwinHandler.sol#L435`](harness/test/TwinHandler.sol#L435) |

### Static detectors

| Rule | What it finds | Where |
|---|---|---|
| **HS-01** | An `IHooks` callback anyone can call | [`hs01_unprotected_callback.py#L46`](detectors/slither_hookrisk/detectors/hs01_unprotected_callback.py#L46) |
| **HS-02** | Declared permissions disagreeing with implemented callbacks — *nobody else checks this* | [`hs02_flag_divergence.py#L65`](detectors/slither_hookrisk/detectors/hs02_flag_divergence.py#L65) |
| **HS-07** | Custom accounting in use (a classification, not a defect) | [`hs02_flag_divergence.py#L226`](detectors/slither_hookrisk/detectors/hs02_flag_divergence.py#L226) |

The guard check that HS-01 rests on is
[`guards_pool_manager`](detectors/slither_hookrisk/utils/hook_analysis.py#L309).
It traces an actual comparison between `msg.sender` and the variable holding the
pool manager — never a modifier name. Name matching breaks when the base class
moves (it already has: `BaseHook` left v4-periphery for OpenZeppelin's
`uniswap-hooks`) and is trivially defeated by a hook declaring
`modifier onlyPoolManager { _; }`, which is exactly the shape a malicious hook
would take.

### The three invariants

| | Property | Assertion | Proof it detects |
|---|---|---|---|
| **I1** | No token is created or destroyed | [`Invariants.t.sol#L103`](harness/test/Invariants.t.sol#L103) | — |
| **I2** | Output never falls short of an unhooked pool by more than the declared fee | [`Invariants.t.sol#L131`](harness/test/Invariants.t.sol#L131) | [`test_I2_detectsUndeclaredSkim`](harness/test/HarnessValidation.t.sol#L73) |
| **I2b** | *(custom curves)* selling a token must not raise its price | [`Generic.t.sol#L137`](harness/test/Generic.t.sol#L137) | — |
| **I3** | Every position opened can be closed | [`Invariants.t.sol#L159`](harness/test/Invariants.t.sol#L159) | [`test_I3_detectsTrappedLiquidity`](harness/test/HarnessValidation.t.sol#L124) |

The invariant we care most about is **I3**, and
[`test_I3_trapIsInvisibleToConservation`](harness/test/HarnessValidation.t.sol#L152)
says why: it drives a hook that traps liquidity and asserts that **conservation
still holds perfectly** the whole time. Solvency and liveness are different
properties. A pool can be solvent to the wei and still let nobody out, and only
one of those two properties is usually tested.

### Scoring

| What | Where |
|---|---|
| The framework as data — 9 dimensions, 3 tiers, 7 triggers — with every interpretation flagged `interpretation: true` | [`schema/framework-rubric.json`](schema/framework-rubric.json) |
| The engine | [`score.ts#L110`](cli/src/scoring/score.ts#L110) |
| **The framework's own four worked examples, as tests** | [`score.test.ts`](cli/src/scoring/score.test.ts) |
| Recommendation precedence (`optional < recommended < strongly recommended < required`), merged by maximum | [`score.ts#L260`](cli/src/scoring/score.ts#L260) |
| A violated invariant fails the gate unconditionally | [`manifest.ts#L184`](cli/src/manifest.ts#L184) |

Three of the framework's four worked examples pass. **The fourth does not hold
under the framework's own rules**, and
[the test pins the discrepancy](cli/src/scoring/score.test.ts#L114) rather than
hiding it. Details in [FEEDBACK.md #11](FEEDBACK.md).

---

## Quick start

```bash
git clone https://github.com/0xmvercosa/hookrisk && cd hookrisk
make setup        # venv, pinned v4 deps, Slither plugin, CLI
make demo         # scan a clean hook, then one with a planted bug
```

In your own hook repository:

```bash
# hookrisk runs from a checkout; `make setup` is the install step.
alias hookrisk="node /path/to/hookrisk/cli/dist/cli.js"

hookrisk init                                  # writes hookrisk.toml
forge build                                    # hookrisk reads your artifacts
hookrisk scan src/MyHook.sol:MyHook
```

`hookrisk.toml` is where you declare what a tool cannot observe — team maturity,
TVL potential, the maximum fee your hook can charge. There are **no defaults**.
A fabricated team-maturity score produces a total that looks authoritative and
is not, and the framework's central worry is that self-scoring is easy to game.

### In CI

```yaml
- uses: 0xmvercosa/hookrisk@v1
  with:
    target: src/MyHook.sol:MyHook
    enable-blocksec: true
```

Findings land on the diff via SARIF, the report becomes a PR comment, and the
gate fails the job. Exit codes are meaningful: `0` passed, `2` gate failed (a
result, not an error), `10+` hookrisk could not run, `64` bad command line — each code documented in
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

hookrisk runs its own action against its own fixtures on every push
([dogfood.yml](.github/workflows/dogfood.yml)), asserting a clean hook passes,
a planted-bug hook fails, **and** a hook the harness cannot stand up comes back
inconclusive rather than clean. An action that passes everything is
indistinguishable from one that does nothing.

---

## Prior art

Credited because it exists, not because it was found and reframed.

- **[BlockSec HookScan](https://github.com/blocksecteam/hookscan)** (AGPL-3.0) —
  bytecode-level analyzer for v4 hooks, from published research. Overlaps HS-01
  and HS-04; covers unprotected `unlockCallback` and `SELFDESTRUCT`, which we do
  not. **hookrisk runs it as an optional engine rather than competing with it.**
- **[Hacken uni-v4-hooks-checker](https://github.com/hknio/uni-v4-hooks-checker)** —
  a Foundry test framework for hooks, listed in the Foundation's own resources
  section. Complementary: a suite you extend, where hookrisk is a scan you run.
- **[hunterinvariants/v4-hook-invariants](https://github.com/hunterinvariants/v4-hook-invariants)** —
  invariant tests for hook-security properties.
- **[OpenZeppelin uniswap-hooks](https://github.com/OpenZeppelin/uniswap-hooks)** —
  the canonical `BaseHook`. Its production hooks are compiled into our negative
  corpus, so every detector is run against externally reviewed code on every CI
  build.

What is new here is not another scanner. It is the scoring layer, the manifest,
and the reconciliation between engines.

---

## Feedback to the Uniswap Foundation

Porting a rubric into code is an unusually good way to find holes in it. Prose
tolerates ambiguity; a scoring function does not.

**[FEEDBACK.md](FEEDBACK.md)** documents 11 findings, each with file and line and
a proposed fix. The three that matter most:

1. **A factual error in Uniswap's own AI tooling.** `uniswap-ai`'s
   `v4-security-foundations` skill states that `BEFORE_SWAP_RETURNS_DELTA` is
   bit 10. It is bit 3 (`Hooks.sol:44`); bit 10 is `AFTER_ADD_LIQUIDITY_FLAG`. A
   developer grinding a salt from that sentence enables the wrong permission, and
   nothing fails at deploy time.
2. **Seven of nine scoring dimensions have no brackets.** Only TVL potential and
   team maturity define what each value means. Nothing distinguishes Complexity 3
   from Complexity 4 — and the tier boundary decides whether you owe one audit or
   two plus a math specialist.
3. **Slither reports a clean scan of code it never analysed.** On OpenZeppelin's
   `AntiSandwichHook`, three functions including `_afterSwap` fail to lift to IR;
   Slither logs it to stderr and carries on with a normal result count. hookrisk
   counts them and reports reduced coverage (`HR-E205`) rather than passing the
   silence off as safety.

---

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the layers fit together |
| [DETECTORS.md](docs/DETECTORS.md) | Each rule, what it finds, and what it misses |
| [INVARIANTS.md](docs/INVARIANTS.md) | The differential method and its honest limits |
| [SCORING.md](docs/SCORING.md) | The rubric port, and every place we interpreted |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Every error code, cause and fix |
| [PRIOR_ART.md](docs/PRIOR_ART.md) | What exists, and what is actually new here |

---

## Known limits

Stated here rather than discovered later.

- **HS-03 through HS-06 and HS-08 are not implemented.** Their dimensions come
  back unmeasured, which is why a first scan usually reports a tier *range*.
  That is the design working, not a placeholder.
- **Hooks with extra constructor arguments need `[harness] constructorArgs`**
  in `hookrisk.toml` (placeholders `$poolManager`, `$currency0`, `$currency1`,
  `$owner`, `$hook` are substituted at deploy time). Without it the harness is
  reported as skipped, with the argument types it needs. Factory-parameter
  constructors (`Factory(msg.sender).parameters()`) are not supported yet.
- **I2 allows 200 basis points of drift** between the twin pools. Below that,
  extraction is indistinguishable from tick rounding. Documented in
  [INVARIANTS.md](docs/INVARIANTS.md).
- **Fork mode and the ecosystem crawler are not built yet.**
- **BlockSec HookScan needs three things the published image does not give
  you.** It is `linux/amd64` only (hookrisk always passes `--platform`), its
  entrypoint cannot start under Docker Desktop (hookrisk bypasses it), and it
  ships solc 0.8.14–0.8.24 while v4-core pins 0.8.26 (hookrisk downloads the
  exact static solc into `~/.cache/hookrisk/solc` and mounts it). With those
  in place it runs end to end and corroborates HS-01; see
  [docs/hackathon/evidence/blocksec-corroboration.md](docs/hackathon/evidence/blocksec-corroboration.md).

---

## Licence

MIT, **except `detectors/`**, which is AGPL-3.0-only because it links Slither.
The CLI, harness, schema and action never link either AGPL component; BlockSec's
HookScan runs as a separate process and no part of it is redistributed here. See
[NOTICE](NOTICE).

> The Uniswap Foundation does not review, endorse or certify this tool, nor any
> score derived from its framework.
