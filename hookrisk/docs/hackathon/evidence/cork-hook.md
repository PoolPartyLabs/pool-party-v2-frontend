# Cork Protocol's CorkHook: the $11M exploit, found by HS-01

On 28 May 2025 Cork Protocol lost about $11M. Dedaub's post-mortem: the `beforeSwap` callback on `CorkHook` had no `onlyPoolManager` check, so an attacker called it directly with a crafted `PoolKey` and `hookData`. Four audit firms had reviewed the protocol; three did not audit the hook.

The archived repository (`Cork-Technology/Cork-Hook`, `main` @ 50e78ac) still contains the vulnerable code: the fix in PR #19 never merged.

## What hookrisk reports on it

```
node cli/dist/cli.js scan src/CorkHook.sol:CorkHook --verbose
```

- **high** `unprotected-hook-callback` at `src/CorkHook.sol:97` (`beforeInitialize`)
  CorkHook.beforeInitialize(address,PoolKey,uint160) (src/CorkHook.sol#97-124) is an IHooks callback (0xdc98354e) that never compares msg.sender against …
- **high** `unprotected-hook-callback` at `src/CorkHook.sol:365` (`beforeSwap`)
  CorkHook.beforeSwap(address,PoolKey,IPoolManager.SwapParams,bytes) (src/CorkHook.sol#365-378) is an IHooks callback (0x575e24b4) that never compares …
- **high** `flag-implementation-divergence` at `src/CorkHook.sol:31` (`beforeRemoveLiquidity`)
  CorkHook (src/CorkHook.sol#31-734) declares permission `beforeRemoveLiquidity` (bit 9, BEFORE_REMOVE_LIQUIDITY_FLAG) but provides no working …
- **medium** `admin-surface` at `src/CorkHook.sol:228` (`updateBaseFeePercentage`)
  CorkHook.updateBaseFeePercentage(address,address,uint256) (src/CorkHook.sol#228-230) (updateBaseFeePercentage) is restricted to a privileged caller and …
- **medium** `admin-surface` at `src/CorkHook.sol:232` (`updateTreasurySplitPercentage`)
  CorkHook.updateTreasurySplitPercentage(address,address,uint256) (src/CorkHook.sol#232-234) (updateTreasurySplitPercentage) is restricted to a privileged …
- **medium** `external-call-in-swap-path` at `src/CorkHook.sol:385` (`forwarder`)
  CorkHook._beforeSwap(PoolState,IPoolManager.SwapParams,bytes,address) (src/CorkHook.sol#385-471) makes a state-changing call to `forwarder` in the swap path …
- **medium** `external-call-in-swap-path` at `src/CorkHook.sol:473` (`owner()`)
  CorkHook._splitFee(PoolState,uint256,Currency) (src/CorkHook.sol#473-489) makes a static read of `owner()` in the swap path (_splitFee:486), reached from …
- **medium** `external-call-in-swap-path` at `src/CorkHook.sol:513` (`sender`)
  CorkHook._executeFlashSwap(PoolState,bytes,Currency,Currency,uint256,uint256,address,bool) (src/CorkHook.sol#513-567) makes a state-changing call to `sender` …
- **info** `custom-accounting` at `src/CorkHook.sol:31`
  CorkHook (src/CorkHook.sol#31-734) declares custom-accounting permissions: `beforeSwapReturnDelta` (bit 3)
- **info** `callback-intentionally-disabled` at `src/CorkHook.sol:88` (`beforeAddLiquidity`)
  CorkHook.beforeAddLiquidity(address,PoolKey,IPoolManager.ModifyLiquidityParams,bytes) (src/CorkHook.sol#88-95) overrides `beforeAddLiquidity` with `revert …

`beforeSwap` at line 365 is the callback the attacker invoked. HS-01 also reports `beforeInitialize`, unguarded for the same reason. `beforeAddLiquidity` is unguarded too, but its body is an unconditional revert (`DisableNativeLiquidityModification()`), so it has no reachable surface: it is classified as disabled by design rather than reported as HIGH.

The two `admin-surface` findings are the owner-settable fee and treasury split (`updateBaseFeePercentage`, `updateTreasurySplitPercentage`): a privileged key can change what every swap pays after deployment, the framework's autonomous-parameter-updates concern. The three `external-call-in-swap-path` findings are the forwarder, the swapper's flash-swap callback and a config read, each a third-party dependency every swap has to survive.

The `flag-implementation-divergence` at line 31 is a genuine second defect: the hook declares `beforeRemoveLiquidity` in `getHookPermissions()` but never overrides it, so `BaseHook`'s stub reverts `HookNotImplemented()` on every PoolManager-routed liquidity removal.

Score after the fixes: **medium 17–23/33**, complexity measured 5/5 from the hook profile, gate failed on `3 finding(s) at or above high`. The harness is skipped honestly: the constructor takes `(IPoolManager, LiquidityToken lpBase, address owner)` and `beforeInitialize` clones `lpBase`, which the generic twin-pool fixture cannot supply.

## Before the fixes (main @ db08091)

- **high** `unprotected-hook-callback` at `src/CorkHook.sol:88`
  CorkHook.beforeAddLiquidity(address,PoolKey,IPoolManager.ModifyLiquidityParams,bytes) (src/CorkHook.sol#88-95) is an IHooks callback (0x259982e5) that never ...
- **high** `unprotected-hook-callback` at `src/CorkHook.sol:97`
  CorkHook.beforeInitialize(address,PoolKey,uint160) (src/CorkHook.sol#97-124) is an IHooks callback (0xdc98354e) that never compares msg.sender against poolMa...
- **high** `unprotected-hook-callback` at `src/CorkHook.sol:365`
  CorkHook.beforeSwap(address,PoolKey,IPoolManager.SwapParams,bytes) (src/CorkHook.sol#365-378) is an IHooks callback (0x575e24b4) that never compares msg.send...
- **high** `flag-implementation-divergence` at `src/CorkHook.sol:31`
  CorkHook (src/CorkHook.sol#31-734) declares permission `beforeRemoveLiquidity` (bit 9, BEFORE_REMOVE_LIQUIDITY_FLAG) but provides no working `beforeRemoveLiq...
- **info** `custom-accounting` at `src/CorkHook.sol:31`
  CorkHook (src/CorkHook.sol#31-734) declares custom-accounting permissions: `beforeSwapReturnDelta` (bit 3)

Same three HS-01 hits, so the headline was already right. What changed today is around it: `beforeAddLiquidity` is now also classified as intentionally disabled (it reverts `DisableNativeLiquidityModification()` by design) rather than only "unguarded", the harness row and skip reason are explicit, and the finding ids carry the callback selector so BlockSec's `UniswapPublicHook` on the same function would merge into one corroborated finding (see `blocksec-corroboration.md`).

Full artifacts: `scans/after/cork-hook/` and `scans/before/cork-hook/`.
