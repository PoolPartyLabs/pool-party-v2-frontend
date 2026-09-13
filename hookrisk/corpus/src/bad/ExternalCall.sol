// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// HS-05 true-positive fixture — an external call in the swap path
//
// The class: beforeSwap/afterSwap, or something they reach, call a contract
// that is neither the PoolManager nor one of the pool's own currencies.
// Every swap on every pool using the hook now depends on that address being
// live, and an unhandled revert there reverts the swap. The framework
// scores it as an external dependency; HookGuard's REVERT_DOS_RISK is the
// same idea with a regex.
//
// One contract, three calls, two of which must be reported and one of which
// must not:
//
//   oracle.latestPrice()          static read, not in a try     -> reported,
//                                 isStatic true, unhandled true
//   rewards.notify(...)           state-changing, inside a try  -> reported,
//                                 isStatic false, unhandled false
//   poolManager.protocolFeesAccrued(key.currency0)
//                                 the PoolManager itself        -> control,
//                                 silent (raw profile count still sees it)
//
// Detector expectation:
//   HS-05  two findings on OracleDependentHook, discriminators `oracle`
//          and `rewards`; the profile reports externalCallsInSwapPath 3 and
//          externalCallsInSwapPathThirdParty 2.
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

interface IPriceOracle {
    function latestPrice() external view returns (uint256);
}

interface IRewards {
    function notify(PoolId id, uint256 amount) external;
}

contract OracleDependentHook is BaseHook {
    IPriceOracle public immutable oracle;
    IRewards public immutable rewards;
    mapping(PoolId => uint256) public lastPrice;

    error StalePrice();

    constructor(IPoolManager _poolManager, IPriceOracle _oracle, IRewards _rewards) BaseHook(_poolManager) {
        oracle = _oracle;
        rewards = _rewards;
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
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // --- VULNERABLE ---------------------------------------------------------
    // A paused or reverting oracle reverts every swap.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint256 price = oracle.latestPrice();
        if (price == 0) revert StalePrice();
        lastPrice[key.toId()] = price;
        // --- CONTROL: the PoolManager is not a third party ------------------
        poolManager.protocolFeesAccrued(key.currency0);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    // --- REPORTED, HANDLED --------------------------------------------------
    // Inside a try: a failure is survivable, but the swap still depends on it.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        try rewards.notify(key.toId(), 1) {} catch {}
        return (IHooks.afterSwap.selector, int128(0));
    }
}
