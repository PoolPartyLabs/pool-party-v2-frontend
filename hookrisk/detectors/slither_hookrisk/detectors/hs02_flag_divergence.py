"""HS-02 — declared permissions disagree with implemented callbacks.

Why this exists
---------------
A v4 hook's permissions are not stored anywhere. They are the low 14 bits of its
deployed address, chosen by grinding a CREATE2 salt until the address carries the
right bit pattern. Three things must agree and nothing enforces that they do:

1. the bits in the deployed address, which is what the PoolManager obeys;
2. `getHookPermissions()`, which the constructor checks the address against;
3. the callbacks the contract actually implements.

`Hooks.validateHookPermissions` checks (1) against (2) at construction. **Nothing
checks either against (3).** That gap is what this detector covers, and as far as
we can tell no other v4 tool does.

The two failure modes
---------------------
**Permission declared, callback not implemented.** The PoolManager will invoke
the callback. With OpenZeppelin's `BaseHook` the delegate reverts with
`HookNotImplemented()`, so *every swap through the pool reverts*. The pool is
bricked for that operation and the hook cannot be fixed without redeploying to a
new address. This is a liveness failure, not a theft risk, which is why it is
reported as high impact rather than critical — and it is exactly the kind of bug
that ships, because it is invisible until someone touches the pool.

Not every unconditional revert is that bug. A hook that overrides the delegate
in its own sources with `revert LiquidityNotAllowed()` has declared the
permission *so that* the PoolManager routes there and gets refused: the WETH
wrapper hook, v2-on-v4 and the constant-sum example all do this to force
liquidity through their own entry points. That is a design decision, reported by
`hookrisk-disabled-callback` as an informational classification, and this
detector stays silent on it. See `classify_callback` in utils/hook_analysis.py
for the exact rule.

**Callback implemented, permission not declared.** The PoolManager never calls
it. The code is dead: fee logic that never runs, an access check that never
fires, a TWAP that never updates. The framework calls this out in §1.11,
*Permission Encoding & Salt Grinding Pitfalls* — "required callbacks may be
disabled" — and it is the more dangerous direction, because everything appears
to work while the mechanism you built is simply absent.

Scope in source mode
--------------------
Source mode compares (2) against (3). The deployed address is not known at scan
time, so (1) is checked in deployed mode, where hookrisk decodes the real address
bits and reconciles all three. A hook that never declares `getHookPermissions()`
gets an informational finding rather than silence: it is relying entirely on
address bits that nothing verifies.
"""

from __future__ import annotations

from slither.core.declarations import Contract, Function, Modifier
from slither.core.variables.state_variable import StateVariable
from slither.slithir.operations import Assignment, Member, Phi, TypeConversion
from slither.slithir.variables import Constant
from slither.utils.output import Output

from ..utils.hook_analysis import (
    FIELD_TO_FLAG,
    PERMISSION_FIELDS,
    RETURNS_DELTA_FIELDS,
    CallbackStatus,
    classify_callback,
    declared_permissions,
    fully_lifted,
    implemented_callbacks,
    legacy_abi_evidence,
    resolve_override,
    returned_values,
)
from ..utils.hooks_spec import CALLBACK_TO_FLAG, FLAG_BITS
from .base import DetectorClassification, HookriskDetector

#: Struct field name for each callback, e.g. beforeSwap -> beforeSwap. The
#: returns-delta fields have no callback of their own; they modify one.
_CALLBACK_TO_FIELD = {name: name for name in CALLBACK_TO_FLAG}


class FlagImplementationDivergence(HookriskDetector):
    ARGUMENT = "hookrisk-flag-divergence"
    HELP = "Declared hook permissions disagree with the callbacks actually implemented"
    IMPACT = DetectorClassification.HIGH
    CONFIDENCE = DetectorClassification.MEDIUM

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#hs-02"
    WIKI_TITLE = "HS-02 Permission and implementation divergence"
    WIKI_DESCRIPTION = (
        "A Uniswap v4 hook declares a permission it does not implement (every "
        "pool operation of that kind reverts) or implements a callback it does "
        "not declare (the code is unreachable)."
    )
    WIKI_EXPLOIT_SCENARIO = """
```solidity
function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
    return Hooks.Permissions({
        beforeSwap: true,          // declared...
        afterSwap: false,          // ...but afterSwap logic is implemented below
        ...
    });
}

function _beforeSwap(...) internal override returns (...) {
    // never overridden -> BaseHook reverts with HookNotImplemented()
}

function _afterSwap(...) internal override returns (bytes4, int128) {
    feesCollected += ...;          // dead code: the flag bit is not set
}
```
Every swap on the pool reverts, because `beforeSwap` is declared and unimplemented.
Meanwhile the fee accounting in `_afterSwap` never executes, because the address
does not carry `AFTER_SWAP_FLAG`. Neither problem produces a compile error, a
constructor revert, or a failing unit test that does not route through a real pool.
"""
    WIKI_RECOMMENDATION = (
        "Make `getHookPermissions()` the single source of truth: declare exactly "
        "the callbacks you implement, and verify the mined CREATE2 salt produces "
        "an address whose low 14 bits match. Assert the full permission set in a "
        "deployment test rather than trusting the salt-grinding script."
    )

    RULE_CLASS = "flag-implementation-divergence"
    INFORMS_DIMENSIONS = ("complexity",)

    def _detect_hook(self, contract: Contract) -> list[Output]:
        declared = declared_permissions(contract)
        results: list[Output] = []

        if declared is None:
            results.append(
                self._report(
                    [
                        contract,
                        " implements IHooks callbacks but does not declare "
                        "getHookPermissions(). Its permissions come solely from the "
                        "low 14 bits of its deployed address, and nothing in the "
                        "source verifies that those bits match this implementation. "
                        "Scan the deployed address to check the two agree.\n",
                    ]
                )
            )
            return results

        classified = {
            callback.name: (callback, classify_callback(callback.function, contract))
            for callback in implemented_callbacks(contract)
        }
        # A callback that exists under a pre-current signature is not a
        # missing body; it is one this detector cannot read. The unsupported-ABI
        # classification names it, and accusing it here would be wrong twice
        # (wrong reason, wrong severity).
        unreadable = set(legacy_abi_evidence(contract).mismatched_callbacks)

        for callback_name, field in _CALLBACK_TO_FIELD.items():
            is_declared = declared.get(field, False)
            callback, verdict = classified.get(callback_name, (None, None))
            status = verdict.status if verdict is not None else CallbackStatus.STUB
            flag = CALLBACK_TO_FLAG[callback_name]
            bit = FLAG_BITS[flag]

            if is_declared and status is CallbackStatus.STUB and callback_name not in unreadable:
                results.append(
                    self._report(
                        [
                            contract,
                            f" declares permission `{field}` (bit {bit}, {flag}) but "
                            f"provides no working `{callback_name}` implementation. "
                            "The PoolManager will call it on every matching pool "
                            "operation and the call will revert, making the pool "
                            "unusable for that operation.\n",
                        ],
                        discriminator=field,
                    )
                )
            elif not is_declared and status is not CallbackStatus.STUB:
                # An intentionally disabled callback counts as implemented here:
                # the developer wrote a refusal and the PoolManager will never
                # route to it, which is the opposite of what they intended.
                results.append(
                    self._report(
                        [
                            self._user_code_for(contract, callback.function),
                            f" implements `{callback_name}` but `{field}` is not "
                            "declared in getHookPermissions(). Unless the deployed "
                            f"address carries bit {bit} ({flag}), the PoolManager "
                            "never invokes it and this code is unreachable.\n",
                        ],
                        discriminator=field,
                    )
                )

        results.extend(self._check_returns_delta(contract, declared))
        results.extend(self._check_zero_delta(contract, declared, classified))
        return results

    #: Returns-delta field -> (parent callback, index of the delta in the
    #: callback's return tuple). beforeSwap returns (selector, BeforeSwapDelta,
    #: lpFeeOverride); the others return (selector, delta).
    _DELTA_POSITION = {
        "beforeSwapReturnDelta": ("beforeSwap", 1),
        "afterSwapReturnDelta": ("afterSwap", 1),
        "afterAddLiquidityReturnDelta": ("afterAddLiquidity", 1),
        "afterRemoveLiquidityReturnDelta": ("afterRemoveLiquidity", 1),
    }

    def _check_zero_delta(self, contract: Contract, declared: dict[str, bool], classified: dict) -> list[Output]:
        """A returns-delta flag whose callback can only ever return zero.

        The third HS-02 case. The flag tells the PoolManager to read the
        delta the hook returns and settle it; a callback that returns
        `ZERO_DELTA` / `int128(0)` on every path has declared a power it
        never uses. Not a liveness bug — the pool works — but the address
        carries a custom-accounting bit for nothing, HS-07 classifies the
        hook as a custom curve, the harness swaps its invariants, and a
        reviewer budgets a math audit, all on a declaration the code
        contradicts. Reported at Medium: the fix is one line either way
        (drop the flag, or return the delta the author meant to).

        Silent when the delta is computed or comes from a call — the point
        is "can never be non-zero", not "is zero on some path".
        """
        results: list[Output] = []
        for field, (parent, index) in self._DELTA_POSITION.items():
            if not declared.get(field, False) or not declared.get(parent, False):
                continue
            callback, verdict = classified.get(parent, (None, None))
            if callback is None or verdict is None or not verdict.is_implemented:
                continue
            returned = returned_values(callback.function, contract, index)
            if not returned or not all(_always_zero(fn, value) for fn, value in returned):
                continue
            # "Every path returns zero" is only a claim about paths the tool
            # read. A partially lifted delegate (HR-E205) keeps its early
            # `return (selector, 0)` and loses the computed one.
            if not all(fully_lifted(fn) for fn, _ in returned):
                continue
            body = self._user_code_for(contract, callback.function)
            results.append(
                self._report(
                    [
                        body,
                        f" declares `{field}` (bit {FLAG_BITS[FIELD_TO_FLAG[field]]}) but its "
                        f"`{parent}` returns a zero delta on every path. The flag costs an "
                        "address bit, a custom-accounting classification and a math review "
                        "for a delta the hook never returns; either drop the flag or return "
                        "the delta the implementation was meant to.\n",
                    ],
                    discriminator=field,
                    impact=DetectorClassification.MEDIUM,
                )
            )
        return results

    @staticmethod
    def _user_code_for(contract: Contract, callback: Function) -> Function | Contract:
        """Pick the element to anchor a finding on: the developer's own code.

        With a BaseHook-derived hook the external callback is declared in the
        library, so anchoring there is wrong twice over. It points a reviewer at
        `lib/uniswap-hooks/...` instead of the file they wrote — and Slither's
        `--exclude-dependencies`, which most people run, silently drops findings
        whose element lives under a dependency path. That turns a real divergence
        into no output at all.

        So we resolve through to the internal delegate the hook actually
        overrode, and fall back to the contract when there is none.
        """
        for call in callback.internal_calls:
            target = getattr(call, "function", call)
            if not isinstance(target, Function) or isinstance(target, Modifier):
                continue
            resolved = resolve_override(contract, target)
            if resolved.contract_declarer == contract:
                return resolved
        return contract

    def _check_returns_delta(self, contract: Contract, declared: dict[str, bool]) -> list[Output]:
        """Flag returns-delta permissions declared without their parent action.

        `Hooks.isValidHookAddress` rejects such an address outright, so this is
        not a subtle bug — the hook simply cannot be deployed at a matching
        address. Catching it at source level saves discovering it after a salt
        grind that can take a while.
        """
        parents = {
            "beforeSwapReturnDelta": "beforeSwap",
            "afterSwapReturnDelta": "afterSwap",
            "afterAddLiquidityReturnDelta": "afterAddLiquidity",
            "afterRemoveLiquidityReturnDelta": "afterRemoveLiquidity",
        }

        results: list[Output] = []
        for field, parent in parents.items():
            if declared.get(field, False) and not declared.get(parent, False):
                results.append(
                    self._report(
                        [
                            contract,
                            f" declares `{field}` without `{parent}`. "
                            "Hooks.isValidHookAddress rejects this combination, so "
                            "no address satisfying these permissions can be used to "
                            "initialize a pool.\n",
                        ],
                        discriminator=field,
                    )
                )
        return results


class CustomAccountingDeclared(HookriskDetector):
    """HS-07 — the hook uses custom accounting.

    A classification, not a defect. A returns-delta permission lets the hook take
    a cut of a swap or of a liquidity operation, and in the limit consume the
    entire swap so the PoolManager skips the concentrated-liquidity math
    altogether — the framework's §1.10 "NoOp swap", which is another way of
    saying the hook is now the market maker.

    Two consequences, both mechanical:

    * **Scoring.** Fires the framework's custom-math and price-impact triggers,
      which mandate a math-specialist audit regardless of the total score.
    * **Invariants.** Changes what the differential harness may assert. Invariant
      I2 compares output against an unhooked pool and would flag any custom curve
      as extraction, so for these hooks I2 is replaced by price monotonicity
      alongside I1 and I3. See docs/INVARIANTS.md.

    Reported at INFO because there is nothing to fix. It exists so the manifest
    can say *why* the tier rose.
    """

    ARGUMENT = "hookrisk-custom-accounting"
    HELP = "Hook declares a returns-delta permission (custom accounting or custom curve)"
    IMPACT = DetectorClassification.INFORMATIONAL
    CONFIDENCE = DetectorClassification.HIGH

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#hs-07"
    WIKI_TITLE = "HS-07 Custom accounting in use"
    WIKI_DESCRIPTION = (
        "The hook declares a returns-delta permission, so it can alter the "
        "amounts a swap or liquidity operation settles."
    )
    WIKI_EXPLOIT_SCENARIO = (
        "Not a vulnerability. This classification raises the hook's risk tier and "
        "changes which invariants can be asserted against it."
    )
    WIKI_RECOMMENDATION = (
        "Custom accounting is legitimate and powerful. Treat it as the framework "
        "does: obtain a math-specialist review, test input-range boundaries "
        "explicitly, and run stateful invariant tests over the accounting."
    )

    RULE_CLASS = "custom-accounting"
    IS_CLASSIFICATION = True
    INFORMS_DIMENSIONS = ("customMath", "priceImpactingBehavior")
    INFORMS_TRIGGERS = ("custom-math", "price-impact")

    def _detect_hook(self, contract: Contract) -> list[Output]:
        declared = declared_permissions(contract)
        if not declared:
            return []

        enabled = sorted(field for field in RETURNS_DELTA_FIELDS if declared.get(field, False))
        if not enabled:
            return []

        described = ", ".join(f"`{field}` (bit {FLAG_BITS[FIELD_TO_FLAG[field]]})" for field in enabled)
        swap_delta = any(field in ("beforeSwapReturnDelta", "afterSwapReturnDelta") for field in enabled)
        # Only a swap-side delta makes the hook the market maker. A delta on a
        # liquidity callback adjusts what an LP settles; swaps still route
        # through v4's own math, so output comparison against the reference
        # pool (I2) remains the right assertion.
        consequence = (
            "means differential output comparison (invariant I2) does not "
            "apply — the harness substitutes price monotonicity.\n"
            if swap_delta
            else "is liquidity-side only: swaps still route through v4's pricing, "
            "so the harness keeps comparing swap output against the reference "
            "pool (invariant I2).\n"
        )
        return [
            self._report(
                [
                    contract,
                    f" declares custom-accounting permissions: {described}. "
                    "The hook can alter settled amounts, which raises its risk tier "
                    "under the framework's custom-math and price-impact triggers and "
                    + consequence,
                ]
            )
        ]


def _always_zero(function: Function, value: object, depth: int = 6) -> bool:
    """Whether `value` can only be the zero delta.

    A literal 0, a library's `ZERO_DELTA` constant, a conversion of either
    (`int128(0)`), or a local whose every definition is one of those. A
    call result (`toBeforeSwapDelta(...)`), arithmetic, or a parameter is
    not: the delta is computed, and this check must not guess at its value.
    """
    if depth == 0:
        return False
    if isinstance(value, Constant):
        return value.value == 0
    if isinstance(value, StateVariable):
        return value.is_constant and value.name == "ZERO_DELTA"
    definitions = [ir for node in function.nodes for ir in node.irs if getattr(ir, "lvalue", None) is value]
    if not definitions:
        return False
    for definition in definitions:
        if isinstance(definition, Member):
            # `BeforeSwapDeltaLibrary.ZERO_DELTA`: a reference produced by a
            # Member on the library, not a state-variable read.
            if not (isinstance(definition.variable_left, Contract) and str(definition.variable_right) == "ZERO_DELTA"):
                return False
        elif isinstance(definition, Assignment):
            if not _always_zero(function, definition.rvalue, depth - 1):
                return False
        elif isinstance(definition, TypeConversion):
            if not _always_zero(function, definition.variable, depth - 1):
                return False
        elif isinstance(definition, Phi):
            if not all(_always_zero(function, rvalue, depth - 1) for rvalue in definition.rvalues):
                return False
        else:
            return False
    return True


# Referenced by PERMISSION_FIELDS to keep the import used and the mapping honest.
assert set(_CALLBACK_TO_FIELD).issubset(set(PERMISSION_FIELDS)), (
    "callback names must be a subset of the Permissions struct fields"
)
