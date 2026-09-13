// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

/// @title Cross-check of the generated Python hook spec against the compiler
/// @notice `scripts/gen_hooks_spec.py` parses v4-core's Solidity with regular
/// expressions to produce `slither_hookrisk/utils/hooks_spec.py`. Regex parsing
/// of a language is a claim, not a proof, so this test asserts the same values
/// through a completely different oracle: solc itself, which computes selectors
/// from the real AST and reads the flag constants from the real library.
///
/// If a v4-core upgrade reorders a struct field, widens a value type, or moves a
/// flag bit, `gen_hooks_spec.py` and this test disagree and CI stops. That is
/// the whole point — the static detectors key off these constants, and a
/// detector keyed off a stale selector fails open, reporting a clean scan for a
/// hook it never actually inspected.
///
/// The literals below are copied from the generated Python module. Regenerate
/// with `make spec`, then update these if and only if this test fails.
contract HooksSpecTest is Test {
    // --- Callback selectors ---------------------------------------------------

    function test_selector_beforeInitialize() public pure {
        assertEq(IHooks.beforeInitialize.selector, bytes4(0xdc98354e));
    }

    function test_selector_afterInitialize() public pure {
        assertEq(IHooks.afterInitialize.selector, bytes4(0x6fe7e6eb));
    }

    function test_selector_beforeAddLiquidity() public pure {
        assertEq(IHooks.beforeAddLiquidity.selector, bytes4(0x259982e5));
    }

    function test_selector_afterAddLiquidity() public pure {
        assertEq(IHooks.afterAddLiquidity.selector, bytes4(0x9f063efc));
    }

    function test_selector_beforeRemoveLiquidity() public pure {
        assertEq(IHooks.beforeRemoveLiquidity.selector, bytes4(0x21d0ee70));
    }

    function test_selector_afterRemoveLiquidity() public pure {
        assertEq(IHooks.afterRemoveLiquidity.selector, bytes4(0x6c2bbe7e));
    }

    function test_selector_beforeSwap() public pure {
        assertEq(IHooks.beforeSwap.selector, bytes4(0x575e24b4));
    }

    function test_selector_afterSwap() public pure {
        assertEq(IHooks.afterSwap.selector, bytes4(0xb47b2fb1));
    }

    function test_selector_beforeDonate() public pure {
        assertEq(IHooks.beforeDonate.selector, bytes4(0xb6a8b0fa));
    }

    function test_selector_afterDonate() public pure {
        assertEq(IHooks.afterDonate.selector, bytes4(0xe1b4af69));
    }

    // --- Permission flag bit positions ---------------------------------------

    function test_flagBits() public pure {
        assertEq(Hooks.BEFORE_INITIALIZE_FLAG, 1 << 13, "BEFORE_INITIALIZE");
        assertEq(Hooks.AFTER_INITIALIZE_FLAG, 1 << 12, "AFTER_INITIALIZE");
        assertEq(Hooks.BEFORE_ADD_LIQUIDITY_FLAG, 1 << 11, "BEFORE_ADD_LIQUIDITY");
        assertEq(Hooks.AFTER_ADD_LIQUIDITY_FLAG, 1 << 10, "AFTER_ADD_LIQUIDITY");
        assertEq(Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG, 1 << 9, "BEFORE_REMOVE_LIQUIDITY");
        assertEq(Hooks.AFTER_REMOVE_LIQUIDITY_FLAG, 1 << 8, "AFTER_REMOVE_LIQUIDITY");
        assertEq(Hooks.BEFORE_SWAP_FLAG, 1 << 7, "BEFORE_SWAP");
        assertEq(Hooks.AFTER_SWAP_FLAG, 1 << 6, "AFTER_SWAP");
        assertEq(Hooks.BEFORE_DONATE_FLAG, 1 << 5, "BEFORE_DONATE");
        assertEq(Hooks.AFTER_DONATE_FLAG, 1 << 4, "AFTER_DONATE");
        assertEq(Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG, 1 << 3, "BEFORE_SWAP_RETURNS_DELTA");
        assertEq(Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG, 1 << 2, "AFTER_SWAP_RETURNS_DELTA");
        assertEq(Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG, 1 << 1, "AFTER_ADD_LIQUIDITY_RETURNS_DELTA");
        assertEq(Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG, 1 << 0, "AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA");
    }

    /// @dev The scanner decodes permissions by masking an address with the low
    /// 14 bits. If v4 ever widens the permission space this assertion breaks,
    /// and every decoded flag set in every manifest we have ever emitted would
    /// have been silently truncated.
    function test_allHookMask() public pure {
        assertEq(Hooks.ALL_HOOK_MASK, uint160((1 << 14) - 1));
    }

    /// @dev Documents the invariant HS-02 depends on: a returns-delta flag is
    /// only meaningful alongside its parent action flag, and v4 rejects the
    /// mismatched address outright rather than ignoring the stray bit.
    function test_returnsDeltaRequiresParentFlag() public pure {
        // beforeSwapReturnDelta without beforeSwap is not a valid hook address.
        address orphan = address(uint160(Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG));
        assertFalse(Hooks.isValidHookAddress(IHooks(orphan), 3000));

        // With the parent flag set, the same permission is accepted.
        address paired = address(uint160(Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.BEFORE_SWAP_FLAG));
        assertTrue(Hooks.isValidHookAddress(IHooks(paired), 3000));
    }
}
