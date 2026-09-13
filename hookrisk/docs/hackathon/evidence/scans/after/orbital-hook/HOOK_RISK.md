# Hook Risk Report — OrbitalHook

Executable assessment against the [Uniswap Hooks Security Framework](https://github.com/uniswapfoundation/security-framework): static detectors, a differential twin-pool harness, and the framework’s scoring rubric. Unmeasured dimensions are excluded from the total, never counted as zero.

## Summary

| | |
| --- | --- |
| Contract | `OrbitalHook` in `src/OrbitalHook.sol` |
| Compiler | solc 0.8.30 |
| Risk tier | **MEDIUM** 14/33, undetermined up to HIGH 20/33 |
| Gate | ✅ Passed |
| Findings | 2 low · 3 classifications |
| Dimensions | 5 measured · 2 declared · 2 unmeasured |
| Static analysis | ok |
| Differential harness | ok |
| Invariants | ⚠️ I1 inconclusive · ⚠️ I2 inconclusive · ➖ I3 not-applicable |
| Tool | hookrisk 0.1.0, rubric e7e8da52fd5717b6eb4517ea779b766f63148c41 |

> **The tier is a range.** 14/33 is the sum of what could be measured or was declared; 2 dimensions have no detector or declaration. At their maximum the hook would score 20/33 (high). Declare them in `hookrisk.toml` to close the range.

## Findings

| # | Severity | Rule | Finding | Location | Confidence | Engines |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | 🔵 Low | HS-03 `admin-surface` | `addLiquidity` changes hook state and is callable outside a swap | `src/OrbitalHook.sol:351` | medium | hookrisk |
| F2 | 🔵 Low | HS-03 `admin-surface` | `removeLiquidity` changes hook state and is callable outside a swap | `src/OrbitalHook.sol:418` | medium | hookrisk |

### F1 · 🔵 Low · `addLiquidity` changes hook state and is callable outside a swap

HS-03 `admin-surface` · `src/OrbitalHook.sol:351` · confidence **medium**

OrbitalHook.addLiquidity(uint256,uint256,uint256,address) (src/OrbitalHook.sol#351-416) (addLiquidity) is a user-facing function — the caller pays for or draws on their own position — that writes `L_SQUARED` which the callbacks read. Permissionless by design for a liquidity path; not an admin surface.

Reported by `hookrisk/hookrisk-admin-surface`.

### F2 · 🔵 Low · `removeLiquidity` changes hook state and is callable outside a swap

HS-03 `admin-surface` · `src/OrbitalHook.sol:418` · confidence **medium**

OrbitalHook.removeLiquidity(uint256,address) (src/OrbitalHook.sol#418-444) (removeLiquidity) is a user-facing function — the caller pays for or draws on their own position — that writes `L_SQUARED` which the callbacks read. Permissionless by design for a liquidity path; not an admin surface.

Reported by `hookrisk/hookrisk-admin-surface`.

## Classifications

Properties of the hook that change how it is scored or tested. They are informational and never fail the gate.

| Rule | Classification | Applies to | Detail |
| --- | --- | --- | --- |
| HS-07 `custom-accounting` | Custom accounting: the hook can alter settled amounts | `src/OrbitalHook.sol:18` | OrbitalHook (src/OrbitalHook.sol#18-476) declares custom-accounting permissions: `beforeSwapReturnDelta` (bit 3). |
| C-01 `callback-intentionally-disabled` | `beforeAddLiquidity` is disabled by design (deliberate revert) | `src/OrbitalHook.sol:325` (`beforeAddLiquidity`) | OrbitalHook._beforeAddLiquidity(address,PoolKey,ModifyLiquidityParams,bytes) (src/OrbitalHook.sol#325-335) overrides `beforeAddLiquidity` with `revert "Use custom addLiquidity"`, so PoolManager-routed liquidity addition is disabled by design; the differential harness records such reverts when it runs. Confirmed by hookrisk and harness. |
| C-01 `callback-intentionally-disabled` | `beforeRemoveLiquidity` is disabled by design (deliberate revert) | `src/OrbitalHook.sol:338` (`beforeRemoveLiquidity`) | OrbitalHook._beforeRemoveLiquidity(address,PoolKey,ModifyLiquidityParams,bytes) (src/OrbitalHook.sol#338-345) overrides `beforeRemoveLiquidity` with `revert "Use custom removeLiquidity"`, so PoolManager-routed liquidity removal is disabled by design; the differential harness records such reverts when it runs. |

## Hook profile

The static engine’s structural measurement of the contract. Complexity is derived from these metrics; the rule that fired is quoted in the score table’s evidence.

| Metric | Value |
| --- | --- |
| Callbacks implemented (working; deliberate revert-guards are listed as disabled) | 1 |
| Callbacks declared | 3 |
| State writes in callbacks | 3 |
| External calls in the swap path | 3 |
| externalCallsInSwapPathThirdParty | 0 |
| Internal functions reachable from callbacks | 8 |
| Returns a delta | true |
| Owner-only surface | false |
| Permissions declared | `beforeAddLiquidity`, `beforeRemoveLiquidity`, `beforeSwap`, `beforeSwapReturnDelta` |

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
| Autonomous parameter updates | 1/3 | measured | Self-adjusting within hard-coded bounds and a rate limit ᵃ |
| Price impacting behavior | 3/3 | measured | Returns a swap delta (custom curve or NoOp), or adjusts fees without a ceiling ᵃ |

ᵃ Bracket supplied by hookrisk. The framework publishes brackets for only two of its nine dimensions; the rest are our reading of its prose. See [FEEDBACK.md](https://github.com/0xmvercosa/hookrisk/blob/main/FEEDBACK.md) #2.

<details><summary>Evidence per dimension</summary>

- **Complexity**
  - hook-profile metrics: callbacksImplemented=1, callbacksDeclared=3, stateWritesInCallbacks=3, externalCallsInSwapPath=3, externalCallsInSwapPathThirdParty=0, internalFunctionsReachableFromCallbacks=8, usesReturnsDelta=true, hasOwnerOnlyFunctions=false
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
  - 2 admin-surface finding(s)
  - Scored 1 by rule `always` on addLiquidity (low): An admin-surface finding below MEDIUM still evidences a parameter surface whose guardrails were not verified; the same floor applies. (hookrisk’s interpretation; the framework publishes no brackets)
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
| Autonomous Parameter Updates or Self-Tuning Hook | `autonomousParameterUpdates >= 1 (is 1)` | hookrisk’s reading |
| Price Impacting Behavior | `priceImpactingBehavior >= 1 (is 3)`, `returns-delta-permission` | hookrisk’s reading |

## Security plan

The strongest requirement across the tier baseline and every fired trigger, with the source of each.

| Action | Strength | Because |
| --- | --- | --- |
| Adversarial and economic simulation | **Required** | `trigger:price-impact` |
| Security audit | **Required** | `tier:medium` |
| Bug bounty programme | **Required** | `tier:medium`, `trigger:price-impact` |
| Invariant and stateful fuzz testing | **Required** | `trigger:custom-math`, `trigger:autonomous` |
| Audit by a math and invariants specialist | **Required** | `trigger:custom-math`, `trigger:price-impact` |
| Documented debugging and recovery procedures | **Required** | `trigger:autonomous` |
| Automated static analysis | **Required** | `tier:medium` |
| Minimise or timelock upgradeability | **Required** | `trigger:autonomous` |
| Unit tests covering input-range boundaries | **Required** | `trigger:custom-math` |
| Continuous monitoring with anomaly detection | Strongly recommended | `tier:medium`, `trigger:custom-math`, `trigger:autonomous` |
| Extended test coverage | Recommended | `tier:medium` |
| Formal verification | Recommended | `trigger:custom-math`, `trigger:price-impact` |
| Second independent audit | Recommended | `tier:medium`, `trigger:autonomous` |

## Dynamic analysis

Differential twin-pool harness: **ok**.

| Run | |
| --- | --- |
| Hook address flags | `0xa88` (derived from the runtime code) |
| Pricing | custom curve: output comparison replaced by price monotonicity |
| Pool fee | static |
| Initial liquidity | the hook rejected PoolManager liquidity (`0x08c379a0…`) |
| Execution probes | eoa guard held on 3 callback(s); selectors: beforeAddLiquidity=reverted, beforeRemoveLiquidity=reverted, beforeSwap=reverted; exclusivity not-applicable |

| | Invariant | Result | Detail |
| --- | --- | --- | --- |
| ⚠️ | I1 Conservation and solvency | inconclusive | inconclusive, nothing relevant was observed: 0 swaps landed and 0 positions opened across 1285 sequences; the hook rejected PoolManager liquidity (Error("Use custom addLiquidity")) so the pool never traded; a swap that worked without the hook reverted with it in 1285 sequence(s). Observed: 1285 sequence(s), 0 swap(s) landed, 0 compared, 0 price check(s), 0 position(s) opened, 0 closed, 0 donation(s), 1285 hooked-only swap revert(s), 0 exit failure(s). |
| ⚠️ | I2 Price monotonicity (custom curve) | inconclusive | inconclusive, nothing relevant was observed: 0 price checks across 1285 sequences; the hook rejected PoolManager liquidity (Error("Use custom addLiquidity")) so the pool never traded; a swap that worked without the hook reverted with it in 1285 sequence(s). Observed: 1285 sequence(s), 0 swap(s) landed, 0 compared, 0 price check(s), 0 position(s) opened, 0 closed, 0 donation(s), 1285 hooked-only swap revert(s), 0 exit failure(s). Output comparison against an unhooked pool does not apply to a custom-curve hook; price monotonicity was asserted instead. |
| ➖ | I3 Exit liveness | not-applicable | PoolManager liquidity is disabled by design: hookrisk classifies beforeAddLiquidity, beforeRemoveLiquidity as intentionally disabled and the harness's seed position was rejected with Error("Use custom addLiquidity"). No position can exist on the hooked pool, so exit liveness has nothing to assert; liquidity held through the hook's own path is not exercised. The harness opened 0 position(s). |

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
| hookrisk Slither detectors | ok | 6 |  |
| Differential harness (Foundry) | ok | 0 |  |

Permissions resolved by static analysis and derived from the deployed runtime code agree.

## Warnings

- 2 dimension(s) unmeasured: the tier is between Medium Risk and High Risk. Unmeasured dimensions are excluded from the total, never counted as zero.
- trigger 'holds-liquidity' could not be evaluated: dimension 'externalLiquidityExposure' is unmeasured
- trigger 'upgradeable' could not be evaluated: dimension 'upgradeability' is unmeasured

---

_Generated by [hookrisk](https://github.com/0xmvercosa/hookrisk). The Uniswap Foundation does not review, endorse or certify this report or any score derived from its framework._
