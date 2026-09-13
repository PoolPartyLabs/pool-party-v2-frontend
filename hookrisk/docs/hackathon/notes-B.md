# Agent B — the Solidity side of the differential harness

Before this change the twin-pool harness stood up 1 of 14 real hooks. The other
13 died inside `setUp`, and a reverting `setUp` produces no invariant results,
which the CLI could not distinguish from a hook with nothing to report
(`v4-constant-sum` scanned as "0 invariant(s), 0 failed"). Four hook shapes
accounted for nearly all of it; each is now handled, recorded, and covered by a
deterministic test that proves both the happy path and the loud failure.

## What changed

All in `harness/`. Files: `test/TwinPools.sol` (rewritten), `test/RevertReason.sol`
(new, shared library), `test/TwinHandler.sol` (uses the library),
`test/Generic.t.sol`, `test/Invariants.t.sol`, `test/HarnessValidation.t.sol`,
`src/hooks/ShapeHooks.sol` (new fixtures), `foundry.toml`.

### 1. Permission derivation (`HOOKRISK_FLAGS=0` + `HOOKRISK_RUNTIME_CODE`)

`TwinPools._derivePermissions` etches the runtime code at a scratch address
(`0x5555…0000`), calls `getHookPermissions()` through the `IHookPermissions`
interface, folds the struct into the 14-bit word with `_flagsOf` (same layout as
`Hooks.sol`, kept as an explicit table), clears the scratch address, and uses
the word to pick the flag-bearing deployment address. `customCurve` is then
taken from `permissions.beforeSwapReturnDelta`, overriding
`HOOKRISK_CUSTOM_CURVE`. `run.permissionsDerived = true`.

Failure modes, all loud: empty runtime code → revert naming both env vars;
runtime code without `getHookPermissions()` (a 2023 `getHooksCalls()` hook, or
the wrong artifact) → revert `getHookPermissions() reverted on the supplied
runtime code (...)`; permissions all false → revert (the PoolManager would never
call the hook; the CLI skips these too).

### 2. Constructor arguments (`HOOKRISK_CONSTRUCTOR_ARGS`)

`_constructorArgs` walks the supplied bytes in aligned 32-byte words and
replaces any word equal to a sentinel with the live value:

| sentinel      | replaced by                              |
|---------------|------------------------------------------|
| `…C0FFEE0001` | the PoolManager                          |
| `…C0FFEE0002` | currency0                                |
| `…C0FFEE0003` | currency1                                |
| `…C0FFEE0004` | the test contract (owner / sender)       |
| `…C0FFEE0005` | the hook's own flag-bearing address      |

Replacement is by word, not by ABI type, so a sentinel inside a `uint256`, a
struct or a dynamic array is replaced just the same — that is what lets the
harness work without an ABI. Empty args keep the legacy `abi.encode(manager)`;
a zero-argument constructor ignores trailing calldata, so the same bytes serve
both. Args not a multiple of 32 bytes → loud revert. A constructor that reverts
→ `TwinPools: hook constructor reverted: <unwrapped reason>`.

`setUp` order is currencies → hook → pools, so the currency sentinels resolve.

### 3. Dynamic-fee pools

`_initHookedPool` tries `manager.initialize` with `POOL_FEE` (3000); on revert it
retries with `LPFeeLibrary.DYNAMIC_FEE_FLAG` and sets `run.dynamicFee = true`.
The vanilla pool stays at 3000 (v4 rejects a dynamic fee without a hook).
`Hooks.isValidHookAddress` is asserted against the fee actually used. If both
attempts fail the revert names both unwrapped reasons and says whether the
flag word itself is invalid.

Consequence for I2 (for `docs/INVARIANTS.md`, owned by agent A): a dynamic-fee
hooked pool starts at LP fee 0 until the hook sets one, so the hooked side can
only pay out *more* than the 30-bip vanilla pool. I2 measures shortfall only,
so the asymmetry cannot produce a false positive; it can mask up to ~30 bips of
extraction on hooks that set a fee near zero. The run file's `dynamicFee` lets
the CLI say so.

### 4. Liquidity-blocking hooks

`_seedTwins` seeds the vanilla pool (must succeed — it is the counterfactual)
and wraps the hooked seed in `try`. On failure it records
`run.hookedSeeded = false` and `run.hookedSeedRevert = RevertReason.rootCause(reason)`
and continues. No position is fabricated.

`RevertReason` is the ERC-7751 unwrapping that lived in `TwinHandler._rootCause`,
moved to a library and re-implemented as a bounds-checked manual decode (a
library cannot guard `abi.decode` with try/catch). The handler now delegates to
it; the recorded I3 revert data is unchanged (`TrappingHookIsCaught` still
asserts the selector).

In `GenericHookInvariants`, when the hooked seed failed:
- `I2_noUndeclaredExtraction` is skipped — a hooked pool with no v4 liquidity
  returns 0 for every swap, which would read as a 100% skim.
- `I2_hookDoesNotBlockSwaps` is skipped — a custom-curve hook with no reserves
  reverts every swap, which says nothing about the hook.
- I1, I2b and I3 still run. I2b is what a custom curve is judged by.

**For the integrator / agent A:** `seeded: "hooked-failed"` on a hook that is
*not* a custom curve is itself a finding (the hook rejects PoolManager
liquidity at the canonical ±6000-tick range: whitelist hooks, full-range-only
hooks). On a custom curve it is the expected shape and should be reported as an
untested surface (swaps not exercised: the hook's own liquidity path is unknown
to the harness). `hookedSeedRevert` carries the hook's own selector, e.g.
`0xebdb4fd9` = `LiquidityGoesThroughTheHook()` for the fixture.

### 5. Run file

`_writeRunFile(runId)` is the last statement of a successful
`GenericHookInvariants.setUp`. It writes `harness/out/hookrisk-run-<RUN_ID>.json`
with exactly:

```json
{"flags":2184,"customCurve":true,"dynamicFee":false,"permissionsDerived":true,"seeded":"hooked-failed","hookedSeedRevert":"0xebdb4fd9"}
```

`hookedSeedRevert` is `""` (not `"0x"`) when there was none. Unset/empty
`HOOKRISK_RUN_ID` → nothing written. If `setUp` reverts, the file is absent —
that absence is the CLI's signal that the run died before any invariant ran.
`foundry.toml` `fs_permissions` is now `read-write` on `./out` (Foundry matches
by path prefix; the filename is not known until runtime, so the directory is
the narrowest scope).

### 6. Fixtures and tests

`src/hooks/ShapeHooks.sol`:
- `DynamicFeeHook` — OZ `BaseDynamicFee`, fee 500.
- `LineCurveHook` — 1:1 custom curve on OZ `BaseHook`, refuses PoolManager
  liquidity, prices exact-input swaps from its own balance.
- `ConfiguredHook` — constructor `(IPoolManager, address owner, uint256 x)`.
- `InheritedPermissionsHook` — `getHookPermissions` inherited from
  `FeeTakingBase`, zero fee.

`test/HarnessValidation.t.sol` (23 tests, all deterministic, ~25 ms):
- `DynamicFeeHookStandsUp` — retry taken, LP fee set, no I2 shortfall, run
  file content byte-exact, empty run id writes nothing.
- `LineCurveHookStandsUp` — seed failure recorded with the hook's selector, no
  fabricated position, swaps run with zero v4 liquidity, `priceChecks > 0`,
  no violation, hooked output > vanilla, run file byte-exact.
- `ConfiguredHookStandsUp` — manager/owner sentinels, currency1/hook sentinels
  in an `address` and a `uint256` slot, legacy args fail loudly on a 3-arg
  constructor, misaligned args fail loudly, constructor revert names
  `HookAddressNotValid(addr)`.
- `InheritedPermissionsHookStandsUp` — derived word == `0x44`, scratch cleared,
  hint override in both directions, run file, empty runtime code fails loudly,
  `MockERC20` bytecode fails loudly and still clears the scratch.
- `RevertReasonUnwraps` — two nested wrappers peel to the inner error;
  empty/truncated/bad-offset chains returned as-is.

## How to demo

```bash
cd harness
forge test --match-path test/HarnessValidation.t.sol      # 23 deterministic tests
forge test                                                # plain run: GenericHookInvariants still skips

# The CLI's path, by hand, against the fixture that used to kill setUp:
export HOOKRISK_ARTIFACT="ShapeHooks.sol:LineCurveHook"
export HOOKRISK_CREATION_CODE=$(jq -r .bytecode.object out/ShapeHooks.sol/LineCurveHook.json)
export HOOKRISK_RUNTIME_CODE=$(jq -r .deployedBytecode.object out/ShapeHooks.sol/LineCurveHook.json)
export HOOKRISK_FLAGS=0 HOOKRISK_CONSTRUCTOR_ARGS="" HOOKRISK_MAX_FEE_BIPS=0 HOOKRISK_CUSTOM_CURVE=0
export HOOKRISK_RUN_ID=demo
FOUNDRY_PROFILE=scan forge test --match-contract GenericHookInvariants
cat out/hookrisk-run-demo.json
```

See "Real-world checks" in the structured result for the same driven against
the pre-fix clones of v4-constant-sum, v2-on-v4, oz-antisandwich, orbital, cork
and trading-days.

## Caveats

- Sentinel replacement cannot tell an `address` word from a `uint256`/`bytes32`
  word that happens to equal `0x…C0FFEE000n`. The values make that a
  deliberate act, not an accident.
- A hook whose `getHookPermissions()` is not `pure` (reads immutables) will
  still answer — immutables are zero in unlinked `deployedBytecode.object` —
  but the answer may not be what the deployed contract says. None of the 14
  real hooks do this.
- Custom-curve hooks whose reserves come through their own liquidity function
  are stood up but their swaps are not exercised (no reserves). Driving a
  hook-specific liquidity path is out of scope for a generic harness; the run
  file says so.
- The full-range-only fallback (retry the seed at `minUsableTick..maxUsableTick`
  when ±6000 is rejected) was considered and not done in the time box. It
  would move full-range-only hooks from `hooked-failed` to `both`.
