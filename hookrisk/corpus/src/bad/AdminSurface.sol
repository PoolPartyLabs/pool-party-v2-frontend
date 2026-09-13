// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ---------------------------------------------------------------------------
// HS-03 true-positive fixture — the admin surface, in its two shapes
//
// The class: an external function changes what a callback reads. Who may
// call it decides how much of the swap's economics is in a third party's
// hands. Hacken's guide lists the unguarded shape (`updatePool(address)`
// callable by anyone) next to the missing PoolManager check, and the
// owner-only shape ("set swap fees to 100 %") under admin keys; the Uniswap
// Foundation's framework scores the latter as autonomous parameter updates.
//
// Four contracts, one per shape the detector must tell apart in SlithIR:
//
//   OpenAdminHook        `setFee` with no caller check at all.      -> HIGH
//   OwnableAdminHook     OpenZeppelin `Ownable`: `onlyOwner` ->
//                        `_checkOwner()` -> `owner() != _msgSender()`.
//                        Both operands are results of internal calls,
//                        so the comparing node reads neither
//                        `msg.sender` nor `_owner` directly.      -> MEDIUM
//   HandRolledAdminHook  `require(msg.sender == admin)` inline.   -> MEDIUM
//   RoleAdminHook        OpenZeppelin `AccessControl`: `onlyRole` ->
//                        `_checkRole` -> `hasRole` ->
//                        `_roles[role].hasRole[account]`. No `==`
//                        anywhere; the guard is a mapping lookup
//                        keyed by the sender that decides a branch. -> MEDIUM
//
// In-file controls: `OwnableAdminHook.setMetadata` is owner-only but writes
// nothing a callback reads (silent), and OpenZeppelin's own
// `transferOwnership`/`renounceOwnership`/`grantRole` write the owner or
// the role table, which no callback reads (silent).
//
// Detector expectation:
//   HS-03   OpenAdminHook.setFee at High; setFee on the other three at
//           Medium, each naming `feeBips`; nothing on setMetadata.
//   profile hasOwnerOnlyFunctions true on the three guarded contracts
//           (RoleAdminHook is the AccessControl case the profile used to
//           miss), false on OpenAdminHook.
// ---------------------------------------------------------------------------

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @dev Shared shape: `feeBips` is read in `_afterSwap`, so whoever can
/// write it changes what the callback does on the next swap.
abstract contract FeeReadingHook is BaseHook {
    uint24 public feeBips;
    mapping(uint24 => uint256) public swapsAtFee;

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        swapsAtFee[feeBips] += 1;
        return (IHooks.afterSwap.selector, int128(0));
    }
}

/// @title No access control at all
contract OpenAdminHook is FeeReadingHook {
    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    // --- VULNERABLE ---------------------------------------------------------
    // Anyone sets the fee the next swap is accounted at.
    function setFee(uint24 newFee) external {
        feeBips = newFee;
    }
}

/// @title A hook whose fee is set by an OpenZeppelin `Ownable` owner
contract OwnableAdminHook is FeeReadingHook, Ownable {
    string public metadataURI;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) Ownable(msg.sender) {}

    /// @dev The admin surface: only the owner can move the fee.
    function setFee(uint24 newFee) external onlyOwner {
        feeBips = newFee;
    }

    // --- CONTROL ------------------------------------------------------------
    // Owner-only, but no callback reads `metadataURI`: not an economic lever.
    function setMetadata(string calldata uri) external onlyOwner {
        metadataURI = uri;
    }
}

/// @title A hook with a hand-rolled admin check
contract HandRolledAdminHook is FeeReadingHook {
    address public admin;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {
        admin = msg.sender;
    }

    function setFee(uint24 newFee) external {
        require(msg.sender == admin, "not admin");
        feeBips = newFee;
    }
}

/// @title A hook whose fee is set by an `AccessControl` role
contract RoleAdminHook is FeeReadingHook, AccessControl {
    bytes32 public constant FEE_ROLE = keccak256("FEE_ROLE");

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(FEE_ROLE, msg.sender);
    }

    function setFee(uint24 newFee) external onlyRole(FEE_ROLE) {
        feeBips = newFee;
    }
}


/// @dev A custom-curve style liquidity path: anyone may deposit because they
/// pay, anyone may withdraw because it burns their own shares. It writes the
/// reserve the swap reads, so HS-03's unguarded shape would call it an open
/// admin surface; the caller's stake is what makes it a user surface instead.
/// Expected: HS-03 at LOW on both functions, never HIGH.
contract UserLiquidityHook is FeeReadingHook {
    mapping(address => uint256) public shares;
    uint256 public reserve;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function deposit(uint256 amount) external {
        IERC20Minimal(Currency.unwrap(currencyOf())).transferFrom(msg.sender, address(this), amount);
        shares[msg.sender] += amount;
        reserve += amount;
        feeBips = uint24(reserve % 10_000);
    }

    function withdraw(uint256 amount) external {
        shares[msg.sender] -= amount;
        reserve -= amount;
        feeBips = uint24(reserve % 10_000);
    }

    function currencyOf() internal pure returns (Currency) {
        return Currency.wrap(address(0x1234));
    }
}
