// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// Harness validation hook — exit liveness.
//
// TrappingHook lets liquidity in and, after enough swaps have gone through,
// stops letting it out. Nothing is stolen; the funds are simply unreachable.
//
// This is the shape invariant I3 exists for, and the reason I3 is the invariant
// we care most about. A hook can pass every accounting check ever written —
// deltas conserve, no balance goes negative, the pool is solvent to the wei —
// while a liquidity provider is unable to withdraw. Solvency and liveness are
// different properties and only one of them is usually tested.
//
// The trigger is deliberately state-dependent rather than time-dependent. A
// hook that always reverts on withdrawal is caught by the first unit test anyone
// writes. A hook that starts reverting after the 8th swap is caught by nothing
// short of a stateful sequence, which is what the invariant runner generates.
// ---------------------------------------------------------------------------

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

contract TrappingHook is BaseHook {
    /// @dev Swaps observed per pool. The only state that matters.
    mapping(PoolId => uint256) public swapsSeen;

    /// @dev Withdrawals start failing once this many swaps have happened.
    uint256 public constant TRAP_AFTER_SWAPS = 8;

    /// @dev Deliberately uninformative, the way a real one would be.
    error TemporarilyUnavailable();

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        unchecked {
            swapsSeen[key.toId()] += 1;
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev The trap. Adding liquidity is untouched, so the pool looks healthy
    /// right up until someone tries to leave.
    function _beforeRemoveLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (swapsSeen[key.toId()] >= TRAP_AFTER_SWAPS) revert TemporarilyUnavailable();
        return IHooks.beforeRemoveLiquidity.selector;
    }
}
