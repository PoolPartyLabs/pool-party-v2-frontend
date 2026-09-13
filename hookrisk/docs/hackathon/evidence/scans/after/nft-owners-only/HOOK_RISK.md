# Hook Risk Report — ERC721OwnershipHook

Executable assessment against the [Uniswap Hooks Security Framework](https://github.com/uniswapfoundation/security-framework): static detectors, a differential twin-pool harness, and the framework’s scoring rubric. Unmeasured dimensions are excluded from the total, never counted as zero.

## Summary

| | |
| --- | --- |
| Contract | `ERC721OwnershipHook` in `src/ERC721OwnershipHook.sol` |
| Compiler | solc 0.8.19 |
| Risk tier | **LOW** 3/33, undetermined up to HIGH 28/33 |
| Gate | ❌ Failed (1 reason below) |
| Findings | none · 1 classification |
| Dimensions | 0 measured · 2 declared · 7 unmeasured |
| Static analysis | ok |
| Differential harness | skipped (HR-E305) |
| Invariants | ⏭️ I1 skipped · ⏭️ I2 skipped · ⏭️ I3 skipped |
| Tool | hookrisk 0.1.0, rubric e7e8da52fd5717b6eb4517ea779b766f63148c41 |

> **The tier is a range.** 3/33 is the sum of what could be measured or was declared; 7 dimensions have no detector or declaration. At their maximum the hook would score 28/33 (high). Declare them in `hookrisk.toml` to close the range.

### Why the gate failed

1. engine hookrisk did not analyse the target: it was not recognised as a v4 hook (unsupported ABI), so nothing code-derived was assessed

## Findings

No defects. The classifications and the hook profile below describe the hook without accusing it.

## Classifications

Properties of the hook that change how it is scored or tested. They are informational and never fail the gate.

| Rule | Classification | Applies to | Detail |
| --- | --- | --- | --- |
| C-02 `unsupported-hook-abi` | Hook ABI predates the shipped v4 interface; not analysed | `src/ERC721OwnershipHook.sol:10` | ERC721OwnershipHook (src/ERC721OwnershipHook.sol#10-48) looks like a Uniswap v4 hook but its hook ABI predates the shipped v4 interface (declares the 2023 getHooksCalls(); callbacks with non-current signatures: afterDonate, afterSwap, beforeDonate, beforeSwap; inherits BaseHook without any current-ABI callback). |

## Score

| Dimension | Score | Source | Bracket |
| --- | --- | --- | --- |
| Complexity | — | unmeasured | _unmeasured_ ᵃ |
| Custom math | — | unmeasured | _unmeasured_ ᵃ |
| External dependencies | — | unmeasured | _unmeasured_ ᵃ |
| External liquidity exposure | — | unmeasured | _unmeasured_ ᵃ |
| TVL potential | 0/5 | declared | Under $100K (experimental or personal project) |
| Team maturity | 3/3 | declared | Unproven: no prior production deployments, or deployments lacking audits and operational rigor; new, anonymous, or no public track record |
| Upgradeability | — | unmeasured | _unmeasured_ ᵃ |
| Autonomous parameter updates | — | unmeasured | _unmeasured_ ᵃ |
| Price impacting behavior | — | unmeasured | _unmeasured_ ᵃ |

ᵃ Bracket supplied by hookrisk. The framework publishes brackets for only two of its nine dimensions; the rest are our reading of its prose. See [FEEDBACK.md](https://github.com/0xmvercosa/hookrisk/blob/main/FEEDBACK.md) #2.

<details><summary>Evidence per dimension</summary>

- **Complexity**
  - Not measured: flag-implementation-divergence requires hookrisk; hookrisk ran but did not analyse the target (ERC721OwnershipHook uses a hook ABI hookrisk cannot analyse: ERC721OwnershipHook (src/ERC721OwnershipHook.sol#10-48) looks like a Uniswap v4 hook but its hook ABI predates the shipped v4 interface (declares the 2023 …); unprotected-hook-callback requires hookrisk or blocksec; hookrisk ran but did not analyse the target (ERC721OwnershipHook uses a hook ABI hookrisk cannot analyse: ERC721OwnershipHook (src/ERC721OwnershipHook.sol#10-48) looks like a Uniswap v4 hook but its hook ABI predates the shipped v4 interface (declares the 2023 …).
- **Custom math**
  - Not measured: custom-accounting requires hookrisk; hookrisk ran but did not analyse the target (ERC721OwnershipHook uses a hook ABI hookrisk cannot analyse: ERC721OwnershipHook (src/ERC721OwnershipHook.sol#10-48) looks like a Uniswap v4 hook but its hook ABI predates the shipped v4 interface (declares the 2023 …); no detector for rounding-direction yet.
- **External dependencies**
  - Not measured: external-call-in-swap-path requires hookrisk; hookrisk ran but did not analyse the target (ERC721OwnershipHook uses a hook ABI hookrisk cannot analyse: ERC721OwnershipHook (src/ERC721OwnershipHook.sol#10-48) looks like a Uniswap v4 hook but its hook ABI predates the shipped v4 interface (declares the 2023 …).
- **TVL potential**
  - Declared in hookrisk.toml. hookrisk does not measure tvlPotential.
- **Team maturity**
  - Declared in hookrisk.toml. hookrisk does not measure teamMaturity.
- **Upgradeability**
  - Not measured: no detector for upgradeable-hook (needs blocksec, which did not run); selfdestruct requires blocksec, which did not run.
- **Autonomous parameter updates**
  - Not measured: admin-surface requires hookrisk; hookrisk ran but did not analyse the target (ERC721OwnershipHook uses a hook ABI hookrisk cannot analyse: ERC721OwnershipHook (src/ERC721OwnershipHook.sol#10-48) looks like a Uniswap v4 hook but its hook ABI predates the shipped v4 interface (declares the 2023 …).
- **Price impacting behavior**
  - Not measured: custom-accounting requires hookrisk; hookrisk ran but did not analyse the target (ERC721OwnershipHook uses a hook ABI hookrisk cannot analyse: ERC721OwnershipHook (src/ERC721OwnershipHook.sol#10-48) looks like a Uniswap v4 hook but its hook ABI predates the shipped v4 interface (declares the 2023 …); unbounded-dynamic-fee requires hookrisk; hookrisk ran but did not analyse the target (ERC721OwnershipHook uses a hook ABI hookrisk cannot analyse: ERC721OwnershipHook (src/ERC721OwnershipHook.sol#10-48) looks like a Uniswap v4 hook but its hook ABI predates the shipped v4 interface (declares the 2023 …).

</details>

## Security plan

The strongest requirement across the tier baseline and every fired trigger, with the source of each.

| Action | Strength | Because |
| --- | --- | --- |
| Security audit | **Required** | `tier:low` |
| Automated static analysis | **Required** | `tier:low` |
| Bug bounty programme | Optional | `tier:low` |
| Audit by a math and invariants specialist | Optional | `tier:low` |
| Continuous monitoring with anomaly detection | Optional | `tier:low` |

## Dynamic analysis

Differential twin-pool harness: **skipped** (HR-E305). ERC721OwnershipHook's constructor takes 2 argument(s) (address _poolManager, address _nftContract) and the harness can only derive the IPoolManager on its own. Add [harness] constructorArgs to hookrisk.toml with one value per argument — $poolManager, $currency0, $currency1, $owner, $hook are substituted with the harness's own addresses, anything else is passed literally to `cast abi-encode`. See HR-E305.

| | Invariant | Result | Detail |
| --- | --- | --- | --- |
| ⏭️ | I1 Conservation and solvency | skipped | see the harness status above |
| ⏭️ | I2 No undeclared extraction | skipped | see the harness status above |
| ⏭️ | I3 Exit liveness | skipped | see the harness status above |

## Analysis coverage

| Engine | Status | Findings | Notes |
| --- | --- | --- | --- |
| hookrisk Slither detectors | ok | 1 |  |
| Differential harness (Foundry) | skipped (HR-E305) | 0 | ERC721OwnershipHook's constructor takes 2 argument(s) (address _poolManager, address _nftContract) and the harness can only derive the IPoolManager on its own. Add [harness] constructorArgs to hookrisk.toml with one value per argument — $poolManager, $currency0, $currency1, $owner, $hook are substituted with the harness's own addresses, anything else is passed literally to `cast abi-encode`. See HR-E305. |

## Warnings

- 7 dimension(s) unmeasured: the tier is between Low Risk and High Risk. Unmeasured dimensions are excluded from the total, never counted as zero.
- trigger 'custom-math' could not be evaluated: dimension 'customMath' is unmeasured
- trigger 'holds-liquidity' could not be evaluated: dimension 'externalLiquidityExposure' is unmeasured
- trigger 'external-dependencies' could not be evaluated: dimension 'externalDependencies' is unmeasured
- trigger 'autonomous' could not be evaluated: dimension 'autonomousParameterUpdates' is unmeasured
- trigger 'price-impact' could not be evaluated: dimension 'priceImpactingBehavior' is unmeasured
- trigger 'upgradeable' could not be evaluated: dimension 'upgradeability' is unmeasured

---

_Generated by [hookrisk](https://github.com/0xmvercosa/hookrisk). The Uniswap Foundation does not review, endorse or certify this report or any score derived from its framework._
