// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// Harness validation hooks — fee taking.
//
// These exist to test the tester. A differential harness that reports "no
// problems" is worthless until you have watched it report a problem it was
// supposed to find, so the corpus contains hooks with known, deliberate defects
// and CI asserts that the invariants fail on them.
//
//   HonestFeeHook   takes exactly the fee it declares. Must pass I1, I2, I3.
//   SkimmingFeeHook takes more than it declares. Must be caught by I2.
//
// The two differ by one constant. That is the point: the defect this class of
// harness exists to catch is not a crash, it is a number being slightly wrong in
// the operator's favour, on every swap, forever.
//
// Both follow the fee-taking pattern from v4-core's own FeeTakingHook test
// helper (src/test/FeeTakingHook.sol): the fee is charged in the swap's
// unspecified currency, taken from the PoolManager, and reported back as the
// hook's delta.
// ---------------------------------------------------------------------------

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @dev Shared fee-taking body. The subclasses supply the rate.
abstract contract FeeTakingBase is BaseHook {
    using SafeCast for uint256;

    uint128 internal constant TOTAL_BIPS = 10_000;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    /// @notice Basis points actually charged per swap.
    function feeBips() public view virtual returns (uint128);

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        // The fee is charged in whichever currency the swapper did not specify.
        bool specifiedTokenIs0 = (params.amountSpecified < 0 == params.zeroForOne);
        (Currency feeCurrency, int128 swapAmount) =
            specifiedTokenIs0 ? (key.currency1, delta.amount1()) : (key.currency0, delta.amount0());
        if (swapAmount < 0) swapAmount = -swapAmount;

        uint256 feeAmount = (uint128(swapAmount) * feeBips()) / TOTAL_BIPS;
        if (feeAmount == 0) return (IHooks.afterSwap.selector, int128(0));

        poolManager.take(feeCurrency, address(this), feeAmount);
        return (IHooks.afterSwap.selector, feeAmount.toInt128());
    }
}

/// @title A hook that charges exactly what it says it charges
/// @notice The control. `hookrisk.toml` declares `maxFeeBips = 100`, and this
/// hook charges 100. Invariant I2 allows output to fall short of the vanilla
/// pool by at most the declared bound, so this must pass.
contract HonestFeeHook is FeeTakingBase {
    uint128 public constant DECLARED_FEE_BIPS = 100; // 1.00%

    constructor(IPoolManager _poolManager) FeeTakingBase(_poolManager) {}

    function feeBips() public pure override returns (uint128) {
        return DECLARED_FEE_BIPS;
    }
}

/// @title A hook that charges more than it declares
/// @notice The planted bug. Documentation and `hookrisk.toml` say 100 bips; the
/// code takes 350. Nothing reverts, no balance goes negative, and every unit
/// test that only checks "the swap succeeded" passes. The loss shows up only
/// when output is compared against an otherwise identical pool, which is exactly
/// what invariant I2 does.
contract SkimmingFeeHook is FeeTakingBase {
    /// @dev What the hook tells the world it charges.
    uint128 public constant DECLARED_FEE_BIPS = 100; // 1.00%

    /// @dev What it actually charges.
    uint128 public constant ACTUAL_FEE_BIPS = 350; // 3.50%

    constructor(IPoolManager _poolManager) FeeTakingBase(_poolManager) {}

    function feeBips() public pure override returns (uint128) {
        return ACTUAL_FEE_BIPS;
    }
}
