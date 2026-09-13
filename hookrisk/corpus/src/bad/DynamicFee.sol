// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// HS-06 true-positive fixture — a dynamic LP fee with no ceiling
//
// The class: the hook sets the pool's LP fee (`updateDynamicLPFee`, or an
// `lpFeeOverride` returned from beforeSwap with OVERRIDE_FEE_FLAG) from a
// value nothing in the contract bounds. The PoolManager only rejects fees
// above 100 %; everything below is the hook's word. Hacken's audit guide
// calls it "excessive or invalid lpFeeOverride"; HookGuard fires the same
// idea on 11 % of real hooks with two regexes. Here the value's provenance
// is traced through SlithIR instead.
//
// Four sources of an unbounded fee, one per contract:
//
//   UnboundedOverrideFeeHook   OpenZeppelin's own `BaseOverrideFeeMock`:
//                              `_fee` set by a public `setFee` with no
//                              check, returned as `_fee | OVERRIDE_FEE_FLAG`.
//                              Also HS-03 High: the setter is unguarded, and
//                              both findings anchor on this contract because
//                              the code lives under lib/.
//   OwnerSetFeeHook            `fee` set by an `onlyOwner` setter, no check.
//                              Also HS-03 Medium.
//   HookDataFeeHook            fee decoded from the swapper's `hookData`.
//   OracleFeeHook              fee read from an external oracle and pushed
//                              with `updateDynamicLPFee` in afterInitialize.
//
// In-file control: BoundedOwnerFeeHook's setter does
// `require(newFee <= MAX_FEE)` against a constant, so HS-06 must stay silent
// on it even though the fee is owner-settable (that is HS-03's Medium, and
// it fires).
//
// Detector expectation:
//   HS-06 on the four unbounded contracts, discriminator = the function
//         that sets or returns the fee; silent on BoundedOwnerFeeHook.
// ---------------------------------------------------------------------------

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {BaseOverrideFeeMock} from "@openzeppelin/uniswap-hooks/src/mocks/fee/BaseOverrideFeeMock.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

interface IFeeOracle {
    function currentFee() external view returns (uint24);
}

/// @dev Shared permissions for the beforeSwap-override shape.
abstract contract OverrideFeeHook is BaseHook {
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

/// @title OpenZeppelin's override-fee mock, as shipped: unguarded, unbounded
contract UnboundedOverrideFeeHook is BaseOverrideFeeMock {
    constructor(IPoolManager _poolManager) BaseOverrideFeeMock(_poolManager) {}
}

/// @title Owner-settable fee, no ceiling
contract OwnerSetFeeHook is OverrideFeeHook, Ownable {
    uint24 public fee;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) Ownable(msg.sender) {}

    // --- VULNERABLE ---------------------------------------------------------
    // The owner can set 1_000_000 (100 %) and the next swap pays it.
    function setFee(uint24 newFee) external onlyOwner {
        fee = newFee;
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}

/// @title Owner-settable fee with a constant ceiling — the in-file control
contract BoundedOwnerFeeHook is OverrideFeeHook, Ownable {
    uint24 public constant MAX_FEE = 10_000; // 1 %
    uint24 public fee;

    error FeeTooHigh();

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) Ownable(msg.sender) {}

    // --- SAFE (for HS-06) ---------------------------------------------------
    function setFee(uint24 newFee) external onlyOwner {
        if (newFee > MAX_FEE) revert FeeTooHigh();
        fee = newFee;
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}

/// @title Fee chosen by the swapper
contract HookDataFeeHook is OverrideFeeHook {
    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    // --- VULNERABLE ---------------------------------------------------------
    // Whoever routes the swap picks the LP fee, including 100 % of it.
    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata hookData)
        internal
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint24 requested = abi.decode(hookData, (uint24));
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, requested | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}

/// @title Fee read from an oracle and pushed to the pool
contract OracleFeeHook is BaseHook {
    IFeeOracle public immutable oracle;

    constructor(IPoolManager _poolManager, IFeeOracle _oracle) BaseHook(_poolManager) {
        oracle = _oracle;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
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

    // --- VULNERABLE ---------------------------------------------------------
    // Whatever the oracle says is the pool's fee; nothing here caps it.
    function _afterInitialize(address, PoolKey calldata key, uint160, int24) internal override returns (bytes4) {
        poolManager.updateDynamicLPFee(key, oracle.currentFee());
        return IHooks.afterInitialize.selector;
    }
}
