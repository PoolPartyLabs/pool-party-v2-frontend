"""HS-05 — an external call in the swap path to something that is not the pool.

The defect
----------
`beforeSwap` and `afterSwap` run inside every swap on every pool the hook is
attached to. A call from there to a third party — a price oracle, another
protocol, an address read from storage — makes each of those swaps depend on
that address: on it being live, on it returning in time, on it not reverting.
An oracle that pauses pauses the pool. That is a liveness consequence before it
is a correctness one, which is why an *unhandled* call (not inside `try`) is
the shape reported first: a `try` at least keeps the swap alive when the
dependency is not.

The framework scores this as `externalDependencies`. The hook profile counts
raw swap-path calls, but that count includes the PoolManager's own settlement
(`take`, `settle`, `mint`) and the pool's own tokens, which are not
dependencies the hook added. `classify_destination` separates them; this
detector reports one finding per third-party destination, and the profile
carries the third-party count next to the raw one so the scorer uses the
right number.

What it does not judge
----------------------
Whether the call is *safe* — an oracle can be correct and still be a
dependency. A static read (`view`/`staticcall`) is reported with
`isStatic: true` so the scorer can weigh it lower. Low-level calls are
reported as unhandled unless inside `try`; whether the hook checks the
success flag is not analysed.
"""

from __future__ import annotations

from collections import defaultdict

from slither.core.cfg.node import NodeType
from slither.core.declarations import Contract
from slither.utils.output import Output

from ..utils.hook_analysis import (
    CallDestination,
    ExternalCall,
    SWAP_PATH_CALLBACKS,
    is_project_source,
    third_party_calls,
)
from .base import DetectorClassification, HookriskDetector


class ExternalCallInSwapPath(HookriskDetector):
    ARGUMENT = "hookrisk-external-call-in-swap-path"
    HELP = "beforeSwap/afterSwap call a third party (not the PoolManager, not the pool's tokens)"
    IMPACT = DetectorClassification.MEDIUM
    CONFIDENCE = DetectorClassification.MEDIUM

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#hs-05"
    WIKI_TITLE = "HS-05 External call in the swap path"
    WIKI_DESCRIPTION = (
        "A swap callback, or something it reaches, calls a contract other than "
        "the PoolManager or the pool's own currencies. Every swap now depends on "
        "that address."
    )
    WIKI_EXPLOIT_SCENARIO = """
```solidity
function _beforeSwap(...) internal override returns (bytes4, BeforeSwapDelta, uint24) {
    (, int256 price,,,) = oracle.latestRoundData();   // not in a try
    ...
}
```
The oracle is paused, deprecated, or simply reverts on a stale round. Every
swap on every pool using this hook reverts with it. LPs cannot be affected
directly, but nobody can trade until the dependency recovers.
"""
    WIKI_RECOMMENDATION = (
        "Prefer data the PoolManager already holds. If a third party is "
        "unavoidable, wrap the call in `try`/`catch` with a safe fallback, "
        "keep it a static read, and declare `externalDependencies` honestly."
    )

    RULE_CLASS = "external-call-in-swap-path"
    INFORMS_DIMENSIONS = ("externalDependencies", "complexity")

    def _detect_hook(self, contract: Contract) -> list[Output]:
        grouped: dict[str, list[tuple[ExternalCall, CallDestination]]] = defaultdict(list)
        for call, destination in third_party_calls(contract):
            grouped[destination.label].append((call, destination))

        results: list[Output] = []
        for label, calls in sorted(grouped.items()):
            is_static = all(call.is_static for call, _ in calls)
            unhandled = any(call.node.type is not NodeType.TRY for call, _ in calls)
            first = calls[0][0]
            where = ", ".join(
                f"{call.function.name}:{call.line}" for call, _ in sorted(calls, key=lambda c: c[0].line)
            )
            callbacks = sorted(
                {fn.name for call, _ in calls for fn in _swap_roots(call, contract)}
            ) or sorted(SWAP_PATH_CALLBACKS)
            consequence = (
                "a revert or a pause there reverts every swap on every pool using this hook"
                if unhandled
                else "the call is inside a try, so a failure there is survivable, but the "
                "swap's outcome still depends on that address"
            )
            reads = "a static read of" if is_static else "a state-changing call to"
            results.append(
                self._report(
                    [
                        first.function if is_project_source(first.function) else contract,
                        f" makes {reads} `{label}` in the swap path ({where}), reached from "
                        + ", ".join(callbacks)
                        + f". That address is a dependency the pool did not have: {consequence}.\n",
                    ],
                    discriminator=label,
                    metrics={"destination": label, "isStatic": is_static, "unhandled": unhandled},
                )
            )
        return results


def _swap_roots(call: ExternalCall, contract: Contract):
    """The swap callbacks from which `call`'s function is reachable."""
    from ..utils.hook_analysis import implemented_callbacks, reachable_functions

    roots = []
    for callback in implemented_callbacks(contract):
        if callback.name not in SWAP_PATH_CALLBACKS:
            continue
        if call.function is callback.function or call.function in reachable_functions(callback.function, contract):
            roots.append(callback.function)
    return roots
