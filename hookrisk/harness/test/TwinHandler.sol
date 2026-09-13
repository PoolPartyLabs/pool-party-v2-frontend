// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolDonateTest} from "@uniswap/v4-core/src/test/PoolDonateTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {RevertReason} from "./RevertReason.sol";

/// @title Bounded action generator that keeps two pools in lockstep
/// @notice Foundry's invariant runner calls these functions with fuzzed
/// arguments in random order. Each applies the same operation to the vanilla
/// pool and to the hooked pool, so any disagreement between them is
/// attributable to the hook and nothing else.
///
/// Two properties are load-bearing, and getting either wrong makes the whole
/// differential method produce noise instead of findings:
///
/// **Atomicity.** An operation must land on both pools or neither. An earlier
/// version let liquidity succeed on the vanilla pool while the hook rejected it
/// on the other; the twins then held different reserves and every later swap
/// compared two different markets. The invariant duly fired — at 9735 basis
/// points, against a hook that was behaving perfectly. Every mirrored operation
/// is now wrapped in a state snapshot and rolled back unless both sides succeed.
///
/// **No pranking.** The handler holds the tokens and calls the routers itself.
/// `vm.prank` inside a fuzzed handler is a trap: one revert on a non-try/catch
/// path leaves a `startPrank` dangling and every subsequent call fails with a
/// cheatcode error that has nothing to do with the hook.
contract TwinHandler is CommonBase, StdCheats, StdUtils {
    using StateLibrary for IPoolManager;

    // --- wiring --------------------------------------------------------------

    IPoolManager public immutable manager;
    PoolSwapTest public immutable swapRouter;
    PoolModifyLiquidityTest public immutable liquidityRouter;
    PoolDonateTest public immutable donateRouter;
    address public immutable owner;

    PoolKey internal vanillaKey;
    PoolKey internal hookedKey;
    Currency internal currency0;
    Currency internal currency1;

    // --- configuration -------------------------------------------------------

    /// @dev Swap notionals are kept small relative to seeded liquidity. A swap
    /// that consumes the whole range hits the price limit and returns an amount
    /// governed by the limit rather than by the hook, which is noise.
    uint256 internal constant MAX_SWAP = 1e15;
    uint256 internal constant MIN_SWAP = 1e10;

    uint256 internal constant MAX_LIQUIDITY = 5e17;
    uint256 internal constant MIN_LIQUIDITY = 1e15;

    uint256 internal constant BIPS = 10_000;
    int24 internal constant TICK_SPACING = 60;

    // --- ghost state ---------------------------------------------------------

    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bool open;
    }

    Position[] public positions;

    /// @dev Mirrored swaps the fuzzer asked for, whatever became of them.
    uint256 public swapsAttempted;
    /// @dev Swaps that landed on *both* pools. Attempts the vanilla pool
    /// refused, or the hook reverted, are rolled back and do not count: a
    /// sequence in which nothing landed has exercised nothing, and the
    /// observation log exists so the CLI can tell that apart from a pass.
    uint256 public swapsExecuted;
    uint256 public swapsCompared;
    uint256 public swapsSkipped;
    uint256 public liquidityAdds;
    uint256 public liquidityRemoves;
    /// @dev Positions closed on both pools, by a fuzz action or by the sweep.
    /// `liquidityRemoves` counts only the former.
    uint256 public positionsClosed;
    /// @dev Withdrawals that worked without the hook and failed with it,
    /// mid-sequence or in the sweep. `exitReverted` is the boolean form.
    uint256 public exitFailures;

    /// @dev Worst shortfall of hooked output against vanilla output, in bips.
    /// Invariant I2 reads this.
    uint256 public worstShortfallBips;

    /// @dev Calldata of the swap that produced `worstShortfallBips`, so a
    /// failure reports a reproducible case rather than only a number.
    uint256 public worstShortfallAmount;
    bool public worstShortfallZeroForOne;

    /// @dev A swap that succeeded without the hook and reverted with it.
    bool public hookedSwapReverted;
    bytes public hookedSwapRevertData;

    /// @dev A withdrawal that succeeded without the hook and reverted with it.
    /// Invariant I3 reads this.
    bool public exitReverted;

    /// @dev The hook's own revert, unwrapped. See `_rootCause`.
    bytes public exitRevertData;

    /// @dev The revert exactly as the PoolManager produced it, ERC-7751 wrapper
    /// and all. Kept so a report can show the raw bytes alongside the diagnosis.
    bytes public exitRevertRaw;

    uint256 public cumulativeVanillaOut;
    uint256 public cumulativeHookedOut;

    /// @dev Swaps whose price moved the wrong way on the hooked pool.
    ///
    /// A zeroForOne swap sells token0, so the price of token0 must fall — the
    /// square-root price must not increase. This holds for any AMM worth the
    /// name, including one with an entirely custom curve, which is exactly why
    /// it is the property the harness falls back to when a hook returns its own
    /// deltas and output comparison against an unhooked pool stops being
    /// meaningful. See `docs/INVARIANTS.md`.
    uint256 public monotonicityViolations;
    uint256 public priceChecks;
    uint160 public lastViolationBefore;
    uint160 public lastViolationAfter;
    bool public lastViolationZeroForOne;

    uint256 public donations;

    constructor(
        IPoolManager _manager,
        PoolSwapTest _swapRouter,
        PoolModifyLiquidityTest _liquidityRouter,
        PoolDonateTest _donateRouter,
        PoolKey memory _vanillaKey,
        PoolKey memory _hookedKey
    ) {
        manager = _manager;
        swapRouter = _swapRouter;
        liquidityRouter = _liquidityRouter;
        donateRouter = _donateRouter;
        vanillaKey = _vanillaKey;
        hookedKey = _hookedKey;
        currency0 = _vanillaKey.currency0;
        currency1 = _vanillaKey.currency1;
        owner = msg.sender;

        for (uint256 i = 0; i < 2; i++) {
            MockERC20 token = MockERC20(Currency.unwrap(i == 0 ? currency0 : currency1));
            token.approve(address(_swapRouter), type(uint256).max);
            token.approve(address(_liquidityRouter), type(uint256).max);
            token.approve(address(_donateRouter), type(uint256).max);
        }
    }

    // --- actions -------------------------------------------------------------

    /// @notice Exact-input swap, mirrored across both pools.
    ///
    /// The vanilla result is the counterfactual: what this trade would have
    /// returned with no hook installed. Their difference is the hook's economic
    /// effect, which is what invariant I2 bounds.
    function swapExactIn(uint256 amountSeed, bool zeroForOne) external {
        uint256 amount = bound(amountSeed, MIN_SWAP, MAX_SWAP);
        _mirroredSwap(zeroForOne, -int256(amount), amount);
    }

    /// @notice Exact-output swap, mirrored.
    ///
    /// Worth exercising separately because the specified and unspecified
    /// currencies swap roles, and fee-charging logic keyed on that distinction is
    /// a recurring source of hook bugs.
    function swapExactOut(uint256 amountSeed, bool zeroForOne) external {
        uint256 amount = bound(amountSeed, MIN_SWAP, MAX_SWAP / 4);
        _mirroredSwap(zeroForOne, int256(amount), amount);
    }

    /// @notice Add liquidity to both pools over a fuzzed, spacing-aligned range.
    function addLiquidity(uint256 liquiditySeed, uint256 rangeSeed) external {
        uint128 liquidity = uint128(bound(liquiditySeed, MIN_LIQUIDITY, MAX_LIQUIDITY));
        (int24 tickLower, int24 tickUpper) = _boundRange(rangeSeed);

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)
        });

        uint256 snap = vm.snapshotState();
        if (!_tryModify(vanillaKey, params) || !_tryModify(hookedKey, params)) {
            // Roll back so the pools stay identical. A hook refusing liquidity
            // is not a finding on its own, but letting the twins diverge would
            // corrupt every comparison that follows.
            vm.revertToState(snap);
            return;
        }

        positions.push(Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity, open: true}));
        liquidityAdds += 1;
    }

    /// @notice Withdraw one open position from both pools.
    ///
    /// Exits are attempted here as well as in the final sweep so that they are
    /// interleaved with swaps: a hook that traps funds only in a particular state
    /// would survive a sweep that only ever runs at the end.
    function removeLiquidity(uint256 positionSeed) external {
        if (positions.length == 0) return;
        uint256 index = bound(positionSeed, 0, positions.length - 1);
        Position storage position = positions[index];
        if (!position.open) return;

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            liquidityDelta: -int256(uint256(position.liquidity)),
            salt: bytes32(0)
        });

        uint256 snap = vm.snapshotState();
        bool vanillaOk = _tryModify(vanillaKey, params);
        bool hookedOk = _tryModify(hookedKey, params);

        if (!vanillaOk || !hookedOk) {
            bytes memory reason = _lastRevert;
            vm.revertToState(snap);
            if (vanillaOk && !hookedOk) {
                // Withdrawal works without the hook and fails with it. This is
                // the finding I3 exists for. Recorded after the rollback, not
                // before: `revertToState` would undo the write along with the
                // pool state (see `_mirroredSwap`).
                exitReverted = true;
                exitFailures += 1;
                exitRevertRaw = reason;
                exitRevertData = _rootCause(reason);
            }
            return;
        }

        position.open = false;
        liquidityRemoves += 1;
        positionsClosed += 1;
    }

    /// @notice Donate to both pools.
    ///
    /// Donation is a distinct v4 primitive that pushes tokens into a pool
    /// without a swap or a liquidity change, and it is the callback developers
    /// most often leave unconsidered. Hooks that track volume or accrue rewards
    /// frequently mis-handle it, and the framework calls out donate among the
    /// callbacks a hook must reason about.
    function donate(uint256 amount0Seed, uint256 amount1Seed) external {
        uint256 amount0 = bound(amount0Seed, 0, MAX_SWAP);
        uint256 amount1 = bound(amount1Seed, 0, MAX_SWAP);
        if (amount0 == 0 && amount1 == 0) return;

        uint256 snap = vm.snapshotState();
        if (!_tryDonate(vanillaKey, amount0, amount1) || !_tryDonate(hookedKey, amount0, amount1)) {
            vm.revertToState(snap);
            return;
        }
        donations += 1;
    }

    /// @notice Advance time so time-dependent hook logic is exercised.
    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 7 days));
    }

    // --- final sweep ---------------------------------------------------------

    /// @notice Close every remaining position on the hooked pool.
    /// @dev Restricted to the test contract. Left callable by the fuzzer it
    /// becomes an ordinary action, which both wastes sequence budget and lets a
    /// mid-sequence sweep mask the end-state check `afterInvariant` is for.
    /// @return failures Positions that could not be withdrawn.
    function sweepExits() external returns (uint256 failures) {
        require(msg.sender == owner, "TwinHandler: sweep is not a fuzz action");

        for (uint256 i = 0; i < positions.length; i++) {
            Position storage position = positions[i];
            if (!position.open) continue;

            ModifyLiquidityParams memory params = ModifyLiquidityParams({
                tickLower: position.tickLower,
                tickUpper: position.tickUpper,
                liquidityDelta: -int256(uint256(position.liquidity)),
                salt: bytes32(0)
            });

            if (_tryModify(hookedKey, params)) {
                position.open = false;
                positionsClosed += 1;
            } else {
                failures += 1;
                exitReverted = true;
                exitFailures += 1;
                exitRevertRaw = _lastRevert;
                exitRevertData = _rootCause(_lastRevert);
            }
        }
    }

    function openPositionCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].open) count += 1;
        }
    }

    function positionCount() external view returns (uint256) {
        return positions.length;
    }

    /// @notice This sequence's counters as one JSON object, for the
    /// observation log (`out/hookrisk-obs-<RUN_ID>.jsonl`).
    ///
    /// The invariants read these counters to decide whether they have
    /// anything to assert; the CLI reads them to decide whether a pass meant
    /// anything. An invariant that "held" over a sequence in which no swap
    /// landed and no position was opened has held vacuously, and the only way
    /// for the CLI to know is to be told what the handler actually did. Built
    /// by hand so the field set — the contract with cli/src/harness.ts — is
    /// visible here. `positionsOpened` is `liquidityAdds` under the name the
    /// CLI uses.
    function observationJson() external view returns (string memory) {
        return string.concat(
            '{"swapsExecuted":',
            vm.toString(swapsExecuted),
            ',"swapsCompared":',
            vm.toString(swapsCompared),
            ',"swapsSkipped":',
            vm.toString(swapsSkipped),
            ',"hookedSwapReverted":',
            hookedSwapReverted ? "true" : "false",
            ',"positionsOpened":',
            vm.toString(liquidityAdds),
            ',"positionsClosed":',
            vm.toString(positionsClosed),
            ',"donations":',
            vm.toString(donations),
            ',"priceChecks":',
            vm.toString(priceChecks),
            ',"monotonicityViolations":',
            vm.toString(monotonicityViolations),
            ',"exitFailures":',
            vm.toString(exitFailures),
            "}"
        );
    }

    // --- internals -----------------------------------------------------------

    /// @dev Revert data from the most recent failed router call.
    bytes internal _lastRevert;

    function _mirroredSwap(bool zeroForOne, int256 amountSpecified, uint256 notional) internal {
        swapsAttempted += 1;

        uint256 snap = vm.snapshotState();

        (bool vanillaOk, uint256 vanillaOut) = _trySwap(vanillaKey, zeroForOne, amountSpecified);
        if (!vanillaOk) {
            // The trade is not viable even without a hook — bad price limit,
            // insufficient liquidity. Nothing to learn; roll back.
            vm.revertToState(snap);
            swapsSkipped += 1;
            return;
        }

        uint160 priceBefore = _hookedSqrtPrice();
        (bool hookedOk, uint256 hookedOut) = _trySwap(hookedKey, zeroForOne, amountSpecified);
        if (!hookedOk) {
            // Record *after* rolling back. `revertToState` restores every
            // account, this handler's storage included, so anything written
            // before it is silently undone — which is how the hooked-only
            // swap revert went unrecorded and I2's "hook does not block
            // swaps" could never fire. The reason is copied to memory first
            // for the same rollback to leave it alone.
            bytes memory reason = _lastRevert;
            vm.revertToState(snap);
            hookedSwapReverted = true;
            hookedSwapRevertData = reason;
            return;
        }
        _checkMonotonicity(priceBefore, _hookedSqrtPrice(), zeroForOne);
        swapsExecuted += 1;

        cumulativeVanillaOut += vanillaOut;
        cumulativeHookedOut += hookedOut;

        if (vanillaOut == 0) {
            swapsSkipped += 1;
            return;
        }
        swapsCompared += 1;

        if (hookedOut < vanillaOut) {
            uint256 shortfall = ((vanillaOut - hookedOut) * BIPS) / vanillaOut;
            if (shortfall > worstShortfallBips) {
                worstShortfallBips = shortfall;
                worstShortfallAmount = notional;
                worstShortfallZeroForOne = zeroForOne;
            }
        }
    }

    function _trySwap(PoolKey memory key, bool zeroForOne, int256 amountSpecified)
        internal
        returns (bool ok, uint256 out)
    {
        Currency outputCurrency = zeroForOne ? key.currency1 : key.currency0;
        MockERC20 token = MockERC20(Currency.unwrap(outputCurrency));
        uint256 before = token.balanceOf(address(this));

        try swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        ) {
            uint256 afterBalance = token.balanceOf(address(this));
            return (true, afterBalance > before ? afterBalance - before : 0);
        } catch (bytes memory reason) {
            _lastRevert = reason;
            return (false, 0);
        }
    }

    function _tryModify(PoolKey memory key, ModifyLiquidityParams memory params) internal returns (bool) {
        try liquidityRouter.modifyLiquidity(key, params, "") {
            return true;
        } catch (bytes memory reason) {
            _lastRevert = reason;
            return false;
        }
    }

    function _tryDonate(PoolKey memory key, uint256 amount0, uint256 amount1) internal returns (bool) {
        try donateRouter.donate(key, amount0, amount1, "") {
            return true;
        } catch (bytes memory reason) {
            _lastRevert = reason;
            return false;
        }
    }

    /// @dev Record whether a swap moved the hooked pool's price in the legal
    /// direction. Selling token0 must not raise token0's price.
    function _checkMonotonicity(uint160 before, uint160 afterPrice, bool zeroForOne) internal {
        if (before == 0 || afterPrice == 0) return;
        priceChecks += 1;

        bool violated = zeroForOne ? afterPrice > before : afterPrice < before;
        if (!violated) return;

        monotonicityViolations += 1;
        lastViolationBefore = before;
        lastViolationAfter = afterPrice;
        lastViolationZeroForOne = zeroForOne;
    }

    function _hookedSqrtPrice() internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = manager.getSlot0(hookedKey.toId());
    }

    /// @dev The hook's own revert, with v4's ERC-7751 wrapper peeled off. See
    /// `RevertReason` for why the raw bytes are not what a user needs to see.
    function _rootCause(bytes memory data) internal pure returns (bytes memory) {
        return RevertReason.rootCause(data);
    }

    /// @dev Produce a spacing-aligned tick range around the starting price.
    /// Misaligned ticks revert, which spends the fuzzer's budget on calls that
    /// can never teach us anything.
    function _boundRange(uint256 seed) internal pure returns (int24 tickLower, int24 tickUpper) {
        int24 centre = int24(int256(bound(seed % 21, 0, 20))) - 10;
        int24 width = int24(int256(bound((seed >> 8) % 40 + 1, 1, 40)));

        tickLower = (centre - width) * TICK_SPACING;
        tickUpper = (centre + width) * TICK_SPACING;

        int24 maxTick = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        if (tickLower < -maxTick) tickLower = -maxTick;
        if (tickUpper > maxTick) tickUpper = maxTick;
        if (tickLower >= tickUpper) {
            tickLower = -TICK_SPACING;
            tickUpper = TICK_SPACING;
        }
    }
}
