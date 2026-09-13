// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {RevertReason} from "./RevertReason.sol";
import {HookProbes} from "./HookProbes.sol";

/// @dev The one function the harness needs from a hook it has never seen: the
/// permissions it claims. Both OpenZeppelin's and v4-periphery's BaseHook
/// expose it with this exact signature.
interface IHookPermissions {
    function getHookPermissions() external pure returns (Hooks.Permissions memory);
}

/// @title Twin-pool test fixture: one pool with the hook, one without
/// @notice The differential method in one sentence: build two pools that are
/// identical in every field except `hooks`, drive both with the same actions,
/// and treat any divergence the hook does not declare as a finding.
///
/// This is what distinguishes the dynamic layer from static analysis. A static
/// analyzer can tell you a hook takes a fee. Only execution can tell you the fee
/// it takes is larger than the fee it documents, because that difference lives
/// in arithmetic, not in structure.
///
/// Everything here is built from v4-core's own test utilities — `Deployers`,
/// `PoolSwapTest`, `PoolModifyLiquidityTest`. There are no mocks of Uniswap
/// components. A mocked PoolManager would let the harness agree with a
/// misunderstanding of v4 rather than with v4.
///
/// ## Degrading loudly
///
/// Real hooks are not shaped like the fixtures in this repository. They demand
/// dynamic fees, take three constructor arguments, refuse PoolManager liquidity
/// because they hold their own reserves. Each of those used to revert inside
/// `setUp`, and a reverting `setUp` produces no invariant results at all, which
/// the CLI could not tell apart from a hook with nothing to report. Every
/// accommodation below therefore records what it did in `run`, and the
/// `GenericHookInvariants` writes that record to disk at the end of `setUp` so
/// the CLI can see exactly what was and was not tested.
abstract contract TwinPools is Test, Deployers {
    using LPFeeLibrary for uint24;

    /// @dev Namespace for mined hook addresses. Any high bits work; these keep
    /// the address visually distinct from token and router addresses in traces.
    uint160 internal constant HOOK_NAMESPACE = uint160(0x4444) << 144;

    /// @dev Where a hook's runtime code is etched to ask it for its permissions
    /// before its real address is known. Cleared again afterwards.
    address internal constant PERMISSIONS_SCRATCH = address(uint160(0x5555) << 144);

    /// @dev Both pools use the same fee tier and spacing so that the only
    /// difference between them is the hook itself.
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    /// @dev Placeholder addresses the CLI puts in `HOOKRISK_CONSTRUCTOR_ARGS`.
    /// The CLI cannot know the PoolManager's address — it does not exist until
    /// `setUp` runs — so it encodes these and the harness substitutes the real
    /// values word-for-word before deployment. Chosen to be unmistakable in a
    /// trace and impossible to collide with by accident.
    address internal constant SENTINEL_MANAGER = address(uint160(0xC0FFEE0001));
    address internal constant SENTINEL_CURRENCY0 = address(uint160(0xC0FFEE0002));
    address internal constant SENTINEL_CURRENCY1 = address(uint160(0xC0FFEE0003));
    address internal constant SENTINEL_OWNER = address(uint160(0xC0FFEE0004));
    address internal constant SENTINEL_HOOK = address(uint160(0xC0FFEE0005));

    /// @notice What to deploy and how. Filled from the environment by the
    /// generic harness and by hand in fixture tests.
    struct HookSpec {
        /// @dev Foundry artifact path, e.g. `FeeHooks.sol:HonestFeeHook`.
        string artifact;
        /// @dev OR of the `Hooks.*_FLAG` constants. 0 means "derive them by
        /// calling `getHookPermissions()` on `runtimeCode`".
        uint160 flags;
        /// @dev Runtime (deployed) bytecode; only consulted when `flags == 0`.
        bytes runtimeCode;
        /// @dev ABI-encoded constructor arguments with sentinels, or empty for
        /// the legacy single-`IPoolManager` constructor.
        bytes constructorArgs;
        /// @dev Whether the hook prices swaps itself (`beforeSwapReturnDelta`).
        /// Overridden by the derived permissions when `flags == 0`.
        bool customCurve;
    }

    /// @notice Everything `setUp` decided that the invariants, and the CLI,
    /// need to know about. Mirrors the run file's fields one to one.
    struct HarnessRun {
        uint160 flags;
        bool customCurve;
        bool dynamicFee;
        bool permissionsDerived;
        bool hookedSeeded;
        bytes hookedSeedRevert;
        /// @dev Set by `_probeHook`; the fields below are meaningful only then.
        bool probed;
        /// @dev Per callback, in `HookProbes.callbackNames()` order; empty for
        /// a callback the hook does not implement.
        string[10] eoaGuard;
        string[10] selectors;
        /// @dev The unwrapped revert behind a `reverted` selector verdict, so
        /// the report can say *why* rather than only that it did.
        bytes[10] selectorReverts;
        string exclusivity;
        /// @dev Why exclusivity is `not-applicable`, when it is.
        string exclusivityReason;
    }

    IHooks internal hook;
    PoolKey internal vanillaKey;
    PoolKey internal hookedKey;
    PoolId internal vanillaId;
    PoolId internal hookedId;

    HarnessRun internal run;

    /// @dev The probe runner, deployed by `_probeHook`; kept so the run-file
    /// writer can ask it for the callback names it classified under.
    HookProbes internal probes;

    /// @dev The seed position both pools receive, so the twins start identical.
    int24 internal constant SEED_TICK_LOWER = -6000;
    int24 internal constant SEED_TICK_UPPER = 6000;
    int256 internal constant SEED_LIQUIDITY = 1e21;

    // --- setup ---------------------------------------------------------------

    /// @notice Stand up the PoolManager, currencies, routers and both pools
    /// for a fixture that lives in this repository and declares its flags.
    function _setUpTwinPools(string memory artifact, uint160 flags) internal {
        _setUpTwinPools(
            HookSpec({artifact: artifact, flags: flags, runtimeCode: "", constructorArgs: "", customCurve: false})
        );
    }

    /// @notice Stand up the PoolManager, currencies, routers and both pools.
    ///
    /// Order matters. Currencies come before the hook because the hook's
    /// constructor arguments may name them (`SENTINEL_CURRENCY0/1`). The hook
    /// comes before the pools because a pool key names the hook.
    function _setUpTwinPools(HookSpec memory spec) internal {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        uint160 flags = spec.flags;
        run.customCurve = spec.customCurve;
        if (flags == 0) {
            Hooks.Permissions memory permissions = _derivePermissions(spec.runtimeCode);
            flags = _flagsOf(permissions);
            // The CLI's static view of `beforeSwapReturnDelta` is a guess from
            // source; the hook's own answer wins.
            run.customCurve = permissions.beforeSwapReturnDelta;
            run.permissionsDerived = true;
            require(
                flags != 0,
                "TwinPools: getHookPermissions() declares no permissions, so the PoolManager would never call the hook"
            );
        }
        run.flags = flags;

        hook = _deployHook(spec.artifact, flags, spec.constructorArgs);

        // Same currencies, same fee, same spacing, same starting price. The
        // hooked pool may end up with a dynamic fee — see `_initHookedPool` —
        // and that is the one field allowed to differ, because v4 forbids a
        // dynamic fee on a pool with no hook.
        (vanillaKey, vanillaId) =
            initPool(currency0, currency1, IHooks(address(0)), POOL_FEE, TICK_SPACING, SQRT_PRICE_1_1);
        (hookedKey, hookedId) = _initHookedPool();
    }

    /// @notice Deploy a hook at an address whose low 14 bits carry `flags`.
    ///
    /// v4 reads permissions from the address, so a hook must live at an address
    /// with the right bit pattern. In production that means grinding a CREATE2
    /// salt, which is slow and irrelevant to what we are testing. `deployCodeTo`
    /// writes the runtime code straight to a chosen address, which is the
    /// standard approach in v4's own test suite.
    ///
    /// @param artifact Foundry artifact path, e.g. `FeeHooks.sol:HonestFeeHook`.
    /// @param flags OR of the `Hooks.*_FLAG` constants the hook declares.
    /// @param constructorArgs ABI-encoded constructor arguments, sentinels
    /// included; empty for the legacy single-`IPoolManager` constructor.
    function _deployHook(string memory artifact, uint160 flags, bytes memory constructorArgs)
        internal
        returns (IHooks)
    {
        address target = address(HOOK_NAMESPACE | flags);

        // Same procedure as forge-std's `deployCodeTo`: etch the creation code
        // at the target, call it to run the constructor, then etch the runtime
        // code it returned. Inlined rather than delegated because the creation
        // code may come from outside this project — see `_creationCode`.
        bytes memory creationCode = _creationCode(artifact);
        vm.etch(target, abi.encodePacked(creationCode, _constructorArgs(constructorArgs, target)));
        (bool ok, bytes memory runtime) = target.call("");
        require(
            ok, string.concat("TwinPools: hook constructor reverted: ", vm.toString(RevertReason.rootCause(runtime)))
        );
        vm.etch(target, runtime);
        return IHooks(target);
    }

    /// @notice Initialise the hooked pool, falling back to a dynamic fee.
    ///
    /// A large share of production hooks — every OpenZeppelin BaseDynamicFee
    /// and BaseOverrideFee descendant, Uniswap's StablePairHook — revert
    /// `NotDynamicFee` in `afterInitialize` when handed a static fee. The vanilla
    /// pool cannot follow: v4 rejects `DYNAMIC_FEE_FLAG` on a pool with no hook.
    /// So the twins differ in fee, and I2's comparison absorbs that: the hooked
    /// pool starts at fee 0 until the hook sets one, which can only make its
    /// output *larger* than the vanilla pool's. A shortfall still means
    /// extraction. The run record says which fee was used so the CLI can say so
    /// too.
    function _initHookedPool() internal returns (PoolKey memory key, PoolId id) {
        (bool ok, bytes memory staticRevert) = _tryInitPool(POOL_FEE);
        if (!ok) {
            bytes memory dynamicRevert;
            (ok, dynamicRevert) = _tryInitPool(LPFeeLibrary.DYNAMIC_FEE_FLAG);
            require(
                ok,
                string.concat(
                    "TwinPools: hooked pool would not initialise. With fee 3000: ",
                    vm.toString(RevertReason.rootCause(staticRevert)),
                    "; with a dynamic fee: ",
                    vm.toString(RevertReason.rootCause(dynamicRevert)),
                    Hooks.isValidHookAddress(hook, POOL_FEE)
                        ? ""
                        : " (the flags do not form a valid hook address; check HOOKRISK_FLAGS against getHookPermissions)"
                )
            );
            run.dynamicFee = true;
        }
        key = PoolKey(
            currency0, currency1, run.dynamicFee ? LPFeeLibrary.DYNAMIC_FEE_FLAG : POOL_FEE, TICK_SPACING, hook
        );
        id = key.toId();

        // The PoolManager already enforced this on the way in; re-checking with
        // the fee actually chosen turns a silent assumption into an assertion,
        // which is the only kind that catches a future refactor.
        require(Hooks.isValidHookAddress(hook, key.fee), "TwinPools: flags do not form a valid hook address");
    }

    function _tryInitPool(uint24 fee) internal returns (bool ok, bytes memory revertData) {
        PoolKey memory key = PoolKey(currency0, currency1, fee, TICK_SPACING, hook);
        try manager.initialize(key, SQRT_PRICE_1_1) {
            return (true, "");
        } catch (bytes memory reason) {
            return (false, reason);
        }
    }

    /// @notice Seed both pools with the same position.
    ///
    /// The hooked seed is allowed to fail. Custom-curve hooks that hold their
    /// own reserves — constant-sum, v2-on-v4, WETH wrappers — reject
    /// PoolManager liquidity on purpose, and a hook that rejects it by mistake
    /// is a finding, not a reason to abandon the run. Either way the harness
    /// records the unwrapped revert and carries on: swaps still run and the
    /// hook prices them, I1 and I2b still apply. No position is invented for
    /// the hooked pool; the run record says it has none.
    ///
    /// The vanilla seed must succeed — it is the counterfactual, and nothing
    /// about it involves the hook, so a failure there is a harness bug.
    function _seedTwins() internal {
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: SEED_TICK_LOWER, tickUpper: SEED_TICK_UPPER, liquidityDelta: SEED_LIQUIDITY, salt: bytes32(0)
        });
        modifyLiquidityRouter.modifyLiquidity(vanillaKey, params, "");

        try modifyLiquidityRouter.modifyLiquidity(hookedKey, params, "") {
            run.hookedSeeded = true;
        } catch (bytes memory reason) {
            run.hookedSeeded = false;
            run.hookedSeedRevert = RevertReason.rootCause(reason);
        }
    }

    // --- probes --------------------------------------------------------------

    /// @notice Ask every implemented callback the three probe questions and
    /// record the answers in `run`. See HookProbes for what each means.
    ///
    /// Runs after the seed so the hooked pool is in the state a callback
    /// expects, and before the handler exists so nothing the probes do can be
    /// mistaken for a sequence; every probe rolls its own effects back.
    function _probeHook() internal {
        probes = new HookProbes(manager);
        uint160[10] memory flags = probes.callbackFlags();
        bytes4[10] memory selectors = probes.callbackSelectors();

        for (uint256 i = 0; i < 10; i++) {
            if (run.flags & flags[i] == 0) continue;
            bytes memory data = probes.callbackCalldata(i, hookedKey, address(probes));

            HookProbes.Outcome memory stranger = probes.probe(_request(probes.STRANGER(), data));
            run.eoaGuard[i] = probes.classifyEoaGuard(stranger);

            HookProbes.Outcome memory asManager = probes.probe(_request(address(manager), data));
            run.selectors[i] = probes.classifySelector(asManager, selectors[i]);
            if (!asManager.ok) run.selectorReverts[i] = asManager.data;
        }

        _probeExclusivity(probes, flags);
        run.probed = true;
    }

    /// @dev Initialise a second pool on the same hook, then drive the first
    /// implemented swap-or-liquidity callback with *that* pool's key.
    ///
    /// Swap callbacks are tried first: a hook that keeps per-pool assumptions
    /// is most likely to check them where the money moves. Only a callback
    /// that *returned* for the hook's own pool under the selector probe is
    /// eligible: a revert on a foreign key proves nothing about the key if
    /// the same call reverts on the right one (a custom curve with no
    /// reserves reverts everywhere). The second pool keeps the hooked pool's
    /// fee and doubles the spacing; if the hook will not take that, the
    /// dynamic-fee retry `_initHookedPool` uses is made too. A hook that lets
    /// no second pool exist at all — a one-shot `beforeInitialize` — has
    /// answered the question by other means, and is `not-applicable` with its
    /// own revert as the reason.
    function _probeExclusivity(HookProbes probes, uint160[10] memory flags) internal {
        (uint256 index, bool anyDrivable) = _exclusivityCandidate(flags);
        if (index == 10) {
            run.exclusivity = "not-applicable";
            run.exclusivityReason = anyDrivable
                ? "every swap or liquidity callback reverts on the hook's own pool, so a revert on a foreign key would prove nothing"
                : "the hook implements no swap or liquidity callback the probe can drive";
            return;
        }

        uint24[2] memory fees = [hookedKey.fee, LPFeeLibrary.DYNAMIC_FEE_FLAG];
        uint256 attempts = hookedKey.fee == LPFeeLibrary.DYNAMIC_FEE_FLAG ? 1 : 2;
        bytes memory lastInitRevert;
        for (uint256 a = 0; a < attempts; a++) {
            HookProbes.Outcome memory outcome = _probeSecondPool(probes, index, fees[a]);
            if (outcome.stage == 0) {
                lastInitRevert = outcome.data;
                continue;
            }
            run.exclusivity = outcome.ok ? "accepted" : "rejected";
            return;
        }
        run.exclusivity = "not-applicable";
        run.exclusivityReason =
            string.concat("a second pool with the same hook would not initialise: ", vm.toString(lastInitRevert));
    }

    /// @dev The first implemented swap-or-liquidity callback that returned
    /// for the hook's own pool; 10 when there is none. `anyDrivable` tells
    /// "none implemented" apart from "all of them revert".
    function _exclusivityCandidate(uint160[10] memory flags) internal view returns (uint256 index, bool anyDrivable) {
        uint256[6] memory order = [uint256(6), 7, 2, 3, 4, 5];
        index = 10;
        for (uint256 i = 0; i < order.length; i++) {
            if (run.flags & flags[order[i]] == 0) continue;
            anyDrivable = true;
            if (keccak256(bytes(run.selectors[order[i]])) == keccak256("ok")) return (order[i], true);
        }
    }

    /// @dev One unlock: initialise a second pool at `fee` with doubled
    /// spacing, then call callback `index` as the manager with its key.
    function _probeSecondPool(HookProbes probes, uint256 index, uint24 fee)
        internal
        returns (HookProbes.Outcome memory)
    {
        PoolKey memory second = PoolKey(currency0, currency1, fee, TICK_SPACING * 2, hook);
        HookProbes.Request memory request =
            _request(address(manager), probes.callbackCalldata(index, second, address(probes)));
        request.init = true;
        request.initKey = second;
        return probes.probe(request);
    }

    function _request(address caller, bytes memory data) internal view returns (HookProbes.Request memory) {
        return HookProbes.Request({hook: address(hook), caller: caller, call: data, init: false, initKey: hookedKey});
    }

    // --- permissions ---------------------------------------------------------

    /// @notice Ask the hook itself which callbacks it wants.
    ///
    /// The CLI's static reading of `getHookPermissions()` fails whenever the
    /// function is inherited rather than written in the scanned file, which is
    /// the common case for hooks built on a base contract. Executing it is
    /// exact. The runtime code is etched at a scratch address, queried, and
    /// removed again; the constructor never runs, which is fine because the
    /// function is `pure` by interface.
    function _derivePermissions(bytes memory runtimeCode) internal returns (Hooks.Permissions memory permissions) {
        require(
            runtimeCode.length > 0,
            "TwinPools: HOOKRISK_FLAGS is 0 and HOOKRISK_RUNTIME_CODE is empty; nothing to derive permissions from"
        );
        vm.etch(PERMISSIONS_SCRATCH, runtimeCode);
        try IHookPermissions(PERMISSIONS_SCRATCH).getHookPermissions() returns (Hooks.Permissions memory p) {
            permissions = p;
        } catch (bytes memory reason) {
            vm.etch(PERMISSIONS_SCRATCH, "");
            revert(
                string.concat(
                    "TwinPools: getHookPermissions() reverted on the supplied runtime code (not a BaseHook-shaped hook, or the wrong bytecode): ",
                    vm.toString(reason)
                )
            );
        }
        vm.etch(PERMISSIONS_SCRATCH, "");
    }

    /// @notice The 14-bit address flag word for a permission set. Same layout
    /// as `Hooks.sol`; kept as a table rather than a formula so a v4-core bump
    /// that renumbers a bit shows up as a one-line diff here.
    function _flagsOf(Hooks.Permissions memory p) internal pure returns (uint160 flags) {
        if (p.beforeInitialize) flags |= Hooks.BEFORE_INITIALIZE_FLAG;
        if (p.afterInitialize) flags |= Hooks.AFTER_INITIALIZE_FLAG;
        if (p.beforeAddLiquidity) flags |= Hooks.BEFORE_ADD_LIQUIDITY_FLAG;
        if (p.afterAddLiquidity) flags |= Hooks.AFTER_ADD_LIQUIDITY_FLAG;
        if (p.beforeRemoveLiquidity) flags |= Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;
        if (p.afterRemoveLiquidity) flags |= Hooks.AFTER_REMOVE_LIQUIDITY_FLAG;
        if (p.beforeSwap) flags |= Hooks.BEFORE_SWAP_FLAG;
        if (p.afterSwap) flags |= Hooks.AFTER_SWAP_FLAG;
        if (p.beforeDonate) flags |= Hooks.BEFORE_DONATE_FLAG;
        if (p.afterDonate) flags |= Hooks.AFTER_DONATE_FLAG;
        if (p.beforeSwapReturnDelta) flags |= Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
        if (p.afterSwapReturnDelta) flags |= Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        if (p.afterAddLiquidityReturnDelta) flags |= Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG;
        if (p.afterRemoveLiquidityReturnDelta) flags |= Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG;
    }

    // --- constructor arguments -----------------------------------------------

    /// @notice Constructor arguments with sentinels replaced by the real thing.
    ///
    /// Empty means the legacy shape: `abi.encode(manager)`. A zero-argument
    /// constructor ignores trailing calldata, so the same bytes serve both the
    /// one-argument and the zero-argument case.
    ///
    /// Replacement is word-for-word: every aligned 32-byte word that equals a
    /// sentinel is swapped, whatever ABI type it sits in. An address inside a
    /// dynamic array or struct is replaced just the same, which is what makes
    /// this work without an ABI. The cost is that a `uint256` or `bytes32`
    /// argument that happens to equal a sentinel is also replaced; the values
    /// are chosen so that only happens on purpose.
    function _constructorArgs(bytes memory supplied, address hookTarget) internal view returns (bytes memory) {
        if (supplied.length == 0) return abi.encode(manager);
        require(supplied.length % 32 == 0, "TwinPools: HOOKRISK_CONSTRUCTOR_ARGS is not a whole number of ABI words");

        bytes memory args = supplied;
        for (uint256 offset = 0; offset < args.length; offset += 32) {
            bytes32 word;
            assembly ("memory-safe") {
                word := mload(add(add(args, 0x20), offset))
            }
            // An address occupies the low 20 bytes of a word; anything in the
            // high 12 is not an address and cannot be a sentinel.
            if (uint256(word) >> 160 != 0) continue;
            address replacement = _sentinelValue(address(uint160(uint256(word))), hookTarget);
            if (replacement == address(0)) continue;
            bytes32 replaced = bytes32(uint256(uint160(replacement)));
            assembly ("memory-safe") {
                mstore(add(add(args, 0x20), offset), replaced)
            }
        }
        return args;
    }

    function _sentinelValue(address sentinel, address hookTarget) internal view returns (address) {
        if (sentinel == SENTINEL_MANAGER) return address(manager);
        if (sentinel == SENTINEL_CURRENCY0) return Currency.unwrap(currency0);
        if (sentinel == SENTINEL_CURRENCY1) return Currency.unwrap(currency1);
        if (sentinel == SENTINEL_OWNER) return address(this);
        if (sentinel == SENTINEL_HOOK) return hookTarget;
        return address(0);
    }

    // --- environment ---------------------------------------------------------

    /// @notice Creation bytecode of the hook under test.
    ///
    /// Two sources, in order of precedence:
    ///
    /// 1. `HOOKRISK_CREATION_CODE`, set by the CLI when scanning someone else's
    ///    hook. Passing the bytes directly is what makes that possible at all:
    ///    `vm.getCode` resolves names against *this* project's compilation
    ///    index, so an artifact merely copied into `out/` is invisible to it and
    ///    fails with `no matching artifact found` — a message that suggests a
    ///    missing file when the file is right there.
    ///
    /// 2. `vm.getCode(artifact)`, for the fixtures that live in this repository
    ///    and are compiled alongside the harness.
    ///
    /// Deliberately no fallback between them: if the CLI sets the variable and
    /// the bytes are wrong, the constructor reverts loudly rather than quietly
    /// testing whichever local contract happens to share the name.
    function _creationCode(string memory artifact) internal view returns (bytes memory) {
        bytes memory supplied = vm.envOr("HOOKRISK_CREATION_CODE", bytes(""));
        if (supplied.length > 0) return supplied;
        return vm.getCode(artifact);
    }

    /// @notice Hex bytes from an environment variable, where unset and empty
    /// both mean "none". Read as a string first because `envOr` with a `bytes`
    /// default rejects an empty value instead of returning it, and the CLI
    /// legitimately sets these to the empty string.
    function _envBytes(string memory name) internal view returns (bytes memory) {
        string memory raw = vm.envOr(name, string(""));
        if (bytes(raw).length == 0) return "";
        return vm.parseBytes(raw);
    }

    /// @notice The hook the CLI asked for, exactly as it asked.
    function _specFromEnv(string memory artifact) internal view returns (HookSpec memory) {
        return HookSpec({
            artifact: artifact,
            flags: uint160(vm.envOr("HOOKRISK_FLAGS", uint256(0))),
            runtimeCode: _envBytes("HOOKRISK_RUNTIME_CODE"),
            constructorArgs: _envBytes("HOOKRISK_CONSTRUCTOR_ARGS"),
            customCurve: vm.envOr("HOOKRISK_CUSTOM_CURVE", uint256(0)) == 1
        });
    }

    // --- run record ----------------------------------------------------------

    /// @notice Write what `setUp` decided to `out/hookrisk-run-<runId>.json`.
    ///
    /// Called last in a successful `setUp`, so the file's absence is itself a
    /// signal: the CLI knows the run died before the invariants started rather
    /// than guessing from an empty result set. Built by hand rather than with
    /// `vm.serializeJson` so the exact field set is visible here, where the
    /// contract with the CLI is documented.
    function _writeRunFile(string memory runId) internal {
        if (bytes(runId).length == 0) return;
        string memory json = string.concat(
            '{"flags":',
            vm.toString(uint256(run.flags)),
            ',"customCurve":',
            run.customCurve ? "true" : "false",
            ',"dynamicFee":',
            run.dynamicFee ? "true" : "false",
            ',"permissionsDerived":',
            run.permissionsDerived ? "true" : "false",
            ',"seeded":"',
            run.hookedSeeded ? "both" : "hooked-failed",
            '","hookedSeedRevert":"',
            run.hookedSeedRevert.length == 0 ? "" : vm.toString(run.hookedSeedRevert),
            '"',
            run.probed ? string.concat(',"probes":', _probesJson()) : "",
            "}"
        );
        vm.writeFile(string.concat("out/hookrisk-run-", runId, ".json"), json);
    }

    /// @dev The `probes` object of the run record. Only implemented callbacks
    /// appear, so the CLI can read "absent" as "not called" rather than as a
    /// verdict. `selectorReverts` and `exclusivityReason` are present only
    /// when they have something to say.
    function _probesJson() internal view returns (string memory) {
        string[10] memory names = probes.callbackNames();
        string memory eoa = "";
        string memory sel = "";
        string memory reverts = "";
        for (uint256 i = 0; i < 10; i++) {
            if (bytes(run.eoaGuard[i]).length == 0) continue;
            eoa = string.concat(eoa, bytes(eoa).length == 0 ? "" : ",", '"', names[i], '":"', run.eoaGuard[i], '"');
            sel = string.concat(sel, bytes(sel).length == 0 ? "" : ",", '"', names[i], '":"', run.selectors[i], '"');
            if (run.selectorReverts[i].length > 0) {
                reverts = string.concat(
                    reverts,
                    bytes(reverts).length == 0 ? "" : ",",
                    '"',
                    names[i],
                    '":"',
                    vm.toString(run.selectorReverts[i]),
                    '"'
                );
            }
        }
        return string.concat(
            '{"eoaGuard":{',
            eoa,
            '},"exclusivity":"',
            run.exclusivity,
            '"',
            bytes(run.exclusivityReason).length == 0
                ? ""
                : string.concat(',"exclusivityReason":"', run.exclusivityReason, '"'),
            ',"selectors":{',
            sel,
            "}",
            bytes(reverts).length == 0 ? "" : string.concat(',"selectorReverts":{', reverts, "}"),
            "}"
        );
    }

    /// @notice Append one sequence's observations to `out/hookrisk-obs-<runId>.jsonl`.
    ///
    /// Called from `afterInvariant`, once per completed sequence. Forge runs
    /// the invariant functions of one contract in parallel, each with its own
    /// sequences, so several threads append to this file at once. `writeLine`
    /// writes the line and its newline as two separate calls, which under
    /// contention can interleave as `{a}{b}\n\n`; the newline is therefore
    /// part of the payload so every JSON object reaches the file in one
    /// write, and the reader treats the blank lines that result as padding.
    /// An empty run id means the CLI did not ask; write nothing.
    function _writeObservationLine(string memory runId, string memory json) internal {
        if (bytes(runId).length == 0) return;
        vm.writeLine(string.concat("out/hookrisk-obs-", runId, ".jsonl"), string.concat(json, "\n"));
    }

    // --- helpers -------------------------------------------------------------

    /// @notice Mint both currencies to `who`.
    /// @dev Minting only. The handler approves the routers from its own
    /// constructor, so no pranking is needed anywhere in the harness — see the
    /// note in TwinHandler about why a dangling `startPrank` is worth designing
    /// out rather than working around.
    function _fund(address who, uint256 amount) internal {
        MockERC20(Currency.unwrap(currency0)).mint(who, amount);
        MockERC20(Currency.unwrap(currency1)).mint(who, amount);
    }
}
