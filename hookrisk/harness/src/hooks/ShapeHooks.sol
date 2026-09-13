// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// Harness validation hooks — real-world shapes.
//
// The planted-bug hooks in FeeHooks.sol and TrappingHook.sol prove the
// invariants can see a defect. These prove the harness can *stand up* the hook
// shapes that dominate the ecosystem, each of which used to kill `setUp`
// before any invariant ran:
//
//   DynamicFeeHook           OpenZeppelin BaseDynamicFee: reverts NotDynamicFee
//                            unless the pool is initialised with the dynamic
//                            fee flag. Needs the dynamic-fee retry.
//   LineCurveHook            Holds its own reserves and refuses PoolManager
//                            liquidity, as every constant-sum / v2-on-v4 style
//                            hook does. Needs the tolerated seed failure.
//   ConfiguredHook           Three constructor arguments. Needs sentinel
//                            replacement to be deployed at all.
//   InheritedPermissionsHook Declares nothing itself; getHookPermissions() is
//                            inherited. Needs the harness to derive the flags
//                            from the runtime code rather than trust a static
//                            reading of the file.
//
// None of them is buggy. The tests in HarnessValidation.t.sol assert that each
// gets as far as running swaps, and that the run record says what the harness
// had to do to get there.
// ---------------------------------------------------------------------------

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {BaseDynamicFee} from "@openzeppelin/uniswap-hooks/src/fee/BaseDynamicFee.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

import {FeeTakingBase} from "./FeeHooks.sol";

/// @title A hook that only works on a dynamic-fee pool
/// @notice The smallest possible BaseDynamicFee descendant. Its afterInitialize
/// reverts `NotDynamicFee` on the harness's static 3000 fee, so the harness
/// must retry with `LPFeeLibrary.DYNAMIC_FEE_FLAG`. It then sets a fee lower
/// than the vanilla pool's, so the hooked pool's output should be *better*, and
/// I2 must see no shortfall.
contract DynamicFeeHook is BaseDynamicFee {
    uint24 public constant FEE = 500; // 0.05%, in hundredths of a bip

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function _getFee(PoolKey calldata) internal pure override returns (uint24) {
        return FEE;
    }
}

/// @title A 1:1 custom curve that keeps its own reserves
/// @notice Same shape as v4-core's CustomCurveHook test helper, on
/// OpenZeppelin's BaseHook so it validates its own address like a production
/// hook would. Liquidity through the PoolManager is refused — reserves are
/// whatever tokens the hook holds — and every exact-input swap is priced at
/// exactly one to one by the hook, bypassing v4's curve entirely.
///
/// Two things follow for the harness. The seed position fails, which used to
/// abort the run; and the swap still succeeds without any v4 liquidity, because
/// the hook is the market maker. That is the situation I2b exists for.
contract LineCurveHook is BaseHook {
    using CurrencySettler for Currency;

    error LiquidityGoesThroughTheHook();
    error ExactInputOnly();

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
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4)
    {
        revert LiquidityGoesThroughTheHook();
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (params.amountSpecified >= 0) revert ExactInputOnly();
        uint256 amount = uint256(-params.amountSpecified);
        (Currency input, Currency output) =
            params.zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);

        // Take the whole input, pay the whole output from our own balance.
        poolManager.take(input, address(this), amount);
        output.settle(poolManager, address(this), amount, false);

        // Consume the specified amount so the PoolManager has nothing left to
        // route through its own curve: a NoOp swap.
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(amount)), -int128(int256(amount))), 0);
    }
}

/// @title A hook with a constructor the harness cannot guess
/// @notice `(IPoolManager, address owner, uint256 x)`. Deployable only when
/// the CLI supplies the arguments with sentinels and the harness substitutes
/// the real PoolManager and owner. Otherwise inert: one no-op callback.
contract ConfiguredHook is BaseHook {
    address public immutable owner;
    uint256 public immutable x;

    constructor(IPoolManager _poolManager, address _owner, uint256 _x) BaseHook(_poolManager) {
        owner = _owner;
        x = _x;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
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

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/// @title A hook whose permissions live in a base contract
/// @notice Declares nothing itself. A static reading of this contract finds
/// no `getHookPermissions`, so the CLI sends `HOOKRISK_FLAGS=0` and the runtime
/// code, and the harness asks the code. Charges no fee, so it is also a clean
/// control for I2 once deployed.
contract InheritedPermissionsHook is FeeTakingBase {
    constructor(IPoolManager _poolManager) FeeTakingBase(_poolManager) {}

    function feeBips() public pure override returns (uint128) {
        return 0;
    }
}
