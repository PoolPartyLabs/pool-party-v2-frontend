# Hook Risk Report — Counter

Executable assessment against the [Uniswap Hooks Security Framework](https://github.com/uniswapfoundation/security-framework): static detectors, a differential twin-pool harness, and the framework’s scoring rubric. Unmeasured dimensions are excluded from the total, never counted as zero.

## Summary

| | |
| --- | --- |
| Contract | `Counter` in `src/Counter.sol` |
| Compiler | solc 0.8.26 |
| Risk tier | **MEDIUM** 13/33, undetermined up to HIGH 19/33 |
| Gate | ✅ Passed |
| Findings | none · 2 classifications |
| Dimensions | 5 measured · 2 declared · 2 unmeasured |
| Static analysis | ok |
| Differential harness | ok |
| Invariants | ⚠️ I1 inconclusive · ⚠️ I2 inconclusive · ➖ I3 not-applicable |
| Tool | hookrisk 0.1.0, rubric e7e8da52fd5717b6eb4517ea779b766f63148c41 |

> **The tier is a range.** 13/33 is the sum of what could be measured or was declared; 2 dimensions have no detector or declaration. At their maximum the hook would score 19/33 (high). Declare them in `hookrisk.toml` to close the range.

## Findings

No defects. The classifications and the hook profile below describe the hook without accusing it.

## Classifications

Properties of the hook that change how it is scored or tested. They are informational and never fail the gate.

| Rule | Classification | Applies to | Detail |
| --- | --- | --- | --- |
| HS-07 `custom-accounting` | Custom accounting: the hook can alter settled amounts | `src/Counter.sol:18` | Counter (src/Counter.sol#18-127) declares custom-accounting permissions: `beforeSwapReturnDelta` (bit 3). |
| C-01 `callback-intentionally-disabled` | `beforeAddLiquidity` is disabled by design (deliberate revert) | `src/Counter.sol:87` (`beforeAddLiquidity`) | Counter._beforeAddLiquidity(address,PoolKey,IPoolManager.ModifyLiquidityParams,bytes) (src/Counter.sol#87-94) overrides `beforeAddLiquidity` with `revert "No v4 Liquidity allowed"`, so PoolManager-routed liquidity addition is disabled by design; the differential harness records such reverts when it runs. Confirmed by hookrisk and harness. |

## Hook profile

The static engine’s structural measurement of the contract. Complexity is derived from these metrics; the rule that fired is quoted in the score table’s evidence.

| Metric | Value |
| --- | --- |
| Callbacks implemented (working; deliberate revert-guards are listed as disabled) | 1 |
| Callbacks declared | 2 |
| State writes in callbacks | 0 |
| External calls in the swap path | 2 |
| externalCallsInSwapPathThirdParty | 0 |
| Internal functions reachable from callbacks | 3 |
| Returns a delta | true |
| Owner-only surface | false |
| Permissions declared | `beforeAddLiquidity`, `beforeSwap`, `beforeSwapReturnDelta` |

## Score

| Dimension | Score | Source | Bracket |
| --- | --- | --- | --- |
| Complexity | 4/5 | measured | Returns a delta and makes an external call in the swap path ᵃ |
| Custom math | 3/5 | measured | A custom curve or invariant function ᵃ |
| External dependencies | 0/3 | measured | None; the hook touches only the PoolManager and the pair's tokens ᵃ |
| External liquidity exposure | — | unmeasured | _unmeasured_ ᵃ |
| TVL potential | 0/5 | declared | Under $100K (experimental or personal project) |
| Team maturity | 3/3 | declared | Unproven: no prior production deployments, or deployments lacking audits and operational rigor; new, anonymous, or no public track record |
| Upgradeability | — | unmeasured | _unmeasured_ ᵃ |
| Autonomous parameter updates | 0/3 | measured | All parameters set by an explicit privileged call ᵃ |
| Price impacting behavior | 3/3 | measured | Returns a swap delta (custom curve or NoOp), or adjusts fees without a ceiling ᵃ |

ᵃ Bracket supplied by hookrisk. The framework publishes brackets for only two of its nine dimensions; the rest are our reading of its prose. See [FEEDBACK.md](https://github.com/0xmvercosa/hookrisk/blob/main/FEEDBACK.md) #2.

<details><summary>Evidence per dimension</summary>

- **Complexity**
  - hook-profile metrics: callbacksImplemented=1, callbacksDeclared=2, stateWritesInCallbacks=0, externalCallsInSwapPath=2, externalCallsInSwapPathThirdParty=0, internalFunctionsReachableFromCallbacks=3, usesReturnsDelta=true, hasOwnerOnlyFunctions=false
  - Scored 4 by rule `usesReturnsDelta && externalCallsInSwapPath >= 1`: A hook that both alters settled amounts and leaves the swap path mid-flight has two interacting flows to reason about, not one. (hookrisk’s interpretation; the framework publishes no brackets)
  - The hook implements callbacks with non-trivial structure. This establishes a floor only; the measured value comes from the hook-profile metrics when the engine profiled the target.
- **Custom math**
  - 1 custom-accounting finding(s)
  - Custom accounting implies a custom curve or non-standard settlement arithmetic.
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
| Price Impacting Behavior | `priceImpactingBehavior >= 1 (is 3)`, `returns-delta-permission` | hookrisk’s reading |

## Security plan

The strongest requirement across the tier baseline and every fired trigger, with the source of each.

| Action | Strength | Because |
| --- | --- | --- |
| Adversarial and economic simulation | **Required** | `trigger:price-impact` |
| Security audit | **Required** | `tier:medium` |
| Bug bounty programme | **Required** | `tier:medium`, `trigger:price-impact` |
| Audit by a math and invariants specialist | **Required** | `trigger:custom-math`, `trigger:price-impact` |
| Automated static analysis | **Required** | `tier:medium` |
| Unit tests covering input-range boundaries | **Required** | `trigger:custom-math` |
| Extended test coverage | Recommended | `tier:medium` |
| Formal verification | Recommended | `trigger:custom-math` |
| Invariant and stateful fuzz testing | Recommended | `trigger:custom-math` |
| Continuous monitoring with anomaly detection | Recommended | `tier:medium`, `trigger:custom-math` |
| Second independent audit | Optional | `tier:medium` |

## Dynamic analysis

Differential twin-pool harness: **ok**.

| Run | |
| --- | --- |
| Hook address flags | `0x888` (derived from the runtime code) |
| Pricing | custom curve: output comparison replaced by price monotonicity |
| Pool fee | static |
| Initial liquidity | the hook rejected PoolManager liquidity (`0x08c379a0…`) |
| Execution probes | eoa guard held on 2 callback(s); selectors: beforeAddLiquidity=reverted, beforeSwap=reverted; exclusivity not-applicable |

| | Invariant | Result | Detail |
| --- | --- | --- | --- |
| ⚠️ | I1 Conservation and solvency | inconclusive | inconclusive, nothing relevant was observed: 0 swaps landed and 0 positions opened across 1285 sequences; the hook rejected PoolManager liquidity (Error("No v4 Liquidity allowed")) so the pool never traded; a swap that worked without the hook reverted with it in 1285 sequence(s). Observed: 1285 sequence(s), 0 swap(s) landed, 0 compared, 0 price check(s), 0 position(s) opened, 0 closed, 0 donation(s), 1285 hooked-only swap revert(s), 0 exit failure(s). |
| ⚠️ | I2 Price monotonicity (custom curve) | inconclusive | inconclusive, nothing relevant was observed: 0 price checks across 1285 sequences; the hook rejected PoolManager liquidity (Error("No v4 Liquidity allowed")) so the pool never traded; a swap that worked without the hook reverted with it in 1285 sequence(s). Observed: 1285 sequence(s), 0 swap(s) landed, 0 compared, 0 price check(s), 0 position(s) opened, 0 closed, 0 donation(s), 1285 hooked-only swap revert(s), 0 exit failure(s). Output comparison against an unhooked pool does not apply to a custom-curve hook; price monotonicity was asserted instead. |
| ➖ | I3 Exit liveness | not-applicable | PoolManager liquidity is disabled by design: hookrisk classifies beforeAddLiquidity as intentionally disabled and the harness's seed position was rejected with Error("No v4 Liquidity allowed"). No position can exist on the hooked pool, so exit liveness has nothing to assert; liquidity held through the hook's own path is not exercised. The harness opened 0 position(s). |

| Observed | |
| --- | --- |
| Fuzz sequences | 1285 |
| Swaps landed / compared / skipped | 0 / 0 / 0 |
| Swaps that reverted only with the hook | 1285 |
| Positions opened / closed | 0 / 0 |
| Donations | 0 |
| Price checks / monotonicity violations | 0 / 0 |
| Exit failures | 0 |

The harness executed 0 swap(s) (0 compared against the reference pool, 0 skipped), opened 0 and closed 0 position(s), made 0 donation(s) and ran 0 price check(s) over 1285 sequence(s). An invariant with no relevant observations is reported inconclusive, not passed.

## Analysis coverage

| Engine | Status | Findings | Notes |
| --- | --- | --- | --- |
| hookrisk Slither detectors | ok | 3 |  |
| Differential harness (Foundry) | ok | 0 |  |

Permissions resolved by static analysis and derived from the deployed runtime code agree.

## Warnings

- 2 dimension(s) unmeasured: the tier is between Medium Risk and High Risk. Unmeasured dimensions are excluded from the total, never counted as zero.
- trigger 'holds-liquidity' could not be evaluated: dimension 'externalLiquidityExposure' is unmeasured
- trigger 'upgradeable' could not be evaluated: dimension 'upgradeability' is unmeasured

---

_Generated by [hookrisk](https://github.com/0xmvercosa/hookrisk). The Uniswap Foundation does not review, endorse or certify this report or any score derived from its framework._
