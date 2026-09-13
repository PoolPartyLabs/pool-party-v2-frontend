// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// Harness validation hooks — the execution probes.
//
// The fuzz campaign asks whether a hook misprices or traps. The probes in
// test/HookProbes.sol ask three narrower questions of every implemented
// callback, and these fixtures carry one planted answer each so the tests can
// watch each probe fire, and watch it stay silent on the control:
//
//   UnguardedCallbackHook  afterSwap has no caller check and writes state. The
//                          EOA-guard probe must report it `unguarded`, and its
//                          guarded beforeSwap `guarded`. Hand-rolled on IHooks
//                          rather than BaseHook, the way the Cork hook was:
//                          BaseHook's wrappers cannot be overridden without the
//                          modifier, which is exactly why hooks built on it are
//                          not where this defect lives.
//   WrongSelectorHook      beforeSwap returns afterSwap's selector. Every swap
//                          through a pool with this hook reverts
//                          InvalidHookResponse in the PoolManager; the selector
//                          probe must say `wrong-selector` before a swap is
//                          ever attempted.
//   PoolBoundHook          Remembers the first pool it is initialised for and
//                          rejects callbacks carrying any other key. The
//                          exclusivity probe must report `rejected`. The
//                          control for `accepted` is TrappingHook, which keeps
//                          per-pool counters and legitimately serves any pool.
//
// None of these is meant to pass the invariants; they exist so that
// HarnessValidation.t.sol can prove the probes detect.
// ---------------------------------------------------------------------------

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title A hook with one guarded and one unguarded callback
contract UnguardedCallbackHook is IHooks {
    error NotPoolManager();
    error NotImplemented();

    IPoolManager public immutable poolManager;

    /// @dev The state anyone can write. A real hook would keep a TWAP or a
    /// fee accumulator here; what matters is that a stranger can move it.
    uint256 public swapsSeen;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
        Hooks.validateHookPermissions(this, getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Guarded, the way it should be.
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        view
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev The planted defect: no caller check.
    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        returns (bytes4, int128)
    {
        swapsSeen += 1;
        return (IHooks.afterSwap.selector, 0);
    }

    // --- not implemented; the PoolManager never calls these for this address ---

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert NotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert NotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert NotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert NotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert NotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert NotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert NotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert NotImplemented();
    }
}

/// @title A hook whose beforeSwap answers with the wrong selector
/// @notice The class Hacken's guide calls "incorrect return type": the code
/// compiles, the permissions are right, and the PoolManager rejects every
/// swap with `InvalidHookResponse`. The fuzz campaign would see only
/// "hooked swap reverted"; the selector probe names the cause.
contract WrongSelectorHook is BaseHook {
    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev The planted defect: a copy-paste of the wrong selector.
    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (IHooks.afterSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Correct, so the probe's `ok` on one callback and `wrong-selector`
    /// on another are both exercised on one hook.
    function _afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        pure
        override
        returns (bytes4, int128)
    {
        return (IHooks.afterSwap.selector, 0);
    }
}

/// @title A hook that serves exactly the pool it was first initialised for
/// @notice The pattern Hacken's guide recommends: `onlyPoolManager` alone
/// does not stop anyone from creating a second pool with the same hook and
/// a different fee or spacing, so a hook that keeps per-pool assumptions
/// must check the key. This one remembers the first pool and rejects the
/// rest in `beforeSwap`. It still lets the second pool *initialise*, so the
/// exclusivity probe gets as far as the callback and reports `rejected`.
contract PoolBoundHook is BaseHook {
    error NotMyPool();

    PoolId public boundPool;
    bool public bound;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
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

    function _afterInitialize(address, PoolKey calldata key, uint160, int24) internal override returns (bytes4) {
        if (!bound) {
            boundPool = key.toId();
            bound = true;
        }
        return IHooks.afterInitialize.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(boundPool)) revert NotMyPool();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}
