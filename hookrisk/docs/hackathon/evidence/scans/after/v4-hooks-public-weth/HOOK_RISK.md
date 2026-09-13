# Hook Risk Report — WETHHook

Executable assessment against the [Uniswap Hooks Security Framework](https://github.com/uniswapfoundation/security-framework): static detectors, a differential twin-pool harness, and the framework’s scoring rubric. Unmeasured dimensions are excluded from the total, never counted as zero.

## Summary

| | |
| --- | --- |
| Contract | `WETHHook` in `src/WETHHook.sol` |
| Compiler | solc 0.8.26 |
| Risk tier | **MEDIUM** 15/33, undetermined up to HIGH 21/33 |
| Gate | ✅ Passed |
| Findings | 1 medium · 2 classifications |
| Dimensions | 5 measured · 2 declared · 2 unmeasured |
| Static analysis | ok |
| Differential harness | skipped (HR-E305) |
| Invariants | ⏭️ I1 skipped · ⏭️ I2 skipped · ⏭️ I3 skipped |
| Tool | hookrisk 0.1.0, rubric e7e8da52fd5717b6eb4517ea779b766f63148c41 |

> **The tier is a range.** 15/33 is the sum of what could be measured or was declared; 2 dimensions have no detector or declaration. At their maximum the hook would score 21/33 (high). Declare them in `hookrisk.toml` to close the range.

## Findings

| # | Severity | Rule | Finding | Location | Confidence | Engines |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | 🟡 Medium | HS-05 `external-call-in-swap-path` | `weth` calls out of the swap path mid-swap | `src/WETHHook.sol:43` | medium | hookrisk |

### F1 · 🟡 Medium · `weth` calls out of the swap path mid-swap

HS-05 `external-call-in-swap-path` · `src/WETHHook.sol:43` · confidence **medium**

WETHHook._withdraw(uint256) (src/WETHHook.sol#43-50) makes a state-changing call to `weth` in the swap path (_withdraw:47), reached from beforeSwap. That address is a dependency the pool did not have: a revert or a pause there reverts every swap on every pool using this hook.

Reported by `hookrisk/hookrisk-external-call-in-swap-path`.

## Classifications

Properties of the hook that change how it is scored or tested. They are informational and never fail the gate.

| Rule | Classification | Applies to | Detail |
| --- | --- | --- | --- |
| HS-07 `custom-accounting` | Custom accounting: the hook can alter settled amounts | `src/WETHHook.sol:12` | WETHHook (src/WETHHook.sol#12-54) declares custom-accounting permissions: `beforeSwapReturnDelta` (bit 3). |
| C-01 `callback-intentionally-disabled` | `beforeAddLiquidity` is disabled by design (deliberate revert) | `src/WETHHook.sol:12` (`beforeAddLiquidity`) | WETHHook (src/WETHHook.sol#12-54) overrides `beforeAddLiquidity` (inherited from BaseTokenWrapperHook._beforeAddLiquidity) with `revert LiquidityNotAllowed()`, so PoolManager-routed liquidity addition is disabled by design; the differential harness records such reverts when it runs. |

## Hook profile

The static engine’s structural measurement of the contract. Complexity is derived from these metrics; the rule that fired is quoted in the score table’s evidence.

| Metric | Value |
| --- | --- |
| Callbacks implemented (working; deliberate revert-guards are listed as disabled) | 2 |
| Callbacks declared | 3 |
| State writes in callbacks | 0 |
| External calls in the swap path | 7 |
| externalCallsInSwapPathThirdParty | 1 |
| Internal functions reachable from callbacks | 13 |
| Returns a delta | true |
| Owner-only surface | false |
| Permissions declared | `beforeInitialize`, `beforeAddLiquidity`, `beforeSwap`, `beforeSwapReturnDelta` |

## Score

| Dimension | Score | Source | Bracket |
| --- | --- | --- | --- |
| Complexity | 4/5 | measured | Returns a delta and makes an external call in the swap path ᵃ |
| Custom math | 3/5 | measured | A custom curve or invariant function ᵃ |
| External dependencies | 2/3 | measured | A dependency read inside the swap path, or more than one dependency ᵃ |
| External liquidity exposure | — | unmeasured | _unmeasured_ ᵃ |
| TVL potential | 0/5 | declared | Under $100K (experimental or personal project) |
| Team maturity | 3/3 | declared | Unproven: no prior production deployments, or deployments lacking audits and operational rigor; new, anonymous, or no public track record |
| Upgradeability | — | unmeasured | _unmeasured_ ᵃ |
| Autonomous parameter updates | 0/3 | measured | All parameters set by an explicit privileged call ᵃ |
| Price impacting behavior | 3/3 | measured | Returns a swap delta (custom curve or NoOp), or adjusts fees without a ceiling ᵃ |

ᵃ Bracket supplied by hookrisk. The framework publishes brackets for only two of its nine dimensions; the rest are our reading of its prose. See [FEEDBACK.md](https://github.com/0xmvercosa/hookrisk/blob/main/FEEDBACK.md) #2.

<details><summary>Evidence per dimension</summary>

- **Complexity**
  - hook-profile metrics: callbacksImplemented=2, callbacksDeclared=3, stateWritesInCallbacks=0, externalCallsInSwapPath=7, externalCallsInSwapPathThirdParty=1, internalFunctionsReachableFromCallbacks=13, usesReturnsDelta=true, hasOwnerOnlyFunctions=false
  - Scored 4 by rule `usesReturnsDelta && externalCallsInSwapPath >= 1`: A hook that both alters settled amounts and leaves the swap path mid-flight has two interacting flows to reason about, not one. (hookrisk’s interpretation; the framework publishes no brackets)
  - The hook implements callbacks with non-trivial structure. This establishes a floor only; the measured value comes from the hook-profile metrics when the engine profiled the target.
- **Custom math**
  - 1 custom-accounting finding(s)
  - Custom accounting implies a custom curve or non-standard settlement arithmetic.
- **External dependencies**
  - 1 external-call-in-swap-path finding(s)
  - Scored 2 by rule `always` on weth (medium): The framework's 2 bracket verbatim: a dependency read inside the swap path. Unconditional, so a finding whose call kind the detector did not classify also scores 2 — the direction that does not understate risk. (hookrisk’s interpretation; the framework publishes no brackets)
  - An external call inside the swap path reopens the execution environment mid-swap.
- **TVL potential**
  - Declared in hookrisk.toml. hookrisk does not measure tvlPotential.
- **Team maturity**
  - Declared in hookrisk.toml. hookrisk does not measure teamMaturity.
- **Upgradeability**
  - Not measured: no detector for upgradeable-hook (needs blocksec, which did not run); selfdestruct requires blocksec, which did not run.
- **Autonomous parameter updates**
  - No admin-surface findings, and every detector that could produce one ran.
  - Corroborated by the hook profile: no owner-only surface, and HS-03 found no unguarded mutator of callback-read state.
- **Price impacting behavior**
  - 1 custom-accounting finding(s)
  - A returns-delta permission lets the hook alter settled amounts, which is the framework’s definition of price-impacting behaviour.

</details>

### Feature triggers

These apply regardless of the total: the framework’s own safeguard against a team scoring itself low while shipping a dangerous primitive.

| Trigger | Fired by | Derivation |
| --- | --- | --- |
| Custom Curve or Non Standard Math | `customMath >= 3 (is 3)`, `returns-delta-permission` | hookrisk’s reading |
| External Protocol or Oracle Dependencies | `externalDependencies >= 1 (is 2)`, `detector:external-call-in-swap-path` | hookrisk’s reading |
| Price Impacting Behavior | `priceImpactingBehavior >= 1 (is 3)`, `returns-delta-permission` | hookrisk’s reading |

## Security plan

The strongest requirement across the tier baseline and every fired trigger, with the source of each.

| Action | Strength | Because |
| --- | --- | --- |
| Adversarial and economic simulation | **Required** | `trigger:price-impact` |
| Security audit | **Required** | `tier:medium`, `trigger:external-dependencies` |
| Bug bounty programme | **Required** | `tier:medium`, `trigger:external-dependencies`, `trigger:price-impact` |
| Audit by a math and invariants specialist | **Required** | `trigger:custom-math`, `trigger:price-impact` |
| Dependency-failure scenario testing | **Required** | `trigger:external-dependencies` |
| Automated static analysis | **Required** | `tier:medium` |
| Unit tests covering input-range boundaries | **Required** | `trigger:custom-math` |
| Continuous monitoring with anomaly detection | Strongly recommended | `tier:medium`, `trigger:custom-math`, `trigger:external-dependencies` |
| Extended test coverage | Recommended | `tier:medium` |
| Formal verification | Recommended | `trigger:custom-math`, `trigger:price-impact` |
| Invariant and stateful fuzz testing | Recommended | `trigger:custom-math` |
| Second independent audit | Optional | `tier:medium` |

## Dynamic analysis

Differential twin-pool harness: **skipped** (HR-E305). WETHHook's constructor takes 2 argument(s) (address _manager, address _weth) and the harness can only derive the IPoolManager on its own. Add [harness] constructorArgs to hookrisk.toml with one value per argument — $poolManager, $currency0, $currency1, $owner, $hook are substituted with the harness's own addresses, anything else is passed literally to `cast abi-encode`. See HR-E305.

| | Invariant | Result | Detail |
| --- | --- | --- | --- |
| ⏭️ | I1 Conservation and solvency | skipped | see the harness status above |
| ⏭️ | I2 No undeclared extraction | skipped | see the harness status above |
| ⏭️ | I3 Exit liveness | skipped | see the harness status above |

## Analysis coverage

| Engine | Status | Findings | Notes |
| --- | --- | --- | --- |
| hookrisk Slither detectors | ok | 4 |  |
| Differential harness (Foundry) | skipped (HR-E305) | 0 | WETHHook's constructor takes 2 argument(s) (address _manager, address _weth) and the harness can only derive the IPoolManager on its own. Add [harness] constructorArgs to hookrisk.toml with one value per argument — $poolManager, $currency0, $currency1, $owner, $hook are substituted with the harness's own addresses, anything else is passed literally to `cast abi-encode`. See HR-E305. |

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

- 2 dimension(s) unmeasured: the tier is between Medium Risk and High Risk. Unmeasured dimensions are excluded from the total, never counted as zero.
- trigger 'holds-liquidity' could not be evaluated: dimension 'externalLiquidityExposure' is unmeasured
- trigger 'upgradeable' could not be evaluated: dimension 'upgradeability' is unmeasured

---

_Generated by [hookrisk](https://github.com/0xmvercosa/hookrisk). The Uniswap Foundation does not review, endorse or certify this report or any score derived from its framework._
