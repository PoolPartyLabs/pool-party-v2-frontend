// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// HS-01 true-positive fixture — unvalidated callback caller
//
// This is a minimal reproduction of a vulnerability *class*, not a faithful
// reimplementation of any particular incident. The class: a contract implements
// the IHooks callback surface but does not constrain who may call it. Because
// every callback receives a caller-supplied `PoolKey` and `hookData`, an
// attacker who can call the callback directly gets to drive hook state with a
// pool the hook was never installed on, and with parameters the PoolManager
// would never have produced.
//
// Why this class is worth a dedicated detector:
//   - Dedaub's analysis of the Cork Protocol exploit (May 2025), where a hook
//     callback processed attacker-supplied arguments:
//     https://dedaub.com/blog/cork-protocol-exploit/
//   - BlockSec reach the same conclusion from bytecode with their
//     `UniswapPublicHook` detector: https://github.com/blocksecteam/hookscan
//
// Detector expectation: HS-01 fires on `beforeSwap` and on `afterSwap`.
// It must NOT fire on `beforeAddLiquidity`, which is correctly guarded — a
// detector that flags the whole contract instead of the specific unguarded
// functions is a detector nobody will keep enabled.
// ---------------------------------------------------------------------------

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

contract UnvalidatedCallback {
    IPoolManager public immutable poolManager;

    /// @dev Attacker-reachable accounting: the whole point of the class.
    mapping(PoolId => uint256) public observedVolume;
    mapping(PoolId => uint256) public lastSeenBlock;

    error NotPoolManager();

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    // --- VULNERABLE ---------------------------------------------------------
    // No caller check. Anyone can call this with any PoolKey and move the
    // accounting that the rest of the hook trusts.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        observedVolume[id] += amount;
        lastSeenBlock[id] = block.number;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    // --- VULNERABLE ---------------------------------------------------------
    // Same defect. Present so the fixture proves the detector reports every
    // unguarded callback rather than stopping at the first.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        returns (bytes4, int128)
    {
        lastSeenBlock[key.toId()] = block.number;
        return (IHooks.afterSwap.selector, int128(0));
    }

    // --- SAFE ---------------------------------------------------------------
    // Correctly guarded. HS-01 must stay silent here; this is the in-file
    // false-positive control.
    function beforeAddLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4)
    {
        lastSeenBlock[key.toId()] = block.number;
        return IHooks.beforeAddLiquidity.selector;
    }
}
