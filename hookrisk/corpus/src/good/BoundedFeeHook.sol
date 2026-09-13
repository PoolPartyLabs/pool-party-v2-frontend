// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// Negative corpus — nothing severe. The controls for HS-03, HS-05 and HS-06.
//
// Each contract is the shape a detector must NOT flag, next to the shape in
// corpus/src/bad it must:
//
//   ClampedFeeHook          The lpFeeOverride is computed from the swap and
//                           clamped with a ternary against a constant before
//                           it is returned; a second pool fee comes from an
//                           immutable and is pushed with updateDynamicLPFee.
//                           HS-06 must stay silent on both sites.
//   ValidatedFeeHook        The fee is caller-supplied but passed through
//                           LPFeeLibrary.validate. HS-06 silent.
//   MetadataOwnerHook       Owner-only `setMetadata` writes nothing a
//                           callback reads: an admin surface that is not an
//                           economic lever. HS-03 silent; the profile still
//                           reports hasOwnerOnlyFunctions true.
//   PoolOnlyCallsHook       The swap path calls the PoolManager and one of
//                           the pool's own currencies (unwrapped to IERC20).
//                           HS-05 silent; the profile counts 2 raw swap-path
//                           calls and 0 third-party ones.
//
// Detector expectation: HS-01, HS-02, HS-03, HS-05, HS-06 silent on all four.
// ---------------------------------------------------------------------------

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

abstract contract SwapOnlyHook is BaseHook {
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
}

/// @title A fee computed from the swap, clamped to a constant ceiling
contract ClampedFeeHook is BaseHook {
    using LPFeeLibrary for uint24;

    uint24 public constant MAX_FEE = 30_000; // 3 %
    uint24 public immutable baseFee;

    constructor(IPoolManager _poolManager, uint24 _baseFee) BaseHook(_poolManager) {
        baseFee = _baseFee;
    }

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

    /// @dev The pool's base fee is fixed at deployment.
    function _afterInitialize(address, PoolKey calldata key, uint160, int24) internal override returns (bytes4) {
        poolManager.updateDynamicLPFee(key, baseFee);
        return IHooks.afterInitialize.selector;
    }

    /// @dev Larger swaps pay more, never more than MAX_FEE.
    function _beforeSwap(address, PoolKey calldata, SwapParams calldata params, bytes calldata)
        internal
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint256 size = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint24 raw = uint24(size / 1e12);
        uint24 fee = raw > MAX_FEE ? MAX_FEE : raw;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}

/// @title A caller-supplied fee validated by v4's own library
contract ValidatedFeeHook is SwapOnlyHook {
    using LPFeeLibrary for uint24;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata hookData)
        internal
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint24 requested = abi.decode(hookData, (uint24));
        requested.validate();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, requested | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}

/// @title An owner whose only power is cosmetic
contract MetadataOwnerHook is SwapOnlyHook, Ownable {
    string public metadataURI;
    mapping(PoolId => uint256) public swaps;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) Ownable(msg.sender) {}

    function setMetadata(string calldata uri) external onlyOwner {
        metadataURI = uri;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        swaps[key.toId()] += 1;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/// @title Swap-path calls that stay inside the pool's trust boundary
contract PoolOnlyCallsHook is SwapOnlyHook {
    mapping(PoolId => uint256) public reserve0;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        poolManager.protocolFeesAccrued(key.currency0);
        reserve0[key.toId()] = IERC20Minimal(Currency.unwrap(key.currency0)).balanceOf(address(poolManager));
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}
