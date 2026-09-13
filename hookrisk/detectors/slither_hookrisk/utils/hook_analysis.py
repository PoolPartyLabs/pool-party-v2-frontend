"""Shared analysis primitives for the hookrisk detectors.

Everything here answers one of three questions about a Slither `Contract`:

1. Is this a Uniswap v4 hook at all, and which callbacks does it implement?
2. Which state variable holds the `IPoolManager`, and is a given function
   gated on it?
3. What does the code do inside the swap path?

The recurring design decision is to key off *structure* rather than *names*.
A detector that looks for a modifier literally called `onlyPoolManager` works
until the library moves — and it already has: `BaseHook` used to ship in
v4-periphery and now lives in OpenZeppelin's `uniswap-hooks`, with a
different inheritance chain. Worse, a name-based check is trivially defeated by
a hook that declares `modifier onlyPoolManager { _; }` and does nothing, which is
exactly the shape a malicious hook would take. So the guard check traces an
actual comparison between `msg.sender` and the variable that received the pool
manager, wherever that comparison happens to live.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Iterator

from slither.core.cfg.node import Node, NodeType
from slither.core.declarations import Contract, Function, Modifier
from slither.core.declarations.solidity_variables import (
    SolidityCustomRevert,
    SolidityVariable,
    SolidityVariableComposed,
)
from slither.core.variables.state_variable import StateVariable
from slither.slithir.variables import Constant, ReferenceVariable, TupleVariable
from slither.slithir.operations import (
    Assignment,
    Binary,
    BinaryType,
    Condition,
    HighLevelCall,
    Index,
    InternalCall,
    LibraryCall,
    LowLevelCall,
    Member,
    Operation,
    Return,
    SolidityCall,
    TypeConversion,
    Unary,
)

from .hooks_spec import (
    CALLBACK_SELECTORS,
    CALLBACK_SIGNATURES,
    CALLBACK_TO_FLAG,
    FLAG_BITS,
    RETURNS_DELTA_FLAGS,
    VALUE_TYPE_ALIASES,
)

__all__ = [
    "HookCallback",
    "normalize_signature",
    "HOOK_NOT_IMPLEMENTED_ERROR",
    "RevertReason",
    "unconditional_revert",
    "is_project_source",
    "CallbackStatus",
    "CallbackImplementation",
    "classify_callback",
    "resolve_override",
    "implemented_callbacks",
    "LegacyAbiEvidence",
    "legacy_abi_evidence",
    "is_hook_contract",
    "pool_manager_variables",
    "guards_pool_manager",
    "declared_permissions",
    "external_calls_in",
    "swap_path_functions",
    "reachable_functions",
    "state_writes_in",
    "owner_variables",
    "guards_owner",
    "owner_only_functions",
    "Guard",
    "access_guard",
    "guard_kind",
    "entry_point_mutators",
    "callback_read_state",
    "state_variables_written_by",
    "calls_named_in",
    "CallDestination",
    "classify_destination",
    "third_party_calls",
    "definition_of",
    "returned_values",
    "fully_lifted",
]

#: Callback names whose bodies constitute "the swap path" for HS-05.
SWAP_PATH_CALLBACKS = frozenset({"beforeSwap", "afterSwap"})

#: Type names that plausibly denote the PoolManager reference.
_POOL_MANAGER_TYPES = frozenset({"IPoolManager", "PoolManager"})

#: Fallback names, used only when the type is a bare `address`. Name matching is
#: a last resort here precisely because it is weak; a hit only ever *adds* a
#: candidate variable, and a wrong candidate can at worst cause a false negative
#: in the guard check, never a false positive.
_POOL_MANAGER_NAMES = frozenset({"poolmanager", "manager", "pm", "_poolmanager"})

#: Substrings that mark an address-typed state variable as holding a privileged
#: party. Name-based on purpose and only ever used to *add* a candidate: the
#: result feeds a boolean profile metric (`hasOwnerOnlyFunctions`), where a
#: missed synonym costs one false "no admin surface" and a wrong hit costs
#: nothing that scores. `manager` is deliberately absent — that is the
#: PoolManager, and comparing msg.sender to it is the HS-01 guard, not an
#: admin check.
_OWNER_NAME_HINTS = ("owner", "admin", "governance", "governor", "guardian", "authority", "controller", "operator")


@dataclass(frozen=True)
class HookCallback:
    """One IHooks callback implemented by a contract."""

    name: str
    function: Function
    selector: str
    flag: str

    @property
    def source_line(self) -> int:
        lines = self.function.source_mapping.lines
        return lines[0] if lines else 0

    @property
    def source_file(self) -> str:
        return self.function.source_mapping.filename.short


# --------------------------------------------------------------------------- #
# Identifying hooks
# --------------------------------------------------------------------------- #


#: Matches a bare Solidity identifier, so value-type names can be substituted
#: without touching `uint256`, tuple parens or array brackets.
_IDENTIFIER = __import__("re").compile(r"\b[A-Za-z_]\w*\b")


def normalize_signature(signature: str) -> str:
    """Rewrite a Slither signature into canonical ABI spelling.

    Slither's ``Function.solidity_signature`` does not consistently erase
    user-defined value types. In a single ``PoolKey`` tuple it renders
    ``currency0`` as ``address`` but ``currency1`` as ``Currency``:

        beforeSwap(address,(address,Currency,uint24,int24,address),...)

    against the canonical

        beforeSwap(address,(address,address,uint24,int24,address),...)

    so a literal string comparison silently fails to recognise any hook at all —
    a detector that reports nothing, which is the worst possible failure for a
    security tool because it looks exactly like success.

    Substituting every known alias makes the comparison robust to that. Aliases
    are generated from v4-core's ``type X is Y;`` declarations, so a new value
    type in a future release is picked up by ``make spec`` rather than needing a
    code change here.
    """
    if not signature:
        return signature
    name, _, rest = signature.partition("(")
    if not rest:
        return signature

    def substitute(match) -> str:
        token = match.group(0)
        seen: set[str] = set()
        while token in VALUE_TYPE_ALIASES and token not in seen:
            seen.add(token)
            token = VALUE_TYPE_ALIASES[token]
        return token

    return name + "(" + _IDENTIFIER.sub(substitute, rest)


def implemented_callbacks(contract: Contract) -> list[HookCallback]:
    """Return the IHooks callbacks this contract actually implements.

    Matching is on the full normalised signature, not the bare name, so a
    contract with its own unrelated `afterSwap(uint256)` is not mistaken for a
    hook. Signatures come from `hooks_spec`, which is generated from v4-core and
    cross-checked against solc by `harness/test/HooksSpec.t.sol`.

    Inherited implementations count: a hook extending OpenZeppelin's `BaseHook`
    implements the callbacks through it, and that is the common case.
    """
    found: list[HookCallback] = []
    for function in contract.functions_entry_points:
        signature = normalize_signature(function.solidity_signature)
        for name, canonical in CALLBACK_SIGNATURES.items():
            if signature != canonical:
                continue
            # An abstract or unimplemented declaration is not an implementation;
            # flagging it would mean reporting the interface itself.
            if not function.is_implemented:
                continue
            found.append(
                HookCallback(
                    name=name,
                    function=function,
                    selector=CALLBACK_SELECTORS[name],
                    flag=CALLBACK_TO_FLAG[name],
                )
            )
            break
    return found


def resolve_override(contract: Contract, function: Function) -> Function:
    """Return the most-derived implementation of `function` visible on `contract`.

    Slither's `internal_calls` resolve statically: an inherited `afterSwap` on
    `BaseHook` records a call to `BaseHook._afterSwap`, even when the analysed
    contract overrides `_afterSwap` with real logic. Following that edge without
    re-resolving finds the base's `revert HookNotImplemented()` stub and concludes
    the callback is unimplemented — precisely backwards for the hook that did the
    work.

    `contract.functions` lists *every* version of an overridden function, base
    and override alike, in no guaranteed order — so taking the first match picks
    the base's stub about as often as not. We select the most-derived candidate:
    one declared on the contract itself if present, otherwise the one whose
    declarer is furthest down the inheritance chain.
    """
    best: Function | None = None
    for candidate in contract.functions:
        if candidate.full_name != function.full_name or not candidate.is_implemented:
            continue
        if candidate.contract_declarer == contract:
            return candidate
        if best is None:
            best = candidate
        elif best.contract_declarer in candidate.contract_declarer.inheritance:
            # `best`'s declarer is an ancestor of `candidate`'s, so candidate wins.
            best = candidate
    return best or function


#: Name of the error OpenZeppelin's `BaseHook` (and the 2023 v4-periphery one,
#: and every copy-pasted fork of either) raises from a callback delegate that
#: was never overridden. It is the one revert that means "nobody wrote this",
#: as opposed to "somebody wrote this to refuse".
HOOK_NOT_IMPLEMENTED_ERROR = "HookNotImplemented"


@dataclass(frozen=True)
class RevertReason:
    """Why a function reverts on every path.

    `error_name` is set for `revert CustomError(...)`, `message` for
    `revert("...")`; a bare `revert()` or a legacy `throw` sets neither.
    """

    error_name: str | None = None
    message: str | None = None

    @property
    def is_hook_not_implemented(self) -> bool:
        return self.error_name == HOOK_NOT_IMPLEMENTED_ERROR

    def describe(self) -> str:
        if self.error_name is not None:
            return f"{self.error_name}()"
        if self.message is not None:
            return f'"{self.message}"'
        return "revert()"


def unconditional_revert(function: Function) -> RevertReason | None:
    """The reason `function` reverts on every path, or None if it can return.

    Approximated as: the function contains a revert and has no return statement.
    That is exactly the shape of a callback stub *and* of a deliberate
    revert-guard, and telling those two apart is what `classify_callback` is
    for — this function only reports *what* the revert says.

    A function with conditional reverts has a return somewhere and is correctly
    excluded. When several unconditional reverts exist (dead code after the
    first), the first one lexically is reported.
    """
    if not function.is_implemented:
        return None

    reason: RevertReason | None = None
    for node in function.nodes:
        if node.type == NodeType.RETURN:
            return None
        if node.type == NodeType.THROW:
            reason = reason or RevertReason()
            continue
        for ir in node.irs:
            if not isinstance(ir, SolidityCall):
                continue
            solidity_function = ir.function
            if isinstance(solidity_function, SolidityCustomRevert):
                reason = reason or RevertReason(error_name=solidity_function.custom_error.name)
            elif str(solidity_function.name).startswith("revert"):
                message = None
                if ir.arguments:
                    argument = ir.arguments[0]
                    if isinstance(argument, Constant) and isinstance(argument.value, str):
                        message = argument.value
                reason = reason or RevertReason(message=message)
    return reason


def is_project_source(function: Function) -> bool:
    """Whether `function` was written in the project being scanned.

    crytic-compile marks everything under the Foundry `libs` paths (or
    `node_modules`) as a dependency; anything else is the developer's own code.
    A revert in the developer's own code is a decision; the same revert inside
    `lib/` is a library default they may not even know exists.
    """
    return not function.source_mapping.is_dependency


class CallbackStatus(Enum):
    """What a callback's most-derived delegate actually does when called."""

    #: The delegate does work: it can return.
    IMPLEMENTED = "implemented"
    #: Nobody wrote the delegate. Either the callback is not overridden at all
    #: and the base class's `HookNotImplemented()` stub answers, or the override
    #: lives in a dependency. Declaring the permission is a liveness bug.
    STUB = "stub"
    #: The developer overrode the delegate in their own sources with a revert of
    #: their own choosing. The PoolManager-routed operation is refused by
    #: design — a WETH wrapper hook that rejects direct liquidity, an
    #: order-book hook that forces its own deposit path. Not a bug.
    INTENTIONALLY_DISABLED = "intentionally-disabled"


@dataclass(frozen=True)
class CallbackImplementation:
    """The verdict of `classify_callback` for one external callback."""

    status: CallbackStatus
    #: The function whose body decided the verdict: the overridden internal
    #: delegate for a BaseHook descendant, the external callback itself when it
    #: has no delegate. Findings anchor here so they point at the developer's
    #: own line and survive `--exclude-dependencies`.
    delegate: Function
    #: Set when the delegate unconditionally reverts.
    revert: RevertReason | None = None

    @property
    def is_implemented(self) -> bool:
        return self.status is CallbackStatus.IMPLEMENTED

    @property
    def is_intentionally_disabled(self) -> bool:
        return self.status is CallbackStatus.INTENTIONALLY_DISABLED


def classify_callback(function: Function, contract: Contract) -> CallbackImplementation:
    """Decide whether a callback does work, is an unwritten stub, or refuses on purpose.

    Necessary because of how the canonical base class works. OpenZeppelin's
    `BaseHook` implements every external callback — guarded, and delegating to an
    internal `_beforeSwap`-style function whose default body is
    `revert HookNotImplemented()`. A hook opts in by overriding the internal
    function.

    So "the contract has a `beforeSwap`" is true for every BaseHook descendant
    and tells us nothing. What matters is whether the delegate does work. Getting
    this wrong in either direction breaks HS-02: treat stubs as implementations
    and every BaseHook hook looks like it implements all fourteen permissions;
    treat delegating callbacks as stubs and no hook implements anything.

    A single "does it revert" boolean is still not enough. Four of fourteen
    real-world hooks we scanned override a liquidity delegate with a revert of
    their own (`LiquidityNotAllowed()`, `"No v4 Liquidity allowed"`), which is
    the same IR shape as the base stub but the opposite meaning: the permission
    is declared precisely so the PoolManager routes there and gets refused.
    Reporting that as "the pool is unusable" at HIGH is crying wolf, and a tool
    that cries wolf on deliberate design gets switched off.

    The distinction is ownership plus the error's name. A revert is
    INTENTIONALLY_DISABLED when its delegate is declared in the project's own
    sources (not under a dependency path) and raises anything other than
    `HookNotImplemented`. The name check matters because hooks routinely vendor
    `BaseHook` into `src/base/` — WETHHook does — which makes the stub
    project-owned without making it intentional.

    Args:
        function: The external callback.
        contract: The contract under analysis. Required to resolve overrides of
            the internal delegate; without it, an overridden delegate is missed
            and the callback is misreported as a stub.
    """
    # Callbacks that revert directly, without a delegate (a hand-rolled hook
    # with `function beforeSwap(...) external { revert Nope(); }`).
    own_revert = unconditional_revert(function)
    if own_revert is not None:
        return _classify_revert(function, own_revert)

    delegates: list[Function] = []
    for call in function.internal_calls:
        target = getattr(call, "function", call)
        if not isinstance(target, Function) or not target.is_implemented:
            continue
        # Modifiers show up here too. A modifier is not a delegate, and treating
        # one as such is actively harmful: `onlyPoolManager` reverts and never
        # returns, so it satisfies `unconditional_revert`, and a correctly
        # guarded callback would be written off as an unimplemented stub.
        if isinstance(target, Modifier):
            continue
        delegates.append(resolve_override(contract, target))

    reverting = [(delegate, unconditional_revert(delegate)) for delegate in delegates]
    if not delegates or not all(reason is not None for _, reason in reverting):
        return CallbackImplementation(CallbackStatus.IMPLEMENTED, delegate=function)

    # Every delegate reverts. If any of them is a deliberate, project-owned
    # refusal that is the verdict; a stub next to a deliberate revert is still
    # a deliberate revert from the PoolManager's point of view.
    verdicts = [_classify_revert(delegate, reason) for delegate, reason in reverting]
    for verdict in verdicts:
        if verdict.is_intentionally_disabled:
            return verdict
    return verdicts[0]


def _classify_revert(delegate: Function, reason: RevertReason) -> CallbackImplementation:
    if is_project_source(delegate) and not reason.is_hook_not_implemented:
        return CallbackImplementation(CallbackStatus.INTENTIONALLY_DISABLED, delegate, reason)
    return CallbackImplementation(CallbackStatus.STUB, delegate, reason)


@dataclass(frozen=True)
class LegacyAbiEvidence:
    """Signs that a contract targets a hook interface older than the shipped one.

    Five of fourteen real-world hooks we scanned are on the 2023 interface.
    The dangerous part is not that they are unrecognised — it is that they are
    *partly* recognised. `afterInitialize(address,PoolKey,uint160,int24)` has
    never changed, so a 2023 hook that implements it passes `is_hook_contract`,
    and HS-02 then accuses it of "not declaring getHookPermissions()" when it
    declares `getHooksCalls()`, the 2023 spelling. Reporting a wrong reason at
    HIGH is worse than reporting nothing, so the evidence is collected here and
    consulted by `is_hook_contract` as well as by the unsupported-ABI detector.
    """

    #: `getHooksCalls()` is defined — the 2023 permission declaration, which was
    #: abstract on that era's BaseHook and therefore present on every hook.
    declares_hooks_calls: bool
    #: External functions named like an IHooks callback whose normalised
    #: signature is not the shipped one: `beforeSwap` without `hookData`,
    #: `ModifyLiquidityParams` without `salt`, `beforeInitialize` with the
    #: mid-2024 `hookData` argument.
    mismatched_callbacks: tuple[str, ...]
    #: Inherits something called `BaseHook`. Not evidence on its own — every
    #: current hook does too — but with no recognised callback it is what a
    #: 2023 v4-periphery `BaseHook` descendant looks like.
    inherits_base_hook: bool

    @property
    def is_conclusive(self) -> bool:
        """Evidence strong enough to say the contract is on another interface."""
        return self.declares_hooks_calls

    def __bool__(self) -> bool:
        return self.declares_hooks_calls or bool(self.mismatched_callbacks) or self.inherits_base_hook


def legacy_abi_evidence(contract: Contract) -> LegacyAbiEvidence:
    """Collect the signs that `contract` predates the shipped hook interface."""
    mismatched = sorted(
        {
            function.name
            for function in contract.functions_entry_points
            if function.name in CALLBACK_SIGNATURES
            and normalize_signature(function.solidity_signature) != CALLBACK_SIGNATURES[function.name]
        }
    )
    return LegacyAbiEvidence(
        declares_hooks_calls=any(f.name == "getHooksCalls" for f in contract.functions),
        mismatched_callbacks=tuple(mismatched),
        inherits_base_hook=any(base.name == "BaseHook" for base in contract.inheritance),
    )


def is_hook_contract(contract: Contract) -> bool:
    """Whether this contract is worth running hook detectors against.

    Interfaces, libraries and abstract bases are excluded: they cannot be
    deployed as a hook, and reporting a missing access-control check on
    `IHooks` itself is the kind of noise that gets a tool switched off.

    A contract with conclusive legacy-ABI evidence is excluded too, even when
    one of its callbacks happens to match the current signature: the detectors
    would read its permissions wrong and accuse it of the wrong thing. The
    unsupported-ABI classification reports it instead. See `LegacyAbiEvidence`.
    """
    if contract.is_interface or contract.is_library or contract.is_abstract:
        return False
    if legacy_abi_evidence(contract).is_conclusive:
        return False
    return bool(implemented_callbacks(contract))


# --------------------------------------------------------------------------- #
# The PoolManager reference
# --------------------------------------------------------------------------- #


def pool_manager_variables(contract: Contract) -> set[StateVariable]:
    """State variables that plausibly hold the PoolManager.

    Prefers the declared type. Falls back to naming only for `address`-typed
    variables, where the type carries no information.
    """
    candidates: set[StateVariable] = set()
    for variable in contract.state_variables:
        type_name = str(variable.type)
        if type_name in _POOL_MANAGER_TYPES or type_name.endswith("PoolManager"):
            candidates.add(variable)
        elif type_name == "address" and variable.name.lower().lstrip("_") in _POOL_MANAGER_NAMES:
            candidates.add(variable)
    return candidates


def guards_pool_manager(
    function: Function, pool_manager_vars: set[StateVariable]
) -> Node | None:
    """Find the node that constrains `msg.sender` to the PoolManager.

    Returns the guarding node, or None when the function is unguarded.

    The search covers the function body, every modifier attached to it, and
    everything reachable through internal calls — a hook that pushes its check
    into a private `_onlyPoolManager()` helper is properly guarded, and a
    detector that misses that would be unusable.

    A guard is recognised as: an equality or inequality comparison in which one
    side derives from `msg.sender` and the other from a pool-manager variable.
    We do not additionally verify that the false branch reverts. Doing so would
    require whole-path reasoning that Slither's IR makes awkward, and the
    residual false-negative — a comparison whose result is computed and then
    ignored — is a shape that essentially never occurs by accident. The false
    *positive* direction, which matters far more for a detector people leave
    enabled, is unaffected.
    """
    if not pool_manager_vars:
        return None

    for node in _guard_candidate_nodes(function):
        if _compares_sender_to(node, pool_manager_vars):
            return node
    return None


def _guard_candidate_nodes(function: Function) -> Iterator[Node]:
    """Every node whose execution is implied by calling `function`."""
    seen_functions: set[int] = set()

    def walk(fn: Function) -> Iterator[Node]:
        if id(fn) in seen_functions:
            return
        seen_functions.add(id(fn))
        yield from fn.nodes
        for modifier in fn.modifiers:
            if isinstance(modifier, (Modifier, Function)):
                yield from walk(modifier)
        for internal in fn.internal_calls:
            target = getattr(internal, "function", internal)
            if isinstance(target, Function) and target.is_implemented:
                yield from walk(target)

    yield from walk(function)


def _compares_sender_to(node: Node, targets: set[StateVariable]) -> bool:
    """Whether `node` compares msg.sender against one of `targets`."""
    binaries = [ir for ir in node.irs if isinstance(ir, Binary)]
    if not binaries:
        return False
    if not any(ir.type in (BinaryType.EQUAL, BinaryType.NOT_EQUAL) for ir in binaries):
        return False

    # msg.sender may be compared directly or after a conversion; either way it is
    # read by this node.
    reads_sender = any(
        isinstance(v, SolidityVariableComposed) and v.name == "msg.sender"
        for v in node.variables_read
    )
    if not reads_sender:
        return False

    # The pool manager side is usually `address(poolManager)`, a TypeConversion
    # whose result feeds the comparison. Either way the state variable is read
    # here, which is the signal we key on.
    if targets & set(node.state_variables_read):
        return True

    # Immutables are sometimes surfaced through the conversion rather than as a
    # plain state read, so check conversion sources too.
    for ir in node.irs:
        if isinstance(ir, TypeConversion) and ir.variable in targets:
            return True
    return False


# --------------------------------------------------------------------------- #
# Owner-only functions
# --------------------------------------------------------------------------- #


def owner_variables(contract: Contract) -> set[StateVariable]:
    """State variables that plausibly hold a privileged party.

    Address-typed with an owner-like name. The PoolManager reference is
    excluded even when its name matches: `guards_pool_manager` owns that
    comparison and it means the opposite of an admin check.
    """
    pool_manager = pool_manager_variables(contract)
    candidates: set[StateVariable] = set()
    # `contract.state_variables` omits *private* inherited variables, and
    # OpenZeppelin's `Ownable._owner` is exactly that. The comparison still
    # happens in code the contract inherits, so every ancestor's declarations
    # are candidates.
    declared: list[StateVariable] = list(contract.state_variables)
    for base in contract.inheritance:
        declared.extend(base.state_variables_declared)
    for variable in declared:
        if variable in pool_manager:
            continue
        if str(variable.type) != "address":
            # Ownable's `_owner` is a plain `address`; an interface-typed
            # admin reference would be an unusual shape and is not chased.
            continue
        name = variable.name.lower().lstrip("_")
        if any(hint in name for hint in _OWNER_NAME_HINTS):
            candidates.add(variable)
    return candidates


def guards_owner(function: Function, owner_vars: set[StateVariable]) -> Node | None:
    """Find the node that constrains `msg.sender` to an owner-like variable.

    Same search as `guards_pool_manager` (body, modifiers, internal callees),
    with one extension the pool-manager guard does not need. OpenZeppelin's
    `Ownable` writes its check as `owner() != _msgSender()`: both operands are
    results of internal calls, so the comparing node reads neither `msg.sender`
    nor `_owner` directly. For that shape an operand produced by an internal
    call in the same node is resolved to what its callee reads, transitively.
    A hand-rolled `require(msg.sender == owner)` still matches the direct way.
    """
    if not owner_vars:
        return None
    for node in _guard_candidate_nodes(function):
        if _compares_sender_to(node, owner_vars) or _compares_via_calls(node, owner_vars):
            return node
    return None


def _compares_via_calls(node: Node, owner_vars: set[StateVariable]) -> bool:
    """`owner() != _msgSender()`: an EQ/NE whose operands come from callees."""
    producers: dict[object, Function] = {}
    for ir in node.irs:
        if isinstance(ir, InternalCall) and isinstance(ir.function, Function) and ir.lvalue is not None:
            producers[ir.lvalue] = ir.function

    def source(operand) -> str | None:
        if isinstance(operand, SolidityVariableComposed) and operand.name == "msg.sender":
            return "sender"
        if isinstance(operand, StateVariable) and operand in owner_vars:
            return "owner"
        callee = producers.get(operand)
        if callee is None:
            return None
        if any(
            isinstance(v, SolidityVariableComposed) and v.name == "msg.sender"
            for v in callee.all_solidity_variables_read()
        ):
            return "sender"
        if owner_vars & set(callee.all_state_variables_read()):
            return "owner"
        return None

    for ir in node.irs:
        if not isinstance(ir, Binary) or ir.type not in (BinaryType.EQUAL, BinaryType.NOT_EQUAL):
            continue
        sides = {source(ir.variable_left), source(ir.variable_right)}
        if {"sender", "owner"} <= sides:
            return True
    return False


def owner_only_functions(contract: Contract) -> list[Function]:
    """External or public non-callback functions gated on an owner-like variable.

    The constructor and the IHooks callbacks are excluded — the former is not
    an admin surface and the latter are the PoolManager's, judged by HS-01.
    View and pure functions are excluded too: a gated getter changes nothing
    on chain and is not what "owner-only functions" means to a reviewer.

    Two shapes count. A comparison of `msg.sender` against an owner-like
    variable (`guards_owner`), and a role lookup keyed by the sender that
    decides a branch — OpenZeppelin's `AccessControl` (`onlyRole` →
    `_checkRole` → `hasRole` → `_roles[role].hasRole[account]`), which has no
    `==` anywhere and used to be reported as "no admin surface" on
    StablePairHook. See `access_guard`.
    """
    owner_vars = owner_variables(contract)
    pool_manager = pool_manager_variables(contract)
    gated: list[Function] = []
    for function in entry_point_mutators(contract):
        if owner_vars and guards_owner(function, owner_vars) is not None:
            gated.append(function)
            continue
        guard = access_guard(function, contract)
        if guard is not None and guard_kind(guard, pool_manager) == "role":
            gated.append(function)
    return gated


# --------------------------------------------------------------------------- #
# Declared permissions
# --------------------------------------------------------------------------- #


def declared_permissions(contract: Contract) -> dict[str, bool] | None:
    """Read the permission set a hook declares via `getHookPermissions()`.

    v4 does not consult this function at runtime — permissions come from the
    deployed address — but `Hooks.validateHookPermissions` compares the two in
    the constructor, so it is the author's stated intent. HS-02 exists because
    intent, implementation and address are three separate things that can
    disagree.

    Returns None when the contract declares no permissions, which is itself
    meaningful: the hook is relying entirely on address bits.

    The `Permissions` struct is returned by value, so we read the literal boolean
    assigned to each field in the function body. Anything not assigned a constant
    is reported as None-by-omission rather than guessed at.
    """
    target = next(
        (f for f in contract.functions if f.name == "getHookPermissions" and f.is_implemented),
        None,
    )
    if target is None:
        return None

    permissions: dict[str, bool] = {}
    for node in target.nodes:
        if node.type not in (NodeType.EXPRESSION, NodeType.RETURN):
            continue
        if node.expression is None:
            continue
        # Slither renders the struct literal without whitespace
        # (`beforeSwap:true,afterSwap:false`), while a field-by-field style
        # produces `permissions.beforeSwap = true`. One regex covers both, and
        # tolerates any spacing a future Slither release might introduce —
        # matching on exact literal text here previously made the whole detector
        # silently report "no permissions declared" for every hook.
        for field, literal in _PERMISSION_ASSIGNMENT.findall(str(node.expression)):
            if field in _PERMISSION_FIELD_SET:
                permissions[field] = literal == "true"
    return permissions or None


#: Field names of `Hooks.Permissions`, in bit order. Derived from the flag names
#: in the generated spec so the two cannot drift apart.
_PERMISSION_FIELDS: tuple[str, ...] = tuple(
    _flag.removesuffix("_FLAG").lower().replace("_returns_delta", "_return_delta")
    for _flag in FLAG_BITS
)


def _camel(snake: str) -> str:
    head, *rest = snake.split("_")
    return head + "".join(part.capitalize() for part in rest)


#: `beforeSwap`, `afterSwapReturnDelta`, ... matching the Solidity struct.
PERMISSION_FIELDS: tuple[str, ...] = tuple(_camel(f) for f in _PERMISSION_FIELDS)

_PERMISSION_FIELD_SET: frozenset[str] = frozenset(PERMISSION_FIELDS)

#: `beforeSwap:true`, `beforeSwap: true`, `permissions.beforeSwap = true`.
_PERMISSION_ASSIGNMENT = __import__("re").compile(r"(\w+)\s*[:=]\s*(true|false)\b")

#: Flag name for each struct field, so a divergence can name the address bit.
FIELD_TO_FLAG: dict[str, str] = {
    _camel(_flag.removesuffix("_FLAG").lower().replace("_returns_delta", "_return_delta")): _flag
    for _flag in FLAG_BITS
}

#: Struct fields corresponding to custom-accounting permissions.
RETURNS_DELTA_FIELDS: frozenset[str] = frozenset(
    _camel(_flag.removesuffix("_FLAG").lower().replace("_returns_delta", "_return_delta"))
    for _flag in RETURNS_DELTA_FLAGS
)


# --------------------------------------------------------------------------- #
# Call-graph queries
# --------------------------------------------------------------------------- #


def reachable_functions(function: Function, contract: Contract | None = None) -> set[Function]:
    """Every implemented function reachable from `function` by internal calls.

    Modifiers are included: a reentrancy lock or an access check is code the
    callback executes. Pass `contract` to resolve virtual dispatch on the way —
    without it, `BaseHook.beforeSwap`'s call to `_beforeSwap` lands on the
    base's `revert HookNotImplemented()` stub rather than the override that
    does the work, and every metric computed over the result describes the
    library instead of the hook. See `resolve_override`.
    """
    seen: set[Function] = set()

    def walk(fn: Function) -> None:
        for internal in fn.internal_calls:
            target = getattr(internal, "function", internal)
            if not isinstance(target, Function) or not target.is_implemented:
                continue
            if contract is not None and not isinstance(target, Modifier):
                target = resolve_override(contract, target)
            if target not in seen:
                seen.add(target)
                walk(target)

    walk(function)
    return seen


def swap_path_functions(contract: Contract) -> set[Function]:
    """Functions executed during a swap: the swap callbacks and their callees."""
    roots = [
        cb.function for cb in implemented_callbacks(contract) if cb.name in SWAP_PATH_CALLBACKS
    ]
    reachable: set[Function] = set(roots)
    for root in roots:
        reachable |= reachable_functions(root, contract)
    return reachable


def state_writes_in(functions: Iterable[Function]) -> int:
    """Count state-variable writes across `functions`, one per (node, variable).

    Node-level rather than function-level so `a += 1; a += 1` counts twice and
    a loop body counts once: the number approximates how much mutation a path
    performs, which is what the complexity dimension wants, not how many
    variables exist. Writes are attributed wherever they happen — a hook that
    inherits its logic from a library (the OpenZeppelin mocks in the corpus)
    still mutates that state on every callback, and a metric that excluded it
    would call a limit-order book "stateless".
    """
    count = 0
    for function in functions:
        for node in function.nodes:
            count += len(set(node.state_variables_written))
    return count


@dataclass(frozen=True)
class ExternalCall:
    """An outbound call, with enough context to judge whether it is risky."""

    node: Node
    destination: str
    is_low_level: bool
    is_static: bool
    #: The call operation itself, so a consumer can classify the destination
    #: (`classify_destination`) without re-scanning the node's IR.
    ir: Operation | None = None

    @property
    def function(self) -> Function:
        return self.node.function

    @property
    def line(self) -> int:
        lines = self.node.source_mapping.lines
        return lines[0] if lines else 0

    @property
    def file(self) -> str:
        return self.node.source_mapping.filename.short


def external_calls_in(functions: Iterable[Function]) -> list[ExternalCall]:
    """Collect outbound calls made by the given functions.

    Library calls are excluded: they are `DELEGATECALL` to known, immutable code
    in practice, and counting `FullMath.mulDiv` as an external dependency would
    make the metric meaningless. `SolidityCall` (keccak256, require, ...) is
    likewise not an external interaction.
    """
    calls: list[ExternalCall] = []
    for function in functions:
        for node in function.nodes:
            for ir in node.irs:
                if isinstance(ir, LibraryCall) or isinstance(ir, SolidityCall):
                    continue
                if isinstance(ir, HighLevelCall):
                    calls.append(
                        ExternalCall(
                            node=node,
                            destination=str(ir.destination),
                            is_low_level=False,
                            # Slither exposes view-ness of the callee when known.
                            is_static=bool(getattr(ir.function, "view", False))
                            or bool(getattr(ir.function, "pure", False)),
                            ir=ir,
                        )
                    )
                elif isinstance(ir, LowLevelCall):
                    calls.append(
                        ExternalCall(
                            node=node,
                            destination=str(ir.destination),
                            is_low_level=True,
                            is_static=str(ir.function_name) == "staticcall",
                            ir=ir,
                        )
                    )
                elif isinstance(ir, InternalCall):
                    continue
    return calls


def definition_of(function: Function, variable: object) -> Operation | None:
    """The operation in `function` whose lvalue is `variable`, first in CFG order."""
    for node in function.nodes:
        for ir in node.irs:
            if getattr(ir, "lvalue", None) is variable:
                return ir
    return None


def fully_lifted(function: Function) -> bool:
    """Whether every statement of `function` has SlithIR.

    Slither logs `Impossible to generate IR for <function>` and continues,
    leaving the nodes it reached without IR (HR-E205). A check that reasons
    over "every path" — the zero-delta case of HS-02 — would then see only the
    paths that were lifted: OpenZeppelin's `BaseDynamicAfterFee._afterSwap`
    keeps its early `return (selector, 0)` and loses the computed one, and
    the hook is accused of never returning a delta. Silence is the only honest
    answer for a function the tool did not fully read.
    """
    for node in function.nodes:
        if node.type in (NodeType.RETURN, NodeType.EXPRESSION, NodeType.IF, NodeType.VARIABLE) and not node.irs:
            if node.expression is not None:
                return False
    return True


def returned_values(
    function: Function, contract: Contract, index: int, _visited: set[int] | None = None
) -> list[tuple[Function, object]]:
    """The `index`-th component of every value `function` returns, delegates followed.

    BaseHook's `beforeSwap` is `return _beforeSwap(...)`: a tuple variable
    defined by an internal call, whose components live in the (overridden)
    delegate's own return statements. Each (function, value) pair names the
    function the value lives in, so a caller can keep tracing there.
    """
    visited = _visited if _visited is not None else set()
    if id(function) in visited:
        return []
    visited.add(id(function))
    found: list[tuple[Function, object]] = []
    for node in function.nodes:
        for ir in node.irs:
            if not isinstance(ir, Return):
                continue
            values = list(ir.values)
            if len(values) == 1 and isinstance(values[0], TupleVariable):
                definition = definition_of(function, values[0])
                if isinstance(definition, InternalCall) and isinstance(definition.function, Function):
                    callee = resolve_override(contract, definition.function)
                    found.extend(returned_values(callee, contract, index, visited))
                continue
            if len(values) > index:
                found.append((function, values[index]))
    return found


# --------------------------------------------------------------------------- #
# Access control in general (HS-03)
# --------------------------------------------------------------------------- #


def _is_sender(value: object) -> bool:
    return isinstance(value, SolidityVariableComposed) and value.name == "msg.sender"


@dataclass(frozen=True)
class Guard:
    """Where a function restricts its caller, and how.

    `comparison`: an EQ/NE with one operand derived from `msg.sender`
    (`require(msg.sender == admin)`, Ownable's `owner() != _msgSender()`,
    `msg.sender == address(poolManager)`).
    `role`: a mapping lookup keyed by a sender-derived value whose result
    decides a branch or a `require` without passing through arithmetic —
    AccessControl's `_roles[role].hasRole[account]` behind `if (!hasRole(...))`,
    or a hand-rolled `require(isOperator[msg.sender])`. The "no arithmetic"
    rule is what keeps `orderInfo.liquidity[msg.sender] == 0` (a balance
    check in a user-facing function) from counting as access control.
    """

    node: Node
    kind: str


def access_guard(function: Function, contract: Contract | None = None) -> Guard | None:
    """Find the node where `function` restricts `msg.sender`, of either kind.

    The walk covers the body, every modifier and every internal callee
    (override-resolved when `contract` is given), binding parameters to
    sender-derived arguments on the way so that `_checkRole(role, _msgSender())`
    still resolves to a lookup keyed by the sender three calls down.
    `None` means the function is callable by anyone.
    """
    visited: set[tuple[int, frozenset[str]]] = set()

    def walk(fn: Function, tainted_params: frozenset) -> tuple[Guard | None, bool, bool]:
        """Returns (guard, returns a role lookup, returns a sender-derived value)."""
        key = (id(fn), frozenset(p.name for p in tainted_params))
        if key in visited:
            return None, False, False
        visited.add(key)

        sender: set[object] = set(tainted_params)
        role: set[object] = set()
        # Values that come from storage or from the contract's own identity —
        # what a caller is legitimately compared *against*. `_update(from, to)`
        # in ERC20 checks `from == address(0)` on a sender-derived argument,
        # and that is a null check, not access control: the other side must
        # be an authority (a state variable, `address(this)`, a non-zero
        # constant, `owner()`), never a parameter, a local or zero.
        authority: set[object] = set()
        returns_role = False
        returns_sender = False

        def from_sender(value: object) -> bool:
            return _is_sender(value) or value in sender

        def is_authority(value: object) -> bool:
            if isinstance(value, StateVariable) or value in authority:
                return True
            if isinstance(value, Constant):
                return bool(value.value)
            return isinstance(value, SolidityVariable) and value.name == "this"

        for node in fn.nodes:
            for ir in node.irs:
                if isinstance(ir, Assignment):
                    if from_sender(ir.rvalue):
                        sender.add(ir.lvalue)
                    if ir.rvalue in role:
                        role.add(ir.lvalue)
                    if is_authority(ir.rvalue):
                        authority.add(ir.lvalue)
                elif isinstance(ir, TypeConversion):
                    if from_sender(ir.variable):
                        sender.add(ir.lvalue)
                    if ir.variable in role:
                        role.add(ir.lvalue)
                    if is_authority(ir.variable):
                        authority.add(ir.lvalue)
                elif isinstance(ir, Unary):
                    if ir.rvalue in role:
                        role.add(ir.lvalue)
                elif isinstance(ir, Binary):
                    if ir.type in (BinaryType.EQUAL, BinaryType.NOT_EQUAL):
                        left, right = ir.variable_left, ir.variable_right
                        if (from_sender(left) and is_authority(right)) or (from_sender(right) and is_authority(left)):
                            return Guard(node, "comparison"), returns_role, returns_sender
                elif isinstance(ir, Index):
                    if from_sender(ir.variable_right) or ir.variable_left in role:
                        role.add(ir.lvalue)
                    elif is_authority(ir.variable_left):
                        authority.add(ir.lvalue)
                elif isinstance(ir, Member):
                    if ir.variable_left in role:
                        role.add(ir.lvalue)
                    elif is_authority(ir.variable_left):
                        authority.add(ir.lvalue)
                elif isinstance(ir, InternalCall) and isinstance(ir.function, Function):
                    callee = ir.function
                    if contract is not None and not isinstance(callee, Modifier):
                        callee = resolve_override(contract, callee)
                    bound = frozenset(
                        param
                        for param, argument in zip(callee.parameters, ir.arguments)
                        if from_sender(argument)
                    )
                    guard, callee_role, callee_sender = walk(callee, bound)
                    if guard is not None:
                        return guard, returns_role, returns_sender
                    if ir.lvalue is not None:
                        if callee_role:
                            role.add(ir.lvalue)
                        if callee_sender:
                            sender.add(ir.lvalue)
                        elif callee.all_state_variables_read():
                            # `owner()`: a value read from storage by the callee.
                            authority.add(ir.lvalue)
                elif isinstance(ir, SolidityCall):
                    if str(ir.function.name).startswith(("require", "assert")) and any(
                        argument in role for argument in ir.arguments
                    ):
                        return Guard(node, "role"), returns_role, returns_sender
                elif isinstance(ir, Condition):
                    if ir.value in role:
                        return Guard(node, "role"), returns_role, returns_sender
                elif isinstance(ir, Return):
                    returns_role = returns_role or any(value in role for value in ir.values)
                    returns_sender = returns_sender or any(from_sender(value) for value in ir.values)

        for modifier in fn.modifiers:
            if isinstance(modifier, Function):
                guard, _, _ = walk(modifier, frozenset())
                if guard is not None:
                    return guard, returns_role, returns_sender
        return None, returns_role, returns_sender

    guard, _, _ = walk(function, frozenset())
    return guard


def guard_kind(guard: Guard, pool_manager_vars: set[StateVariable]) -> str:
    """`pool-manager`, `role` or `admin`.

    A comparison against the PoolManager is HS-01's guard: it makes the
    function the PoolManager's, not an administrator's. Everything else that
    restricts the caller is an admin surface of one shape or the other.
    """
    if guard.kind == "role":
        return "role"
    if pool_manager_vars and _compares_sender_to(guard.node, pool_manager_vars):
        return "pool-manager"
    return "admin"


def entry_point_mutators(contract: Contract) -> list[Function]:
    """External or public, non-view functions that are not the hook's callbacks.

    The constructor, the IHooks callbacks (HS-01's business) and
    `unlockCallback` (the PoolManager's re-entry, guarded on it) are excluded.
    """
    callbacks = {cb.function for cb in implemented_callbacks(contract)}
    mutators: list[Function] = []
    for function in contract.functions_entry_points:
        if function.is_constructor or not function.is_implemented:
            continue
        if function.view or function.pure or function in callbacks:
            continue
        if function.name == "unlockCallback":
            continue
        mutators.append(function)
    return mutators


def callback_read_state(contract: Contract) -> set[StateVariable]:
    """State variables read by the implemented callbacks or anything they reach."""
    read: set[StateVariable] = set()
    for callback in implemented_callbacks(contract):
        if not classify_callback(callback.function, contract).is_implemented:
            continue
        for function in reachable_functions(callback.function, contract) | {callback.function}:
            read |= set(function.state_variables_read)
    return read


def state_variables_written_by(function: Function, contract: Contract) -> set[StateVariable]:
    """State variables written by `function` or anything it reaches."""
    written: set[StateVariable] = set()
    for fn in reachable_functions(function, contract) | {function}:
        written |= set(fn.state_variables_written)
    return written


def calls_named_in(function: Function, contract: Contract, names: frozenset[str]) -> list[Node]:
    """Nodes in `function` or its callees that make a high-level or library call named in `names`."""
    hits: list[Node] = []
    for fn in reachable_functions(function, contract) | {function}:
        for node in fn.nodes:
            for ir in node.irs:
                if isinstance(ir, (HighLevelCall, LibraryCall)) and str(ir.function_name) in names:
                    hits.append(node)
                    break
    return hits


# --------------------------------------------------------------------------- #
# Destinations of swap-path calls (HS-05)
# --------------------------------------------------------------------------- #

#: Interface names under which a pool currency is addressed once unwrapped.
_ERC20_TYPES = frozenset({"IERC20", "IERC20Minimal", "ERC20", "IERC20Metadata", "IERC20Permit"})


@dataclass(frozen=True)
class CallDestination:
    """What a swap-path call talks to, and the name to report it by."""

    #: `pool-manager`, `library`, `own-currency` or `third-party`.
    kind: str
    label: str

    @property
    def is_third_party(self) -> bool:
        return self.kind == "third-party"


def _definition_of(function: Function, variable: object) -> Operation | None:
    """The operation in `function` whose lvalue is `variable`, first by CFG order."""
    for node in function.nodes:
        for ir in node.irs:
            if getattr(ir, "lvalue", None) is variable:
                return ir
    return None


def classify_destination(call: ExternalCall, pool_manager_vars: set[StateVariable]) -> CallDestination:
    """Decide whether a swap-path call leaves the pool's own trust boundary.

    Excluded, in order: library calls that Slither surfaces as high-level
    calls on a library contract (`StateLibrary`, `CurrencyLibrary`); the
    PoolManager, by variable or by type; and the pool's own currencies — a
    `Currency`-typed destination, or an ERC-20 interface whose address came
    from `key.currency0`/`key.currency1` (through `Currency.unwrap` or a
    plain conversion) within the same function. Everything else is a third
    party: an oracle, another protocol, an arbitrary address.

    The label names the destination by the variable it was read from, so two
    calls on the same oracle are reported once and a `TMP_17` never reaches a
    report.
    """
    ir = call.ir
    destination = getattr(ir, "destination", None)
    if isinstance(destination, Contract):
        return CallDestination("library" if destination.is_library else "third-party", destination.name)

    type_name = str(getattr(destination, "type", ""))
    if destination in pool_manager_vars or type_name in _POOL_MANAGER_TYPES or type_name.endswith("PoolManager"):
        return CallDestination("pool-manager", str(destination))
    if type_name == "Currency":
        return CallDestination("own-currency", str(destination))

    # Follow the destination back to what it was made from, within the function.
    origin = destination
    own_currency = False
    produced_by: str | None = None
    members: list[str] = []
    for _ in range(8):
        definition = _definition_of(call.function, origin)
        if isinstance(definition, TypeConversion):
            origin = definition.variable
        elif isinstance(definition, Assignment):
            origin = definition.rvalue
        elif isinstance(definition, LibraryCall) and str(definition.function_name) == "unwrap" and definition.arguments:
            origin = definition.arguments[0]
        elif isinstance(definition, Member):
            if str(definition.variable_right) in ("currency0", "currency1"):
                own_currency = True
                break
            # `pool.config.treasury()`: keep the path so the label reads as
            # the source does, then keep walking towards the base variable.
            members.insert(0, str(definition.variable_right))
            origin = definition.variable_left
        elif isinstance(definition, (InternalCall, HighLevelCall, LibraryCall)):
            # `getCurrencyYieldSource(currency).convertToAssets(...)`: the
            # address is whatever the call returned; name it by the call.
            callee = getattr(definition, "function", None)
            produced_by = f"{getattr(callee, 'name', None) or definition.function_name}()"
            break
        else:
            break
        if str(getattr(origin, "type", "")) == "Currency":
            own_currency = True
            break
    if own_currency and (type_name in _ERC20_TYPES or type_name == "address"):
        return CallDestination("own-currency", str(origin))

    base = origin.points_to_origin if isinstance(origin, ReferenceVariable) else origin
    label = getattr(base, "name", None) if not isinstance(base, (Constant, Contract)) else None
    if label and not label.startswith(("TMP_", "REF_")):
        label = ".".join([label, *members])
    elif produced_by is not None:
        label = produced_by
    else:
        expression = str(call.node.expression) if call.node.expression is not None else str(destination)
        # `x = oracle.price()` names the assignment, not the destination.
        expression = expression.split("=", 1)[1].strip() if "=" in expression else expression
        label = expression if len(expression) <= 72 else expression[:69] + "..."
    return CallDestination("third-party", label)


def third_party_calls(contract: Contract) -> list[tuple[ExternalCall, CallDestination]]:
    """Swap-path calls that leave the pool's trust boundary, with their destination."""
    pool_manager = pool_manager_variables(contract)
    found: list[tuple[ExternalCall, CallDestination]] = []
    for call in external_calls_in(swap_path_functions(contract)):
        destination = classify_destination(call, pool_manager)
        if destination.is_third_party:
            found.append((call, destination))
    return found
