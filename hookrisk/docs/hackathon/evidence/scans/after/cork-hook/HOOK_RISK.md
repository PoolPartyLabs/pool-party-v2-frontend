# Hook Risk Report — CorkHook

Executable assessment against the [Uniswap Hooks Security Framework](https://github.com/uniswapfoundation/security-framework): static detectors, a differential twin-pool harness, and the framework’s scoring rubric. Unmeasured dimensions are excluded from the total, never counted as zero.

## Summary

| | |
| --- | --- |
| Contract | `CorkHook` in `src/CorkHook.sol` |
| Compiler | solc 0.8.26 |
| Risk tier | **MEDIUM** 17/33, undetermined up to HIGH 23/33 |
| Gate | ❌ Failed (1 reason below) |
| Findings | 3 high, 5 medium · 2 classifications |
| Dimensions | 5 measured · 2 declared · 2 unmeasured |
| Static analysis | ok |
| Differential harness | skipped (HR-E305) |
| Invariants | ⏭️ I1 skipped · ⏭️ I2 skipped · ⏭️ I3 skipped |
| Tool | hookrisk 0.1.0, rubric e7e8da52fd5717b6eb4517ea779b766f63148c41 |

> **The tier is a range.** 17/33 is the sum of what could be measured or was declared; 2 dimensions have no detector or declaration. At their maximum the hook would score 23/33 (high). Declare them in `hookrisk.toml` to close the range.

### Why the gate failed

1. 3 finding(s) at or above high: CorkHook.beforeInitialize(address,PoolKey,uint160) (src/CorkHook.sol#97-124) is an IHooks callback (0xdc98354e) that never compares msg.sender against …; CorkHook.beforeSwap(address,PoolKey,IPoolManager.SwapParams,bytes) (src/CorkHook.sol#365-378) is an IHooks callback (0x575e24b4) that never compares …; CorkHook (src/CorkHook.sol#31-734) declares permission `beforeRemoveLiquidity` (bit 9, BEFORE_REMOVE_LIQUIDITY_FLAG) but provides no working …

## Findings

| # | Severity | Rule | Finding | Location | Confidence | Engines |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | 🟠 High | HS-01 `unprotected-hook-callback` | `beforeInitialize` is callable by anyone, not only the PoolManager | `src/CorkHook.sol:97` | high | hookrisk |
| F2 | 🟠 High | HS-01 `unprotected-hook-callback` | `beforeSwap` is callable by anyone, not only the PoolManager | `src/CorkHook.sol:365` | high | hookrisk |
| F3 | 🟠 High | HS-02 `flag-implementation-divergence` | `beforeRemoveLiquidity` is declared but has no working implementation | `src/CorkHook.sol:31` | medium | hookrisk |
| F4 | 🟡 Medium | HS-03 `admin-surface` | `updateBaseFeePercentage` changes hook state and is callable outside a swap | `src/CorkHook.sol:228` | medium | hookrisk |
| F5 | 🟡 Medium | HS-03 `admin-surface` | `updateTreasurySplitPercentage` changes hook state and is callable outside a swap | `src/CorkHook.sol:232` | medium | hookrisk |
| F6 | 🟡 Medium | HS-05 `external-call-in-swap-path` | `forwarder` calls out of the swap path mid-swap | `src/CorkHook.sol:385` | medium | hookrisk |
| F7 | 🟡 Medium | HS-05 `external-call-in-swap-path` | `owner()` calls out of the swap path mid-swap | `src/CorkHook.sol:473` | medium | hookrisk |
| F8 | 🟡 Medium | HS-05 `external-call-in-swap-path` | `sender` calls out of the swap path mid-swap | `src/CorkHook.sol:513` | medium | hookrisk |

### F1 · 🟠 High · `beforeInitialize` is callable by anyone, not only the PoolManager

HS-01 `unprotected-hook-callback` · `src/CorkHook.sol:97` · confidence **high**

CorkHook.beforeInitialize(address,PoolKey,uint160) (src/CorkHook.sol#97-124) is an IHooks callback (0xdc98354e) that never compares msg.sender against poolManager. Anyone can call it with an arbitrary PoolKey and arbitrary hookData.

Reported by `hookrisk/hookrisk-unprotected-callback`.

### F2 · 🟠 High · `beforeSwap` is callable by anyone, not only the PoolManager

HS-01 `unprotected-hook-callback` · `src/CorkHook.sol:365` · confidence **high**

CorkHook.beforeSwap(address,PoolKey,IPoolManager.SwapParams,bytes) (src/CorkHook.sol#365-378) is an IHooks callback (0x575e24b4) that never compares msg.sender against poolManager. Anyone can call it with an arbitrary PoolKey and arbitrary hookData.

Reported by `hookrisk/hookrisk-unprotected-callback`.

### F3 · 🟠 High · `beforeRemoveLiquidity` is declared but has no working implementation

HS-02 `flag-implementation-divergence` · `src/CorkHook.sol:31` · confidence **medium**

CorkHook (src/CorkHook.sol#31-734) declares permission `beforeRemoveLiquidity` (bit 9, BEFORE_REMOVE_LIQUIDITY_FLAG) but provides no working `beforeRemoveLiquidity` implementation. The PoolManager will call it on every matching pool operation and the call will revert, making the pool unusable for that operation.

Reported by `hookrisk/hookrisk-flag-divergence`.

### F4 · 🟡 Medium · `updateBaseFeePercentage` changes hook state and is callable outside a swap

HS-03 `admin-surface` · `src/CorkHook.sol:228` · confidence **medium**

CorkHook.updateBaseFeePercentage(address,address,uint256) (src/CorkHook.sol#228-230) (updateBaseFeePercentage) is restricted to a privileged caller and writes `pool` which the callbacks read. That key can change the swap's economics after deployment: the framework's autonomous-parameter-updates concern.

Reported by `hookrisk/hookrisk-admin-surface`.

### F5 · 🟡 Medium · `updateTreasurySplitPercentage` changes hook state and is callable outside a swap

HS-03 `admin-surface` · `src/CorkHook.sol:232` · confidence **medium**

CorkHook.updateTreasurySplitPercentage(address,address,uint256) (src/CorkHook.sol#232-234) (updateTreasurySplitPercentage) is restricted to a privileged caller and writes `pool` which the callbacks read. That key can change the swap's economics after deployment: the framework's autonomous-parameter-updates concern.

Reported by `hookrisk/hookrisk-admin-surface`.

### F6 · 🟡 Medium · `forwarder` calls out of the swap path mid-swap

HS-05 `external-call-in-swap-path` · `src/CorkHook.sol:385` · confidence **medium**

CorkHook._beforeSwap(PoolState,IPoolManager.SwapParams,bytes,address) (src/CorkHook.sol#385-471) makes a state-changing call to `forwarder` in the swap path (_beforeSwap:442, _beforeSwap:456, _executeFlashSwap:530), reached from beforeSwap. That address is a dependency the pool did not have: a revert or a pause there reverts every swap on every pool using this hook.

Reported by `hookrisk/hookrisk-external-call-in-swap-path`.

### F7 · 🟡 Medium · `owner()` calls out of the swap path mid-swap

HS-05 `external-call-in-swap-path` · `src/CorkHook.sol:473` · confidence **medium**

CorkHook._splitFee(PoolState,uint256,Currency) (src/CorkHook.sol#473-489) makes a static read of `owner()` in the swap path (_splitFee:486), reached from beforeSwap. That address is a dependency the pool did not have: a revert or a pause there reverts every swap on every pool using this hook.

Reported by `hookrisk/hookrisk-external-call-in-swap-path`.

### F8 · 🟡 Medium · `sender` calls out of the swap path mid-swap

HS-05 `external-call-in-swap-path` · `src/CorkHook.sol:513` · confidence **medium**

CorkHook._executeFlashSwap(PoolState,bytes,Currency,Currency,uint256,uint256,address,bool) (src/CorkHook.sol#513-567) makes a state-changing call to `sender` in the swap path (_executeFlashSwap:544), reached from beforeSwap. That address is a dependency the pool did not have: a revert or a pause there reverts every swap on every pool using this hook.

Reported by `hookrisk/hookrisk-external-call-in-swap-path`.

## Classifications

Properties of the hook that change how it is scored or tested. They are informational and never fail the gate.

| Rule | Classification | Applies to | Detail |
| --- | --- | --- | --- |
| HS-07 `custom-accounting` | Custom accounting: the hook can alter settled amounts | `src/CorkHook.sol:31` | CorkHook (src/CorkHook.sol#31-734) declares custom-accounting permissions: `beforeSwapReturnDelta` (bit 3). |
| C-01 `callback-intentionally-disabled` | `beforeAddLiquidity` is disabled by design (deliberate revert) | `src/CorkHook.sol:88` (`beforeAddLiquidity`) | CorkHook.beforeAddLiquidity(address,PoolKey,IPoolManager.ModifyLiquidityParams,bytes) (src/CorkHook.sol#88-95) overrides `beforeAddLiquidity` with `revert DisableNativeLiquidityModification()`, so PoolManager-routed liquidity addition is disabled by design; the differential harness records such reverts when it runs. |

## Hook profile

The static engine’s structural measurement of the contract. Complexity is derived from these metrics; the rule that fired is quoted in the score table’s evidence.

| Metric | Value |
| --- | --- |
| Callbacks implemented (working; deliberate revert-guards are listed as disabled) | 2 |
| Callbacks declared | 4 |
| State writes in callbacks | 4 |
| External calls in the swap path | 5 |
| externalCallsInSwapPathThirdParty | 5 |
| Internal functions reachable from callbacks | 19 |
| Returns a delta | true |
| Owner-only surface | true |
| Permissions declared | `beforeInitialize`, `beforeAddLiquidity`, `beforeRemoveLiquidity`, `beforeSwap`, `beforeSwapReturnDelta` |

## Score

| Dimension | Score | Source | Bracket |
| --- | --- | --- | --- |
| Complexity | 5/5 | measured | Returns a delta, external call in the swap path, and an owner-only surface ᵃ |
| Custom math | 3/5 | measured | A custom curve or invariant function ᵃ |
| External dependencies | 2/3 | measured | A dependency read inside the swap path, or more than one dependency ᵃ |
| External liquidity exposure | — | unmeasured | _unmeasured_ ᵃ |
| TVL potential | 0/5 | declared | Under $100K (experimental or personal project) |
| Team maturity | 3/3 | declared | Unproven: no prior production deployments, or deployments lacking audits and operational rigor; new, anonymous, or no public track record |
| Upgradeability | — | unmeasured | _unmeasured_ ᵃ |
| Autonomous parameter updates | 1/3 | measured | Self-adjusting within hard-coded bounds and a rate limit ᵃ |
| Price impacting behavior | 3/3 | measured | Returns a swap delta (custom curve or NoOp), or adjusts fees without a ceiling ᵃ |

ᵃ Bracket supplied by hookrisk. The framework publishes brackets for only two of its nine dimensions; the rest are our reading of its prose. See [FEEDBACK.md](https://github.com/0xmvercosa/hookrisk/blob/main/FEEDBACK.md) #2.

<details><summary>Evidence per dimension</summary>

- **Complexity**
  - hook-profile metrics: callbacksImplemented=2, callbacksDeclared=4, stateWritesInCallbacks=4, externalCallsInSwapPath=5, externalCallsInSwapPathThirdParty=5, internalFunctionsReachableFromCallbacks=19, usesReturnsDelta=true, hasOwnerOnlyFunctions=true
  - Scored 5 by rule `usesReturnsDelta && externalCallsInSwapPath >= 1 && hasOwnerOnlyFunctions`: Custom settlement, a mid-swap dependency and a privileged surface together are every source of 'multi-step flows' and 'configuration patterns' the prose lists. (hookrisk’s interpretation; the framework publishes no brackets)
  - 1 flag-implementation-divergence finding(s)
  - 2 unprotected-hook-callback finding(s)
  - The hook implements callbacks with non-trivial structure. This establishes a floor only; the measured value comes from the hook-profile metrics when the engine profiled the target.
- **Custom math**
  - 1 custom-accounting finding(s)
  - Custom accounting implies a custom curve or non-standard settlement arithmetic.
- **External dependencies**
  - 3 external-call-in-swap-path finding(s)
  - Scored 2 by rule `always` on forwarder (medium): The framework's 2 bracket verbatim: a dependency read inside the swap path. Unconditional, so a finding whose call kind the detector did not classify also scores 2 — the direction that does not understate risk. (hookrisk’s interpretation; the framework publishes no brackets)
  - An external call inside the swap path reopens the execution environment mid-swap.
- **TVL potential**
  - Declared in hookrisk.toml. hookrisk does not measure tvlPotential.
- **Team maturity**
  - Declared in hookrisk.toml. hookrisk does not measure teamMaturity.
- **Upgradeability**
  - Not measured: no detector for upgradeable-hook (needs blocksec, which did not run); selfdestruct requires blocksec, which did not run.
- **Autonomous parameter updates**
  - 2 admin-surface finding(s)
  - Scored 1 by rule `severityRank >= 2` on updateBaseFeePercentage (medium): HS-03 at MEDIUM is an owner-only mutator (hook-profile.hasOwnerOnlyFunctions). The framework's 0 bracket describes exactly this shape, but scoring 0 would rank a hook whose owner can move the fee level with a hook that has no parameters at all, and source analysis cannot see the owner's guardrails — timelock, ceiling, multisig. 1 records the surface as a floor without asserting autonomy; a team that has a timelock should declare 0 in hookrisk.toml. (hookrisk’s interpretation; the framework publishes no brackets)
  - HS-03 found a state-changing external function on the hook. The framework grades this dimension by the guardrails on a parameter change (bounds, rate limit, gating); an admin surface is where those guardrails would have to live.
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
| Autonomous Parameter Updates or Self-Tuning Hook | `autonomousParameterUpdates >= 1 (is 1)` | hookrisk’s reading |
| Price Impacting Behavior | `priceImpactingBehavior >= 1 (is 3)`, `returns-delta-permission` | hookrisk’s reading |

## Security plan

The strongest requirement across the tier baseline and every fired trigger, with the source of each.

| Action | Strength | Because |
| --- | --- | --- |
| Adversarial and economic simulation | **Required** | `trigger:price-impact` |
| Security audit | **Required** | `tier:medium`, `trigger:external-dependencies` |
| Bug bounty programme | **Required** | `tier:medium`, `trigger:external-dependencies`, `trigger:price-impact` |
| Invariant and stateful fuzz testing | **Required** | `trigger:custom-math`, `trigger:autonomous` |
| Audit by a math and invariants specialist | **Required** | `trigger:custom-math`, `trigger:price-impact` |
| Documented debugging and recovery procedures | **Required** | `trigger:autonomous` |
| Dependency-failure scenario testing | **Required** | `trigger:external-dependencies` |
| Automated static analysis | **Required** | `tier:medium` |
| Minimise or timelock upgradeability | **Required** | `trigger:autonomous` |
| Unit tests covering input-range boundaries | **Required** | `trigger:custom-math` |
| Continuous monitoring with anomaly detection | Strongly recommended | `tier:medium`, `trigger:custom-math`, `trigger:external-dependencies`, `trigger:autonomous` |
| Extended test coverage | Recommended | `tier:medium` |
| Formal verification | Recommended | `trigger:custom-math`, `trigger:price-impact` |
| Second independent audit | Recommended | `tier:medium`, `trigger:autonomous` |

## Dynamic analysis

Differential twin-pool harness: **skipped** (HR-E305). CorkHook's constructor takes 3 argument(s) (address _poolManager, address _lpBase, address owner) and the harness can only derive the IPoolManager on its own. Add [harness] constructorArgs to hookrisk.toml with one value per argument — $poolManager, $currency0, $currency1, $owner, $hook are substituted with the harness's own addresses, anything else is passed literally to `cast abi-encode`. See HR-E305.

| | Invariant | Result | Detail |
| --- | --- | --- | --- |
| ⏭️ | I1 Conservation and solvency | skipped | see the harness status above |
| ⏭️ | I2 No undeclared extraction | skipped | see the harness status above |
| ⏭️ | I3 Exit liveness | skipped | see the harness status above |

## Analysis coverage

| Engine | Status | Findings | Notes |
| --- | --- | --- | --- |
| hookrisk Slither detectors | ok | 11 |  |
| Differential harness (Foundry) | skipped (HR-E305) | 0 | CorkHook's constructor takes 3 argument(s) (address _poolManager, address _lpBase, address owner) and the harness can only derive the IPoolManager on its own. Add [harness] constructorArgs to hookrisk.toml with one value per argument — $poolManager, $currency0, $currency1, $owner, $hook are substituted with the harness's own addresses, anything else is passed literally to `cast abi-encode`. See HR-E305. |

## Warnings

- 2 dimension(s) unmeasured: the tier is between Medium Risk and High Risk. Unmeasured dimensions are excluded from the total, never counted as zero.
- trigger 'holds-liquidity' could not be evaluated: dimension 'externalLiquidityExposure' is unmeasured
- trigger 'upgradeable' could not be evaluated: dimension 'upgradeability' is unmeasured

---

_Generated by [hookrisk](https://github.com/0xmvercosa/hookrisk). The Uniswap Foundation does not review, endorse or certify this report or any score derived from its framework._
