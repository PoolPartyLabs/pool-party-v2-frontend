// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CommonBase} from "forge-std/Base.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Pool} from "@uniswap/v4-core/src/libraries/Pool.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IProtocolFees} from "@uniswap/v4-core/src/interfaces/IProtocolFees.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {RevertReason} from "./RevertReason.sol";

/// @title Execution probes: call the hook the way the PoolManager would, and the way an attacker would
/// @notice The fuzz campaign only reaches a callback when a swap or a position
/// lands on the hooked pool. Six of the fifteen real hooks the harness was
/// pointed at never got that far — the hook refused liquidity, or every swap
/// reverted — so their callbacks were never executed at all. These probes call
/// each implemented callback directly, before the campaign, so that a hook
/// with no reachable swap path is still asked three questions:
///
///   eoaGuard     does the callback reject a caller that is not the PoolManager?
///   selectors    called as the PoolManager, does it return its own selector?
///   exclusivity  called as the PoolManager with the key of a *different* pool
///                that carries the same hook, does it notice?
///
/// The first two are the executed form of HS-01 and of the "wrong return type"
/// class; the third has no static counterpart anywhere in hookrisk.
///
/// ## Why every probe runs inside `unlock`, and why the unlock always reverts
///
/// A hook callback commonly calls back into the PoolManager — `take`, `settle`,
/// `updateDynamicLPFee` — and every one of those needs the manager unlocked.
/// Called cold, a perfectly good fee-taking `afterSwap` reverts `ManagerLocked`,
/// which says nothing about the hook. So the probe takes the lock itself: it
/// calls `manager.unlock`, and the actual hook call is made from inside
/// `unlockCallback`, which is also exactly how an attacker would drive an
/// unguarded callback — the Cork exploit ran `beforeSwap` from its own
/// unlock callback. The state the hook may change (fees taken, counters
/// bumped, a second pool initialised) must not leak into the fuzz campaign,
/// and the probe must not have to settle whatever the hook took, so the
/// callback ends by *reverting* with the outcome ABI-encoded as the reason.
/// The manager undoes everything and hands the reason back to the probe. One
/// unlock per hook call: each probe sees the same starting state, and the
/// revert is the rollback — no snapshot ids to keep straight.
///
/// The one thing that survives is the classification, which is written to the
/// run record by the fixture.
contract HookProbes is CommonBase, IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;

    /// @dev The stranger. Any address that is not the PoolManager and holds
    /// no code, so the hook cannot mistake it for a router it trusts.
    address public constant STRANGER = address(0xBEEF);

    /// @dev Carries a probe's outcome out of `unlockCallback`. Never a real
    /// failure: it is the return channel of a call that must be rolled back.
    /// `stage` says which step produced `data`: 0 the pool initialisation the
    /// exclusivity probe needs, 1 the hook call itself.
    error ProbeOutcome(uint8 stage, bool ok, bytes data);

    /// @dev What one unlock is asked to do. `initKey` is initialised first
    /// when `init` is set (exclusivity probe); then `call` is sent to `hook`
    /// with `caller` pranked as `msg.sender`.
    struct Request {
        address hook;
        address caller;
        bytes call;
        bool init;
        PoolKey initKey;
    }

    /// @dev The result of one unlock, decoded from the revert.
    struct Outcome {
        uint8 stage;
        bool ok;
        /// @dev Return data when `ok`; otherwise the revert data, ERC-7751
        /// wrappers peeled off so a hook error that came back through the
        /// manager reads the same as one thrown directly.
        bytes data;
    }

    IPoolManager public immutable manager;

    /// @dev Sane, mutually consistent arguments for the hooked pool. Ticks are
    /// multiples of every spacing the harness uses (60 and 120); the swap is
    /// exact-input with a price limit on the correct side; the deltas are
    /// what such a swap plausibly produces. A callback that rejects these on
    /// their merits is reported as it would be for any other revert.
    int24 internal constant TICK_LOWER = -6000;
    int24 internal constant TICK_UPPER = 6000;
    int256 internal constant LIQUIDITY = 1e18;
    int256 internal constant SWAP_AMOUNT = -1e15;
    int128 internal constant SWAP_OUT = 997e12;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    // --- the unlock round trip ------------------------------------------------

    /// @notice Run one probe: optionally initialise a pool, then send `call`
    /// to the hook as `caller`, and roll everything back.
    function probe(Request memory request) public returns (Outcome memory outcome) {
        try manager.unlock(abi.encode(request)) {
            revert("HookProbes: unlock returned; the probe callback must always revert");
        } catch (bytes memory reason) {
            require(
                reason.length >= 4 && bytes4(reason) == ProbeOutcome.selector,
                string.concat("HookProbes: unlock failed outside the probe: ", vm.toString(reason))
            );
            (outcome.stage, outcome.ok, outcome.data) = _decodeOutcome(reason);
        }
    }

    /// @inheritdoc IUnlockCallback
    /// @dev Only ever reached through `probe`; the require keeps a stray
    /// unlocker from using this contract as a free unlock.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "HookProbes: not the manager");
        Request memory request = abi.decode(data, (Request));

        if (request.init) {
            try manager.initialize(request.initKey, SQRT_PRICE_1_1) {}
            catch (bytes memory reason) {
                revert ProbeOutcome(0, false, RevertReason.rootCause(reason));
            }
        }

        // `prank` sets msg.sender for exactly the next call this contract
        // makes, which is the low-level call below; a revert consumes it just
        // the same, so nothing dangles.
        vm.prank(request.caller);
        (bool ok, bytes memory ret) = request.hook.call(request.call);
        revert ProbeOutcome(1, ok, ok ? ret : RevertReason.rootCause(ret));
    }

    function _decodeOutcome(bytes memory reason) internal pure returns (uint8 stage, bool ok, bytes memory data) {
        bytes memory payload = new bytes(reason.length - 4);
        for (uint256 i = 0; i < payload.length; i++) {
            payload[i] = reason[i + 4];
        }
        (stage, ok, data) = abi.decode(payload, (uint8, bool, bytes));
    }

    // --- classification -------------------------------------------------------

    /// @notice How a call from a stranger went, in the run record's words.
    ///
    /// `unguarded`: the call returned. `reverted-other`: it reverted with an
    /// error that belongs to v4-core, or a Panic — the hook may have been
    /// guarded, or may have got as far as the PoolManager and been refused
    /// there; either way not evidence about access control. Anything else —
    /// a custom error, `Error(string)`, an empty revert — is the hook itself
    /// refusing, which is what a guard looks like from outside. That
    /// over-approximates: a hook that rejects the *arguments* with its own
    /// error before checking the caller is also reported `guarded`. The
    /// probe cannot tell those apart, and a false "guarded" only loses a
    /// finding HS-01 still makes statically; a false "unguarded" would
    /// accuse, so the ambiguity is resolved in the hook's favour.
    function classifyEoaGuard(Outcome memory outcome) public pure returns (string memory) {
        if (outcome.ok) return "unguarded";
        if (isV4Error(outcome.data)) return "reverted-other";
        return "guarded";
    }

    /// @notice Whether the callback answered the PoolManager with its own
    /// selector. A short or empty return is `wrong-selector`: the manager
    /// reads the first word and reverts `InvalidHookResponse` on anything but
    /// the selector, so every such callback bricks the operation it guards.
    function classifySelector(Outcome memory outcome, bytes4 expected) public pure returns (string memory) {
        if (!outcome.ok) return "reverted";
        if (outcome.data.length < 32) return "wrong-selector";
        return bytes4(outcome.data) == expected ? "ok" : "wrong-selector";
    }

    /// @notice Errors the hook cannot have thrown itself: v4-core's own, and
    /// the compiler's Panic. A revert with one of these says the call reached
    /// the PoolManager (or tripped over the arguments), not that a guard held.
    /// Kept as a list rather than derived, so a v4-core bump that adds an
    /// error is a one-line diff here.
    function isV4Error(bytes memory data) public pure returns (bool) {
        if (data.length < 4) return false;
        bytes4 s = bytes4(data);
        return s == IPoolManager.CurrencyNotSettled.selector || s == IPoolManager.PoolNotInitialized.selector
            || s == IPoolManager.AlreadyUnlocked.selector || s == IPoolManager.ManagerLocked.selector
            || s == IPoolManager.TickSpacingTooLarge.selector || s == IPoolManager.TickSpacingTooSmall.selector
            || s == IPoolManager.CurrenciesOutOfOrderOrEqual.selector
            || s == IPoolManager.UnauthorizedDynamicLPFeeUpdate.selector
            || s == IPoolManager.SwapAmountCannotBeZero.selector || s == IPoolManager.NonzeroNativeValue.selector
            || s == IPoolManager.MustClearExactPositiveDelta.selector || s == IProtocolFees.ProtocolFeeTooLarge.selector
            || s == IProtocolFees.InvalidCaller.selector || s == IProtocolFees.ProtocolFeeCurrencySynced.selector
            || s == Pool.TicksMisordered.selector || s == Pool.TickLowerOutOfBounds.selector
            || s == Pool.TickUpperOutOfBounds.selector || s == Pool.TickLiquidityOverflow.selector
            || s == Pool.PoolAlreadyInitialized.selector || s == Pool.PriceLimitAlreadyExceeded.selector
            || s == Pool.PriceLimitOutOfBounds.selector || s == Pool.NoLiquidityToReceiveFees.selector
            || s == Pool.InvalidFeeForExactOut.selector || s == LPFeeLibrary.LPFeeTooLarge.selector
            || s == TickMath.InvalidTick.selector || s == TickMath.InvalidSqrtPrice.selector
            || s == Hooks.HookAddressNotValid.selector || s == Hooks.InvalidHookResponse.selector
            || s == Hooks.HookCallFailed.selector || s == Hooks.HookDeltaExceedsSwapAmount.selector
            || s == RevertReason.WRAPPED_ERROR || s == bytes4(0x4e487b71); // Panic(uint256)
    }

    // --- callbacks ------------------------------------------------------------

    /// @dev The ten `IHooks` callbacks in flag order, as the harness names
    /// them everywhere else. Index i corresponds to `CALLBACK_FLAGS[i]`.
    function callbackNames() public pure returns (string[10] memory names) {
        names[0] = "beforeInitialize";
        names[1] = "afterInitialize";
        names[2] = "beforeAddLiquidity";
        names[3] = "afterAddLiquidity";
        names[4] = "beforeRemoveLiquidity";
        names[5] = "afterRemoveLiquidity";
        names[6] = "beforeSwap";
        names[7] = "afterSwap";
        names[8] = "beforeDonate";
        names[9] = "afterDonate";
    }

    function callbackFlags() public pure returns (uint160[10] memory flags) {
        flags[0] = Hooks.BEFORE_INITIALIZE_FLAG;
        flags[1] = Hooks.AFTER_INITIALIZE_FLAG;
        flags[2] = Hooks.BEFORE_ADD_LIQUIDITY_FLAG;
        flags[3] = Hooks.AFTER_ADD_LIQUIDITY_FLAG;
        flags[4] = Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;
        flags[5] = Hooks.AFTER_REMOVE_LIQUIDITY_FLAG;
        flags[6] = Hooks.BEFORE_SWAP_FLAG;
        flags[7] = Hooks.AFTER_SWAP_FLAG;
        flags[8] = Hooks.BEFORE_DONATE_FLAG;
        flags[9] = Hooks.AFTER_DONATE_FLAG;
    }

    function callbackSelectors() public pure returns (bytes4[10] memory selectors) {
        selectors[0] = IHooks.beforeInitialize.selector;
        selectors[1] = IHooks.afterInitialize.selector;
        selectors[2] = IHooks.beforeAddLiquidity.selector;
        selectors[3] = IHooks.afterAddLiquidity.selector;
        selectors[4] = IHooks.beforeRemoveLiquidity.selector;
        selectors[5] = IHooks.afterRemoveLiquidity.selector;
        selectors[6] = IHooks.beforeSwap.selector;
        selectors[7] = IHooks.afterSwap.selector;
        selectors[8] = IHooks.beforeDonate.selector;
        selectors[9] = IHooks.afterDonate.selector;
    }

    /// @notice Well-formed calldata for callback `index` against `key`, with
    /// `sender` as the address the PoolManager would report as the initiator.
    function callbackCalldata(uint256 index, PoolKey memory key, address sender) public pure returns (bytes memory) {
        ModifyLiquidityParams memory add =
            ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: LIQUIDITY, salt: 0});
        ModifyLiquidityParams memory remove =
            ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: -LIQUIDITY, salt: 0});
        SwapParams memory swap = SwapParams({
            zeroForOne: true, amountSpecified: SWAP_AMOUNT, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        BalanceDelta swapDelta = toBalanceDelta(int128(SWAP_AMOUNT), SWAP_OUT);
        BalanceDelta addDelta = toBalanceDelta(-SWAP_OUT, -SWAP_OUT);
        BalanceDelta removeDelta = toBalanceDelta(SWAP_OUT, SWAP_OUT);
        BalanceDelta none = BalanceDeltaLibrary.ZERO_DELTA;

        if (index == 0) return abi.encodeCall(IHooks.beforeInitialize, (sender, key, SQRT_PRICE_1_1));
        if (index == 1) return abi.encodeCall(IHooks.afterInitialize, (sender, key, SQRT_PRICE_1_1, int24(0)));
        if (index == 2) return abi.encodeCall(IHooks.beforeAddLiquidity, (sender, key, add, ""));
        if (index == 3) return abi.encodeCall(IHooks.afterAddLiquidity, (sender, key, add, addDelta, none, ""));
        if (index == 4) return abi.encodeCall(IHooks.beforeRemoveLiquidity, (sender, key, remove, ""));
        if (index == 5) return abi.encodeCall(IHooks.afterRemoveLiquidity, (sender, key, remove, removeDelta, none, ""));
        if (index == 6) return abi.encodeCall(IHooks.beforeSwap, (sender, key, swap, ""));
        if (index == 7) return abi.encodeCall(IHooks.afterSwap, (sender, key, swap, swapDelta, ""));
        if (index == 8) return abi.encodeCall(IHooks.beforeDonate, (sender, key, uint256(1e12), uint256(1e12), ""));
        if (index == 9) return abi.encodeCall(IHooks.afterDonate, (sender, key, uint256(1e12), uint256(1e12), ""));
        revert("HookProbes: no such callback");
    }
}
