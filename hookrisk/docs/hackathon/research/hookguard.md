# chaosxcode/hookguard vs hookrisk

_Research note written by a read-only agent on 2026-09-12 to decide what hookrisk should adopt. Nothing here has been implemented unless RESUME.md says so._

## 1. What HookGuard is

**Language / approach.** Python 3.10+, zero dependencies. The source scanner (`src/scan.py`, ~600 lines) is **regex over comment-stripped text** with a hand-rolled brace matcher — no solc, no AST, no IR, no compile step. A JS port (`docs/assets/hg-scanner.js`) runs the same rules in-browser, parity-tested against the Python. Two further layers are *not* source analysis and are the more interesting half: a keyless **runtime-bytecode pass** (`src/bytecode.py` — own Keccak implementation, PUSH-aware disassembler, `eth_getStorageAt` on the EIP-1967 slot, EIP-1167 pattern, DELEGATECALL target classification) and an **ecosystem census** (`src/discover.py` enumerates every `Initialize` event in a chain's history; `src/risk.py` scores Uniswap's hooklist registry).

**Run / output.** `pip install hookguard`; `hookguard scan <repo-url|dir --local> --json/--html/--md`. Composite GitHub Action (`action.yml` → `src/ci.py`) emitting `::error file=,line=` annotations, a job summary, and one PR comment edited in place. Exit 0/1/2, `fail-on: HIGH` default. Output is a flat JSON array of `{file, contract, declared[], returnsDelta[], findings:[sev, rule, msg, line]}` plus a 0–100 score. No SARIF. A published "HookScore" record spec (per-address JSON with itemised weight factors and a confidence tier).

**Licence.** MIT (`data/hooklist.json` is a snapshot of Uniswap's registry — take that from Uniswap, not from here).

**Maturity.** 70 commits, one real author (`chaosxcode`, 68) plus one 2-commit contributor. Created 2026-08-16; **last human commit 2026-08-24** — everything since is an automated registry refresh (latest 2026-09-07). 2 stars; their own `reach.py` reports **0/5 external installs**. Tests: two unittest files (~13 assertions), two Solidity fixtures, one parity harness. No corpus gate in CI. v0.9.1.

## 2. Inventory (`src/scan.py`)

Qualification: first **concrete** `contract` declaration; must declare `getHookPermissions()` or name `BaseHook`/`IHooks` in its `is` clause; mock/test/example names skipped.

| Rule | Sev | Technique (actual) |
|---|---|---|
| `PERMISSIONLESS_ATTACHMENT` | MED | `beforeInitialize` not declared **and** none of 5 regex spellings of pool validation (currency/fee/tickSpacing compare near a revert; `PoolId` allowlist; `Not(Initialized\|Registered\|Supported…)` error names; `!x.initialized…revert`; `sqrtPriceX96 == 0` + nearby `revert *Invalid*`) matched — searching the file plus one-hop-delegated sibling `.sol` files. Escalated over `PERMISSIONLESS_BY_DESIGN` iff a transfer/`take`/`settle`/`mint` regex hits or a `mapping(PoolId` exists |
| `PERMISSIONLESS_BY_DESIGN` | INFO | same, stateless and fund-free |
| `MISSING_POOLMANAGER_GUARD` | HIGH | **Skipped entirely if `is …BaseHook` matches.** Else per callback: collects modifier bodies + short (<600 char) internal fns containing `msg.sender ==/!=`; guarded if an applied modifier compares `msg.sender` *or* its name contains "poolmanager", or the body compares inline, or it calls an auth helper. Suppressed when `is_inert` (unconditional revert / `view`/`pure` / no assignment outside named returns & locals) |
| `UPGRADEABLE_HOOK` | HIGH | one regex: `UUPSUpgradeable\|Initializable\|TransparentUpgradeableProxy\|_authorizeUpgrade\|delegatecall` anywhere in the file |
| `DELTA_FLAG_MISMATCH` | MED | `beforeSwapReturnsDelta: true` but `beforeSwap` body contains no `toBeforeSwapDelta\|BeforeSwapDelta(` |
| `DELTA_FLAG_UNUSED` | LOW | `afterSwapReturnsDelta: true` but `afterSwap` appears to return a zero second element |
| `REVERT_DOS_RISK` | MED | `beforeSwap`/`afterSwap` body matches `latestRoundData\|getPrice\|oracle.\|.call(\|staticcall\|IERC20().transfer*` with no `try ` in the body |
| `UNBOUNDED_DYNAMIC_FEE` | MED | file mentions `DYNAMIC_FEE_FLAG\|updateDynamicLPFee` and matches none of `MAX_FEE\|maxFee\|require(…fee <\|fee = fee > x ?` |
| `REENTRANCY_SURFACE` | MED | file lacks `ReentrancyGuard\|nonReentrant\|_locked\|transient` and a declared callback body contains a transfer |

Non-source: `risk.py` registry tags (`UPGRADEABLE`, `UNVERIFIED_SOURCE`, `NO_PUBLISHED_AUDIT`, `VALUE_MOVING`, `DYNAMIC_FEE`, `CRITICAL_COMBO`) from declared flags; `bytecode.py` signals (proxy kind, DELEGATECALL target constant vs storage-derived, SELFDESTRUCT, codehash clone families, dual permission-bit decoding); `score.py` additive 0–100 weight table with a confidence tier.

## 3. Mapping against hookrisk

| HookGuard rule | hookrisk coverage | Which is stronger |
|---|---|---|
| `MISSING_POOLMANAGER_GUARD` | **HS-01** (`guards_pool_manager`) | hookrisk, decisively. SlithIR `Binary` EQ/NE + `msg.sender` + a type-resolved pool-manager state var, walked transitively through modifiers *and* internal calls with `resolve_override`. HookGuard is switched off wholesale by an `is …BaseHook` substring (a vendored or fake `BaseHook` silences it — the exact case HS-01 exists for) and accepts a modifier *named* "poolManager" as proof. Their own corpus: 0 findings across 291 hooks |
| `DELTA_FLAG_MISMATCH` / `_UNUSED` | **partial — HS-02** covers declared↔implemented and returns-delta-without-parent-flag, but *not* "delta flag declared, no delta constructed" | HookGuard has the idea; hookrisk has the machinery to do it properly |
| `UPGRADEABLE_HOOK` | not in hookrisk (BlockSec only, `upgradeable-hook`) | HookGuard's **source** regex is worse than useless (`delegatecall` anywhere → HIGH). Its **bytecode** layer is genuinely better than nothing: EIP-1967 slot read, EIP-1167, constant-vs-storage-derived DELEGATECALL target in a 10-instruction window |
| `REVERT_DOS_RISK` | **not implemented** — HS-05 is a stub; `external_calls_in`/`swap_path_functions`/`ExternalCall{destination,line,is_static}` already exist unused | hookrisk's helpers are far stronger; HookGuard contributes the *framing* (unhandled external call in a required callback is a liveness/DoS risk, not just a dependency) |
| `UNBOUNDED_DYNAMIC_FEE` | **not implemented** — `unbounded-dynamic-fee` is already a `RuleClass`, already in `CLASS_COVERAGE` and `DIMENSION_RULES` (priceImpactingBehavior→2) | hookrisk can do it structurally; HookGuard's is two regexes but fires on 11% of real hooks |
| `PERMISSIONLESS_ATTACHMENT` / `_BY_DESIGN` | **no coverage at all** — no rule class, no dimension, no metric | HookGuard's only original contribution. Technique is weak (5 enumerated regex spellings, each added after a hand-verified false positive), but the *class* is real and hookrisk is blind to it |
| `REENTRANCY_SURFACE` | none | Weak both ways; file-global suppression regex, and v4's lock already bounds it. Low value |
| Registry/bytecode/census layers | hookrisk's deployed mode exists **in schema only** (`hook-risk.schema.json` already specifies chainId/codehash/address-bit decoding) | HookGuard has actually done this; hookrisk has not |

## 4. Candidates, by value

1. **HS-06 unbounded dynamic fee** — SMALL, 5–8 h. New detector `detectors/slither_hookrisk/detectors/hs06_dynamic_fee.py`; **no CLI change needed** (class, coverage map and dimension rule already exist). Detect `updateDynamicLPFee` calls / `LPFeeLibrary.DYNAMIC_FEE_FLAG` use, then check the fee argument's provenance for a bounded comparison or constant using the existing `_guard_candidate_nodes` traversal. Best value/effort in the list: it makes `priceImpactingBehavior` measurable on hooks with no returns-delta. Re-implement; take nothing but the idea.
2. **Permissionless pool attachment** — MEDIUM, 8–14 h. The only true conceptual gap. New `RuleClass` (`unvalidated-pool-key`) in `cli/src/types.ts`, `CLASS_COVERAGE`/`DIMENSION_RULES` in `cli/src/scoring/derive.ts`, new detector + `pool_key_validated()` helper in `utils/hook_analysis.py`, corpus fixtures both sides, DETECTORS.md. Do it structurally: an EQ/NE comparison whose operands are a `key` field read (or `key.toId()`) and a state variable, on a path reaching a revert — reachable from an implemented callback that writes state or moves value. **Ship it below HIGH**: HookGuard downgraded it to MEDIUM after hand-checking found five legitimate validation spellings, and half its findings were wrong. Their five spellings are a free test-corpus checklist. Re-implement.
3. **HS-05 external call in swap path, with a liveness dimension** — SMALL/MEDIUM, 6–10 h. Already on hookrisk's roadmap; the only borrowed idea is "unhandled + required callback = DoS". `ExternalCall.destination`/`.line`/`.is_static` are computed and discarded today. Unlocks `externalDependencies`, currently always unmeasured.
4. **Preview-PoolManager bit order (deployed mode landmine)** — SMALL, 2–4 h, and free. `hooks_spec.FLAG_BITS` is final-v4 order; Unichain's PoolManager `0x1F98400…0004` is the **preview** deployment whose ten callback flags decode **reversed** (measured 17/18 vs 1/18 against verified source), and the four returns-delta positions match neither layout. `hook-risk.schema.json` already promises to decode the low 14 bits. Add a per-chain PoolManager→layout table and a `permissionBitLayout` field before deployed mode ships, or hookrisk will publish confidently wrong permissions.
5. **HS-02 third case: delta flag declared, no delta constructed** — SMALL, 3–5 h, inside `hs02_flag_divergence.py`. Note the dangerous inverse (delta returned without the flag → every swap reverts) is detected by neither tool.
6. **CI ergonomics** — SMALL, 2–4 h. The in-place-edited PR comment (`ci.py:upsert_comment`, marker + PATCH) and the "N .sol files but no hook contracts" warning. hookrisk's SARIF is better placement but silent on forks and needs the upload action.
7. **Do not adopt `score.py`.** It is additive, unbounded-evidence-free, and prices *absence* (`no_audit_recorded` +10, `unregistered` +8) while its own rule 2 claims "no deductions for absence of evidence" — a direct contradiction. hookrisk's unmeasured-is-not-zero plus a tier range is strictly better.

**Licence.** HookGuard is MIT; hookrisk's `cli/` is MIT and `detectors/` is AGPL-3.0-only. Porting into either is legal (MIT→AGPL is one-way compatible) provided the MIT notice is preserved and `NOTICE` records it. But nothing here is worth porting — every candidate above is a re-implementation at higher fidelity. The genuinely reusable items (validation spellings, guard spellings, the reversed bit-order measurement) are facts, not code.

## 5. HookGuard as a third engine?

**Mechanically easy, and not worth it.** The `Engine` contract (`cli/src/types.ts`) needs `id`, `displayName`, `upstream{url,license}`, `probe()`, `run(ctx)→EngineResult`. HookGuard is pip-installable, keyless, Docker-free and emits per-contract JSON rows *even when clean* — which is a usable `targetCoverage`/`scope` signal. The adapter would be ~150–250 lines versus `blocksec.ts`'s 882 (nearly all of which is Docker platform, entrypoint and solc provisioning).

The reason not to: BlockSec earns its slot by using a **different substrate** (Yul CFG over bytecode), so disagreement is informative and agreement is corroboration. HookGuard analyses the same substrate hookrisk already analyses, at strictly lower fidelity — regex where hookrisk has SlithIR. On the one class both cover, HookGuard's rule is disabled by a `BaseHook` substring and reports zero findings ecosystem-wide. Corroboration value ≈ 0, and admitting a regex engine as *responsible* for a dimension in `CLASS_COVERAGE` would let a `measured: 0` be produced from a regex's silence — the precise failure `unmeasured-is-not-zero` exists to prevent.

If you want an engine from this repo, wrap **`src/bytecode.py`**, not `scan.py`: it gives `upgradeable-hook` and `selfdestruct` from runtime bytecode with no Docker and no API key, which is exactly the BlockSec dependency hookrisk is trying to avoid in CI.

## 6. What hookrisk does that HookGuard does not

Executes the hook at all (twin-pool differential harness against real v4-core; I1/I2/I2b/I3; planted-defect validation proving the harness can fail). Compiles the target (AST/SlithIR, override resolution, inheritance-resolved permissions). HS-02 flag/implementation divergence in both directions, and the stub-vs-deliberate-refusal distinction. Legacy-ABI classification. IR-lifting coverage reporting (HR-E205). A versioned engine-metadata contract with drift rejection, cross-engine dedupe/corroboration, SARIF, a codehash-bound manifest, per-dimension coverage with an explicit undetermined tier, and a gate that distinguishes "clean" from "not analysed".

Conversely, HookGuard has done one thing hookrisk has not done at all: **measured the ecosystem** — 306-contract corpus with published per-rule firing rates and eight documented false-positive classes, full-history `Initialize` census showing 1.24% registry coverage on Unichain, and the finding that only 17% of the busiest off-registry hooks publish source at all. That last number is the ceiling on hookrisk's entire source-level method and is worth citing.

## 7. Sources

- `https://github.com/chaosxcode/hookguard` and `https://api.github.com/repos/chaosxcode/hookguard` (+ `/commits`, `/contributors`, `/tags`, `/git/trees/master?recursive=1`)
- `https://raw.githubusercontent.com/chaosxcode/hookguard/master/README.md` (`main` 404s; default branch is `master`)
- Full tree via `https://codeload.github.com/chaosxcode/hookguard/tar.gz/refs/heads/master`, from which I read: `src/scan.py`, `src/score.py`, `src/risk.py`, `src/bytecode.py`, `src/hookguard.py`, `src/ci.py`, `src/reach.py`, `src/discover.py`, `src/corpus.py`, `src/status_feed.py`, `src/attribution.py`, `docs/precision.md`, `docs/SCORING.md`, `docs/HOOKSCORE-SPEC.md`, `docs/ROADMAP.md`, `docs/assets/hg-scanner.js`, `tests/test_rules.py`, `tests/test_scoring.py`, `tests/parity.cjs`, `tests/fixtures/RiskyHook.sol`, `findings/base-hook-coverage.md`, `action.yml`, `pyproject.toml`, `LICENSE`
- hookrisk (local, read-only): `docs/hackathon/HACKATHON.md`, `docs/DETECTORS.md`, `docs/INVARIANTS.md`, `docs/SCORING.md`, `docs/hackathon/RESUME.md`, `detectors/slither_hookrisk/detectors/*.py`, `detectors/slither_hookrisk/utils/{hook_analysis,hooks_spec}.py`, `cli/src/types.ts`, `cli/src/scoring/derive.ts`, `cli/src/engines/{blocksec,dedupe}.ts`, `cli/src/sarif.ts`, `schema/{framework-rubric,hook-risk,engine-metadata}.json`, `NOTICE`

Nothing in the hookrisk repository was modified.
