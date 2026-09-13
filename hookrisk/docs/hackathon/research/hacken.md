# Hacken: "Auditing Uniswap V4 Hooks" and hknio/uni-v4-hooks-checker vs hookrisk

_Research note written by a read-only agent on 2026-09-12 to decide what hookrisk should adopt. Nothing here has been implemented unless RESUME.md says so._

# Hacken material vs. hookrisk

## 1. Inventory

**Article (7 steps, their wording):**

| # | Item |
|---|---|
| A1 | "mismatch between the Hook's declared permissions and its encoded address permissions" — both directions (never called / DoS reverts) |
| A2 | Address mining (`HookMiner.find`) required to encode flags |
| A3 | "incorrect return type in `beforeSwap()`" → overflow on cast, reverts |
| A4 | Upgradeable hook: address bits fixed at deploy, a callback added later can never be called; "define placeholder functions for future Hooks" |
| A5 | "recommended to use BaseHook from Uniswap" |
| A6 | `BeforeSwapDelta` is "from the perspective of the Hook": a fee must be negative |
| A7 | Delta order must align with `SwapParams.zeroForOne` |
| A8 | Unsettled deltas → `NonzeroDeltaCount != 0` → `CurrencyNotSettled`; hook must `settle()`/`take()` (also `settleFor`) |
| A9 | Hook must not change swap type → `HookDeltaExceedsSwapAmount` |
| A10 | "excessive or invalid" `lpFeeOverride` prevents execution |
| A11 | Async/NoOp hook takes full custody: steal funds, block execution, price manipulation |
| A12 | "absence of access control allows anyone to execute the Hook's logic" |
| A13 | "PoolManager does not validate pool exclusivity" — `onlyPoolManager` alone insufficient; verify the `PoolKey`, or one-shot `beforeInitialize` |
| A14 | Other external functions that impact execution (`updatePool(address)` unguarded) |
| A15 | UUPS proxy → post-audit backdoor |
| A16 | Owner-settable fee / withdrawal restriction / pause; "set swap fees to 100%" |
| A17-19 | Front-running: price-dependent logic, time-sensitive execution, oracle-based pricing |
| A20 | Unbounded loop in `beforeSwap` → gas exhaustion DoS |
| A21 | "Incorrectly implemented `require()` or `revert()`… block transactions even when they should succeed" |

**Checker (MIT; test names verbatim):** `CapsLib.detect` (C1), `run_PermissionsMatchAddressFlags_ifExposed` (C2), `run_Auth_OnlyPoolManager_OnEntrypoints` / "EOA guard" (C3), `run_Auth_Rejects_UntrustedPoolKey` (C4), `run_Auth_NoOpenExternalMutators` (C5, 8 hard-coded selectors), `run_Config_ReturnsOwnSelector_WhenCalledByManager` (C6), `run_Config_BaseHookInheritanceHint` (C7), `run_SwapReturnDelta_SignatureChecks` (C8), `run_NoSwapTypeFlip_from_BeforeSwap` (C9), `run_Settlement_SmokeSwap` (C10), `run_LPFeeOverride_Sanity` (C11), `run_Settlement_Smoke_AddAndRemove` + `run_After{Add,Remove}_ReturnsDelta_Informational` (C12), `run_Introspect_Complexity` (bytecode-size buckets, C13), `run_Introspect_ExternalFunctions` (C14), `run_Introspect_PublicGetters` / `_OptionalInterfaces` (C15), `run_DetectHookDataRequirement` (C16), `run_Reinitialize_Reverts` (C17), functional Swap/Liquidity/Donate/fuzz suites (C18), `StrictConfig` per-check strictness (C19), `HOOK_ADDRESS` + fork mode against a deployed hook (C20).

## 2. Mapping

| Item | hookrisk | Where |
|---|---|---|
| A12, C3 | **Partial** — statically yes, never executed | HS-01 (`hs01_unprotected_callback.py`, structural `guards_pool_manager`); harness makes no direct EOA call |
| A1, C2 | **Partial** — checks `getHookPermissions()` vs implementation, not vs *address bits* (impossible from source) | HS-02; RESUME open item 3 |
| A1 (returns-delta w/o parent flag) | **Covered** | HS-02 third case (`isValidHookAddress`) |
| A3, C8 | **Partial** | `unsupported-hook-abi` catches signature mismatch; no return-tuple assertion |
| A4, A15 | **Not covered by hookrisk itself** | HS-04 unimplemented; BlockSec covers when enabled (SCORING.md) |
| A5, C7 | **Covered, better** | DETECTORS.md rejects name-matching on `BaseHook` by design |
| A6, A7, A8, A9, C9, C10, C12 | **Covered structurally** — real v4-core, no mocks: `CurrencyNotSettled` / `HookDeltaExceedsSwapAmount` fire for real; `invariant_I2_hookDoesNotBlockSwaps`, I1 conservation | INVARIANTS.md |
| A10, C11 | **Partial** | Harness retries with `DYNAMIC_FEE_FLAG`; HS-06 unimplemented |
| A11 | **Covered** | HS-07 `custom-accounting` + I2b monotonicity + custom-math trigger |
| A13, C4 | **Not covered** — no occurrence of "exclusiv"/PoolId comparison anywhere in detectors, harness or CLI | — |
| A14, C5, C14 | **Not covered** — profile records `hasOwnerOnlyFunctions` (guarded); the *unguarded* mutator is the finding | HS-03 unimplemented |
| A16 | **Partial** | `hasOwnerOnlyFunctions` → complexity input only |
| A17-A19, A20, A21 | **Not covered** (neither is by the checker: no gas or MEV assertion exists there either) | — |
| C1 | **Covered, stronger** | Runtime `getHookPermissions()` derivation + `permissions.fromRuntime` |
| C6 | **Partial** — implicit only when a swap lands | — |
| C13 | **Covered, stronger** | `hook-profile` metrics + rubric derivation vs. bytecode size |
| C16, C17 | **Not covered** | — |
| C18 | **Covered, stronger** | Fuzzed `TwinHandler` sequences, 256×32 / 5000×128 |
| C19 | **Covered** | `hookrisk.toml` gate + `failOnInconclusive` |
| C20 | **Not covered** | Deployed mode is schema-only |

## 3. Candidates, by value

1. **Pool-key exclusivity (A13/C4)** — the one genuinely novel *class*. Ship as a harness probe, not a detector: init a second pool with the same hook, prank `manager`, call `beforeSwap` with the foreign key. Report as an INFO classification `hook-not-pool-exclusive` feeding `externalLiquidityExposure` — **do not make it HIGH**; multi-pool hooks are legitimate and the checker itself defaults `STRICT_EXCLUSIVE=false`. Files: new `harness/test/`, `harness/test/TwinPools.sol` run record, `cli/src/harness.ts`, `cli/src/manifest.ts`, `docs/INVARIANTS.md`. **8-12 h · MEDIUM.**
2. **HS-03 unguarded external mutator (A14/C5/C14)** — static beats their 8-name brute force, and all helpers exist (`owner_only_functions`, `state_writes_in`, `is_project_source`). Closes a scored dimension. Files: new `detectors/slither_hookrisk/detectors/hs03_admin_surface.py`, `utils/hook_analysis.py`, `corpus/src/{bad,good}/`, `schema/framework-rubric.json`, `docs/DETECTORS.md`. **10-14 h · MEDIUM.**
3. **Dynamic EOA-guard probe (C3)** — corroborates HS-01 by execution, exactly the two-layer pattern `reconcile.ts` already implements for `disabled-callback`. Raises HS-01 to `high` confidence with a counterexample. Files: harness test + run record, `cli/src/harness.ts`, `cli/src/reconcile.ts`. **6-8 h · MEDIUM.**
4. **Selector / return-tuple assertion (C6/C8/A3)** — one pranked-PM call per implemented callback. Value is reach: it covers the 6-of-15 hooks the twin-pool path never trades through. Report as an observation, not an invariant row. Files: harness test, run record, docs. **4 h · SMALL.**
5. **HS-06 unbounded `lpFeeOverride` (A10/C11)** — fee returned from an owner-settable variable with no ceiling. Files: new detector, rubric (`priceImpactingBehavior`), corpus. **8 h · MEDIUM.**
6. **PRIOR_ART.md §Hacken** — currently says "suites for … authorization" without naming them; name EOA guard, exclusivity and selector-return as the three things they do and hookrisk does not, and cite the article. **1 h · SMALL.** Best presentation value per hour.
7. **Address-bits vs `getHookPermissions()` (A1/C2)** — only meaningful in deployed mode; make it the *first* check that mode ships. **CORE** (target model + engine contract), folded into RESUME item 3.

**Licence:** repo LICENSE is MIT (© 2025 "Uniswap v4 Hook Testing Framework Contributors"), so copying is permitted with notice retention. Recommend **reimplementing from behaviour, not copying**: their tests are entangled with `TestResultCollector`/`Caps`/`StrictConfig`, and `test/common/StrictConfig.sol` and `test/common/Caps.sol` both carry in-file `SPDX-License-Identifier: UNLICENSED`, contradicting the repo LICENSE — an unresolved provenance question hookrisk should not import.

## 4. What hookrisk does that Hacken does not

No counterfactual anywhere in the checker: it can say a swap succeeded, never that it returned the *right* amount — the twin-pool I2 declared-fee bound (the 1%-documented/3.5%-charged case) is invisible to it. No exit liveness after N swaps (I3), no whole-supply conservation (I1), no static layer, no SARIF, no line numbers, no rubric score, no gate exit code. It needs a **deployed address plus a hand-written test contract**; hookrisk scans `src/MyHook.sol:MyHook` from source. And it lacks hookrisk's honesty machinery — vacuous-pass detection, unmeasured≠0, IR-coverage reporting. Concretely: their `_hasFunction` returns `success || address(hook).code.length > 0`, so it is true for every contract with code, making `run_Introspect_ExternalFunctions` an unconditional "found 10 external mutators" warning. That is precisely the vacuous pass `coverage.observations` exists to prevent.

## 5. Sources

- https://hacken.io/discover/auditing-uniswap-v4-hooks/ (WebFetch 403; read in full via Firecrawl)
- https://raw.githubusercontent.com/hknio/uni-v4-hooks-checker/main/README.md and `LICENSE`
- `git/trees/main?recursive=1` for hknio/uni-v4-hooks-checker, plus raw `test/{authorization/HookAuthorization,configuration/HookConfiguration,deltas/SwapDeltaEffects,deltas/LiquidityDeltaEffects,suites/HookIntrospection,suites/HookDataDetection,suites/Swap,suites/Liquidity,suites/Initialize,suites/Donate,common/StrictConfig,common/Caps,FuzzTestEntry,MainTestEntry}.sol`
- hookrisk: `/Users/rafaelzochling/gitrepos/external/hookrisk/docs/{hackathon/HACKATHON.md,DETECTORS.md,INVARIANTS.md,SCORING.md,PRIOR_ART.md,hackathon/RESUME.md}`, `detectors/slither_hookrisk/`, `harness/test/{Generic.t.sol,TwinHandler.sol}`, `cli/src/config.ts`

No files in the hookrisk repository were modified.
