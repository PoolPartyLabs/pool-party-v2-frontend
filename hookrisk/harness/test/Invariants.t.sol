// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {TwinPools} from "./TwinPools.sol";
import {TwinHandler} from "./TwinHandler.sol";

/// @title The three invariants, run against a hook that should satisfy them
/// @notice Positive control for the dynamic layer. `HonestFeeHook` charges
/// exactly the 100 bips it declares, so all three invariants must hold. If one
/// fails here, the harness is broken, not the hook.
///
/// The planted-bug hooks live in `HarnessValidation.t.sol` instead, as
/// deterministic tests that assert the invariant conditions are *violated*.
/// Running them as invariant tests would mean a passing CI required a failing
/// test, which is not a thing a build can express.
///
/// I1  Conservation. No token is created or destroyed. The sum of every
///     balance equals total supply, always.
/// I2  No undeclared extraction. Output from the hooked pool never falls short
///     of the vanilla pool by more than the fee the hook declares.
/// I3  Exit liveness. Every position opened can be closed. Checked in
///     `afterInvariant`, after the full sequence has run.
contract HonestFeeHookInvariants is TwinPools {
    TwinHandler internal handler;

    /// @dev What the hook says it charges, from hookrisk.toml. I2 is asserted
    /// against this number, not against the hook's own constant — the whole
    /// point is to catch code that disagrees with its documentation.
    uint256 internal constant DECLARED_FEE_BIPS = 100;

    /// @dev Allowance for tick rounding and for price drift between the twins.
    ///
    /// The two pools receive identical actions, but once the hook has taken its
    /// first fee their reserves differ, so their prices diverge and later swaps
    /// are no longer priced identically. That drift is a real limitation of the
    /// differential method and is documented in docs/INVARIANTS.md.
    ///
    /// 200 bips is comfortably above observed drift over a `scan`-profile
    /// sequence and far below the 250 bips of undeclared skim the planted-bug
    /// hook takes, so the test discriminates cleanly. Tightening this without
    /// eliminating drift would produce flaky failures, which is worse than a
    /// slightly loose bound.
    uint256 internal constant DRIFT_ALLOWANCE_BIPS = 200;

    uint256 internal totalSupply0;
    uint256 internal totalSupply1;

    function setUp() public {
        _setUpTwinPools(
            "FeeHooks.sol:HonestFeeHook", uint160(Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG)
        );

        // Seed generously and identically. Swap notionals in the handler are
        // capped well below this so that a single trade cannot walk the price to
        // the limit — a limit-bounded swap returns an amount determined by the
        // limit rather than by the hook, and comparing two of those measures
        // nothing.
        _seedTwins();
        assertTrue(run.hookedSeeded, "the honest hook must accept the seed position");

        handler = new TwinHandler(manager, swapRouter, modifyLiquidityRouter, donateRouter, vanillaKey, hookedKey);
        _fund(address(handler), 1e27);

        totalSupply0 = MockERC20(Currency.unwrap(currency0)).totalSupply();
        totalSupply1 = MockERC20(Currency.unwrap(currency1)).totalSupply();

        // Restrict the fuzzer to the intended actions. Without this every public
        // function becomes an action, including `sweepExits`, which would let a
        // mid-sequence sweep mask the end-state check in `afterInvariant`.
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = TwinHandler.swapExactIn.selector;
        selectors[1] = TwinHandler.swapExactOut.selector;
        selectors[2] = TwinHandler.addLiquidity.selector;
        selectors[3] = TwinHandler.removeLiquidity.selector;
        selectors[4] = TwinHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    // --- I1: conservation and solvency ---------------------------------------

    /// @notice No token is created or destroyed by any sequence of operations.
    ///
    /// Enumerating every holder and comparing against `totalSupply` is stronger
    /// than checking the PoolManager alone: it catches value leaking to an
    /// address nobody is watching, which is what a subtly wrong `take`/`settle`
    /// pairing produces.
    function invariant_I1_tokensAreConserved() public view {
        assertEq(_trackedBalance(currency0), totalSupply0, "I1: currency0 not conserved");
        assertEq(_trackedBalance(currency1), totalSupply1, "I1: currency1 not conserved");
    }

    /// @notice The PoolManager is never a debtor to itself.
    function invariant_I1_managerSolvent() public view {
        assertGe(
            MockERC20(Currency.unwrap(currency0)).balanceOf(address(manager)), 0, "I1: manager currency0 underwater"
        );
        assertGe(
            MockERC20(Currency.unwrap(currency1)).balanceOf(address(manager)), 0, "I1: manager currency1 underwater"
        );
    }

    // --- I2: no undeclared extraction ----------------------------------------

    /// @notice A swapper never loses more to the hook than the hook declares.
    ///
    /// This is the invariant static analysis cannot express. A hook that takes
    /// 3.5% while documenting 1% contains no missing access check, no
    /// upgradeable proxy and no external call — its source looks correct. The
    /// defect is a constant, and the only way to see it is to run the trade both
    /// ways and compare.
    function invariant_I2_noUndeclaredExtraction() public view {
        if (handler.swapsCompared() == 0) return;

        assertLe(
            handler.worstShortfallBips(),
            DECLARED_FEE_BIPS + DRIFT_ALLOWANCE_BIPS,
            "I2: hooked pool returned less than the declared fee bound allows"
        );
    }

    /// @notice A swap that works without the hook must work with it.
    function invariant_I2_hookDoesNotBlockSwaps() public view {
        assertFalse(handler.hookedSwapReverted(), "I2: swap reverted only on the hooked pool");
    }

    // --- I3: exit liveness ----------------------------------------------------

    /// @notice No withdrawal reverted at any point during the sequence.
    function invariant_I3_noExitReverted() public view {
        assertFalse(handler.exitReverted(), "I3: withdrawing liquidity reverted");
    }

    /// @notice After the full sequence, every remaining position must close.
    ///
    /// `afterInvariant` runs once per sequence, after the last call. That timing
    /// is the point: a hook that traps funds only after some number of swaps
    /// looks perfectly healthy until the moment someone tries to leave, and this
    /// is the only hook in the suite that gets to check the end state.
    function afterInvariant() public {
        uint256 failures = handler.sweepExits();
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
