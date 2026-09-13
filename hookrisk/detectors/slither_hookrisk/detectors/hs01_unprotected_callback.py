"""HS-01 — an IHooks callback that anyone can call.

The defect
----------
v4 invokes hook callbacks from the PoolManager and only from the PoolManager.
The `IHooks` documentation says as much: *"Should only be callable by the v4
PoolManager."* A callback that does not enforce this is directly reachable by
anyone, with a caller-supplied `PoolKey` and caller-supplied `hookData`. The hook
then updates state, or moves value, on behalf of a pool it was never installed
on, using parameters the PoolManager would never have produced.

Prior art
---------
BlockSec's HookScan detects this class from bytecode as `UniswapPublicHook`, and
their evaluation found it in 7 of 7 contracts they had ground truth for. hookrisk
implements it at source level anyway, for three reasons: the two engines
disagree often enough to be worth reconciling, source level gives a precise line
for the SARIF annotation in a pull request, and requiring Docker for a basic
access-control check would put the most important detector behind the heaviest
dependency. When both engines run and agree, `cli/src/engines/dedupe.ts` merges
them into one finding at high confidence.

Detection
---------
Structural, never name-based. See `guards_pool_manager` in utils/hook_analysis.py
for why: a hook can declare `modifier onlyPoolManager { _; }` that enforces
nothing, and the canonical base class has already moved between repositories
once. We look for a real comparison between `msg.sender` and the variable
holding the pool manager, anywhere in the function, its modifiers, or the
internal calls it makes.
"""

from __future__ import annotations

from slither.core.declarations import Contract
from slither.utils.output import Output

from ..utils.hook_analysis import (
    classify_callback,
    guards_pool_manager,
    implemented_callbacks,
    pool_manager_variables,
)
from .base import DetectorClassification, HookriskDetector


class UnprotectedHookCallback(HookriskDetector):
    ARGUMENT = "hookrisk-unprotected-callback"
    HELP = "IHooks callback callable by anyone, not just the PoolManager"
    IMPACT = DetectorClassification.HIGH
    CONFIDENCE = DetectorClassification.HIGH

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#hs-01"
    WIKI_TITLE = "HS-01 Unprotected hook callback"
    WIKI_DESCRIPTION = (
        "A Uniswap v4 hook callback that does not restrict its caller to the "
        "PoolManager can be invoked directly by an attacker with an arbitrary "
        "PoolKey and arbitrary hookData."
    )
    WIKI_EXPLOIT_SCENARIO = """
```solidity
function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
    external
    returns (bytes4, BeforeSwapDelta, uint24)
{
    observedVolume[key.toId()] += uint256(-params.amountSpecified);  // no caller check
    return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
}
```
An attacker calls `beforeSwap` directly, passing a `PoolKey` for a pool that
does not exist and an arbitrary `amountSpecified`. `observedVolume` is now
attacker-controlled. Every downstream decision that trusts it — a TWAP, a
dynamic fee, a reward accrual — is corrupted without a single token moving.
"""
    WIKI_RECOMMENDATION = (
        "Gate every callback on `msg.sender == address(poolManager)`. Inheriting "
        "`BaseHook` from `@openzeppelin/uniswap-hooks` applies its "
        "`onlyPoolManager` modifier for you; note that v4-periphery no longer "
        "ships a `BaseHook`. If you write the check yourself, compare against an "
        "immutable set in the constructor."
    )

    RULE_CLASS = "unprotected-hook-callback"
    # An unguarded callback is an access-control defect. It does not by itself
    # make the hook more complex or raise its TVL, so it informs the complexity
    # dimension only — the framework scores inherent risk, and findings are
    # evidence toward that, not a separate score of their own.
    INFORMS_DIMENSIONS = ("complexity",)

    def _detect_hook(self, contract: Contract) -> list[Output]:
        pool_manager_vars = pool_manager_variables(contract)
        results: list[Output] = []

        if not pool_manager_vars:
            # No PoolManager reference at all: every callback is unguarded by
            # construction, and we cannot point at the check that is missing
            # because there is nothing to check against.
            for callback in implemented_callbacks(contract):
                if not classify_callback(callback.function, contract).is_implemented:
                    continue
                results.append(
                    self._report(
                        [
                            contract,
                            " implements ",
                            callback.function,
                            " but holds no reference to the PoolManager, so the "
                            "callback cannot be restricted to it and is callable "
                            "by anyone.\n",
                        ],
                        discriminator=callback.name,
                    )
                )
            return results

        readable = ", ".join(sorted(v.name for v in pool_manager_vars))
        for callback in implemented_callbacks(contract):
            if guards_pool_manager(callback.function, pool_manager_vars) is not None:
                continue
            # A callback whose body is an unconditional revert (BaseHook's stub,
            # or a deliberate revert-guard) has no reachable surface: an
            # attacker calling it gets a revert and nothing else. Reporting it
            # as HIGH double-counts what HS-02 or the disabled-callback
            # classification already say about the same function.
            if not classify_callback(callback.function, contract).is_implemented:
                continue
            results.append(
                self._report(
                    [
                        callback.function,
                        f" is an IHooks callback ({callback.selector}) that never "
                        f"compares msg.sender against ",
                        f"{readable}",
                        ". Anyone can call it with an arbitrary PoolKey and "
                        "arbitrary hookData.\n",
                    ],
                    discriminator=callback.name,
                )
            )
        return results
