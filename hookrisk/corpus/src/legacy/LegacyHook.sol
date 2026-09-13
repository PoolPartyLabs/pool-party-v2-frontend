// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// Legacy corpus — `hookrisk-unsupported-abi` must fire, and nothing else.
//
// This is what a 2023-era v4 hook looks like to the detectors: the permission
// declaration is `getHooksCalls()` returning a `Hooks.Calls` struct, `beforeSwap`
// has no `hookData` parameter and `afterSwap` returns only a selector. None of
// its callbacks match the shipped `IHooks` signatures, so `implemented_callbacks`
// finds nothing, `is_hook_contract` is false, and every HS-xx detector skips it.
//
// Five of fourteen real hooks we scanned are on this interface, and before the
// unsupported-ABI classification existed each of them scanned as "0 findings" —
// indistinguishable from clean. The fixture proves the scan now says it did not
// look.
//
// It does not inherit IHooks or the 2023 BaseHook, which do not compile against
// the pinned v4-core; the local `HookCalls` struct stands in for `Hooks.Calls`.
//
// Detector expectation:
//   hookrisk-unsupported-abi  fires on LegacyHook, citing getHooksCalls() and
//                             the mismatched beforeSwap/afterSwap; on
//                             LegacyAfterInitializeHook, which is the StopLoss
//                             shape (getHooksCalls plus the one callback whose
//                             signature never changed) and must NOT be
//                             mistaken for a current hook that "does not
//                             declare getHookPermissions()"; and on
//                             MixedAbiHook in its partial form, naming
//                             beforeAddLiquidity as the callback it could not
//                             judge.
//   everything else           silent. In particular HS-02 must not report
//                             MixedAbiHook's declared beforeAddLiquidity as
//                             unimplemented: an old signature is not a
//                             missing body.
//
// `HookRegistry` below is the in-file control: named like a hook, holds a
// PoolManager, but declares nothing hook-shaped. The classification must not
// fire on it — the name is not evidence.
// ---------------------------------------------------------------------------

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract LegacyHook {
    /// @dev The 2023 `Hooks.Calls` shape: eight booleans, no returns-delta.
    struct HookCalls {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeModifyPosition;
        bool afterModifyPosition;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
    }

    IPoolManager public immutable poolManager;
    mapping(PoolId => uint256) public swapCount;

    error NotPoolManager();

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    modifier poolManagerOnly() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    function getHooksCalls() public pure returns (HookCalls memory) {
        return HookCalls({
            beforeInitialize: false,
            afterInitialize: false,
            beforeModifyPosition: false,
            afterModifyPosition: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false
        });
    }

    // 2023 signature: no hookData, selector-only return.
    function beforeSwap(address, PoolKey calldata, SwapParams calldata)
        external
        view
        poolManagerOnly
        returns (bytes4)
    {
        return LegacyHook.beforeSwap.selector;
    }

    // 2023 signature: no hookData, selector-only return.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta)
        external
        poolManagerOnly
        returns (bytes4)
    {
        swapCount[key.toId()] += 1;
        return LegacyHook.afterSwap.selector;
    }
}

/// @dev The v4-stoploss shape. `afterInitialize(address,PoolKey,uint160,int24)`
/// has never changed, so this contract passes signature matching on that one
/// callback. Before `legacy_abi_evidence` existed HS-02 then reported it at
/// HIGH for "not declaring getHookPermissions()" — the wrong reason, because
/// it declares the 2023 spelling, and the wrong severity for a scan that could
/// not read it.
contract LegacyAfterInitializeHook {
    IPoolManager public immutable poolManager;
    mapping(PoolId => int24) public tickLowerLasts;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function getHooksCalls() public pure returns (LegacyHook.HookCalls memory) {
        return LegacyHook.HookCalls({
            beforeInitialize: false,
            afterInitialize: true,
            beforeModifyPosition: false,
            afterModifyPosition: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false
        });
    }

    // Current signature — the only one that survived from 2023.
    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick) external returns (bytes4) {
        tickLowerLasts[key.toId()] = tick;
        return LegacyAfterInitializeHook.afterInitialize.selector;
    }

    // 2023 signature.
    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta) external pure returns (bytes4) {
        return LegacyAfterInitializeHook.afterSwap.selector;
    }
}

/// @dev The v2-on-v4 shape: a current-ABI hook in every respect except one
/// callback whose parameter struct predates `salt`. HS-02 must analyse the
/// callbacks that match and leave the mismatched one to the partial
/// unsupported-ABI classification rather than calling it unimplemented.
contract MixedAbiHook is BaseHook {
    /// @dev Mid-2024 `ModifyLiquidityParams`: no `salt` field.
    struct LegacyModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
    }

    error AddLiquidityDirectToHook();

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
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

    // Old signature: overloads BaseHook's beforeAddLiquidity rather than
    // overriding it, exactly as a hook ported half-way would.
    function beforeAddLiquidity(address, PoolKey calldata, LegacyModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert AddLiquidityDirectToHook();
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/// @dev Control: hook-like name, nothing hook-like about it.
contract HookRegistry {
    IPoolManager public immutable poolManager;
    mapping(address => bool) public registered;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function register(address hook) external {
        registered[hook] = true;
    }
}
