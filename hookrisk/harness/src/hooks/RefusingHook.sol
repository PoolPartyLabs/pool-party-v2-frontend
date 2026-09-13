// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// Harness validation hook — the hook that cannot be stood up.
//
// RefusingHook declares `beforeInitialize` and reverts in it, unconditionally.
// The twin-pool fixture therefore cannot create the hooked pool with a static
// fee, cannot create it with a dynamic fee either, and `setUp()` reverts before
// a single sequence runs.
//
// That is the point. It is the fixture for the *third* outcome the scan has to
// be able to express, next to "the invariants held" and "the invariants found a
// counterexample":
//
//   the dynamic layer never measured anything.
//
// The failure mode this guards against is the one hookrisk shipped with: a
// harness whose setUp reverted still reported `ok` with three passed
// invariants, because "no counterexample was found" and "nothing was tried"
// look identical from the outside. A hook nobody could execute must come back
// as harness `failed` with I1-I3 `inconclusive` and a non-zero exit — never as
// a clean bill of health. `.github/workflows/dogfood.yml` asserts exactly that
// against this contract.
//
// The revert is a plain custom error rather than a require string so the
// unwrapping in `RevertReason.rootCause` (v4 wraps hook reverts in ERC-7751)
// has a selector to surface, which is what the operator actually needs to see.
// ---------------------------------------------------------------------------

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

contract RefusingHook is BaseHook {
    /// @dev What a hook gated to a factory-created pool would plausibly throw.
    error PoolNotAuthorised();

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev No pool with this hook can ever be created, whatever the fee.
    function _beforeInitialize(address, PoolKey calldata, uint160) internal pure override returns (bytes4) {
        revert PoolNotAuthorised();
    }
}
