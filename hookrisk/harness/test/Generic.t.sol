// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {TwinPools} from "./TwinPools.sol";
import {TwinHandler} from "./TwinHandler.sol";

/// @title The differential harness, pointed at an arbitrary hook
/// @notice Everything else in `test/` exercises hooks that live in this
/// repository. This contract is the one `hookrisk scan` drives: it takes the
/// hook under test from the environment, so a user's hook can be assessed
/// without writing a line of Solidity.
///
/// The CLI copies the user's compiled artifact into this project's `out/`
/// directory — Foundry's `deployCodeTo` resolves `File.sol:Contract` against
/// exactly that path — and then sets:
///
///   HOOKRISK_ARTIFACT          `MyHook.sol:MyHook`
///   HOOKRISK_CREATION_CODE     hex creation bytecode (see TwinPools._creationCode)
///   HOOKRISK_FLAGS             decimal OR of the Hooks.*_FLAG constants; 0 asks
///                              the harness to derive them from the runtime code
///   HOOKRISK_RUNTIME_CODE      hex deployed bytecode, consulted when FLAGS is 0
///   HOOKRISK_CONSTRUCTOR_ARGS  hex ABI-encoded constructor arguments with
///                              sentinel addresses (see TwinPools.SENTINEL_*);
///                              empty means `abi.encode(manager)`
///   HOOKRISK_MAX_FEE_BIPS      the declared fee bound from hookrisk.toml
///   HOOKRISK_CUSTOM_CURVE      1 when the hook holds beforeSwapReturnDelta;
///                              overridden when the flags were derived
///   HOOKRISK_RUN_ID            opaque token; `out/hookrisk-run-<id>.json` is
///                              written at the end of setUp with what was decided,
///                              and `out/hookrisk-obs-<id>.jsonl` receives one
///                              line of handler counters per completed sequence
///
/// ## Why a custom curve changes the invariants
///
/// I2 compares output against an otherwise identical pool with no hook. That
/// comparison presumes the hook is a *modifier* of v4's pricing — it takes a
/// fee, it adjusts a delta — so any shortfall beyond the declared fee is
/// extraction.
///
/// A hook holding `beforeSwapReturnDelta` can consume the swap entirely, so the
/// PoolManager skips the concentrated-liquidity math and the hook prices the
/// trade itself. The framework calls this a NoOp swap, and it means the hook is
/// the market maker. Its output *should* differ from a constant-product pool,
/// arbitrarily and by design. Asserting I2 there would report every custom-curve
/// hook as an extractor, which is not a finding, it is a category error — and
/// the kind that trains people to ignore the tool.
///
/// So for those hooks I2 is reported `not-applicable` and price monotonicity
/// takes its place: selling token0 must not raise the price of token0. That
/// holds for any curve worth trading against, custom or not, which is precisely
/// what makes it the right fallback. I1 and I3 are unaffected and still apply.
contract GenericHookInvariants is TwinPools {
    TwinHandler internal handler;

    uint256 internal declaredFeeBips;
    bool internal customCurve;
    bool internal configured;

    uint256 internal totalSupply0;
    uint256 internal totalSupply1;

    /// @dev Allowance for tick rounding and inter-twin price drift. See the note
    /// in HonestFeeHookInvariants; the same reasoning and the same number.
    uint256 internal constant DRIFT_ALLOWANCE_BIPS = 200;

    function setUp() public {
        string memory artifact = vm.envOr("HOOKRISK_ARTIFACT", string(""));
        if (bytes(artifact).length == 0) {
            // No target configured, so there is nothing to fuzz. Skip rather
            // than return: Foundry's invariant runner refuses to start without a
            // target contract and fails with `No contracts to fuzz`, which would
            // make a plain `forge test` over this repository red for a contract
            // that is working exactly as intended. Skipping also keeps these
            // from reading as vacuous passes.
            vm.skip(true);
            return;
        }

        declaredFeeBips = vm.envOr("HOOKRISK_MAX_FEE_BIPS", uint256(0));

        _setUpTwinPools(_specFromEnv(artifact));
        _seedTwins();
        // Direct questions to each callback, before any sequence runs: the
        // campaign only reaches a callback a swap or a position gets to, and
        // several real hooks let neither land. See HookProbes.
        _probeHook();
        // The hook's own permissions win over the CLI's static guess when the
        // harness derived them; `run` holds whichever applied.
        customCurve = run.customCurve;

        handler = new TwinHandler(manager, swapRouter, modifyLiquidityRouter, donateRouter, vanillaKey, hookedKey);
        _fund(address(handler), 1e27);

        totalSupply0 = MockERC20(Currency.unwrap(currency0)).totalSupply();
        totalSupply1 = MockERC20(Currency.unwrap(currency1)).totalSupply();

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = TwinHandler.swapExactIn.selector;
        selectors[1] = TwinHandler.swapExactOut.selector;
        selectors[2] = TwinHandler.addLiquidity.selector;
        selectors[3] = TwinHandler.removeLiquidity.selector;
        selectors[4] = TwinHandler.donate.selector;
        selectors[5] = TwinHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));

        configured = true;

        // Last, so that the file's existence means "setUp succeeded" and its
        // absence means "the run died before any invariant ran".
        _writeRunFile(vm.envOr("HOOKRISK_RUN_ID", string("")));
    }

    // --- I1 -------------------------------------------------------------------

    function invariant_I1_tokensAreConserved() public view {
        if (!configured) return;
        assertEq(_trackedBalance(currency0), totalSupply0, "I1: currency0 not conserved");
        assertEq(_trackedBalance(currency1), totalSupply1, "I1: currency1 not conserved");
    }

    // --- I2, or its replacement ----------------------------------------------

    /// @notice Output never falls short of an unhooked pool by more than the
    /// declared fee. Skipped for custom-curve hooks, where the comparison is
    /// meaningless by construction, and when the hook rejected the seed
    /// position: a hooked pool with no v4 liquidity returns nothing for every
    /// swap, which would read as a 100% skim. That the hook refuses
    /// PoolManager liquidity is reported through the run file instead, where
    /// the CLI can name it for what it is rather than as extraction.
    function invariant_I2_noUndeclaredExtraction() public view {
        if (!configured || customCurve || !run.hookedSeeded) return;
        if (handler.swapsCompared() == 0) return;

        assertLe(
            handler.worstShortfallBips(),
            declaredFeeBips + DRIFT_ALLOWANCE_BIPS,
            "I2: output fell short of an unhooked pool by more than the declared fee allows"
        );
    }

    /// @notice For custom-curve hooks: selling a token must not raise its price.
    ///
    /// Weaker than I2 and deliberately so. It is the strongest statement that
    /// remains true when the hook, rather than v4, decides the price.
    function invariant_I2b_priceIsMonotonic() public view {
        if (!configured || !customCurve) return;
        if (handler.priceChecks() == 0) return;

        assertEq(handler.monotonicityViolations(), 0, "I2b: a swap moved the price in the wrong direction");
    }

    /// @notice A swap that works without the hook must work with it.
    ///
    /// Not asserted when the hook rejected the seed position. A custom-curve
    /// hook that holds its own reserves has none here — the harness cannot
    /// drive a liquidity path it does not know — so its swaps reverting says
    /// nothing about the hook. The run file carries `seeded: hooked-failed`
    /// and the seed revert so the CLI can report the untested surface.
    function invariant_I2_hookDoesNotBlockSwaps() public view {
        if (!configured || !run.hookedSeeded) return;
        assertFalse(handler.hookedSwapReverted(), "I2: swap reverted only on the hooked pool");
    }

    // --- I3 -------------------------------------------------------------------

    function invariant_I3_noExitReverted() public view {
        if (!configured) return;
        assertFalse(handler.exitReverted(), "I3: withdrawing liquidity reverted");
    }

    function afterInvariant() public {
        if (!configured) return;
        uint256 failures = handler.sweepExits();
        // Recorded before the assertions so that a sequence which ends in a
        // trapped exit still leaves its counters behind: the CLI needs them
        // to say how much was exercised, whether or not the invariant held.
        _writeObservationLine(vm.envOr("HOOKRISK_RUN_ID", string("")), handler.observationJson());
        assertEq(failures, 0, "I3: liquidity could not be withdrawn after the sequence");
        assertEq(handler.openPositionCount(), 0, "I3: positions remain open after sweep");
    }

    // --- helpers --------------------------------------------------------------

    function _trackedBalance(Currency currency) internal view returns (uint256) {
        MockERC20 token = MockERC20(Currency.unwrap(currency));
        return token.balanceOf(address(this)) + token.balanceOf(address(handler)) + token.balanceOf(address(manager))
            + token.balanceOf(address(hook)) + token.balanceOf(address(swapRouter))
            + token.balanceOf(address(modifyLiquidityRouter)) + token.balanceOf(address(swapRouterNoChecks))
            + token.balanceOf(address(modifyLiquidityNoChecks)) + token.balanceOf(address(donateRouter))
            + token.balanceOf(address(takeRouter)) + token.balanceOf(address(claimsRouter))
            + token.balanceOf(address(nestedActionRouter)) + token.balanceOf(address(actionsRouter));
    }
}
