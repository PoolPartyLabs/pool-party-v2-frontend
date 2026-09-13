"""Hook profile — the engine's "I looked at this contract" signal.

Why this exists
---------------
Slither's JSON carries findings and nothing else. A clean scan and a scan that
never recognised the target as a hook produce the same output: an empty list.
The CLI used to infer coverage from the *absence* of an unsupported-ABI
classification, which is inference from silence — the exact failure the scoring
layer refuses everywhere else. This detector replaces the inference with a
statement: one informational finding per recognised hook contract, anchored on
the contract, carrying what the plugin measured about it.

Three consumers read it, none of which scores it directly:

* **Coverage.** The CLI marks the target analysed only when a profile exists
  for that file and contract. No profile, no measured dimensions — a plugin
  that drifts or a contract the detectors skipped cannot pass as clean.
* **Permissions.** `permissions` is the resolved `getHookPermissions()` set,
  inheritance followed, so the CLI no longer regex-parses the source file
  (which found nothing on hooks that inherit the declaration) and only falls
  back to the harness's runtime derivation when static analysis did not run.
* **Complexity.** `metrics` feeds the scoring layer's complexity brackets.
  The brackets are the scoring layer's interpretation, recorded there as such;
  the numbers here are measurements and nothing more.

It is a classification: INFO, never fails a gate, never raises a dimension by
itself. The metadata block it emits is the reason `schema/engine-metadata.schema.json`
has `metrics`, `permissions` and `callbacks`.
"""

from __future__ import annotations

from slither.core.declarations import Contract, Function, Modifier
from slither.utils.output import Output

from ..utils.hook_analysis import (
    PERMISSION_FIELDS,
    RETURNS_DELTA_FIELDS,
    classify_callback,
    declared_permissions,
    external_calls_in,
    implemented_callbacks,
    owner_only_functions,
    reachable_functions,
    state_writes_in,
    swap_path_functions,
    third_party_calls,
)
from ..utils.hooks_spec import CALLBACK_TO_FLAG
from .base import DetectorClassification, HookriskDetector

#: Permission fields that name a callback (as opposed to a returns-delta flag).
_CALLBACK_FIELDS = frozenset(CALLBACK_TO_FLAG)


class HookProfile(HookriskDetector):
    ARGUMENT = "hookrisk-hook-profile"
    HELP = "Per-contract profile of a recognised v4 hook: callbacks, permissions, complexity metrics"
    IMPACT = DetectorClassification.INFORMATIONAL
    CONFIDENCE = DetectorClassification.HIGH

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#hook-profile"
    WIKI_TITLE = "Hook profile"
    WIKI_DESCRIPTION = (
        "One informational finding per recognised hook contract, carrying the "
        "resolved permission set, the implemented callbacks and the metrics the "
        "scoring layer derives complexity from."
    )
    WIKI_EXPLOIT_SCENARIO = (
        "Not a vulnerability. Its absence is the signal: a target without a "
        "profile was not analysed, and no dimension may be scored from its silence."
    )
    WIKI_RECOMMENDATION = "Nothing to fix. Read the metrics alongside the findings."

    RULE_CLASS = "hook-profile"
    IS_CLASSIFICATION = True
    # Informs complexity in the sense that the scoring layer reads the metrics;
    # the finding itself never sets a value.
    INFORMS_DIMENSIONS = ("complexity",)

    def _detect_hook(self, contract: Contract) -> list[Output]:
        callbacks = implemented_callbacks(contract)
        verdicts = {cb.name: classify_callback(cb.function, contract) for cb in callbacks}
        # "Implemented" means the most-derived delegate does work. A BaseHook
        # stub is nobody's code; a deliberate revert-guard is reported by
        # `hookrisk-disabled-callback` and is not a path the PoolManager can
        # take to completion, so neither counts as a callback the hook runs.
        working = sorted(cb.name for cb in callbacks if verdicts[cb.name].is_implemented)
        working_roots = [cb.function for cb in callbacks if verdicts[cb.name].is_implemented]

        reachable: set[Function] = set()
        for root in working_roots:
            reachable |= reachable_functions(root, contract)
        internal = [fn for fn in reachable if not isinstance(fn, Modifier)]

        declared = declared_permissions(contract)
        permissions = _normalised(declared) if declared is not None else None
        declared_callbacks = (
            sum(1 for field in _CALLBACK_FIELDS if permissions.get(field, False)) if permissions else 0
        )
        uses_returns_delta = bool(permissions) and any(
            permissions.get(field, False) for field in RETURNS_DELTA_FIELDS
        )

        metrics: dict[str, int | bool] = {
            "callbacksImplemented": len(working),
            "callbacksDeclared": declared_callbacks,
            "stateWritesInCallbacks": state_writes_in(set(working_roots) | reachable),
            "externalCallsInSwapPath": len(external_calls_in(swap_path_functions(contract))),
            # The raw count above includes the PoolManager's own settlement
            # calls and the pool's tokens; the scorer's externalDependencies
            # input is the count after those are excluded (HS-05's view).
            "externalCallsInSwapPathThirdParty": len(third_party_calls(contract)),
            "internalFunctionsReachableFromCallbacks": len(internal),
            "usesReturnsDelta": uses_returns_delta,
            "hasOwnerOnlyFunctions": bool(owner_only_functions(contract)),
        }

        summary = ", ".join(working) if working else "none"
        return [
            self._report(
                [
                    contract,
                    f" is a recognised v4 hook: implements {summary}; "
                    f"declares {declared_callbacks} callback permission(s)"
                    + ("" if permissions is not None else " (no getHookPermissions() resolved)")
                    + f"; {metrics['stateWritesInCallbacks']} state write(s) reachable from callbacks; "
                    f"{metrics['externalCallsInSwapPath']} external call(s) in the swap path.\n",
                ],
                metrics=metrics,
                permissions=permissions,
                callbacks=working,
            )
        ]


def _normalised(declared: dict[str, bool]) -> dict[str, bool]:
    """Every `Hooks.Permissions` field, in struct order, defaulting to false.

    Solidity requires a named struct literal to set every field, so a missing
    key here means the declaration was written field-by-field and left the
    default; either way the PoolManager treats it as false.
    """
    return {field: bool(declared.get(field, False)) for field in PERMISSION_FIELDS}
