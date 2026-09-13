# Prior art

Written before the code, and revised after reading the competition properly.

The first version of this project was going to be called `hookscan`. Checking
GitHub for name collisions turned up
[`blocksecteam/hookscan`](https://github.com/blocksecteam/hookscan) — an
established analyzer for Uniswap v4 hooks from a security firm, covering two of
the four detectors we had planned. That is a good outcome from a search that
takes five minutes and one many projects skip.

This page exists so a reader can tell what is genuinely new here from what is
not. Where we overlap, we say so. Where someone else does it better, we run their
tool.

---

## BlockSec HookScan

[github.com/blocksecteam/hookscan](https://github.com/blocksecteam/hookscan) ·
AGPL-3.0

A static analyzer for v4 hooks working at the Yul/CFG level, derived from
BlockSec's Phalcon Inspector and backed by published research
([Thorns in the Rose](https://phalcon.xyz/blog/thorns-in-the-rose-exploring-security-risks-in-uniswap-v4-s-novel-hook-mechanism),
*Lethal Integration*).

| Their detector | Our position |
|---|---|
| `UniswapPublicHook` | **Same class as HS-01.** Reconciled, not duplicated. |
| `UniswapUpgradableHook` | **Same class as HS-04**, which we have not implemented. |
| `UniswapPublicCallback` | **We have nothing for this.** Pure coverage gain. |
| `UniswapSuicidalHook` | **We have nothing for this.** Pure coverage gain. |

### hookrisk runs it rather than competing with it

Reimplementing bytecode-level analysis would be more code, less accurate, and a
misrepresentation of whose work it is. So hookrisk invokes HookScan as an
isolated container and attributes it — in the terminal, in the manifest, in
`HOOK_RISK.md`, and in the SARIF.

The integration is not decoration. It changes what hookrisk can score:

```
upgradeability  —  unmeasured
   Not measured: no detector for upgradeable-hook (needs blocksec, which did not run)
```

Enable it and `upgradeability` becomes measurable. That is the multi-engine
design earning its place rather than being asserted in a README.

Findings both engines agree on merge into **one** finding at raised confidence.
Their analysis works on the Yul CFG and ours on solc's AST, so agreement is close
to independent confirmation — the strongest false-positive filter available
without a human.

Exercised end to end, with output, in
[docs/hackathon/evidence/blocksec-corroboration.md](hackathon/evidence/blocksec-corroboration.md):
both engines independently flag the same two unguarded callbacks in
`corpus/src/bad/UnvalidatedCallback.sol`, at the same two lines.

### What it takes to run the published image

Three things stand between `docker pull` and a result. hookrisk handles all
three; they are written down here because each one is a property of the upstream
image rather than of this adapter, and each will outlive our workaround.

**It is `linux/amd64` only.** A bare `docker pull` on Apple Silicon fails with
`no matching manifest for linux/arm64/v8`. hookrisk passes
`--platform linux/amd64` on every invocation — a no-op on an amd64 host,
emulation elsewhere — and puts the same flag in the pull command it suggests
when the image is missing. `HOOKRISK_BLOCKSEC_PLATFORM` overrides it; empty omits
the flag for a runtime that does not understand it.

**Its entrypoint cannot start under Docker Desktop.** `/entrypoint.sh` derives a
uid/gid from the mounted `/project` and runs `groupadd`/`useradd` with them. The
mount is owned by uid 0, so `groupadd -g 0` fails, and the trailing `su scanner`
never reaches the analyser. hookrisk bypasses it with `--entrypoint python` and
assembles the same argument vector the entrypoint would have. Nothing is lost:
the user-creation step existed to keep output files owned by the host user, and
HookScan writes none.

**It ships solc 0.8.14 – 0.8.24, and v4-core pins 0.8.26.** As published, every
current hook fails to compile inside it. When the project's version is absent
hookrisk downloads that exact linux-amd64 static build from
`binaries.soliditylang.org` (the filename comes from the official `list.json`;
the `+commit.…` suffix is not derivable), caches it under
`~/.cache/hookrisk/solc/<version>/` — `HOOKRISK_CACHE_DIR` moves the root — and
mounts it read-only at `/solc/v<version>/solc`. The download happens on the
host: the analysis container still runs `--network none`.

One project shape genuinely does not work: a `lib/` symlinked outside the
project root, as `corpus/lib` is. Only the project root is mounted, and solc then
rejects every import as outside its allowed directories. Rebinding the realpath
does not help — the runtime resolves a bind-mount destination *through* the
symlink — and HookScan builds its own solc command line, so `--allow-paths`
is not ours to widen. hookrisk detects this on the host and fails the engine
loudly, because a container that compiles nothing returns an empty result set
that is indistinguishable from a clean hook.

### Licensing

HookScan is AGPL-3.0. hookrisk invokes it as a separate process, never links it,
and **no HookScan code is redistributed here**. The user obtains the image
themselves and the engine is opt-in, because pulling a third-party container
should be an explicit choice rather than something a scan does quietly. See
[NOTICE](../NOTICE).

---

## Hacken: the audit guide and uni-v4-hooks-checker

[hacken.io/discover/auditing-uniswap-v4-hooks](https://hacken.io/discover/auditing-uniswap-v4-hooks/) ·
[github.com/hknio/uni-v4-hooks-checker](https://github.com/hknio/uni-v4-hooks-checker) (MIT)

The checker is listed in the Foundation's own framework, §11 Security Resources.
The article is the better half: a seven-step audit method with twenty-one named
issue classes, several of which are not in any tool's rule set — delta sign
conventions (`BeforeSwapDelta` is written from the hook's perspective, so a fee
is negative), unsettled deltas producing `CurrencyNotSettled`, a hook changing
the swap type and hitting `HookDeltaExceedsSwapAmount`, an `lpFeeOverride` the
PoolManager rejects, and NoOp hooks taking full custody of a swap.

The checker itself is a Foundry suite you point at a **deployed** hook (or one
you deploy in a test) and extend: address-flag/permission agreement, an EOA-guard
sweep over the entrypoints, a foreign-`PoolKey` rejection test, an open-mutator
scan over eight hard-coded selectors, a "returns its own selector when called by
the manager" check, swap/liquidity/donate suites, bytecode-size complexity
buckets, and per-check strictness flags.

Three of its ideas are in hookrisk as of this pass, re-implemented from the
described behaviour rather than ported — their tests are entangled with their own
`TestResultCollector`/`Caps`/`StrictConfig` types, and two of those files carry
an in-file `SPDX-License-Identifier: UNLICENSED` that contradicts the repository's
MIT `LICENSE`, which is a provenance question hookrisk should not import:

| Their check | hookrisk's version |
|---|---|
| EOA guard on entrypoints | The harness's `eoaGuard` probe. Where HS-01 already reports the callback, the probe merges into it as a second attribution and raises confidence to high — a static reading and an executed counterexample for the same defect |
| Untrusted `PoolKey` rejection | The harness's exclusivity probe: a second pool with the same hook, driven as the PoolManager. Reported as the INFO classification `unvalidated-pool-key`, scoring nothing — multi-pool hooks are legitimate, and their own default is non-strict |
| Returns its own selector | The harness's selector probe, one pranked call per implemented callback. HIGH `callback-selector-mismatch`, because a callback that returns the wrong selector bricks the operation it guards |

Their open-mutator scan is the idea behind HS-03, but done differently: they
test eight hard-coded selectors, hookrisk resolves the contract's own external
functions through SlithIR and asks which of them write hook state without an
access check.

Where the two tools genuinely differ:

|  | Hacken checker | hookrisk |
|---|---|---|
| Shape | A test suite you extend | A scan you run |
| Input | A deployed address plus a test contract you write | `src/MyHook.sol:MyHook` |
| Counterfactual | None — it can see that a swap succeeded, never that it returned the *right* amount | The twin pool: I2 bounds extraction by the declared fee, which is how a hook that documents 1% and charges 3.5% is caught |
| Output | Pass/fail | Scored manifest, SARIF, line numbers, gate exit code |
| Vacuous passes | Not detected — their `_hasFunction` returns true for any address with code, so the introspection suite warns about "10 external mutators" on every hook | `coverage.observations` marks a zero-observation pass inconclusive |

---

## chaosxcode/hookguard

[github.com/chaosxcode/hookguard](https://github.com/chaosxcode/hookguard) (MIT)

Python, zero dependencies, three layers: a source scanner, a runtime-bytecode
pass, and an ecosystem census. Its source scanner is regex over comment-stripped
text with a hand-rolled brace matcher — no solc, no AST, no compile step — with a
JS port that runs the same rules in the browser. The other two layers are the
interesting half.

**What hookrisk took (the ideas, not the code):**

- **`UNBOUNDED_DYNAMIC_FEE` → HS-06.** Their rule is two regexes (the file
  mentions `updateDynamicLPFee` and matches none of `MAX_FEE|maxFee|require(…fee <`),
  and it fires on 11% of the hooks in their corpus. The class is real; hookrisk
  does it structurally, tracing the provenance of the fee value to a bound or a
  constant, and scores it 2 rather than 3 because a detector cannot prove the
  absence of a ceiling.
- **`REVERT_DOS_RISK` → the framing for HS-05.** hookrisk already had the
  machinery (`external_calls_in`, `swap_path_functions`, an `ExternalCall` with
  destination, line and `is_static`) and was not using it. Their contribution is
  the reading: an unhandled external call in a *required* callback is a liveness
  risk, not only a dependency.
- **The bytecode layer, as a design for deployed mode.** An EIP-1967 slot read,
  the EIP-1167 pattern, and classifying a `DELEGATECALL` target as constant or
  storage-derived give an upgradeability signal with no Docker and no API key —
  which is exactly the BlockSec dependency hookrisk wants out of CI. Recorded in
  `docs/hackathon/RESUME.md` under *Deployed mode design*.
- **The reversed permission bits.** Their dual-decoding of the Unichain preview
  PoolManager is a measurement, not code: the ten callback flags decode in the
  opposite order there, and the returns-delta positions match neither layout. A
  per-chain bit-layout table is now a precondition for deployed mode.

**What hookrisk does not take.** `UPGRADEABLE_HOOK` is one regex over the whole
file — `delegatecall` anywhere makes a hook HIGH. `MISSING_POOLMANAGER_GUARD`, the
class HS-01 covers, is skipped entirely when the `is` clause matches `BaseHook`,
which silences it on exactly the vendored-or-fake-base case HS-01 exists for, and
accepts a modifier *named* "poolManager" as proof of a guard; it reports zero
findings across their own 291-hook corpus. And their 0–100 score is additive and
prices *absence* (`no_audit_recorded` +10, `unregistered` +8) while its own
documentation says it makes no deductions for absent evidence — the contradiction
hookrisk's unmeasured-is-not-zero exists to avoid.

**The one thing they have done that hookrisk has not: measured the ecosystem.**
A full-history `Initialize` census per chain, per-rule firing rates over a
306-contract corpus with eight documented false-positive classes, and the finding
that **only about 17% of the busiest off-registry hooks publish source at all**.
That number is the ceiling on hookrisk's entire method: source-level analysis,
however good, reaches at most that fraction of deployed hooks without a
bytecode layer. It is the strongest argument for the bytecode work above, and
for `hooklist` plus Sourcify as the seed of deployed mode rather than a crawl.

Their permissionless-attachment rule (`PERMISSIONLESS_ATTACHMENT`) is the class
hookrisk now covers dynamically as `unvalidated-pool-key`, from the other
direction: they infer from five enumerated regex spellings of "the hook checks
the key", the harness calls the hook with a foreign key and reports what
happened.

---

## hunterinvariants/v4-hook-invariants

[github.com/hunterinvariants/v4-hook-invariants](https://github.com/hunterinvariants/v4-hook-invariants)

Invariant and fuzzing tests for v4 hooks — five hook-security properties, each
proven two ways against real v4-core.

The closest prior art to our layer 2, and the same instinct: real v4 contracts,
no mocks, properties rather than examples. What we add is the differential
construction — a twin pool as a counterfactual oracle — and the tie into scoring.

---

## OpenZeppelin uniswap-hooks

[github.com/OpenZeppelin/uniswap-hooks](https://github.com/OpenZeppelin/uniswap-hooks)

Not a competitor: the canonical `BaseHook`, and a dependency.

Two things worth stating:

**It is where `BaseHook` lives now.** `@uniswap/v4-periphery@1.0.4` no longer
exports one. A great deal of tutorial material still says it does, and the
natural recovery — writing the access check by hand — is exactly where HS-01
findings come from. Reported as [FEEDBACK.md #8](../FEEDBACK.md).

**Its production hooks are our false-positive gate.** `AntiSandwichHook` and
`LiquidityPenaltyHook` compile into [`corpus/src/good/`](../corpus/src/good), so
every detector runs against externally reviewed code on every CI build. Testing
false positives only against toy fixtures proves very little.

That gate also surfaced [FEEDBACK.md #9c](../FEEDBACK.md): Slither cannot lift
three of their functions to IR, including `AntiSandwichHook._afterSwap`, and
reports a normal result count anyway.

---

## Cyfrin, Trail of Bits, and the incident write-ups

Not tools, but the sources several detectors and invariants are specified from.

- **Dedaub on Cork Protocol** — the class HS-01 covers.
- **Halborn on Bunni** — a v4 hook with custom-curve accounting flaws, and the
  reason I3 exists. Bunni had been through top-tier audits; the framework itself
  cites it in §1.10.
- **Cyfrin's dynamic-fee analysis** — the specification for HS-06.

Corpus fixtures link the public write-up they derive from, and say plainly that
they are minimal reproductions of a *class* rather than faithful reimplementations
of any particular incident. Overclaiming there would be easy and would not
survive review.

---

## What is actually new here

Honestly, in one list.

1. **The framework, executable.** Nine dimensions, three tiers, seven triggers,
   recommendation precedence, all as code with the framework's own worked
   examples as conformance tests. Nobody had built this.
2. **HS-02.** Declared permissions versus implemented callbacks. `v4-core`
   validates the address against `getHookPermissions()`; nothing validates either
   against what the contract actually implements.
3. **The differential construction.** A twin pool as a counterfactual oracle,
   with the custom-curve branch that replaces I2 with monotonicity when output
   comparison stops being meaningful.
4. **Cross-engine reconciliation.** A canonical taxonomy, so one defect found by
   two tools is one finding, and agreement across analysis foundations raises
   confidence.
5. **Coverage as a first-class output.** Unmeasured dimensions, skipped engines
   and unanalysed functions are recorded rather than silently absent. It is the
   difference between "we found nothing" and "we looked".
6. **The codehash-bound manifest.** A schema-validated artifact that ties an
   assessment to one exact deployment.

What is **not** new: static detection of unprotected callbacks, of upgradeability,
or of `SELFDESTRUCT`. BlockSec got there first and does it from bytecode. We run
their tool.
