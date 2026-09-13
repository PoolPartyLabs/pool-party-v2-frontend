"""HS-06 — a dynamic LP fee with no ceiling.

The defect
----------
A hook sets the pool's LP fee two ways: `poolManager.updateDynamicLPFee(key,
fee)` on a dynamic-fee pool, or an `lpFeeOverride` returned from `beforeSwap`
with `OVERRIDE_FEE_FLAG` set. The PoolManager checks only that the fee is at
most `MAX_LP_FEE` (100 %). Everything below that is the hook's word, and if
the value comes from a storage slot an owner can set, or from an oracle, or
from `hookData` the swapper supplies, nothing in the contract says what the
next swap will pay. Hacken's guide calls this "excessive or invalid
`lpFeeOverride`"; the framework scores it under `priceImpactingBehavior`.

How it detects
--------------
Provenance, not names. From each fee site the fee argument is traced back
through SlithIR — assignments, conversions, arithmetic, internal calls
(override-resolved, so `_getFee` lands on the hook's override rather than the
abstract declaration), struct fields, mapping reads — to its sources: a
constant, a state variable, a parameter, `hookData`, an external call. For a
state variable the functions that write it are traced too, because
`setFee(uint24 f) { require(f <= MAX_FEE); fee = f; }` is where a ceiling
normally lives.

The fee is bounded when, anywhere along that chain, a variable of the chain
is compared (`<`, `<=`, `>`, `>=`) against a constant or an immutable, masked
with a constant, passed to `LPFeeLibrary.validate`/`isValid`, clamped with
`min`, or is itself a constant. Otherwise the finding names the sources and
says what a ceiling would look like.

What it misses
--------------
A ceiling enforced somewhere the chain does not reach — a governance
contract that only ever proposes valid fees, an off-chain keeper — is
invisible, and rightly reported: the contract cannot prove it. A comparison
against a *mutable* state variable (`fee <= maxFee` where `maxFee` is itself
settable) is not a ceiling and does not count.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from slither.core.declarations import Contract, Function, Modifier
from slither.core.variables.local_variable import LocalVariable
from slither.core.variables.state_variable import StateVariable
from slither.slithir.operations import (
    Assignment,
    Binary,
    BinaryType,
    HighLevelCall,
    Index,
    InternalCall,
    LibraryCall,
    LowLevelCall,
    Member,
    Phi,
    SolidityCall,
    TypeConversion,
    Unpack,
)
from slither.slithir.variables import Constant, ReferenceVariable
from slither.utils.output import Output

from ..utils.hook_analysis import (
    definition_of,
    implemented_callbacks,
    is_project_source,
    resolve_override,
    returned_values,
)
from .base import DetectorClassification, HookriskDetector

OVERRIDE_FEE_FLAG = 0x400000

_COMPARISONS = (
    BinaryType.LESS,
    BinaryType.LESS_EQUAL,
    BinaryType.GREATER,
    BinaryType.GREATER_EQUAL,
)
#: Library or internal calls that bound their argument.
_BOUNDING_CALLS = frozenset({"validate", "isValid", "removeOverrideFlagAndValidate", "min"})


@dataclass
class Provenance:
    """Where a fee value comes from, and whether anything bounds it."""

    sources: list[str] = field(default_factory=list)
    bounded_by: str | None = None
    #: The chain passed through `x | OVERRIDE_FEE_FLAG`, so a beforeSwap
    #: return is an override rather than "use the pool's fee".
    override_flag: bool = False

    @property
    def bounded(self) -> bool:
        return self.bounded_by is not None

    def add_source(self, name: str) -> None:
        if name not in self.sources:
            self.sources.append(name)


class UnboundedDynamicFee(HookriskDetector):
    ARGUMENT = "hookrisk-unbounded-dynamic-fee"
    HELP = "Dynamic LP fee or lpFeeOverride whose value is never compared against a constant ceiling"
    IMPACT = DetectorClassification.MEDIUM
    CONFIDENCE = DetectorClassification.MEDIUM

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#hs-06"
    WIKI_TITLE = "HS-06 Unbounded dynamic fee"
    WIKI_DESCRIPTION = (
        "The hook sets the LP fee (updateDynamicLPFee or a beforeSwap override) "
        "from a value with no ceiling in the contract: a settable state variable, "
        "an external call, caller-supplied data."
    )
    WIKI_EXPLOIT_SCENARIO = """
```solidity
uint24 private _fee;
function setFee(uint24 fee_) external onlyOwner { _fee = fee_; }   // no ceiling
function _beforeSwap(...) internal override returns (bytes4, BeforeSwapDelta, uint24) {
    return (this.beforeSwap.selector, ZERO_DELTA, _fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
}
```
The owner sets `_fee` to 1_000_000 and the next swap pays 100 % to LPs; a
compromised or malicious key needs no exploit beyond one setter call.
"""
    WIKI_RECOMMENDATION = (
        "Bound the fee where it enters: `require(fee_ <= MAX_FEE)` in the setter "
        "against a `constant`, a ternary clamp before use, or "
        "`LPFeeLibrary.validate` — and make the ceiling immutable."
    )

    RULE_CLASS = "unbounded-dynamic-fee"
    INFORMS_DIMENSIONS = ("priceImpactingBehavior",)
    INFORMS_TRIGGERS = ("price-impact",)

    def _detect_hook(self, contract: Contract) -> list[Output]:
        results: list[Output] = []
        reported: set[tuple[str, ...]] = set()

        def report(function: Function, site: str, provenance: Provenance) -> None:
            key = tuple(provenance.sources)
            if provenance.bounded or key in reported:
                return
            reported.add(key)
            sources = ", ".join(provenance.sources) or "an unknown value"
            results.append(
                self._report(
                    [
                        function if is_project_source(function) else contract,
                        f" ({function.name}) {site} from {sources}, and nothing in the "
                        "contract compares that value against a constant ceiling. A "
                        "`require(fee <= MAX_FEE)` where the fee is set, a clamp before "
                        "it is used, or `LPFeeLibrary.validate` would bound what the "
                        "next swap pays; as written, the value is whatever the source says.\n",
                    ],
                    discriminator=function.name,
                )
            )

        # Site 1: updateDynamicLPFee(key, fee), anywhere in the hook.
        for function in _most_derived_functions(contract):
            for node in function.nodes:
                for ir in node.irs:
                    if isinstance(ir, HighLevelCall) and str(ir.function_name) == "updateDynamicLPFee":
                        if len(ir.arguments) < 2:
                            continue
                        provenance = Provenance()
                        _trace(function, ir.arguments[1], contract, provenance, set(), {})
                        report(function, "sets the pool's LP fee via `updateDynamicLPFee`", provenance)

        # Site 2: the third value returned from beforeSwap, when OVERRIDE_FEE_FLAG is set.
        for callback in implemented_callbacks(contract):
            if callback.name != "beforeSwap":
                continue
            for function, value in returned_values(callback.function, contract, index=2):
                provenance = Provenance()
                _trace(function, value, contract, provenance, set(), {})
                if not provenance.override_flag:
                    continue
                report(function, "returns an `lpFeeOverride` from `beforeSwap`", provenance)
        return results


def _most_derived_functions(contract: Contract) -> list[Function]:
    seen: set[str] = set()
    functions: list[Function] = []
    for function in contract.functions:
        if isinstance(function, Modifier) or not function.is_implemented:
            continue
        if function.full_name in seen:
            continue
        seen.add(function.full_name)
        functions.append(resolve_override(contract, function))
    return functions


def _definitions_of(function: Function, variable: object) -> list:
    return [ir for node in function.nodes for ir in node.irs if getattr(ir, "lvalue", None) is variable]


def _is_fixed(value: object) -> bool:
    """A literal, or a state variable that cannot change after deployment."""
    if isinstance(value, Constant):
        return True
    return isinstance(value, StateVariable) and (value.is_constant or value.is_immutable)


def _library_constant(function: Function, value: object) -> StateVariable | None:
    """`LPFeeLibrary.MAX_LP_FEE` in SlithIR is a reference produced by a `Member`
    on the library contract, not a state-variable read; resolve it to the
    variable so constness can be judged."""
    if not isinstance(value, ReferenceVariable):
        return None
    definition = definition_of(function, value)
    if isinstance(definition, Member) and isinstance(definition.variable_left, Contract):
        return definition.variable_left.get_state_variable_from_name(str(definition.variable_right))
    return None


def _is_override_flag(function: Function, value: object) -> bool:
    if isinstance(value, Constant):
        return value.value == OVERRIDE_FEE_FLAG
    resolved = _library_constant(function, value) or value
    return isinstance(resolved, StateVariable) and resolved.name == "OVERRIDE_FEE_FLAG"


def _fixed_through(function: Function, value: object, depth: int = 4) -> bool:
    """`_is_fixed`, looking through conversions and copies (`uint24(MAX_FEE)`)."""
    if _is_fixed(value):
        return True
    if depth == 0:
        return False
    resolved = _library_constant(function, value)
    if resolved is not None:
        return _is_fixed(resolved)
    definition = definition_of(function, value)
    if isinstance(definition, TypeConversion):
        return _fixed_through(function, definition.variable, depth - 1)
    if isinstance(definition, Assignment):
        return _fixed_through(function, definition.rvalue, depth - 1)
    return False


def _bound_in(function: Function, variable: object) -> str | None:
    """A ceiling applied to `variable` inside `function`, described, or None."""
    for node in function.nodes:
        for ir in node.irs:
            if isinstance(ir, Binary) and ir.type in _COMPARISONS:
                left, right = ir.variable_left, ir.variable_right
                if left is variable and _fixed_through(function, right):
                    return f"compared against {_name(right)} in {function.name}"
                if right is variable and _fixed_through(function, left):
                    return f"compared against {_name(left)} in {function.name}"
            elif isinstance(ir, Binary) and ir.type is BinaryType.AND:
                if variable in (ir.variable_left, ir.variable_right) and (
                    _fixed_through(function, ir.variable_left) or _fixed_through(function, ir.variable_right)
                ):
                    return f"masked with a constant in {function.name}"
            elif isinstance(ir, (LibraryCall, InternalCall)):
                name = str(getattr(ir, "function_name", None) or getattr(ir.function, "name", ""))
                if name in _BOUNDING_CALLS and variable in ir.arguments:
                    return f"passed to {name}() in {function.name}"
    return None


def _name(value: object) -> str:
    if isinstance(value, Constant):
        return str(value.value)
    return getattr(value, "name", str(value))


def _trace(
    function: Function,
    value: object,
    contract: Contract,
    provenance: Provenance,
    visited: set[tuple[int, int]],
    bindings: dict,
    depth: int = 12,
) -> None:
    """Walk `value`'s definition chain inside `function`, recording sources and bounds."""
    if provenance.bounded or depth == 0:
        return
    key = (id(function), id(value))
    if key in visited:
        return
    visited.add(key)

    if isinstance(value, Constant):
        provenance.add_source(f"the constant {value.value}")
        provenance.bounded_by = provenance.bounded_by or "a constant fee"
        return

    if isinstance(value, StateVariable):
        if _is_fixed(value):
            provenance.add_source(f"`{value.name}` (constant/immutable)")
            provenance.bounded_by = provenance.bounded_by or f"`{value.name}` is fixed at deployment"
            return
        provenance.add_source(f"state variable `{value.name}`")
        bound = _bound_in(function, value)
        if bound:
            provenance.bounded_by = bound
            return
        for writer in _writers_of(contract, value):
            bound = _bound_in(writer, value)
            if bound:
                provenance.bounded_by = bound
                return
            for ir in _writes_to(writer, value):
                _trace(writer, ir.rvalue, contract, provenance, visited, {}, depth - 1)
                if provenance.bounded:
                    return
        return

    if isinstance(value, LocalVariable) and value in function.parameters:
        if value in bindings:
            caller, argument = bindings[value]
            _trace(caller, argument, contract, provenance, visited, {}, depth - 1)
            return
        provenance.add_source(f"parameter `{value.name}` of {function.name}")
        bound = _bound_in(function, value)
        if bound:
            provenance.bounded_by = bound
        return

    bound = _bound_in(function, value)
    if bound:
        provenance.bounded_by = bound
        return

    definitions = _definitions_of(function, value)
    if not definitions:
        provenance.add_source(f"`{_name(value)}` in {function.name}")
        return

    for definition in definitions:
        if provenance.bounded:
            return
        if isinstance(definition, Assignment):
            _trace(function, definition.rvalue, contract, provenance, visited, bindings, depth - 1)
        elif isinstance(definition, TypeConversion):
            _trace(function, definition.variable, contract, provenance, visited, bindings, depth - 1)
        elif isinstance(definition, Phi):
            for rvalue in definition.rvalues:
                _trace(function, rvalue, contract, provenance, visited, bindings, depth - 1)
        elif isinstance(definition, Binary):
            operands = [definition.variable_left, definition.variable_right]
            if definition.type is BinaryType.OR and any(_is_override_flag(function, op) for op in operands):
                provenance.override_flag = True
                for op in operands:
                    if not _is_override_flag(function, op):
                        _trace(function, op, contract, provenance, visited, bindings, depth - 1)
                continue
            if definition.type is BinaryType.AND and any(_fixed_through(function, op) for op in operands):
                provenance.bounded_by = f"masked with a constant in {function.name}"
                continue
            # Arithmetic: the result is bounded only if every operand is.
            branches: list[Provenance] = []
            for op in operands:
                branch = Provenance()
                _trace(function, op, contract, branch, visited, bindings, depth - 1)
                branches.append(branch)
            for branch in branches:
                for source in branch.sources:
                    provenance.add_source(source)
                provenance.override_flag = provenance.override_flag or branch.override_flag
            if all(branch.bounded for branch in branches):
                provenance.bounded_by = "; ".join(b.bounded_by or "" for b in branches)
        elif isinstance(definition, Unpack):
            tuple_definition = definition_of(function, definition.tuple)
            if isinstance(tuple_definition, InternalCall) and isinstance(tuple_definition.function, Function):
                _trace_call(function, tuple_definition, definition.index, contract, provenance, visited, depth)
            elif isinstance(tuple_definition, SolidityCall) and "decode" in str(tuple_definition.function.name):
                provenance.add_source("caller-supplied data (abi.decode)")
            elif isinstance(tuple_definition, (HighLevelCall, LowLevelCall)):
                provenance.add_source(f"external call `{_call_name(tuple_definition)}`")
            else:
                provenance.add_source(f"`{_name(value)}` in {function.name}")
        elif isinstance(definition, InternalCall) and isinstance(definition.function, Function):
            _trace_call(function, definition, 0, contract, provenance, visited, depth)
        elif isinstance(definition, LibraryCall):
            name = str(definition.function_name)
            if name in _BOUNDING_CALLS and any(_fixed_through(function, a) for a in definition.arguments):
                provenance.bounded_by = f"clamped with {name}() in {function.name}"
                continue
            for argument in definition.arguments:
                if not isinstance(argument, Constant):
                    _trace(function, argument, contract, provenance, visited, bindings, depth - 1)
        elif isinstance(definition, (HighLevelCall, LowLevelCall)):
            provenance.add_source(f"external call `{_call_name(definition)}`")
        elif isinstance(definition, SolidityCall):
            if "decode" in str(definition.function.name):
                provenance.add_source("caller-supplied data (abi.decode)")
            else:
                provenance.add_source(f"`{definition.function.name}` in {function.name}")
        elif isinstance(definition, Member):
            base = definition.variable_left
            if isinstance(base, Contract):
                # `LPFeeLibrary.MAX_LP_FEE`, `SomeConfig.FEE`: a constant read
                # off another contract, or an unresolvable name.
                library_constant = base.get_state_variable_from_name(str(definition.variable_right))
                if library_constant is not None:
                    _trace(function, library_constant, contract, provenance, visited, bindings, depth - 1)
                else:
                    provenance.add_source(f"`{base.name}.{definition.variable_right}`")
                continue
            origin = base.points_to_origin if isinstance(base, ReferenceVariable) else base
            if isinstance(origin, StateVariable):
                _trace(function, origin, contract, provenance, visited, bindings, depth - 1)
            else:
                _trace(function, base, contract, provenance, visited, bindings, depth - 1)
        elif isinstance(definition, Index):
            base = definition.variable_left
            origin = base.points_to_origin if isinstance(base, ReferenceVariable) else base
            _trace(function, origin, contract, provenance, visited, bindings, depth - 1)
        else:
            provenance.add_source(f"`{_name(value)}` in {function.name}")


def _trace_call(
    caller: Function,
    call: InternalCall,
    index: int,
    contract: Contract,
    provenance: Provenance,
    visited: set[tuple[int, int]],
    depth: int,
) -> None:
    callee = resolve_override(contract, call.function)
    bindings = {
        param: (caller, argument) for param, argument in zip(callee.parameters, call.arguments)
    }
    returned = returned_values(callee, contract, index)
    if not returned:
        provenance.add_source(f"`{callee.name}()`")
        return
    for function, value in returned:
        _trace(function, value, contract, provenance, visited, bindings if function is callee else {}, depth - 1)


def _call_name(call) -> str:
    name = getattr(call, "function_name", None) or getattr(getattr(call, "function", None), "name", "call")
    return f"{call.destination}.{name}"


def _writers_of(contract: Contract, variable: StateVariable) -> list[Function]:
    writers: list[Function] = []
    for function in _most_derived_functions(contract):
        if function.is_constructor:
            continue
        if variable in function.state_variables_written:
            writers.append(function)
    return writers


def _writes_to(function: Function, variable: StateVariable) -> list[Assignment]:
    writes: list[Assignment] = []
    for node in function.nodes:
        if variable not in node.state_variables_written:
            continue
        for ir in node.irs:
            if not isinstance(ir, Assignment):
                continue
            target = ir.lvalue
            origin = target.points_to_origin if isinstance(target, ReferenceVariable) else target
            if origin is variable:
                writes.append(ir)
    return writes
