# Hook Risk Report — StablePairHook

Executable assessment against the [Uniswap Hooks Security Framework](https://github.com/uniswapfoundation/security-framework): static detectors, a differential twin-pool harness, and the framework’s scoring rubric. Unmeasured dimensions are excluded from the total, never counted as zero.

## Summary

| | |
| --- | --- |
| Contract | `StablePairHook` in `src/stable/StablePairHook.sol` |
| Compiler | solc 0.8.26 |
| Risk tier | **LOW** 6/33, undetermined up to MEDIUM 17/33 |
| Gate | ❌ Failed (2 reasons below) |
| Findings | 1 high, 1 medium · 1 classification |
| Dimensions | 4 measured · 2 declared · 3 unmeasured |
| Static analysis | ok |
| Differential harness | failed (HR-E304) |
| Invariants | ⚠️ I1 inconclusive · ⚠️ I2 inconclusive · ⚠️ I3 inconclusive |
| Tool | hookrisk 0.1.0, rubric e7e8da52fd5717b6eb4517ea779b766f63148c41 |

> **The tier is a range.** 6/33 is the sum of what could be measured or was declared; 3 dimensions have no detector or declaration. At their maximum the hook would score 17/33 (medium). Declare them in `hookrisk.toml` to close the range.

### Why the gate failed

1. the differential harness failed: harness setUp failed: TwinPools: hooked pool would not initialise. With fee 3000: 0x1210aa130000000000000000000000007fa9385be102ac3eac297483dd6233d62b3e1496; with a dynamic fee: 0x1210aa13000000000000
2. 1 finding(s) at or above high: StablePairHook (src/stable/StablePairHook.sol#25-259) declares permission `afterInitialize` (bit 12, AFTER_INITIALIZE_FLAG) but provides no working …

## Findings

| # | Severity | Rule | Finding | Location | Confidence | Engines |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | 🟠 High | HS-02 `flag-implementation-divergence` | `afterInitialize` is declared but has no working implementation | `src/stable/StablePairHook.sol:25` | medium | hookrisk |
| F2 | 🟡 Medium | HS-03 `admin-surface` | `initializePool` changes hook state and is callable outside a swap | `src/stable/StablePairHook.sol:34` | medium | hookrisk |

### F1 · 🟠 High · `afterInitialize` is declared but has no working implementation

HS-02 `flag-implementation-divergence` · `src/stable/StablePairHook.sol:25` · confidence **medium**

StablePairHook (src/stable/StablePairHook.sol#25-259) declares permission `afterInitialize` (bit 12, AFTER_INITIALIZE_FLAG) but provides no working `afterInitialize` implementation. The PoolManager will call it on every matching pool operation and the call will revert, making the pool unusable for that operation.

Reported by `hookrisk/hookrisk-flag-divergence`.

### F2 · 🟡 Medium · `initializePool` changes hook state and is callable outside a swap

HS-03 `admin-surface` · `src/stable/StablePairHook.sol:34` · confidence **medium**

StablePairHook.initializePool(PoolKey,uint160,StableFeeConfig) (src/stable/StablePairHook.sol#34-48) (initializePool) is restricted to a privileged caller and writes `STABLE_FEE_CONFIGURATION_STORAGE_LOCATION` which the callbacks read. That key can change the swap's economics after deployment: the framework's autonomous-parameter-updates concern.

Reported by `hookrisk/hookrisk-admin-surface`.

## Classifications

Properties of the hook that change how it is scored or tested. They are informational and never fail the gate.

| Rule | Classification | Applies to | Detail |
| --- | --- | --- | --- |
| C-01 `callback-intentionally-disabled` | `beforeInitialize` is disabled by design (deliberate revert) | `src/stable/StablePairHook.sol:25` (`beforeInitialize`) | StablePairHook (src/stable/StablePairHook.sol#25-259) overrides `beforeInitialize` (inherited from BaseDynamicFeeHook._beforeInitialize) with `revert InvalidInitializer()`, so PoolManager-routed pool initialisation is disabled by design; the differential harness records such reverts when it runs. |

## Hook profile

The static engine’s structural measurement of the contract. Complexity is derived from these metrics; the rule that fired is quoted in the score table’s evidence.

| Metric | Value |
| --- | --- |
| Callbacks implemented (working; deliberate revert-guards are listed as disabled) | 4 |
| Callbacks declared | 6 |
| State writes in callbacks | 1 |
| External calls in the swap path | 0 |
| externalCallsInSwapPathThirdParty | 0 |
| Internal functions reachable from callbacks | 9 |
| Returns a delta | false |
| Owner-only surface | true |
| Permissions declared | `beforeInitialize`, `afterInitialize`, `beforeAddLiquidity`, `afterAddLiquidity`, `beforeSwap`, `afterSwap` |

## Score

| Dimension | Score | Source | Bracket |
| --- | --- | --- | --- |
| Complexity | 2/5 | measured | Callbacks write hook state, or 3+ callbacks ᵃ |
| Custom math | — | unmeasured | _unmeasured_ ᵃ |
| External dependencies | 0/3 | measured | None; the hook touches only the PoolManager and the pair's tokens ᵃ |
| External liquidity exposure | — | unmeasured | _unmeasured_ ᵃ |
| TVL potential | 0/5 | declared | Under $100K (experimental or personal project) |
| Team maturity | 3/3 | declared | Unproven: no prior production deployments, or deployments lacking audits and operational rigor; new, anonymous, or no public track record |
| Upgradeability | — | unmeasured | _unmeasured_ ᵃ |
| Autonomous parameter updates | 1/3 | measured | Self-adjusting within hard-coded bounds and a rate limit ᵃ |
| Price impacting behavior | 0/3 | measured | Observes swaps; does not alter price, fee or delta ᵃ |

ᵃ Bracket supplied by hookrisk. The framework publishes brackets for only two of its nine dimensions; the rest are our reading of its prose. See [FEEDBACK.md](https://github.com/0xmvercosa/hookrisk/blob/main/FEEDBACK.md) #2.

<details><summary>Evidence per dimension</summary>

- **Complexity**
  - hook-profile metrics: callbacksImplemented=4, callbacksDeclared=6, stateWritesInCallbacks=1, externalCallsInSwapPath=0, externalCallsInSwapPathThirdParty=0, internalFunctionsReachableFromCallbacks=9, usesReturnsDelta=false, hasOwnerOnlyFunctions=true
  - Scored 2 by rule `stateWritesInCallbacks >= 1 || callbacksImplemented >= 3`: Hook state written in callbacks is the 'branching logic' the prose names first; three or more callbacks is its 'number of callbacks'. (hookrisk’s interpretation; the framework publishes no brackets)
  - 1 flag-implementation-divergence finding(s)
  - The hook implements callbacks with non-trivial structure. This establishes a floor only; the measured value comes from the hook-profile metrics when the engine profiled the target.
- **Custom math**
  - Not measured: no detector for rounding-direction yet.
- **External dependencies**
  - No external-call-in-swap-path findings, and every detector that could produce one ran.
  - Corroborated by the hook profile: zero third-party calls in the swap path.
- **TVL potential**
  - Declared in hookrisk.toml. hookrisk does not measure tvlPotential.
- **Team maturity**
  - Declared in hookrisk.toml. hookrisk does not measure teamMaturity.
- **Upgradeability**
  - Not measured: no detector for upgradeable-hook (needs blocksec, which did not run); selfdestruct requires blocksec, which did not run.
- **Autonomous parameter updates**
  - 1 admin-surface finding(s)
  - Scored 1 by rule `severityRank >= 2` on initializePool (medium): HS-03 at MEDIUM is an owner-only mutator (hook-profile.hasOwnerOnlyFunctions). The framework's 0 bracket describes exactly this shape, but scoring 0 would rank a hook whose owner can move the fee level with a hook that has no parameters at all, and source analysis cannot see the owner's guardrails — timelock, ceiling, multisig. 1 records the surface as a floor without asserting autonomy; a team that has a timelock should declare 0 in hookrisk.toml. (hookrisk’s interpretation; the framework publishes no brackets)
  - HS-03 found a state-changing external function on the hook. The framework grades this dimension by the guardrails on a parameter change (bounds, rate limit, gating); an admin surface is where those guardrails would have to live.
- **Price impacting behavior**
  - No custom-accounting or unbounded-dynamic-fee findings, and every detector that could produce one ran.
  - Corroborated by the hook profile: no returns-delta permission, and HS-06 found no unbounded dynamic fee.

</details>

### Feature triggers

These apply regardless of the total: the framework’s own safeguard against a team scoring itself low while shipping a dangerous primitive.

| Trigger | Fired by | Derivation |
| --- | --- | --- |
| Autonomous Parameter Updates or Self-Tuning Hook | `autonomousParameterUpdates >= 1 (is 1)` | hookrisk’s reading |

## Security plan

The strongest requirement across the tier baseline and every fired trigger, with the source of each.

| Action | Strength | Because |
| --- | --- | --- |
| Security audit | **Required** | `tier:low` |
| Invariant and stateful fuzz testing | **Required** | `trigger:autonomous` |
| Documented debugging and recovery procedures | **Required** | `trigger:autonomous` |
| Automated static analysis | **Required** | `tier:low` |
| Minimise or timelock upgradeability | **Required** | `trigger:autonomous` |
| Continuous monitoring with anomaly detection | Strongly recommended | `tier:low`, `trigger:autonomous` |
| Bug bounty programme | Optional | `tier:low` |
| Audit by a math and invariants specialist | Optional | `tier:low` |

## Dynamic analysis

Differential twin-pool harness: **failed** (HR-E304). harness setUp failed: TwinPools: hooked pool would not initialise. With fee 3000: 0x1210aa130000000000000000000000007fa9385be102ac3eac297483dd6233d62b3e1496; with a dynamic fee: 0x1210aa130000000000000000000000007fa9385be102ac3eac297483dd6233d62b3e1496. The twin pools could not be built, so no sequence ran and nothing about the hook was observed (HR-E304).

| | Invariant | Result | Detail |
| --- | --- | --- | --- |
| ⚠️ | I1 Conservation and solvency | inconclusive | see the harness status above |
| ⚠️ | I2 No undeclared extraction | inconclusive | see the harness status above |
| ⚠️ | I3 Exit liveness | inconclusive | see the harness status above |

## Analysis coverage

| Engine | Status | Findings | Notes |
| --- | --- | --- | --- |
| hookrisk Slither detectors | ok | 4 |  |
| Differential harness (Foundry) | failed (HR-E304) | 0 | harness setUp failed: TwinPools: hooked pool would not initialise. With fee 3000: 0x1210aa130000000000000000000000007fa9385be102ac3eac297483dd6233d62b3e1496; with a dynamic fee: 0x1210aa130000000000000000000000007fa9385be102ac3eac297483dd6233d62b3e1496. The twin pools could not be built, so no sequence ran and nothing about the hook was observed (HR-E304). |

> ⚠️ **26 function(s) in the compilation unit were not analysed.** Slither could not lift them to IR and continued silently. Findings above do not cover them; that is not the same as those functions being clean. See `HR-E205`.

- `BaseAggregatorHook._getFullDebt`
- `BaseAggregatorHook._getFullCredit`
- `BaseHookDataAggregator._getFullDebt`
- `BaseHookDataAggregator._getFullCredit`
- `FluidDexLiteAggregator._getFullDebt`
- `FluidDexLiteAggregator._getFullCredit`
- `FluidDexT1Aggregator._getFullDebt`
- `FluidDexT1Aggregator._getFullCredit`
- `LitePSMAggregator._getFullDebt`
- `LitePSMAggregator._getFullCredit`
- `PancakeSwapV3Aggregator._getFullDebt`
- `PancakeSwapV3Aggregator._getFullCredit`
- `SlipstreamAggregator._getFullDebt`
- `SlipstreamAggregator._getFullCredit`
- `StableSwapAggregator._getFullDebt`
- `StableSwapAggregator._getFullCredit`
- `StableSwapNGAggregator._getFullDebt`
- `StableSwapNGAggregator._getFullCredit`
- `TempoExchangeAggregator._getFullDebt`
- `TempoExchangeAggregator._getFullCredit`
- `UniswapV2Aggregator._getFullDebt`
- `UniswapV2Aggregator._getFullCredit`
- `UniswapV3Aggregator._getFullDebt`
- `UniswapV3Aggregator._getFullCredit`
- `UniswapXAggregator._getFullDebt`
- `UniswapXAggregator._getFullCredit`

## Warnings

- 3 dimension(s) unmeasured: the tier is between Low Risk and Medium Risk. Unmeasured dimensions are excluded from the total, never counted as zero.
- trigger 'custom-math' could not be evaluated: dimension 'customMath' is unmeasured
- trigger 'holds-liquidity' could not be evaluated: dimension 'externalLiquidityExposure' is unmeasured
- trigger 'upgradeable' could not be evaluated: dimension 'upgradeability' is unmeasured

---

_Generated by [hookrisk](https://github.com/0xmvercosa/hookrisk). The Uniswap Foundation does not review, endorse or certify this report or any score derived from its framework._
