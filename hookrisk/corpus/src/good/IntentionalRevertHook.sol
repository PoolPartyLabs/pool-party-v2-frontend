// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// Negative corpus — HS-02 must stay silent; `hookrisk-disabled-callback` must
// fire, as an informational classification.
//
// The shape: a permission is declared and the delegate is overridden with a
// revert of the hook's own choosing. Four of fourteen real hooks we scanned do
// exactly this (WETHHook `LiquidityNotAllowed()`, v2-on-v4
// `AddLiquidityDirectToHook()`, constant-sum `"No v4 Liquidity allowed"`,
// Orbital `"Use custom removeLiquidity"`): the hook is the market maker,
// liquidity goes through its own deposit function, and the PoolManager-routed
// path is refused on purpose.
//
// Before the classification existed HS-02 reported this at HIGH as "provides no
// working implementation ... making the pool unusable", because the IR shape is
// identical to BaseHook's `HookNotImplemented()` stub. The difference is that
// this revert is written in project source and is not named HookNotImplemented.
//
// Detector expectation:
//   HS-02                       silent (the declaration and the override agree)
//   hookrisk-disabled-callback  fires once, anchored on `_beforeAddLiquidity`,
//                               discriminator "beforeAddLiquidity"
//   HS-01                       silent (guarded through BaseHook)
// ---------------------------------------------------------------------------

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract IntentionalRevertHook is BaseHook {
    /// @dev Liquidity is managed through `deposit`, never through the PoolManager.
    error LiquidityNotAllowed();

    uint256 public totalDeposited;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            // Declared on purpose: the PoolManager must route here so the
            // revert below closes the door.
            beforeAddLiquidity: true,
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

    /// @dev The hook's own liquidity entry point. Stands in for whatever the
    /// real hook does; only its existence matters to the fixture.
    function deposit(uint256 amount) external {
        totalDeposited += amount;
    }

    /// @dev Deliberate refusal, not a missing implementation.
    function _beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4)
    {
        revert LiquidityNotAllowed();
    }
}
