// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Unwrap an ERC-7751 error chain down to the hook's own revert
/// @notice When a hook reverts, the PoolManager does not propagate the reason
/// verbatim — `CustomRevert.bubbleUpAndRevertWith` wraps it as
/// `WrappedError(address target, bytes4 selector, bytes reason, bytes details)`.
/// The raw bytes a caller sees therefore identify v4's wrapper, not the hook's
/// error. Reporting `WrappedError(0x…, 0x21d0ee70, 0x…)` tells a user nothing;
/// reporting `TemporarilyUnavailable()` tells them exactly which branch in
/// their hook rejected the call.
///
/// Shared by the handler (swap and exit reverts) and the fixture (seed and
/// initialise reverts during setUp) so the two cannot drift apart in what they
/// call a root cause.
library RevertReason {
    /// @dev `WrappedError(address,bytes4,bytes,bytes)`.
    bytes4 internal constant WRAPPED_ERROR = 0x90bfb865;

    /// @notice Peel wrappers until the innermost reason is reached.
    /// @dev Decoded by hand rather than with `abi.decode` because a library
    /// cannot guard `abi.decode` with try/catch, and a diagnostic that reverts on
    /// malformed input would replace the hook's error with its own. Every read
    /// is bounds-checked; anything that does not fit is returned as-is, which is
    /// the best available answer. The loop is bounded so an adversarial chain
    /// cannot spin here.
    function rootCause(bytes memory data) internal pure returns (bytes memory) {
        for (uint256 depth = 0; depth < 8; depth++) {
            if (data.length < 4 + 4 * 32 || bytes4(data) != WRAPPED_ERROR) break;

            // Head words sit at offsets 4, 36, 68, 100. The third is the offset
            // of the `reason` tail, relative to the start of the ABI payload
            // (i.e. after the selector).
            uint256 reasonOffset = _word(data, 4 + 2 * 32);
            if (reasonOffset > data.length - 4 || data.length - 4 - reasonOffset < 32) break;
            uint256 reasonLength = _word(data, 4 + reasonOffset);
            if (reasonLength > data.length - 4 - reasonOffset - 32) break;
            if (reasonLength == 0) break;

            bytes memory reason = new bytes(reasonLength);
            uint256 start = 4 + reasonOffset + 32;
            for (uint256 i = 0; i < reasonLength; i++) {
                reason[i] = data[start + i];
            }
            data = reason;
        }
        return data;
    }

    function _word(bytes memory data, uint256 offset) private pure returns (uint256 value) {
        assembly ("memory-safe") {
            value := mload(add(add(data, 0x20), offset))
        }
    }
}
