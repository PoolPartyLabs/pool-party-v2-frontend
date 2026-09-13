"""Callback intentionally disabled — a classification, not a defect.

Why this exists
---------------
Four of the fourteen real-world hooks we scanned declare a liquidity permission
and then override the delegate with a revert of their own:

* WETHHook (Uniswap's token-wrapper base): `revert LiquidityNotAllowed()`
* v2-on-v4: `revert AddLiquidityDirectToHook()`
* the constant-sum example: `revert("No v4 Liquidity allowed")`
* Orbital: `revert("Use custom removeLiquidity")`

They are all saying the same thing: this hook is the market maker, liquidity
goes through *its* deposit path, and the PoolManager-routed operation is refused
on purpose. Before this detector existed HS-02 could not tell that apart from
`BaseHook`'s `HookNotImplemented()` stub and reported every one of them as
"provides no working implementation … making the pool unusable" at HIGH. The
scan was wrong on four of fourteen hooks, in the direction that gets a tool
switched off.

What it reports
---------------
Reported at INFO with `isClassification: true`, because there is nothing to fix.
It exists so two consumers can act on it:

* **The reader.** The manifest says *why* the pool refuses direct liquidity,
  instead of either accusing the hook or saying nothing.
* **The harness.** Its twin-pool setUp seeds both pools with liquidity through
  the PoolManager. A hook classified here will revert that seeding, and the
  harness records `seeded: "hooked-failed"` rather than treating the revert as a
  finding. Only custom-curve hooks can trade in that state.

The rule is in `classify_callback` (utils/hook_analysis.py): the callback's
most-derived delegate must be declared in the project's own sources and revert
with anything other than an error named `HookNotImplemented`. Both halves
matter — hooks routinely vendor `BaseHook` into `src/base/`, which makes the
stub project-owned without making it intentional.
"""

from __future__ import annotations

from slither.core.declarations import Contract
from slither.utils.output import Output

from ..utils.hook_analysis import classify_callback, declared_permissions, implemented_callbacks
from .base import DetectorClassification, HookriskDetector

#: What the PoolManager is trying to do when it invokes each callback, for the
#: message. "PoolManager-routed liquidity addition is disabled" reads; "the
#: beforeAddLiquidity operation is disabled" does not.
CALLBACK_OPERATIONS: dict[str, str] = {
    "beforeInitialize": "pool initialisation",
    "afterInitialize": "pool initialisation",
    "beforeAddLiquidity": "liquidity addition",
    "afterAddLiquidity": "liquidity addition",
    "beforeRemoveLiquidity": "liquidity removal",
    "afterRemoveLiquidity": "liquidity removal",
    "beforeSwap": "swapping",
    "afterSwap": "swapping",
    "beforeDonate": "donation",
    "afterDonate": "donation",
}


class CallbackIntentionallyDisabled(HookriskDetector):
    ARGUMENT = "hookrisk-disabled-callback"
    HELP = "Hook callback overridden with a deliberate revert (operation disabled by design)"
    IMPACT = DetectorClassification.INFORMATIONAL
    CONFIDENCE = DetectorClassification.HIGH

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#disabled-callback"
    WIKI_TITLE = "Callback intentionally disabled"
    WIKI_DESCRIPTION = (
        "The hook declares a permission and overrides the callback in its own "
        "sources with a custom revert, so the PoolManager-routed operation is "
        "refused by design."
    )
    WIKI_EXPLOIT_SCENARIO = (
        "Not a vulnerability. The hook manages that operation through its own "
        "entry points; the PoolManager-routed path is closed on purpose."
    )
    WIKI_RECOMMENDATION = (
        "Nothing to fix. Make sure the hook's own entry point for the operation "
        "is covered by tests, since the PoolManager-routed one cannot be."
    )

    RULE_CLASS = "callback-intentionally-disabled"
    IS_CLASSIFICATION = True
    # Refusing a PoolManager operation is a design choice that changes what the
    # harness may assert, not something that raises a scoring dimension.
    INFORMS_DIMENSIONS = ()

    def _detect_hook(self, contract: Contract) -> list[Output]:
        declared = declared_permissions(contract)
        results: list[Output] = []

        for callback in implemented_callbacks(contract):
            verdict = classify_callback(callback.function, contract)
            if not verdict.is_intentionally_disabled:
                continue
            # A refusal the PoolManager never routes to is not "disabled by
            # design", it is unreachable code — HS-02 reports that. When the
            # hook declares no permissions at all the address bits decide and
            # we cannot know, so we report the refusal as written.
            if declared is not None and not declared.get(callback.name, False):
                continue

            assert verdict.revert is not None  # INTENTIONALLY_DISABLED implies a revert
            operation = CALLBACK_OPERATIONS[callback.name]
            # Anchor on the analysed hook when the revert lives in a base it
            # inherits (WETHHook via BaseTokenWrapperHook, StablePairHook via
            # BaseDynamicFeeHook): the CLI attributes findings to the target
            # file, and a classification anchored on lib/ or src/base/ would
            # never reach the report of the hook it describes.
            inherited = verdict.delegate.contract_declarer != contract
            anchor = contract if inherited else verdict.delegate
            via = (
                f" (inherited from {verdict.delegate.contract_declarer.name}."
                f"{verdict.delegate.name})"
                if inherited
                else ""
            )
            results.append(
                self._report(
                    [
                        anchor,
                        f" overrides `{callback.name}`{via} with `revert "
                        f"{verdict.revert.describe()}`, so PoolManager-routed "
                        f"{operation} is disabled by design; the differential "
                        f"harness records such reverts when it runs. This is "
                        f"not the missing implementation HS-02 reports.\n",
                    ],
                    discriminator=callback.name,
                )
            )
        return results
